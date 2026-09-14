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

const BASE = '/api';

export async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      ...(opts?.body != null ? { 'Content-Type': 'application/json' } : {}),
      ...opts?.headers,
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

// ── Projects ──────────────────────────────────────────────────────────────

export interface Project {
  id: number;
  name: string;
  repo: string;
  local_path: string;
  stack: string[];
  description: string;
  auto_approve_min_priority: string;
  story_point_budget: number;
  updated_at: string;
}

export const getProjects = () => apiFetch<Project[]>('/projects');
export const getProject = (name: string) => apiFetch<Project>(`/projects/${name}`);
export const createProject = (body: Partial<Project>) =>
  apiFetch<Project>('/projects', { method: 'POST', body: JSON.stringify(body) });
export const updateProject = (name: string, body: Partial<Project>) =>
  apiFetch<Project>(`/projects/${name}`, { method: 'PUT', body: JSON.stringify(body) });
export const deleteProject = (name: string) =>
  apiFetch<void>(`/projects/${name}`, { method: 'DELETE' });
export const updateProjectRepo = (name: string) =>
  apiFetch<{ project: Project; cloned: boolean }>(`/projects/${name}/update`, { method: 'POST' });

// ── Issues ───────────────────────────────────────────────────────────────

export interface ScoredIssue {
  number: number;
  title: string;
  url: string;
  labels: string[];
  storyPoints: number;
  score: number;
}

export const getIssues = (project: string) => apiFetch<ScoredIssue[]>(`/issues?project=${project}`);

// ── Issue Sources ─────────────────────────────────────────────────────────

export interface IssueSource {
  id: number;
  url: string;
  kind: 'github' | 'jira';
  label: string;
  project_slug: string;
  active: boolean;
  last_synced_at: string | null;
  created_at: string;
}

export interface StoredIssue {
  id: number;
  source_id: number;
  external_id: string;
  title: string;
  url: string;
  body: string;
  labels: string[];
  priority: string;
  assignees: string[];
  status: string;
  score: number;
  story_points: number;
  fetched_at: string;
  source_label: string;
  source_kind: string;
  source_url: string;
}

export const getSources = () => apiFetch<IssueSource[]>('/sources');
export const addSource = (url: string, projectSlug?: string) =>
  apiFetch<IssueSource>('/sources', {
    method: 'POST',
    body: JSON.stringify({ url, project_slug: projectSlug ?? '' }),
  });
export const deleteSource = (id: number) => apiFetch<void>(`/sources/${id}`, { method: 'DELETE' });
export const syncSource = (id: number) =>
  apiFetch<{ syncing: boolean }>(`/sources/${id}/sync`, { method: 'POST' });

export const syncJiraAssigned = (sourceId?: number) =>
  apiFetch<{ sourceId: number; upserted: number }>('/sources/jira/sync-assigned', {
    method: 'POST',
    body: sourceId != null ? JSON.stringify({ sourceId }) : '{}',
  });

export const isJiraAssignedUrl = (url: string) => url.includes('/jira/for-you');
export const getAllIssues = () => apiFetch<StoredIssue[]>('/sources/issues');
export const deleteIssue = (id: number) =>
  apiFetch<void>(`/sources/issues/${id}`, { method: 'DELETE' });
export const importIssue = (url: string) =>
  apiFetch<StoredIssue>('/sources/issues/import', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
export const refreshIssue = (url: string) =>
  apiFetch<StoredIssue>('/sources/issues/import', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });

// ── Runs ─────────────────────────────────────────────────────────────────

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

