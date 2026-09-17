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
 * importKnowledge — scans the knowledge directory for *.md files,
 * parses YAML frontmatter from context.md files to register projects and
 * issue sources, then upserts all content into the `contexts` table.
 *
 * This makes the system fully universal: add a new project by creating
 * subprojects/<slug>/context.md with frontmatter — no code changes needed.
 *
 * Frontmatter schema (in subprojects/<slug>/context.md):
 *   repo:                      eclipse-che/che-dashboard
 *   stack:                     [TypeScript, React 18, PatternFly 6]
 *   description:               One-line description
 *   local_path:                /absolute/path/to/local/clone  (optional)
 *   auto_approve_min_priority: major  (default: major)
 *   story_point_budget:        3      (default: 3)
 *   issue_source:              https://github.com/owner/repo/issues  (optional)
 */

import matter from 'gray-matter';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { db } from '../db/client.js';

const KNOWLEDGE_DIR = process.env.KNOWLEDGE_DIR ?? '/knowledge';

interface Classified {
  projectSlug: string;
  name: string;
  isProjectContext: boolean; // true for subprojects/<slug>/context.md
}

function classifyFile(rel: string): Classified | null {
  // context/<name>.md → global / <name>
  const contextMatch = rel.match(/^context\/([^/]+)\.md$/);
  if (contextMatch) {
    return { projectSlug: 'global', name: contextMatch[1], isProjectContext: false };
  }

  // subprojects/<slug>/context.md  → main project context (has frontmatter)
  const mainContextMatch = rel.match(/^subprojects\/([^/]+)\/context\.md$/);
  if (mainContextMatch) {
    return { projectSlug: mainContextMatch[1], name: 'context', isProjectContext: true };
  }

  // subprojects/<slug>/context-*.md, rules/dev.md, skills/*/SKILL.md
  const projectMatch = rel.match(/^subprojects\/([^/]+)\/(.+?)(?:\/SKILL)?\.md$/);
  if (projectMatch) {
    const slug = projectMatch[1];
    const rawName = projectMatch[2].replace(/\//g, '-');
    return { projectSlug: slug, name: rawName, isProjectContext: false };
  }

  // shared/sources.md — special: handled separately for source seeding, also stored as context
  if (rel === 'shared/sources.md') {
    return { projectSlug: 'shared', name: 'sources', isProjectContext: false };
  }

  // shared/rules/<name>.md
  const sharedRules = rel.match(/^shared\/rules\/([^/]+)\.md$/);
  if (sharedRules) {
    return { projectSlug: 'shared', name: `rules-${sharedRules[1]}`, isProjectContext: false };
  }

  // shared/skills/<skill>/SKILL.md
  const sharedSkill = rel.match(/^shared\/skills\/([^/]+)\/SKILL\.md$/);
  if (sharedSkill) {
    return { projectSlug: 'shared', name: `skills-${sharedSkill[1]}`, isProjectContext: false };
  }

  return null;
}

async function scanDir(dir: string, results: string[] = []): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const s = await stat(full).catch(() => null);
    if (!s) continue;
    if (s.isDirectory()) {
      await scanDir(full, results);
    } else if (entry.endsWith('.md')) {
      results.push(full);
    }
  }
  return results;
}

interface ProjectMeta {
  repo?: string;
  stack?: string[];
  description?: string;
  local_path?: string;
  default_branch?: string;
  auto_approve_min_priority?: string;
  story_point_budget?: number;
  issue_source?: string;
}

function parseMeta(data: Record<string, unknown>): ProjectMeta {
  const stack = Array.isArray(data.stack)
    ? (data.stack as unknown[]).map(String)
    : typeof data.stack === 'string'
      ? data.stack.split(',').map(s => s.trim())
      : [];

  return {
    repo: typeof data.repo === 'string' ? data.repo : undefined,
    stack,
    description: typeof data.description === 'string' ? data.description : undefined,
    local_path: typeof data.local_path === 'string' ? data.local_path : undefined,
    default_branch: typeof data.default_branch === 'string' ? data.default_branch : 'main',
    auto_approve_min_priority:
      typeof data.auto_approve_min_priority === 'string' ? data.auto_approve_min_priority : 'major',
    story_point_budget: typeof data.story_point_budget === 'number' ? data.story_point_budget : 3,
    issue_source: typeof data.issue_source === 'string' ? data.issue_source : undefined,
  };
}

