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
import type { ProjectRow } from '../db/schema.js';
import { nodeLog } from '../agent/runner.js';

export async function loadContext(projectSlug: string, filter?: string[]): Promise<string> {
  let query = `
    SELECT name, content FROM contexts
    WHERE project_slug IN ('global', 'shared', $1)
  `;
  const params: unknown[] = [projectSlug];

  if (filter && filter.length > 0) {
    // Support exact names and prefix wildcards (e.g. "skills-*" → LIKE 'skills-%')
    const exact = filter.filter(f => !f.endsWith('*'));
    const prefixes = filter.filter(f => f.endsWith('*')).map(f => f.slice(0, -1));
    const conditions: string[] = [];
    if (exact.length > 0) {
      conditions.push(`name = ANY($${params.length + 1}::text[])`);
      params.push(exact);
    }
    for (const p of prefixes) {
      conditions.push(`name LIKE $${params.length + 1}`);
      params.push(`${p}%`);
    }
    if (conditions.length > 0) query += ` AND (${conditions.join(' OR ')})`;
  }

  query += `
    ORDER BY
      CASE project_slug
        WHEN 'global' THEN 1
        WHEN 'shared' THEN 2
        ELSE 3
      END,
      name
  `;

  const { rows } = await db.query<{ name: string; content: string }>(query, params);

  if (rows.length === 0) {
    nodeLog(`context: no documents found for project "${projectSlug}"`);
    return `No context found for project "${projectSlug}"`;
  }

  const names = rows.map(r => r.name);
  nodeLog(`context: loaded ${rows.length} documents for "${projectSlug}": ${names.join(', ')}`);

  return rows.map(r => `## ${r.name}\n\n${r.content}`).join('\n\n---\n\n');
}

export async function loadProjectConfig(name: string): Promise<ProjectRow | null> {
  const { rows } = await db.query<ProjectRow>(`SELECT * FROM projects WHERE name = $1`, [name]);
  return rows[0] ?? null;
}
