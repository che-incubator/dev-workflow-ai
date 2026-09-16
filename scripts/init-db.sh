#!/usr/bin/env bash
# Copyright (c) 2026 Red Hat, Inc.
# EPL-2.0 — see LICENSE
#
# Seed the database from pg_seed/ knowledge files.
# Runs the built init-db.cjs bundle; tells you to build first if missing.
#
# Usage:
#   bash scripts/init-db.sh
#   bash scripts/init-db.sh --dir /path/to/knowledge
#   bash scripts/init-db.sh --dry-run

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUNDLE="$ROOT/packages/agent-backend/lib/server/init-db.cjs"

if [[ ! -f "$BUNDLE" ]]; then
  echo "✗ Built bundle not found: $BUNDLE"
  echo "  Run 'yarn build' first, then retry."
  exit 1
fi

# Load .env if present
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

exec node "$BUNDLE" "$@"
