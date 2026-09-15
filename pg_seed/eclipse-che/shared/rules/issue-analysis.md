# Issue Analysis — General Rules

General rules for analyzing any Eclipse Che issue before implementation. Apply these before running a project-specific `analyze-issue` skill.

---

## 1. Fetch the Issue

```bash
gh issue view <ISSUE_NUM> --repo <ORG/REPO> \
  --json number,title,body,labels,assignees,state,comments
```

**Stop immediately if:**
- `state` is not `open`
- `assignees` is non-empty (already assigned)
- Labels include any of: `wontfix`, `duplicate`, `stale`, `lifecycle/stale`, `needs-triage`, `blocked`

---

## 2. Extract from the Body

Parse these fields manually from the issue body:

| Field | Where to find it |
|---|---|
| Steps to reproduce | "Steps to reproduce", "How to reproduce" section |
| Expected behavior | "Expected behavior", "Expected result" section |
| Actual behavior | "Actual behavior", "Actual result", error messages |
| Component hint | "Component", "Area", or mentioned class/page/endpoint |
| Version info | "Che version", "Dashboard version" — note if issue may be version-specific |

---

## 3. Map Label to Project

| Label pattern | Project |
|---|---|
| `area/dashboard-frontend` | che-dashboard (frontend package) |
| `area/dashboard-backend` | che-dashboard (backend package) |
| `area/docs` | che-docs |
| `area/factory` | che-dashboard + che-server (factory flow) |
| `area/workspace-*` | che-server + devworkspace-operator |
| `area/oauth`, `area/auth` | che-server |
| `kind/bug` | priority — fix first |
| `kind/enhancement` | lower priority than bugs |
| (no area label) | read the body to determine project |

---

## 4. Classify the Issue Type

| Type | Criteria |
|---|---|
| `bug` | Something works incorrectly; there's an expected vs actual behavior gap |
| `enhancement` | New feature or improvement to existing behavior |
| `CVE` | Security vulnerability in a dependency (`CVE-XXXX-YYYY` in title/body) |
| `doc` | Documentation is missing, outdated, or wrong |
| `test-coverage` | No tests for existing behavior; CI coverage failure |

---

## 5. Find Affected Files

In the target project's local directory:

```bash
# By component/class name mentioned in the issue
grep -r "ComponentName" <local-repo-path>/src --include="*.ts" --include="*.tsx" --include="*.java" --include="*.go" -l

# By API endpoint
grep -r "/api/path" <local-repo-path>/src -l

# By feature keyword
grep -r "keyword" <local-repo-path>/src -l
```

---

## 6. Assess Description Quality

Before investing time in analysis, apply the readiness checklist from
`shared/rules/issue-description-quality.md`:

- **CVE issues** — always implementable; extract package name from summary
- **Bug issues** — requires steps to reproduce (filled) + expected vs actual behavior
- **Feature issues** — requires what currently exists + what is missing
- **Validation issues** (`[Validate]` title) — skip; not an implementation task

Hard stops:
- Description < 100 chars (excluding boilerplate) → skip, flag as `needs-more-info`
- Template placeholders unfilled (`# <steps>`, empty `Actual results:`) → skip
- Description is only an external link with no local context → skip

Apply score adjustments from `issue-description-quality.md` section 6 before ranking.

---

## 7. Story Point Definitions

| Points | Effort |
|---|---|
| 1 | Trivial — single file, no test changes |
| 2 | Small — 1–3 files, minor test update |
| 3 | Medium — 3–8 files, new test cases |
| 5 | Large — cross-package change, significant tests |
| 8 | Complex — architecture change, broad test coverage |

Issues above 8 SP are automatically skipped (too large for a single automated PR).

---

## 8. Output Format

```
## Issue Analysis: #NNNN — <title>

**Repo:** eclipse-che/che-dashboard
**Type:** bug
**Package/Module:** dashboard-frontend

**Affected files:**
- packages/dashboard-frontend/src/components/Foo/index.tsx
- packages/dashboard-frontend/src/components/Foo/__tests__/index.spec.tsx

**Root cause hypothesis:** <what is broken and why>
**Fix scope:** <what to change>
**Story points:** 2

**Reproducible:** yes / no (reason)
**Ready to implement:** yes / no
```
