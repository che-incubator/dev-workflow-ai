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

/**
 * /api/sources — manage issue sources (GitHub repos + Jira boards)
 *
 * GET    /api/sources                 list all sources
 * POST   /api/sources                 add a source by URL
 * DELETE /api/sources/:id             remove a source
 * POST   /api/sources/:id/sync        trigger a sync (fetch issues from GitHub/Jira)
 * GET    /api/sources/:id/issues      issues fetched from this source
 * GET    /api/sources/issues          all issues across all active sources (sorted by score)
 */

import type { FastifyPluginAsync } from 'fastify';
import { db } from '../../db/client.js';

// ── Types ──────────────────────────────────────────────────────────────────

interface IssueSourceRow {
  id: number;
  url: string;
  kind: string;
  label: string;
  project_slug: string;
  active: boolean;
  last_synced_at: string | null;
  created_at: string;
}

interface IssueRow {
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
}

// ── URL classification ─────────────────────────────────────────────────────

function classifyUrl(url: string): { kind: 'github' | 'jira'; label: string } | null {
  // GitHub: https://github.com/owner/repo  OR  https://github.com/owner/repo/issues
  const gh = url.match(/github\.com\/([^/]+\/[^/?\s]+)/);
  if (gh) {
    const slug = gh[1].replace(/\/(issues|pulls).*$/, '');
    return { kind: 'github', label: slug };
  }
  // Jira: https://<host>/jira/...  OR  https://<host>/browse/PROJECT
  if (url.includes('atlassian.net') || url.includes('/jira/') || url.includes('/browse/')) {
    const host = new URL(url).hostname;
    return { kind: 'jira', label: host };
  }
  return null;
}

// ── GitHub fetcher ─────────────────────────────────────────────────────────

const PRIORITY_LABELS: Record<string, string> = {
  'priority/critical': 'critical',
  'priority/blocker': 'critical',
  'priority/major': 'major',
  'priority/minor': 'minor',
  'priority/trivial': 'trivial',
};

const BASE_SCORE: Record<string, number> = {
  'kind/bug': 10,
  'kind/enhancement': 6,
  'area/docs': 3,
};

const BOOST: Record<string, number> = {
  'priority/critical': 5,
  'priority/major': 3,
  'good first issue': 1,
  'help wanted': 1,
  // CVE / Security: always highest priority
  Security: 30,
  security: 30,
};

const SKIP_LABELS = new Set([
  'wontfix',
  'duplicate',
  'stale',
  'lifecycle/stale',
  'needs-triage',
  'blocked',
  'invalid',
]);

function scoreIssue(labels: string[], titleHint = ''): { score: number; priority: string } {
  let score = 5; // default base
  let priority = '';

  for (const label of labels) {
    if (BASE_SCORE[label]) score += BASE_SCORE[label];
    if (BOOST[label]) score += BOOST[label];
    if (PRIORITY_LABELS[label]) priority = PRIORITY_LABELS[label];
    // Any label that looks like "CVE-YYYY-NNNNN" gets security boost
    if (/^CVE-\d{4}-\d+/i.test(label)) score += 25;
  }
  if (priority === 'critical') score += 5;
  if (priority === 'major') score += 3;

  // Boost CVEs detected in the title (common for Jira issues like "CVE-2026-...")
  if (/CVE-\d{4}-\d+/i.test(titleHint)) {
    score = Math.max(score, 40); // floor at 40 to guarantee top placement
    if (!priority) priority = 'critical';
  }

  return { score, priority };
}

function adfToText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as Record<string, unknown>;
  if (n.type === 'text' && typeof n.text === 'string') return n.text;
  const children = (n.content ?? []) as unknown[];
  return children.map(adfToText).join(n.type === 'paragraph' ? '\n' : '');
}

function jiraStoryPoints(fields: Record<string, unknown>): number {
  // Jira Cloud uses customfield_10028 for Story Points
  const v = fields['customfield_10028'] ?? fields['story_points'] ?? fields['customfield_10016'];
  return typeof v === 'number' ? Math.round(v) : 0;
}

function estimateStoryPoints(body: string, title: string): number {
  const text = (title + ' ' + body).toLowerCase();
  if (text.includes('typo') || text.includes('minor') || text.includes('bump version')) return 1;
  if (text.includes('crash') || text.includes('null pointer') || text.includes('npe')) return 2;
  if (body.length > 1000) return 3;
  return 2;
}

