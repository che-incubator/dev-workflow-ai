#!/usr/bin/env bash
# Copyright (c) 2026 Red Hat, Inc.
# EPL-2.0 — see LICENSE
#
# Start the backend API in dev mode (tsx hot-reload, no build needed).
#
# Usage:
#   yarn start:watch
#   DATABASE_URL=postgres://... yarn start:watch   ← use real postgres
#   GITHUB_TOKEN=ghp_... yarn start:watch          ← enable real PR creation

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

trap 'kill 0' SIGINT SIGTERM EXIT

# Load .env if present (shell env vars take precedence)
if [[ -f "$ROOT/.env" ]]; then
  set -a; source "$ROOT/.env"; set +a
  echo "[dev] Loaded .env"
fi

export PGLITE_DATA_DIR="${PGLITE_DATA_DIR:-$ROOT/.local/pglite}"
export KNOWLEDGE_DIR="${KNOWLEDGE_DIR:-$ROOT/pg_seed/eclipse-che}"
export OUTPUT_DIR="${OUTPUT_DIR:-$ROOT/output}"

mkdir -p "$ROOT/.local/pglite" "$ROOT/output"

# PGlite corruption check
if [[ -d "$PGLITE_DATA_DIR" && -z "${DATABASE_URL:-}" ]]; then
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
if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "[dev] GITHUB_TOKEN not set — dry-run mode"
fi
echo ""

# Release port 3000 if held by a previous dev process
PORT="${PORT:-3000}"
if lsof -ti :"$PORT" &>/dev/null; then
  echo "[dev] Port $PORT in use — releasing..."
  lsof -ti :"$PORT" | xargs kill -SIGTERM 2>/dev/null || true
  sleep 0.8
  lsof -ti :"$PORT" | xargs kill -SIGKILL 2>/dev/null || true
fi

exec node_modules/.bin/tsx --watch packages/agent-backend/src/index.ts
