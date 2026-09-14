#!/usr/bin/env bash
#
# Copyright (c) 2026 Red Hat, Inc.
# This program and the accompanying materials are made
# available under the terms of the Eclipse Public License 2.0
# which is available at https://www.eclipse.org/legal/epl-2.0/
#
# SPDX-License-Identifier: EPL-2.0
#
# run/create-ocp-secret.sh — create the OpenShift secret that dev-workflow-ai
# devfile workspaces read their credentials from.
#
# Run once on the cluster before opening the workspace in Eclipse Che.
# The secret is mounted as env vars into the 'tools' container automatically
# via the devfile's envFrom reference.
#
# Usage:
#   ./run/create-ocp-secret.sh [--namespace eclipse-che] [--sa-file ~/gcp-sa-claude.json]
#
# Prerequisites:
#   oc login  (kubeadmin or developer with edit rights on the namespace)
#   GITHUB_TOKEN env var (or pass --github-token)

set -euo pipefail

# Namespace where DevWorkspaces run — check with: oc get devworkspace --all-namespaces
# On CRC single-user it is usually the same namespace Eclipse Che is installed in,
# or a per-user namespace like 'admin-che'. Override with --namespace.
NS="${WORKSPACE_NAMESPACE:-eclipse-che}"
SA_FILE="${GOOGLE_APPLICATION_CREDENTIALS:-$HOME/gcp-sa-claude.json}"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"
SECRET_NAME="dev-workflow-ai-secrets"

while [[ $# -gt 0 ]]; do
  case $1 in
    --namespace|-n)  NS="$2"; shift 2 ;;
    --sa-file)       SA_FILE="$2"; shift 2 ;;
    --github-token)  GITHUB_TOKEN="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Validate ──────────────────────────────────────────────────────────────────

if [[ -z "$GITHUB_TOKEN" ]]; then
  echo "WARNING: GITHUB_TOKEN is not set — the agent can analyze issues but cannot open PRs."
fi

if [[ ! -f "$SA_FILE" ]]; then
  echo "ERROR: Service account file not found: $SA_FILE"
  echo "  Set GOOGLE_APPLICATION_CREDENTIALS or pass --sa-file <path>"
  exit 1
fi

# Validate the SA JSON has the right structure
python3 - "$SA_FILE" <<'PYEOF'
import json, sys
with open(sys.argv[1]) as f:
    d = json.load(f)
assert d.get("type") == "service_account", "Not a service_account key file"
assert d.get("project_id"), "Missing project_id"
print(f"SA key OK — project: {d['project_id']}, email: {d['client_email']}")
PYEOF

SA_JSON=$(cat "$SA_FILE")
VERTEX_PROJECT=$(python3 -c "import json,sys; print(json.load(open('$SA_FILE'))['project_id'])")

# ── Create / update secret ────────────────────────────────────────────────────

echo ""
echo "Creating secret '$SECRET_NAME' in namespace '$NS'..."

oc create namespace "$NS" --dry-run=client -o yaml | oc apply -f - &>/dev/null || true

oc create secret generic "$SECRET_NAME" \
  --namespace="$NS" \
  --from-literal="GITHUB_TOKEN=${GITHUB_TOKEN}" \
  --from-literal="ANTHROPIC_VERTEX_PROJECT_ID=${VERTEX_PROJECT}" \
  --from-literal="CLOUD_ML_REGION=us-east5" \
  --from-literal="VERTEX_CLAUDE_MODEL=claude-sonnet-4-5@20251101" \
  --from-literal="GOOGLE_APPLICATION_CREDENTIALS_JSON=${SA_JSON}" \
  --dry-run=client -o yaml | oc apply -f -

# Label + annotate so the DevWorkspace Operator mounts it as env vars in every
# DevWorkspace pod in this namespace automatically (devfile 2.x has no envFrom).
oc label secret "$SECRET_NAME" \
  --namespace="$NS" \
  "controller.devfile.io/mount-to-devworkspace=true" \
  "controller.devfile.io/watch-secret=true" \
  --overwrite

oc annotate secret "$SECRET_NAME" \
  --namespace="$NS" \
  "controller.devfile.io/mount-as=env" \
  --overwrite

echo ""
echo "✓ Secret '$SECRET_NAME' created/updated in '$NS'"
echo "  The DevWorkspace Operator will inject its keys as env vars into"
echo "  every DevWorkspace pod started in this namespace."
echo ""
echo "  To verify labels:"
echo "    oc get secret $SECRET_NAME -n $NS -o yaml | grep -A5 labels:"
