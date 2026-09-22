---
name: pr-test-section
description: Write the "Is it tested? How?" section of a devworkspace-generator PR description. Invoke when filling in the test section — Devfile conversion logic, unit tests, or dependency upgrades.
---

# Write "Is it tested? How?"

Pick the template that matches the change, then fill in the specifics.

## Choose by change type

| Change type | Template |
|---|---|
| Devfile conversion logic fix | Unit tests + integration test |
| Bug fix with unit tests | Test suite name + count + pass statement |
| Dependency / CVE upgrade | `yarn test` + build pass |
| Pure refactor / rename | Test suite pass or N/A |

---

## Template 1 — Unit tests + build (logic fix, feature)

```
- `yarn test` passes — all <N> tests pass (<M> suites).
- `yarn build` completes with zero errors.
```

Or for specific modules:

```
- Unit tests for the affected converter pass: `yarn test -- --grep "<pattern>"`.
- All <N> tests in the full suite pass.
- `yarn build` succeeds.
```

---

## Template 2 — Integration test (Devfile conversion)

```
1. Generate a DevWorkspace from a sample devfile:
   ```bash
   npx ts-node src/main.ts --devfile <path-to-devfile.yaml>
   ```
2. Verify the output DevWorkspace CR is valid: `kubectl apply --dry-run=client -f <output>.
3. Confirm: <specific field or behavior>.
```

---

## Template 3 — Dependency / CVE upgrade

```
- No runtime logic changed — pure dependency upgrade.
- `yarn install` resolves cleanly.
- `yarn build` succeeds with no new errors.
- `yarn test` passes — all suites green.
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
- The template comment (`<!-- Please provide instructions... -->`)
- What the code does — describe what the reviewer should DO and SEE
- Passive voice ("it was verified that") — write in imperative ("verify", "confirm", "run")
