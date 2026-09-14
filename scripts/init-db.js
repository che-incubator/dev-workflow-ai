#!/usr/bin/env node
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
 * init-db.js — initialise the database from local *.md files
 *
 * Usage:
 *   node scripts/init-db.js
 *   node scripts/init-db.js --dir /path/to/custom/knowledge/dir
 *   node scripts/init-db.js --dry-run   (print what would be imported, no DB writes)
 *
 * What it does:
 *   1. Runs all DB migrations (idempotent — safe to run again)
 *   2. Sets up LangGraph checkpoint tables
 *   3. Scans *.md files in the knowledge directory
 *   4. Reads YAML frontmatter from projects/<slug>/context.md:
 *        repo, stack, description, local_path,
 *        auto_approve_min_priority, story_point_budget, issue_source
 *   5. Registers each project in the `projects` table
 *   6. Registers each issue_source in `issue_sources`
 *   7. Upserts all *.md content into `contexts`
 *
 * To add a new project (any repo, not just Eclipse Che):
 *   1. Create projects/<your-slug>/context.md with frontmatter
 *   2. Re-run: node scripts/init-db.js
 *   Done — no code changes needed.
 *
 * Requires: DATABASE_URL env var (or set in .env)
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import matter from 'gray-matter';

// ── CLI args ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const skipPreview = args.includes('--skip-preview');
const dirArgIdx = args.findIndex(a => a === '--dir');
const dirArg =
  args.find(a => a.startsWith('--dir='))?.split('=')[1] ??
  (dirArgIdx !== -1 ? args[dirArgIdx + 1] : undefined);

const ROOT = resolve(process.cwd());

// Resolve DevWorkspace predefined variables that the operator may leave unsubstituted
// in env var values (e.g. KNOWLEDGE_DIR="${PROJECT_SOURCE}/pg_seed/eclipse-che").
function resolveDevWorkspaceVars(value) {
  return value
    .replace(/\$\{PROJECT_SOURCE\}/g, process.env.PROJECT_SOURCE ?? ROOT)
    .replace(/\$\{PROJECTS_ROOT\}/g, process.env.PROJECTS_ROOT ?? '/projects');
}

// Priority: --dir arg > KNOWLEDGE_DIR env var > <repo-root>/pg_seed/eclipse-che
const rawKnowledgeDir = process.env.KNOWLEDGE_DIR ?? join(ROOT, 'pg_seed/eclipse-che');
const KNOWLEDGE_DIR = dirArg ? resolve(dirArg) : resolve(resolveDevWorkspaceVars(rawKnowledgeDir));
process.env.KNOWLEDGE_DIR = KNOWLEDGE_DIR;

if (dryRun) {
  console.log('⚠  DRY RUN — no database writes\n');
}

// ── Preview what will be imported ─────────────────────────────────────────
async function scanForProjects(dir) {
  const projectsDir = join(dir, 'projects');
  let entries;
  try {
    entries = await readdir(projectsDir);
  } catch {
    console.log('No projects/ directory found in', dir);
    return;
  }

  console.log('\n📁 Projects found in projects/:\n');
  for (const slug of entries.sort()) {
    const contextPath = join(projectsDir, slug, 'context.md');
    try {
      const raw = await readFile(contextPath, 'utf8');
      const parsed = matter(raw);
      const data = parsed.data;
      const repo = data.repo ?? 'no repo defined';
      const desc = data.description ?? '';
      const stack = Array.isArray(data.stack) ? data.stack.join(', ') : (data.stack ?? '');
      const issueSource = data.issue_source ?? 'no issue source';

      console.log(`  ├─ ${slug}`);
      console.log(`  │   repo:    ${repo}`);
      if (desc) console.log(`  │   desc:    ${desc}`);
      if (stack) console.log(`  │   stack:   ${stack}`);
      console.log(`  │   issues:  ${issueSource}`);
      console.log('  │');
    } catch {
      console.log(`  ├─ ${slug}  (no context.md — will stub)`);
    }
  }

  // Count all .md files
  let mdCount = 0;
  async function count(d) {
    const es = await readdir(d).catch(() => []);
    for (const e of es) {
      const f = join(d, e);
      const s = await stat(f).catch(() => null);
      if (!s) continue;
      if (s.isDirectory()) await count(f);
      else if (e.endsWith('.md')) mdCount++;
    }
  }
  await count(join(dir, 'projects'));
  await count(join(dir, 'shared')).catch(() => {});
  await count(join(dir, 'context')).catch(() => {});
  console.log(`  Total *.md files to import: ${mdCount}`);
}

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

  if (!skipPreview) await scanForProjects(KNOWLEDGE_DIR);

  if (dryRun) {
    console.log('\n⚠  Dry-run mode — exiting without DB writes.');
    console.log('   Remove --dry-run to apply.');
    process.exit(0);
  }

  console.log('\n[1/3] Running DB migrations...');
  const { runMigrations } = await import('../packages/agent-backend/src/db/migrations.js');
  await runMigrations();

  console.log('[2/3] Setting up LangGraph checkpoints...');
  try {
    const { PostgresSaver } = await import('@langchain/langgraph-checkpoint-postgres');
    const checkpointer = await PostgresSaver.fromConnString(process.env.DATABASE_URL);
    await checkpointer.setup();
    console.log('      ✓ LangGraph checkpoint tables ready');
  } catch (e) {
    console.warn(
      '      ⚠ LangGraph checkpoint setup failed (non-fatal):',
      e instanceof Error ? e.message : String(e),
    );
  }

  console.log('[3/3] Importing knowledge from *.md files...');
  const { importKnowledge } = await import('../packages/agent-backend/src/init/importKnowledge.js');
  const result = await importKnowledge();

  console.log();
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Initialisation complete');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Context files imported: ${result.imported}`);
  console.log(`  Projects registered:    ${result.projects}`);
  console.log(`  Issue sources added:    ${result.sources}`);
  console.log();
  console.log('  Next steps:');
  console.log('    • Start the stack:   yarn dev');
  console.log('    • Run an issue:      yarn run-issue <github-issue-url>');
  console.log();
}

main().catch(e => {
  console.error('\n✗ Init failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
