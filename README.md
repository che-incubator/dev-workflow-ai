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

# 3. Prepare and start (seeds DB + starts API in one step)
yarn start:prepare
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

Credentials are injected into the workspace from an OpenShift Secret. The flow is:

```
.env.example → .env (fill values) → create-ocp-secret.sh → Secret → devfile.yaml workspace
```

### Step 1 — Prepare `.env`

```bash
cp .env.example .env
# Edit .env and fill in your values
```

`.env.example` documents every variable with comments. The minimum set:

```bash
GITHUB_TOKEN=ghp_...                    # open real PRs (omit for dry-run)
ANTHROPIC_VERTEX_PROJECT_ID=my-project  # or ANTHROPIC_API_KEY / GEMINI_API_KEY
GOOGLE_APPLICATION_CREDENTIALS_JSON='{...json...}'
JIRA_TOKEN=...                          # optional — Jira issue sync
JIRA_EMAIL=you@example.com
```

### Step 2 — Create the OpenShift secret (once per namespace)

Do this **before** opening the workspace. The DevWorkspace Operator reads the secret and auto-injects its keys as env vars.

```bash
oc login https://<your-ocp-api-url>

# Reads credentials from env vars (loaded from .env by your shell, or set them explicitly)
source .env
./run/create-ocp-secret.sh --namespace <your-workspace-namespace>
```

The script creates a Secret named `dev-workflow-ai-secrets` with these labels so the DevWorkspace Operator picks it up automatically:

```yaml
controller.devfile.io/mount-to-devworkspace: "true"
controller.devfile.io/mount-as: env
```

> **Important**: `devfile.yaml` intentionally does **not** list credential env vars. Any `value: ""` in the devfile would override the secret injection with an empty string. Only non-sensitive config (`PGLITE_DATA_DIR`, `KNOWLEDGE_DIR`, `OLLAMA_MODEL`) is set in the devfile.

### Alternative — inject individual secrets via `oc apply`

Instead of the script, you can create one secret per credential manually. Each secret needs these labels so the DevWorkspace Operator mounts it as env vars:

```bash
# Encode your value first:
echo -n 'your-actual-value' | base64
```

Then apply a secret for each variable you need:

```bash
oc apply -f - <<EOF
kind: Secret
apiVersion: v1
metadata:
  name: gemini-api-key
  labels:
    controller.devfile.io/mount-to-devworkspace: 'true'
    controller.devfile.io/watch-secret: 'true'
  annotations:
    controller.devfile.io/mount-as: env
data:
  GEMINI_API_KEY: <base64-encoded-value>
type: Opaque
EOF
```

Repeat for each variable (use a different `name` per secret):

| Secret name | `data` key | Description |
|---|---|---|
| `github-token` | `GITHUB_TOKEN` | GitHub PAT for opening PRs |
| `anthropic-api-key` | `ANTHROPIC_API_KEY` | Claude direct API key |
| `gemini-api-key` | `GEMINI_API_KEY` | Gemini API key |
| `jira-credentials` | `JIRA_TOKEN`, `JIRA_EMAIL` | Jira access (one secret, two keys) |
| `vertex-credentials` | `ANTHROPIC_VERTEX_PROJECT_ID`, `GOOGLE_APPLICATION_CREDENTIALS_JSON` | Vertex AI (one secret, two keys) |

> Multiple keys in one secret are fine — add them as separate entries under `data`.

---

### Step 3 — Open the workspace

```
https://<your-che-host>/f?url=https://github.com/olexii4/dev-workflow-ai
```

Eclipse Che reads `devfile.yaml`, provisions the container (PGlite embedded — no sidecar), and exposes the agent UI at port 3000. The secret values are available immediately.

Verify inside the workspace:

```bash
echo $GITHUB_TOKEN
echo $ANTHROPIC_VERTEX_PROJECT_ID
```

---

## Development

```bash
yarn start:prepare   # seed DB from pg_seed/ + start API (combined first-run)
yarn dev             # start API only (PGlite, tsx hot-reload)
yarn start           # start webpack frontend dev server (port 5173)
yarn test            # run all tests
yarn build           # production build
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
