# dev-workflow-ai — AI Engineer Bot for Eclipse Che

See @../AGENTS.md for overall project guidelines and subproject registry.

## What This Repo Does

Automates the Eclipse Che contribution loop:

```
Open Issue → Analyze → Implement → Review → PR
```

Review runs on the local branch diff **before** the PR is opened. Blocking findings trigger `fix_feedback` (max 3 rounds). The local branch is deleted after the PR is created.

**CVE rule**: Security / CVE issues always take priority (score floor 40). When 2–15 open CVE issues exist, use `Batch CVE fix` to combine them into one PR. See `pg_seed/eclipse-che/shared/rules/cve-batch.md`.

## Dev Commands

```bash
yarn start:prepare   # seed DB from pg_seed/eclipse-che/ + start API (first run)
yarn dev             # start API only (tsx hot-reload, PGlite, port 3000)
yarn start           # webpack frontend dev server (port 5173)
yarn test            # vitest run
yarn build           # production build (UI + API webpack)
```

## Knowledge Pack Structure

Context, rules, and skills for each project live in `pg_seed/eclipse-che/subprojects/<name>/`:

```
pg_seed/eclipse-che/
├── context/                   ← global ecosystem knowledge
├── shared/
│   ├── rules/                 ← issue-filtering, issue-analysis, cve-batch, commit-conventions
│   ├── skills/                ← run-loop, pick-issue, filter-issues, batch-cve-fix
│   └── sources.md             ← default issue sources (Jira for-you)
└── subprojects/
    └── che-dashboard/
        ├── context.md         ← project description, tech stack, local_path
        ├── context-patternfly.md
        ├── context-pr-template.md
        ├── rules/dev.md       ← commit format, license regen, CSS ordering
        └── skills/            ← fix-cve-dep, fix-issue, review-pr, pr-description, …
```

## Available Skills (Claude Code `/skill-name`)

| Skill | When to use |
|---|---|
| `/run-loop` | Full autonomous loop: pick → analyze → implement → PR |
| `/pick-issue` | Select next issue within story-point budget |
| `/filter-issues` | Score and rank open issues |
| `/assign-story-points` | Estimate complexity (1/2/3/5/8) |
| `/batch-cve-fix` | Combine 2–15 CVE issues into one branch + PR |

## Hard Rules

- Load `pg_seed/eclipse-che/subprojects/<name>/context.md` before any implementation.
- Only `open` issues; skip `wontfix`, `duplicate`, `stale`, `needs-triage`.
- `Assisted-by: {AGENT_NAME}` trailer in all commits — no `Made-with` or `Co-authored-by`.
- Story-point budget: default 3 per session.
- All generated code must be EPL-2.0 compatible.
- Run `yarn license:generate` after any `package.json` or `yarn.lock` change.
