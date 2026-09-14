#!/usr/bin/env bash
#
# Copyright (c) 2026 Red Hat, Inc.
# This program and the accompanying materials are made
# available under the terms of the Eclipse Public License 2.0
# which is available at https://www.eclipse.org/legal/epl-2.0/
#
# SPDX-License-Identifier: EPL-2.0
#
# workspace-entrypoint.sh — start postgres, then exec the main container command.
#
# Runs as the UDI default user (UID 10001 or OpenShift-assigned UID).
# Postgres is started in the background before the main process (usually
# "tail -f /dev/null" for interactive devfile workspaces).

set -euo pipefail

echo "[workspace] Starting postgres background service..."
/usr/local/bin/start-postgres.sh

echo "[workspace] Postgres ready. Starting main process: $*"
exec "$@"
