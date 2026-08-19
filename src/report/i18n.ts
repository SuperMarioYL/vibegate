/**
 * Bilingual (zh primary, en sibling) message catalog + ANSI rendering.
 * VibeGate's product IS the bilingual traffic-light verdict — a non-dev must
 * be able to read the verdict in Chinese without a developer in the room,
 * while an English-only reviewer still gets the sibling block.
 */
import type { Check, CheckId, Finding, Severity, Verdict, VerdictReport } from '../config.js';

// ───────────────────────────── ANSI ───────────────────────────────────────────

export const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  boldGreen: '\x1b[1;32m',
  boldYellow: '\x1b[1;33m',
  boldRed: '\x1b[1;31m',
} as const;

function colorForVerdict(v: Verdict): string {
  return v === 'green' ? ANSI.boldGreen : v === 'yellow' ? ANSI.boldYellow : ANSI.boldRed;
}

// geometric traffic-light circle (not an emoji — house-style compliant)
function dotFor(v: Verdict): string {
  return `${colorForVerdict(v)}●${ANSI.reset}`;
}

// ───────────────────────────── catalogs ───────────────────────────────────────

export const CHECK_TITLES: Record<CheckId, { zh: string; en: string }> = {
  'clean-run': { zh: '干净环境实跑', en: 'Clean-env run' },
  readiness: { zh: '生产就绪体检', en: 'Readiness check' },
  license: { zh: '许可证 / 版权', en: 'License / copyright' },
};

export const VERDICT_TITLES: Record<Verdict, { zh: string; en: string }> = {
  green: { zh: '绿灯 · 本地体检通过，可谨慎发布', en: 'GREEN · locally ship-clean, proceed with caution' },
  yellow: { zh: '黄灯 · 有需处理项，先修再发', en: 'YELLOW · fix the warnings before shipping' },
  red: { zh: '红灯 · 请勿直接发布', en: 'RED · do not ship as-is' },
};

export function glyph(severity: Severity): string {
  if (severity === 'fail') return `${ANSI.boldRed}✗${ANSI.reset}`;
  if (severity === 'warn') return `${ANSI.boldYellow}⚠${ANSI.reset}`;
  return `${ANSI.gray}·${ANSI.reset}`;
}

export function statusGlyph(status: 'pass' | 'warn' | 'fail'): string {
  if (status === 'pass') return `${ANSI.boldGreen}✓${ANSI.reset}`;
  if (status === 'warn') return `${ANSI.boldYellow}⚠${ANSI.reset}`;
  return `${ANSI.boldRed}✗${ANSI.reset}`;
}

// ───────────────────────────── fix hints (red verdict top-3) ───────────────────

export const FIX_HINTS: Record<string, { zh: string; en: string }> = {
  'no-readme': { zh: '新增一个 README.md，说明项目用途与启动方式', en: 'add a README.md describing the project and how to start it' },
  'no-lockfile': { zh: '运行 npm install 生成 package-lock.json 后提交', en: 'run npm install to generate a lockfile and commit it' },
  'no-gitignore': { zh: '新增 .gitignore，至少忽略 node_modules/', en: 'add a .gitignore that at least ignores node_modules/' },
  'node_modules-committed': { zh: '把 node_modules/ 加入 .gitignore 并从仓库移除', en: 'gitignore node_modules/ and remove it from the repo' },
  'hardcoded-secret': { zh: '改用环境变量 / .env（不要提交 .env）', en: 'move to env vars / .env (do not commit .env)' },
  'console-log-in-prod': { zh: '发布前移除或改用日志库', en: 'remove or swap for a logger before shipping' },
  'no-license-field': { zh: '在 package.json 声明 license 字段（如 MIT）', en: 'declare a license field in package.json (e.g. MIT)' },
  'copyleft-dep-strong': { zh: '替换为许可宽松的同类包，或确认可接受 GPL 义务', en: 'swap for a permissive alternative or accept GPL obligations' },
  'copyleft-dep-weak': { zh: '保留即可，但需随附归属与许可证文本', en: 'keepable, but ship the attribution + license text' },
  'copy-pasted-copyright': { zh: '核查这段代码来源，必要时替换或补齐归属', en: 'trace the source, replace or add attribution' },
  'crash': { zh: '检查启动脚本的报错堆栈，补齐缺失依赖 / 环境变量', en: 'inspect the start-script error, add the missing deps/env vars' },
  'timeout': { zh: '启动卡住超时，检查启动脚本是否在等待交互 / 网络', en: 'start hung past the timeout — check for interactive/network waits' },
  'no-start-script': { zh: '在 package.json 的 scripts 里加一个 start', en: 'add a start script to package.json scripts' },
  'install-failed': { zh: '依赖安装失败，检查 package.json 与 node/npm 版本', en: 'dependency install failed — check package.json and node/npm versions' },
  'sandbox-copy-failed': { zh: '沙箱拷贝失败，检查不可读目录 / 符号链接循环 / 特殊文件后重试', en: 'sandbox copy failed — check for unreadable dirs / symlink loops / special files and retry' },
};

