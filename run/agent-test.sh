#!/usr/bin/env bash
#
# Copyright (c) 2026 Red Hat, Inc.
# This program and the accompanying materials are made
# available under the terms of the Eclipse Public License 2.0
# which is available at https://www.eclipse.org/legal/epl-2.0/
#
# SPDX-License-Identifier: EPL-2.0
#
# run/agent-test.sh — test the agent end-to-end in dry-run mode
#
# Dry-run means: no git push, no PR created.
# Output:
#   output/<repo>-<issue>/pr-description.md  — PR description the agent would open
#   output/<repo>-<issue>/changes.patch      — unified diff of proposed changes
#   output/<repo>-<issue>/analysis.md        — issue analysis (scope, affected files, SP)
#
# Usage:
#   ./run/agent-test.sh --issue https://github.com/eclipse-che/che/issues/20670
#   ./run/agent-test.sh --issue https://github.com/eclipse-che/che/issues/20670 --llm anthropic
#   ./run/agent-test.sh --issue https://github.com/eclipse-che/che/issues/20670 --llm vertex
#   ./run/agent-test.sh --issue https://github.com/eclipse-che/che/issues/20670 --stub
#
# Options:
#   --issue <url>       GitHub issue URL (required)
#   --llm <backend>     LLM backend: vertex | anthropic | gemini | ollama (default: auto-detect)
#   --project <slug>    Override project slug (auto-detected from repo URL if omitted)
#   --force-priority    Bypass priority check (run even if issue is low priority)
#   --skip-setup        Skip DB init + knowledge import (use if already set up)
#   --output <dir>      Output directory (default: ./output)
#   --model <name>      Model override for the selected backend
#   --stub              No DB, no LLM — template output only

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
cd "$ROOT"

# ── Parse args ─────────────────────────────────────────────────────────────

ISSUE_URL=""
PROJECT_OVERRIDE=""
FORCE_PRIORITY=false
SKIP_SETUP=false
OUTPUT_DIR="output"
STUB_MODE=false
LLM_BACKEND=""       # auto-detect if empty
MODEL_OVERRIDE=""    # model name override for the selected backend

while [[ $# -gt 0 ]]; do
  case "$1" in
    --issue)          ISSUE_URL="$2";          shift 2 ;;
    --project)        PROJECT_OVERRIDE="$2";   shift 2 ;;
    --output)         OUTPUT_DIR="$2";         shift 2 ;;
    --llm)            LLM_BACKEND="$2";        shift 2 ;;
    --model)          MODEL_OVERRIDE="$2";     shift 2 ;;
    --force-priority) FORCE_PRIORITY=true;     shift ;;
    --skip-setup)     SKIP_SETUP=true;         shift ;;
    --stub)           STUB_MODE=true;          shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [[ -z "$ISSUE_URL" ]]; then
  echo "Usage: $0 --issue <github-issue-url> [options]"
  echo ""
  echo "Example:"
  echo "  $0 --issue https://github.com/eclipse-che/che/issues/20670"
  exit 1
fi

# ── Load .env ──────────────────────────────────────────────────────────────

if [[ -f "$ROOT/.env" ]]; then
  set -a; source "$ROOT/.env"; set +a
  echo "[env] Loaded .env"
fi

export DATABASE_URL="${DATABASE_URL:-postgres://agent:agent@localhost:5433/devworkflow}"
export OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://localhost:11434}"
export OLLAMA_MODEL="${OLLAMA_MODEL:-qwen2.5-coder:7b}"
export KNOWLEDGE_DIR="${KNOWLEDGE_DIR:-$ROOT/pg_seed/eclipse-che}"

# ── LLM backend auto-detection ─────────────────────────────────────────────
# Priority: vertex > anthropic > gemini > ollama
# Override with --llm <backend>

