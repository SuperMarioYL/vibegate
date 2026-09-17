/**
 * quality-version-lockstep-test (v0.9.0): no future bump can land half-done.
 * VERSION, package.json version and web/site.json meta.content_version must
 * all agree — version drift is the portfolio's most-repeated post-ship defect.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
