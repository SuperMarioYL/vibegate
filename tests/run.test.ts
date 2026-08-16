import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSandbox, startCommand } from '../src/run/sandbox.js';
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

test('clean-run treats a game.json-only project as mini-program and skips the run', async () => {
  // A WeChat mini-game ships only game.json. Without the game.json marker,
  // detectRuntimeForRun would fall through to 'node' and try to run a start
  // script that doesn't exist (a self-contradiction vs the verdict's
  // mini-program classification). With the marker it is skipped as a
  // mini-program, consistent with detectRuntime in verdict.ts.
  const dir = await makeProject(
    'game',
    { name: 'mini-game', version: '1.0.0', scripts: { start: 'node app.js' }, dependencies: {} },
    { 'game.json': JSON.stringify({ deviceOrientation: 'portrait' }, null, 2) + '\n' },
  );
  await withDir(dir, async () => {
    const check = await runSandbox(dir, { ...CFG, timeoutMs: 8_000 });
    assert.equal(check.status, 'warn');
    assert.ok(
      check.findings.some((f) => /mini-program runtime/i.test(f.msg_en)),
      'skips the run as a mini-program',
    );
  });
});

// ─── fix-start-script-shell-metacharacters regression coverage ───────────────

test('startCommand: a plain single-node script keeps the direct-node fast path', () => {
  // No shell metacharacters → the direct-node fast path is preserved so a
  // SIGTERM kill reaches the real process (not a wrapper). No regression.
  assert.deepEqual(startCommand('node', 'node app.js'), { cmd: 'node', args: ['app.js'] });
  assert.deepEqual(startCommand('node', 'node ./src/app.js --port=3000'), {
    cmd: 'node',
    args: ['./src/app.js', '--port=3000'],
  });
});

test('startCommand: a compound / shell-y start script falls back to npm start', () => {
  // Shell operators / quoting / expansion cannot be represented as a single
  // node argv — run the start script through npm's shell so the user's
  // package.json intent (&&, ||, ;, pipes, quotes, $VAR, backticks,
  // redirections) is honored instead of being passed as literal argv.
  const npmStart = { cmd: 'npm', args: ['start'] };
  assert.deepEqual(startCommand('node', 'node seed.js && node server.js'), npmStart, '&&');
  assert.deepEqual(startCommand('node', 'node a.js || node b.js'), npmStart, '||');
  assert.deepEqual(startCommand('node', 'node a.js | node b.js'), npmStart, 'pipe');
  assert.deepEqual(startCommand('node', 'node a.js; node b.js'), npmStart, ';');
  assert.deepEqual(startCommand('node', 'node "my app.js"'), npmStart, 'double quotes');
  assert.deepEqual(startCommand('node', "node 'app.js'"), npmStart, 'single quotes');
  assert.deepEqual(startCommand('node', 'node a.js > out.log'), npmStart, 'redirect');
  assert.deepEqual(startCommand('node', 'node a.js `echo b.js`'), npmStart, 'backtick');
  assert.deepEqual(startCommand('node', 'node $APP.js'), npmStart, '$ expansion');
  assert.deepEqual(startCommand('node', undefined), null, 'no start script → null');
  assert.deepEqual(startCommand('bun', 'node app.js'), { cmd: 'bun', args: ['run', 'start'] }, 'bun runtime');
});

test('clean-run runs a compound start script (&&) through the shell so both scripts run', async () => {
  // Regression for fix-start-script-shell-metacharacters. A compound start
  // script `node seed.js && node server.js` must run BOTH scripts through
  // npm's shell. The naive whitespace-split fast path would pass
  // ['seed.js','&&','node','server.js'] as LITERAL argv to `node seed.js`,
  // so seed.js would exit 0 (ignoring the junk argv) and server.js would
  // NEVER run — a false GREEN (its crash never observed). With the fix, npm
  // runs the compound script through a shell: seed.js runs (writes its
  // marker), then server.js runs (writes its marker) and crashes, so the
  // crash is observed and BOTH markers exist.
  const markerDir = await mkdtemp(join(tmpdir(), 'vibegate-compound-marker-'));
  const dir = await makeProject(
    'compound',
    {
      name: 'compound-app',
      version: '1.0.0',
      scripts: { start: 'node seed.js && node server.js' },
      dependencies: {},
    },
    {
      // each script writes a marker into MARKER_DIR (inherited via env) so we
      // can observe that BOTH ran; server.js then crashes.
      'seed.js': "require('fs').writeFileSync(process.env.VIBEGATE_MARKER_DIR + '/seed.marker', '1');\n",
      'server.js': "require('fs').writeFileSync(process.env.VIBEGATE_MARKER_DIR + '/server.marker', '1');\nthrow new Error('server-boom-COMPOUND-XYZ');\n",
    },
  );
  const prevMarker = process.env.VIBEGATE_MARKER_DIR;
  process.env.VIBEGATE_MARKER_DIR = markerDir;
  try {
    await withDir(dir, async () => {
      const check = await runSandbox(dir, { ...CFG, timeoutMs: 8_000 });
      assert.equal(check.status, 'fail', 'server.js crash is observed (no false GREEN from the split-argv bug)');
      assert.ok(check.findings.some((f) => /crashed/i.test(f.msg_en)), 'reports a crash');
      assert.ok(existsSync(join(markerDir, 'seed.marker')), 'seed.js ran (&& chain proceeded to server.js)');
      assert.ok(
        existsSync(join(markerDir, 'server.marker')),
        'server.js ran (compound script executed via npm shell, not split into literal argv)',
      );
    });
  } finally {
    if (prevMarker === undefined) delete process.env.VIBEGATE_MARKER_DIR;
    else process.env.VIBEGATE_MARKER_DIR = prevMarker;
    await rm(markerDir, { recursive: true, force: true });
  }
});
