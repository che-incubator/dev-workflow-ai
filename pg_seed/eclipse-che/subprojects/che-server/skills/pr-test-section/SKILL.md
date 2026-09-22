---
name: pr-test-section
description: Write the "How to test this PR?" section of a che-server PR description. Invoke when filling in the test section — API fixes needing deploy-and-verify steps, Java unit tests, or dependency upgrades.
---

# Write "How to test this PR?"

Pick the template that matches the change, then fill in the specifics.

## Choose by change type

| Change type | Template |
|---|---|
| API or workspace lifecycle fix | Deploy + API/CLI verification steps |
| OAuth or auth fix | Deploy + auth flow verification |
| Bug fix with unit tests | Maven test suite + count + pass statement |
| Dependency / CVE upgrade | `mvn test` + build pass |
| Pure refactor / rename | Test suite pass or N/A |

---

## Template 1 — Deploy and verify (API fix, feature, bug fix)

```
1. Deploy Eclipse Che with the che-server image from this PR.
2. Platform: OpenShift / Kubernetes (specify which).
3. <Perform the action that was broken or is new>.
4. Verify: <what the reviewer should see>.
```

**Tips:**
- Specify the platform (OpenShift, Kubernetes, minikube, etc.).
- Include installation method if relevant (chectl / che-operator).
- Use backticks for API endpoints and CLI commands.

**Real examples:**

```
1. Deploy Eclipse Che on OpenShift with the server image from this PR.
2. Create a workspace via factory URL.
3. Verify the workspace starts successfully and the OAuth token is propagated.
```

---

## Template 2 — Unit tests + build only

```
`mvn test` passes — all <N> tests in the affected modules pass.
`mvn clean install` completes with zero errors.
```

Or for specific modules:

```
- `mvn test -pl wsmaster/che-core-api-workspace` — all <N> tests pass.
- `mvn test -pl wsmaster/che-core-api-auth` — all <N> tests pass.
- Full `mvn clean install` succeeds.
```

---

## Template 3 — Dependency / CVE upgrade

```
- No runtime logic changed — pure dependency upgrade.
- `mvn clean install` builds successfully.
- `mvn test` passes — all test suites green.
- No new security vulnerabilities introduced (verified with `mvn dependency:tree`).
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
