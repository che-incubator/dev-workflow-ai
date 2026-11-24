# AI Agent Guidelines — dev-workflow-ai

## What This Bot Does

Autonomous AI engineer that runs the Eclipse Che contribution loop:

```
Open Issues → Analyze → Branch → Implement → Review → PR
```

Review runs on the local branch diff **before** the PR is opened. Blocking findings trigger `fix_feedback` (max 3 rounds); after fixes the branch is re-reviewed. CVE / Security issues always run first — up to 15 CVEs can be combined into one PR via `Batch CVE fix`.

## Repository Structure

```
dev-workflow-ai/
├── packages/
│   ├── agent-backend/src/           ← Fastify + LangGraph + PostgreSQL (TypeScript)
│   │   ├── agent/                   ← LangGraph graph, state
│   │   ├── api/routes/              ← REST API (runs, projects, issues, sources, settings)
│   │   ├── db/                      ← migrations, schema, PGlite client
│   │   ├── llm/                     ← LLM client (Vertex AI, Claude, Gemini, Ollama)
│   │   │   └── defaults.ts          ← DEFAULT_MODELS / FAST_MODELS — the only place model ids live
│   │   ├── nodes/                   ← agent nodes (analyze, implement, review, openPr, …)
│   │   ├── scheduler/               ← daily autorun scheduler
│   │   ├── api/ws/agentStream.ts    ← WebSocket: per-run channel + "runs" run-list channel
│   │   └── utils/                   ← repoLock (per-repo mutex)
│   └── agent-frontend/src/          ← React + PatternFly 6 + Redux Toolkit (webpack)
│       ├── containers/              ← Redux-connected route wrappers
│       ├── pages/                   ← Pure-props page components
│       ├── store/                   ← Runs, Projects slices
│       └── services/                ← api/, helpers/
├── pg_seed/eclipse-che/             ← Knowledge packs
│   ├── context/                     ← Ecosystem-level knowledge
│   ├── shared/rules/                ← Commit conventions, issue analysis, CVE batch rules
│   ├── shared/skills/               ← run-loop, pick-issue, filter-issues, batch-cve-fix
│   └── subprojects/<name>/          ← Per-project context, rules, skills
│       └── che-dashboard/           ← context.md, rules/dev.md, skills/fix-cve-dep, …
├── docs/                            ← Antora documentation site (AsciiDoc)
│   ├── antora.yml                   ← Component descriptor
│   ├── antora-playbook.yml          ← Antora playbook (build config)
│   ├── build.sh                     ← Build and serve script (--serve for local preview)
│   ├── supplemental-ui/             ← Custom header, footer, partials
│   └── modules/                     ← ROOT, getting-started, usage, architecture, development, deployment
├── run/
│   ├── deploy-ocp.sh                ← Deploy to OpenShift using the pre-built image
│   └── run-local-podman.sh          ← Run locally with Podman (pulls pre-built image)
├── scripts/
│   ├── dev-api.sh                   ← Start API (PGlite, hot-reload)
│   └── init-db.sh                   ← Seed DB from pg_seed/ (runs built init-db.cjs)
├── devfile.yaml                     ← Eclipse Che DevWorkspace (PGlite, single container)
└── .claude/                         ← Claude Code skills + rules for this repo
```

## Dev Commands

```bash
yarn build           # webpack build (backend + frontend)
yarn prepare:db      # seed DB from pg_seed/ (requires build)
yarn start           # run the built API server (port 3000)
yarn start:frontend  # webpack frontend dev server (port 5173)
yarn start:watch     # dev mode — tsx hot-reload, no build needed
yarn test            # vitest
./docs/build.sh      # build Antora docs → build/site/
./docs/build.sh --serve  # build and serve docs on port 4000
```

API docs: http://localhost:3000/swagger
Antora docs: http://localhost:3000/docs/ (requires `./docs/build.sh` first)

## Eclipse Che Deployment

