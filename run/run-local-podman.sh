#!/usr/bin/env bash
#
# Copyright (c) 2026 Red Hat, Inc.
# This program and the accompanying materials are made
# available under the terms of the Eclipse Public License 2.0
# which is available at https://www.eclipse.org/legal/epl-2.0/
#
# SPDX-License-Identifier: EPL-2.0
#
# run/run-local-podman.sh — run dev-workflow-ai locally with Podman (pre-built image)
#
# Default mode: single container, PGlite embedded database (no postgres needed).
# Optional:     --with-postgres  uses a Podman pod + postgres sidecar instead.
#
# Usage:
#   ./run/run-local-podman.sh                  # PGlite, pull image, start
#   ./run/run-local-podman.sh --with-postgres   # postgres sidecar via Podman pod
#   ./run/run-local-podman.sh --with-ollama     # also start Ollama container
#   ./run/run-local-podman.sh --stop            # stop and remove container/pod
#   ./run/run-local-podman.sh --logs            # tail app logs
#
# App URL:  http://localhost:3000

set -euo pipefail

APP_IMAGE="quay.io/oorel/dev-workflow-ai:latest"
POSTGRES_IMAGE="docker.io/postgres:16-alpine"
CONTAINER_NAME="dev-workflow-ai"
POD_NAME="dev-workflow-ai"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"

# ── Parse args ────────────────────────────────────────────────────────────────

WITH_POSTGRES=false
WITH_OLLAMA=false
OLLAMA_MODEL="${OLLAMA_MODEL:-qwen2.5-coder:7b}"

for arg in "$@"; do
  case "$arg" in
    --with-postgres) WITH_POSTGRES=true ;;
    --with-ollama)   WITH_OLLAMA=true ;;
    --stop)
      echo "Stopping..."
      podman pod stop  "$POD_NAME" 2>/dev/null || true
      podman pod rm -f "$POD_NAME" 2>/dev/null || true
      podman stop      "$CONTAINER_NAME" 2>/dev/null || true
      podman rm -f     "$CONTAINER_NAME" 2>/dev/null || true
      echo "Done."
      exit 0
      ;;
    --logs)
      podman logs -f "${CONTAINER_NAME}-app" 2>/dev/null \
        || podman logs -f "$CONTAINER_NAME" 2>/dev/null \
        || echo "No container running. Start with: $0"
      exit 0
      ;;
  esac
done

# ── Require podman ────────────────────────────────────────────────────────────

if ! command -v podman &>/dev/null; then
  echo "ERROR: podman not found."
  echo "  macOS: brew install podman && podman machine init && podman machine start"
  echo "  Linux: sudo dnf install podman"
  exit 1
fi

# macOS: ensure podman machine is running
if [[ "$(uname)" == "Darwin" ]] && ! podman info &>/dev/null 2>&1; then
  echo "Starting podman machine..."
  podman machine start 2>/dev/null || true
  sleep 5
fi

# ── Pull image ────────────────────────────────────────────────────────────────

echo "==> Pulling $APP_IMAGE (if not cached)..."
podman pull "$APP_IMAGE" 2>/dev/null || true

# ── Start Ollama (optional) ───────────────────────────────────────────────────

OLLAMA_URL=""
if [[ "$WITH_OLLAMA" == "true" ]]; then
  podman stop dev-workflow-ai-ollama 2>/dev/null || true
  podman rm -f dev-workflow-ai-ollama 2>/dev/null || true

  echo "==> Starting Ollama ($OLLAMA_MODEL)..."
  podman run -d \
    --name dev-workflow-ai-ollama \
    -p 11434:11434 \
    docker.io/ollama/ollama:latest
  OLLAMA_URL="http://localhost:11434"

  echo "    Pulling model $OLLAMA_MODEL inside Ollama..."
  podman exec dev-workflow-ai-ollama ollama pull "$OLLAMA_MODEL"

  echo "    Waiting for Ollama to be ready..."
  for i in $(seq 1 30); do
    curl -sf "http://localhost:11434/api/tags" &>/dev/null && break
    sleep 2
    (( i % 5 == 0 )) && echo "    ${i}s elapsed..."
  done
  echo "    Ollama ready: $OLLAMA_MODEL"
fi

# ── Stop / remove any previous run ───────────────────────────────────────────

