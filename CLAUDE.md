# Project Rules

See @AGENTS.md for overall guidelines and subproject registry.

See @shared/rules/commit-conventions.md for commit trailer and message format.

## Purpose

This repository is an AI engineer bot for the Eclipse Che ecosystem. It automates the issue→PR→review→fix loop across multiple subprojects. Always load the relevant `pg_seed/eclipse-che/subprojects/<name>/context.md` before working on any subproject. Knowledge packs live in `pg_seed/` (not `target/`).

## Available Skills

Shared skills live in `shared/skills/<name>/SKILL.md` and are mirrored to `.claude/skills/` for Claude Code `/skill-name` invocation. Per-project skills live in `projects/<name>/skills/<name>/SKILL.md`. Invoke shared skills with `/<skill-name>`:

| Skill | Scope | When to use |
|---|---|---|
| `run-loop` | shared | Full autonomous loop: pick issue → implement → PR → monitor feedback |
| `filter-issues` | shared | Fetch open issues from a GitHub project, score and filter by rules |
| `pick-issue` | shared | Select next unassigned issue within story-point budget |
| `assign-story-points` | shared | Score an issue 1/2/3/5/8 based on complexity heuristics |
| `analyze-issue` | per-project | Parse issue context, map affected files, reproduce the problem |
| `fix-issue` | per-project | Implement a fix: branch, code, test, lint, PR |
| `review-pr` | per-project | Run rules engine checks on a PR diff |
| `fix-pr-feedback` | per-project | Fetch PR comments, triage, apply outstanding fixes |

## General Rules

- **No background agents**: Never use background agents (`Agent` tool with `run_in_background`, forks, or subagents). Execute all work directly in the current session.
- **Open PR via TypeScript API**: The `openPrNode` must create GitHub PRs using the GitHub REST API (`fetch` to `api.github.com`) — never via `gh pr create` CLI shell calls. In dev mode (`dryRun=true`, no `GITHUB_TOKEN`), write a `pr-description.md` file to `output/<slug>/` instead.
- **Clean branch before implementation**: Before any code change, the implementation node must: (1) fetch + reset the repo to the clean default branch (`git fetch --all && git checkout main && git reset --hard origin/main`), then (2) create a new feature branch (`git checkout -b <issue-branch-name>`). Never implement on an unclean working tree or on the default branch directly.

## Hard Rules

- **Always load context first**: Read `pg_seed/eclipse-che/context/eclipse-che-ecosystem.md` and `pg_seed/eclipse-che/subprojects/<name>/context.md` before any implementation work.
- **Always check rules.json**: Read the project's scoring and filtering rules before picking issues.
- **Never implement without analyze-issue**: Confirm scope, affected files, and story points before touching code.
- **Commit trailers**: Only `Assisted-by: {AGENT_NAME}`. Never `Made-with` or `Co-authored-by`.
- **Issue selection**: Only open issues. Skip any with labels: `wontfix`, `duplicate`, `stale`, `lifecycle/stale`, `needs-triage`, `blocked`. Skip `[Validate]` title issues (validation tickets, not implementation).
- **EPL-2.0 only**: All contributed code must be license-compatible with EPL-2.0. Never introduce code from incompatible licenses.
- **No `any` type**: In TypeScript projects (che-dashboard, devworkspace-generator), never use `any` or cast to `any`.
- **Backend bundle**: `packages/agent-backend` outputs `index.cjs` (not `.js`). `pg` and `@electric-sql/pglite` are in webpack `externals` — do not move them into the bundle. `tsconfig.webpack.json` must keep `esModuleInterop: true` — CJS modules like `gray-matter` break without it.
- **Database backend**: `db/client.ts` auto-selects: `DATABASE_URL` set → `pg.Pool` (real Postgres); unset → PGlite (Postgres-in-WASM, no server). For local testing without a postgres sidecar, just omit `DATABASE_URL`. Set `PGLITE_DATA_DIR=/app/data` for persistence.
- **Documentation**: Antora site lives in `docs/`. Playbook is `docs/antora-playbook.yml`. Build with `./docs/build.sh`. Supplemental UI overrides are in `docs/supplemental-ui/partials/`. Uses Antora 2.x — no extensions, attributes go in the playbook, version must be explicit (not `~`).
- **Local run entry point**: `run/run-local-podman.sh` — pulls and starts the pre-built app image with a Podman pod.
- **Postgres in OpenShift**: always set `PGDATA=/tmp/pgdata` on the postgres sidecar container. The default data dir (`/var/lib/postgresql/data`) is owned by UID 70 and inaccessible to OpenShift's assigned UID.
