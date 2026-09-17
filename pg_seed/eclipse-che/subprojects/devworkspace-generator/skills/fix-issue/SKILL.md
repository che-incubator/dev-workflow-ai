---
name: fix-issue
description: Implement a fix for devworkspace-generator following TypeScript strict conventions.
argument-hint: "[issue-number]"
---

# Fix devworkspace-generator Issue

## Required input

An issue number. `analyze-issue` must have been run first.

## Workflow

### 1. Verify scope is known

Confirm affected files, root cause, and story points from analyze-issue.

### 2. Set up the branch

```bash
cd "$LOCAL_PATH"
git checkout main
git pull origin main
git checkout -b issue-<ISSUE_NUM>
```

### 3. Implement the fix

Follow TypeScript strict conventions:

- **No `any` type** — use proper types or `unknown`
- **EPL-2.0 header** in every new `.ts` file:

```typescript
//
// Copyright (c) 2022-2026 Red Hat, Inc.
// Licensed under the Eclipse Public License 2.0 which is available at
// https://www.eclipse.org/legal/epl-2.0/
//
// SPDX-License-Identifier: EPL-2.0
//
// Contributors:
//   Red Hat, Inc. - initial API and implementation
//
```

- **Null safety**: check for undefined before use, use optional chaining where appropriate
- **Function return types**: always explicitly typed for exported functions

### 4. Update tests

For every changed function, add or update the `.spec.ts` file alongside it:

```
src/devfile/component-handler.spec.ts  (alongside component-handler.ts)
```

Tests must cover:
- The bug scenario (regression test)
- Valid Devfile v2 input → correct DevWorkspace output
- Invalid input → appropriate error message

### 5. Run build, test, lint

```bash
# Build
yarn build 2>&1 | tail -20
# Fix all TypeScript errors

# Test
yarn test 2>&1 | tail -30
# Fix all test failures

# Lint
yarn lint 2>&1 | tail -20
# Fix all lint violations
```

If `package.json` was changed:
```bash
yarn license:generate
```

### 6. Commit

```bash
git add <specific files>
git commit -m "$(cat <<'EOF'
fix(devfile): short description

Closes #<ISSUE_NUM>

Assisted-by: Claude Sonnet 4.6
Signed-off-by: $(git config user.name) <$(git config user.email)>
EOF
)"
```

### 7. Push and open PR

```bash
git push -u origin issue-<ISSUE_NUM>

gh pr create \
  --repo devfile/devworkspace-generator \
  --title "fix(devfile): short description" \
  --body "$(cat <<'EOF'
## What

<what changed and why>

## How tested

<unit tests added/updated>

Closes #<ISSUE_NUM>
EOF
)"
```

## Output

Report the PR URL and CI status.
