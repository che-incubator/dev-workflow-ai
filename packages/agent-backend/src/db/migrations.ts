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

import { db } from './client.js';

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS projects (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    repo TEXT NOT NULL DEFAULT '',
    local_path TEXT DEFAULT '',
    stack TEXT[] DEFAULT '{}',
    description TEXT DEFAULT '',
    auto_approve_min_priority TEXT DEFAULT 'major',
    story_point_budget INT DEFAULT 3,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS contexts (
    id SERIAL PRIMARY KEY,
    project_slug TEXT NOT NULL,
    name TEXT NOT NULL,
    content TEXT NOT NULL,
    source_file TEXT DEFAULT '',
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(project_slug, name)
  )`,

  `CREATE TABLE IF NOT EXISTS agent_runs (
    id SERIAL PRIMARY KEY,
    thread_id TEXT UNIQUE NOT NULL,
    project_slug TEXT NOT NULL,
    repo TEXT NOT NULL DEFAULT '',
    issue_number INT,
    issue_title TEXT DEFAULT '',
    issue_url TEXT DEFAULT '',
    priority TEXT DEFAULT '',
    priority_source TEXT DEFAULT '',
    jira_key TEXT DEFAULT '',
    status TEXT DEFAULT 'running',
    pr_url TEXT DEFAULT '',
    pr_number INT,
    verdict TEXT DEFAULT '',
    story_points INT DEFAULT 0,
    started_at TIMESTAMPTZ DEFAULT now(),
    finished_at TIMESTAMPTZ
  )`,

  `CREATE TABLE IF NOT EXISTS run_events (
    id SERIAL PRIMARY KEY,
    thread_id TEXT NOT NULL,
    phase TEXT NOT NULL,
    node TEXT NOT NULL,
    message TEXT NOT NULL,
    level TEXT DEFAULT 'info',
    ts TIMESTAMPTZ DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS findings (
    id SERIAL PRIMARY KEY,
    thread_id TEXT NOT NULL,
    file TEXT DEFAULT '',
    line INT,
    severity TEXT NOT NULL,
    finding TEXT NOT NULL,
    tier TEXT NOT NULL,
    ts TIMESTAMPTZ DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS issue_sources (
    id SERIAL PRIMARY KEY,
    url TEXT UNIQUE NOT NULL,
    kind TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    project_slug TEXT DEFAULT '',
    active BOOLEAN DEFAULT true,
    last_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS issues (
    id SERIAL PRIMARY KEY,
    source_id INT NOT NULL REFERENCES issue_sources(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    body TEXT DEFAULT '',
    labels TEXT[] DEFAULT '{}',
    priority TEXT DEFAULT '',
    assignees TEXT[] DEFAULT '{}',
    status TEXT DEFAULT 'open',
    score INT DEFAULT 0,
    story_points INT DEFAULT 0,
    raw JSONB DEFAULT '{}',
    fetched_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(source_id, external_id)
  )`,

  `CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS llm_providers (
    id SERIAL PRIMARY KEY,
    provider_id TEXT UNIQUE NOT NULL,
    label TEXT NOT NULL,
    api_key TEXT DEFAULT '',
    base_url TEXT DEFAULT '',
    model TEXT DEFAULT '',
    is_active BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  )`,

  // Auth is handled by the Eclipse Che gateway — no server-side sessions needed.
  // Keeping a no-op migration slot to preserve migration index compatibility.
  `SELECT 1`,

  // Add default_branch to projects (importKnowledge reads it from context.md frontmatter)
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS default_branch TEXT DEFAULT 'main'`,

  // Rename slug → name in projects (slug was the human-readable identifier)
  `DO $$ BEGIN
     IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name='projects' AND column_name='slug') THEN
       ALTER TABLE projects RENAME COLUMN slug TO name;
     END IF;
   END $$`,

  `ALTER TABLE issues ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ`,

  `CREATE TABLE IF NOT EXISTS issue_plans (
    id SERIAL PRIMARY KEY,
    issue_id INT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    content TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(issue_id)
  )`,
];

export async function runMigrations(): Promise<void> {
  for (const sql of MIGRATIONS) {
    await db.query(sql);
  }
  console.log('[migrations] All tables ready');
}
