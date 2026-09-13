---
repo: eclipse-che/che
default_branch: main
stack: [GitHub Actions, Shell, Release automation, TypeScript, Mocha, Selenium, Allure]
description: Eclipse Che umbrella repository — CI/CD, release coordination, devfile samples, cross-repo issue tracker, e2e tests
auto_approve_min_priority: major
story_point_budget: 3
local_path: .repos/eclipse-che/che
commands:
  test_e2e: "cd tests/e2e && npm run tsc && npm test"
  lint_e2e: "cd tests/e2e && npm run lint"

---

# eclipse-che/che — Umbrella Repository

> This is the main issue tracker for Eclipse Che. All cross-project issues,
> feature requests, and bugs that affect multiple subprojects are filed here.
> Last commit: `adf4048f3e` · 2026-04-22 · chore: add Claude CLI install command to devfile

## Role

The `eclipse-che/che` repository serves as:
- **Issue tracker** — primary place for bugs and feature requests across the ecosystem
- **Release coordination** — cross-repo release scripts and notes
- **Devfile samples** — workspace devfile for contributing to Che itself
- **CI/CD** — GitHub Actions workflows for cross-repo automation

## Key Files

```
.github/workflows/    ← CI/CD, release automation
devfile.yaml          ← workspace definition for contributors
make-release.sh       ← release coordination script
RELEASE.md            ← release process documentation
tests/e2e/            ← end-to-end test suite (TypeScript, Mocha, Selenium)
```

## E2E Test Suite (`tests/e2e/`)

Package: `@eclipse-che/che-e2e` — Selenium WebDriver tests that verify the full Che stack.

**Stack:** TypeScript 4.9, Mocha 9, Selenium WebDriver 4.6, Allure reporting, inversify DI

**Key package.json scripts:**
- `npm run tsc` — compile TypeScript → `dist/`
- `npm test` — lint + compile + run Mocha tests via `dist/configs/mocharc.js`
- `npm run lint` — ESLint with `@typescript-eslint`
- `npm run functional-test-suite` — run full functional tests via shell script
- `npm run devfile-acceptance-test-suite` — run devfile acceptance tests
- `npm run open-allure-dashboard` — generate and open Allure HTML report

**Test execution config:** Controlled by env vars prefixed `TS_SELENIUM_*` (e.g. `TS_SELENIUM_BASE_URL`).

**Notable dependencies:**
- `selenium-webdriver@4.6.1` — browser automation
- `monaco-page-objects@3.14.1` — VS Code / Monaco editor page objects
- `@eclipse-che/api` — Che REST API types
- `inversify@6.0.1` — dependency injection
- `allure-mocha` — test reporting

**Running locally:**
```bash
cd tests/e2e
export TS_SELENIUM_BASE_URL=https://your-che-instance
npm run tsc
npm test
```

## Issue Labels Relevant to Subprojects

| Label | Meaning |
|---|---|
| `area/dashboard` | Affects che-dashboard (React UI) |
| `area/server` | Affects che-server (Java backend) |
| `kind/bug` | Bug report |
| `kind/enhancement` | Feature request |
| `severity/P2` | Important, affects key workflows |
| `lifecycle/frozen` | Do not auto-close as stale |

## How Issues Flow

Issues filed here are triaged and may be:
1. Fixed directly in this repo (release scripts, devfiles)
2. Linked to a subproject PR (che-dashboard, che-server, etc.)
3. Kept here as cross-cutting concerns

When the agent picks an `area/dashboard` issue from this repo, it implements
the fix in the `che-dashboard` local clone and links back to this issue.
