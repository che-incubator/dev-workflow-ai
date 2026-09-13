---
name: pick-issue
description: Select the next issue to work on from the filtered + scored list, respecting the story-point budget from rules.json. Assigns the issue and marks it in-progress.
argument-hint: "[project-name] (e.g., che-dashboard)"
---

# Pick Issue

## Required input

A project name matching a key in `rules.json` → `projects`. If `$ARGUMENTS` is empty, ask the user.

## CVE Priority Override

**Before** running the normal filter, check for CVE/Security issues:

- Any issue with label `Security` or title containing `CVE-YYYY-NNNNN` gets **score ≥ 40** and **priority: critical**.
- These issues are always selected before any other type, regardless of story-point budget.
- If 2–9 CVE issues exist: do **not** use this skill — use `/batch-cve-fix` instead.
- If exactly 1 CVE issue exists: skip to Step 4 and select it directly.

---

## Workflow

### 1. Run filter-issues

```
/filter-issues $ARGUMENTS
```

This produces a scored, ranked list of eligible open issues.

### 2. Check story-point budget

```bash
cat ./rules.json | \
  python3 -c "import json,sys; d=json.load(sys.stdin); print(d['global']['story_point_budget_per_session'])"
```

Default: **3 points**.

### 3. Run assign-story-points on top candidates

For the top 3 issues from filter-issues output, run a detailed story point estimate:

```
/assign-story-points <issue-number>
```

Filter to issues with estimate ≤ budget.

### 4. Select the top eligible issue

From the remaining issues (scored + within budget + no assignee), pick the highest-scored.

If multiple issues tie on score, prefer:
1. `kind/bug` over `kind/enhancement`
2. Lower story point estimate
3. Older issue (lower issue number)

### 5. Assign and label

```bash
REPO=<from rules.json for the project>
ISSUE_NUM=<selected issue number>

# Assign to self
gh issue edit ${ISSUE_NUM} --repo ${REPO} --add-assignee @me

# Add in-progress label if it exists (don't fail if it doesn't)
gh issue edit ${ISSUE_NUM} --repo ${REPO} --add-label "in-progress" 2>/dev/null || true
```

### 6. Report selection

```
## Selected Issue

**Project:** che-dashboard
**Issue:** #1234 — Fix workspace not starting after network timeout
**Score:** 15
**Story points:** 2
**Labels:** kind/bug, priority/high
**URL:** https://github.com/eclipse-che/che-dashboard/issues/1234

**Rationale:** Highest-scored bug within 3pt budget; has test reproduction in body (+2), priority/high (+3).

**Next step:** Run `/analyze-issue 1234` to map affected files and confirm fix scope.
```
