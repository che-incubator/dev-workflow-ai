---
name: filter-issues
description: Fetch open GitHub issues for a subproject, apply pg_seed/eclipse-che/projects.json filters and scoring, and return a ranked list ready for pick-issue. Use before pick-issue or run-loop.
argument-hint: "[project-name] (e.g., che-dashboard, che-server, devworkspace-operator)"
---

# Filter Issues

## Required input

A project name matching a key in `pg_seed/eclipse-che/projects.json` → `projects`. If `$ARGUMENTS` is empty, ask the user.

## Workflow

### 1. Read project config from pg_seed/eclipse-che/projects.json

```bash
cat ./pg_seed/eclipse-che/projects.json | \
  python3 -c "import json,sys; d=json.load(sys.stdin); p=d['projects']['$ARGUMENTS']; print(json.dumps(p, indent=2))"
```

Extract: `repo`, `issue_labels_filter`, `exclude_labels` (if present).

### 2. Fetch open issues

```bash
REPO=<from pg_seed/eclipse-che/projects.json>
LABELS=<comma-separated from issue_labels_filter>

gh issue list \
  --repo ${REPO} \
  --state open \
  --label "${LABELS}" \
  --json number,title,body,labels,assignees,author,url \
  --limit 50
```

Note: GitHub `--label` filter is OR-based — fetches issues with ANY of the listed labels.

### 3. Apply hard filters

From `shared/rules/issue-filtering.md`:

Remove issues where:
- `assignees` is non-empty
- Any label matches: `wontfix`, `duplicate`, `stale`, `lifecycle/stale`, `needs-triage`, `blocked`
- Any label matches the project's `exclude_labels` list from pg_seed/eclipse-che/projects.json
- Title starts with "Question:" or "How to"
- Body contains "Tracking issue" or "Epic:"

### 4. Score each remaining issue

Base score from label type (`kind/bug`=10, `kind/enhancement`=6, `area/docs`=3, else=4).

Apply boosts (from `shared/rules/issue-filtering.md`):

```python
# Pseudo-code for scoring
def score(issue):
    base = 10 if 'kind/bug' in labels else 6 if 'kind/enhancement' in labels else 3
    boost = 0
    if 'priority/critical' in labels: boost += 5
    if 'priority/high' in labels: boost += 3
    if 'good first issue' in labels: boost += 1
    if has_code_block_in_body: boost += 2   # test reproduction
    if 'Acceptance criteria' in body: boost += 1
    return base + boost
```

### 5. Estimate story points

For each issue, make a quick estimate based on the title and body:
- 1: single value, typo, version bump, minor CSS
- 2: one component change
- 3: component + state/service change
- 5: cross-package
- 8: architecture change

(Detailed estimation happens in `assign-story-points` skill — this is a quick pass.)

### 6. Sort and output

Sort by score descending. Output ranked table:

```
## Filtered Issues: <project-name>

Total fetched: 50 | After hard filter: 12 | Within 3pt budget: 8

| Rank | # | Title | Score | Est. pts | Labels |
|---|---|---|---|---|---|
| 1 | #1234 | Fix workspace not starting | 15 | 2 | kind/bug, priority/high |
| 2 | #1198 | SSH key deletion fails silently | 13 | 2 | kind/bug |
| 3 | #1201 | Add sorting to workspace list | 7 | 3 | kind/enhancement |
...
```

Top issue is the candidate for `pick-issue`.
