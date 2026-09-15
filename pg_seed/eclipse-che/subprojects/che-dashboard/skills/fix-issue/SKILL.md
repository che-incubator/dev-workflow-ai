---
name: fix-issue
description: Implement a fix for a che-dashboard issue after analyze-issue has been run. Creates a branch, applies the fix following rules/dev.md, runs tests and lint, opens a PR.
argument-hint: "[issue-number]"
---

# Fix che-dashboard Issue

## Required input

An issue number. `analyze-issue` must have been run first — scope, affected files, and story point estimate must be known before proceeding.

## Workflow

### 1. Verify scope is known

Confirm from the analyze-issue output:
- Affected files are listed
- Root cause hypothesis is stated
- Story points ≤ session budget (check `pg_seed/eclipse-che/projects.json` → `global.story_point_budget_per_session`)

If analyze-issue was not run, stop and run it first.

### 2. Set up the branch

```bash
cd "$LOCAL_PATH"
git checkout main
git pull origin main
git checkout -b che-<ISSUE_NUM>
```

### 3. Implement the fix

Follow `projects/che-dashboard/rules/dev.md` strictly:

- **No `any` type** — use proper types or `unknown`
- **Absolute imports only** — `@/components/Foo`, never `../../components/Foo`
- **PatternFly 5 only** — no raw HTML equivalents, no PF4
- **EPL-2.0 header** in every new source file:

```typescript
/*
 * Copyright (c) 2018-2024 Red Hat, Inc.
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Contributors:
 *   Red Hat, Inc. - initial API and implementation
 */
```

- **CSS property order**: follow stylelint-config-clean-order groups (Layout → Box/Size → Typography → Visual → Animation)
- **Error handling**: use typed error classes, not string matching
- **Accessibility**: keyboard handlers for interactive elements (see rules/dev.md §8)

### 4. Write or update tests

For every changed component or function, update or create the spec file:

```
packages/dashboard-frontend/src/components/Foo/__tests__/index.spec.tsx
packages/dashboard-backend/src/routes/__tests__/foo.spec.ts
```

Tests must cover:
- The bug scenario (regression test)
- Happy path if new behavior was added
- Edge cases identified in the issue

### 5. Run the surgical change workflow (mandatory, in order)

```bash
# Step 1: targeted tests
yarn workspace @eclipse-che/dashboard-frontend test --testPathPatterns="<ComponentName>" --no-cache
# Fix all failures

# Step 2: format
yarn format:fix
# Fix all issues

# Step 3: lint
yarn lint:fix
# Fix all issues
```

If `package.json` or `yarn.lock` was touched:
```bash
yarn license:generate
# Add UNRESOLVED packages to .deps/EXCLUDED/ if needed, re-run
```

### 6. Commit

```bash
git add <specific files — never git add -A blindly>
git commit -m "$(cat <<'EOF'
fix(scope): short description of what was fixed

Closes #<ISSUE_NUM>

Assisted-by: Claude Sonnet 4.6
Signed-off-by: $(git config user.name) <$(git config user.email)>
EOF
)"
```

Conventional commit types: `fix`, `feat`, `chore`, `refactor`, `test`, `docs`. Subject ≤ 50 chars.

### 7. Push and open PR

```bash
git push -u origin che-<ISSUE_NUM>

gh pr create \
  --repo eclipse-che/che-dashboard \
  --title "fix(scope): short description" \
  --body "$(cat <<'EOF'
## What

<what changed and why>

## How tested

<unit tests added/updated, or manual verification steps>

Closes #<ISSUE_NUM>
EOF
)"
```

### 8. Monitor CI

```bash
gh pr checks <PR_NUM> --repo eclipse-che/che-dashboard --watch
```

If CI fails, diagnose the failure and push a fix commit. Do not force-push after CI has run — add a new commit.

## Output

Report the PR URL and CI status.
