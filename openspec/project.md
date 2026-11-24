# dev-workflow-ai - Project Specification

## Overview

**dev-workflow-ai** is an autonomous AI software engineer bot that automates the Eclipse Che contribution loop: Open Issues → Analyze → Branch → Implement → Review → PR.

The bot runs as a web service with a backend (Fastify + LangGraph + PostgreSQL/PGlite) and frontend (React + PatternFly 6). It integrates with GitHub to fetch issues, generates fixes, and submits pull requests with automated review.

## Core Features

### 1. Issue Management

- Fetch open issues from GitHub projects (Jira for Eclipse Che subprojects)
- Filter issues by type, area, priority, story points
- Score issues by complexity heuristics (bug type, priority boosts, test coverage)
- Select issues within a story-point budget per session
- Assign story points (1/2/3/5/8) based on complexity

### 2. Issue Analysis

- Parse issue description, steps to reproduce, expected vs actual behavior
- Map affected files and components in target repositories
- Identify root causes and fix scope
- Check reproducibility and readiness to implement

### 3. Code Generation & Implementation

- Create feature branches from clean main branch
- Implement fixes using LLM (Claude, Gemini, Ollama)
- Run local tests and linting checks before committing
- Commit with proper trailers (Assisted-by, Signed-off-by)
- Push branch to GitHub

### 4. Automated Code Review

- Review local branch diff before PR submission
- Run static checks (TypeScript, ESLint, tests)
- Generate findings (bugs, efficiency issues, test coverage gaps)
- Triage findings and auto-fix blockers (max 3 feedback rounds)
- Re-review after fixes applied

### 5. Pull Request Creation

- Generate project-specific PR descriptions using LLM
- Include test plan and acceptance criteria
- Create GitHub PR via REST API
- Monitor PR feedback and apply fixes

### 6. CVE Batch Handling

- Identify security/CVE issues and prioritize them (score floor 40)
- Combine 2–15 CVE issues into single branch + PR
- Apply batch CVE fixes with proper testing

### 7. Scheduler & Auto-run

- Only issues with story points are eligible; unestimated issues remain in the list and can be
  started manually with Force priority
- Daily autonomous loop via cron scheduler
- Continuously cycle: pick → analyze → implement → review → PR
- Respect repository locks (per-repo mutex for concurrent safety)
- Configurable LLM model and provider (Vertex AI, Claude API, Ollama). Two tiers: a fast model
  for scoring and triage, a deep model for analyze/implement/review. Defaults are centralised in
  `packages/agent-backend/src/llm/defaults.ts` and default to Claude Haiku 4.5

## Architecture

### Backend (Fastify + LangGraph)

```
packages/agent-backend/src/
├── agent/                     # LangGraph agent graph and state
├── nodes/                     # Agent nodes (analyze, implement, review, openPr, fixFeedback, etc.)
├── api/routes/                # REST endpoints
│   ├── runs.ts                # GET/POST runs, run status, run logs
│   ├── projects.ts            # Project management
│   ├── issues.ts              # Issue fetching and scoring
│   ├── sources.ts             # Issue source configuration
│   └── settings.ts            # Settings, LLM model, API keys
├── llm/                       # LLM client abstraction (Claude, Gemini, Ollama, Vertex AI)
├── db/                        # Database (migrations, schema, PGlite/Postgres client)
├── scheduler/                 # Cron-based auto-run scheduler
└── utils/                     # Repository lock, helpers
```

### Frontend (React + PatternFly 6)

```
packages/agent-frontend/src/
├── pages/                     # Page components
│   ├── RunsPage               # List and monitor runs
│   ├── ProjectsPage           # Manage projects and sources
│   ├── SettingsPage           # Configure LLM, API keys, schedule
│   └── DashboardPage          # Overview and statistics
├── containers/                # Redux-connected route wrappers
├── store/                     # Redux Toolkit slices (runs, projects)
├── services/                  # API client, helpers
└── components/                # Reusable UI components
```

### Knowledge Pack Structure

