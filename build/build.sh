#!/bin/bash
#
# Copyright (c) 2026 Red Hat, Inc.
# This program and the accompanying materials are made
# available under the terms of the Eclipse Public License 2.0
# which is available at https://www.eclipse.org/legal/epl-2.0/
#
# SPDX-License-Identifier: EPL-2.0
#
# Build script for dev-workflow-ai
#
# Usage:
#   ./build/build.sh                  # build UI + API (webpack)
#   ./build/build.sh --ui-only        # build UI only (webpack)
#   ./build/build.sh --api-only       # build API only (webpack)
#   ./build/build.sh --multiarch           # build and push multi-arch app image
#   ./build/build.sh --postgres-image      # build OpenShift-compatible postgres sidecar image
#   ./build/build.sh --workspace-image     # build single-container workspace image (UDI + postgres)
#
# Multi-arch options (used with --multiarch / --postgres-image / --workspace-image):
#   IMAGE_REGISTRY_HOST      Container registry host (required)
#   IMAGE_REGISTRY_USER_NAME Registry username/namespace (required)
#   PLATFORMS                Platforms to build (default: linux/amd64,linux/arm64)
#   IMAGE_TAG                Custom image tag (default: branch_timestamp)
#
# Examples:
#   ./build/build.sh
#   IMAGE_REGISTRY_HOST=quay.io IMAGE_REGISTRY_USER_NAME=myuser ./build/build.sh --multiarch
#   IMAGE_REGISTRY_HOST=quay.io IMAGE_REGISTRY_USER_NAME=myuser ./build/build.sh --postgres-image
#   IMAGE_REGISTRY_HOST=quay.io IMAGE_REGISTRY_USER_NAME=myuser ./build/build.sh --workspace-image
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"

cd "$ROOT"

# ── Local builds ────────────────────────────────────────────────────────────

build_ui() {
  echo "[build] Building UI (webpack)..."
  yarn workspace @dev-workflow-ai/agent-frontend build
  echo "[build] ✓ UI built → dist/"
}

build_api() {
  echo "[build] Building API (webpack)..."
  yarn workspace @dev-workflow-ai/agent-backend build
  echo "[build] ✓ API built → packages/agent-backend/lib/"
}

# ── Container image builder (shared logic) ───────────────────────────────────

build_image() {
  local name="$1"          # image name suffix: dev-workflow-ai, dev-workflow-ai-postgres, etc.
  local dockerfile="$2"    # path to Dockerfile
  local tag="${IMAGE_TAG:-$(git branch --show-current)'_'$(date '+%Y_%m_%d_%H_%M_%S')}"
  local platforms="${PLATFORMS:-linux/amd64,linux/arm64}"
  local image="${IMAGE_REGISTRY_HOST}/${IMAGE_REGISTRY_USER_NAME}/${name}:${tag}"

  if [[ -z "${IMAGE_REGISTRY_HOST:-}" || -z "${IMAGE_REGISTRY_USER_NAME:-}" ]]; then
    echo "[ERROR] IMAGE_REGISTRY_HOST and IMAGE_REGISTRY_USER_NAME must be set."
    echo "        Example: export IMAGE_REGISTRY_HOST=quay.io"
    echo "        Example: export IMAGE_REGISTRY_USER_NAME=your-username"
    exit 1
  fi

  echo "[build] Image:      $image"
  echo "[build] Platforms:  $platforms"
  echo "[build] Dockerfile: $dockerfile"
  echo ""

  local tool
  if command -v docker &>/dev/null && docker info &>/dev/null 2>&1; then
    tool=docker
  elif command -v podman &>/dev/null; then
    tool=podman
  else
    echo "[ERROR] Neither Docker nor Podman found."
    exit 1
  fi

  if [[ "$tool" == "docker" ]]; then
    if ! docker buildx ls | grep -q "dwa-multiarch-builder"; then
      docker buildx create --name dwa-multiarch-builder --use --platform "$platforms"
    else
      docker buildx use dwa-multiarch-builder
    fi
    docker buildx inspect --bootstrap
    docker buildx build . -f "$dockerfile" --platform "$platforms" -t "$image" --push
  else
    podman manifest create "$image" || true
    IFS=',' read -ra PLATFORM_ARRAY <<< "$platforms"
    for p in "${PLATFORM_ARRAY[@]}"; do
      podman build . -f "$dockerfile" --platform "$p" --manifest "$image"
    done
    podman manifest push "$image" "docker://$image"
  fi

  echo ""
  echo "[build] ✓ Pushed: $image"
  echo ""
  echo "To verify:"
  echo "  docker buildx imagetools inspect $image"
}

# ── Dispatch ────────────────────────────────────────────────────────────────

case "${1:-all}" in
  --ui-only)
    build_ui
    ;;
  --api-only)
    build_api
    ;;
  --multiarch)
    # Main app image: API + UI + AI tool binaries
    build_image "dev-workflow-ai" "build/dockerfiles/Dockerfile"
    ;;
  --postgres-image)
    # OpenShift-compatible postgres sidecar (postgres:16-alpine + PGDATA=/tmp/pgdata)
    # Use in devfile as sidecar, replacing docker.io/postgres:16-alpine
    build_image "dev-workflow-ai-postgres" "build/dockerfiles/postgres-openshift.Dockerfile"
    echo ""
    echo "Update devfile.yaml: change postgres container image to:"
    echo "  image: ${IMAGE_REGISTRY_HOST:-<registry>}/${IMAGE_REGISTRY_USER_NAME:-<org>}/dev-workflow-ai-postgres:latest"
    ;;
  --workspace-image)
    # Single-container image: UDI + postgres bundled (no sidecar needed)
    # Replaces both the 'tools' and 'postgres' devfile components with one container
    build_image "dev-workflow-ai-workspace" "build/dockerfiles/workspace.Dockerfile"
    echo ""
    echo "Update devfile.yaml: replace 'tools' + 'postgres' components with:"
    echo "  - name: workspace"
    echo "    container:"
    echo "      image: ${IMAGE_REGISTRY_HOST:-<registry>}/${IMAGE_REGISTRY_USER_NAME:-<org>}/dev-workflow-ai-workspace:latest"
    echo "      memoryLimit: 6G"
    echo "      env:"
    echo "        - name: DATABASE_URL"
    echo "          value: postgres://agent:agent@localhost:5432/devworkflow"
    ;;
  *)
    build_ui
    build_api
    ;;
esac
