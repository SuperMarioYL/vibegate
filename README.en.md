<div align="right"><sub><b>English</b>&nbsp;&nbsp;⇄&nbsp;&nbsp;<a href="./README.md">简体中文</a></sub></div>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./assets/hero-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="./assets/hero-light.svg">
  <img src="./assets/hero-light.svg" width="880" alt="VibeGate hero">
</picture>

<p align="center"><sub>VibeGate is the local readiness gate that green-lights vibe-coded apps for non-dev shippers.</sub></p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="license"></a>
  <img src="https://img.shields.io/github/v/release/SuperMarioYL/vibegate" alt="release">
  <img src="https://img.shields.io/github/actions/workflow/status/SuperMarioYL/vibegate/ci.yml?branch=main&label=CI" alt="CI">
  <img src="https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white" alt="node">
  <img src="https://img.shields.io/badge/vibe--coding-ready-5E5CE6" alt="vibe-coding">
  <img src="https://img.shields.io/badge/ship--readiness-10A37F" alt="ship-readiness">
</p>

**One command gives any vibe-coded app a local health check — does it run in a clean env, is it production-ready, is the license/copyright clean — a bilingual red/yellow/green verdict in one line. No account, no dev or legal background required.**

<h2><img src="https://api.iconify.design/tabler:topology-star-3.svg?color=%230071E3&width=24" height="22" align="absmiddle" alt=""> Architecture</h2>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./assets/atlas-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="./assets/atlas-light.svg">
  <img src="./assets/atlas-light.svg" width="880" alt="architecture: project → VibeGate three checks → bilingual verdict">
</picture>

A single process, a single npx package. Three pure modules feed one reporter: **readiness** (static heuristics over files), **license** (license enumeration + copyleft classification + copyright-header sniffing), and **clean-run** (a temp sandbox with a fresh install and a 30s-timeout child process). They roll up into one bilingual `VerdictReport` — both a terminal red/yellow/green verdict and a machine-readable `vibegate-report.json`. No Docker, no daemon, no cloud — non-devs don't have those.

## Contents

