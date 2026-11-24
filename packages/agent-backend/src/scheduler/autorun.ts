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

import { randomUUID } from 'node:crypto';
import { db } from '../db/client.js';
import { getSetting } from '../db/settingsHelper.js';
import { runAgentInBackground } from '../api/routes/runs.js';

function parseJiraUrl(url: string): { key: string } | null {
  const m = url.match(/\/browse\/([A-Z]+-\d+)/i);
  return m ? { key: m[1].toUpperCase() } : null;
}

async function projectForJiraKey(key: string): Promise<string | null> {
  const { rows } = await db.query<{ project_slug: string }>(
    `SELECT s.project_slug FROM issues si
       JOIN issue_sources s ON si.source_id = s.id
      WHERE si.external_id = $1 AND s.project_slug <> '' LIMIT 1`,
    [key],
  );
  return rows[0]?.project_slug ?? null;
}

// Track last triggered HH:MM so we don't fire twice in the same minute
let lastTriggeredAt: string | null = null;

async function triggerAutorun(): Promise<void> {
  // Autorun only picks up issues that carry story points: an unestimated issue
  // has not been sized, so the budget check downstream is meaningless and the
  // agent would be working blind. Such issues stay visible in the Issues list
  // and can still be run by hand with "Force priority".
  const { rows } = await db.query<{ url: string; title: string }>(
    `SELECT si.url, si.title
       FROM issues si
       LEFT JOIN agent_runs r ON r.issue_url = si.url AND r.status = 'running'
      WHERE si.status = 'open' AND r.id IS NULL
        AND si.story_points IS NOT NULL AND si.story_points > 0
      ORDER BY si.score DESC
      LIMIT 1`,
  );

  const issue = rows[0];
  if (!issue) {
    const { rows: unsized } = await db.query<{ n: string }>(
      `SELECT COUNT(*) AS n
         FROM issues si
         LEFT JOIN agent_runs r ON r.issue_url = si.url AND r.status = 'running'
        WHERE si.status = 'open' AND r.id IS NULL
          AND (si.story_points IS NULL OR si.story_points = 0)`,
    );
    const skipped = parseInt(unsized[0]?.n ?? '0', 10);
    console.log(
      skipped > 0
        ? `[autorun] No estimated open issues — skipping scheduled run (${skipped} open issue(s) have no story points; run them manually with Force priority)`
        : '[autorun] No open issues available — skipping scheduled run',
    );
    return;
  }

  const issueUrl = issue.url;
  const dryRun = !process.env.GITHUB_TOKEN;
  const outputDir = process.env.OUTPUT_DIR ?? 'output';
  const threadId = randomUUID();

  // Support GitHub and Jira URLs
  const ghMatch = issueUrl.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
  const jiraParsed = ghMatch ? null : parseJiraUrl(issueUrl);

  if (!ghMatch && !jiraParsed) {
    console.log(`[autorun] Cannot parse issue URL: ${issueUrl} — skipping`);
    return;
  }

  let project: string;
  let repoKey: string | undefined;
  let issueNumber: number | null = null;
  let jiraKey: string | undefined;

  if (ghMatch) {
    const [, owner, repo, numStr] = ghMatch;
    repoKey = `${owner}/${repo}`;
    project = repo;
    issueNumber = parseInt(numStr, 10);
  } else {
    jiraKey = jiraParsed!.key;
    project = (await projectForJiraKey(jiraKey)) ?? jiraKey.split('-')[0].toLowerCase();
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
    outputDir,
    repoKey,
    issueUrl,
    jiraKey,
  ).catch(e => console.error(`[autorun ${threadId}] Unhandled error:`, e));

  console.log(`[autorun] Scheduled run ${threadId} started for: ${issue.url}`);
}

export function startAutorunScheduler(): void {
  // Check every 30 s so we don't miss a minute window due to drift
  setInterval(async () => {
    try {
      const enabled = await getSetting('autorunEnabled', 'false');
      if (enabled !== 'true') return;

      const timesStr = await getSetting('autorunTimes', '');
      if (!timesStr) return;

      const times = timesStr
        .split(',')
        .map(t => t.trim())
        .filter(Boolean);
      if (times.length === 0) return;

      const now = new Date();
      const hhmm = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

      if (hhmm === lastTriggeredAt) return;
      if (!times.includes(hhmm)) return;

      const daysStr = await getSetting('autorunDays', '1,2,3,4,5');
      const activeDays = daysStr
        .split(',')
        .map(d => parseInt(d.trim(), 10))
        .filter(d => !isNaN(d));
      if (!activeDays.includes(now.getDay())) return;

      lastTriggeredAt = hhmm;
      console.log(`[autorun] Scheduled trigger at ${hhmm}`);
      await triggerAutorun();
    } catch (e) {
      console.error('[autorun] Scheduler error:', e instanceof Error ? e.message : String(e));
    }
  }, 30_000);

  console.log('[autorun] Scheduler started (checks every 30s)');
}
