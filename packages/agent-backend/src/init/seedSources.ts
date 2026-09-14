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

import { db } from '../db/client.js';

/**
 * Seed default issue sources that should always exist after startup.
 * Only adds sources that don't already exist (upsert on URL).
 */
export async function seedDefaultSources(): Promise<void> {
  const jiraBase = process.env.JIRA_BASE_URL ?? 'https://redhat.atlassian.net';
  const jiraEmail = process.env.JIRA_EMAIL;

  // Jira "assigned to me" source — only seed when Jira credentials are configured
  if (jiraEmail) {
    const sourceUrl = `${jiraBase}/jira/for-you?tab=assigned`;
    await db.query(
      `INSERT INTO issue_sources (url, kind, label, project_slug)
       VALUES ($1, 'jira', 'Assigned to me', '')
       ON CONFLICT (url) DO NOTHING`,
      [sourceUrl],
    );
    console.log(`[sources] Ensured Jira assigned-to-me source: ${sourceUrl}`);
  }
}