- [Why this exists](#why-this-exists)
- [Install & Quickstart](#install--quickstart)
- [Usage](#usage)
- [Demo](#demo)
- [Configuration](#configuration)
- [Pricing](#pricing)
- [Roadmap](#roadmap)
- [License](#license)

<h2 id="why-this-exists"><img src="https://api.iconify.design/tabler:bulb.svg?color=%230071E3&width=24" height="22" align="absmiddle" alt=""> Why this exists</h2>

A non-dev asks an AI model (Doubao / Yuanbao / DeepSeek / Tongyi / Gemini) to build an app, and gets a folder that *looks* finished — but the user cannot answer three questions about it: **does it run in a clean environment, is it production-ready, and is the license/copyright clean?** Each question is a separate expertise gauntlet (ops, release engineering, legal), and the vibe-coder has none of them. It's not laziness — it's a gauntlet: multi-tool, multi-discipline, and it presupposes exactly the expertise the user lacks.

And the consequence isn't theoretical: Codeberg is already banning vibe-coded projects, citing license ambiguity. Once a platform removes your work, "is the license clean" stops being optional. VibeGate compresses that gauntlet into one local command that emits a bilingual red/yellow/green verdict — readable without a developer in the room.

> **Not another scanner.** license-checker emits a license list, npm audit emits CVEs, `node .` emits a crash stack — each emits a raw list, none emits a verdict. The verdict IS the product; scanners are just inputs.

| Axis | Manual stack (license-checker + npm audit + node .) | VibeGate |
|---|---|---|
| One command → verdict | — | ✓ |
| Non-dev readable | — | ✓ bilingual traffic-light |
| Clean-env run | partial (you build the sandbox) | ✓ temp sandbox + 30s timeout |
| License / copyright | partial (must read SPDX) | ✓ auto copyleft grading |
| Enterprise-grade audit | ✓ (FOSSA / Snyk are stronger) | — (just a 60s yes/no) |

<h2 id="install--quickstart"><img src="https://api.iconify.design/tabler:rocket.svg?color=%230071E3&width=24" height="22" align="absmiddle" alt=""> Install & Quickstart</h2>

Once published, end users run one command (no account, no dev background):

```bash
npx vibegate@latest ./my-app
```

Right now (before the v0.1.0 release) you can see the verdict in 3 commands from source:

```bash
git clone https://github.com/SuperMarioYL/vibegate && cd vibegate
npm install && npm test
npx tsx src/cli.ts ./examples/sloppy-mini-program
```

<details>
<summary>Sample output (sloppy-mini-program → RED)</summary>

```
════════════════════════════════════════════════════════
  VibeGate local readiness verdict  examples/sloppy-mini-program
════════════════════════════════════════════════════════
  ● RED · do not ship as-is
  ✗ Readiness check
      ✗ no README (a non-dev cannot tell what this is or how to run it)
      ⚠ no lockfile (deps are unpinned — clean env may install differently)
      ✗ node_modules/ is committed (huge, and likely to leak local secrets)
      ⚠ no .gitignore (node_modules/ and secret files are easily committed)
      ⚠ package.json has no license field declared
      ✗ hardcoded secret / credential  (app.js:20  AKID…34)
      ⚠ console.log left in a production path  (app.js:24)
  ✗ License / copyright
      ⚠ source carries a third-party copyright header  (app.js:5)
      ✗ dep somepkg@1.0.0 is GPL-3.0-only (strong copyleft)
  ✗ Clean-env run
      ✗ start crashed in the clean env  (exit 1 — MY_CONFIG_TOKEN env var is required)
════════════════════════════════════════════════════════
  Top fixes (how to fix)
   1. ✗ no README
   2. ✗ node_modules/ is committed
   3. ✗ hardcoded secret / credential
════════════════════════════════════════════════════════
─ VibeGate 本地体检结果 ─  (zh block above)
```

</details>

<h2 id="usage"><img src="https://api.iconify.design/tabler:terminal-2.svg?color=%230071E3&width=24" height="22" align="absmiddle" alt=""> Usage</h2>

```bash
vibegate scan ./my-app            # static check only: readiness + license/copyright
vibegate run  ./my-app            # clean-env run only
vibegate      ./my-app            # one command: scan + run (the experience path)
vibegate run  ./my-app -t 10000   # 10s timeout
vibegate scan ./my-app --no-json  # do not write vibegate-report.json
```

The verdict is always bilingual (zh primary + en sibling block) printed to stdout, and by default writes a machine-readable `vibegate-report.json` (the future hosted badge just re-renders that JSON). See [docs/verdict-rubric.md](./docs/verdict-rubric.md) for the rubric.

Drop a `.vibegate.yml` at the repo root to override defaults; try the two sample projects `examples/sloppy-mini-program/` and `examples/demo-app/`.

<h2 id="demo"><img src="https://api.iconify.design/tabler:photo.svg?color=%230071E3&width=24" height="22" align="absmiddle" alt=""> Demo</h2>

![demo](assets/demo.gif)

The tape is at [docs/demo.tape](./docs/demo.tape) (vhs drives the real binary; CI re-renders it to `assets/demo.gif`).

<h2 id="configuration"><img src="https://api.iconify.design/tabler:adjustments.svg?color=%230071E3&width=24" height="22" align="absmiddle" alt=""> Configuration</h2>

Optional `.vibegate.yml` at the project root:

| key | type | default | meaning |
|---|---|---|---|
| `timeoutMs` | number | `30000` | clean-env run timeout in ms |
| `copyleftAllowlist` | string[] | `[]` | copyleft package names already accepted (skip by name) |
| `extraSecretPatterns` | string[] | `[]` | extra secret regexes layered on the built-ins |
| `writeReport` | boolean | `true` | whether to write `vibegate-report.json` |

```yaml
# .vibegate.yml
timeoutMs: 20000
copyleftAllowlist:
  - somepkg   # legal already signed off
```

<h2 id="pricing"><img src="https://api.iconify.design/tabler:currency-yen.svg?color=%230071E3&width=24" height="22" align="absmiddle" alt=""> Pricing</h2>

**Hosted verdict badge: ¥29 / report** (or ¥99 / mo unlimited). It re-renders the locally-produced `vibegate-report.json` into a pasteable SVG badge + a private shareable link `vibegate.app/r/<id>`, giving indie founders posting on Xiaohongshu / WeChat a trust signal that's verifiable — a badge beats a screenshot they could fake. The local CLI already emits that JSON; the hosted service only re-renders it. This is real, not vaporware.

The local CLI stays free forever and MIT-licensed — trust is built first, then ¥29 turns trust into a shareable badge. v0.1 focuses on open-source trust; the hosted badge is the v0.2 paid feature (see roadmap).

<h2 id="roadmap"><img src="https://api.iconify.design/tabler:map-2.svg?color=%230071E3&width=24" height="22" align="absmiddle" alt=""> Roadmap</h2>

- [x] Static check: readiness heuristics + license/copyright scan + bilingual traffic-light verdict
- [x] Clean-env run: temp sandbox + fresh install + 30s-timeout crash capture
- [x] One-command experience: `vibegate ./my-app` combining scan + run
- [ ] npm publish `vibegate@0.1.0` + record an asciinema demo
- [ ] v0.2 hosted verdict badge + shareable report link (¥29 / report)
- [ ] v0.3 cross-runtime support (Python / Go projects)

<h2 id="license"><img src="https://api.iconify.design/tabler:license.svg?color=%230071E3&width=24" height="22" align="absmiddle" alt=""> License</h2>

MIT — see [LICENSE](./LICENSE). Feedback and PRs welcome at [issues](https://github.com/SuperMarioYL/vibegate/issues).

<p align="center"><sub><a href="./LICENSE">MIT</a> © 2026 SuperMarioYL</sub></p>