```bash
# 1. Create credentials secret before opening the workspace (once per namespace)
oc login ...
oc apply -f - <<EOF
kind: Secret
apiVersion: v1
metadata:
  name: github-token
  labels:
    controller.devfile.io/mount-to-devworkspace: 'true'
    controller.devfile.io/watch-secret: 'true'
  annotations:
    controller.devfile.io/mount-as: env
data:
  GITHUB_TOKEN: <base64-encoded-value>   # echo -n 'ghp_...' | base64
type: Opaque
EOF

# 2. Open factory URL
https://<che-host>/f?url=https://github.com/che-incubator/dev-workflow-ai
```

The DevWorkspace Operator injects secret keys as env vars automatically via:
```yaml
controller.devfile.io/mount-to-devworkspace: "true"
controller.devfile.io/mount-as: env
```

## Subproject Registry

| Subproject | GitHub | Local Path | Stack |
|---|---|---|---|
| che-dashboard | eclipse-che/che-dashboard | /projects/repos/eclipse-che/che-dashboard | TS, React 18, PF6, Redux |
| che-server | eclipse-che/che-server | /projects/repos/eclipse-che/che-server | Java, Maven |
| che-docs | eclipse-che/che-docs | /projects/repos/eclipse-che/che-docs | AsciiDoc, Antora |
| che-ai-tool-images | che-incubator/che-ai-tool-images | /projects/repos/che-incubator/che-ai-tool-images | Dockerfile |
| devworkspace-generator | devfile/devworkspace-generator | /projects/repos/devworkspace-generator | TypeScript |
| devworkspace-operator | devfile/devworkspace-operator | /projects/repos/devfile/devworkspace-operator | Go, Operator SDK |
| dash-licenses | che-incubator/dash-licenses | /projects/repos/che-incubator/dash-licenses | Java, Maven |

## Invariants — easy to get wrong

Each of these has already caused a bug. Read before touching the area.

### Knowledge packs

- `loadContext()` selects `WHERE project_slug IN ('global', 'shared', <slug>)`. Content under
  `shared/` reaches every subproject — put one copy there rather than seven under `subprojects/`.
- **Never call `loadContext` with a bare `skills-*` wildcard.** The filter supports prefix
  wildcards and would concatenate every skill body into one prompt.
- `shared/rules/<name>.md` → `rules-<name>`: a standing constraint, applied unconditionally.
  `shared/skills/<name>/SKILL.md` → `skills-<name>`: a procedure, loaded only when a node names it.
- A subproject file does **not** override a shared file of the same name. Both rows are returned
  and concatenated, ordered `global` → `shared` → project, so the subproject text appends last.
- `.claude/skills/` is a mirror of `pg_seed/eclipse-che/shared/skills/`, maintained by hand and
  prone to drift. Change `pg_seed/` first.

### LLM models

- Model ids live only in `packages/agent-backend/src/llm/defaults.ts`. Do not reintroduce string
  literals at call sites.
- Anthropic API ids use `-YYYYMMDD`; Vertex AI ids use `@YYYYMMDD`. They are not interchangeable.
- Two tiers: `llm` (fast — scoring, priority, story points) and `llmDeep` (analyze, implement,
  review). `buildVertexAnthropicLLM()` with no argument reads the *deep* model, so the fast path
  must pass its model explicitly.
- A provider row's `model` is what the nodes actually run on, not a display value.

### Live updates

- The UI does not poll for run state. Subscribe to the `runs` WebSocket channel and reload on
  `runs_changed`. Do not add `setInterval` polling of `/api/runs`.
- Broadcast only on lifecycle transitions, never per log line.

### Issue sources

- A failed sync must record `last_error` on the source. Console-only logging leaves the UI showing
  "Never" with no explanation.
- Do not set `last_synced_at` on a failed attempt — a failing source must not look up to date.
- Jira Cloud answers issue searches for **anonymous** callers on publicly browsable projects. A
  bad token yields HTTP 200 with an empty list, not a 401. Always verify credentials against
  `/rest/api/3/myself` before trusting an empty search result.

### Autorun

- Autorun only picks issues with story points. Unestimated issues stay in the list and remain
  runnable by hand via *Force priority*.

## Red Hat Compliance

- All code EPL-2.0 compatible
- `Assisted-by: {AGENT_NAME}` trailer in all commits — never `Made-with` or `Co-authored-by`
- Run `yarn license:generate` after any `package.json` change
- Never include credentials, tokens, or secrets in code
