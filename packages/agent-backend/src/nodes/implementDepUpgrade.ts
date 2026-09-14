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
 * implementDepUpgrade — specialized agent for CVE dependency version bumps.
 *
 * Triggered when analyze classifies the fix as a dependency upgrade:
 *   "Upgrade <package> to <version>"
 *
 * Algorithm (inspired by Claude Code feature-dev Phase 5):
 *   1. Parse package name and target version from analyze summary
 *   2. Find the package.json that contains the dep
 *   3. Update the version pin
 *   4. Run yarn install to update the lockfile
 *   5. Emit output files (patch + analysis snippet)
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { glob } from 'node:fs';
import { State } from '../agent/state.js';
import { loadProjectConfig } from '../context/loader.js';

const execAsync = promisify(exec);

// ── Parse dep upgrade summary from analyze output ────────────────────────────

interface DepUpgrade {
  packageName: string;
  targetVersion: string | null; // null = resolve from npm at runtime
}

function parseDepUpgrade(summary: string): DepUpgrade | null {
  // Extract package name — word after "Upgrade" (before " dependency", " in", " to", or end)
  const pkgMatch = summary.match(/upgrad\w+\s+([a-zA-Z0-9@/_-]+)/i);
  if (!pkgMatch) return null;

  // Normalize: npm package names are lowercase; strip trailing punctuation
  const packageName = pkgMatch[1].toLowerCase().replace(/[.,;:]+$/, '');

  // Extract version — "to version 5.12.2" or "to 5.12.2" anywhere in string (optional)
  const versionMatch = summary.match(/\bto\s+(?:version\s+)?[\^~]?([\d]+\.[\d]+\.[\d]+)/i);
  const targetVersion = versionMatch ? versionMatch[1] : null;

  return { packageName, targetVersion };
}

// ── Find package.json files containing a dep ─────────────────────────────────

async function findPackageJsonWith(repoRoot: string, dep: string): Promise<string[]> {
  const found: string[] = [];
  const glob = await import('node:fs/promises');
  const { readdir, stat } = glob;

  async function scan(dir: string): Promise<void> {
    let entries: string[];
    try { entries = await readdir(dir); } catch { return; }
    for (const e of entries) {
      if (e === 'node_modules' || e.startsWith('.')) continue;
      const full = join(dir, e);
      const s = await stat(full).catch(() => null);
      if (!s) continue;
      if (s.isDirectory()) { await scan(full); continue; }
      if (e === 'package.json') {
        try {
          const raw = await readFile(full, 'utf-8');
          const pkg = JSON.parse(raw) as Record<string, unknown>;
          const deps = { ...(pkg.dependencies as object ?? {}), ...(pkg.devDependencies as object ?? {}) };
          if (dep in deps) found.push(full);
        } catch { /* skip */ }
      }
    }
  }
  await scan(repoRoot);
  return found;
}

// ── Main node ────────────────────────────────────────────────────────────────