detect_llm() {
  if [[ -n "${ANTHROPIC_VERTEX_PROJECT_ID:-}" ]]; then
    echo "vertex"
  elif [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
    echo "anthropic"
  elif [[ -n "${GEMINI_API_KEY:-}" ]]; then
    echo "gemini"
  elif curl -sf "$OLLAMA_BASE_URL/api/tags" &>/dev/null; then
    echo "ollama"
  else
    echo ""
  fi
}

if [[ -z "$LLM_BACKEND" ]]; then
  LLM_BACKEND="$(detect_llm)"
fi

# Apply model override to the right env var
if [[ -n "$MODEL_OVERRIDE" ]]; then
  case "$LLM_BACKEND" in
    vertex|anthropic) export ANTHROPIC_MODEL="$MODEL_OVERRIDE" ;;
    gemini)           export GEMINI_MODEL="$MODEL_OVERRIDE" ;;
    ollama)           export OLLAMA_MODEL="$MODEL_OVERRIDE" ;;
  esac
fi

# Human-readable LLM summary for the banner
llm_summary() {
  case "$LLM_BACKEND" in
    vertex)    echo "Claude via Vertex AI (project: ${ANTHROPIC_VERTEX_PROJECT_ID})" ;;
    anthropic) echo "Claude via Anthropic API (${ANTHROPIC_MODEL:-claude-sonnet-4-5})" ;;
    gemini)    echo "Gemini (${GEMINI_MODEL:-gemini-2.0-flash})" ;;
    ollama)    echo "Ollama ${OLLAMA_MODEL} @ ${OLLAMA_BASE_URL}" ;;
    *)         echo "none — use --llm or set API key env var" ;;
  esac
}

# ── Parse issue URL ────────────────────────────────────────────────────────

URL_MATCH=$(echo "$ISSUE_URL" | grep -oE 'github\.com/([^/]+)/([^/]+)/issues/([0-9]+)' || true)
if [[ -z "$URL_MATCH" ]]; then
  echo "[ERROR] Cannot parse GitHub issue URL: $ISSUE_URL"
  exit 1
fi

ISSUE_OWNER=$(echo "$URL_MATCH" | cut -d/ -f2)
ISSUE_REPO=$(echo "$URL_MATCH" | cut -d/ -f3)
ISSUE_NUMBER=$(echo "$URL_MATCH" | cut -d/ -f5)
REPO_SLUG="${ISSUE_OWNER}/${ISSUE_REPO}"

# Auto-detect project from known repos (case statement avoids associative array / key issues)
if [[ -n "$PROJECT_OVERRIDE" ]]; then
  PROJECT="$PROJECT_OVERRIDE"
else
  case "$REPO_SLUG" in
    "eclipse-che/che-dashboard")         PROJECT="che-dashboard" ;;
    "eclipse-che/che-server")            PROJECT="che-server" ;;
    "eclipse-che/che")                   PROJECT="che-dashboard" ;; # umbrella repo
    "eclipse-che/che-docs")              PROJECT="che-docs" ;;
    "devfile/devworkspace-operator")     PROJECT="devworkspace-operator" ;;
    "che-incubator/devworkspace-generator") PROJECT="devworkspace-generator" ;;
    "che-incubator/che-ai-tool-images")  PROJECT="che-ai-tool-images" ;;
    "che-incubator/dash-licenses")       PROJECT="dash-licenses" ;;
    *)                                   PROJECT="$ISSUE_REPO" ;;
  esac
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  dev-workflow-ai — agent dry-run test"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Issue:    $ISSUE_URL"
echo "  Repo:     $REPO_SLUG"
echo "  Project:  $PROJECT"
echo "  Mode:     DRY-RUN (no push, no PR)"
echo "  Output:   $ROOT/$OUTPUT_DIR"
echo "  LLM:      $(llm_summary)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── Check prerequisites ────────────────────────────────────────────────────

# Node.js
if ! command -v node &>/dev/null; then
  echo "[ERROR] Node.js not found. Install Node.js 22+."
  exit 1
fi
echo "[prereq] Node.js $(node --version) ✓"

# ── Stub mode: no DB, no LLM ───────────────────────────────────────────────
if [[ "$STUB_MODE" == "true" ]]; then
  echo "[mode] STUB — reading context from files, no LLM/DB required"
  echo ""
  STUB_ARGS=""
  [[ -n "$PROJECT_OVERRIDE" ]] && STUB_ARGS="--project=$PROJECT_OVERRIDE"
  npx tsx "$ROOT/scripts/run-issue-stub.ts" \
    "$ISSUE_URL" $STUB_ARGS \
    --output="$OUTPUT_DIR" \
    --samples="$ROOT/pg_seed/eclipse-che"
  exit $?
