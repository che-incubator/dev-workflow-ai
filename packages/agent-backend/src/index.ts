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

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runMigrations } from './db/migrations.js';
import { importKnowledge } from './init/importKnowledge.js';
import { seedDefaultProviders } from './api/routes/providers.js';
import { seedDefaultSources } from './init/seedSources.js';
import { buildServer } from './api/server.js';
import { startAutorunScheduler } from './scheduler/autorun.js';

// repo root from the bundle at packages/agent-backend/lib/server/
const ROOT = join(__dirname, '..', '..', '..', '..');

function loadEnvFile(): void {
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = val;
    }
  }
}

function resolveKnowledgeDir(): string {
  if (process.env.KNOWLEDGE_DIR) return process.env.KNOWLEDGE_DIR;
  if (existsSync('/knowledge')) return '/knowledge';
  const localDir = join(ROOT, 'pg_seed', 'eclipse-che');
  if (existsSync(localDir)) return localDir;
  return '/knowledge';
}

async function main() {
  loadEnvFile();
  const port = parseInt(process.env.PORT ?? '3000', 10);

  console.log('[boot] Running DB migrations…');
  await runMigrations();

  console.log('[boot] Seeding default LLM providers…');
  await seedDefaultProviders();
  await seedDefaultSources();

  const knowledgeDir = resolveKnowledgeDir();
  process.env.KNOWLEDGE_DIR = knowledgeDir;
  console.log(`[boot] Importing knowledge from ${knowledgeDir}…`);
  await importKnowledge(knowledgeDir);

  const app = await buildServer();
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`[boot] dev-workflow-ai ready at http://0.0.0.0:${port}`);
  startAutorunScheduler();
}

main().catch(e => {
  console.error('[boot] Fatal error:', e);
  process.exit(1);
});