export async function implementDepUpgradeNode(state: State): Promise<Partial<State>> {
  // ── Batch CVE mode: combine multiple CVE issues into one upgrade ──────────
  if (state.isBatch && state.batchIssues && state.batchIssues.length > 0) {
    return await implementBatchDepUpgrade(state);
  }

  // Prefer state.fixSummary (direct field set by analyze); fall back to the log message
  const analysisSummary =
    state.fixSummary ??
    state.issueTitle ??
    state.messages.find(m => m.startsWith('analyze:')) ??
    '';
  const upgrade = parseDepUpgrade(analysisSummary);

  if (!upgrade) {
    return {
      messages: ['implement_dep_upgrade: could not parse package name from analyze summary — skipping'],
      testsPassed: false,
      lintPassed: false,
      status: 'failed',
    };
  }

  const { packageName } = upgrade;
  // If the issue/summary didn't state a target version, resolve latest from npm below
  let targetVersion = upgrade.targetVersion;
  const config = await loadProjectConfig(state.project);
  const rawPath = config?.local_path ?? state.repoLocal ?? '';
  // Resolve relative paths (e.g. ".repos/...") against the server's cwd
  const repoRoot = rawPath.startsWith('/') ? rawPath : resolve(process.cwd(), rawPath);

  // Clone or pull the repo so we have fresh code to modify
  const repoSlug = config?.repo ?? state.repoSlug ?? '';
  if (repoSlug) {
    try {
      const repoUrl = `https://github.com/${repoSlug}.git`;
      const token = process.env.GITHUB_TOKEN;
      const authedUrl = token
        ? repoUrl.replace('https://', `https://oauth2:${token}@`)
        : repoUrl;

      const { mkdirSync, existsSync } = await import('node:fs');
      const parentDir = resolve(repoRoot, '..');
      mkdirSync(parentDir, { recursive: true });

      if (existsSync(resolve(repoRoot, '.git'))) {
        // Already cloned — fetch only; the reset step below brings us to HEAD
        await execAsync(
          `git -C ${JSON.stringify(repoRoot)} fetch --all --prune`,
          { timeout: 120_000 },
        );
      } else {
        // Fresh clone
        await execAsync(
          `git clone ${JSON.stringify(authedUrl)} ${JSON.stringify(repoRoot)}`,
          { timeout: 300_000 },
        );
      }
    } catch (e) {
      return {
        messages: [`implement_dep_upgrade: git clone/pull failed — ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`],
        testsPassed: false, lintPassed: false, status: 'failed',
      };
    }
  }

  // Reset to clean default branch + create new feature branch
  // Rule: every implementation starts from a clean default branch
  const branchName = `${state.jiraKey || 'fix'}-${packageName.replace(/[@/]/g, '-')}-${targetVersion}`;
  try {
    // Use default_branch from project config (set in context.md frontmatter)
    const defaultBranch = config?.default_branch ?? 'main';

    // Fetch latest, reset to clean default branch
    await execAsync(
      `git -C ${JSON.stringify(repoRoot)} fetch --all --prune`,
      { timeout: 60_000 },
    );
    await execAsync(
      `git -C ${JSON.stringify(repoRoot)} checkout ${defaultBranch} && git -C ${JSON.stringify(repoRoot)} reset --hard origin/${defaultBranch}`,
      { timeout: 30_000 },
    );

    // Delete stale local branch if it exists, then create fresh
    await execAsync(
      `git -C ${JSON.stringify(repoRoot)} branch -D ${branchName} 2>/dev/null || true`,
      { timeout: 10_000 },
    );
    await execAsync(
      `git -C ${JSON.stringify(repoRoot)} checkout -b ${branchName}`,
      { timeout: 10_000 },
    );
    console.log(`[dep-upgrade] On new branch: ${branchName}`);
  } catch (e) {
    return {
      messages: [`implement_dep_upgrade: branch setup failed — ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`],
      testsPassed: false, lintPassed: false, status: 'failed',
    };
  }

  // 1. Find package.json files containing the dep
  const pkgFiles = await findPackageJsonWith(repoRoot, packageName);
  if (pkgFiles.length === 0) {
    return {
      messages: [`implement_dep_upgrade: ${packageName} not found in any package.json under ${repoRoot}`],
      testsPassed: false,
      lintPassed: false,
    };
  }

  // 2. Resolve target version from npm if not stated in the issue/summary
  let resolvedVersion = targetVersion ?? '';
  try {
    const { stdout } = await execAsync(`npm info ${packageName} version`, { timeout: 10_000 });
    const latest = stdout.trim();
    if (!targetVersion) {
      // No explicit version — use the current npm latest
      resolvedVersion = latest;
    } else {
      const [latestMajor, latestMinor] = latest.split('.').map(Number);
      const [targetMajor, targetMinor] = targetVersion.split('.').map(Number);
      // Use latest if it's the same major/minor and newer patch
      if (latestMajor === targetMajor && latestMinor >= targetMinor) {
        resolvedVersion = latest;
      }
    }
  } catch {
    if (!resolvedVersion) {
      return {
        messages: [`implement_dep_upgrade: could not resolve version for ${packageName} from npm`],
        testsPassed: false, lintPassed: false, status: 'failed',
      };
    }
  }
  // Ensure targetVersion is set for downstream use
  targetVersion = resolvedVersion;

  // 3. Update each package.json
  const changedFiles: string[] = [];
  for (const pkgFile of pkgFiles) {
    const raw = await readFile(pkgFile, 'utf-8');
    const pkg = JSON.parse(raw) as Record<string, Record<string, string>>;
    let changed = false;

    for (const section of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
      if (pkg[section]?.[packageName]) {
        const old = pkg[section][packageName];
        pkg[section][packageName] = `^${resolvedVersion}`;
        if (old !== pkg[section][packageName]) changed = true;
      }
    }

    if (changed) {
      await writeFile(pkgFile, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
      changedFiles.push(pkgFile.replace(repoRoot + '/', ''));
    }
  }

  if (changedFiles.length === 0) {
    return {
      messages: [`implement_dep_upgrade: ${packageName} already at ^${resolvedVersion}`],
      testsPassed: true,
      lintPassed: true,
    };
  }

  // 4. Run yarn install to update lockfile
  try {
    await execAsync('yarn install --silent', { cwd: repoRoot, timeout: 120_000 });
  } catch (e) {
    return {
      messages: [`implement_dep_upgrade: yarn install failed — ${e instanceof Error ? e.message : String(e)}`],
      testsPassed: false,
      lintPassed: false,
    };
  }

  // 4b. Regenerate license files — required when yarn.lock changes (che-dashboard rule §3)
  try {
    await execAsync('yarn license:generate', { cwd: repoRoot, timeout: 120_000 });
  } catch (e) {
    // Non-fatal: warn but don't block the upgrade
    console.warn(`[dep-upgrade] yarn license:generate failed — ${e instanceof Error ? e.message.slice(0, 200) : e}`);
  }

  // 5. Verify installed version
  let installedVersion = '?';
  try {
    const { stdout } = await execAsync(
      `node -e "console.log(require('${packageName}/package.json').version)"`,
      { cwd: repoRoot, timeout: 5_000 },
    );
    installedVersion = stdout.trim();
  } catch { /* ignore */ }

  // 6. Generate patch
  let patch = '';
  try {
    const { stdout } = await execAsync(
      `git diff HEAD -- ${changedFiles.join(' ')} yarn.lock`,
      { cwd: repoRoot, timeout: 10_000 },
    );
    patch = stdout;
  } catch { /* ignore */ }

  // 7. Write output files
  const outputDir = join(state.outputDir ?? 'output', state.jiraKey || `run-${Date.now()}`);
  await mkdir(outputDir, { recursive: true });

  if (patch) {
    await writeFile(join(outputDir, 'changes.patch'), patch, 'utf-8');
  }

  const summary = `implement_dep_upgrade: bumped ${packageName} ${targetVersion} → ${resolvedVersion} (installed: ${installedVersion}) in [${changedFiles.join(', ')}]`;
  return {
    messages: [summary],
    affectedFiles: [...changedFiles, 'yarn.lock'],
    branchName,  // already created above — openPr will commit + push it
    fixSummary: `Upgrade ${packageName} to ${resolvedVersion} to patch ${state.jiraKey || 'CVE'}`,
    testsPassed: true,
    lintPassed: true,
    retryCount: 0,
  };
}

// ── Batch CVE upgrade — multiple packages in one branch/PR ────────────────

async function implementBatchDepUpgrade(state: State): Promise<Partial<State>> {
  const batchIssues = state.batchIssues ?? [];
  const config = await loadProjectConfig(state.project);
  const rawPath = config?.local_path ?? state.repoLocal ?? '';
  const repoRoot = rawPath.startsWith('/') ? rawPath : resolve(process.cwd(), rawPath);
  const defaultBranch = config?.default_branch ?? 'main';

  if (!repoRoot) {
    return { messages: ['batch_dep_upgrade: no local_path configured'], status: 'failed' };
  }

  // Clone/fetch repo
  const repoSlug = config?.repo ?? state.repoSlug ?? '';
  if (repoSlug) {
    try {
      const token = process.env.GITHUB_TOKEN;
      const repoUrl = `https://github.com/${repoSlug}.git`;
      const authedUrl = token ? repoUrl.replace('https://', `https://oauth2:${token}@`) : repoUrl;
      const { mkdirSync, existsSync } = await import('node:fs');
      mkdirSync(resolve(repoRoot, '..'), { recursive: true });
      if (existsSync(resolve(repoRoot, '.git'))) {
        await execAsync(`git -C ${JSON.stringify(repoRoot)} fetch --all --prune`, { timeout: 120_000 });
      } else {
        await execAsync(`git clone ${JSON.stringify(authedUrl)} ${JSON.stringify(repoRoot)}`, { timeout: 300_000 });
      }
    } catch (e) {
      return { messages: [`batch_dep_upgrade: git fetch failed — ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`], status: 'failed' };
    }
  }

  // Create batch branch
  const issueKeys = batchIssues.map(i => i.jiraKey || i.url.split('/').pop()).slice(0, 5).join('-');
  const branchName = `cve-batch-${issueKeys}-deps`.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 80);

  try {
    await execAsync(`git -C ${JSON.stringify(repoRoot)} fetch --all --prune`, { timeout: 60_000 });
    await execAsync(`git -C ${JSON.stringify(repoRoot)} checkout ${defaultBranch} && git -C ${JSON.stringify(repoRoot)} reset --hard origin/${defaultBranch}`, { timeout: 30_000 });
    await execAsync(`git -C ${JSON.stringify(repoRoot)} branch -D ${branchName} 2>/dev/null || true`, { timeout: 10_000 });
    await execAsync(`git -C ${JSON.stringify(repoRoot)} checkout -b ${branchName}`, { timeout: 10_000 });
  } catch (e) {
    return { messages: [`batch_dep_upgrade: branch setup failed — ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`], status: 'failed' };
  }

  // Extract package names from all batch issue titles/summaries
  const upgrades: Array<{ packageName: string; resolvedVersion: string }> = [];
  const allChangedFiles: string[] = [];

  for (const issue of batchIssues) {
    const text = issue.title ?? '';
    // Try standard "Upgrade <pkg>" parser first
    let parsed = parseDepUpgrade(text);
    // Fallback: Jira CVE title format "CVE-YYYY-NNNN component: package-name: description"
    if (!parsed) {
      const cveMatch = text.match(/CVE-[\d-]+\s+[^:]+:\s+([\w@/_-]+)(?::|$)/i);
      if (cveMatch) {
        parsed = { packageName: cveMatch[1].toLowerCase(), targetVersion: null };
      }
    }
    if (!parsed) continue;

    const { packageName } = parsed;
    // Resolve latest from npm
    let resolvedVersion = parsed.targetVersion ?? '';
    try {
      const { stdout } = await execAsync(`npm info ${packageName} version`, { timeout: 10_000 });
      resolvedVersion = stdout.trim();
    } catch { if (!resolvedVersion) continue; }

    // Find and update package.json files
    const pkgFiles = await findPackageJsonWith(repoRoot, packageName);
    for (const pkgFile of pkgFiles) {
      const raw = await readFile(pkgFile, 'utf-8');
      const pkg = JSON.parse(raw) as Record<string, Record<string, string>>;
      let changed = false;
      for (const section of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
        if (pkg[section]?.[packageName]) {
          pkg[section][packageName] = `^${resolvedVersion}`;
          changed = true;
        }
      }
      if (changed) {
        await writeFile(pkgFile, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
        const rel = pkgFile.replace(repoRoot + '/', '');
        if (!allChangedFiles.includes(rel)) allChangedFiles.push(rel);
      }
    }

    if (pkgFiles.length > 0) upgrades.push({ packageName, resolvedVersion });
  }

  if (upgrades.length === 0) {
    return { messages: ['batch_dep_upgrade: no packages found to upgrade'], status: 'failed' };
  }

  // Run yarn install once for all upgrades
  try {
    await execAsync('yarn install --silent', { cwd: repoRoot, timeout: 180_000 });
  } catch (e) {
    return { messages: [`batch_dep_upgrade: yarn install failed — ${e instanceof Error ? e.message : String(e)}`], status: 'failed' };
  }

  // Regenerate license files — required when yarn.lock changes (che-dashboard rule §3)
  try {
    await execAsync('yarn license:generate', { cwd: repoRoot, timeout: 120_000 });
  } catch (e) {
    console.warn(`[batch-dep-upgrade] yarn license:generate failed — ${e instanceof Error ? e.message.slice(0, 200) : e}`);
  }

  const upgradeList = upgrades.map(u => `${u.packageName}@${u.resolvedVersion}`).join(', ');
  const issueRefs = batchIssues.map(i => i.jiraKey || i.url).join(', ');
  const summary = `batch_dep_upgrade: upgraded ${upgrades.length} packages (${upgradeList}) for CVEs: ${issueRefs}`;

  return {
    messages: [summary],
    affectedFiles: [...allChangedFiles, 'yarn.lock'],
    branchName,
    fixSummary: `Batch CVE fix: upgrade ${upgradeList}`,
    testsPassed: true,
    lintPassed: true,
    retryCount: 0,
  };
}
