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
import { randomUUID } from 'node:crypto';
import { db } from '../../db/client.js';
import { loadProjectConfig } from '../../context/loader.js';
import { getGraph } from '../../agent/graph.js';
import { emitRunEvent } from '../ws/agentStream.js';
import type { AgentRunRow, RunEventRow, FindingRow } from '../../db/schema.js';
import type { State } from '../../agent/state.js';
import { startRunSchema } from '../../constants/schemas.js';
import { acquireRepoLock, resetRepoBranch } from '../../utils/repoLock.js';

// In-process registry of AbortControllers for running agent tasks.
// Allows the DELETE endpoint to signal cancellation to the running graph.
const runningJobs = new Map<string, AbortController>();

interface StartRunBody {
  project?: string; // optional when issueUrl is provided
  issueNumber?: number;
  issueUrl?: string; // e.g. https://github.com/eclipse-che/che/issues/20670
  forcePriority?: boolean;
  outputDir?: string; // override output directory (default: "output")
}

/** Parse owner/repo/number from a GitHub issue URL */
function parseIssueUrl(url: string): { owner: string; repo: string; number: number } | null {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2], number: parseInt(m[3]) };
}

/** Parse Jira issue key from a Jira browse URL, e.g. https://redhat.atlassian.net/browse/CRW-12963 */
function parseJiraUrl(url: string): { key: string } | null {
  const m = url.match(/\/browse\/([A-Z]+-\d+)/i);
  return m ? { key: m[1].toUpperCase() } : null;
}

/** Find project_slug for a Jira key by looking it up in issues → issue_sources */
async function projectForJiraKey(key: string): Promise<string | null> {
  // 1. Issue row with a project_slug on its source
  const { rows } = await db.query<{ project_slug: string }>(
    `SELECT s.project_slug
       FROM issues si
       JOIN issue_sources s ON si.source_id = s.id
      WHERE si.external_id = $1 AND s.project_slug <> ''
      LIMIT 1`,
    [key],
  );
  if (rows[0]?.project_slug) return rows[0].project_slug;

  // 2. Any Jira source with a project_slug set
  const { rows: src } = await db.query<{ project_slug: string }>(
    `SELECT project_slug FROM issue_sources WHERE kind = 'jira' AND project_slug <> '' LIMIT 1`,
  );
  if (src[0]?.project_slug) return src[0].project_slug;

  // 3. Search context chunks that are linked to a real project (not shared skills)
  const prefix = key.replace(/-\d+$/, '');
  const { rows: ctx } = await db.query<{ project_slug: string }>(
    `SELECT c.project_slug FROM contexts c
     JOIN projects p ON p.name = c.project_slug
     WHERE c.content LIKE $1 LIMIT 1`,
    [`%${prefix}-%`],
  );
  if (ctx[0]?.project_slug) return ctx[0].project_slug;

  // 4. Last resort: first project in the DB
  const { rows: proj } = await db.query<{ name: string }>('SELECT name FROM projects LIMIT 1');
  return proj[0]?.name ?? null;
}

/** Map a repo slug to a project name — checks rules.json projects keys */
const REPO_TO_PROJECT: Record<string, string> = {
  'eclipse-che/che-dashboard': 'che-dashboard',
  'eclipse-che/che-server': 'che-server',
  'eclipse-che/che': 'che',
  'eclipse-che/che-docs': 'che-docs',
  'che-incubator/che-ai-tool-images': 'che-ai-tool-images',
  'che-incubator/devworkspace-generator': 'devworkspace-generator',
  'devfile/devworkspace-operator': 'devworkspace-operator',
  'che-incubator/dash-licenses': 'dash-licenses',
};

