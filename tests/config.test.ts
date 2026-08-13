import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCopyleft, DEFAULT_CONFIG } from '../src/config.js';
import { compileSecretPatterns } from '../src/scan/readiness.js';

// fix-lgpl-misclassified-strong-copyleft: the bare 'gpl' entry in
// COPYLEFT_STRONG is a substring of 'lgpl', so LGPL licenses were misclassified
// as 'strong' (a false RED). They must classify as 'weak'; AGPL/GFDL/SSPL/GPL
// stay 'strong'.
test('isCopyleft: LGPL licenses are weak, not strong (fix-lgpl-misclassified-strong-copyleft)', () => {
  assert.equal(isCopyleft('LGPL-3.0'), 'weak', 'LGPL-3.0 must be weak');
  assert.equal(isCopyleft('LGPL-2.1'), 'weak', 'LGPL-2.1 must be weak');
  assert.equal(isCopyleft('LGPL-2.1-only'), 'weak', 'LGPL-2.1-only must be weak');
  assert.equal(isCopyleft('LGPL-3.0-or-later'), 'weak', 'LGPL-3.0-or-later must be weak');

  // strong copyleft must still classify as strong (regression guard for the
  // reordered check — weak patterns must not swallow AGPL/GFDL/SSPL/GPL).
  assert.equal(isCopyleft('GPL-3.0'), 'strong', 'GPL-3.0 must be strong');
  assert.equal(isCopyleft('GPL-2.0-only'), 'strong', 'GPL-2.0-only must be strong');
  assert.equal(isCopyleft('AGPL-3.0'), 'strong', 'AGPL-3.0 must be strong');
  assert.equal(isCopyleft('SSPL-1.0'), 'strong', 'SSPL-1.0 must be strong');
  assert.equal(isCopyleft('GFDL-1.3'), 'strong', 'GFDL-1.3 must be strong');

  // non-copyleft + empty input
  assert.equal(isCopyleft('MIT'), null, 'MIT is not copyleft');
  assert.equal(isCopyleft('Apache-2.0'), null, 'Apache-2.0 is not copyleft');
  assert.equal(isCopyleft('BSD-3-Clause'), null, 'BSD-3-Clause is not copyleft');
  assert.equal(isCopyleft(undefined), null, 'undefined license is null');
  assert.equal(isCopyleft(''), null, 'empty license is null');
});

// fix-aws-40char-secret-false-positive: the bare 40-char base64-ish AWS-secret
// pattern matched any standalone 40-char run, and hex is a subset, so 40-hex
// git commit SHAs / sha1 hashes were flagged severity:fail "hardcoded secret"
// (a false RED on healthy projects). A pure-hex run must NOT be flagged, while
// a real-ish AWS secret (40-char mixed base64 incl. +/) must still be caught.
test('AWS-secret pattern excludes 40-hex git SHAs but catches mixed base64 (fix-aws-40char-secret-false-positive)', () => {
  const patterns = compileSecretPatterns(DEFAULT_CONFIG);

  // a real 40-hex git commit SHA (sha1 of the empty tree) in various contexts —
  // none of the compiled secret patterns may flag it.
  const gitSha = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4';
  assert.equal(gitSha.length, 40, 'fixture is a 40-char SHA');
  for (const re of patterns) {
    re.lastIndex = 0;
    assert.equal(
      re.test(gitSha),
      false,
      `pattern must not match a bare 40-hex git SHA: ${re.source}`,
    );
  }
  // uppercase-hex sha1 form + sha256-length hex run are also not secrets
  const upperSha = 'E3B0C44298FC1C149AFBF4C8996FB92427AE41E4';
  const sha256 = '0'.repeat(64);
  for (const re of patterns) {
    re.lastIndex = 0;
    assert.equal(re.test(upperSha), false, '40-hex uppercase SHA is not a secret');
    re.lastIndex = 0;
    assert.equal(re.test(sha256), false, '64-hex sha256 is not a secret');
  }

  // a real-ish AWS secret (40 chars, mixed base64 incl. +/) — standalone and
  // assigned — must still be detected.
  const awsSecret = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
  assert.equal(awsSecret.length, 40, 'fixture is a 40-char AWS secret');
  const bareHit = patterns.some((re) => {
    re.lastIndex = 0;
    return re.test(awsSecret);
  });
  assert.ok(bareHit, 'a bare mixed-base64 AWS secret is still flagged');
  const assignedHit = patterns.some((re) => {
    re.lastIndex = 0;
    return re.test(`AWS_SECRET_ACCESS_KEY = "${awsSecret}";`);
  });
  assert.ok(assignedHit, 'an assigned AWS secret is still flagged');
});
