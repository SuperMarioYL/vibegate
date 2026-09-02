import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { scanReadiness } from '../src/scan/readiness.js';
import { scanLicense } from '../src/scan/license.js';
import { buildVerdict, detectProject, assertValid } from '../src/report/verdict.js';
import { formatVerdict } from '../src/report/i18n.js';
import { DEFAULT_CONFIG, type VerdictReport } from '../src/config.js';

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
  // console.log in a test file (tests/sample.test.ts) must NOT be flagged —
  // regression guard for the SCAN_IGNORE test/spec glob exclusion.
  assert.ok(
    !check.findings.some(
      (f) => /console\.log/i.test(f.msg_en) && /sample\.test/i.test(f.evidence ?? ''),
    ),
    'does NOT flag console.log in a test file',
  );
  // a vibe-coded app would never have just one secret. >= 3 requires the
  // case-insensitive regex (dbPassword + API_KEY are only detectable with the
  // `i` flag on the generic credential-assignment pattern — regression guard).
  assert.ok(
    check.findings.filter((f) => /hardcoded secret/i.test(f.msg_en)).length >= 3,
    'finds more than two secrets (incl. uppercase/mixed-case keys via case-insensitive regex)',
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

test('license scan flags a legacy `licenses` array-of-objects GPL dep (not a false GREEN)', async () => {
  // copyleft-missed-legacy-licenses-format: the legacy npm `licenses` field is
  // an array of objects like [{type:"GPL-3.0-only",url:"..."}]. normalizeLicense
  // previously filtered out every object and returned "", so isCopyleft("") was
  // null and a strong-copyleft devDependency sailed through as a false GREEN.
  // The direct node_modules pass must still surface a strong-copyleft finding.
  const dir = await makeGitProject('legacygpl', {
    'package.json': JSON.stringify(
      { name: 'legacy-app', version: '1.0.0', license: 'MIT', dependencies: { legacygpl: '^1.0.0' } },
      null,
      2,
    ),
    'README.md': '# legacy\n',
    'node_modules/legacygpl/package.json': JSON.stringify(
      {
        name: 'legacygpl',
        version: '1.0.0',
        licenses: [{ type: 'GPL-3.0-only', url: 'http://choosealicense.com/licenses/gpl-3.0/' }],
      },
      null,
      2,
    ),
  });
  try {
    const check = await scanLicense(dir, DEFAULT_CONFIG);
    assert.equal(check.id, 'license');
    assert.equal(check.status, 'fail', 'legacy licenses[] GPL-3.0-only dep must fail, not a false GREEN');
    const copyleft = check.findings.find(
      (f) => /legacygpl/.test(f.evidence ?? '') && f.code === 'copyleft-dep-strong',
    );
    assert.ok(copyleft, 'flags the legacy licenses[] GPL-3.0-only dep as strong copyleft');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('license scan flags a legacy `license` single-object GPL devDep (not a false GREEN)', async () => {
  // fix-license-singular-object-format: the legacy npm `license` (singular)
  // field can be a single object like {type:"GPL-3.0",url:"..."}. The v0.7.0
  // fix handled the `licenses` (plural) array-of-objects form but this
  // singular-object form fell through to `return undefined` in normalizeLicense,
  // so isCopyleft(undefined) returned null and a strong-copyleft dep sailed
  // through as a false GREEN. The bug is only observable for a devDependency:
  // scanWithLicenseChecker runs with production:true, so it skips devDeps and
  // the license-checker enrichment (which normalizes legacy forms to strings)
  // never sees it — the direct node_modules pass is the only one that could
  // catch it, and on v0.7.0 it returned undefined for the object form.
  const dir = await makeGitProject('singulargpl', {
    'package.json': JSON.stringify(
      { name: 'singular-app', version: '1.0.0', license: 'MIT', devDependencies: { singulargpl: '^1.0.0' } },
      null,
      2,
    ),
    'README.md': '# singular\n',
    'node_modules/singulargpl/package.json': JSON.stringify(
      {
        name: 'singulargpl',
        version: '1.0.0',
        license: { type: 'GPL-3.0', url: 'http://choosealicense.com/licenses/gpl-3.0/' },
      },
      null,
      2,
    ),
  });
  try {
    const check = await scanLicense(dir, DEFAULT_CONFIG);
    assert.equal(check.id, 'license');
    assert.equal(check.status, 'fail', 'legacy license{} GPL-3.0 devDep must fail, not a false GREEN');
    const copyleft = check.findings.find(
      (f) => /singulargpl/.test(f.evidence ?? '') && f.code === 'copyleft-dep-strong',
    );
    assert.ok(copyleft, 'flags the legacy license{} GPL-3.0 devDep as strong copyleft');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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

async function makeGitProject(label: string, files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `vibegate-nm-${label}-`));
  await mkdir(dir, { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    const sub = join(dir, path);
    await mkdir(join(sub, '..'), { recursive: true });
    await writeFile(sub, content);
  }
  execSync('git init -q', { cwd: dir });
  execSync('git add -A', { cwd: dir });
  execSync('git -c user.name=test -c user.email=test@test -c commit.gpgsign=false commit -q -m init', { cwd: dir });
  return dir;
}

test('node_modules present but gitignored warns (not a false "committed" fail)', async () => {
  // A developer's healthy project: node_modules exists locally but is
  // gitignored + untracked. The readiness check must WARN ("present — verify
  // gitignored"), NOT emit a false "committed" FAIL on the canonical happy path.
  const dir = await makeGitProject('ignored', {
    'package.json': JSON.stringify({ name: 'clean-app', version: '1.0.0', license: 'MIT' }, null, 2),
    'README.md': '# clean app\n',
    '.gitignore': 'node_modules/\n',
    'node_modules/.keep': '',
  });
  try {
    const check = await scanReadiness(dir, DEFAULT_CONFIG);
    const nm = check.findings.find((f) => /node_modules/i.test(f.msg_en));
    assert.ok(nm, 'emits a node_modules finding');
    assert.equal(nm?.severity, 'warn', 'present node_modules is a warn, not a fail');
    assert.match(nm!.msg_en, /is present/i, 'message says "present", not "committed"');
    assert.doesNotMatch(nm!.msg_en, /is committed/i, 'does not falsely claim committed');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('node_modules genuinely tracked fails as committed', async () => {
  // A genuinely sloppy project: node_modules is tracked by git. The readiness
  // check must still FAIL "committed" (the hard path is preserved).
  const dir = await makeGitProject('tracked', {
    'package.json': JSON.stringify({ name: 'sloppy-app', version: '1.0.0' }, null, 2),
    'README.md': '# sloppy\n',
    'node_modules/somepkg/package.json': JSON.stringify({ name: 'somepkg', version: '1.0.0' }),
  });
  try {
    const check = await scanReadiness(dir, DEFAULT_CONFIG);
    const nm = check.findings.find((f) => /node_modules/i.test(f.msg_en));
    assert.ok(nm, 'emits a node_modules finding');
    assert.equal(nm?.severity, 'fail', 'tracked node_modules fails');
    assert.match(nm!.msg_en, /committed/i, 'message says "committed"');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ─── fix-dead-fix-hints-remediation regression coverage ───────────────────────

test('Top fixes section emits FIX_HINTS bilingual how-to-fix hints, not the fail messages', () => {
  // fix-dead-fix-hints-remediation: the "首要修复建议（怎么修）" /
  // "Top fixes (how to fix)" section must emit the prepared bilingual
  // FIX_HINTS['no-readme'] hint, NOT just re-list the ✗ fail message (which
  // already appears in the body above). The hint strings exist ONLY in
  // FIX_HINTS, so their presence proves the catalog is consulted; the
  // distinctive fail-message stub text must NOT leak into the top-fixes
  // section (proving it is not a duplicate of the fail message).
  const report: VerdictReport = {
    project: { path: '/tmp/vibegate-fix-hints-demo', runtime: 'node' },
    checks: [
      {
        id: 'readiness',
        status: 'fail',
        findings: [
          {
            severity: 'fail',
            code: 'no-readme',
            msg_zh: '缺少 README（测试桩 — 仅供参考）',
            msg_en: 'no README (test stub — for assertion only)',
          },
        ],
      },
    ],
    verdict: 'red',
    generated_at: '2026-08-17T00:00:00.000Z',
  };
  // schema-validates with the new optional `code` property on Finding
  assert.doesNotThrow(() => assertValid(report));

  const out = formatVerdict(report);
  // both top-fixes headers render (verdict is red)
  assert.ok(out.includes('首要修复建议（怎么修）'), 'zh top-fixes header present');
  assert.ok(out.includes('Top fixes (how to fix)'), 'en top-fixes header present');
  // the prepared bilingual hints (these strings exist ONLY in FIX_HINTS)
  assert.ok(out.includes('新增一个 README.md'), 'zh no-readme hint rendered');
  assert.ok(out.includes('add a README.md'), 'en no-readme hint rendered');
  // the fail message is NOT duplicated into the top-fixes section: everything
  // after each header must be the hint, not the fail-message stub text
  const zhAfter = out.split('首要修复建议（怎么修）')[1] ?? '';
  const enAfter = out.split('Top fixes (how to fix)')[1] ?? '';
  assert.ok(!zhAfter.includes('测试桩'), 'zh top-fixes line is the hint, not the fail message');
  assert.ok(!enAfter.includes('test stub'), 'en top-fixes line is the hint, not the fail message');
});

test('end-to-end: the sloppy fixture renders FIX_HINTS hints in the top-fixes section', async () => {
  // Proves the wiring works end-to-end: readiness stamps `code: 'no-readme'`
  // on the missing-README finding, buildVerdict produces a red report, and
  // formatVerdict renders the prepared bilingual hint (not the fail message)
  // in the "首要修复建议（怎么修）" section.
  const project = await detectProject(FIXTURE);
  const checks = [
    await scanReadiness(FIXTURE, DEFAULT_CONFIG),
    await scanLicense(FIXTURE, DEFAULT_CONFIG),
  ];
  const report = buildVerdict(project, checks);
  assert.equal(report.verdict, 'red');

  // the missing-README finding carries the no-readme code (stamped at emission)
  const noReadme = report.checks
    .flatMap((c) => c.findings)
    .find((f) => /no README/i.test(f.msg_en));
  assert.ok(noReadme, 'fixture has a no-README finding');
  assert.equal(noReadme?.code, 'no-readme', 'no-README finding carries the no-readme code');

  const out = formatVerdict(report);
  assert.ok(out.includes('首要修复建议（怎么修）'), 'zh top-fixes header present');
  assert.ok(out.includes('新增一个 README.md'), 'zh no-readme hint rendered end-to-end');
});
