/**
 * Readiness heuristics (mvp_plan §1 check 2 / m1). Flags the obvious smells a
 * non-dev can't see: missing README, no lockfile, node_modules committed,
 * missing .gitignore, hardcoded secrets, console.log left in prod paths.
 */
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import fg from 'fast-glob';
import type { Check, Finding, VibeGateConfig } from '../config.js';
import {
  LOCKFILE_CANDIDATES,
  README_CANDIDATES,
  SCAN_IGNORE,
  SECRET_PATTERN_SOURCES,
  SOURCE_GLOBS,
  maskSecrets,
  statusFor,
} from '../config.js';

const MAX_SECRET_FINDINGS = 12;
const MAX_CONSOLE_LOG_FINDINGS = 12;

function rel(root: string, p: string): string {
  const r = relative(root, p);
  return r || p;
}

async function readPackageJson(projectPath: string): Promise<Record<string, unknown> | null> {
  const p = resolve(projectPath, 'package.json');
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(await readFile(p, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function hasReadableReadme(projectPath: string): boolean {
  return README_CANDIDATES.some((c) => existsSync(resolve(projectPath, c)));
}

function hasLockfile(projectPath: string): boolean {
  return LOCKFILE_CANDIDATES.some((c) => existsSync(resolve(projectPath, c)));
}

function hasGitignore(projectPath: string): boolean {
  return existsSync(resolve(projectPath, '.gitignore'));
}

function nodeModulesStatus(projectPath: string): { present: boolean; committed: boolean } {
  const nm = resolve(projectPath, 'node_modules');
  if (!existsSync(nm) || !statSync(nm).isDirectory()) {
    return { present: false, committed: false };
  }
  // node_modules is present. Determine whether it is actually TRACKED by git
  // (genuinely committed), so a developer's gitignored node_modules no longer
  // produces a false "committed" RED on the canonical happy path. On a non-git
  // repo or when git is unavailable, we cannot confirm "committed" — surface as
  // a warn ("present — verify it is gitignored"), never a false fail.
  let committed = false;
  try {
    const r = spawnSync('git', ['-C', projectPath, 'ls-files', '--error-unmatch', '--', 'node_modules'], {
      cwd: projectPath,
      encoding: 'utf8',
    });
    committed = (r.status ?? 1) === 0;
  } catch {
    committed = false;
  }
  return { present: true, committed };
}

function compileSecretPatterns(cfg: VibeGateConfig): RegExp[] {
  const sources = [...SECRET_PATTERN_SOURCES, ...cfg.extraSecretPatterns];
  return sources.map((s) => {
    try {
      // The generic credential-assignment pattern (its key alternation contains
      // 'password') is compiled case-insensitively so uppercase / mixed-case
      // keys (API_KEY, PASSWORD, dbPassword, TOKEN, SecretKey) are detected —
      // previously they were a silent false negative. The keyed-prefix patterns
      // (sk-, AKID, LTAI, AKIA, BEGIN ... PRIVATE KEY, AWS 40-char) stay
      // case-specific so a lowercase 'akid' in prose cannot false-match.
      const flags = s.includes('password') ? 'gi' : 'g';
      return new RegExp(s, flags);
    } catch {
      return null;
    }
  }).filter((r): r is RegExp => r !== null);
}

interface ScanFile {
  path: string;
  lines: string[];
}

async function readSourceFiles(projectPath: string): Promise<ScanFile[]> {
  const matches = await fg(SOURCE_GLOBS, {
    cwd: projectPath,
    ignore: SCAN_IGNORE,
    onlyFiles: true,
    dot: false,
    unique: true,
    absolute: true,
    suppressErrors: true,
  });
  const out: ScanFile[] = [];
  for (const abs of matches) {
    try {
      const content = await readFile(abs, 'utf8');
      out.push({ path: abs, lines: content.split(/\r?\n/) });
    } catch {
      // skip unreadable
    }
  }
  return out;
}

function scanSecrets(files: ScanFile[], projectPath: string, patterns: RegExp[]): Finding[] {
  if (patterns.length === 0) return [];
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    for (let i = 0; i < file.lines.length; i++) {
      const line = file.lines[i];
      if (!line) continue;
      for (const re of patterns) {
        re.lastIndex = 0;
        const m = re.exec(line);
        if (m) {
          const where = `${rel(projectPath, file.path)}:${i + 1}`;
          if (seen.has(where)) break;
          seen.add(where);
          // mask the secret for evidence — never echo the full credential.
          // maskSecrets is the shared redaction transform (config.ts) used by
          // both this secret-scan lane and the clean-run sandbox stderr tails,
          // so both lanes share one masking contract.
          const masked = maskSecrets(line).trim();
          findings.push({
            severity: 'fail',
            code: 'hardcoded-secret',
            msg_zh: '疑似硬编码密钥 / 凭据',
            msg_en: 'hardcoded secret / credential',
            evidence: `${where}  ${masked.slice(0, 80)}`,
          });
          if (findings.length >= MAX_SECRET_FINDINGS) return findings;
          break;
        }
      }
    }
  }
  return findings;
}

function scanConsoleLog(files: ScanFile[], projectPath: string): Finding[] {
  const re = /\bconsole\.log\s*\(/;
  const findings: Finding[] = [];
  for (const file of files) {
    for (let i = 0; i < file.lines.length; i++) {
      const line = file.lines[i];
      if (line && re.test(line)) {
        findings.push({
          severity: 'warn',
          code: 'console-log-in-prod',
          msg_zh: '生产路径残留 console.log',
          msg_en: 'console.log left in a production path',
          evidence: `${rel(projectPath, file.path)}:${i + 1}  ${line.trim().slice(0, 70)}`,
        });
        if (findings.length >= MAX_CONSOLE_LOG_FINDINGS) return findings;
      }
    }
  }
  return findings;
}

/** Run the readiness heuristics; returns the readiness Check. */
export async function scanReadiness(
  projectPath: string,
  cfg: VibeGateConfig,
): Promise<Check> {
  const root = resolve(projectPath);
  const findings: Finding[] = [];
  const pkg = await readPackageJson(root);

  // 1. README
  if (!hasReadableReadme(root)) {
    findings.push({
      severity: 'fail',
      code: 'no-readme',
      msg_zh: '缺少 README（非开发者无法判断项目用途与启动方式）',
      msg_en: 'no README (a non-dev cannot tell what this is or how to run it)',
    });
  }

  // 2. lockfile
  if (!hasLockfile(root)) {
    findings.push({
      severity: 'warn',
      code: 'no-lockfile',
      msg_zh: '缺少 lockfile（依赖版本不固定，干净环境可能装出不同结果）',
      msg_en: 'no lockfile (deps are unpinned — clean env may install differently)',
    });
  }

  // 3. node_modules committed vs merely present
  const nm = nodeModulesStatus(root);
  if (nm.committed) {
    findings.push({
      severity: 'fail',
      code: 'node_modules-committed',
      msg_zh: 'node_modules/ 被提交进仓库（体积巨大且混入本地密钥的风险高）',
      msg_en: 'node_modules/ is committed (huge, and likely to leak local secrets)',
    });
  } else if (nm.present) {
    findings.push({
      severity: 'warn',
      msg_zh: 'node_modules/ 存在（请确认已被 .gitignore 忽略，未提交进仓库）',
      msg_en: 'node_modules/ is present (verify it is gitignored, not committed)',
    });
  }

  // 4. .gitignore
  if (!hasGitignore(root)) {
    findings.push({
      severity: 'warn',
      code: 'no-gitignore',
      msg_zh: '缺少 .gitignore（node_modules/ 与密钥文件容易误提交）',
      msg_en: 'no .gitignore (node_modules/ and secret files are easily committed)',
    });
  }

  // 5. license field present in package.json (counts toward readiness + license)
  if (pkg && !('license' in pkg)) {
    findings.push({
      severity: 'warn',
      code: 'no-license-field',
      msg_zh: 'package.json 未声明 license 字段',
      msg_en: 'package.json has no license field declared',
    });
  }

  // 6. source smells — secrets + console.log
  const files = await readSourceFiles(root);
  findings.push(...scanSecrets(files, root, compileSecretPatterns(cfg)));
  findings.push(...scanConsoleLog(files, root));

  return {
    id: 'readiness',
    status: statusFor(findings),
    findings,
  };
}

// re-export internal helpers for tests
export {
  hasReadableReadme,
  hasLockfile,
  hasGitignore,
  nodeModulesStatus,
  compileSecretPatterns,
};
