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

import { runMigrations } from './db/migrations.js';
import { importKnowledge } from './init/importKnowledge.js';
import { seedDefaultProviders } from './api/routes/providers.js';
import { seedDefaultSources } from './init/seedSources.js';
import { buildServer } from './api/server.js';
import { startAutorunScheduler } from './scheduler/autorun.js';

async function main() {
  const port = parseInt(process.env.PORT ?? '3000', 10);

  console.log('[boot] Running DB migrations…');
  await runMigrations();

  console.log('[boot] Seeding default LLM providers…');
  await seedDefaultProviders();
  await seedDefaultSources();

  const knowledgeDir = process.env.KNOWLEDGE_DIR ?? '/knowledge';
  console.log(`[boot] Importing knowledge from ${knowledgeDir}…`);
  await importKnowledge();

  const app = await buildServer();
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`[boot] dev-workflow-ai ready at http://0.0.0.0:${port}`);
  startAutorunScheduler();
}

main().catch(e => {
  console.error('[boot] Fatal error:', e);
  process.exit(1);
});