fi

# Check DB — extract host:port from DATABASE_URL and test TCP connectivity
DB_HOST=$(echo "$DATABASE_URL" | sed 's|.*@||; s|/.*||; s|:.*||')
DB_PORT=$(echo "$DATABASE_URL" | sed 's|.*@||; s|/.*||' | grep -oE ':[0-9]+' | tr -d ':')
DB_PORT="${DB_PORT:-5432}"

if nc -z "$DB_HOST" "$DB_PORT" &>/dev/null 2>&1; then
  echo "[prereq] PostgreSQL ✓ ($DB_HOST:$DB_PORT)"
elif node -e "
const net = require('net');
const s = net.createConnection($DB_PORT, '$DB_HOST');
s.on('connect', () => { process.exit(0); });
s.on('error', () => { process.exit(1); });
" &>/dev/null 2>&1; then
  echo "[prereq] PostgreSQL ✓ ($DB_HOST:$DB_PORT)"
else
  echo ""
  echo "[prereq] Cannot reach Postgres at $DB_HOST:$DB_PORT"
  echo "         Start it with: ./scripts/dev-local.sh --api"
  echo "         Or: docker run -d --name dwa-postgres -p 5433:5432 \\"
  echo "               -e POSTGRES_DB=devworkflow -e POSTGRES_USER=agent -e POSTGRES_PASSWORD=agent \\"
  echo "               postgres:16-alpine"
  exit 1
fi

# ── LLM prereq check ──────────────────────────────────────────────────────────
case "$LLM_BACKEND" in
  vertex)
    if [[ -z "${GOOGLE_APPLICATION_CREDENTIALS:-}" && -z "${GOOGLE_APPLICATION_CREDENTIALS_JSON:-}" ]]; then
      echo "[prereq] ⚠  Vertex AI: GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_APPLICATION_CREDENTIALS_JSON not set"
      echo "         Using Application Default Credentials (ADC) if configured."
    fi
    echo "[prereq] Vertex AI ✓ (project: ${ANTHROPIC_VERTEX_PROJECT_ID}, region: ${CLOUD_ML_REGION:-us-east5})"
    ;;
  anthropic)
    echo "[prereq] Claude API ✓ (key: ${ANTHROPIC_API_KEY:0:12}...)"
    ;;
  gemini)
    echo "[prereq] Gemini ✓ (model: ${GEMINI_MODEL:-gemini-2.0-flash})"
    ;;
  ollama)
    if ! curl -sf "$OLLAMA_BASE_URL/api/tags" &>/dev/null; then
      if command -v ollama &>/dev/null; then
        echo "[prereq] Ollama installed but not running — starting..."
        ollama serve &>/tmp/ollama-test.log &
        sleep 3
      fi
    fi
    if curl -sf "$OLLAMA_BASE_URL/api/tags" &>/dev/null; then
      # Auto-pull model if missing
      if ! curl -sf "$OLLAMA_BASE_URL/api/tags" | python3 -c "
import sys,json; d=json.load(sys.stdin)
sys.exit(0 if any('$OLLAMA_MODEL' in m.get('name','') for m in d.get('models',[])) else 1)
" 2>/dev/null; then
        echo "[prereq] Pulling $OLLAMA_MODEL..."
        ollama pull "$OLLAMA_MODEL" 2>&1 | grep -v "^$" | tail -3
      fi
      echo "[prereq] Ollama ✓ ($OLLAMA_MODEL @ $OLLAMA_BASE_URL)"
    else
      echo "[prereq] ✗  Ollama not reachable at $OLLAMA_BASE_URL"
      exit 1
    fi
    ;;
  *)
    echo ""
    echo "[prereq] ✗  No LLM configured. Set one of:"
    echo "   Vertex AI:   export ANTHROPIC_VERTEX_PROJECT_ID=my-project"
    echo "   Claude API:  export ANTHROPIC_API_KEY=sk-ant-..."
    echo "   Gemini:      export GEMINI_API_KEY=AIza..."
    echo "   Ollama:      start ollama or set OLLAMA_BASE_URL=http://host:11434"
    echo ""
    echo "   Or pass:     --llm anthropic|vertex|gemini|ollama"
    exit 1
    ;;
