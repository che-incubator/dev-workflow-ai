#!/usr/bin/env bash
#
# Copyright (c) 2026 Red Hat, Inc.
# This program and the accompanying materials are made
# available under the terms of the Eclipse Public License 2.0
# which is available at https://www.eclipse.org/legal/epl-2.0/
#
# SPDX-License-Identifier: EPL-2.0
#
# Contributors:
#   Red Hat, Inc. - initial API and implementation
#
# push-secrets-to-ocp.sh — create / update dev-workflow-ai credential secrets
# in an OpenShift namespace from the local .env file.
#
# Usage:
#   oc login ...
#   ./run/push-secrets-to-ocp.sh [--namespace <ns>]
#
# The script reads values from .env (or from already-exported shell env vars)
# and creates one labelled Secret per credential group so the DevWorkspace
# Operator auto-injects them as env vars in every DevWorkspace pod.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
NS="${DEVWORKSPACE_NAMESPACE:-olexii4-che}"

while [[ $# -gt 0 ]]; do
  case $1 in
    --namespace|-n) NS="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Load .env
if [[ -f "$ROOT/.env" ]]; then
  set -a; source "$ROOT/.env"; set +a
  echo "[push-secrets] Loaded .env"
else
  echo "[push-secrets] No .env found — using already-exported env vars"
fi

b64() { printf '%s' "$1" | base64; }

apply_secret() {
  local name="$1"; shift
  # Build data block: "  KEY: base64value" pairs
  local data=""
  while [[ $# -gt 0 ]]; do
    local key="$1" val="${2:-}"
    shift 2
    [[ -z "$val" ]] && continue
    data+="  ${key}: $(b64 "$val")"$'\n'
  done
  [[ -z "$data" ]] && { echo "[push-secrets] Skipping $name (all values empty)"; return; }

  oc apply -n "$NS" -f - <<EOF
kind: Secret
apiVersion: v1
metadata:
  name: ${name}
  labels:
    controller.devfile.io/mount-to-devworkspace: 'true'
    controller.devfile.io/watch-secret: 'true'
  annotations:
    controller.devfile.io/mount-as: env
data:
${data}type: Opaque
EOF
  echo "[push-secrets] ✓ $name"
}

echo "[push-secrets] Target namespace: $NS"
echo ""

apply_secret "llm-vertex" \
  ANTHROPIC_VERTEX_PROJECT_ID "${ANTHROPIC_VERTEX_PROJECT_ID:-}" \
  CLOUD_ML_REGION             "${CLOUD_ML_REGION:-global}" \
  VERTEX_CLAUDE_MODEL         "${VERTEX_CLAUDE_MODEL:-claude-sonnet-4-6@default}" \
  GOOGLE_APPLICATION_CREDENTIALS_JSON "${GOOGLE_APPLICATION_CREDENTIALS_JSON:-}"

apply_secret "llm-gemini" \
  GEMINI_API_KEY  "${GEMINI_API_KEY:-}" \
  GEMINI_MODEL    "${GEMINI_MODEL:-gemini-3.6-flash}"

apply_secret "github-token" \
  GITHUB_TOKEN "${GITHUB_TOKEN:-}"

apply_secret "jira-credentials" \
  JIRA_TOKEN    "${JIRA_TOKEN:-}" \
  JIRA_EMAIL    "${JIRA_EMAIL:-}" \
  JIRA_BASE_URL "${JIRA_BASE_URL:-https://redhat.atlassian.net}"

echo ""
echo "[push-secrets] Done. Restart the DevWorkspace to pick up new secrets:"
echo "  oc patch devworkspace dev-workflow-ai -n $NS --type=merge -p '{\"spec\":{\"started\":false}}'"
echo "  sleep 3"
echo "  oc patch devworkspace dev-workflow-ai -n $NS --type=merge -p '{\"spec\":{\"started\":true}}'"
