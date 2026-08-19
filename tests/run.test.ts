import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm, chmod } from 'node:fs/promises';
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

// Counts vibegate-<uuid> sandbox temp dirs in os.tmpdir(). The sandbox uses
// `vibegate-${randomUUID()}` (a UUID shape); test-fixture mkdtemp dirs use
// distinct prefixes (vibegate-test-, vibegate-nm-, …), so a UUID-shape filter
// isolates real sandbox dirs only. Used to assert no temp dir leaks on a
// copy failure (fix-sandbox-copy-fail-leak-misreport).
function countSandboxTempDirs(): number {
  try {
    return readdirSync(tmpdir()).filter((e) =>
      /^vibegate-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/.test(e),
    ).length;
  } catch {
    return 0;
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
  //
  // fix-clean-env-inherits-parent-env: the sandbox child no longer inherits
  // the parent shell env, so the marker dir is baked into each script's
  // source as an absolute path rather than passed via an inherited env var.
  const markerDir = await mkdtemp(join(tmpdir(), 'vibegate-compound-marker-'));
  const seedMarker = join(markerDir, 'seed.marker');
  const serverMarker = join(markerDir, 'server.marker');
  const dir = await makeProject(
    'compound',
    {
      name: 'compound-app',
      version: '1.0.0',
      scripts: { start: 'node seed.js && node server.js' },
      dependencies: {},
    },
    {
      // each script writes a marker to an absolute path baked into its source
      // (the clean-env child no longer inherits parent env vars), so we can
      // observe that BOTH ran; server.js then crashes.
      'seed.js': `require('fs').writeFileSync(${JSON.stringify(seedMarker)}, '1');\n`,
      'server.js': `require('fs').writeFileSync(${JSON.stringify(serverMarker)}, '1');\nthrow new Error('server-boom-COMPOUND-XYZ');\n`,
    },
  );
  try {
    await withDir(dir, async () => {
      const check = await runSandbox(dir, { ...CFG, timeoutMs: 8_000 });
      assert.equal(check.status, 'fail', 'server.js crash is observed (no false GREEN from the split-argv bug)');
      assert.ok(check.findings.some((f) => /crashed/i.test(f.msg_en)), 'reports a crash');
      assert.ok(existsSync(seedMarker), 'seed.js ran (&& chain proceeded to server.js)');
      assert.ok(
        existsSync(serverMarker),
        'server.js ran (compound script executed via npm shell, not split into literal argv)',
      );
    });
  } finally {
    await rm(markerDir, { recursive: true, force: true });
  }
});

// ─── v0.6.0 clean-env sandbox correctness regression coverage ────────────────

test('clean-env does NOT inherit the parent shell env — a missing-config crash surfaces as RED even when the dev has the token (fix-clean-env-inherits-parent-env)', async () => {
  // Regression: runChild used to spawn the sandbox child with
  // `env: { ...process.env, ... }`, so a dev who has MY_CONFIG_TOKEN set in
  // their shell (they do — it's how they run the app) leaked it into the
  // "clean env", the app exited 0, and runSandbox emitted an info pass → a
  // false GREEN on exactly the missing-env crash the clean-env run exists to
  // catch. Now the child gets a sanitized minimal env (PATH/HOME + Windows
  // essentials only), so the app's missing-token crash surfaces as a fail.
  // Set the token in the PARENT env to prove the child does NOT inherit it.
  const dir = await makeProject(
    'missingenv',
    { name: 'missingenv-app', version: '1.0.0', scripts: { start: 'node app.js' }, dependencies: {} },
    {
      'app.js':
        "const t = process.env.MY_CONFIG_TOKEN;\n" +
        "if (!t) { console.error('MY_CONFIG_TOKEN env var is required'); process.exit(1); }\n" +
        "console.log('have token');\n",
    },
  );
  const prev = process.env.MY_CONFIG_TOKEN;
  process.env.MY_CONFIG_TOKEN = 'dev-shell-has-this-token';
  try {
    await withDir(dir, async () => {
      const check = await runSandbox(dir, { ...CFG, timeoutMs: 8_000 });
      assert.equal(
        check.status,
        'fail',
        'clean env must NOT see the parent MY_CONFIG_TOKEN → the missing-token crash surfaces as RED',
      );
      const crash = check.findings.find((f) => f.code === 'crash' || /crashed/i.test(f.msg_en));
      assert.ok(crash, 'reports a crash finding (the app exited non-zero on the missing token)');
    });
  } finally {
    if (prev === undefined) delete process.env.MY_CONFIG_TOKEN;
    else process.env.MY_CONFIG_TOKEN = prev;
  }
});

