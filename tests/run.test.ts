import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSandbox } from '../src/run/sandbox.js';
import { DEFAULT_CONFIG, type VibeGateConfig } from '../src/config.js';

const CFG: VibeGateConfig = { ...DEFAULT_CONFIG, writeReport: false };

async function makeProject(
  label: string,
  pkg: Record<string, unknown>,
  files: Record<string, string> = {},
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `vibegate-test-${label}-`));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  for (const [path, content] of Object.entries(files)) {
    const sub = join(dir, path);
    await mkdir(join(sub, '..'), { recursive: true });
    await writeFile(sub, content);
  }
  return dir;
}

async function withDir(dir: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('clean-run reports a crash and captures the stderr tail', async () => {
  const dir = await makeProject(
    'crash',
    { name: 'crash-app', version: '1.0.0', scripts: { start: 'node app.js' }, dependencies: {} },
    { 'app.js': "throw new Error('boom: MY_CONFIG_TOKEN env var is required');\n" },
  );
  await withDir(dir, async () => {
    const check = await runSandbox(dir, { ...CFG, timeoutMs: 8_000 });
    assert.equal(check.id, 'clean-run');
    assert.equal(check.status, 'fail');
    const crash = check.findings.find((f) => /crashed/i.test(f.msg_en));
    assert.ok(crash, 'reports a crash');
    assert.ok(
      (crash?.evidence ?? '').includes('MY_CONFIG_TOKEN') || (crash?.evidence ?? '').includes('boom'),
      'evidence captures the error line',
    );
  });
});

test('clean-run reports a timeout when the start hangs', async () => {
  const dir = await makeProject(
    'hang',
    { name: 'hang-app', version: '1.0.0', scripts: { start: 'node app.js' }, dependencies: {} },
    { 'app.js': "setInterval(() => {}, 500);\nconsole.log('hanging…');\n" },
  );
  await withDir(dir, async () => {
    const check = await runSandbox(dir, { ...CFG, timeoutMs: 1_500 });
    assert.equal(check.status, 'fail');
    assert.ok(check.findings.some((f) => /timed out/i.test(f.msg_en)), 'reports a timeout');
  });
});

test('clean-run warns when package.json has no start script', async () => {
  const dir = await makeProject(
    'nostart',
    { name: 'nostart-app', version: '1.0.0', scripts: {}, dependencies: {} },
    {},
  );
  await withDir(dir, async () => {
    const check = await runSandbox(dir, { ...CFG, timeoutMs: 8_000 });
    assert.equal(check.status, 'warn');
    assert.ok(check.findings.some((f) => /no start script/i.test(f.msg_en)), 'warns about no start script');
  });
});

test('clean-run passes when the start script exits 0', async () => {
  const dir = await makeProject(
    'ok',
    { name: 'ok-app', version: '1.0.0', scripts: { start: 'node app.js' }, dependencies: {} },
    { 'app.js': "console.log('ok');\n" },
  );
  await withDir(dir, async () => {
    const check = await runSandbox(dir, { ...CFG, timeoutMs: 8_000 });
    assert.equal(check.status, 'pass');
    assert.ok(check.findings.some((f) => /succeeded/i.test(f.msg_en)), 'records a success');
  });
});