export async function runAgentInBackground(
  threadId: string,
  project: string,
  issueNumber: number | null,
  forcePriority: boolean,
  dryRun: boolean,
  outputDir: string,
  repoSlugOverride?: string,
  issueUrlArg?: string,
  jiraKeyArg?: string,
  extraState?: Partial<State>,
): Promise<void> {
  const config = await loadProjectConfig(project);
  const repoSlug = repoSlugOverride ?? config?.repo ?? '';
  const repoLocal = config?.local_path ?? '';

  if (!config && !repoSlugOverride) {
    const errMsg = `Project "${project}" not found in database`;
    await db.query(
      "UPDATE agent_runs SET status = 'failed', finished_at = now() WHERE thread_id = $1",
      [threadId],
    );
    await db
      .query('INSERT INTO run_events (thread_id, phase, node, message) VALUES ($1, $2, $3, $4)', [
        threadId,
        'error',
        'error',
        errMsg,
      ])
      .catch(() => {});
    emitRunEvent(threadId, { type: 'run_failed', threadId, payload: { error: errMsg } });
    return;
  }

  const initialState: Partial<State> = {
    project,
    repoSlug,
    repoLocal,
    issueNumber: issueNumber ?? null,
    issueUrl: issueUrlArg ?? '',
    jiraKey: jiraKeyArg ?? '',
    forcePriority: forcePriority ?? false,
    dryRun,
    outputDir,
    ...extraState,
  };

  // Acquire per-repo lock: only one run may work on a given local repo at a time.
  // Other runs wait (up to 10 min) then proceed. The lock also resets the repo
  // to the default branch so each run starts from a clean state.
  const releaseRepoLock = repoLocal ? await acquireRepoLock(repoLocal, threadId) : () => {};

  if (repoLocal) {
    const defaultBranch = config?.default_branch ?? 'main';
    resetRepoBranch(repoLocal, defaultBranch);
  }

  const controller = new AbortController();
  runningJobs.set(threadId, controller);

  try {
    const app = await getGraph();
    const agentConfig = {
      configurable: { thread_id: threadId },
      signal: controller.signal,
    };

    for await (const chunk of await app.stream(initialState, agentConfig)) {
      if (controller.signal.aborted) break;
      const nodeNames = Object.keys(chunk as Record<string, unknown>);
      for (const nodeName of nodeNames) {
        const nodeOutput = (chunk as Record<string, unknown>)[nodeName] as Partial<State>;
        const messages: string[] = nodeOutput.messages ?? [];

        for (const msg of messages) {
          const event = {
            type: 'log',
            threadId,
            payload: { node: nodeName, message: msg, level: 'info' },
          };
          emitRunEvent(threadId, event);

          await db.query(
            'INSERT INTO run_events (thread_id, phase, node, message) VALUES ($1, $2, $3, $4)',
            [threadId, nodeName, nodeName, msg],
          );
        }

        emitRunEvent(threadId, {
          type: 'node_complete',
          threadId,
          payload: { node: nodeName, status: nodeOutput.status ?? '' },
        });

        // Persist findings
        if (nodeOutput.reviewFindings?.length) {
          for (const f of nodeOutput.reviewFindings) {
            await db.query(
              'INSERT INTO findings (thread_id, file, line, severity, finding, tier) VALUES ($1,$2,$3,$4,$5,$6)',
              [threadId, f.file ?? '', f.line ?? null, f.severity, f.finding, f.tier ?? 'tier1'],
            );
          }
        }

        // Update run row with latest state fields
        if (nodeOutput.issueNumber) {
          await db.query(
            `UPDATE agent_runs SET
              issue_number = $2, issue_title = $3, issue_url = $4,
              story_points = $5
             WHERE thread_id = $1`,
            [
              threadId,
              nodeOutput.issueNumber,
              nodeOutput.issueTitle ?? '',
              nodeOutput.issueUrl ?? '',
              nodeOutput.storyPoints ?? 0,
            ],
          );
        }
        if (nodeOutput.priority) {
          await db.query(
            'UPDATE agent_runs SET priority = $2, priority_source = $3, jira_key = $4 WHERE thread_id = $1',
            [
              threadId,
              nodeOutput.priority,
              nodeOutput.prioritySource ?? '',
              nodeOutput.jiraKey ?? '',
            ],
          );
        }
        if (nodeOutput.prUrl) {
          await db.query('UPDATE agent_runs SET pr_url = $2, pr_number = $3 WHERE thread_id = $1', [
            threadId,
            nodeOutput.prUrl,
            nodeOutput.prNumber ?? null,
          ]);
        }
        if (nodeOutput.reviewVerdict) {
          await db.query('UPDATE agent_runs SET verdict = $2 WHERE thread_id = $1', [
            threadId,
            nodeOutput.reviewVerdict,
          ]);
        }
      }
    }

    if (controller.signal.aborted) {
      // Cancelled by user — status already set to 'failed' by DELETE handler
      console.log(`[run ${threadId}] Cancelled by user`);
    } else {
      await db.query(
        "UPDATE agent_runs SET status = 'done', finished_at = now() WHERE thread_id = $1",
        [threadId],
      );
      emitRunEvent(threadId, { type: 'run_complete', threadId, payload: { status: 'done' } });
    }
  } catch (err: unknown) {
    if (controller.signal.aborted) {
      // AbortError thrown by LangGraph when signal fires — not a real error
      console.log(`[run ${threadId}] Cancelled (abort signal)`);
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      await db.query(
        "UPDATE agent_runs SET status = 'failed', finished_at = now() WHERE thread_id = $1",
        [threadId],
      );
      await db
        .query('INSERT INTO run_events (thread_id, phase, node, message) VALUES ($1, $2, $3, $4)', [
          threadId,
          'error',
          'error',
          `Agent failed: ${msg}`,
        ])
        .catch(() => {});
      emitRunEvent(threadId, { type: 'run_failed', threadId, payload: { error: msg } });
      console.error(`[run ${threadId}] Agent failed:`, err);
    }
  } finally {
    runningJobs.delete(threadId);
    releaseRepoLock();
  }

  // Also store "not found" errors from the early exit path
  async function failRun(tid: string, errMsg: string): Promise<void> {
    await db.query(
      "UPDATE agent_runs SET status = 'failed', finished_at = now() WHERE thread_id = $1",
      [tid],
    );
    await db
      .query('INSERT INTO run_events (thread_id, phase, node, message) VALUES ($1, $2, $3, $4)', [
        tid,
        'error',
        'error',
        errMsg,
      ])
      .catch(() => {});
    emitRunEvent(tid, { type: 'run_failed', tid, payload: { error: errMsg } });
  }
  void failRun; // suppress unused warning — used indirectly
}

