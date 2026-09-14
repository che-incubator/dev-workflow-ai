#!/usr/bin/env bash
# dev-api.sh — start API with local development defaults.
#
# Sets sensible defaults so `yarn dev:api` works out of the box:
#   - PGlite (no postgres needed), data persisted in .local/pglite
#   - knowledge loaded from pg_seed/eclipse-che
#   - dry-run output written to output/ (PRs are NOT created unless GITHUB_TOKEN is set)
#
# Override any variable before running:
#   DATABASE_URL=postgres://... yarn dev:api   ← switch to real postgres
#   GITHUB_TOKEN=ghp_... yarn dev:api          ← enable real PR creation

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Forward SIGINT/SIGTERM to all child processes so tsx stops cleanly
# when the terminal is closed or Ctrl+C is pressed.
trap 'kill 0' SIGINT SIGTERM EXIT

# Load .env if present (shell env vars take precedence)
if [[ -f "$ROOT/.env" ]]; then
  set -a; source "$ROOT/.env"; set +a
  echo "[dev] Loaded .env"
fi

# PGlite persistent storage — no postgres server needed
export PGLITE_DATA_DIR="${PGLITE_DATA_DIR:-$ROOT/.local/pglite}"

# Local knowledge pack
export KNOWLEDGE_DIR="${KNOWLEDGE_DIR:-$ROOT/pg_seed/eclipse-che}"

# Dry-run artifact output directory
export OUTPUT_DIR="${OUTPUT_DIR:-$ROOT/output}"

mkdir -p "$ROOT/.local/pglite" "$ROOT/output"

# ── PGlite integrity check ─────────────────────────────────────────────────
# A previous force-kill can leave the WASM postgres in a corrupted state.
# Detect it now by running a quick startup; wipe and recreate on failure.
if [[ -n "${PGLITE_DATA_DIR:-}" && -d "$PGLITE_DATA_DIR" && -z "${DATABASE_URL:-}" ]]; then
  node --input-type=module <<'EOF' 2>/dev/null
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite(process.env.PGLITE_DATA_DIR);
await db.query('SELECT 1');
await db.close();
EOF
  if [[ $? -ne 0 ]]; then
    echo "[dev] PGlite data corrupted — wiping and starting fresh"
    rm -rf "$PGLITE_DATA_DIR"
    mkdir -p "$PGLITE_DATA_DIR"
  fi
fi

echo "[dev] PGLITE_DATA_DIR=$PGLITE_DATA_DIR"
echo "[dev] KNOWLEDGE_DIR=$KNOWLEDGE_DIR"
echo "[dev] OUTPUT_DIR=$OUTPUT_DIR"
if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "[dev] GITHUB_TOKEN not set — dry-run mode (no PRs, no GitHub identity)"
else
  export GITHUB_TOKEN
  echo "[dev] GITHUB_TOKEN set — real PR creation enabled, GitHub identity will be resolved"
fi
echo ""

# Clear stale GOOGLE_APPLICATION_CREDENTIALS file path — credentials are now
# stored inline in GOOGLE_APPLICATION_CREDENTIALS_JSON (set in .env or .zshrc)
unset GOOGLE_APPLICATION_CREDENTIALS

# Release port 3000 if still held by a previous dev process
PORT="${PORT:-3000}"
if lsof -ti :"$PORT" &>/dev/null; then
  echo "[dev] Port $PORT in use — releasing..."
  lsof -ti :"$PORT" | xargs kill -SIGTERM 2>/dev/null || true
  sleep 0.8
  # Force-kill any survivors
  lsof -ti :"$PORT" | xargs kill -SIGKILL 2>/dev/null || true
fi

exec node_modules/.bin/tsx packages/agent-backend/src/index.ts
