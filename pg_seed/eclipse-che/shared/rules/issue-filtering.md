# Issue Filtering Rules

Rules applied by the `filter-issues` skill to select eligible issues from a GitHub project.

---

## Hard Filters (eliminate before scoring)

An issue is **ineligible** if ANY of these are true:

- State is not `open`
- Has any of these labels: `wontfix`, `duplicate`, `stale`, `lifecycle/stale`, `needs-triage`, `blocked`
- Already has an assignee
- Is a question (title starts with "Question:" or "How to")
- Is a tracking issue / epic (body contains "Tracking issue" or "Epic:")
- Is a validation issue (title starts with `[Validate]` or body says "Validation for: CRW-")
- Description body is empty or under 100 characters (excluding template boilerplate)

---

## Base Score by Issue Type

| Label | Base score |
|---|---|
| `kind/bug` | 10 |
| `kind/enhancement` | 6 |
| `area/docs` | 3 |
| (no type label) | 4 |

---

## CVE / Security Issues — Highest Priority (fix first)

Issues with a **`Security`** label or a title matching `CVE-YYYY-NNNNN` are treated as the highest-priority class:

- Score floor: **40** (overrides all other scoring — always at the top of the ranked list)
- Priority override: `critical`
- Story-point budget does NOT apply (fix regardless of budget)
- **Batch rule**: if ≤ 9 open CVE/Security issues exist, combine them into **one branch and one PR** instead of opening separate PRs per issue. Reference all CVE identifiers in the PR title and body.

Example batch PR: https://github.com/eclipse-che/che-dashboard/pull/1662

---

## Priority Boosts (additive)

| Signal | How to detect | Boost |
|---|---|---|
| `Security` label | label == "Security" or "security" | +30 |
| `priority/critical` label | label present | +5 |
| `priority/high` label | label present | +3 |
| `priority/major` label | label present | +2 |
| CVE label (`CVE-YYYY-NNNNN`) | label starts with `CVE-` | +25 |
| Has linked failing PR | body/comments contain `#NNNN` pointing to an open PR | +3 |
| Has test reproduction | body contains code block with reproduction steps | +2 |
| Linked to failing CI run | body/comments contain GitHub Actions URL with failed status | +2 |
| Reporter is contributor | reporter appears in recent commit authors | +1 |
| Has clear acceptance criteria | body contains "Acceptance criteria" section | +1 |
| `good first issue` label | label present | +1 |

---

## Description Quality Penalties (subtractive)

Apply **after** base score + priority boosts. See `issue-description-quality.md` section 6.

| Condition | Penalty |
|---|---|
| Bug: missing steps to reproduce OR missing expected/actual | -3 |
| Bug: template placeholders unfilled (`# <steps>`) | -3 |
| Feature: vague request with no comparison to existing feature | -2 |
| Description under 200 chars (non-CVE) | -2 |

---

## Auto-Approve Threshold

Only auto-start implementation (no manual confirmation) for issues at or above the minimum priority:

- **Default:** `major`
- Override per project in `projects.json` → `auto_approve.min_priority`
- Priority order (highest → lowest): `critical` → `major` → `minor` → `trivial`
- Issues below the threshold require manual approval via the Issues UI

### GitHub label → priority mapping

| GitHub label | Priority |
|---|---|
| `priority/critical`, `priority/blocker` | critical |
| `priority/major` | major |
| `priority/minor` | minor |
| `priority/trivial` | trivial |

### Jira priority → priority mapping

| Jira priority | Priority |
|---|---|
| Critical, Blocker | critical |
| Major | major |
| Normal, Minor | minor |
| Trivial | trivial |

---

## Global Rules

- Commit trailers: `Assisted-by` only. Never `Made-with` or `Co-authored-by`.
- Forbidden labels (always skip): `wontfix`, `duplicate`, `stale`, `lifecycle/stale`, `needs-triage`, `blocked`
- Issue must be in state `open`

---

## Project-Specific Label Filters

See `projects.json` per project for `issue_labels_filter` and `exclude_labels`.

| Project | Fetch labels |
|---|---|
| che-dashboard | `area/dashboard-frontend`, `area/dashboard-backend`, `kind/bug`, `kind/enhancement` |
| che-server | `kind/bug`, `kind/enhancement` |
| devworkspace-operator | `kind/bug` |
| che-docs | `area/docs` |
| che-ai-tool-images | `kind/bug`, `kind/enhancement` |

---

## Story Point Budget Filter

After scoring, further filter to issues whose story-point estimate is ≤ budget:

- Default budget: **3 story points**
- Apply `assign-story-points` skill to each candidate before final selection

---

## Output

Return a ranked table:

| # | Issue | Score | Story pts | Labels | URL |
|---|---|---|---|---|---|
| 1 | #1234 Fix workspace not starting | 15 | 2 | kind/bug, priority/high | ... |
| 2 | #1201 Add sorting to workspace list | 7 | 3 | kind/enhancement | ... |
