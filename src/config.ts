/**
 * VibeGate shared types, constants, schema and config loader.
 * The single source of truth for the VerdictReport primitive (mvp_plan §2) and
 * the tunable knobs (copyleft rules, secret patterns, sandbox timeout).
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { Ajv } from 'ajv';

// ───────────────────────────── types (the core primitive) ────────────────────

export type Severity = 'info' | 'warn' | 'fail';
export type CheckStatus = 'pass' | 'warn' | 'fail';
export type Verdict = 'green' | 'yellow' | 'red';
export type CheckId = 'clean-run' | 'readiness' | 'license';
export type Runtime = 'node' | 'bun' | 'mini-program';

export interface Finding {
  severity: Severity;
  msg_zh: string;
  msg_en: string;
  evidence?: string;
}

export interface Check {
  id: CheckId;
  status: CheckStatus;
  findings: Finding[];
}

export interface ProjectInfo {
  path: string;
  runtime: Runtime;
  model_hint?: string;
}

export interface VerdictReport {
  project: ProjectInfo;
  checks: Check[];
  verdict: Verdict;
  generated_at: string;
}

// ───────────────────────────── status helpers ────────────────────────────────

export function statusFor(findings: Finding[]): CheckStatus {
  if (findings.some((f) => f.severity === 'fail')) return 'fail';
  if (findings.some((f) => f.severity === 'warn')) return 'warn';
  return 'pass';
}

export function aggregateVerdict(checks: Check[]): Verdict {
  if (checks.some((c) => c.status === 'fail')) return 'red';
  if (checks.some((c) => c.status === 'warn')) return 'yellow';
  return 'green';
}

// ───────────────────────────── tunable config ─────────────────────────────────

export interface VibeGateConfig {
  /** sandbox run timeout in milliseconds */
  timeoutMs: number;
  /** package licenses whose presence is acceptable in this project (allowlist) */
  copyleftAllowlist: string[];
  /** extra secret regexes (source) layered on top of the defaults */
  extraSecretPatterns: string[];
  /** write vibegate-report.json next to the project */
  writeReport: boolean;
}

export const DEFAULT_CONFIG: VibeGateConfig = {
  timeoutMs: 30_000,
  copyleftAllowlist: [],
  extraSecretPatterns: [],
  writeReport: true,
};

/**
 * Strong copyleft: redistribution-infecting licenses. Presence in a project
 * destined for distribution is a hard fail (per Codeberg-style enforcement).
 * Matched case-insensitively against the normalized license string.
 */
export const COPYLEFT_STRONG = [
  'gpl',
  'agpl',
  'gfdl',
  'sspl',
  'gpl-2.0',
  'gpl-2.0-only',
  'gpl-2.0-or-later',
  'gpl-3.0',
  'gpl-3.0-only',
  'gpl-3.0-or-later',
  'agpl-3.0',
  'agpl-3.0-only',
  'agpl-3.0-or-later',
  'gnu general public license',
];

/**
 * Weak / file-level copyleft: warn (LGPL/MPL/EPL/CDDL) — usable but carries
 * attribution obligations a non-dev should know about.
 */
export const COPYLEFT_WEAK = [
  'lgpl',
  'lgpl-2.1',
  'lgpl-3.0',
  'mpl',
  'mpl-2.0',
  'epl',
  'epl-1.0',
  'epl-2.0',
  'cddl',
  'cddl-1.0',
  'cddl-1.1',
  'european union public licence',
  'eupl',
];

/** Secret-like patterns a non-dev can't see but a host can. Compiled at load. */
export const SECRET_PATTERN_SOURCES: string[] = [
  // Aliyun / Tencent access-key ids
  'AKID[A-Za-z0-9]{12,}',
  'LTAI[A-Za-z0-9]{12,}',
  'AKIA[0-9A-Z]{16}',
  // OpenAI / Anthropic / common sk- keys (allow internal hyphens for sk-proj- / sk-ant- forms)
  'sk-[A-Za-z0-9-]{20,}',
  // AWS secret keys (40 base64-ish)
  '(?<![A-Za-z0-9/+])[A-Za-z0-9/+]{40}(?![A-Za-z0-9/+])',
  // generic assignment of a credential-looking literal
  '(?:access_key_id|accessKeyId|secret_access_key|secretAccessKey|aws_secret_access_key|secretKey|passwd|password|api[_-]?key|apiKey|auth[_-]?token|authToken|client[_-]?secret|clientSecret)["\']?\\s*[:=]\\s*["\'][^"\'\\s]{8,}["\']',
  // private key headers
  '-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----',
];