test('clean-run reclaims the temp sandbox on a copy failure and reports copy-fail, not crash (fix-sandbox-copy-fail-leak-misreport)', async () => {
  // Regression: copyProject's catch used to return emptyResult WITHOUT calling
  // cleanup(sandboxDir) — the only branch that skipped cleanup — so a
  // vibegate-* temp dir leaked in os.tmpdir() per failed-copy run; AND because
  // emptyResult carried no distinguishing flag, runSandbox reported it as
  // code:'crash' "start crashed in the clean env (exit null)" — wrong layer
  // (copy failed, start never ran). Now the catch cleans up the temp dir and
  // stamps copyFailed so runSandbox emits a dedicated copy-phase finding.
  const dir = await makeProject(
    'copyfail',
    { name: 'copyfail-app', version: '1.0.0', scripts: { start: 'node app.js' }, dependencies: {} },
    { 'app.js': "console.log('ok');\n" },
  );
  // An unreadable subdir forces cp(recursive) to throw EACCES mid-copy (cp has
  // already mkdir'd the sandboxDir before it tries to read this subdir).
  const unreadable = join(dir, '.cache');
  await mkdir(unreadable, { recursive: true });
  await writeFile(join(unreadable, 'inner.txt'), 'x');
  await chmod(unreadable, 0o000);

  const before = countSandboxTempDirs();
  try {
    const check = await runSandbox(dir, { ...CFG, timeoutMs: 8_000 });
    assert.equal(check.status, 'fail');
    const copyFail = check.findings.find(
      (f) => f.code === 'sandbox-copy-failed' || /sandbox copy failed/i.test(f.msg_en),
    );
    assert.ok(copyFail, 'reports a sandbox-copy failure (not "start crashed")');
    assert.ok(
      !check.findings.some((f) => f.code === 'crash'),
      'does NOT misreport the copy failure as a start crash',
    );
    // The leaked temp dir is reclaimed: no net new vibegate-* sandbox dir.
    const after = countSandboxTempDirs();
    assert.equal(after, before, 'temp sandbox dir is cleaned up on copy failure (no leak)');
  } finally {
    // restore perms so the source fixture can be removed cleanly
    await chmod(unreadable, 0o755).catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});

test('clean-run masks a secret embedded in a thrown error so it does not leak into evidence (fix-sandbox-stderr-secret-leak)', async () => {
  // Regression: the crash/install/timeout findings put res.stderrTail VERBATIM
  // into finding.evidence, with no masking (unlike scanSecrets). writeReport
  // then JSON.stringifies it raw into vibegate-report.json, so a sloppy app
  // that throws `new Error('...=' + secret)` leaked the secret UNMASKED into
  // a committed/shareable file. The stderr tail is now masked (maskSecrets,
  // the same transform readiness uses) before entering evidence. Here the
  // secret is hardcoded in source (not parent env — which the env-inheritance
  // fix already blocks), so it still reaches the thrown error and must be
  // masked at the evidence layer.
  const secret = 'supersecretDBpasswordS3CR3Tvalue99';
  const dir = await makeProject(
    'secretleak',
    { name: 'secretleak-app', version: '1.0.0', scripts: { start: 'node app.js' }, dependencies: {} },
    {
      'app.js': `const P = '${secret}';\nthrow new Error('db connect failed: password=' + P);\n`,
    },
  );
  await withDir(dir, async () => {
    const check = await runSandbox(dir, { ...CFG, timeoutMs: 8_000 });
    assert.equal(check.status, 'fail');
    const crash = check.findings.find((f) => f.code === 'crash');
    assert.ok(crash, 'reports a crash finding');
    const evidence = crash?.evidence ?? '';
    // the raw secret must NOT appear verbatim in evidence (and thus not in
    // vibegate-report.json, which writeReport serializes evidence verbatim)
    assert.ok(
      !evidence.includes(secret),
      'the embedded secret is masked in evidence, not leaked verbatim',
    );
    // masking redacted the secret run (the '…' ellipsis is maskSecrets' mark)
    assert.ok(evidence.includes('…'), 'evidence shows the masking redaction');
  });
});
