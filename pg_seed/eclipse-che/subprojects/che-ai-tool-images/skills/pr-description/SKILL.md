---
name: pr-description
description: Generate a full PR description for che-ai-tool-images. Invoke when asked to "write a PR description", "prepare the PR", or "create a description for this branch".
argument-hint: "[branch or ticket-id]"
---

# Generate PR Description — che-ai-tool-images

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

This repo has no PR template. Use this standard format:

```markdown
### What does this PR do?

<one-sentence summary of the primary change>

<details about Dockerfile changes, tool version bumps, or CI changes>

### What issues does this PR fix or reference?

fixes https://github.com/che-incubator/che-ai-tool-images/issues/<NUMBER>

### Is it tested? How?

<use the pr-test-section skill>
```

### 3. Writing style

**Lead with an action verb.** First sentence starts with `Bumps / Updates / Adds / Fixes / Removes` — present tense, no passive voice.

**For tool version bumps:**
```markdown
Bumps `<tool>` from <old-version> to <new-version> in the `<image-name>` image.
```

**For Dockerfile changes:**
```markdown
Updates the `<image-name>` Dockerfile to <what changed and why>.
```

**For multi-arch changes — numbered bold list:**
```markdown
1. **amd64** — <what changed>
2. **arm64** — <what changed>
```

**Avoid:** "This PR implements...", "In order to fix...", nested bullet lists.
