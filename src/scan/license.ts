/**
 * License / copyright scan (mvp_plan §1 check 3 / m1). Enumerates direct +
 * transitive package licenses (via license-checker when available, plus a
 * direct node_modules pass that works fully offline), flags GPL/AGPL
 * copyleft, and detects obvious copy-pasted copyright headers.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import fg from 'fast-glob';
import { init as licenseCheckerInit, type ModuleInfos } from 'license-checker';
import type { Check, Finding, VibeGateConfig } from '../config.js';
import {
  COPYRIGHT_HEADER_MARKERS,
  isCopyleft,
  SCAN_IGNORE,
  SOURCE_GLOBS,
  statusFor,
} from '../config.js';

const MAX_COPYRIGHT_FINDINGS = 12;

function rel(root: string, p: string): string {
  const r = relative(root, p);
  return r || p;
}

function normalizeLicense(license: unknown): string | undefined {
  if (!license) return undefined;
  if (typeof license === 'string') return license;
  if (Array.isArray(license)) return license.filter((s) => typeof s === 'string').join(', ');
  return undefined;
}

// ───────────────────────────── copy-pasted copyright headers ──────────────────

async function scanCopyrightHeaders(projectPath: string): Promise<Finding[]> {
  const matches = await fg(SOURCE_GLOBS, {
    cwd: projectPath,
    ignore: SCAN_IGNORE,
    onlyFiles: true,
    dot: false,
    unique: true,
    absolute: true,
    suppressErrors: true,
  });
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const abs of matches) {
    const base = abs.split(/[\\/]/).pop() ?? '';
    // a real LICENSE/NOTICE file is fine; we flag source code that carries a
    // third-party header block (a tell-tale sign of copy-pasted OSS code).
    if (/^licen[sc]e/i.test(base) || /^notice/i.test(base)) continue;
    let lines: string[];
    try {
      lines = (await readFile(abs, 'utf8')).split(/\r?\n/);
    } catch {
      continue;
    }
    // only inspect the leading comment block (first ~40 lines) — that's where
    // copyright headers live; deeper matches are usually real string literals.
    const head = lines.slice(0, 40).join('\n').toLowerCase();
    const hit = COPYRIGHT_HEADER_MARKERS.find((m) => head.includes(m));
    if (hit && !seen.has(abs)) {
      seen.add(abs);
      const lineNo = lines.findIndex((l) => l.toLowerCase().includes(hit)) + 1;
      findings.push({
        severity: 'warn',
        msg_zh: `源码含第三方版权头（疑似拷贝的开源代码）`,
        msg_en: `source carries a third-party copyright header (likely copy-pasted OSS)`,
        evidence: `${rel(projectPath, abs)}:${lineNo || 1}  …${hit}…`,
      });
      if (findings.length >= MAX_COPYRIGHT_FINDINGS) break;
    }
  }
  return findings;
}

// ───────────────────────────── package license enumeration ─────────────────────

function makeCopyleftFinding(
  name: string,
  version: string,
  license: string,
  kind: 'strong' | 'weak',
): Finding {
  const where = `${name}@${version}`;
  if (kind === 'strong') {
    return {
      severity: 'fail',
      msg_zh: `依赖 ${where} 为 ${license}（强传染 copyleft，发布须按同许可证开源整包）`,
      msg_en: `dep ${where} is ${license} (strong copyleft — shipping requires open-sourcing the whole app)`,
      evidence: where,
    };
  }
  return {
    severity: 'warn',
    msg_zh: `依赖 ${where} 为 ${license}（弱 copyleft，需随附归属与许可证文本）`,
    msg_en: `dep ${where} is ${license} (weak copyleft — ship the attribution + license text)`,
    evidence: where,
  };
}

/** Direct, offline pass over top-level node_modules package.json files. */
async function scanNodeModulesDirect(
  projectPath: string,
  cfg: VibeGateConfig,
): Promise<Map<string, Finding>> {
  const out = new Map<string, Finding>();
  const nmDir = resolve(projectPath, 'node_modules');
  if (!existsSync(nmDir)) return out;
  const matches = await fg(['*/package.json', '@*/*/package.json'], {
    cwd: nmDir,
    onlyFiles: true,
    dot: true,
    unique: true,
    absolute: true,
    suppressErrors: true,
  });
  for (const abs of matches) {
    let pkg: Record<string, unknown>;
    try {
      pkg = JSON.parse(await readFile(abs, 'utf8')) as Record<string, unknown>;
    } catch {
      continue;
    }
    const name = typeof pkg['name'] === 'string' ? pkg['name'] : '';
    const version = typeof pkg['version'] === 'string' ? pkg['version'] : '';
    const license = normalizeLicense(pkg['license'] ?? pkg['licenses']);
    const key = `${name}@${version}`;
    if (!name || out.has(key)) continue;
    if (cfg.copyleftAllowlist.includes(name)) continue;
    const kind = isCopyleft(license);
    if (kind) out.set(key, makeCopyleftFinding(name, version, license ?? 'unknown', kind));
  }
  return out;
}

/** license-checker enrichment: adds transitive packages the direct pass missed. */
async function scanWithLicenseChecker(
  projectPath: string,
  cfg: VibeGateConfig,
  seen: Map<string, Finding>,
): Promise<void> {
  if (!existsSync(resolve(projectPath, 'node_modules'))) return;
  let infos: ModuleInfos;
  try {
    infos = await new Promise<ModuleInfos>((resolveP, rejectP) => {
      licenseCheckerInit(
        { start: projectPath, production: true, direct: false },
        (err, ret) => {
          if (err) rejectP(err);
          else resolveP(ret as ModuleInfos);
        },
      );
    });
  } catch {
    // license-checker errors on missing/odd trees — the direct pass already
    // covered top-level packages, so this is a best-effort enrichment only.
    return;
  }
  for (const [key, info] of Object.entries(infos)) {
    const name = info.name ?? key.split('@').slice(0, -1).join('@') ?? key;
    const version = info.version ?? '';
    if (seen.has(`${name}@${version}`) || seen.has(key)) continue;
    if (cfg.copyleftAllowlist.includes(name)) continue;
    const license = normalizeLicense(info.licenses);
    const kind = isCopyleft(license);
    if (kind) seen.set(key, makeCopyleftFinding(name, version, license ?? 'unknown', kind));
  }
}

/** Run the license / copyright scan; returns the license Check. */
export async function scanLicense(
  projectPath: string,
  cfg: VibeGateConfig,
): Promise<Check> {
  const root = resolve(projectPath);
  const findings: Finding[] = [];

  // 1. copy-pasted third-party copyright headers
  findings.push(...(await scanCopyrightHeaders(root)));

  // 2. installed-package copyleft (direct offline pass first, then enrich)
  const seen = await scanNodeModulesDirect(root, cfg);
  await scanWithLicenseChecker(root, cfg, seen);
  findings.push(...Array.from(seen.values()));

  return {
    id: 'license',
    status: statusFor(findings),
    findings,
  };
}

export { normalizeLicense };
