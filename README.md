# dev-workflow-ai

Autonomous AI software engineer for Eclipse Che — picks an issue, implements the fix, reviews the code, and opens a pull request unattended.

Review runs **before** the PR is opened so only clean code is published. Bundled knowledge pack covers the full Eclipse Che ecosystem (che-dashboard, che-server, devworkspace-operator, and more).

---

## Quick start

```bash
# 1. Clone and install
git clone https://github.com/olexii4/dev-workflow-ai
cd dev-workflow-ai
yarn install

# 2. Set credentials (.env file or shell exports)
export ANTHROPIC_API_KEY=sk-ant-...   # or GEMINI_API_KEY / ANTHROPIC_VERTEX_PROJECT_ID
export GITHUB_TOKEN=ghp_...           # required to open real PRs

# 3. Prepare the database (seeds Eclipse Che knowledge pack)
yarn dev:prepare

# 4. Start
yarn dev
```

Open **http://localhost:3000** — the agent UI is ready.

---

## Configuration

All configuration lives in `.env` (loaded automatically by `yarn dev`).

### LLM backend

Set **one** of the following — priority order matches the table:

| Variable | Backend | Notes |
|---|---|---|
| `ANTHROPIC_VERTEX_PROJECT_ID` | Claude via Vertex AI | Needs `GOOGLE_APPLICATION_CREDENTIALS_JSON` |
| `ANTHROPIC_API_KEY` | Claude (Anthropic) | Best quality, direct API |
| `GEMINI_API_KEY` | Gemini | Fast, generous free tier |
| `OLLAMA_BASE_URL` | External Ollama | `http://host:11434` — air-gapped / intranet |

### GitHub

```bash
GITHUB_TOKEN=ghp_...   # required for real PRs; omit for dry-run mode
```

Without `GITHUB_TOKEN` the agent writes a patch + PR description to `output/` instead of opening a PR.

### Jira (optional — for assigned-to-me issue sync)

```bash
JIRA_TOKEN=...
JIRA_EMAIL=you@example.com
JIRA_BASE_URL=https://your-org.atlassian.net
```

---

## Usage

### Run on an issue

From the **Issues** page: paste any GitHub or Jira issue URL and click **▶ Start**.

From the terminal:

```bash
yarn run-issue https://github.com/eclipse-che/che-dashboard/issues/1234
```

### Batch CVE fix

When multiple CVE / Security issues are open, the **Batch CVE fix** button on the Issues page combines them into a single PR (up to 15 issues per PR).

### Settings

| Setting | Default | Effect |
|---|---|---|
| Execution mode | Create Pull Request | Switch to *Export to Directory* to write files instead of opening PRs |
| Auto-approve min priority | major | Issues below this priority need manual approval |
| Daily autorun | disabled | Schedule the agent to pick and fix one issue per day |

---

## Open in Eclipse Che

```
https://<your-che-host>/f?url=https://github.com/olexii4/dev-workflow-ai
```

Eclipse Che reads `devfile.yaml`, provisions a single container (PGlite embedded — no sidecar needed), and exposes the agent UI at port 3000 automatically.

Set credentials once via the OpenShift secret:

```bash
./run/create-ocp-secret.sh
```

---

## Development

```bash
yarn dev:prepare   # seed DB from pg_seed/
yarn dev           # start API (tsx hot-reload, PGlite)
yarn dev:ui        # start webpack frontend dev server (port 5173)
yarn test          # run all tests
yarn build         # production build
```

API docs: **http://localhost:3000/swagger**

---

## Stack

- **LangGraph.js** — stateful agent graph with review→fix loop
- **React + PatternFly 6** — web UI; webpack build; CSS modules
- **Redux Toolkit** — state management
- **Fastify** — REST API + WebSocket; Swagger at `/swagger`
- **PGlite** — embedded Postgres-in-WASM; no sidecar required
- **Claude / Gemini / Ollama** — pluggable LLM backends