async function fetchGitHubIssues(repoSlug: string, sourceId: number): Promise<number> {
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'dev-workflow-ai',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  let page = 1;
  let inserted = 0;
  const FORBIDDEN_LABELS = [...SKIP_LABELS];

  while (page <= 3) {
    // max 3 pages = 300 issues
    const res = await fetch(
      `https://api.github.com/repos/${repoSlug}/issues?state=open&per_page=100&page=${page}`,
      { headers },
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub API ${res.status}: ${text.slice(0, 200)}`);
    }

    const items = (await res.json()) as Record<string, unknown>[];

    if (items.length === 0) break;

    for (const item of items) {
      // Skip pull requests (GitHub API returns them in /issues)
      if ((item as { pull_request?: unknown }).pull_request) continue;

      const labels = ((item as { labels?: { name?: string }[] }).labels ?? []).map(
        l => l.name ?? '',
      );
      if (labels.some(l => FORBIDDEN_LABELS.includes(l))) continue;

      const number = String((item as { number?: number }).number ?? '');
      const title = String((item as { title?: string }).title ?? '');
      const url = String((item as { html_url?: string }).html_url ?? '');
      const body = String((item as { body?: string }).body ?? '');
      const assignees = ((item as { assignees?: { login?: string }[] }).assignees ?? []).map(
        a => a.login ?? '',
      );

      const { score, priority } = scoreIssue(labels, title);
      const storyPoints = estimateStoryPoints(body, title);

      await db.query(
        `INSERT INTO issues (source_id, external_id, title, url, body, labels, priority, assignees, status, score, story_points, raw, fetched_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'open',$9,$10,$11,now())
         ON CONFLICT (source_id, external_id)
         DO UPDATE SET title=$3, url=$4, body=$5, labels=$6, priority=$7, assignees=$8, score=$9, story_points=$10, raw=$11, fetched_at=now()`,
        [
          sourceId,
          number,
          title,
          url,
          body.slice(0, 4000),
          labels,
          priority,
          assignees,
          score,
          storyPoints,
          JSON.stringify(item),
        ],
      );
      inserted++;
    }

    if (items.length < 100) break;
    page++;
  }

  return inserted;
}

// ── Jira fetcher ───────────────────────────────────────────────────────────

const JIRA_PRIORITY_MAP: Record<string, string> = {
  Critical: 'critical',
  Blocker: 'critical',
  Major: 'major',
  Normal: 'minor',
  Minor: 'minor',
  Trivial: 'trivial',
};

async function fetchJiraIssues(sourceUrl: string, sourceId: number): Promise<number> {
  const token = process.env.JIRA_TOKEN || process.env.JIRA_API_TOKEN;
  if (!token) throw new Error('JIRA_TOKEN not set');

  const baseUrl = process.env.JIRA_BASE_URL ?? 'https://redhat.atlassian.net';

  // JQL: open issues assigned to current user, or from "for-you" board
  // If URL has a project key, scope to that project
  const projectMatch = sourceUrl.match(/\/browse\/([A-Z]+)/);
  const jql = projectMatch
    ? `project = ${projectMatch[1]} AND status not in (Done, Closed, Resolved) ORDER BY priority DESC`
    : `assignee = currentUser() AND status not in (Done, Closed, Resolved) ORDER BY priority DESC, updated DESC`;

  const res = await fetch(
    `${baseUrl}/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=100&fields=summary,description,labels,priority,assignee,status,issuetype`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'User-Agent': 'dev-workflow-ai',
      },
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira API ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as { issues?: Record<string, unknown>[] };
  const items = data.issues ?? [];
  let inserted = 0;

  for (const item of items) {
    const fields = (item as { fields?: Record<string, unknown> }).fields ?? {};
    const key = String((item as { key?: string }).key ?? '');
    const title = String((fields.summary as string | undefined) ?? '');
    const url = `${baseUrl}/browse/${key}`;
    const body = String(
      (
        (fields.description as { content?: unknown[] } | null)?.content?.[0] as {
          content?: { text?: string }[];
        } | null
      )?.content?.[0]?.text ?? '',
    );
    const priorityName = String((fields.priority as { name?: string } | null)?.name ?? '');
    const priority = JIRA_PRIORITY_MAP[priorityName] ?? '';
    const assigneeLogin = String(
      (fields.assignee as { emailAddress?: string } | null)?.emailAddress ?? '',
    );
    const labels = (fields.labels as string[] | null) ?? [];
    const status = String(
      (fields.status as { name?: string } | null)?.name ?? 'open',
    ).toLowerCase();
    const issuetype = String(
      (fields.issuetype as { name?: string } | null)?.name ?? '',
    ).toLowerCase();

    const { score, priority: scoredPriority } = scoreIssue(labelsArr, title);
    const finalScore = Math.max(score, issuetype.includes('bug') ? 10 : 6);
    const finalPriority = scoredPriority || priority;
    const storyPoints = estimateStoryPoints(body, title);

    await db.query(
      `INSERT INTO issues (source_id, external_id, title, url, body, labels, priority, assignees, status, score, story_points, raw, fetched_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
       ON CONFLICT (source_id, external_id)
       DO UPDATE SET title=$3, url=$4, body=$5, labels=$6, priority=$7, assignees=$8, status=$9, score=$10, story_points=$11, raw=$12, fetched_at=now()`,
      [
        sourceId,
        key,
        title,
        url,
        body.slice(0, 4000),
        labels,
        finalPriority,
        assigneeLogin ? [assigneeLogin] : [],
        status,
        finalScore,
        storyPoints,
        JSON.stringify(item),
      ],
    );
    inserted++;
  }

  return inserted;
}

// ── Routes ─────────────────────────────────────────────────────────────────

const tags = ['Sources'];

export const sourcesRoutes: FastifyPluginAsync = async app => {
  // GET /api/sources — list all sources
  app.get('/', { schema: { tags } }, async (_req, reply) => {
    const { rows } = await db.query<IssueSourceRow>(
      'SELECT * FROM issue_sources ORDER BY created_at DESC',
    );
    return reply.send(rows);
  });

  // POST /api/sources — add source by URL
  app.post<{ Body: { url: string; project_slug?: string; label?: string } }>(
    '/',
    { schema: { tags } },
    async (req, reply) => {
      const { url, project_slug, label } = req.body;
      if (!url) return reply.status(400).send({ error: 'url is required' });

      const classified = classifyUrl(url);
      if (!classified)
        return reply.status(400).send({ error: 'URL must be a GitHub repo or Jira board URL' });

      // Normalise the URL
      const cleanUrl = url
        .replace(/\/(issues|pulls)\/?$/, '')
        .replace(/[?#].*$/, '')
        .replace(/\/$/, '');

      const { rows } = await db.query<IssueSourceRow>(
        `INSERT INTO issue_sources (url, kind, label, project_slug)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (url) DO UPDATE SET active = true, label = $3
       RETURNING *`,
        [cleanUrl, classified.kind, label ?? classified.label, project_slug ?? ''],
      );

      // Auto-trigger first sync
      const source = rows[0];
      syncSource(source).catch(e => console.error(`[sync ${source.id}] Error:`, e));

      return reply.status(201).send(source);
    },
  );

  // DELETE /api/sources/:id
  app.delete<{ Params: { id: string } }>('/:id', { schema: { tags } }, async (req, reply) => {
    await db.query('DELETE FROM issue_sources WHERE id = $1', [req.params.id]);
    return reply.status(204).send();
  });

  // POST /api/sources/:id/sync — manual sync trigger
  app.post<{ Params: { id: string } }>('/:id/sync', { schema: { tags } }, async (req, reply) => {
    const { rows } = await db.query<IssueSourceRow>('SELECT * FROM issue_sources WHERE id = $1', [
      req.params.id,
    ]);
    if (!rows[0]) return reply.status(404).send({ error: 'Source not found' });

    const source = rows[0];

    // Jira "assigned to me" sources use a dedicated sync path
    if (source.url.includes('/jira/for-you')) {
      syncJiraAssigned(source).catch(e => console.error(`[jira-assigned ${source.id}] Error:`, e));
    } else {
      syncSource(source).catch(e => console.error(`[sync ${source.id}] Error:`, e));
    }

    return reply.send({ syncing: true, sourceId: source.id });
  });

  // GET /api/sources/:id/issues — issues from one source
  app.get<{ Params: { id: string }; Querystring: { status?: string } }>(
    '/:id/issues',
    { schema: { tags } },
    async (req, reply) => {
      const status = req.query.status ?? 'open';
      const { rows } = await db.query<IssueRow>(
        `SELECT i.*, s.label as source_label, s.kind as source_kind
       FROM issues i JOIN issue_sources s ON s.id = i.source_id
       WHERE i.source_id = $1 AND i.status = $2
       ORDER BY i.score DESC, i.id DESC`,
        [req.params.id, status],
      );
      return reply.send(rows);
    },
  );

  // POST /api/sources/issues/import — fetch a single GitHub or Jira issue by URL,
  //   auto-create its source if needed, store in DB, return the stored issue row.
  app.post<{ Body: { url: string } }>(
    '/issues/import',
    {
      schema: {
        tags,
        body: {
          type: 'object',
          required: ['url'],
          properties: { url: { type: 'string' } },
          examples: [{ url: 'https://github.com/eclipse-che/che-dashboard/issues/1234' }],
        },
      },
    },
    async (req, reply) => {
      const { url } = req.body;
      if (!url?.trim()) return reply.status(400).send({ error: 'url is required' });

      // ── GitHub ──────────────────────────────────────────────────────────────
      const ghMatch = url.match(/github\.com\/([^/]+\/[^/]+)\/(?:issues|pull)\/(\d+)/);
      if (ghMatch) {
        const [, repoSlug, num] = ghMatch;
        const ghToken = process.env.GITHUB_TOKEN;
        const headers: Record<string, string> = {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'dev-workflow-ai',
        };
        if (ghToken) headers['Authorization'] = `Bearer ${ghToken}`;
        const res = await fetch(`https://api.github.com/repos/${repoSlug}/issues/${num}`, {
          headers,
        });
        if (!res.ok) return reply.status(res.status).send({ error: `GitHub API: ${res.status}` });
        const gh = (await res.json()) as {
          number: number;
          title: string;
          body: string;
          labels: { name: string }[];
          state: string;
          assignees: { login: string }[];
        };

        const sourceUrl = `https://github.com/${repoSlug}/issues`;
        const {
          rows: [src],
        } = await db.query<IssueSourceRow>(
          `INSERT INTO issue_sources (url, kind, label) VALUES ($1, 'github', $2)
         ON CONFLICT (url) DO UPDATE SET label = EXCLUDED.label RETURNING *`,
          [sourceUrl, repoSlug],
        );
        const {
          rows: [issue],
        } = await db.query(
          `INSERT INTO issues (source_id, external_id, title, url, body, labels, status, raw, fetched_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
         ON CONFLICT (source_id, external_id) DO UPDATE SET
           title = EXCLUDED.title, body = EXCLUDED.body, labels = EXCLUDED.labels,
           status = EXCLUDED.status, raw = EXCLUDED.raw, fetched_at = now()
         RETURNING *, $9::text as source_label`,
          [
            src.id,
            String(gh.number),
            gh.title,
            url,
            gh.body ?? '',
            gh.labels.map(l => l.name),
            gh.state === 'open' ? 'open' : 'closed',
            JSON.stringify(gh),
            repoSlug,
          ],
        );
        return reply.send(issue);
      }

      // ── Jira ────────────────────────────────────────────────────────────────
      const jiraMatch = url.match(/\/browse\/([A-Z]+-\d+)/);
      if (jiraMatch) {
        const key = jiraMatch[1];
        const project = key.replace(/-\d+$/, '');
        const jiraToken = process.env.JIRA_TOKEN || process.env.JIRA_API_TOKEN;
        const jiraEmail = process.env.JIRA_EMAIL;
        const jiraBase = process.env.JIRA_BASE_URL ?? 'https://issues.redhat.com';

        if (!jiraToken || !jiraEmail) {
          return reply.status(400).send({ error: 'JIRA_TOKEN and JIRA_EMAIL required' });
        }
        const auth = Buffer.from(`${jiraEmail}:${jiraToken}`).toString('base64');
        const res = await fetch(
          `${jiraBase}/rest/api/3/issue/${key}?fields=summary,description,labels,status,priority,assignee`,
          { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } },
        );
        if (!res.ok) return reply.status(res.status).send({ error: `Jira API: ${res.status}` });
        const jira = (await res.json()) as {
          key: string;
          fields: {
            summary: string;
            description?: unknown;
            labels?: string[];
            status?: { name: string };
            priority?: { name: string };
            assignee?: { emailAddress: string };
          };
        };

        const sourceUrl = `${jiraBase}/projects/${project}`;
        const {
          rows: [src],
        } = await db.query<IssueSourceRow>(
          `INSERT INTO issue_sources (url, kind, label) VALUES ($1, 'jira', $2)
         ON CONFLICT (url) DO UPDATE SET label = EXCLUDED.label RETURNING *`,
          [sourceUrl, project],
        );
        // Extract plain text from Atlassian Document Format
        function adfToText(node: unknown): string {
          if (!node || typeof node !== 'object') return '';
          const n = node as Record<string, unknown>;
          if (n.type === 'text' && typeof n.text === 'string') return n.text;
          const children = (n.content ?? []) as unknown[];
          return children.map(adfToText).join(n.type === 'paragraph' ? '\n' : '');
        }
        const body = jira.fields.description ? adfToText(jira.fields.description).trim() : '';

        const title = jira.fields.summary;
        const status =
          (jira.fields.status?.name ?? 'open').toLowerCase() === 'done' ? 'closed' : 'open';
        const priority = (jira.fields.priority?.name ?? '').toLowerCase();
        const {
          rows: [issue],
        } = await db.query(
          `INSERT INTO issues (source_id, external_id, title, url, body, labels, status, priority, raw, fetched_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
         ON CONFLICT (source_id, external_id) DO UPDATE SET
           title = EXCLUDED.title, body = EXCLUDED.body, labels = EXCLUDED.labels,
           status = EXCLUDED.status, priority = EXCLUDED.priority,
           raw = EXCLUDED.raw, fetched_at = now()
         RETURNING *, $10::text as source_label`,
          [
            src.id,
            key,
            title,
            url,
            body,
            jira.fields.labels ?? [],
            status,
            priority,
            JSON.stringify(jira.fields),
            project,
          ],
        );
        return reply.send(issue);
      }

      return reply.status(400).send({ error: 'URL must be a GitHub issue or Jira browse URL' });
    },
  );

  // POST /api/sources/jira/sync-assigned — fetch all Jira issues assigned to the current user
  // Triggered when a source URL ends with /jira/for-you?tab=assigned
  app.post(
    '/jira/sync-assigned',
    {
      schema: {
        tags,
        body: {
          type: ['object', 'null'],
          properties: {
            sourceId: {
              type: 'number',
              description: 'IssueSource id to associate with (auto-created if omitted)',
            },
          },
        },
      },
    },
    async (req, reply) => {
      const jiraToken = process.env.JIRA_TOKEN ?? process.env.JIRA_API_TOKEN;
      const jiraEmail = process.env.JIRA_EMAIL;
      const jiraBase = process.env.JIRA_BASE_URL ?? 'https://redhat.atlassian.net';

      if (!jiraToken || !jiraEmail) {
        return reply.status(400).send({ error: 'JIRA_TOKEN and JIRA_EMAIL env vars required' });
      }

      const sourceUrl = `${jiraBase}/jira/for-you?tab=assigned`;
      const auth = Buffer.from(`${jiraEmail}:${jiraToken}`).toString('base64');

      // Ensure the source row exists
      const body = req.body as { sourceId?: number } | null;
      let sourceId: number = body?.sourceId ?? 0;

      if (!sourceId) {
        const {
          rows: [src],
        } = await db.query<IssueSourceRow>(
          `INSERT INTO issue_sources (url, kind, label, project_slug)
         VALUES ($1, 'jira', 'Assigned to me', '')
         ON CONFLICT (url) DO UPDATE SET label = EXCLUDED.label RETURNING *`,
          [sourceUrl],
        );
        sourceId = src.id;
      }

      // Fetch assigned-to-me open issues (To Do / New only — skip In Progress and Done)
      // Uses Jira REST API v3 /search/jql (POST) with cursor-based pagination (nextPageToken).
      // Note: startAt is NOT valid for this endpoint; use nextPageToken instead.
      const jql =
        'assignee = currentUser() AND resolution = Unresolved AND statusCategory = "To Do" ORDER BY updated DESC';
      const maxResults = 100;
      let upserted = 0;
      let nextPageToken: string | undefined;

      while (true) {
        const bodyPayload: Record<string, unknown> = {
          jql,
          maxResults,
          fields: [
            'summary',
            'description',
            'status',
            'priority',
            'labels',
            'issuetype',
            'updated',
            'customfield_10028',
          ],
        };
        if (nextPageToken) bodyPayload.nextPageToken = nextPageToken;

        const res = await fetch(`${jiraBase}/rest/api/3/search/jql`, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${auth}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(bodyPayload),
        });

        if (!res.ok) {
          const text = await res.text();
          return reply
            .status(res.status)
            .send({ error: `Jira API error: ${res.status}`, detail: text.slice(0, 300) });
        }

        const data = (await res.json()) as {
          issues: Array<{
            key: string;
            fields: Record<string, unknown> & {
              summary: string;
              status?: { name: string };
              priority?: { name: string };
              labels?: string[];
              description?: unknown;
            };
          }>;
          nextPageToken?: string;
        };

        for (const issue of data.issues) {
          const { key, fields } = issue;
          const issueUrl = `${jiraBase}/browse/${key}`;
          const title = fields.summary;
          const body = fields.description ? adfToText(fields.description).slice(0, 4000) : '';
          const rawPriority = (fields.priority?.name ?? '').toLowerCase();
          const priority = rawPriority.includes('critical')
            ? 'critical'
            : rawPriority.includes('major') || rawPriority.includes('high')
              ? 'major'
              : rawPriority.includes('minor') || rawPriority.includes('medium')
                ? 'minor'
                : rawPriority.includes('trivial') || rawPriority.includes('low')
                  ? 'trivial'
                  : '';

          const { score: issScore } = scoreIssue(fields.labels ?? [], title);
          const sp = jiraStoryPoints(fields) || estimateStoryPoints(body, title);

          await db.query(
            `INSERT INTO issues (source_id, external_id, title, url, body, labels, status, priority, score, story_points, raw, fetched_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8, $9, $10, now())
           ON CONFLICT (source_id, external_id) DO UPDATE SET
             title = EXCLUDED.title, body = EXCLUDED.body, labels = EXCLUDED.labels,
             status = 'open', priority = EXCLUDED.priority,
             score = EXCLUDED.score, story_points = EXCLUDED.story_points,
             raw = EXCLUDED.raw, fetched_at = now()`,
            [
              sourceId,
              key,
              title,
              issueUrl,
              body,
              fields.labels ?? [],
              priority,
              issScore,
              sp,
              JSON.stringify(fields),
            ],
          );
          upserted++;
        }

        if (!data.nextPageToken || data.issues.length < maxResults) break;
        nextPageToken = data.nextPageToken;
      }

      await db.query('UPDATE issue_sources SET last_synced_at = now() WHERE id = $1', [sourceId]);

      console.log(`[jira-assigned] Synced ${upserted} issues into source ${sourceId}`);
      return reply.send({ sourceId, upserted });
    },
  );

  // DELETE /api/sources/issues/:issueId — remove a single stored issue
  app.delete<{ Params: { issueId: string } }>(
    '/issues/:issueId',
    { schema: { tags } },
    async (req, reply) => {
      await db.query('DELETE FROM issues WHERE id = $1', [parseInt(req.params.issueId, 10)]);
      return reply.status(204).send();
    },
  );

  // GET /api/sources/issues — all open issues across active sources
  app.get<{ Querystring: { status?: string; limit?: string } }>(
    '/issues',
    { schema: { tags } },
    async (req, reply) => {
      const status = req.query.status ?? 'open';
      const limit = Math.min(parseInt(req.query.limit ?? '200', 10), 500);
      const { rows } = await db.query(
        `SELECT i.*, s.label as source_label, s.kind as source_kind, s.url as source_url
       FROM issues i
       JOIN issue_sources s ON s.id = i.source_id
       WHERE i.status = $1 AND s.active = true
       ORDER BY i.score DESC, i.priority ASC, i.id DESC
       LIMIT $2`,
        [status, limit],
      );
      return reply.send(rows);
    },
  );
};