/** Header strings that indicate copy-pasted third-party copyrighted code. */
export const COPYRIGHT_HEADER_MARKERS = [
  'gnu general public license',
  'licensed under the gpl',
  'licensed under the agpl',
  'licensed under the apache license',
  'licensed under the mit license',
  'mozilla public license',
  'bsd 3-clause',
  'copyright (c)',
  'copyright (c)',
  'all rights reserved',
];

/** Source file globs scanned for smells (excludes deps & build output). */
export const SOURCE_GLOBS = ['**/*.{js,ts,jsx,tsx,mjs,cjs}'];

export const SCAN_IGNORE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.git/**',
  '**/.next/**',
  '**/coverage/**',
  // non-production source: legitimate console.log / fake fixture secrets in
  // tests, specs, and type declarations must not inflate the readiness verdict
  // toward yellow/red with a factually-wrong "production path" message.
  '**/*.test.{js,ts,jsx,tsx,mjs,cjs}',
  '**/*.spec.{js,ts,jsx,tsx,mjs,cjs}',
  '**/tests/**',
  '**/__tests__/**',
  '**/*.d.ts',
];

/** Readme file candidates in priority order. */
export const README_CANDIDATES = ['README.md', 'README.MD', 'README', 'README.txt', 'README.rst'];

/** Lockfile candidates (any one satisfies the lockfile check). */
export const LOCKFILE_CANDIDATES = [
  'package-lock.json',
  'yarn.lock',
  'bun.lockb',
  'bun.lock',
  'pnpm-lock.yaml',
  'npm-shrinkwrap.json',
];

export function isCopyleft(license: string | undefined): 'strong' | 'weak' | null {
  if (!license) return null;
  const norm = license.toLowerCase();
  if (COPYLEFT_STRONG.some((c) => norm.includes(c))) return 'strong';
  if (COPYLEFT_WEAK.some((c) => norm.includes(c))) return 'weak';
  return null;
}

// ───────────────────────────── optional .vibegate.yml ─────────────────────────

export async function loadConfig(projectPath: string): Promise<VibeGateConfig> {
  const cfgPath = resolve(projectPath, '.vibegate.yml');
  if (!existsSync(cfgPath)) return { ...DEFAULT_CONFIG };
  let raw: string;
  try {
    raw = await readFile(cfgPath, 'utf8');
  } catch {
    return { ...DEFAULT_CONFIG };
  }
  let parsed: Record<string, unknown> = {};
  try {
    parsed = parseYaml(raw) as Record<string, unknown>;
  } catch {
    // malformed config — fall back to defaults, do not crash the verdict
    return { ...DEFAULT_CONFIG };
  }
  return {
    timeoutMs: typeof parsed.timeoutMs === 'number' ? parsed.timeoutMs : DEFAULT_CONFIG.timeoutMs,
    copyleftAllowlist: Array.isArray(parsed.copyleftAllowlist)
      ? (parsed.copyleftAllowlist as string[])
      : DEFAULT_CONFIG.copyleftAllowlist,
    extraSecretPatterns: Array.isArray(parsed.extraSecretPatterns)
      ? (parsed.extraSecretPatterns as string[])
      : DEFAULT_CONFIG.extraSecretPatterns,
    writeReport: typeof parsed.writeReport === 'boolean' ? parsed.writeReport : DEFAULT_CONFIG.writeReport,
  };
}

// ───────────────────────────── report schema (ajv self-validation) ────────────

export const VERDICT_REPORT_SCHEMA = {
  type: 'object',
  required: ['project', 'checks', 'verdict', 'generated_at'],
  properties: {
    project: {
      type: 'object',
      required: ['path', 'runtime'],
      properties: {
        path: { type: 'string' },
        runtime: { enum: ['node', 'bun', 'mini-program'] },
        model_hint: { type: 'string' },
      },
    },
    checks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'status', 'findings'],
        properties: {
          id: { enum: ['clean-run', 'readiness', 'license'] },
          status: { enum: ['pass', 'warn', 'fail'] },
          findings: {
            type: 'array',
            items: {
              type: 'object',
              required: ['severity', 'msg_zh', 'msg_en'],
              properties: {
                severity: { enum: ['info', 'warn', 'fail'] },
                msg_zh: { type: 'string' },
                msg_en: { type: 'string' },
                evidence: { type: 'string' },
              },
            },
          },
        },
      },
    },
    verdict: { enum: ['green', 'yellow', 'red'] },
    generated_at: { type: 'string' },
  },
};

const ajv = new Ajv({ allErrors: true, strict: false });
export const validateVerdictReport = ajv.compile<VerdictReport>(VERDICT_REPORT_SCHEMA);
