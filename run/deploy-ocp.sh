#!/usr/bin/env bash
#
# Copyright (c) 2026 Red Hat, Inc.
# This program and the accompanying materials are made
# available under the terms of the Eclipse Public License 2.0
# which is available at https://www.eclipse.org/legal/epl-2.0/
#
# SPDX-License-Identifier: EPL-2.0
#
# run/deploy-ocp.sh — deploy dev-workflow-ai to OpenShift using a pre-built image
#
# Usage:
#   ./run/deploy-ocp.sh [options]
#
# Options:
#   --namespace, -n  target namespace (default: dev-workflow-ai)
#   --tag,       -t  image tag (default: latest)
#   --registry       registry host override
#   --user           registry user/org override
#
# Required env vars (unless overridden via flags):
#   IMAGE_REGISTRY_HOST      e.g. quay.io
#   IMAGE_REGISTRY_USER_NAME e.g. oorel
#
# The dev-workflow-ai-secrets Secret is optional — create it first if you need
# credentials (GitHub token, Vertex AI service account) injected automatically:
#   ./run/create-ocp-secret.sh
#
# Prerequisites:
#   oc login  (kubeadmin or developer with edit rights on the namespace)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"

NS="${DEPLOY_NAMESPACE:-dev-workflow-ai}"
IMAGE_REGISTRY_HOST="${IMAGE_REGISTRY_HOST:-}"
IMAGE_REGISTRY_USER_NAME="${IMAGE_REGISTRY_USER_NAME:-}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
SECRET_NAME="dev-workflow-ai-secrets"

while [[ $# -gt 0 ]]; do
  case $1 in
    --namespace|-n) NS="$2";                    shift 2 ;;
    --tag|-t)       IMAGE_TAG="$2";             shift 2 ;;
    --registry)     IMAGE_REGISTRY_HOST="$2";   shift 2 ;;
    --user)         IMAGE_REGISTRY_USER_NAME="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [[ -z "$IMAGE_REGISTRY_HOST" || -z "$IMAGE_REGISTRY_USER_NAME" ]]; then
  echo "ERROR: IMAGE_REGISTRY_HOST and IMAGE_REGISTRY_USER_NAME must be set"
  echo ""
  echo "  export IMAGE_REGISTRY_HOST=quay.io"
  echo "  export IMAGE_REGISTRY_USER_NAME=myuser"
  exit 1
fi

IMAGE="${IMAGE_REGISTRY_HOST}/${IMAGE_REGISTRY_USER_NAME}/dev-workflow-ai:${IMAGE_TAG}"

echo "→ Deploying image: ${IMAGE}"

# ── 2. Namespace ───────────────────────────────────────────────────────────────

echo "→ Ensuring namespace: ${NS}"
oc create namespace "$NS" --dry-run=client -o yaml | oc apply -f -

# ── 3. PostgreSQL ──────────────────────────────────────────────────────────────

echo "→ Applying PostgreSQL resources"
oc apply -n "$NS" -f - <<YAML
apiVersion: v1
kind: Secret
metadata:
  name: postgres-credentials
type: Opaque
stringData:
  POSTGRES_DB: devworkflow
  POSTGRES_USER: agent
  POSTGRES_PASSWORD: agent
  DATABASE_URL: "postgres://agent:agent@postgres:5432/devworkflow"
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: postgres-data
spec:
  accessModes: [ReadWriteOnce]
  resources:
    requests:
      storage: 2Gi
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: postgres
spec:
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
        - name: postgres
          image: docker.io/postgres:16-alpine
          ports:
            - containerPort: 5432
          envFrom:
            - secretRef:
                name: postgres-credentials
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
              subPath: pgdata
          resources:
            requests:
              memory: 64Mi
            limits:
              memory: 512Mi
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: postgres-data
---
apiVersion: v1
kind: Service
metadata:
  name: postgres
spec:
  selector:
    app: postgres
  ports:
    - port: 5432
      targetPort: 5432
YAML

# ── 4. App ─────────────────────────────────────────────────────────────────────

echo "→ Applying app Deployment / Service / Route"
oc apply -n "$NS" -f - <<YAML
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: repos-data
spec:
  accessModes: [ReadWriteOnce]
  resources:
    requests:
      storage: 10Gi
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: dev-workflow-ai
spec:
  replicas: 1
  selector:
    matchLabels:
      app: dev-workflow-ai
  template:
    metadata:
      labels:
        app: dev-workflow-ai
    spec:
      containers:
        - name: app
          image: ${IMAGE}
          imagePullPolicy: Always
          ports:
            - containerPort: 3000
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: postgres-credentials
                  key: DATABASE_URL
            - name: KNOWLEDGE_DIR
              value: /app/pg_seed/eclipse-che
            - name: REPOS_DIR
              value: /repos
            - name: NODE_ENV
              value: production
          envFrom:
            - secretRef:
                name: ${SECRET_NAME}
                optional: true
          volumeMounts:
            - name: repos
              mountPath: /repos
          resources:
            requests:
              memory: 256Mi
              cpu: 250m
            limits:
              memory: 2Gi
              cpu: 2000m
          readinessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 5
          livenessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 30
            periodSeconds: 30
      volumes:
        - name: repos
          persistentVolumeClaim:
            claimName: repos-data
---
apiVersion: v1
kind: Service
metadata:
  name: dev-workflow-ai
spec:
  selector:
    app: dev-workflow-ai
  ports:
    - port: 3000
      targetPort: 3000
---
apiVersion: route.openshift.io/v1
kind: Route
metadata:
  name: dev-workflow-ai
spec:
  to:
    kind: Service
    name: dev-workflow-ai
  port:
    targetPort: 3000
  tls:
    termination: edge
    insecureEdgeTerminationPolicy: Redirect
YAML

# ── 5. Wait & report ───────────────────────────────────────────────────────────

echo ""
echo "→ Waiting for rollout..."
oc rollout status deployment/postgres -n "$NS" --timeout=60s
oc rollout status deployment/dev-workflow-ai -n "$NS" --timeout=120s

ROUTE_HOST=$(oc get route dev-workflow-ai -n "$NS" -o jsonpath='{.spec.host}' 2>/dev/null || echo "<pending>")

echo ""
echo "✓ Deployment complete"
echo ""
echo "  App:   https://${ROUTE_HOST}"
echo "  Image: ${IMAGE}"
echo ""
echo "  Logs:  oc logs -f deployment/dev-workflow-ai -n ${NS}"
echo "  Tail:  oc get pods -n ${NS}"
