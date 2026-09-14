#!/usr/bin/env bash
#
# Copyright (c) 2026 Red Hat, Inc.
# This program and the accompanying materials are made
# available under the terms of the Eclipse Public License 2.0
# which is available at https://www.eclipse.org/legal/epl-2.0/
#
# SPDX-License-Identifier: EPL-2.0
#
# wait-for-postgres.sh — wait until postgres is reachable, then start the API server.
#
# Why this exists:
#   In a Kubernetes / DevWorkspace pod all containers start in parallel.
#   The Node.js server tries to connect to postgres on boot; if postgres
#   isn't ready yet the process exits with a connection error and
#   Kubernetes puts the pod in CrashLoopBackOff.  This script polls
#   the TCP port until it responds, then exec's the real server process.
#
# Configuration (all optional — sensible defaults assumed):
#   DATABASE_URL   postgres://user:pass@host:port/db  (standard)
#   PGHOST         hostname override          (default: localhost)
#   PGPORT         port override              (default: 5432)
#   PG_WAIT_SECS   max seconds to wait       (default: 60)

set -euo pipefail

PG_WAIT_SECS="${PG_WAIT_SECS:-60}"
SERVER_CMD="node /app/packages/agent-backend/lib/server/index.cjs"

# ── Fast path: PGlite mode (no external postgres server) ─────────────────────
# When DATABASE_URL is unset the backend auto-selects PGlite (Postgres-in-WASM).
# No TCP wait needed — just start the server immediately.
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[startup] No DATABASE_URL set — using PGlite (embedded postgres). Starting server."
  exec $SERVER_CMD
fi

# ── Resolve host and port ─────────────────────────────────────────────────────

if [[ -n "${DATABASE_URL:-}" ]]; then
  # Extract host and port from the URL  (postgres://user:pass@HOST:PORT/db)
  PG_HOST=$(echo "$DATABASE_URL" | sed -E 's|.*@([^:/]+)[:/].*|\1|')
  PG_PORT=$(echo "$DATABASE_URL" | sed -E 's|.*:([0-9]+)/.*|\1|')
  # Fall back if sed extraction failed
  [[ "$PG_HOST" == "$DATABASE_URL" ]] && PG_HOST=""
  [[ "$PG_PORT" == "$DATABASE_URL" ]] && PG_PORT=""
fi

PG_HOST="${PGHOST:-${PG_HOST:-localhost}}"
PG_PORT="${PGPORT:-${PG_PORT:-5432}}"

# ── Phase 1: wait for TCP port to open ───────────────────────────────────────

echo "[wait-for-postgres] Waiting up to ${PG_WAIT_SECS}s for postgres at ${PG_HOST}:${PG_PORT} ..."

ELAPSED=0
until (echo > /dev/tcp/"${PG_HOST}"/"${PG_PORT}") 2>/dev/null; do
  if (( ELAPSED >= PG_WAIT_SECS )); then
    echo "[wait-for-postgres] Timed out waiting for TCP — starting server anyway"
    exec $SERVER_CMD
  fi
  sleep 1
  (( ELAPSED++ ))
  if (( ELAPSED % 5 == 0 )); then
    echo "[wait-for-postgres] Still waiting for TCP... ${ELAPSED}s elapsed"
  fi
done

echo "[wait-for-postgres] TCP open after ${ELAPSED}s. Waiting for DB to accept queries..."

# ── Phase 2: wait for actual DB readiness (initdb can take 5-10s after TCP opens) ──
# Postgres opens the TCP port before finishing initdb. A pg query confirms
# it is actually ready to serve connections.

DB_READY=0
for i in $(seq 1 30); do
  if node -e "
const { Client } = require('/app/node_modules/pg');
const c = new Client({
  host: '${PG_HOST}',
  port: ${PG_PORT},
  user: process.env.PGUSER || '${PG_HOST}',
  password: process.env.PGPASSWORD,
  database: 'postgres',
  connectionTimeoutMillis: 2000,
});
c.connect()
  .then(() => c.query('SELECT 1'))
  .then(() => { c.end(); process.exit(0); })
  .catch(() => { try { c.end(); } catch(e){} process.exit(1); });
" 2>/dev/null; then
    DB_READY=1
    break
  fi
  sleep 1
done

if [[ "$DB_READY" -eq 1 ]]; then
  echo "[wait-for-postgres] DB ready. Starting server."
else
  echo "[wait-for-postgres] DB query check timed out — starting server anyway (it has built-in retry)."
fi

# ── Hand off to the real server ───────────────────────────────────────────────

exec $SERVER_CMD
