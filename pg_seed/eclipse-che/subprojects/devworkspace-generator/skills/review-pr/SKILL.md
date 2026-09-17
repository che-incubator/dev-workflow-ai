---
name: review-pr
description: Review a devworkspace-generator PR against TypeScript/Devfile conventions. Reports findings by severity.
argument-hint: "[PR-number or PR-URL]"
---

# Review devworkspace-generator PR

## Required input

A PR number or URL. Parse from `$ARGUMENTS`.

## Workflow

### 1. Fetch the PR diff

```bash
PR_NUM=<parse from $ARGUMENTS>
gh pr diff ${PR_NUM} --repo devfile/devworkspace-generator
gh pr view ${PR_NUM} --repo devfile/devworkspace-generator --json title,body,files
```

### 2. Tier 1 — Always check

#### No `any` type (BLOCKING)

```bash
gh pr diff ${PR_NUM} --repo devfile/devworkspace-generator | grep "^\+" | grep -E "\bany\b"
```

Any `any` type in added lines = **BLOCKING**.

#### EPL-2.0 header in new .ts files (BLOCKING)

```bash
gh api repos/devfile/devworkspace-generator/pulls/${PR_NUM}/files \
  --jq '.[] | select(.status == "added") | .filename' | grep "\.ts$"
```

Missing EPL-2.0 header in new TypeScript file = **BLOCKING**.

#### Test coverage for changed functions (ADVISORY)

For each changed `.ts` file (not `.spec.ts`), check if a corresponding `.spec.ts` was also changed. New logic without tests = **ADVISORY** (BLOCKING for new public API functions).

#### yarn license:generate if package.json changed (BLOCKING)

```bash
gh api repos/devfile/devworkspace-generator/pulls/${PR_NUM}/files \
  --jq '.[].filename' | grep "package\.json"
```

If `package.json` changed, verify `.deps/` or license-related files were also updated = **BLOCKING**.

### 3. Tier 2 — Trigger-based checks

#### New component type added

If a new Devfile component type is handled (new case in switch or new handler file):
- Check **all** DevWorkspace output sections are updated (containers, initContainers, volumes, commands)
- Check the new component is covered in test fixtures

#### JSON schema changed (`src/devfile-schema/`)

- Check the schema version comment or description is updated
- Check TypeScript types in `src/api/` reflect the schema change

#### SCM integration changed (`src/bitbucket/`, `src/bitbucket-server/`)

- Check error handling for network failures (timeout, 404, auth error)
- Check retry logic or error message quality

## Output

```
## PR Review: #NNNN — <title>

| # | File | Finding | Severity |
|---|---|---|---|
| 1 | src/devfile/handler.ts | `any` type: `const x: any` | BLOCKING |
| 2 | src/devfile/new-handler.ts | Missing EPL-2.0 header | BLOCKING |
| 3 | src/devfile/handler.ts | No test for new component branch | ADVISORY |

**Blocking issues:** N
**Advisory issues:** N
```
