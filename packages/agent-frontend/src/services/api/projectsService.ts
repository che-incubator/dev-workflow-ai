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
  if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => res.statusText)}`);
  return res.json() as Promise<T>;
}

export interface Project {
  id: number;
  name: string;
  repo: string;
  local_path: string;
  default_branch: string;
  stack: string[];
  description: string;
  auto_approve_min_priority: string;
  story_point_budget: number;
  issue_source?: string;
  open_issues?: number;
  updated_at?: string;
}

export async function getProjects(): Promise<Project[]> {
  try {
    return await apiFetch<Project[]>('/projects');
  } catch (e) {
    throw new Error(`Failed to fetch projects. ${getMessage(e)}`);
  }
}

export async function createProject(body: Partial<Project>): Promise<Project> {
  try {
    return await apiFetch<Project>('/projects', { method: 'POST', body: JSON.stringify(body) });
  } catch (e) {
    throw new Error(`Failed to create project. ${getMessage(e)}`);
  }
}

export async function updateProject(name: string, body: Partial<Project>): Promise<Project> {
  try {
    return await apiFetch<Project>(`/projects/${name}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(`Failed to update project ${name}. ${getMessage(e)}`);
  }
}

export async function deleteProject(name: string): Promise<void> {
  try {
    await apiFetch<void>(`/projects/${name}`, { method: 'DELETE' });
  } catch (e) {
    throw new Error(`Failed to delete project ${slug}. ${getMessage(e)}`);
  }
}
