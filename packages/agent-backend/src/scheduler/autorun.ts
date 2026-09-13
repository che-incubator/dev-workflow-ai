/*
 * Copyright (c) 2026 Red Hat, Inc.
 * SPDX-License-Identifier: EPL-2.0
 */

import { randomUUID } from 'node:crypto';
import { db } from '../db/client.js';
import { getSetting } from '../db/settingsHelper.js';
import { runAgentInBackground } from '../api/routes/runs.js';

// Track last triggered HH:MM so we don't fire twice in the same minute
let lastTriggeredAt: string | null = null;

async function triggerAutorun(): Promise<void> {
  const { rows } = await db.query<{ url: string; title: string }>(
    `SELECT si.url, si.title
       FROM issues si
       LEFT JOIN agent_runs r ON r.issue_url = si.url AND r.status = 'running'
      WHERE si.status = 'open' AND r.id IS NULL
      ORDER BY si.score DESC
      LIMIT 1`,
  );

  const issue = rows[0];
  if (!issue) {
    console.log('[autorun] No open issues available — skipping scheduled run');
    return;
  }

  // Parse owner/repo/number from GitHub URL
  const m = issue.url.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
  if (!m) {
    console.log(`[autorun] Cannot parse issue URL: ${issue.url} — skipping`);
    return;
  }

  const [, owner, repo, numStr] = m;
  const repoKey = `${owner}/${repo}`;
  const issueNumber = parseInt(numStr, 10);
  const project = repo;
  const dryRun = !process.env.GITHUB_TOKEN;
  const outputDir = process.env.OUTPUT_DIR ?? 'output';
  const threadId = randomUUID();

  await db.query(
    `INSERT INTO agent_runs (thread_id, project_slug, repo, issue_number, issue_url, status)
     VALUES ($1, $2, $3, $4, $5, 'running')`,
    [threadId, project, repoKey, issueNumber, issue.url],
  );

  runAgentInBackground(threadId, project, issueNumber, false, dryRun, outputDir, repoKey, issue.url)
    .catch(e => console.error(`[autorun ${threadId}] Unhandled error:`, e));

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

      const times = timesStr.split(',').map(t => t.trim()).filter(Boolean);
      if (times.length === 0) return;

      const now = new Date();
      const hhmm = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

      if (hhmm === lastTriggeredAt) return;
      if (!times.includes(hhmm)) return;

      lastTriggeredAt = hhmm;
      console.log(`[autorun] Scheduled trigger at ${hhmm}`);
      await triggerAutorun();
    } catch (e) {
      console.error('[autorun] Scheduler error:', e instanceof Error ? e.message : String(e));
    }
  }, 30_000);

  console.log('[autorun] Scheduler started (checks every 30s)');
}
