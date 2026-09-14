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
 * /api/settings — global settings + knowledge source management
 *
 * GET  /api/settings                    → read settings from DB
 * PUT  /api/settings                    → save settings to DB
 * GET  /api/settings/samples            → list available knowledge packs (dirs in pg_seed/)
 * POST /api/settings/samples/:name/load → import a knowledge pack into DB (runs importKnowledge)
 * GET  /api/settings/export             → export current DB knowledge as JSON file download
 */

import type { FastifyPluginAsync } from 'fastify';
import { readdir, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { db } from '../../db/client.js';
import { getSetting, setSetting } from '../../db/settingsHelper.js';

const ROOT = resolve(process.cwd());
const SAMPLES_DIR = join(ROOT, 'target');

export { getSetting, setSetting };

// ── List available sample directories ─────────────────────────────────────

async function listSamples(): Promise<{ name: string; path: string; subdirs: string[] }[]> {
  const samples: { name: string; path: string; subdirs: string[] }[] = [];
  try {
    const entries = await readdir(SAMPLES_DIR);
    for (const entry of entries) {
      const fullPath = join(SAMPLES_DIR, entry);
      const s = await stat(fullPath).catch(() => null);
      if (!s?.isDirectory()) continue;
      const children = await readdir(fullPath).catch(() => [] as string[]);
      samples.push({ name: entry, path: fullPath, subdirs: children });
    }
  } catch {
    /* samples/ dir may not exist */
  }
  return samples;
}

// ── Routes ─────────────────────────────────────────────────────────────────

const tags = ['Settings'];

export const settingsRoutes: FastifyPluginAsync = async app => {
  // GET /api/settings — return all settings as object
  app.get('/', { schema: { tags } }, async (_req, reply) => {
    const { rows } = await db.query<{ key: string; value: string }>(
      'SELECT key, value FROM settings',
    );
    const result: Record<string, string> = {};
    for (const row of rows) result[row.key] = row.value;

    // Defaults for known keys
    return reply.send({
      defaultMinPriority: await getSetting('defaultMinPriority', 'major'),
      defaultBudget: await getSetting('defaultBudget', '3'),
      cloneDir: await getSetting('cloneDir', process.env.WORKSPACE_DIR ?? '.repos'),
      ...result,
    });
  });

  // PUT /api/settings — save settings
  app.put<{ Body: Record<string, string> }>('/', async (req, reply) => {
    for (const [key, value] of Object.entries(req.body)) {
      if (typeof value === 'string') await setSetting(key, value);
    }
    return reply.send({ ok: true });
  });

  // GET /api/settings/samples — list available sample packs
  app.get('/samples', { schema: { tags } }, async (_req, reply) => {
    const samples = await listSamples();
    return reply.send(
      samples.map(s => ({
        name: s.name,
        subdirs: s.subdirs,
        hasSubprojects: s.subdirs.includes('subprojects'),
        hasContext: s.subdirs.includes('context'),
        hasShared: s.subdirs.includes('shared'),
      })),
    );
  });

  // POST /api/settings/samples/:name/load — import a sample into DB
  app.post<{ Params: { name: string } }>('/samples/:name/load', { schema: { tags } }, async (req, reply) => {
    // Prevent path traversal — ensure resolved path stays under SAMPLES_DIR
    const samplePath = resolve(join(SAMPLES_DIR, req.params.name));
    if (!samplePath.startsWith(SAMPLES_DIR + sep)) {
      return reply.status(400).send({ error: 'Invalid sample name' });
    }

    const s = await stat(samplePath).catch(() => null);
    if (!s?.isDirectory()) {
      return reply.status(404).send({ error: `Sample '${req.params.name}' not found` });
    }

    // Pass dir directly — no global env mutation (fixes thread-safety race)
    const { importKnowledge } = await import('../../init/importKnowledge.js');
    const result = await importKnowledge(samplePath);
    return reply.send({
      ok: true,
      sample: req.params.name,
      path: samplePath,
      imported: result.imported,
      projects: result.projects,
      sources: result.sources,
    });
  });


  // GET /api/settings/export — export all contexts as JSON
  app.get('/export', { schema: { tags } }, async (_req, reply) => {
    const { rows: contexts } = await db.query(
      'SELECT project_slug, name, content, source_file, updated_at FROM contexts ORDER BY project_slug, name',
    );
    const { rows: projects } = await db.query(
      'SELECT name, repo, local_path, stack, description, auto_approve_min_priority, story_point_budget FROM projects ORDER BY name',
    );

    const exportData = {
      exportedAt: new Date().toISOString(),
      projects,
      contexts,
    };

    const json = JSON.stringify(exportData, null, 2);
    reply.header('Content-Disposition', 'attachment; filename="dev-workflow-ai-knowledge.json"');
    reply.header('Content-Type', 'application/json');
    return reply.send(json);
  });
};
