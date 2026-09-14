#!/usr/bin/env bash
#
# Copyright (c) 2026 Red Hat, Inc.
# This program and the accompanying materials are made
# available under the terms of the Eclipse Public License 2.0
# which is available at https://www.eclipse.org/legal/epl-2.0/
#
# SPDX-License-Identifier: EPL-2.0
#
# start-postgres.sh — initialize and start PostgreSQL in the background.
#
# Designed to run inside a container as any non-root UID (OpenShift SCC).
# PGDATA=/tmp/pgdata is created by initdb, owned by the current UID — no
# chown/chmod of pre-existing dirs is needed.
#
# Called by workspace-entrypoint.sh before the main container process.

set -euo pipefail

PGDATA="${PGDATA:-/tmp/pgdata}"
POSTGRES_DB="${POSTGRES_DB:-devworkflow}"
POSTGRES_USER="${POSTGRES_USER:-agent}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-agent}"

log() { echo "[postgres] $*"; }

# ── Skip if already running ───────────────────────────────────────────────────
if pg_ctl -D "$PGDATA" status &>/dev/null; then
  log "Already running at $PGDATA"
  exit 0
fi

# ── Initialize data directory if empty ───────────────────────────────────────
if [[ ! -f "$PGDATA/PG_VERSION" ]]; then
  log "Initializing database at $PGDATA ..."
  mkdir -p "$PGDATA"
  initdb -D "$PGDATA" \
    --username="$POSTGRES_USER" \
    --pwfile=<(echo "$POSTGRES_PASSWORD") \
    --auth-local=trust \
    --auth-host=md5 \
    --no-instructions \
    -q
  log "initdb complete."

  # Allow TCP connections from localhost
  cat >> "$PGDATA/postgresql.conf" <<'EOF'
listen_addresses = 'localhost'
log_destination = 'stderr'
logging_collector = off
EOF

  # Restrict pg_hba.conf to local and loopback only
  cat > "$PGDATA/pg_hba.conf" <<EOF
local   all   all                 trust
host    all   all   127.0.0.1/32  md5
host    all   all   ::1/128       md5
EOF
fi

# ── Start postgres ────────────────────────────────────────────────────────────
log "Starting postgres..."
pg_ctl -D "$PGDATA" -l "$PGDATA/postgres.log" start -w -t 30
log "Started. Waiting for socket..."

# Wait for socket to appear (pg_ctl -w already waits, but belt+suspenders)
for i in $(seq 1 20); do
  pg_isready -h localhost -U "$POSTGRES_USER" &>/dev/null && break
  sleep 0.5
done

# ── Create app database if it doesn't exist ───────────────────────────────────
if ! psql -h localhost -U "$POSTGRES_USER" -lqt 2>/dev/null | cut -d'|' -f1 | grep -qw "$POSTGRES_DB"; then
  log "Creating database '$POSTGRES_DB'..."
  psql -h localhost -U "$POSTGRES_USER" -c "CREATE DATABASE \"$POSTGRES_DB\";" postgres
  log "Database created."
fi

log "PostgreSQL ready — ${POSTGRES_USER}@localhost:5432/${POSTGRES_DB}"
