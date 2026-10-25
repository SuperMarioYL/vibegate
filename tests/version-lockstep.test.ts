/**
 * quality-version-lockstep-test (v0.9.0): no future bump can land half-done.
 * VERSION, package.json version and web/site.json meta.content_version must
 * all agree — version drift is the portfolio's most-repeated post-ship defect.
 * v0.10.0 extends the guard to the surface a user actually reads: the CLI's
 * `--version` output (readVersion in src/cli.ts, which has a hardcoded 0.1.0
 * fallback and resolves VERSION relative to its own module directory).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function norm(v: string): string {
  return v.trim().replace(/^v/, '');
}

const versionFile = norm(readFileSync(resolve(ROOT, 'VERSION'), 'utf8'));

test('package.json version matches VERSION', () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
    version: string;
  };
  assert.equal(norm(pkg.version), versionFile);
});

test('web/site.json content_version matches VERSION when the site exists', () => {
  const sitePath = resolve(ROOT, 'web', 'site.json');
  if (!existsSync(sitePath)) return; // site.json lands with the website commit
  const site = JSON.parse(readFileSync(sitePath, 'utf8')) as {
    meta?: { content_version?: string };
  };
  assert.equal(norm(site.meta?.content_version ?? ''), versionFile);
});

test('the CLI --version output matches VERSION', () => {
  // readVersion() prints what the user sees and silently falls back to a
  // hardcoded '0.1.0' when its VERSION lookup fails, so a layout/packaging
  // change could report a stale version while every file surface reads the
  // new one. Drive the real CLI (same tsx-subprocess pattern as
  // tests/exitcode.test.ts) so the printed version is pinned too.
  const r = spawnSync(
    process.execPath,
    ['--import', 'tsx', resolve(ROOT, 'src', 'cli.ts'), '--version'],
    { encoding: 'utf8', timeout: 60_000 },
  );
  assert.equal(r.status, 0, `--version exited ${r.status}\nstderr: ${r.stderr}`);
  assert.equal(norm(r.stdout), versionFile, `CLI --version printed ${r.stdout.trim()}`);
});
