---
name: pr-test-section
description: Write the "Is it tested? How?" section of a dash-licenses PR description. Invoke when filling in the test section — license checker logic, Maven builds, or dependency changes.
---

# Write "Is it tested? How?"

Pick the template that matches the change, then fill in the specifics.

## Choose by change type

| Change type | Template |
|---|---|
| License checking logic fix | Unit tests + sample run |
| Bug fix with unit tests | `mvn test` + count + pass statement |
| Dependency update | `mvn test` + build pass |
| Pure refactor / rename | `mvn test` pass or N/A |

---

## Template 1 — License checking logic (deploy + verify)

```
1. Build: `mvn clean install`.
2. Run the checker against a sample project:
   ```bash
   java -jar target/dash-licenses-<version>.jar <sample-deps-file>
   ```
3. Verify: <expected output — approved/rejected licenses>.
```

---

## Template 2 — Unit tests + build only

```
- `mvn test` passes — all <N> tests pass.
- `mvn clean install` completes with zero errors.
```

---

## Template 3 — Dependency update

```
- No runtime logic changed — pure dependency upgrade.
- `mvn clean install` builds successfully.
- `mvn test` passes — all test suites green.
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
- What the code does — describe what the reviewer should DO and SEE
- Passive voice ("it was verified that") — write in imperative ("verify", "confirm", "run")
