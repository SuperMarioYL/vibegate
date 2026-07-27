import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { scanReadiness } from '../src/scan/readiness.js';
import { scanLicense } from '../src/scan/license.js';
import { buildVerdict, detectProject, assertValid } from '../src/report/verdict.js';
import { DEFAULT_CONFIG } from '../src/config.js';

const FIXTURE = fileURLToPath(new URL('../examples/sloppy-mini-program/', import.meta.url));

test('readiness flags the obvious smells on the sloppy fixture', async () => {
  const check = await scanReadiness(FIXTURE, DEFAULT_CONFIG);
  assert.equal(check.id, 'readiness');
  assert.equal(check.status, 'fail', 'readiness must be a fail for the sloppy fixture');

  const en = check.findings.map((f) => f.msg_en);
  assert.ok(en.some((m) => /no README/i.test(m)), 'flags missing README');
  assert.ok(en.some((m) => /node_modules.*committed/i.test(m)), 'flags committed node_modules');
  assert.ok(en.some((m) => /no lockfile/i.test(m)), 'flags missing lockfile');
  assert.ok(en.some((m) => /no \.gitignore/i.test(m)), 'flags missing .gitignore');
  assert.ok(en.some((m) => /no license field/i.test(m)), 'flags missing license field');
  assert.ok(check.findings.some((f) => /hardcoded secret/i.test(f.msg_en)), 'flags hardcoded secrets');
  assert.ok(check.findings.some((f) => /console\.log/i.test(f.msg_en)), 'flags console.log in prod');
  // a vibe-coded app would never have just one secret
  assert.ok(
    check.findings.filter((f) => /hardcoded secret/i.test(f.msg_en)).length >= 2,
    'finds more than one secret',
  );
});

test('every readiness finding is bilingual (zh + en)', async () => {
  const check = await scanReadiness(FIXTURE, DEFAULT_CONFIG);
  assert.ok(check.findings.length >= 5);
  for (const f of check.findings) {
    assert.ok(f.msg_zh.length > 0, 'zh message present');
    assert.ok(f.msg_en.length > 0, 'en message present');
  }
});

test('license scan flags the GPL dependency and the copy-pasted copyright header', async () => {
  const check = await scanLicense(FIXTURE, DEFAULT_CONFIG);
  assert.equal(check.id, 'license');
  assert.equal(check.status, 'fail', 'license must be a fail for the sloppy fixture');

  const copyleft = check.findings.find(
    (f) => /somepkg/.test(f.evidence ?? '') && /copyleft/i.test(f.msg_en),
  );
  assert.ok(copyleft, 'flags the GPL-licensed somepkg dep');

  const header = check.findings.find((f) => /copy-pasted|copyright header/i.test(f.msg_en));
  assert.ok(header, 'flags the copy-pasted GPL copyright header');
});

test('detectProject classifies the fixture as a node runtime', async () => {
  const project = await detectProject(FIXTURE);
  assert.equal(project.runtime, 'node');
  assert.ok(project.path.replace(/\/$/, '').endsWith('sloppy-mini-program'));
});

test('aggregate verdict is red and the VerdictReport validates against the schema', async () => {
  const project = await detectProject(FIXTURE);
  const checks = [
    await scanReadiness(FIXTURE, DEFAULT_CONFIG),
    await scanLicense(FIXTURE, DEFAULT_CONFIG),
  ];
  const report = buildVerdict(project, checks);

  assert.equal(report.verdict, 'red');
  assert.equal(report.checks.length, 2);
  assert.ok(report.generated_at, 'generated_at is set');
  assert.doesNotThrow(() => assertValid(report), 'report must pass the schema');
});