```
pg_seed/eclipse-che/
├── context/                   # Ecosystem-level knowledge
│   └── eclipse-che-ecosystem.md
├── shared/
│   ├── rules/                 # Issue filtering, analysis, CVE batch, commit conventions
│   ├── skills/                # run-loop, pick-issue, filter-issues, batch-cve-fix
│   └── sources.md             # Default issue sources
└── subprojects/
    └── <project-name>/
        ├── context.md         # Project description, tech stack, local_path
        ├── rules/dev.md       # Commit format, license, code style
        └── skills/            # Project-specific skills
```

## API Endpoints

### Runs

- `GET /api/runs` — list all runs with pagination
- `POST /api/runs` — start new run (manual trigger)
- `GET /api/runs/:id` — get run details, status, logs
- `GET /api/runs/:id/logs` — stream run logs (Server-Sent Events)

### Projects

- `GET /api/projects` — list configured projects
- `POST /api/projects` — add new project
- `GET /api/projects/:id` — get project details
- `PATCH /api/projects/:id` — update project config
- `DELETE /api/projects/:id` — remove project

### Issues

- `GET /api/projects/:id/issues` — fetch and score open issues
- `POST /api/projects/:id/issues/:issueId/assign` — assign to self

### Sources

- `GET /api/sources` — list issue sources (GitHub org, Jira, etc.)
- `POST /api/sources` — add new issue source
- `PATCH /api/sources/:id` — update source config

### Settings

- `GET /api/settings` — get global settings (LLM model, API keys, schedule)
- `PATCH /api/settings` — update settings

### Swagger

- `GET /swagger` — Swagger UI and OpenAPI spec

### Health

- `GET /health` — `{ status, ts, dbInstanceId }`. `dbInstanceId` is a UUID generated once per
  database and stored in `settings`; it changes whenever the database is recreated. Clients use
  it to discard browser-local state referring to rows that no longer exist.

### WebSocket

- `GET /ws` — two subscription kinds:
  - `{"subscribe": "<threadId>"}` — that run's `node_start`, `node_complete`, `log`,
    `run_complete`, `run_failed` events
  - `{"subscribe": "runs"}` — `runs_changed` notifications on run lifecycle transitions, used by
    run-list views instead of polling `GET /api/runs`

## Database Schema

### Tables

- `agent_runs` — execution records (status, branch, PR URL, logs)
- `run_events` — per-run node and log events
- `findings` — review findings per run
- `projects` — target subprojects, registered from `context.md` frontmatter
- `issues` — cached issue metadata, including `story_points` (autorun requires it)
- `issue_sources` — issue source definitions, including `last_error` (empty when healthy)
- `issue_plans` — short implementation plan per issue
- `settings` — global configuration, including `db_instance_id`
- `llm_providers` — configured LLM backends and their active model

### Migrations

Located in `packages/agent-backend/src/db/migrations/`, applied automatically on startup.

## Security

- **GitHub authentication**: REST API calls use `GITHUB_TOKEN` from environment
- **LLM API keys**: Stored securely in database (encrypted at rest in Postgres, in-memory only)
- **Repository lock**: Per-repo mutex prevents concurrent runs on the same project
- **Dependency pinning**: All transitive CVE-flagged dependencies pinned via `resolutions`
- **Credential verification**: Jira Cloud answers issue searches for anonymous callers on
  publicly browsable projects, so an invalid token returns HTTP 200 with an empty result rather
  than a 401. Jira sync verifies against `/rest/api/3/myself` before trusting an empty search.
  Sync failures are recorded in `issue_sources.last_error` and surfaced in the UI

## Development

See [AGENTS.md](../AGENTS.md) for development commands and conventions.

## Features Under Development

This section tracks features in active development:

- [ ] Multi-repository batch fixing (combine related issues across repos)
- [ ] Custom review rule engine (per-project review policies)
- [ ] Incremental issue re-scoring (update scores as context evolves)
- [ ] Jira integration (automatic Jira issue creation for failed runs)
