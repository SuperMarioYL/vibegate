# Changelog

All notable changes to VibeGate are documented here. The format is loosely
based on [Keep a Changelog](https://keepachangelog.com/), and this project
adheres to [Semantic Versioning](https://semver.org/).

## [v0.5.0] - 2026-08-17

### Fixed

- **`fix-start-script-shell-metacharacters`** — the clean-env sandbox's
  node-runtime start-command runner (`src/run/sandbox.ts`) took the direct-`node`
  fast path whenever the start script began with `node `, then `.split(/\s+/)`d
  the remainder into argv and ran it WITHOUT a shell. So compound start scripts
  (`node seed.js && node server.js`) had `&&`/`||`/`;`/pipes/quotes become
  LITERAL argv to the first node script — `server.js` never ran, so a crash
  there was never observed (a false GREEN), or `seed.js` choked on the
  unexpected argv (a false RED). The sandbox thus executed a different command
  than `npm start` would. The runner now detects shell metacharacters
  (`&&`, `||`, `;`, `|`, `&`, `<`, `>`, `$`, backtick, quotes, `()`, `\`) and
  falls back to `npm start` (npm runs scripts through a shell) for compound
  scripts, while keeping the direct-`node` fast path (and its SIGTERM-reaches-
  the-real-process optimization) for metacharacter-free single-node scripts.
- **`fix-dead-fix-hints-remediation`** — the bilingual `FIX_HINTS` catalog
  (`src/report/i18n.ts`) — 14 "how to fix" strings keyed by codes like
  `no-readme`, `crash`, `install-failed` — was exported but NEVER consulted.
  The "Top fixes (how to fix)" / "首要修复建议（怎么修）" report section just
  re-listed the `✗` fail messages (already shown in the body) via
  `lang.finding(f)`, so a non-dev learned WHAT was broken but not HOW to fix it.
  Each `Finding` now carries a stable `code` stamped at emission time in
  readiness/license/sandbox (added to the `Finding` type + AJV schema), and
  `block()` looks up `FIX_HINTS[f.code][lang]` for the top-3 list (falling back
  to the fail message when no hint exists for that code), so the section emits
  the prepared bilingual how-to-fix instructions.

### Tests

- Added regression coverage in `tests/run.test.ts`: `startCommand` unit tests
  assert a plain `node app.js` keeps the direct-node fast path while compound /
  shell-y scripts (`&&`, `||`, `|`, `;`, quotes, `$`, backticks, redirects)
  fall back to `npm start`; a process-level test asserts a compound
  `node seed.js && node server.js` start script runs BOTH scripts through npm's
  shell so the crash in `server.js` is observed (no false GREEN).
- Added regression coverage in `tests/scan.test.ts`: a `no-readme` finding
  renders its `FIX_HINTS` bilingual hint (not the fail message) in the top-fixes
  section, plus an end-to-end test that the sloppy fixture stamps the `no-readme`
  code and renders the hint.

## [v0.4.0] - 2026-08-13

### Fixed

- **`fix-lgpl-misclassified-strong-copyleft`** — `isCopyleft` (`src/config.ts`)
  checked `COPYLEFT_STRONG` before `COPYLEFT_WEAK` using substring matching, and
  the bare `'gpl'` entry is a substring of `'lgpl'`, so every LGPL license
  matched STRONG first and returned `'strong'`. A project with an LGPL-licensed
  dependency therefore got a `severity:fail` "strong copyleft" finding — a
  false RED on the canonical happy path — when LGPL only requires attribution +
  license text (a warn). The WEAK list is now checked before STRONG (safe —
  AGPL/SSPL/GFDL/GPL ids match no weak pattern and still fall through to
  strong). `isCopyleft('LGPL-3.0')` now returns `'weak'`.
- **`fix-aws-40char-secret-false-positive`** — the bare 40-char AWS-secret
  pattern (`src/config.ts`) matched any standalone 40-char run of base64-ish
  chars; hex is a subset, so 40-hex git commit SHAs / sha1 hashes in source or
  comments were flagged `severity:fail` "hardcoded secret", turning the verdict
  RED on a healthy project that merely referenced a commit SHA. The pattern now
  excludes pure-40-hex runs (incl. uppercase-hex SHAs and 64-char sha256 runs)
  via a negative lookahead, while still detecting real AWS secrets (40-char
  mixed base64 that always contains a non-hex char). A 40-hex git SHA is no
  longer flagged as a secret.

### Tests

- Added `tests/config.test.ts` (run via `npm test`) with regression coverage
  for both fixes: LGPL-3.0 / LGPL-2.1 → weak and GPL-3.0 / AGPL-3.0 → strong;
  a 40-hex git SHA is not flagged while a real-ish AWS secret (mixed base64)
  still is.

## [v0.3.0] - 2026-08-10

### Fixed

- `fix-nodemodules-committed-false-positive` — distinguish `node_modules`
  present (gitignored) from genuinely tracked; the hard "committed" FAIL only
  fires when `node_modules` is tracked by git, otherwise a warn ("present —
  verify gitignored").
- `fix-secret-regex-case-sensitive` — the generic credential-assignment
  pattern is now compiled case-insensitively so uppercase / mixed-case keys
  (`API_KEY`, `PASSWORD`, `dbPassword`, `TOKEN`) are detected.
- `fix-console-log-in-tests-false-positive` — `SCAN_IGNORE` now excludes
  test / spec / example / `*.d.ts` globs so legitimate `console.log` in
  non-production files is no longer flagged as "left in a production path".

## [v0.2.0] - 2026-08-05

### Fixed

- `fix-sandbox-runtime-game-json` — `detectRuntimeForRun` now checks
  `game.json`, so a game.json-only WeChat mini-game is treated as a
  mini-program (sandbox skipped) consistently with the verdict's runtime
  classification.
- `fix-install-timeout-misreported` — an `npm install` timeout is reported as
  "dependency install timed out" rather than the generic "start timed out".

### Added

- Bilingual product landing site (`web/site.json`) published via GitHub Pages.

## [v0.1.0] - 2026-07-28

### Added

- `vibegate ./my-app` — one-command bilingual (zh + en) traffic-light verdict
  combining a clean-env sandbox run, production-readiness heuristics, and a
  license / copyright scan. Ships `vibegate@0.1.0` to npm.
