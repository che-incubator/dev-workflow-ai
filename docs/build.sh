#!/usr/bin/env bash
# Build and optionally serve the docs site using Antora.
#
# Usage:
#   ./docs/build.sh          # build only
#   ./docs/build.sh --serve  # build and start a local HTTP server
#
# Prerequisites:
#   npx antora (or: npm install -g @antora/cli @antora/site-generator)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$REPO_ROOT/build/site"

cd "$SCRIPT_DIR"

echo "Building docs with Antora..."
npx antora generate antora-playbook.yml --stacktrace

echo ""
echo "Build complete: $BUILD_DIR"
echo "  Open: file://$BUILD_DIR/index.html"

if [[ "${1:-}" == "--serve" ]]; then
  PORT="${PORT:-4000}"
  echo ""
  echo "Starting HTTP server on http://localhost:$PORT"
  npx http-server "$BUILD_DIR" -p "$PORT" -c-1 --silent
fi
