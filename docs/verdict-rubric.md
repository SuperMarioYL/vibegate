# VibeGate Verdict Rubric

> The traffic-light verdict is the product. This doc is the single source of
> truth for how a project's three sub-checks roll up into one bilingual
> green/yellow/red verdict, so a non-dev can act on it without a developer in
> the room.

## 1. The three checks

| id | zh | en | what it does |
|---|---|---|---|
| `clean-run` | 干净环境实跑 | clean-env run | copy to a temp sandbox, fresh `npm install`, run the `start` script with a 30s timeout, capture any crash |
| `readiness` | 生产就绪体检 | readiness check | static heuristics: missing README, no lockfile, `node_modules` committed, missing `.gitignore`, hardcoded secrets, `console.log` in prod paths, no `license` field |
| `license` | 许可证 / 版权 | license / copyright | enumerate direct + transitive package licenses, flag GPL/AGPL copyleft, detect copy-pasted copyright headers |

## 2. Per-finding severity

| severity | glyph | meaning |
|---|---|---|
| `fail` | ✗ | blocks shipping — must fix before publish |
| `warn` | ⚠ | caution — fix strongly recommended, or attach attribution |
| `info` | · | informational, does not affect the verdict color |

## 3. Per-check status → rollup

```
check.status = fail  if any finding severity == fail
             = warn  if any finding severity == warn  (and no fail)
             = pass  otherwise
```

## 4. Overall verdict (traffic light)

| verdict | glyph | rule |
|---|---|---|
| red | ● | **any** check has status `fail` |
| yellow | ● | no `fail`, but **any** check has status `warn` |
| green | ● | all checks `pass` |

A green verdict is **best-effort, not legal advice** — it means VibeGate
found no obvious smell in 60 seconds; it does not certify the app is bug-free
or license-clean for all jurisdictions. Always read the findings.

## 5. What each color means for a non-dev

- **green** — locally ship-clean. Safe to run for friends / a demo. Paste the
  one-line attestation string into a 微信 / 小红书 product post.
- **yellow** — fix the warnings first. Most are 2-minute fixes (add a
  `.gitignore`, declare a `license`, drop `console.log`).
- **red** — do **not** ship as-is. The top-3 fixes print under the verdict;
  resolve them and re-run.

## 6. Copyleft license classification

| class | licenses | severity |
|---|---|---|
| strong copyleft | GPL, AGPL, GFDL, SSPL (incl. `-2.0`/`-3.0`/`-only`/`-or-later`) | **fail** — shipping requires open-sourcing the whole app |
| weak / file-level copyleft | LGPL, MPL, EPL, CDDL, EUPL | **warn** — keepable, ship attribution + license text |
| permissive | MIT, ISC, Apache-2.0, BSD, 0BSD | no finding |

A project can allowlist a known-accepted copyleft package via
`.vibegate.yml`:

```yaml
copyleftAllowlist:
  - somepkg   # we have a legal ok on this one
```

## 7. Non-goals (what VibeGate never claims)

- Not a CVE / vulnerability scanner — that's Snyk / FOSSA's lane.
- Not a substitute for legal review on a real distribution.
- Never auto-patches your code — it only flags.
