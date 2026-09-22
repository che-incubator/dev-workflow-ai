---
name: pr-description
description: Generate a full PR description following the eclipse-che/che umbrella template. Invoke when asked to "write a PR description", "prepare the PR", or "create a description for this branch".
argument-hint: "[branch or ticket-id]"
---

# Generate PR Description — eclipse-che/che (umbrella)

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

<details about CI/CD, release automation, devfile, or e2e test changes>

### Screenshot/screencast of this PR

<omit or write N/A if not applicable>

### What issues does this PR fix or reference?

fixes https://github.com/eclipse-che/che/issues/<NUMBER>

### How to test this PR?

<use the pr-test-section skill>

### PR Checklist

- [x] The Eclipse Contributor Agreement is valid
- [x] Code produced is complete
- [x] Code builds without errors
- [x] Tests are covering the bugfix or new feature
- [x] The repository devfile is up to date and works
- [x] Sections "What issues does this PR fix or reference" and "How to test this PR" completed
- [ ] Relevant user documentation updated
- [ ] Relevant contributing documentation updated
- [ ] CI/CD changes implemented, documented and communicated

### Reviewers

Reviewers, please comment how you tested the PR when approving it.
```

### 3. Writing style

**Lead with an action verb.** First sentence starts with `Fixes / Adds / Updates / Removes / Upgrades` — present tense, no passive voice.

**For CI/CD changes:**
```markdown
Updates the <workflow-name> GitHub Actions workflow to <what changed and why>.
```

**For e2e test changes:**
```markdown
Fixes the <test-name> e2e test that was failing because <root cause>.
```

**For devfile changes:**
```markdown
Updates the devfile to <what changed>. <Impact on developer experience.>
```

**Avoid:** "This PR implements...", "In order to fix...", "Please note that...", nested bullet lists.