const tags = ['Runs'];

export const runsRoutes: FastifyPluginAsync = async app => {
  // GET / — list runs
  app.get<{ Querystring: { limit?: string; offset?: string } }>(
    '/',
    { schema: { tags } },
    async (req, reply) => {
      const limit = Math.min(parseInt(req.query.limit ?? '20', 10), 100);
      const offset = parseInt(req.query.offset ?? '0', 10);
      const { rows } = await db.query<AgentRunRow>(
        'SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT $1 OFFSET $2',
        [limit, offset],
      );
      const { rows: countRows } = await db.query<{ count: string }>(
        'SELECT COUNT(*) FROM agent_runs',
      );
      return reply.send({ runs: rows, total: parseInt(countRows[0].count, 10) });
    },
  );

  // GET /:threadId — single run with events and findings
  app.get<{ Params: { threadId: string } }>(
    '/:threadId',
    { schema: { tags } },
    async (req, reply) => {
      const { threadId } = req.params;
      const { rows: runRows } = await db.query<AgentRunRow>(
        'SELECT * FROM agent_runs WHERE thread_id = $1',
        [threadId],
      );
      if (!runRows[0]) return reply.status(404).send({ error: 'Run not found' });

      const { rows: events } = await db.query<RunEventRow>(
        'SELECT * FROM run_events WHERE thread_id = $1 ORDER BY ts ASC',
        [threadId],
      );
      const { rows: findings } = await db.query<FindingRow>(
        'SELECT * FROM findings WHERE thread_id = $1 ORDER BY ts ASC',
        [threadId],
      );

      return reply.send({ ...runRows[0], events, findings });
    },
  );

  // POST / — start a run
  // Accepts: { project, issueNumber?, forcePriority?, outputDir? }
  //       OR { issueUrl: "https://github.com/owner/repo/issues/N", forcePriority? }
  app.post<{ Body: StartRunBody }>(
    '/',
    { schema: { tags, body: startRunSchema } },
    async (req, reply) => {
      const { issueUrl, forcePriority, outputDir } = req.body;
      let { project, issueNumber } = req.body;

      // ── Parse issueUrl if provided ─────────────────────────────────────────
      let repoSlugOverride: string | undefined;
      if (issueUrl) {
        const ghParsed = parseIssueUrl(issueUrl);
        if (ghParsed) {
          const repoKey = `${ghParsed.owner}/${ghParsed.repo}`;
          project = project ?? REPO_TO_PROJECT[repoKey] ?? ghParsed.repo;
          issueNumber = issueNumber ?? ghParsed.number;
          repoSlugOverride = repoKey;
        } else {
          const jiraParsed = parseJiraUrl(issueUrl);
          if (jiraParsed) {
            project = project ?? (await projectForJiraKey(jiraParsed.key)) ?? undefined;
          } else {
            return reply.status(400).send({ error: `Cannot parse issue URL: ${issueUrl}` });
          }
        }
      }

      if (!project) return reply.status(400).send({ error: 'project or issueUrl is required' });

      // ── Dry-run when no GITHUB_TOKEN ───────────────────────────────────────
      const dryRun = !process.env.GITHUB_TOKEN;
      const resolvedOutputDir = outputDir ?? process.env.OUTPUT_DIR ?? 'output';

      const config = await loadProjectConfig(project);
      const repo = repoSlugOverride ?? config?.repo ?? '';

      const threadId = randomUUID();

      await db.query(
        `INSERT INTO agent_runs (thread_id, project_slug, repo, issue_number, issue_url, status)
       VALUES ($1, $2, $3, $4, $5, 'running')`,
        [threadId, project, repo, issueNumber ?? null, issueUrl ?? ''],
      );

      if (dryRun) {
        // Notify UI immediately
        emitRunEvent(threadId, {
          type: 'log',
          threadId,
          payload: {
            level: 'warn',
            message:
              '⚠ GITHUB_TOKEN not set — running in dry-run mode. Output written to output/ directory.',
          },
        });
      }

      // Fire and forget
      const jiraParsedKey = issueUrl ? parseJiraUrl(issueUrl)?.key : undefined;
      runAgentInBackground(
        threadId,
        project,
        issueNumber ?? null,
        forcePriority ?? false,
        dryRun,
        resolvedOutputDir,
        repoSlugOverride,
        issueUrl,
        jiraParsedKey,
      ).catch(e => console.error(`[run ${threadId}] Unhandled error:`, e));

      return reply.status(202).send({ threadId, dryRun });
    },
  );

  // DELETE /:threadId — cancel a running run (soft); hard-delete a finished run
  app.delete<{ Params: { threadId: string } }>(
    '/:threadId',
    { schema: { tags } },
    async (req, reply) => {
      const { threadId } = req.params;
      try {
        const { rows } = await db.query<{ status: string }>(
          'SELECT status FROM agent_runs WHERE thread_id = $1',
          [threadId],
        );
        const status = rows[0]?.status;
        if (status === 'running') {
          // Update DB first so the graph loop sees 'failed' if it checks
          await db.query(
            "UPDATE agent_runs SET status = 'failed', finished_at = now() WHERE thread_id = $1",
            [threadId],
          );
          // Signal the running AbortController so the for-await loop exits
          const ctrl = runningJobs.get(threadId);
          if (ctrl) {
            ctrl.abort();
            runningJobs.delete(threadId);
          }
          emitRunEvent(threadId, {
            type: 'run_failed',
            threadId,
            payload: { error: 'Cancelled by user' },
          });
        } else {
          await db.query('DELETE FROM run_events WHERE thread_id = $1', [threadId]).catch(() => {});
          await db.query('DELETE FROM findings WHERE thread_id = $1', [threadId]).catch(() => {});
          await db.query('DELETE FROM agent_runs WHERE thread_id = $1', [threadId]).catch(() => {});
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return reply.status(500).send({ error: `Failed to delete run: ${msg}` });
      }
      return reply.status(204).send();
    },
  );

  // POST /autorun — pick the top-scored open issue and start a run
  app.post('/autorun', { schema: { tags } }, async (_req, reply) => {
    const { rows: issueRows } = await db.query<{ url: string; title: string }>(
      `SELECT si.url, si.title
         FROM issues si
         LEFT JOIN agent_runs r
           ON r.issue_url = si.url AND r.status = 'running'
        WHERE si.status = 'open' AND r.id IS NULL
        ORDER BY si.score DESC
        LIMIT 1`,
    );

    const issue = issueRows[0];
    if (!issue) return reply.status(404).send({ error: 'No open issues available for autorun' });

    const issueUrl = issue.url;
    const dryRun = !process.env.GITHUB_TOKEN;
    const resolvedOutputDir = process.env.OUTPUT_DIR ?? 'output';
    const threadId = randomUUID();

    // Support both GitHub and Jira issue URLs
    const ghParsed = parseIssueUrl(issueUrl);
    const jiraParsed = ghParsed ? null : parseJiraUrl(issueUrl);

    if (!ghParsed && !jiraParsed) {
      return reply.status(400).send({ error: `Cannot parse issue URL: ${issueUrl}` });
    }

    let project: string;
    let repoKey: string | undefined;
    let issueNumber: number | null = null;
    let jiraKey: string | undefined;

    if (ghParsed) {
      repoKey = `${ghParsed.owner}/${ghParsed.repo}`;
      project = REPO_TO_PROJECT[repoKey] ?? ghParsed.repo;
      issueNumber = ghParsed.number;
    } else {
      jiraKey = jiraParsed!.key;
      project = (await projectForJiraKey(jiraKey)) ?? jiraKey.split('-')[0].toLowerCase();
      repoKey = undefined;
    }

    await db.query(
      `INSERT INTO agent_runs (thread_id, project_slug, repo, issue_number, issue_url, status)
       VALUES ($1, $2, $3, $4, $5, 'running')`,
      [threadId, project, repoKey ?? '', issueNumber, issueUrl],
    );

    runAgentInBackground(
      threadId,
      project,
      issueNumber,
      false,
      dryRun,
      resolvedOutputDir,
      repoKey,
      issueUrl,
      jiraKey,
    ).catch(e => console.error(`[autorun ${threadId}] Unhandled error:`, e));

    console.log(`[autorun] Started run ${threadId} for issue: ${issueUrl}`);
    return reply.status(202).send({ threadId, issueUrl, title: issue.title, dryRun });
  });

  // POST /cve-batch — pick up to 9 open CVE/Security issues and fix them in ONE PR
  app.post('/cve-batch', { schema: { tags } }, async (_req, reply) => {
    // Find all open CVE issues (Security label OR title contains CVE-YYYY-)
    const { rows: cveRows } = await db.query<{ url: string; title: string; external_id: string }>(
      `SELECT si.url, si.title, si.external_id
         FROM issues si
         LEFT JOIN agent_runs r ON r.issue_url = si.url AND r.status = 'running'
        WHERE si.status = 'open'
          AND r.id IS NULL
          AND (
            si.title ILIKE '%CVE-%'
            OR 'Security' = ANY(si.labels)
            OR 'security' = ANY(si.labels)
          )
        ORDER BY si.score DESC
        LIMIT 15`,
    );

    if (cveRows.length === 0) {
      return reply.status(404).send({ error: 'No open CVE / Security issues found' });
    }

    // Pick project from first issue
    const firstUrl = cveRows[0].url;
    const ghParsed = parseIssueUrl(firstUrl);
    const jiraParsed = ghParsed ? null : parseJiraUrl(firstUrl);

    let project: string;
    let repoKey: string | undefined;

    if (ghParsed) {
      repoKey = `${ghParsed.owner}/${ghParsed.repo}`;
      project = REPO_TO_PROJECT[repoKey] ?? ghParsed.repo;
    } else if (jiraParsed) {
      project =
        (await projectForJiraKey(jiraParsed.key)) ?? jiraParsed.key.split('-')[0].toLowerCase();
    } else {
      return reply.status(400).send({ error: `Cannot parse first CVE issue URL: ${firstUrl}` });
    }

    const dryRun = !process.env.GITHUB_TOKEN;
    const resolvedOutputDir = process.env.OUTPUT_DIR ?? 'output';
    const threadId = randomUUID();

    const batchIssues = cveRows.map(r => ({
      url: r.url,
      jiraKey: parseJiraUrl(r.url)?.key,
      title: r.title,
    }));

    const primaryIssue = cveRows[0];
    const primaryJiraKey = parseJiraUrl(primaryIssue.url)?.key;

    await db.query(
      `INSERT INTO agent_runs (thread_id, project_slug, repo, issue_url, status)
       VALUES ($1, $2, $3, $4, 'running')`,
      [threadId, project, repoKey ?? '', primaryIssue.url],
    );

    // Inject batch context into the state
    const batchFixSummary = `Batch fix ${cveRows.length} CVE issues: ${cveRows.map(r => r.external_id || r.title.slice(0, 30)).join(', ')}`;

    runAgentInBackground(
      threadId,
      project,
      null,
      true,
      dryRun,
      resolvedOutputDir,
      repoKey,
      primaryIssue.url,
      primaryJiraKey,
      { isBatch: true, batchIssues, fixSummary: batchFixSummary },
    ).catch(e => console.error(`[cve-batch ${threadId}] Unhandled error:`, e));

    console.log(`[cve-batch] Started batch run ${threadId} for ${cveRows.length} CVE issues`);
    return reply.status(202).send({ threadId, count: cveRows.length, issues: batchIssues, dryRun });
  });
};
