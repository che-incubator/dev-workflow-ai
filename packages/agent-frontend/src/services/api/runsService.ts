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

/*
 * Copyright (c) 2026 Red Hat, Inc.
 * SPDX-License-Identifier: EPL-2.0
 */

import { apiPrefix } from './const';
import { getMessage } from '@/services/helpers/errors';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiPrefix}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status} ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────

export interface AgentRun {
  id: number;
  thread_id: string;
  project_slug: string;
  repo: string;
  issue_number: number | null;
  issue_title: string;
  issue_url: string;
  priority: string;
  priority_source: string;
  jira_key: string;
  status: string;
  pr_url: string;
  pr_number: number | null;
  verdict: string;
  story_points: number;
  started_at: string;
  finished_at: string | null;
}

export interface RunEvent {
  id: number;
  thread_id: string;
  phase: string;
  node: string;
  message: string;
  level: string;
  ts: string;
}

export interface Finding {
  id: number;
  thread_id: string;
  file: string;
  line: number | null;
  severity: 'blocking' | 'warning' | 'suggestion';
  finding: string;
  tier: string;
}

export interface RunDetail extends AgentRun {
  events: RunEvent[];
  findings: Finding[];
}

// ── Service functions ─────────────────────────────────────────────────────

export async function getRuns(): Promise<AgentRun[]> {
  try {
    const data = await apiFetch<{ runs: AgentRun[]; total: number }>('/runs');
    return data.runs;
  } catch (e) {
    throw new Error(`Failed to fetch runs. ${getMessage(e)}`);
  }
}

export async function getRun(threadId: string): Promise<RunDetail> {
  try {
    return await apiFetch<RunDetail>(`/runs/${threadId}`);
  } catch (e) {
    throw new Error(`Failed to fetch run ${threadId}. ${getMessage(e)}`);
  }
}

export async function startRun(body: {
  project?: string;
  issueNumber?: number;
  issueUrl?: string;
  forcePriority?: boolean;
}): Promise<{ threadId: string }> {
  try {
    return await apiFetch<{ threadId: string }>('/runs', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(`Failed to start run. ${getMessage(e)}`);
  }
}

export async function cancelRun(threadId: string): Promise<void> {
  try {
    await apiFetch<void>(`/runs/${threadId}`, { method: 'DELETE' });
  } catch (e) {
    throw new Error(`Failed to cancel run ${threadId}. ${getMessage(e)}`);
  }
}
