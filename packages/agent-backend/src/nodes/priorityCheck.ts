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

import { loadProjectConfig } from '../context/loader.js';
import { State } from '../agent/state.js';

type Priority = 'critical' | 'major' | 'minor' | 'trivial';
const PRIORITY_ORDER: Priority[] = ['critical', 'major', 'minor', 'trivial'];

const GITHUB_LABEL_MAP: Record<string, Priority> = {
  'priority/critical': 'critical',
  'priority/blocker': 'critical',
  'priority/major': 'major',
  'priority/minor': 'minor',
  'priority/trivial': 'trivial',
};

const JIRA_PRIORITY_MAP: Record<string, Priority> = {
  Critical: 'critical',
  Blocker: 'critical',
  Major: 'major',
  Normal: 'minor',
  Minor: 'minor',
  Trivial: 'trivial',
};

function meetsThreshold(priority: Priority, min: Priority): boolean {
  return PRIORITY_ORDER.indexOf(priority) <= PRIORITY_ORDER.indexOf(min);
}

function extractJiraKey(body: string): string | null {
  const m = body.match(/atlassian\.net\/browse\/([A-Z]+-\d+)/);
  return m?.[1] ?? null;
}

async function fetchJiraPriority(key: string): Promise<Priority | null> {
  // Accept both JIRA_TOKEN and JIRA_API_TOKEN
  const token = process.env.JIRA_TOKEN || process.env.JIRA_API_TOKEN;
  const email = process.env.JIRA_EMAIL;
  const baseUrl = process.env.JIRA_BASE_URL ?? 'https://redhat.atlassian.net';
  if (!token) return null;

  try {
    // Jira Cloud uses HTTP Basic auth: email:token (base64 encoded)
    const authHeader = email
      ? `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`
      : `Bearer ${token}`;

    const res = await fetch(`${baseUrl}/rest/api/3/issue/${key}?fields=priority`, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { fields?: { priority?: { name?: string } } };
    const name = data.fields?.priority?.name ?? '';
    return JIRA_PRIORITY_MAP[name] ?? null;
  } catch {
    return null;
  }
}

export async function priorityCheckNode(state: State): Promise<Partial<State>> {
  // Manual force: bypass all checks
  if (state.forcePriority) {
    return {
      priority: 'forced',
      prioritySource: 'manual',
      jiraKey: '',
      status: 'approved',
      messages: ['priority_check: FORCE — bypassing priority filter, proceeding to implement'],
    };
  }

  const config = await loadProjectConfig(state.project);
  const minPriority: Priority = (config?.auto_approve_min_priority as Priority | null) ?? 'major';

  // 0. Use pre-populated priority from imported issue (DB)
  let priority: Priority | null = null;
  let source: 'github-label' | 'jira' | 'db' | '' = '';
  let jiraKey = '';

  if (state.priority && state.priority in JIRA_PRIORITY_MAP) {
    priority =
      JIRA_PRIORITY_MAP[
        Object.keys(JIRA_PRIORITY_MAP).find(
          k => JIRA_PRIORITY_MAP[k] === (state.priority as Priority),
        ) ?? ''
      ] ?? (state.priority as Priority);
    source = 'db';
  } else if (
    state.priority === 'major' ||
    state.priority === 'critical' ||
    state.priority === 'minor' ||
    state.priority === 'trivial'
  ) {
    priority = state.priority as Priority;
    source = 'db';
  }

  // 1. GitHub label (overrides DB if present)
  for (const label of state.issueLabels) {
    if (label in GITHUB_LABEL_MAP) {
      priority = GITHUB_LABEL_MAP[label];
      source = 'github-label';
      break;
    }
  }

  // 2. Jira — use pre-parsed jiraKey from state first, then try issueBody
  if (!priority) {
    const key =
      state.jiraKey ||
      (state.issueBody ? extractJiraKey(state.issueBody) : null) ||
      (state.issueUrl ? extractJiraKey(state.issueUrl) : null);
    if (key) {
      jiraKey = key;
      const jiraPriority = await fetchJiraPriority(key);
      if (jiraPriority) {
        priority = jiraPriority;
        source = 'jira';
      }
    }
  }

  // 3. Fallback
  if (!priority) {
    priority = 'minor';
    source = '';
  }

  const approved = meetsThreshold(priority, minPriority);

  return {
    priority,
    prioritySource: source,
    jiraKey,
    status: approved ? 'approved' : 'skipped',
    messages: [
      approved
        ? `priority_check: ${priority} (${source || 'fallback'}) ≥ ${minPriority} → AUTO-APPROVED${jiraKey ? ` [${jiraKey}]` : ''}`
        : `priority_check: ${priority} (${source || 'fallback'}) < ${minPriority} → SKIPPED`,
    ],
  };
}
