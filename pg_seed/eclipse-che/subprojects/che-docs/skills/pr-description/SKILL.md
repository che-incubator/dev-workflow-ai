---
name: pr-description
description: Generate a full PR description following the che-docs template. Invoke when asked to "write a PR description", "prepare the PR", or "create a description for this branch".
argument-hint: "[branch or ticket-id]"
---

# Generate PR Description — che-docs

## Related skills

- **`pr-test-section`** — use for the test/validation section

## Workflow

### 1. Gather context

```bash
git log --oneline origin/main..HEAD   # commits on this branch
git diff origin/main..HEAD --stat     # changed files
git branch --show-current             # branch name / ticket
```

### 2. Choose PR title prefix

| Prefix | When |
|---|---|
| `docs:` | Documentation not including procedures |
| `procedures:` | Documentation including procedures (testing mandatory) |
| `chore:` | Routine, release, tooling, version upgrades |
| `fix:` | Fix build, language, links, or metadata |

### 3. Write the PR description

Follow the project template **exactly** (from `.github/PULL_REQUEST_TEMPLATE.md`):

```markdown
## What does this pull request change?

<one-sentence summary of what content was added, updated, or removed>

<details for new procedures, updated guidance, or restructured pages>

## What issues does this pull request fix or reference?

fixes https://github.com/eclipse-che/che-docs/issues/<NUMBER>

## Specify the version of the product this pull request applies to

<version number or "next" for unreleased>

## Pull Request checklist

- Any procedure:
  - [x] Successfully tested.
- Any page or link rename:
  - [x] The page contains a redirection for the previous URL.
  - Propagate the URL change in:
    - [ ] Dashboard default branding data
- [x] Builds on Eclipse Che hosted by Red Hat.
- [x] The *Validate language on files added or modified* step reports no vale warnings.
```

### 4. Writing style

**Lead with an action verb.** First sentence starts with `Adds / Updates / Fixes / Removes / Documents` — present tense, no passive voice.

**For new procedures:**
```markdown
Adds a procedure for <action>. Includes step-by-step instructions for <scope>.
```

**For content fixes:**
```markdown
Fixes <what was wrong> in the <page/section>.
```

**Checklist items:** Only check items that actually apply. Leave unchecked items that were not validated.

**Avoid:** "This PR implements...", technical jargon not relevant to docs, nested bullet lists.
