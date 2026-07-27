/**
 * VerdictReport assembly, validation, serialization and stdout orchestration.
 * The VerdictReport is the new primitive (mvp_plan §2): a bilingual,
 * machine-readable ship-readiness verdict for non-devs.
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { homedir } from 'node:os';
import type { ErrorObject } from 'ajv';
import type {
  Check,
  ProjectInfo,
  Runtime,
  VibeGateConfig,
  VerdictReport,
} from '../config.js';
import {
  aggregateVerdict,
  DEFAULT_CONFIG,
  validateVerdictReport,
  VERDICT_REPORT_SCHEMA,
} from '../config.js';
import { formatVerdict } from './i18n.js';

// ───────────────────────────── runtime detection ───────────────────────────────

const MINI_PROGRAM_MARKERS = [
  'project.config.json',
  'app.json',
  'game.json',
];

/** Detect the project runtime from manifest files (mvp_plan §3 step 2). */
export function detectRuntime(projectPath: string): { runtime: Runtime; modelHint?: string } {
  // WeChat / 字节 / 支付宝 小程序 marker
  if (MINI_PROGRAM_MARKERS.some((m) => existsSync(resolve(projectPath, m)))) {
    return { runtime: 'mini-program' };
  }
  if (existsSync(resolve(projectPath, 'bun.lockb')) || existsSync(resolve(projectPath, 'bun.lock'))) {
    return { runtime: 'bun' };
  }
  if (existsSync(resolve(projectPath, 'package.json'))) {
    return { runtime: 'node' };
  }
  return { runtime: 'node' };
}

export async function detectProject(projectPath: string): Promise<ProjectInfo> {
  const { runtime, modelHint } = detectRuntime(projectPath);
  let model: string | undefined = modelHint;
  if (!model && existsSync(resolve(projectPath, 'package.json'))) {
    try {
      const pkg = JSON.parse(await readFile(resolve(projectPath, 'package.json'), 'utf8')) as Record<string, unknown>;
      const hint = pkg['x-vibe-model'] ?? pkg['vibeModel'];
      if (typeof hint === 'string') model = hint;
    } catch {
      // ignore — model hint is decorative
    }
  }
  return { path: resolve(projectPath), runtime, ...(model ? { model_hint: model } : {}) };
}

// ───────────────────────────── assembly ────────────────────────────────────────

/** Compose a VerdictReport from the project info and the sub-check results. */
export function buildVerdict(project: ProjectInfo, checks: Check[]): VerdictReport {
  const verdict = aggregateVerdict(checks);
  return {
    project,
    checks,
    verdict,
    generated_at: new Date().toISOString(),
  };
}

/** Validate a report against the VibeGate schema; throws on a malformed report. */
export function assertValid(report: VerdictReport): void {
  if (!validateVerdictReport(report)) {
    const errs = (validateVerdictReport.errors ?? []) as ErrorObject[];
    const errors = errs.map((e) => `${e.instancePath} ${e.message ?? ''}`).join('; ').trim();
    throw new Error(`VibeGate produced a malformed VerdictReport (${errors || 'schema error'}). This is a bug — please file an issue.`);
  }
}

/**
 * Write vibegate-report.json next to the project (the machine-readable artifact
 * the future hosted badge re-renders). Returns the absolute path written, or
 * null if writing was disabled/failed.
 */
export async function writeReport(
  report: VerdictReport,
  cfg: VibeGateConfig = DEFAULT_CONFIG,
): Promise<string | null> {
  if (!cfg.writeReport) return null;
  assertValid(report);
  const dir = report.project.path;
  const out = resolve(dir, 'vibegate-report.json');
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    return out;
  } catch {
    // fall back to home dir if the project path is read-only
    const fallback = resolve(homedir(), 'vibegate-report.json');
    try {
      await writeFile(fallback, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      return fallback;
    } catch {
      return null;
    }
  }
}

/** Print the bilingual traffic-light verdict to stdout. */
export function printVerdict(report: VerdictReport): void {
  process.stdout.write(`${formatVerdict(report)}\n`);
}

/** Schema export for tooling / the hosted badge re-renderer. */
export { VERDICT_REPORT_SCHEMA };

/** Convenience: basename of a project path for display. */
export function shortPath(p: string): string {
  return basename(p) || p;
}
