/**
 * feature-exit-code-contract (v0.9.0): a RED verdict must exit non-zero so a
 * CI step can actually gate on vibegate. Contract: 0 = GREEN/YELLOW, 2 = RED,
 * 1 = operational error. Drives the real CLI via a tsx subprocess against
 * generated fixtures — no internal stubs, the exit code is the contract.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(
    process.execPath,
    ['--import', 'tsx', join(REPO, 'src', 'cli.ts'), ...args],
    { encoding: 'utf8', timeout: 60_000 },
  );
  // spawnSync's ReturnType types stdout/stderr as string | Buffer; with
  // encoding: 'utf8' they are strings — normalize once so assertions can take
  // them directly.
  return { status: r.status, stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? '') };
}

async function makeFixture(
  label: string,
  pkg: Record<string, unknown>,
  files: Record<string, string> = {},
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `vibegate-exit-${label}-`));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  for (const [path, content] of Object.entries(files)) {
    await writeFile(join(dir, path), content);
  }
  return dir;
}

test('RED verdict (fail findings) exits 2', async (t) => {
  const dir = await makeFixture(
    'red',
    { name: 'red-app', version: '0.0.1', private: true },
    // a hardcoded secret → fail-severity finding → RED
    { 'app.js': 'const TOKEN = "sk-abcdefghijklmnopqrstuvwxyz123456";\nconsole.log(TOKEN);\n' },
  );
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const r = runCli(['scan', dir, '--no-json']);
  assert.equal(r.status, 2, `expected exit 2, got ${r.status}\nstdout: ${r.stdout}`);
});

test('GREEN/YELLOW verdict exits 0', async (t) => {
  const dir = await makeFixture(
    'green',
    {
      name: 'green-app',
      version: '0.0.1',
      private: true,
      license: 'MIT',
      scripts: { start: 'node app.js' },
    },
    {
      'app.js': 'console.log("hi");\n',
      'README.md': 'green app\n',
      '.gitignore': 'node_modules/\n',
    },
  );
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const r = runCli(['scan', dir, '--no-json']);
  // console.log in a production path is only a warn → YELLOW, still exit 0
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}\nstdout: ${r.stdout}`);
});

test('nonexistent path still exits 1 (operational error)', () => {
  const r = runCli(['scan', join(tmpdir(), 'vibegate-definitely-missing-xyz'), '--no-json']);
  assert.equal(r.status, 1, `expected exit 1, got ${r.status}\nstdout: ${r.stdout}`);
});

// ─── fix-bare-invocation-exit-zero regression coverage ───────────────────────

test('bare invocation with no path exits 1 with usage on stderr (not a silent pass)', () => {
  // The bare command's action called program.help() (stdout + exit 0) when the
  // path was missing. Exit 0 is defined as "GREEN/YELLOW verdict", so
  // `vibegate` with no argument — and, realistically, `vibegate "$UNSET_VAR"`
  // in CI — reported success while checking nothing. It must now be a usage
  // error: usage text on stderr, exit 1.
  const r = runCli([]);
  assert.equal(r.status, 1, `expected exit 1, got ${r.status}\nstdout: ${r.stdout}`);
  assert.match(r.stderr, /Usage: vibegate/, 'usage text goes to stderr');
  assert.doesNotMatch(r.stdout, /Usage: vibegate/, 'stdout carries no usage/verdict text');
});

test('an empty path argument exits 1 (an unset CI path variable must not pass)', () => {
  const r = runCli(['']);
  assert.equal(r.status, 1, `expected exit 1, got ${r.status}\nstdout: ${r.stdout}`);
  assert.match(r.stderr, /Usage: vibegate/, 'usage text goes to stderr');
});

// ─── fix-docs-stale-exit-contract regression coverage ────────────────────────

test('no doc surface still claims a RED verdict does not set a failing exit', () => {
  // v0.9.0 shipped the exit-code contract but left the "Limits" bullets in both
  // READMEs and the live site asserting the retracted claim, so the same
  // README said both "2 = red" and "red does not exit non-zero". This guards
  // the published copy against the stale claim coming back.
  const retracted = [
    '不会让 CLI 非零退出',
    'do not currently set a failing CLI exit',
    'not set a failing CLI exit',
  ];
  for (const rel of ['README.md', 'README.en.md', 'web/site.json']) {
    const text = readFileSync(join(REPO, rel), 'utf8');
    for (const phrase of retracted) {
      assert.ok(!text.includes(phrase), `${rel} must not re-state the retracted claim: ${phrase}`);
    }
    // each surface must state the shipped contract instead: RED → exit 2
    assert.match(text, /2/, `${rel} states the red exit code`);
  }
});