export interface RunDetail extends AgentRun {
  events: RunEvent[];
  findings: Finding[];
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

export const getRuns = () =>
  apiFetch<{ runs: AgentRun[]; total: number }>('/runs').then(r => r.runs);
export const getRun = (threadId: string) => apiFetch<RunDetail>(`/runs/${threadId}`);
export const startRun = (body: {
  project?: string;
  issueNumber?: number;
  issueUrl?: string;
  forcePriority?: boolean;
}) => apiFetch<{ threadId: string }>('/runs', { method: 'POST', body: JSON.stringify(body) });
export const cancelRun = (threadId: string) =>
  apiFetch<void>(`/runs/${threadId}`, { method: 'DELETE' });

export const triggerAutorun = () =>
  apiFetch<{ threadId: string; issueUrl: string; title: string; dryRun: boolean }>(
    '/runs/autorun',
    { method: 'POST' },
  );

export const triggerCveBatch = () =>
  apiFetch<{ threadId: string; count: number; issues: Array<{ url: string; title: string }> }>(
    '/runs/cve-batch',
    { method: 'POST' },
  );

// ── WebSocket ─────────────────────────────────────────────────────────────

export type WsEvent =
  | { type: 'phase_start' | 'phase_complete'; threadId: string; payload: { phase: string } }
  | {
      type: 'node_start' | 'node_complete';
      threadId: string;
      payload: { node: string; durationMs?: number };
    }
  | { type: 'log'; threadId: string; payload: { level: string; message: string } }
  | { type: 'run_complete'; threadId: string; payload: { status: string; prUrl: string } }
  | { type: 'run_failed'; threadId: string; payload: { status: string; error: string } };

export function subscribeToRun(threadId: string, onEvent: (e: WsEvent) => void): () => void {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${window.location.host}/ws`);

  ws.onopen = () => ws.send(JSON.stringify({ subscribe: threadId }));
  ws.onmessage = msg => {
    try {
      onEvent(JSON.parse(msg.data) as WsEvent);
    } catch {
      /* ignore */
    }
  };

  return () => ws.close();
}

// ── LLM Providers ─────────────────────────────────────────────────────────

export interface LLMProvider {
  id: number;
  provider_id: string;
  label: string;
  api_key: string; // '***' when set, '' when not set
  base_url: string;
  model: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const getProviders = () => apiFetch<LLMProvider[]>('/providers');
export const upsertProvider = (body: Partial<LLMProvider> & { provider_id: string }) =>
  apiFetch<LLMProvider>('/providers', { method: 'POST', body: JSON.stringify(body) });
export const deleteProvider = (providerId: string) =>
  apiFetch<void>(`/providers/${providerId}`, { method: 'DELETE' });
export interface ProviderHealthResult {
  provider_id: string;
  label: string;
  status: 'ok' | 'config_error' | 'auth_error' | 'model_error' | 'network_error' | 'no_key';
  latency_ms: number | null;
  response_snippet: string | null;
  error: string | null;
  hint: string | null;
}
export const testAllProviders = (autoActivate = false) =>
  apiFetch<{ results: ProviderHealthResult[]; activated: string | null }>('/providers/test-all', {
    method: 'POST',
    body: JSON.stringify({ autoActivate }),
  });

export const testProvider = (prompt: string, providerId?: string) =>
  apiFetch<{ response: string; note?: string }>('/providers/test', {
    method: 'POST',
    body: JSON.stringify({ prompt, ...(providerId ? { provider_id: providerId } : {}) }),
  });

// ── Auth ──────────────────────────────────────────────────────────────────

export interface AuthUser {
  githubId: string;
  login: string;
  name: string;
  avatar: string;
}

export const getMe = () => apiFetch<AuthUser>('/preferences/user');
export const logout = () => apiFetch<void>('/auth/logout', { method: 'POST' });
export const loginUrl = '/api/auth/login';
// ── Settings ──────────────────────────────────────────────────────────────

export interface AppSettings {
  defaultMinPriority: string;
  defaultBudget: string;
  cloneDir: string;
  executionMode: string; // 'pr' | 'export'
  outputDir: string;
  autorunEnabled: string; // 'true' | 'false'
  autorunTimes: string; // comma-separated HH:MM list e.g. "09:00,14:00"
  [key: string]: string;
}

export interface SamplePack {
  name: string;
  subdirs: string[];
  hasSubprojects: boolean;
  hasContext: boolean;
  hasShared: boolean;
}

export interface LoadResult {
  ok: boolean;
  sample: string;
  path: string;
  imported: number;
  projects: number;
  sources: number;
}

export const getSettings = () => apiFetch<AppSettings>('/settings');
export const saveSettings = (body: Partial<AppSettings>) =>
  apiFetch<{ ok: boolean }>('/settings', { method: 'PUT', body: JSON.stringify(body) });
export const getSamplePacks = () => apiFetch<SamplePack[]>('/settings/samples');
export const loadSamplePack = (name: string) =>
  apiFetch<LoadResult>(`/settings/samples/${name}/load`, { method: 'POST' });
export const exportKnowledge = () => {
  window.open('/api/settings/export', '_blank');
};