podman pod stop  "$POD_NAME"      2>/dev/null || true
podman pod rm -f "$POD_NAME"      2>/dev/null || true
podman stop      "$CONTAINER_NAME" 2>/dev/null || true
podman rm -f     "$CONTAINER_NAME" 2>/dev/null || true
podman rm -f     "${POD_NAME}-app" "${POD_NAME}-postgres" 2>/dev/null || true

# ── Start ─────────────────────────────────────────────────────────────────────

if [[ "$WITH_POSTGRES" == "true" ]]; then
  # ── Pod mode: postgres sidecar ─────────────────────────────────────────────
  echo "==> Creating pod (postgres sidecar mode)..."

  podman pod create \
    --name "$POD_NAME" \
    -p 3000:3000 \
    -p 5433:5432

  echo "==> Starting postgres..."
  podman run -d \
    --pod "$POD_NAME" \
    --name "${POD_NAME}-postgres" \
    -e POSTGRES_DB=devworkflow \
    -e POSTGRES_USER=agent \
    -e POSTGRES_PASSWORD=agent \
    -e PGDATA=/tmp/pgdata \
    "$POSTGRES_IMAGE"

  echo "    Waiting for postgres TCP..."
  for i in $(seq 1 30); do
    (echo > /dev/tcp/127.0.0.1/5433) 2>/dev/null && sleep 2 && break
    sleep 1
  done

  echo "==> Starting app (with postgres)..."
  podman run -d \
    --pod "$POD_NAME" \
    --name "${POD_NAME}-app" \
    -e DATABASE_URL="postgres://agent:agent@localhost:5432/devworkflow" \
    -e KNOWLEDGE_DIR="/app/pg_seed/eclipse-che" \
    -e ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}" \
    -e GEMINI_API_KEY="${GEMINI_API_KEY:-}" \
    -e GITHUB_TOKEN="${GITHUB_TOKEN:-}" \
    -e OLLAMA_BASE_URL="${OLLAMA_URL:-${OLLAMA_BASE_URL:-}}" \
    -e OLLAMA_MODEL="${OLLAMA_MODEL:-}" \
    "$APP_IMAGE"

  LOG_TARGET="${POD_NAME}-app"

else
  # ── Single container mode: PGlite embedded (default) ──────────────────────
  echo "==> Starting dev-workflow-ai with PGlite (no postgres sidecar)..."

  # Persistent volume: store data between restarts
  podman volume create dwa-data 2>/dev/null || true

  podman run -d \
    --name "$CONTAINER_NAME" \
    -p 3000:3000 \
    -v dwa-data:/app/data:Z \
    -e PGLITE_DATA_DIR="/app/data" \
    -e KNOWLEDGE_DIR="/app/pg_seed/eclipse-che" \
    -e ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}" \
    -e GEMINI_API_KEY="${GEMINI_API_KEY:-}" \
    -e GITHUB_TOKEN="${GITHUB_TOKEN:-}" \
    -e OLLAMA_BASE_URL="${OLLAMA_URL:-${OLLAMA_BASE_URL:-}}" \
    -e OLLAMA_MODEL="${OLLAMA_MODEL:-}" \
    "$APP_IMAGE"

  LOG_TARGET="$CONTAINER_NAME"
fi

# ── Wait for health ───────────────────────────────────────────────────────────

echo "==> Waiting for app..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:3000/healthz &>/dev/null; then break; fi
  sleep 2
  (( i % 5 == 0 )) && echo "    ${i}s elapsed..."
done

if curl -sf http://localhost:3000/healthz &>/dev/null; then
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  ✓  dev-workflow-ai is running"
  echo ""
  echo "  App:    http://localhost:3000"
  if [[ "$WITH_POSTGRES" == "true" ]]; then
    echo "  DB:     postgres at localhost:5433"
  else
    echo "  DB:     PGlite embedded (data in 'dwa-data' volume)"
  fi
  echo ""
  echo "  Logs:   $0 --logs"
  echo "  Stop:   $0 --stop"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  podman logs "$LOG_TARGET" 2>&1 | grep -v "^\s\{4\}" | tail -8
else
  echo "ERROR: App did not start. Logs:"
  podman logs "$LOG_TARGET" 2>&1 | grep -v "^\s\{4\}" | tail -20
  echo ""
  echo "Debug: podman logs $LOG_TARGET"
  exit 1
fi
