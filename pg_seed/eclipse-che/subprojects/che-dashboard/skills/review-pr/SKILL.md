---
name: review-pr
description: Review a che-dashboard PR diff against rules/dev.md and pg_seed/eclipse-che/projects.json. Reports findings grouped by severity (blocking/advisory).
argument-hint: "[PR-number or PR-URL]"
---

# Review che-dashboard PR

## Required input

A PR number or URL. Parse from `$ARGUMENTS`.

## Workflow

### 1. Fetch the PR diff

```bash
PR_NUM=<parse from $ARGUMENTS>
gh pr diff ${PR_NUM} --repo eclipse-che/che-dashboard
gh pr view ${PR_NUM} --repo eclipse-che/che-dashboard --json title,body,files,additions,deletions,labels
```

### 2. Check — No `any` type (BLOCKING)

```bash
gh pr diff ${PR_NUM} --repo eclipse-che/che-dashboard | grep "^\+" | grep -E "\bany\b"
```

Any `any` type in added lines is a blocking violation. Also check for `as any` casts.

### 3. Check — No relative imports (BLOCKING)

```bash
gh pr diff ${PR_NUM} --repo eclipse-che/che-dashboard | grep "^\+" | grep -E "from '(\.\.?/)"
```

Any `import ... from '../` or `from './'` in frontend files is a blocking violation. Must use `@/` alias.

### 4. Check — EPL-2.0 header in new files (BLOCKING)

For every new file in the diff (lines starting with `+++ b/`):

```bash
gh api repos/eclipse-che/che-dashboard/pulls/${PR_NUM}/files \
  --jq '.[] | select(.status == "added") | .filename'
```

Fetch each new file and verify the EPL-2.0 header is present. Missing header = blocking.

### 5. Check — CSS property ordering (ADVISORY)

For changed `.module.css` files, verify `stylelint-config-clean-order` groups are respected:

Layout → Box/Size → Typography → Visual → Animation (empty line between groups with ≥5 props).

### 6. Check — License regeneration (BLOCKING if applicable)

If `package.json` or `yarn.lock` is in the changed files:

```bash
gh api repos/eclipse-che/che-dashboard/pulls/${PR_NUM}/files \
  --jq '.[].filename' | grep -E "package\.json|yarn\.lock"
```

If either file changed, verify `.deps/` files were also updated. Missing `.deps/` update when deps changed = blocking.

### 7. Check — Test coverage delta (ADVISORY → BLOCKING if coverage drops)

For each changed source file, check if a corresponding spec file was added or updated:

```bash
gh api repos/eclipse-che/che-dashboard/pulls/${PR_NUM}/files \
  --jq '.[].filename' | grep -v "spec\|test\|\.css\|\.json\|\.md"
```

For each non-test file changed, look for a matching `*.spec.ts` or `*.spec.tsx` in the diff. If new logic was added without new tests, flag as advisory (blocking if it's a new component with no existing spec).

### 8. Check — Commit trailer (ADVISORY)

```bash
gh pr view ${PR_NUM} --repo eclipse-che/che-dashboard --json commits \
  --jq '.commits[].messageBody'
```

Check for forbidden trailers: `Made-with`, `Co-authored-by`. Flag as advisory (maintainers will squash anyway).

### 9. Check — PatternFly 5 only (ADVISORY)

```bash
gh pr diff ${PR_NUM} --repo eclipse-che/che-dashboard | grep "^\+" | grep -E "@patternfly/react-core/dist/esm/deprecated|@patternfly/react-core/dist/cjs"
```

Deprecated PF4 import paths = advisory (blocking for new components).

## Output

Report findings in this table:

```
## PR Review: #NNNN — <title>

| # | File | Line | Finding | Severity |
|---|---|---|---|---|
| 1 | packages/frontend/src/Foo.tsx | 42 | `any` type used: `const x: any` | BLOCKING |
| 2 | packages/frontend/src/Foo.tsx | 10 | relative import: `from '../../Bar'` | BLOCKING |
| 3 | packages/frontend/src/Foo.tsx | — | no EPL-2.0 header in new file | BLOCKING |
| 4 | packages/frontend/src/Foo.module.css | 8 | CSS order: `color` before `display` | ADVISORY |

**Blocking issues:** 3 — PR cannot merge until fixed.
**Advisory issues:** 1 — fix recommended but not required.
```

If no issues found: "No blocking issues. PR looks clean."
