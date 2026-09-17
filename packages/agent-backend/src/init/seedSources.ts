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

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { db } from '../db/client.js';

/**
 * Seed default issue sources from projects.json and env vars.
 * Only adds sources that don't already exist (upsert on URL).
 */
export async function seedDefaultSources(): Promise<void> {
  const knowledgeDir = process.env.KNOWLEDGE_DIR ?? '/knowledge';

  // Seed issue_sources from projects.json
  try {
    const raw = await readFile(join(knowledgeDir, 'projects.json'), 'utf8');
    const parsed = JSON.parse(raw);
    const sources = Array.isArray(parsed.issue_sources) ? parsed.issue_sources : [];
    for (const url of sources as string[]) {
      if (!url) continue;
      const isJira =
        url.includes('atlassian.net') || url.includes('/jira/') || url.includes('/browse/');
      const label = url.includes('/jira/for-you')
        ? 'Assigned to me'
        : isJira
          ? new URL(url).hostname
          : url.replace('https://github.com/', '');
      const kind = isJira ? 'jira' : 'github';
      await db.query(
        `INSERT INTO issue_sources (url, kind, label)
         VALUES ($1, $2, $3)
         ON CONFLICT (url) DO NOTHING`,
        [url, kind, label],
      );
    }
    if (sources.length > 0) {
      console.log(`[sources] Seeded ${sources.length} issue source(s) from projects.json`);
    }
  } catch {
    // projects.json not found or unreadable — non-fatal
  }
}
