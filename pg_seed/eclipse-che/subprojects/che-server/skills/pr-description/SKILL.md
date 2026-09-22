---
name: pr-description
description: Generate a full PR description following the che-server template. Invoke when asked to "write a PR description", "prepare the PR", or "create a description for this branch".
argument-hint: "[branch or ticket-id]"
---

# Generate PR Description — che-server

## Related skills

- **`pr-test-section`** — use for the "How to test this PR?" section

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

### Screenshot/screencast of this PR

<omit or write N/A if not applicable>

### What issues does this PR fix or reference?

fixes https://github.com/eclipse-che/che-server/issues/<NUMBER>

### How to test this PR?

<use the pr-test-section skill>

### PR Checklist

- [x] The Eclipse Contributor Agreement is valid
- [x] Code produced is complete
- [x] Code builds without errors
- [x] Tests are covering the bugfix
- [x] The repository devfile is up to date and works
- [x] Sections "What issues does this PR fix or reference" and "How to test this PR" completed
- [ ] Relevant user documentation updated
- [ ] Relevant contributing documentation updated
- [ ] CI/CD changes implemented, documented and communicated

### Release Notes

<single past-tense user-facing sentence>

### Reviewers

Reviewers, please comment how you tested the PR when approving it.
```

### 3. Writing style

**Lead with an action verb.** First sentence starts with `Fixes / Adds / Upgrades / Prevents / Removes` — present tense, no passive voice.

**For bugs — include Root Cause + Fix:**

```markdown
### Root Cause

<Exact technical mechanism. Name the class, method, or condition.>

### Fix

<What changed and why it works.>
```

**For multiple independent changes — numbered bold list:**

```markdown
1. **Thing A** — short explanation of what it fixes/adds and why
2. **Thing B** — short explanation
```

**Release Notes:** Single past-tense sentence from the user's perspective — no internal class names.

**Avoid:** "This PR implements...", "In order to fix...", "Please note that...", nested bullet lists.
