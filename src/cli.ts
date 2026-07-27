#!/usr/bin/env node
/**
 * VibeGate CLI (mvp_plan §3, §4). One command, three local checks, a bilingual
 * traffic-light verdict. `vibegate scan` and `vibegate run` are the m1/m2
 * halves; the bare `vibegate <path>` is the canonical one-command experience.
 */
import { Command } from 'commander';
import { consola } from 'consola';
import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import type { Check, VibeGateConfig } from './config.js';
import { loadConfig, DEFAULT_CONFIG } from './config.js';
import { scanLicense } from './scan/license.js';
import { scanReadiness } from './scan/readiness.js';
import { runSandbox } from './run/sandbox.js';
import { buildVerdict, detectProject, printVerdict, writeReport } from './report/verdict.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function readVersion(): string {
  for (const candidate of [resolve(__dirname, '..', 'VERSION'), resolve(process.cwd(), 'VERSION')]) {
    try {
      return readFileSync(candidate, 'utf8').trim();
    } catch {
      /* try next */
    }
  }
  return '0.1.0';
}

// ───────────────────────────── tiny spinner ────────────────────────────────────

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

class Spinner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private i = 0;
  constructor(private msg: string) {}
  start(): void {
    this.timer = setInterval(() => {
      process.stderr.write(`\r\x1b[36m${SPINNER_FRAMES[this.i++ % SPINNER_FRAMES.length]}\x1b[0m ${this.msg}`);
    }, 80);
  }
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      process.stderr.write('\r\x1b[K');
    }
  }
}

async function withSpinner<T>(msg: string, fn: () => Promise<T>): Promise<T> {
  const s = new Spinner(msg);
  s.start();
  try {
    return await fn();
  } finally {
    s.stop();
  }
}

// ───────────────────────────── run orchestration ──────────────────────────────

interface Which {
  readiness: boolean;
  license: boolean;
  cleanRun: boolean;
}

async function runChecks(
  projectPath: string,
  cfg: VibeGateConfig,
  which: Which,
): Promise<{ report: import('./config.js').VerdictReport }> {
  const project = await detectProject(projectPath);
  const checks: Check[] = [];
  if (which.readiness) {
    checks.push(await withSpinner('正在做生产就绪体检…', () => scanReadiness(projectPath, cfg)));
  }
  if (which.license) {
    checks.push(await withSpinner('正在扫许可证 / 版权…', () => scanLicense(projectPath, cfg)));
  }
  if (which.cleanRun) {
    checks.push(await withSpinner('正在干净环境跑一遍…', () => runSandbox(projectPath, cfg)));
  }
  const report = buildVerdict(project, checks);
  return { report };
}

interface CommonOpts {
  timeout?: string;
  json?: boolean;
}

function mergeCfg(projectPath: string, opts: CommonOpts): Promise<VibeGateConfig> {
  return loadConfig(projectPath).then((cfg) => ({
    ...cfg,
    timeoutMs: opts.timeout ? Number.parseInt(opts.timeout, 10) || cfg.timeoutMs : cfg.timeoutMs,
    writeReport: opts.json === false ? false : cfg.writeReport,
  }));
}

async function emit(projectPath: string, cfg: VibeGateConfig, which: Which): Promise<void> {
  if (!existsSync(projectPath)) {
    consola.error(`项目路径不存在: ${projectPath}`);
    process.exitCode = 1;
    return;
  }
  try {
    const { report } = await runChecks(projectPath, cfg, which);
    printVerdict(report);
    const out = await writeReport(report, cfg);
    if (out && cfg.writeReport) {
      consola.info(`报告已写入 ${out}`);
    }
  } catch (e) {
    consola.error(`VibeGate 运行失败: ${(e as Error).message}`);
    process.exitCode = 1;
  }
}

// ───────────────────────────── commands ────────────────────────────────────────

const program = new Command();

function addCommonOpts(cmd: Command): Command {
  return cmd
    .option('-t, --timeout <ms>', 'sandbox run timeout in ms (default 30000)')
    .option('--no-json', 'do not write vibegate-report.json');
}

program
  .name('vibegate')
  .description('一条命令给国产模型 vibe-code 出来的小程序做本地体检')
  .version(readVersion(), '-v, --version')
  .argument('[path]', 'project path')
  .allowExcessArguments(false)
  .action(async (path: string | undefined, opts: CommonOpts) => {
    if (!path || path.startsWith('-')) {
      program.help();
      return;
    }
    const resolved = resolve(path);
    const cfg = await mergeCfg(resolved, opts);
    await emit(resolved, cfg, { readiness: true, license: true, cleanRun: true });
  });

addCommonOpts(program);

program
  .command('scan <path>', { isDefault: false })
  .description('静态体检：生产就绪 + 许可证 / 版权扫描，打印双语红黄绿判定')
  .allowExcessArguments(false)
  .option('-t, --timeout <ms>', 'sandbox run timeout in ms (ignored by scan)')
  .option('--no-json', 'do not write vibegate-report.json')
  .action(async (path: string, opts: CommonOpts) => {
    const resolved = resolve(path);
    const cfg = await mergeCfg(resolved, opts);
    await emit(resolved, cfg, { readiness: true, license: true, cleanRun: false });
  });

program
  .command('run <path>', { isDefault: false })
  .description('干净环境实跑：拷贝到临时目录、全新装依赖、30s 超时启动子进程，抓崩溃')
  .allowExcessArguments(false)
  .option('-t, --timeout <ms>', 'sandbox run timeout in ms (default 30000)')
  .option('--no-json', 'do not write vibegate-report.json')
  .action(async (path: string, opts: CommonOpts) => {
    const resolved = resolve(path);
    const cfg = await mergeCfg(resolved, opts);
    await emit(resolved, cfg, { readiness: false, license: false, cleanRun: true });
  });

program.parseAsync(process.argv).catch((e) => {
  consola.error(`VibeGate: ${(e as Error).message}`);
  process.exitCode = 1;
});

export { program, readVersion, DEFAULT_CONFIG };
