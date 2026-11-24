/*
 * Copyright (c) 2026 Red Hat, Inc.
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Contributors:
 *   Red Hat, Inc. - initial API and implementation
 */

import { EventEmitter } from 'node:events';
import type { WebSocket } from 'ws';
import type { FastifyRequest } from 'fastify';

export interface RunEvent {
  type: string;
  threadId: string;
  payload: Record<string, unknown>;
}

// In-process event bus — agents emit here, WS handler broadcasts
export const agentBus = new EventEmitter();
agentBus.setMaxListeners(100);

/**
 * Reserved channel for run-list changes.
 *
 * Views that render a list of runs (Issues, Projects, Dashboard) subscribe here
 * instead of polling `GET /api/runs` on a timer. Every run lifecycle event fans
 * out one `runs_changed` notification on this channel.
 */
export const RUNS_CHANNEL = 'runs';

// threadId (or RUNS_CHANNEL) → Set of connected WebSocket clients
const subscribers = new Map<string, Set<WebSocket>>();

function sendTo(channel: string, payload: string): void {
  const clients = subscribers.get(channel);
  if (!clients) return;
  for (const ws of clients) {
    try {
      if (ws.readyState === 1 /* OPEN */) ws.send(payload);
    } catch {
      /* client disconnected */
    }
  }
}

function subscribe(threadId: string, ws: WebSocket): void {
  if (!subscribers.has(threadId)) {
    subscribers.set(threadId, new Set());
  }
  subscribers.get(threadId)!.add(ws);
}

function unsubscribe(threadId: string, ws: WebSocket): void {
  subscribers.get(threadId)?.delete(ws);
}

/**
 * Notify run-list subscribers that something about the set of runs changed.
 * Carries no run data — listeners reload the slice they care about.
 */
export function broadcastRunsChanged(threadId?: string): void {
  sendTo(RUNS_CHANNEL, JSON.stringify({ type: 'runs_changed', threadId: threadId ?? '' }));
}

/** Called by the agent runner to push events to connected UI clients */
export function emitRunEvent(threadId: string, event: RunEvent): void {
  agentBus.emit('run_event', threadId, event);

  sendTo(threadId, JSON.stringify(event));

  // Only lifecycle transitions change the run list — per-node and log events
  // would otherwise make every reader refetch dozens of times per run.
  if (
    event.type === 'run_started' ||
    event.type === 'run_complete' ||
    event.type === 'run_failed' ||
    event.type === 'phase_start' ||
    event.type === 'phase_complete'
  ) {
    broadcastRunsChanged(threadId);
  }
}

/** Fastify websocket handler */
export function agentStream(socket: WebSocket, _req: FastifyRequest): void {
  const subscribedThreads = new Set<string>();

  socket.on('message', (raw: Buffer | string) => {
    try {
      const msg = JSON.parse(raw.toString()) as { subscribe?: string; unsubscribe?: string };

      if (msg.subscribe) {
        subscribe(msg.subscribe, socket);
        subscribedThreads.add(msg.subscribe);
        socket.send(JSON.stringify({ type: 'subscribed', threadId: msg.subscribe }));
      }

      if (msg.unsubscribe) {
        unsubscribe(msg.unsubscribe, socket);
        subscribedThreads.delete(msg.unsubscribe);
      }
    } catch {
      /* ignore malformed messages */
    }
  });

  socket.on('close', () => {
    for (const threadId of subscribedThreads) {
      unsubscribe(threadId, socket);
    }
    subscribedThreads.clear();
  });

  // Send ping every 30s to keep connection alive
  const pingInterval = setInterval(() => {
    try {
      if (socket.readyState === 1) socket.ping();
    } catch {
      clearInterval(pingInterval);
    }
  }, 30_000);

  socket.on('close', () => clearInterval(pingInterval));
}