// ── Background sync ────────────────────────────────────────────────────────

// ── Background sync for Jira "assigned to me" sources ─────────────────────

async function syncJiraAssigned(source: IssueSourceRow): Promise<void> {
  const jiraToken = process.env.JIRA_TOKEN ?? process.env.JIRA_API_TOKEN;
  const jiraEmail = process.env.JIRA_EMAIL;
  const jiraBase = process.env.JIRA_BASE_URL ?? 'https://redhat.atlassian.net';

  if (!jiraToken || !jiraEmail) {
    console.error('[jira-assigned] JIRA_TOKEN and JIRA_EMAIL env vars required');
    return;
  }

  const auth = Buffer.from(`${jiraEmail}:${jiraToken}`).toString('base64');
  // Only "To Do" / "New" issues — skip In Progress and Done.
  // Uses cursor-based pagination (nextPageToken), not startAt.
  const jql =
    'assignee = currentUser() AND resolution = Unresolved AND statusCategory = "To Do" ORDER BY updated DESC';
  const maxResults = 100;
  let upserted = 0;
  let nextPageToken: string | undefined;

  while (true) {
    const bodyPayload: Record<string, unknown> = {
      jql,
      maxResults,
      fields: [
        'summary',
        'description',
        'status',
        'priority',
        'labels',
        'issuetype',
        'updated',
        'customfield_10028',
      ],
    };
    if (nextPageToken) bodyPayload.nextPageToken = nextPageToken;

    const res = await fetch(`${jiraBase}/rest/api/3/search/jql`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(bodyPayload),
    });

    if (!res.ok) {
      console.error(`[jira-assigned] Jira API error: ${res.status}`);
      return;
    }

    const data = (await res.json()) as {
      issues: Array<{
        key: string;
        fields: Record<string, unknown> & {
          summary: string;
          status?: { name: string };
          priority?: { name: string };
          labels?: string[];
          description?: unknown;
        };
      }>;
      nextPageToken?: string;
    };

    for (const issue of data.issues) {
      const { key, fields } = issue;
      const issueUrl = `${jiraBase}/browse/${key}`;
      const body = fields.description ? adfToText(fields.description).slice(0, 4000) : '';
      const rawPriority = (fields.priority?.name ?? '').toLowerCase();
      const priority = rawPriority.includes('critical')
        ? 'critical'
        : rawPriority.includes('major') || rawPriority.includes('high')
          ? 'major'
          : rawPriority.includes('minor') || rawPriority.includes('medium')
            ? 'minor'
            : rawPriority.includes('trivial') || rawPriority.includes('low')
              ? 'trivial'
              : '';

      const { score: issueScore } = scoreIssue(fields.labels ?? [], fields.summary);
      const sp = jiraStoryPoints(fields) || estimateStoryPoints(body, fields.summary);

      await db.query(
        `INSERT INTO issues (source_id, external_id, title, url, body, labels, status, priority, score, story_points, raw, fetched_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8, $9, $10, now())
         ON CONFLICT (source_id, external_id) DO UPDATE SET
           title = EXCLUDED.title, body = EXCLUDED.body, labels = EXCLUDED.labels,
           status = 'open', priority = EXCLUDED.priority,
           score = EXCLUDED.score, story_points = EXCLUDED.story_points,
           raw = EXCLUDED.raw, fetched_at = now()`,
        [
          source.id,
          key,
          fields.summary,
          issueUrl,
          body,
          fields.labels ?? [],
          priority,
          issueScore,
          sp,
          JSON.stringify(fields),
        ],
      );
      upserted++;
    }

    if (!data.nextPageToken || data.issues.length < maxResults) break;
    nextPageToken = data.nextPageToken;
  }

  await db.query('UPDATE issue_sources SET last_synced_at = now() WHERE id = $1', [source.id]);
  console.log(`[jira-assigned] Synced ${upserted} issues for source ${source.id}`);
}

// ── Background sync for GitHub / generic Jira project sources ─────────────

async function syncSource(source: IssueSourceRow): Promise<void> {
  console.log(`[sync] Starting sync for ${source.kind} source: ${source.label} (id=${source.id})`);
  try {
    let count = 0;
    if (source.kind === 'github') {
      // Extract owner/repo from URL: https://github.com/owner/repo
      const slug =
        source.url.replace('https://github.com/', '').replace(/\/.*/, '') +
        '/' +
        source.url.replace('https://github.com/', '').split('/')[1];
      count = await fetchGitHubIssues(slug, source.id);
    } else if (source.kind === 'jira') {
      count = await fetchJiraIssues(source.url, source.id);
    }

    await db.query('UPDATE issue_sources SET last_synced_at = now() WHERE id = $1', [source.id]);
    console.log(`[sync] ✓ ${source.label}: ${count} issues upserted`);
  } catch (err) {
    console.error(`[sync] ✗ ${source.label}:`, err instanceof Error ? err.message : err);
  }
}
