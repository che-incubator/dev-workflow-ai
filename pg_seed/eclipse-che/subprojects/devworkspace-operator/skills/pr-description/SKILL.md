---
name: pr-description
description: Generate a full PR description following the devworkspace-operator template. Invoke when asked to "write a PR description", "prepare the PR", or "create a description for this branch".
argument-hint: "[branch or ticket-id]"
---

# Generate PR Description — devworkspace-operator

## Related skills

- **`pr-test-section`** — use for the "Is it tested? How?" section

## Workflow

### 1. Gather context

```bash
git log --oneline origin/main..HEAD   # commits on this branch
git diff origin/main..HEAD --stat     # changed files
git branch --show-current             # branch name / ticket
```

### 2. Write the PR description

Follow the project template **exactly** (from `.github/PULL_REQUEST_TEMPLATE.md`):

```markdown
### What does this PR do?

<one-sentence summary of the primary change>

<Root Cause + Fix subsections for bugs; numbered bold list for multiple changes>

### What issues does this PR fix or reference?

fixes https://github.com/devfile/devworkspace-operator/issues/<NUMBER>

### Is it tested? How?

<use the pr-test-section skill>

### PR Checklist

- [ ] E2E tests pass (when PR is ready, comment `/test v8-devworkspace-operator-e2e, v8-che-happy-path` to trigger)
    - [ ] `v8-devworkspace-operator-e2e`: DevWorkspace e2e test
    - [ ] `v8-che-happy-path`: Happy path for verification integration with Che
```

### 3. Writing style

**Lead with an action verb.** First sentence starts with `Fixes / Adds / Upgrades / Prevents / Removes / Refactors` — present tense, no passive voice.

**For bugs — include Root Cause + Fix:**

```markdown
### Root Cause

<Exact technical mechanism. Name the function, struct, or reconcile loop.>

### Fix

<What changed and why it works.>
```

**For operator changes — describe the CRD/controller impact:**

```markdown
Updates the `<controller>` reconciler to <what changed>. The `DevWorkspace` CR
now <new behavior>.
```

**For multiple independent changes — numbered bold list:**

```markdown
1. **Thing A** — short explanation of what it fixes/adds and why
2. **Thing B** — short explanation
```

**Avoid:** "This PR implements...", "In order to fix...", "Please note that...", nested bullet lists.
