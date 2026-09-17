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
 * init-db — initialize the database from local *.md knowledge files
 *
 * Built by webpack as a separate entry point (lib/server/init-db.cjs).
 * Run via: scripts/init-db.sh
 *
 * What it does:
 *   1. Runs all DB migrations (idempotent — safe to run again)
 *   2. Imports projects from projects.json
 *   3. Upserts all *.md content into `contexts`
 *   4. Seeds default LLM providers and issue sources
 */

import { join, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { runMigrations } from './db/migrations.js';
import { importKnowledge } from './init/importKnowledge.js';
import { seedDefaultProviders } from './api/routes/providers.js';
import { seedDefaultSources } from './init/seedSources.js';
import { db } from './db/client.js';

// ── CLI args ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const dirArgIdx = args.findIndex(a => a === '--dir');
const dirArg =
  args.find(a => a.startsWith('--dir='))?.split('=')[1] ??
  (dirArgIdx !== -1 ? args[dirArgIdx + 1] : undefined);

const ROOT = resolve(process.cwd());

function resolveDevWorkspaceVars(value: string): string {
  return value
    .replace(/\$\{PROJECT_SOURCE\}/g, process.env.PROJECT_SOURCE ?? ROOT)
    .replace(/\$\{PROJECTS_ROOT\}/g, process.env.PROJECTS_ROOT ?? '/projects');
}

const rawKnowledgeDir = process.env.KNOWLEDGE_DIR ?? join(ROOT, 'pg_seed/eclipse-che');
const KNOWLEDGE_DIR = dirArg ? resolve(dirArg) : resolve(resolveDevWorkspaceVars(rawKnowledgeDir));
process.env.KNOWLEDGE_DIR = KNOWLEDGE_DIR;

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  dev-workflow-ai — database initialisation');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Knowledge dir: ${KNOWLEDGE_DIR}`);
  const dbLabel = process.env.DATABASE_URL
    ? process.env.DATABASE_URL.replace(/:[^:@]+@/, ':***@')
    : `PGlite (${process.env.PGLITE_DATA_DIR ?? '.local/pglite'})`;
  console.log(`  Database:      ${dbLabel}`);
  console.log();

  if (dryRun) {
    console.log('⚠  Dry-run mode — exiting without DB writes.');
    console.log('   Remove --dry-run to apply.');
    process.exit(0);
  }

  console.log('[1/5] Running DB migrations...');
  await runMigrations();

  console.log('[2/5] Importing projects from projects.json...');
  const projectsJson = join(KNOWLEDGE_DIR, 'projects.json');
  try {
    const raw = await readFile(projectsJson, 'utf8');
    const parsed = JSON.parse(raw);
    const projects = parsed.projects ?? {};
    let upserted = 0;
    for (const [name, cfg] of Object.entries(projects) as [string, Record<string, unknown>][]) {
      await db.query(
        `INSERT INTO projects (name, repo, local_path, stack, description, auto_approve_min_priority, default_branch)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (name) DO UPDATE SET
           repo = EXCLUDED.repo,
           local_path = EXCLUDED.local_path,
           stack = EXCLUDED.stack,
           auto_approve_min_priority = EXCLUDED.auto_approve_min_priority,
           updated_at = now()`,
        [
          name,
          (cfg.repo as string) ?? '',
          (cfg.local_path as string) ?? '',
          (cfg.stack as string[]) ?? [],
          (cfg.description as string) ?? '',
          ((cfg.auto_approve as Record<string, string>)?.min_priority as string) ?? 'major',
          (cfg.default_branch as string) ?? 'main',
        ],
      );
      upserted++;
    }
    console.log(`      ✓ ${upserted} project(s) upserted from projects.json`);

    // Seed issue_sources from projects.json
    const issueSources = Array.isArray(parsed.issue_sources) ? parsed.issue_sources : [];
    for (const url of issueSources as string[]) {
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
    if (issueSources.length > 0) {
      console.log(`      ✓ ${issueSources.length} issue source(s) seeded from projects.json`);
    }
  } catch (e) {
    console.warn(
      `      ⚠ projects.json import failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  console.log('[3/5] Importing knowledge from *.md files...');
  const result = await importKnowledge();

  console.log('[4/5] Seeding default LLM providers...');
  await seedDefaultProviders();

  console.log('[5/5] Seeding default issue sources...');
  await seedDefaultSources();

  console.log();
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Initialisation complete');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Context files imported: ${result.imported}`);
  console.log(`  Projects registered:    ${result.projects}`);
  console.log(`  Issue sources added:    ${result.sources}`);
  console.log();
  console.log('  Next steps:');
  console.log('    • Start the server:  yarn start');
  console.log();

  process.exit(0);
}

main().catch(e => {
  console.error('\n✗ Init failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