esac

# ── Setup: DB + knowledge import ───────────────────────────────────────────

if [[ "$SKIP_SETUP" == "false" ]]; then
  echo ""
  echo "[setup] Running DB migrations + importing Eclipse Che knowledge..."
  DATABASE_URL="$DATABASE_URL" \
  KNOWLEDGE_DIR="$ROOT/pg_seed/eclipse-che" \
    npx tsx "$ROOT/scripts/init-db.ts" 2>&1 \
    | grep -E "✓|Context files|Projects registered|Issue sources|Done|Error|✗" || true
  echo "[setup] ✓ DB ready"
fi

# ── Run agent (dry-run) ────────────────────────────────────────────────────

echo ""
echo "[agent] Starting dry-run on issue #$ISSUE_NUMBER..."
echo ""

EXTRA_ARGS=""
if [[ "$FORCE_PRIORITY" == "true" ]]; then
  EXTRA_ARGS="--force-priority=true"
fi

DATABASE_URL="$DATABASE_URL" \
OLLAMA_BASE_URL="$OLLAMA_BASE_URL" \
OLLAMA_MODEL="$OLLAMA_MODEL" \
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}" \
ANTHROPIC_VERTEX_PROJECT_ID="${ANTHROPIC_VERTEX_PROJECT_ID:-}" \
CLOUD_ML_REGION="${CLOUD_ML_REGION:-us-east5}" \
VERTEX_CLAUDE_MODEL="${VERTEX_CLAUDE_MODEL:-claude-sonnet-4-5@20251101}" \
GOOGLE_APPLICATION_CREDENTIALS="${GOOGLE_APPLICATION_CREDENTIALS:-}" \
GOOGLE_APPLICATION_CREDENTIALS_JSON="${GOOGLE_APPLICATION_CREDENTIALS_JSON:-}" \
GEMINI_API_KEY="${GEMINI_API_KEY:-}" \
GEMINI_MODEL="${GEMINI_MODEL:-gemini-2.0-flash}" \
KNOWLEDGE_DIR="$ROOT/pg_seed/eclipse-che" \
  npx tsx "$ROOT/scripts/run-issue-direct.ts" \
    "$ISSUE_URL" \
    --project="$PROJECT" \
    --output="$OUTPUT_DIR" \
    $EXTRA_ARGS

# ── Show output ────────────────────────────────────────────────────────────

OUT_SLUG="${ISSUE_OWNER}-${ISSUE_REPO}-${ISSUE_NUMBER}"
OUT_DIR="$ROOT/$OUTPUT_DIR/$OUT_SLUG"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Results"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [[ -d "$OUT_DIR" ]]; then
  echo ""
  echo "  Output directory: $OUT_DIR"
  echo ""
  ls -lh "$OUT_DIR" 2>/dev/null
  echo ""

  if [[ -f "$OUT_DIR/analysis.md" ]]; then
    echo "── Analysis ──────────────────────────────────────"
    cat "$OUT_DIR/analysis.md"
    echo ""
  fi

  if [[ -f "$OUT_DIR/pr-description.md" ]]; then
    echo "── PR Description ────────────────────────────────"
    cat "$OUT_DIR/pr-description.md"
    echo ""
  fi

  if [[ -f "$OUT_DIR/changes.patch" ]]; then
    PATCH_LINES=$(wc -l < "$OUT_DIR/changes.patch")
    echo "── Patch ($PATCH_LINES lines) — $OUT_DIR/changes.patch ──"
    head -60 "$OUT_DIR/changes.patch"
    if [[ "$PATCH_LINES" -gt 60 ]]; then
      echo "... ($(( PATCH_LINES - 60 )) more lines — see full file)"
    fi
  else
    echo "  ⚠  No patch generated (no local clone or no branch created)"
    echo "     To get a patch, set local_path in the subproject context.md"
    echo "     or clone the repo and set LOCAL_REPO_PATH env var"
  fi
else
  echo ""
  echo "  ⚠  No output directory found at $OUT_DIR"
  echo "     The agent may have been skipped (priority below threshold)."
  echo "     Re-run with --force-priority to bypass."
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Done"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