// ───────────────────────────── formatting ─────────────────────────────────────

interface Lang {
  code: 'zh' | 'en';
  finding: (f: Finding) => string;
  evidence: (f: Finding) => string;
  overall: (v: Verdict) => string;
  checks: (checks: Check[]) => string;
  fixHeader: string;
  attestation: (r: VerdictReport) => string;
}

const zh: Lang = {
  code: 'zh',
  finding: (f) => `${glyph(f.severity)} ${f.msg_zh}`,
  evidence: (f) => (f.evidence ? `\n        ${ANSI.gray}证据：${f.evidence}${ANSI.reset}` : ''),
  overall: (v) => `${dotFor(v)} ${VERDICT_TITLES[v].zh}`,
  checks: (checks) =>
    checks
      .map((c) => {
        const t = CHECK_TITLES[c.id];
        const head = `  ${statusGlyph(c.status)} ${t.zh}`;
        if (c.findings.length === 0) return `${head}\n      ${ANSI.gray}无问题${ANSI.reset}`;
        const body = c.findings
          .map((f) => `      ${zh.finding(f)}${zh.evidence(f)}`)
          .join('\n');
        return `${head}\n${body}`;
      })
      .join('\n'),
  fixHeader: '首要修复建议（怎么修）',
  attestation: (r) =>
    `VibeGate ✓ 体检通过 · ${r.project.runtime} · ${r.verdict} · ${r.generated_at}`,
};

const en: Lang = {
  code: 'en',
  finding: (f) => `${glyph(f.severity)} ${f.msg_en}`,
  evidence: (f) => (f.evidence ? `\n        ${ANSI.gray}evidence: ${f.evidence}${ANSI.reset}` : ''),
  overall: (v) => `${dotFor(v)} ${VERDICT_TITLES[v].en}`,
  checks: (checks) =>
    checks
      .map((c) => {
        const t = CHECK_TITLES[c.id];
        const head = `  ${statusGlyph(c.status)} ${t.en}`;
        if (c.findings.length === 0) return `${head}\n      ${ANSI.gray}no issues${ANSI.reset}`;
        const body = c.findings
          .map((f) => `      ${en.finding(f)}${en.evidence(f)}`)
          .join('\n');
        return `${head}\n${body}`;
      })
      .join('\n'),
  fixHeader: 'Top fixes (how to fix)',
  attestation: (r) =>
    `VibeGate ✓ ship-clean · ${r.project.runtime} · ${r.verdict} · ${r.generated_at}`,
};

function topFailFindings(report: VerdictReport, limit = 3): Finding[] {
  return report.checks
    .flatMap((c) => c.findings)
    .filter((f) => f.severity === 'fail')
    .slice(0, limit);
}

/**
 * fix-dead-fix-hints-remediation: the bilingual how-to-fix text for a finding,
 * drawn from the prepared FIX_HINTS catalog keyed by the finding's `code`. A
 * non-dev learns HOW to fix what is broken, not just WHAT is broken. Falls
 * back to the fail message (lang.finding) when the finding has no code or no
 * hint exists for that code, so the section is never empty.
 */
function fixHint(f: Finding, lang: Lang): string {
  const hint = f.code ? FIX_HINTS[f.code]?.[lang.code] : undefined;
  return hint ?? lang.finding(f);
}

function block(report: VerdictReport, lang: Lang): string {
  const sep = lang.code === 'zh' ? '═'.repeat(56) : '─'.repeat(56);
  const title = lang.code === 'zh' ? 'VibeGate 本地体检结果' : 'VibeGate local readiness verdict';
  const header = `${sep}\n${ANSI.bold}  ${title}${ANSI.reset}  ${ANSI.gray}${report.project.path}${ANSI.reset}\n${sep}`;
  const overall = `  ${lang.overall(report.verdict)}`;
  const detail = lang.checks(report.checks);
  let out = `${header}\n${overall}\n${detail}\n${sep}`;
  if (report.verdict === 'red') {
    const tops = topFailFindings(report);
    if (tops.length > 0) {
      // emit the prepared bilingual FIX_HINTS remediation guidance (not a
      // duplicate of the ✗ fail messages already shown in the body above).
      const list = tops
        .map((f, i) => `   ${i + 1}. ${fixHint(f, lang)}`)
        .join('\n');
      out += `\n  ${ANSI.bold}${lang.fixHeader}${ANSI.reset}\n${list}\n${sep}`;
    }
  } else if (report.verdict === 'green') {
    out += `\n  ${ANSI.boldGreen}${lang.attestation(report)}${ANSI.reset}\n${sep}`;
  }
  return out;
}

/**
 * Render the full bilingual verdict block: zh primary, en sibling (the product
 * spec mandates BOTH locales in every stdout so a non-dev reads zh and a
 * cross-border reviewer reads en).
 */
export function formatVerdict(report: VerdictReport): string {
  return [block(report, zh), block(report, en)].join('\n');
}

export { zh as langZh, en as langEn };
