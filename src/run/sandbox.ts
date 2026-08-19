/**
 * Clean-env sandbox run (mvp_plan §1 check 1 / m2). Copies the project into a
 * temp dir (excluding node_modules so the install is genuinely fresh), installs
 * deps, runs the start script in a child process with a 30s timeout, and
 * captures the stderr tail on crash. No Docker — non-devs don't have it.
 */
import { existsSync } from 'node:fs';
import { readFile, cp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { execa, type Result } from 'execa';
import type { Check, Finding, Runtime, VibeGateConfig } from '../config.js';
import { statusFor, maskSecrets } from '../config.js';

const STDERR_TAIL_LINES = 12;
const GRACE_MS = 2_000;

interface RunResult {
  ok: boolean;
  timedOut: boolean;
  installTimedOut: boolean;
  installFailed: boolean;
  noStartScript: boolean;
  skipped: boolean;
  copyFailed: boolean;
  exitCode: number | null;
  stderrTail: string;
}

function tail(s: string | undefined, n: number): string {
  if (!s) return '';
  const lines = s.split(/\r?\n/).filter((l) => l.length > 0);
  return lines.slice(-n).join('\n').slice(0, 2_000);
}

/** Coerce execa's broad stderr union into a plain string. */
function stderrOf(result: Result): string {
  const s = (result as { stderr?: unknown }).stderr;
  if (typeof s === 'string') return s;
  if (Array.isArray(s)) return s.map((x) => String(x)).join('\n');
  return '';
}

function exitCodeOf(result: Result): number | null {
  const c = (result as { exitCode?: number | null }).exitCode;
  return typeof c === 'number' ? c : null;
}

async function readPackageJson(dir: string): Promise<Record<string, unknown> | null> {
  const p = resolve(dir, 'package.json');
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(await readFile(p, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isEmptyDeps(pkg: Record<string, unknown>): boolean {
  const deps = (pkg['dependencies'] as Record<string, unknown> | undefined) ?? {};
  const dev = (pkg['devDependencies'] as Record<string, unknown> | undefined) ?? {};
  return Object.keys(deps).length === 0 && Object.keys(dev).length === 0;
}

const COPY_FILTER = new Set(['node_modules', 'dist', 'build', '.git', '.next', 'coverage', '.turbo']);

async function copyProject(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  await cp(src, dest, {
    recursive: true,
    force: true,
    errorOnExist: false,
    filter: (s) => {
      // keep the root; skip well-known heavy/generated subtrees
      if (s === src) return true;
      const base = s.split(/[\\/]/).pop() ?? '';
      return !COPY_FILTER.has(base) && !/\bvibegate-report\.json$/.test(s);
    },
  });
}

// fix-start-script-shell-metacharacters: shell operators / quoting / expansion
// that the direct-node fast path cannot represent faithfully. When any is
// present in the start script the sandbox must run it through npm's shell
// (npm runs scripts via a shell) so `&&`, `||`, `;`, pipes, redirections,
// `$VAR`, backticks, `$(...)`, and quotes work as the user wrote them in
// package.json. Without this guard, `node seed.js && node server.js` would
// match the `^\s*node\s+` fast path and `.split(/\s+/)` would turn
// `['seed.js','&&','node','server.js']` into LITERAL argv to `node seed.js`,
// so `server.js` would never run and its crash would never be observed (a
// false GREEN), or `seed.js` would choke on the unexpected argv (a false RED).
const SHELL_METACHAR_RE = /[|;&<>$`"'()\\]/;

function startCommand(
  runtime: Runtime,
  startScript: string | undefined,
): { cmd: string; args: string[] } | null {
  if (!startScript) return null;
  if (runtime === 'bun') return { cmd: 'bun', args: ['run', 'start'] };
  // node runtime: prefer running the start script's node entry directly so a
  // timeout kill reaches the actual process, not a wrapper. BUT only take this
  // fast path when the script is a single node invocation with no shell
  // metacharacters — compound scripts fall back to `npm start` (npm runs
  // scripts through a shell) so the user's package.json intent is honored.
  const direct = startScript.match(/^\s*node\s+(.+)$/);
  if (direct && !SHELL_METACHAR_RE.test(startScript)) {
    const rest = direct[1].trim().split(/\s+/);
    return { cmd: 'node', args: rest };
  }
  return { cmd: 'npm', args: ['start'] };
}

// fix-clean-env-inherits-parent-env: the "clean env" sandbox must reflect a
// fresh deploy, NOT the dev's shell. Previously the child was spawned with
// `env: { ...process.env, ... }`, so the dev's own app-config tokens (e.g.
// MY_CONFIG_TOKEN, which they set in their shell to run the app) leaked into
// the sandbox and masked the very missing-env crash the clean-env run exists
// to catch — a false GREEN on the canonical regression. It also let a sloppy
// app exfiltrate the dev's real keys into the captured stderr (see the
// separate stderr-masking fix). Now the child gets only a minimal OS/runtime
// allowlist (PATH to find node/npm, HOME/USERPROFILE + the Windows spawn
// essentials so `npm install` + the start script still work cross-platform),
// never the app's own config tokens — so a missing-config crash surfaces as a
// real RED, exactly as a fresh deploy would.
const ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'USERPROFILE',
  'SYSTEMROOT',
  'PATHEXT',
  'APPDATA',
  'LOCALAPPDATA',
  'COMSPEC',
];

function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of ENV_ALLOWLIST) {
    const v = process.env[k];
    if (v !== undefined) env[k] = v;
  }
  // CI / color flags are runtime behavior knobs for the child, not app
  // config tokens — keep them so output is deterministic and non-interactive.
  env.CI = '1';
  env.FORCE_COLOR = '0';
  env.NO_COLOR = '1';
  return env;
}

async function runChild(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ result: Result; timedOut: boolean }> {
  let timedOut = false;
  const subprocess = execa(cmd, args, {
    cwd,
    reject: false,
    detached: true,
    windowsHide: true,
    // extendEnv defaults to true in execa, which would merge cleanEnv() ON TOP
    // of process.env (i.e. `{...process.env, ...env}`) and re-leak the dev's
    // shell. The clean env must be EXCLUSIVE — only the allowlist below, never
    // the parent shell — so a missing-config crash surfaces as a real RED.
    extendEnv: false,
    env: cleanEnv(),
  });
  const pid = subprocess.pid ?? null;
  const timer = setTimeout(() => {
    timedOut = true;
    // kill the whole detached process group (npm + its node child)
    if (pid !== null) {
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        try {
          subprocess.kill('SIGTERM');
        } catch {
          /* already dead */
        }
      }
    }
    // escalate to SIGKILL after a grace period
    setTimeout(() => {
      if (pid !== null) {
        try {
          process.kill(-pid, 9);
        } catch {
          /* dead */
        }
      }
    }, GRACE_MS).unref();
  }, timeoutMs);

  try {
    const result = await subprocess;
    clearTimeout(timer);
    return { result, timedOut };
  } catch (e) {
    clearTimeout(timer);
    return { result: e as Result, timedOut };
  }
}

async function runInSandbox(
  projectPath: string,
  runtime: Runtime,
  cfg: VibeGateConfig,
): Promise<RunResult> {
  const sandboxDir = join(tmpdir(), `vibegate-${randomUUID()}`);
  const emptyResult = (over: Partial<RunResult>): RunResult => ({
    ok: false,
    timedOut: false,
    installTimedOut: false,
    installFailed: false,
    noStartScript: false,
    skipped: false,
    copyFailed: false,
    exitCode: null,
    stderrTail: '',
    ...over,
  });

  try {
    await copyProject(projectPath, sandboxDir);
  } catch (e) {
    // fix-sandbox-copy-fail-leak-misreport: copyProject has already mkdir'd
    // sandboxDir (and possibly copied some entries) before cp() throws (e.g.
    // an unreadable .cache/venv subdir, a symlink loop, a special file). This
    // used to be the ONLY branch that returned without cleanup, leaking a
    // vibegate-* temp dir per failed-copy run; and emptyResult carried no
    // distinguishing flag, so runSandbox fell through to the generic "start
    // crashed" branch (start never ran — wrong layer). Reclaim the temp dir
    // and stamp copyFailed so runSandbox reports a copy-phase failure instead.
    await cleanup(sandboxDir);
    return emptyResult({ copyFailed: true, stderrTail: `sandbox copy failed: ${String((e as Error).message)}` });
  }

  // mini-program: no standard runnable start script — skip the run, warn.
  if (runtime === 'mini-program') {
    await cleanup(sandboxDir);
    return emptyResult({ skipped: true });
  }

  const pkg = await readPackageJson(sandboxDir);
  const scripts = (pkg?.['scripts'] as Record<string, unknown> | undefined) ?? {};
  const startScript = typeof scripts['start'] === 'string' ? scripts['start'] : undefined;

  const cmd = startCommand(runtime, startScript);
  if (!cmd) {
    await cleanup(sandboxDir);
    return emptyResult({ noStartScript: true });
  }

  // fresh install only when there are deps to install (keeps offline fixtures fast)
  if (pkg && !isEmptyDeps(pkg)) {
    const install = await runChild(
      'npm',
      ['install', '--no-audit', '--no-fund', '--prefer-offline'],
      sandboxDir,
      cfg.timeoutMs,
    );
    if (install.timedOut) {
      await cleanup(sandboxDir);
      // distinguish an install timeout from a run timeout so the user debugs
      // deps/registry, not the start script. installFailed marks this as an
      // install-layer failure; installTimedOut carries the timeout signal that
      // runSandbox turns into a dedicated "dependency install timed out" finding
      // (ahead of the generic "start timed out" branch).
      return emptyResult({
        installTimedOut: true,
        installFailed: true,
        stderrTail: tail(stderrOf(install.result), STDERR_TAIL_LINES),
      });
    }
    if (install.result.exitCode !== 0) {
      await cleanup(sandboxDir);
      return emptyResult({ installFailed: true, stderrTail: tail(stderrOf(install.result), STDERR_TAIL_LINES) });
    }
  }

  const run = await runChild(cmd.cmd, cmd.args, sandboxDir, cfg.timeoutMs);
  const exitCode = exitCodeOf(run.result);
  const ok = !run.timedOut && exitCode === 0;
  await cleanup(sandboxDir);
  return {
    ok,
    timedOut: run.timedOut,
    installTimedOut: false,
    installFailed: false,
    noStartScript: false,
    skipped: false,
    copyFailed: false,
    exitCode,
    stderrTail: tail(stderrOf(run.result), STDERR_TAIL_LINES),
  };
}

async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}

/** Run the clean-env sandbox; returns the clean-run Check. */
export async function runSandbox(projectPath: string, cfg: VibeGateConfig): Promise<Check> {
  const root = resolve(projectPath);
  const runtime = detectRuntimeForRun(root);
  const res = await runInSandbox(root, runtime, cfg);
  const findings: Finding[] = [];

  // fix-sandbox-stderr-secret-leak: mask secret-looking runs in the captured
  // stderr before it enters finding.evidence (and thus vibegate-report.json,
  // which writeReport JSON.stringifies verbatim). A sloppy app that embeds a
  // runtime/hardcoded secret in a thrown error (e.g. `throw new Error('...=' +
  // secret)`) would otherwise leak it UNMASKED — unlike scanSecrets, which
  // masks its own evidence. Reuse the exact redaction transform the readiness
  // lane uses (maskSecrets) so both lanes share one masking contract.
  const stderrEvidence = maskSecrets(res.stderrTail);

  if (res.skipped) {
    findings.push({
      severity: 'warn',
      msg_zh: '小程序运行时，无标准启动脚本，干净环境实跑已跳过（请在微信开发者工具中运行）',
      msg_en: 'mini-program runtime has no standard start script — clean-env run skipped (open in WeChat DevTools)',
    });
  } else if (res.copyFailed) {
    // fix-sandbox-copy-fail-leak-misreport: a dedicated copy-phase branch ahead
    // of the generic crash branch, so a copyProject failure is reported by the
    // layer that actually failed (not as "start crashed" — the start script
    // never ran). The leaked temp dir is reclaimed by cleanup in runInSandbox.
    findings.push({
      severity: 'fail',
      code: 'sandbox-copy-failed',
      msg_zh: '干净环境沙箱拷贝失败（无法将项目复制进临时目录，检查不可读目录 / 符号链接循环 / 特殊文件）',
      msg_en: 'sandbox copy failed in the clean env (could not copy the project into the temp dir — check for unreadable / looped / special files)',
      evidence: stderrEvidence || undefined,
    });
  } else if (res.noStartScript) {
    findings.push({
      severity: 'warn',
      code: 'no-start-script',
      msg_zh: 'package.json 未定义 start 脚本，无法在干净环境启动',
      msg_en: 'package.json defines no start script — cannot run in a clean env',
    });
  } else if (res.installTimedOut) {
    findings.push({
      severity: 'fail',
      code: 'install-failed',
      msg_zh: `干净环境依赖安装超时（>${Math.round(cfg.timeoutMs / 1000)}s，疑似卡在 registry 或网络）`,
      msg_en: `dependency install timed out in the clean env (>${Math.round(cfg.timeoutMs / 1000)}s — likely waiting on registry/network)`,
      evidence: stderrEvidence || undefined,
    });
  } else if (res.installFailed) {
    findings.push({
      severity: 'fail',
      code: 'install-failed',
      msg_zh: '干净环境依赖安装失败',
      msg_en: 'dependency install failed in the clean env',
      evidence: stderrEvidence || undefined,
    });
  } else if (res.timedOut) {
    findings.push({
      severity: 'fail',
      code: 'timeout',
      msg_zh: `干净环境启动超时（>${Math.round(cfg.timeoutMs / 1000)}s，疑似卡在交互或网络等待）`,
      msg_en: `start timed out in the clean env (>${Math.round(cfg.timeoutMs / 1000)}s — likely waiting on interaction/network)`,
      evidence: stderrEvidence || undefined,
    });
  } else if (!res.ok) {
    findings.push({
      severity: 'fail',
      code: 'crash',
      msg_zh: '干净环境启动崩溃',
      msg_en: 'start crashed in the clean env',
      evidence: stderrEvidence ? `exit ${res.exitCode ?? '?'}\n${stderrEvidence}` : `exit ${res.exitCode ?? '?'}`,
    });
  } else {
    findings.push({
      severity: 'info',
      msg_zh: `干净环境启动成功（退出码 0）`,
      msg_en: `start succeeded in the clean env (exit 0)`,
    });
  }

  return {
    id: 'clean-run',
    status: statusFor(findings),
    findings,
  };
}

function detectRuntimeForRun(projectPath: string): Runtime {
  // mirror detectRuntime (verdict.ts) mini-program markers so the sandbox and
  // the verdict agree — a game.json-only WeChat mini-game is mini-program here
  // too, not a node project that runs (and warns "no start script").
  if (
    existsSync(resolve(projectPath, 'project.config.json')) ||
    existsSync(resolve(projectPath, 'app.json')) ||
    existsSync(resolve(projectPath, 'game.json'))
  ) {
    return 'mini-program';
  }
  if (existsSync(resolve(projectPath, 'bun.lockb')) || existsSync(resolve(projectPath, 'bun.lock'))) {
    return 'bun';
  }
  return 'node';
}

// re-export startCommand for tests (mirrors readiness.ts's internal-helper
// re-export pattern) so the shell-metacharacter execution-path decision can be
// unit-tested without depending on child-process timing.
export { detectRuntimeForRun, startCommand, cleanup as cleanupSandbox };
