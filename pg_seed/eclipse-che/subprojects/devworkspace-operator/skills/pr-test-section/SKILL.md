---
name: pr-test-section
description: Write the "Is it tested? How?" section of a devworkspace-operator PR description. Invoke when filling in the test section — controller fixes, CRD changes, or Go unit tests.
---

# Write "Is it tested? How?"

Pick the template that matches the change, then fill in the specifics.

## Choose by change type

| Change type | Template |
|---|---|
| Controller / reconciler fix | Deploy + workspace lifecycle verification |
| CRD schema change | Unit tests + e2e checklist |
| Bug fix with unit tests | `make test` + count + pass statement |
| Webhook or admission fix | Deploy + admission scenario |
| Pure refactor / rename | `make test` pass or N/A |

---

## Template 1 — Deploy and verify (controller fix, feature)

```
1. Build and deploy the operator from this branch.
2. Create a DevWorkspace: `kubectl apply -f <sample-devworkspace.yaml>`.
3. <Perform the action that was broken or is new>.
4. Verify: <what the reviewer should see in the DevWorkspace status>.

E2E: trigger via `/test v8-devworkspace-operator-e2e, v8-che-happy-path`.
```

**Tips:**
- Always mention the e2e trigger comment.
- Describe what DevWorkspace status/conditions to check.

---

## Template 2 — Unit tests + build only

```
- `make test` passes — all <N> tests pass.
- `make build` succeeds.
```

Or for specific packages:

```
- `go test ./pkg/<package>/...` — all <N> tests pass.
- Full `make test` succeeds.
- `make build` compiles without errors.
```

---

## Template 3 — CRD schema change

```
- `make generate` regenerates CRD manifests cleanly.
- `make test` passes — all tests including the new schema validation tests pass.
- E2E: `/test v8-devworkspace-operator-e2e, v8-che-happy-path`.
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
