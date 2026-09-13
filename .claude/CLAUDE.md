# dev-workflow-ai — AI Engineer Bot for Eclipse Che

See @../AGENTS.md for overall project guidelines and subproject registry.

## What This Repo Does

Automates the Eclipse Che contribution loop:

```
Open Issue → Analyze → Branch → Implement → Review → PR → Merge
```

Review runs on the local branch diff **before** the PR is opened. Blocking findings trigger `fix_feedback`; after fixes the branch is re-reviewed. The local branch is deleted after the PR is created.

Rules and context for each subproject live in `pg_seed/eclipse-che/subprojects/<name>/`. Shared skills
live in `.claude/skills/`. Pre-loaded ecosystem knowledge: `pg_seed/eclipse-che/context/eclipse-che-ecosystem.md`.

**CVE rule**: Security / CVE issues always take priority (score floor 40). When 2–9 open CVE issues exist,
use `/batch-cve-fix` to combine them into one PR. See `pg_seed/eclipse-che/shared/rules/cve-batch.md`.

## Available Skills (Claude Code `/skill-name`)

Shared skills — in `.claude/skills/` (mirrored from `shared/skills/`):

| Skill | Path | When to use |
|---|---|---|
| `/run-loop` | `shared/skills/run-loop/SKILL.md` | Full autonomous loop: pick → analyze → implement → PR → monitor |
| `/pick-issue` | `shared/skills/pick-issue/SKILL.md` | Select next qualifying unassigned issue within story-point budget |
| `/filter-issues` | `shared/skills/filter-issues/SKILL.md` | Fetch and score open issues from a GitHub project per rules.json |
| `/assign-story-points` | `shared/skills/assign-story-points/SKILL.md` | Estimate complexity: 1 / 2 / 3 / 5 / 8 |

## Project-Specific Skills

Each subproject has skills under `pg_seed/eclipse-che/subprojects/<name>/skills/<skill>/SKILL.md`.

| Project | Implemented skills |
|---|---|
| `che-dashboard` | `analyze-issue`, `fix-issue`, `review-pr` |
| `che-server` | `analyze-issue` |

Usage — load project context, then follow the skill file:
```
Read pg_seed/eclipse-che/subprojects/che-dashboard/context.md, then follow pg_seed/eclipse-che/subprojects/che-dashboard/skills/fix-issue/SKILL.md
```

## Workflows

Run these with the Workflow tool or `claude --workflow`:

| Workflow | Purpose |
|---|---|
| `workflows/implement.js` | Autonomous issue implementation: analyze → branch → implement → test → PR |
| `workflows/review.js` | Post-implementation review: Tier 1 + trigger-based Tier 2 checks → post findings |

## Hard Rules

- **Always** load context files in order — see `.claude/rules/context-loading.md` for the exact sequence.
- **Always** load `pg_seed/eclipse-che/context/eclipse-che-ecosystem.md` and `pg_seed/eclipse-che/subprojects/<name>/context.md` before any implementation work.
- **Always** check `rules.json` for the project's coding standards.
- **Never** implement a fix without first running `analyze-issue` to confirm scope and affected files.
- **Issue selection**: only `open` issues; skip `wontfix`, `duplicate`, `stale`, `lifecycle/stale`, `needs-triage`.
- **Commit trailers**: `Assisted-by: {AGENT_NAME}` — no other AI trailers.
- **Story-point budget**: default 3 points per session (configurable in `rules.json`).
- **License**: all generated source code must be EPL-2.0 compatible.

## Rules

- General commit conventions: see `.claude/rules/commit-conventions.md`
- Issue analysis rules: see `.claude/rules/issue-analysis.md`
- Issue filtering rules: see `.claude/rules/issue-filtering.md`

## Review Pattern (from ok-pr-review)

Post-implementation review follows ok-pr-review's tiered model (see `tmp/08-analysis-ok-plugins.md`):

- **Completion markers** — `IMPLEMENT_COMPLETE: owner/repo#N` gates the review step
- **Tier 1** (always): EPL-2.0 header, no `any`, lint/format clean, coverage not regressed
- **Tier 2** (trigger-based): Redux check on `createSlice`; license check on `package.json` change; route check on new Fastify handler
- **Tier 3** (evolvability): hardcoded assumptions, extension cost
- **Filesystem persistence** — analysis saved to `$HOME/.claude/dev-workflow-ai/{project}/{issue}-*.md`

## Architecture Reference

See `tmp/07-analysis-che-ai-assistant.md` — che-ai-assistant is the execution runtime (Go + DevWorkspace + Claude CLI). This repo provides the rules, context, and templates layer on top of it.
