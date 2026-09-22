---
name: pr-test-section
description: Write the "How to test this PR?" section of an eclipse-che/che umbrella PR description. Invoke when filling in the test section — CI/CD workflows, e2e tests, devfile changes, or release automation.
---

# Write "How to test this PR?"

Pick the template that matches the change, then fill in the specifics.

## Choose by change type

| Change type | Template |
|---|---|
| CI / GitHub Actions workflow | Workflow run verification |
| E2E test fix or addition | E2E test run + results |
| Devfile change | Workspace start verification |
| Release automation | Dry-run release verification |
| Pure refactor / config | N/A or test suite pass |

---

## Template 1 — CI / GitHub Actions workflow

```
- Workflow runs successfully on this branch (see Actions tab).
- <Specific job>: <what was verified>.
- No regressions in other workflows.
```

**Tips:**
- Link to the successful Actions run if available.
- Specify the platform (OpenShift, Kubernetes) when relevant.

---

## Template 2 — E2E test fix or addition

```
1. Run e2e tests: `cd tests/e2e && npm run tsc && npm test`.
2. All <N> tests pass, including the new/fixed test.
3. Platform: <OpenShift / Kubernetes>.
```

Or with CI trigger:

```
E2E tests triggered via `/test v8-che-happy-path` — all tests pass.
```

---

## Template 3 — Devfile change

```
1. Open a workspace using the devfile from this branch:
   `https://<che-host>/f?url=https://github.com/eclipse-che/che/tree/<branch>`
2. Verify: <workspace starts successfully, tools are available, etc.>.
```

---

## Template 4 — N/A

Use only for pure refactoring, doc/comment changes, or changes fully covered by existing tests:

```
N/A
```

---

## What NOT to write

- "Tested" with no specifics — reviewers can't reproduce it
- The template comment (`<!-- Please explain for example... -->`)
- What the code does — describe what the reviewer should DO and SEE
- Passive voice ("it was verified that") — write in imperative ("verify", "confirm", "run")
