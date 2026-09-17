/**
 * feature-exit-code-contract (v0.9.0): a RED verdict must exit non-zero so a
 * CI step can actually gate on vibegate. Contract: 0 = GREEN/YELLOW, 2 = RED,
 * 1 = operational error. Drives the real CLI via a tsx subprocess against
 * generated fixtures — no internal stubs, the exit code is the contract.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function runCli(args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync(
    process.execPath,
    ['--import', 'tsx', join(REPO, 'src', 'cli.ts'), ...args],
    { encoding: 'utf8', timeout: 60_000 },
  );
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
