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

import type { FastifyPluginAsync } from 'fastify';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { loadProjectConfig } from '../../context/loader.js';

const execAsync = promisify(exec);

interface GhLabel {
  name: string;
}
interface GhIssue {
  number: number;
  title: string;
  body: string;
  labels: GhLabel[];
  assignees: Array<{ login: string }>;
}

interface ScoredIssue {
  number: number;
  title: string;
  url: string;
  labels: string[];
  score: number;
  storyPoints: number;
  unassigned: boolean;
}

const FORBIDDEN_LABELS = new Set([
  'wontfix',
  'duplicate',
  'stale',
  'lifecycle/stale',
  'needs-triage',
  'blocked',
]);

const TYPE_SCORES: Record<string, number> = {
  'kind/bug': 10,
  'kind/enhancement': 6,
  'area/docs': 3,
};

const PRIORITY_BOOSTS: Record<string, number> = {
  'priority/critical': 5,
  'priority/blocker': 5,
  'priority/major': 3,
  'priority/minor': 0,
  'priority/trivial': -2,
  'good first issue': 1,
};

function scoreIssue(issue: GhIssue): number {
  let score = 0;
  for (const { name } of issue.labels) {
    score += TYPE_SCORES[name] ?? 0;
    score += PRIORITY_BOOSTS[name] ?? 0;
  }
  return score;
}

function estimateStoryPoints(issue: GhIssue): number {
  const body = issue.body ?? '';
  if (body.length < 150) return 1;
  if (body.length < 400) return 2;
  if (/migration|refactor|architecture/i.test(body)) return 5;
  return 3;
}

const tags = ['Issues'];

export const issuesRoutes: FastifyPluginAsync = async app => {
  app.get<{ Querystring: { project?: string; cached?: string } }>(
    '/',
    { schema: { tags } },
    async (req, reply) => {
      const { project } = req.query;
      if (!project) return reply.status(400).send({ error: 'project query param required' });

      const config = await loadProjectConfig(project);
      if (!config) return reply.status(404).send({ error: `Project "${project}" not found` });

      const repo = config.repo;
      if (!repo) return reply.status(400).send({ error: 'Project has no repo configured' });

      const env = { ...process.env, GH_TOKEN: process.env.GITHUB_TOKEN ?? '' };

      let raw: string;
      try {
        const { stdout } = await execAsync(
          `gh issue list --repo ${repo} --state open --json number,title,body,labels,assignees --limit 100`,
          { env, timeout: 30_000 },
        );
        raw = stdout;
      } catch (e: unknown) {
        const err = e as { stderr?: string; message?: string };
        return reply
          .status(502)
          .send({ error: `GitHub fetch failed: ${err.message ?? String(e)}`, detail: err.stderr });
      }

      let issues: GhIssue[];
      try {
        issues = JSON.parse(raw) as GhIssue[];
      } catch {
        return reply.status(502).send({ error: 'Failed to parse GitHub response' });
      }

      const scored: ScoredIssue[] = issues
        .filter(i => {
          const labelNames = i.labels.map(l => l.name);
          return !labelNames.some(n => FORBIDDEN_LABELS.has(n));
        })
        .map(i => ({
          number: i.number,
          title: i.title,
          url: `https://github.com/${repo}/issues/${i.number}`,
          labels: i.labels.map(l => l.name),
          score: scoreIssue(i),
          storyPoints: estimateStoryPoints(i),
          unassigned: i.assignees.length === 0,
        }))
        .sort((a, b) => b.score - a.score);

      return reply.send(scored);
    },
  );
};