export async function importKnowledge(
  dir?: string,
): Promise<{ imported: number; projects: number; sources: number }> {
  const effectiveDir = dir ?? KNOWLEDGE_DIR;
  const allFiles = await scanDir(effectiveDir);
  let imported = 0;
  let projectsRegistered = 0;
  let sourcesRegistered = 0;

  // Collect all issue_source URLs defined in this knowledge directory before
  // upserting — then delete any stale DB rows that are no longer configured.
  const configuredSourceUrls = new Set<string>();

  // 1. Collect per-project issue_source from subprojects/*/context.md
  for (const fp of allFiles) {
    const rel = relative(effectiveDir, fp);
    const cl = classifyFile(rel);
    if (cl?.isProjectContext) {
      try {
        const raw2 = await readFile(fp, 'utf8');
        const parsed2 = matter(raw2);
        const src = (parsed2.data as Record<string, unknown>).issue_source;
        if (typeof src === 'string' && src) {
          // Only strip query/fragment from GitHub URLs; preserve Jira URLs as-is
          const cleanUrl = src.includes('github.com')
            ? src.replace(/\/(issues|pulls)\/?$/, '').replace(/[?#].*$/, '')
            : src;
          configuredSourceUrls.add(cleanUrl);
        }
      } catch {
        /* ignore */
      }
    }
  }

  // 2. Collect shared issue_sources from shared/sources.md (array of URLs)
  const sharedSourcesFile = join(effectiveDir, 'shared', 'sources.md');
  const sharedSourcesList: string[] = [];
  try {
    const sharedRaw = await readFile(sharedSourcesFile, 'utf8');
    const sharedParsed = matter(sharedRaw);
    const urls = (sharedParsed.data as Record<string, unknown>).issue_sources;
    const list = Array.isArray(urls)
      ? (urls as unknown[]).map(String)
      : typeof urls === 'string'
        ? [urls]
        : [];
    for (const u of list) {
      if (u) {
        configuredSourceUrls.add(u);
        sharedSourcesList.push(u);
      }
    }
  } catch {
    /* file doesn't exist — no shared sources configured */
  }

  // Remove sources that are no longer in the knowledge files
  if (configuredSourceUrls.size > 0) {
    await db
      .query(
        `DELETE FROM issue_sources WHERE url NOT IN (${[...configuredSourceUrls].map((_, i) => `$${i + 1}`).join(',')})`,
        [...configuredSourceUrls],
      )
      .catch(() => {}); // non-fatal if table doesn't exist yet
  } else {
    // No sources defined in this import → clear all (full reset)
    await db.query('DELETE FROM issue_sources').catch(() => {});
  }

  // Upsert shared sources so they exist even before sync
  for (const url of sharedSourcesList) {
    const isJira =
      url.includes('atlassian.net') || url.includes('/jira/') || url.includes('/browse/');
    const label = url.includes('/jira/for-you')
      ? 'Assigned to me'
      : isJira
        ? new URL(url).hostname
        : url.replace('https://github.com/', '');
    const kind = isJira ? 'jira' : 'github';
    await db
      .query(
        `INSERT INTO issue_sources (url, kind, label, project_slug)
       VALUES ($1, $2, $3, '')
       ON CONFLICT (url) DO NOTHING`,
        [url, kind, label],
      )
      .catch(() => {});
    sourcesRegistered++;
  }

  for (const fullPath of allFiles) {
    const rel = relative(effectiveDir, fullPath);
    const classified = classifyFile(rel);
    if (!classified) continue;

    const raw = await readFile(fullPath, 'utf8');

    // Only parse frontmatter on main context.md files — other files may contain
    // bare --- separators that aren't YAML (SKILL.md, rules, etc.)
    let content = raw;
    let meta: ProjectMeta = {};
    if (classified.isProjectContext) {
      try {
        const parsed = matter(raw);
        content = parsed.content.trim() || raw;
        meta = parseMeta(parsed.data as Record<string, unknown>);
      } catch {
        content = raw;
      }
    }

    // Upsert context
    await db.query(
      `INSERT INTO contexts (project_slug, name, content, source_file, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (project_slug, name)
       DO UPDATE SET content = EXCLUDED.content, source_file = EXCLUDED.source_file, updated_at = now()`,
      [classified.projectSlug, classified.name, content, rel],
    );
    imported++;

    if (classified.isProjectContext && meta.repo) {
      const { rowCount } = await db.query(
        `INSERT INTO projects (name, repo, local_path, default_branch, stack, description, auto_approve_min_priority, story_point_budget, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
         ON CONFLICT (name) DO UPDATE SET
           repo                      = EXCLUDED.repo,
           local_path                = CASE
             WHEN EXCLUDED.local_path <> '' THEN EXCLUDED.local_path
             ELSE projects.local_path
           END,
           default_branch            = EXCLUDED.default_branch,
           stack                     = EXCLUDED.stack,
           description               = EXCLUDED.description,
           auto_approve_min_priority = EXCLUDED.auto_approve_min_priority,
           story_point_budget        = EXCLUDED.story_point_budget,
           updated_at                = now()`,
        [
          classified.projectSlug,
          meta.repo,
          meta.local_path ?? '',
          meta.default_branch ?? 'main',
          meta.stack ?? [],
          meta.description ?? '',
          meta.auto_approve_min_priority ?? 'major',
          meta.story_point_budget ?? 3,
        ],
      );
      if ((rowCount ?? 0) > 0) projectsRegistered++;

      // Register issue source if defined
      if (meta.issue_source) {
        const cleanUrl = meta.issue_source
          .replace(/\/(issues|pulls)\/?$/, '')
          .replace(/[?#].*$/, '');
        const kind = cleanUrl.includes('github.com') ? 'github' : 'jira';
        const label = cleanUrl
          .replace('https://github.com/', '')
          .replace(/^https?:\/\/[^/]+\//, '');

        await db.query(
          `INSERT INTO issue_sources (url, kind, label, project_slug)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (url) DO UPDATE SET
             label        = EXCLUDED.label,
             project_slug = EXCLUDED.project_slug`,
          [cleanUrl, kind, label, classified.projectSlug],
        );
        sourcesRegistered++;
      }
    } else if (classified.projectSlug !== 'global' && classified.projectSlug !== 'shared') {
      // Auto-stub project row if it doesn't exist yet (no frontmatter)
      await db.query(
        `INSERT INTO projects (name, repo, description)
         VALUES ($1, '', $2)
         ON CONFLICT (name) DO NOTHING`,
        [classified.projectSlug, `Auto-imported from ${rel}`],
      );
    }
  }

  return { imported, projects: projectsRegistered, sources: sourcesRegistered };
}
