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
│   │   ├── nodes/                   ← agent nodes (analyze, implement, review, openPr, …)
│   │   ├── scheduler/               ← daily autorun scheduler
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
├── run/
│   └── create-ocp-secret.sh         ← Create OpenShift secret for credentials
├── scripts/
│   ├── dev-api.sh                   ← Start API (PGlite, hot-reload)
│   ├── init-db.ts                   ← Seed DB from pg_seed/
│   └── run-issue-direct.ts          ← Run agent directly on an issue URL
├── devfile.yaml                     ← Eclipse Che DevWorkspace (PGlite, single container)
└── .claude/                         ← Claude Code skills + rules for this repo
```

## Dev Commands

```bash
yarn start:prepare   # seed DB from pg_seed/eclipse-che/ + start API (first run)
yarn dev             # start API only (tsx, PGlite, port 3000)
yarn start           # webpack frontend dev server (port 5173)
yarn test            # vitest
yarn build           # production webpack build (UI + API)
```

API docs: http://localhost:3000/swagger

## Eclipse Che Deployment

```bash
# 1. Create secret before opening the workspace
oc login ...
./run/create-ocp-secret.sh --namespace <ns> --sa-file ~/gcp-sa.json

# 2. Open factory URL
https://<che-host>/f?url=https://github.com/olexii4/dev-workflow-ai
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
| devworkspace-generator | che-incubator/devworkspace-generator | /projects/repos/devworkspace-generator | TypeScript |
| devworkspace-operator | devfile/devworkspace-operator | /projects/repos/devfile/devworkspace-operator | Go, Operator SDK |
| dash-licenses | che-incubator/dash-licenses | /projects/repos/che-incubator/dash-licenses | Java, Maven |

## Red Hat Compliance

- All code EPL-2.0 compatible
- `Assisted-by: {AGENT_NAME}` trailer in all commits — never `Made-with` or `Co-authored-by`
- Run `yarn license:generate` after any `package.json` change
- Never include credentials, tokens, or secrets in code
