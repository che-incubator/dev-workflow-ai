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

import { HumanMessage } from '@langchain/core/messages';
import { llm } from '../llm/client.js';
import { loadProjectConfig } from '../context/loader.js';
import { State } from '../agent/state.js';

const PRIORITY_BOOSTS: Record<string, number> = {
  'priority/critical': 5,
  'priority/major': 3,
  'priority/minor': 0,
  'priority/trivial': -2,
};

const TYPE_SCORES: Record<string, number> = {
  'kind/bug': 10,
  'kind/enhancement': 6,
  'area/docs': 3,
};

interface GhIssue {
  number: number;
  title: string;
  body: string;
  labels: Array<{ name: string }>;
  assignees: Array<{ login: string }>;
}

function _scoreIssue(issue: GhIssue): number {
  let score = 0;
  const labelNames = issue.labels.map(l => l.name);
  for (const label of labelNames) {
    score += TYPE_SCORES[label] ?? 0;
    score += PRIORITY_BOOSTS[label] ?? 0;
    if (label === 'good first issue') score += 1;
  }
  return score;
}

function _estimateStoryPoints(issue: GhIssue): number {
  const body = issue.body ?? '';
  if (body.length < 200) return 1;
  if (body.length < 500) return 2;
  if (body.includes('migration') || body.includes('refactor')) return 5;
  return 3;
}

export async function pickIssueNode(state: State): Promise<Partial<State>> {
  // If an issue was pre-specified (from issueUrl or issueNumber), skip LLM pick
  if (state.issueUrl || state.jiraKey || state.issueNumber) {
    return {
      messages: [
        `pick_issue: using pre-specified issue — ${state.jiraKey || state.issueUrl || `#${state.issueNumber}`}`,
      ],
      status: 'running',
    };
  }

  const config = await loadProjectConfig(state.project);
  const budget = config?.story_point_budget ?? 3;
  const repo = state.repoSlug;

  const prompt = `
You are picking the next GitHub issue to work on for project "${state.project}" (${repo}).

Use the gh_issue_list tool to fetch open issues from ${repo}.
Then use gh_issue_edit to assign the chosen issue to @me.

Rules:
- Only unassigned issues (assignees array is empty)
- Forbidden labels: wontfix, duplicate, stale, lifecycle/stale, needs-triage, blocked
- Prefer kind/bug > kind/enhancement > area/docs
- Story point budget: ${budget} (estimate 1=trivial, 2=small, 3=medium, 5=large)

After selecting an issue, respond with ONLY valid JSON in this exact format (no markdown):
{
  "issueNumber": <number>,
  "issueTitle": "<title>",
  "issueUrl": "https://github.com/${repo}/issues/<number>",
  "issueBody": "<body text>",
  "issueLabels": ["<label1>", "<label2>"],
  "storyPoints": <1-5>
}
`;

  const response = await llm.invoke([new HumanMessage(prompt)]);
  let text: string;
  if (typeof response.content === 'string') {
    text = response.content;
  } else if (Array.isArray(response.content)) {
    text = response.content
      .map((p: unknown) => (typeof p === 'string' ? p : ((p as { text?: string }).text ?? '')))
      .join('');
  } else {
    text = JSON.stringify(response.content);
  }
  // Strip markdown code fences
  text = text.replace(/```(?:json)?\s*/m, '').replace(/```\s*$/m, '');

  // Extract JSON from the response
  const jsonMatch = text.match(/\{[\s\S]+\}/);
  if (!jsonMatch) {
    return { messages: ['pick_issue: no issue found or JSON parse failed'], status: 'skipped' };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      issueNumber: number;
      issueTitle: string;
      issueUrl: string;
      issueBody: string;
      issueLabels: string[];
      storyPoints: number;
    };

    return {
      issueNumber: parsed.issueNumber,
      issueTitle: parsed.issueTitle,
      issueUrl: parsed.issueUrl,
      issueBody: parsed.issueBody ?? '',
      issueLabels: parsed.issueLabels ?? [],
      storyPoints: Math.min(parsed.storyPoints, 8),
      messages: [
        `pick_issue: selected #${parsed.issueNumber} "${parsed.issueTitle}" (${parsed.storyPoints} SP)`,
      ],
    };
  } catch {
    return { messages: ['pick_issue: failed to parse LLM response'], status: 'failed' };
  }
}
