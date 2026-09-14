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

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { State } from '../agent/state.js';
import { loadProjectConfig } from '../context/loader.js';

const execAsync = promisify(exec);

const agentName = () =>
  process.env.ANTHROPIC_VERTEX_PROJECT_ID
    ? `Claude Sonnet 4.6 (Vertex AI ${process.env.CLOUD_ML_REGION ?? 'global'})`
    : process.env.ANTHROPIC_API_KEY
      ? 'Claude Sonnet 4.6'
      : process.env.GEMINI_API_KEY
        ? `Gemini ${process.env.GEMINI_MODEL ?? 'gemini-3.6-flash'}`
        : `Ollama ${process.env.OLLAMA_MODEL ?? 'qwen2.5-coder:32b'}`;

function buildPrDescription(state: State, isDraft: boolean): string {
  return `# fix(${state.area}): ${state.fixSummary}

## Summary

${state.fixSummary}

## Issue

Closes ${state.issueUrl || `#${state.issueNumber}`}

## Changes

${state.affectedFiles.map(f => `- \`${f}\``).join('\n')}

## Test plan

- [ ] Unit tests pass
- [ ] Lint and format clean

${isDraft ? '\n> ⚠️ Draft — not all checks passed locally.' : ''}
`;
}

async function git(cmd: string, cwd: string): Promise<string> {
  const env = { ...process.env, GH_TOKEN: process.env.GITHUB_TOKEN ?? '' };
  const { stdout, stderr } = await execAsync(cmd, { cwd, env, timeout: 60_000 });
  return (stdout + stderr).trim();
}

export async function openPrNode(state: State): Promise<Partial<State>> {
  const isDraft = !state.testsPassed || !state.lintPassed;
  const prBody = buildPrDescription(state, isDraft);
  const issueRef = state.jiraKey
    ? state.jiraKey
    : state.issueNumber
      ? `#${state.issueNumber}`
      : state.issueUrl ?? '';
  const commitMsg = [
    `fix(${state.area}): ${state.fixSummary}`,
    '',
    issueRef ? `Closes ${issueRef}` : '',
    '',
    `Assisted-by: ${agentName()}`,
  ].filter((line, i, arr) => !(line === '' && arr[i - 1] === '')).join('\n');

  // ── Dry-run mode: write files, no git/GitHub operations ──────────────────
  if (state.dryRun) {
    const slug = `${state.repoSlug.replace('/', '-')}-${state.issueNumber ?? 'unknown'}`;
    const outDir = join(state.outputDir, slug);
    await mkdir(outDir, { recursive: true });

    const prMdPath = join(outDir, 'pr-description.md');
    await writeFile(prMdPath, prBody, 'utf8');

    let patchPath = '';
    if (state.repoLocal && state.branchName) {
      try {
        const { stdout } = await execAsync(
          `git -C ${JSON.stringify(state.repoLocal)} diff main...${state.branchName}`,
          { timeout: 30_000 },
        );
        if (stdout.trim()) {
          patchPath = join(outDir, 'changes.patch');
          await writeFile(patchPath, stdout, 'utf8');
        }
      } catch {
        patchPath = join(outDir, 'changes.patch');
        await writeFile(
          patchPath,
          `# Patch generation failed\n# Run: git diff main...${state.branchName}\n`,
          'utf8',
        );
      }
    }

    const analysisPath = join(outDir, 'analysis.md');
    await writeFile(
      analysisPath,
      [
        '# Issue Analysis',
        '',
        `**Issue:** ${state.issueUrl}`,
        `**Area:** ${state.area}`,
        `**Story points:** ${state.storyPoints}`,
        `**Affected files:**`,
        ...state.affectedFiles.map(f => `- ${f}`),
        '',
        '## Fix summary',
        '',
        state.fixSummary,
      ].join('\n'),
      'utf8',
    );

    console.log(`[dry-run] Output written to: ${outDir}`);
    return {
      messages: [
        `dry-run: PR description → ${prMdPath}`,
        patchPath ? `dry-run: Patch → ${patchPath}` : 'dry-run: No patch (no local repo or branch)',
        `dry-run: Analysis → ${analysisPath}`,
      ],
      prUrl: `file://${outDir}`,
      prNumber: null,
    };
  }

  // ── Normal mode: commit → push → open PR via gh CLI ───────────────────────
  const cwd = state.repoLocal;
  if (!cwd) {
    return { messages: ['open_pr: repoLocal not set — cannot commit or push'], status: 'failed' };
  }
  if (!state.branchName) {
    return { messages: ['open_pr: branchName not set'], status: 'failed' };
  }

  try {
    // 1. Write commit message to a temp file — avoids all shell escaping issues
    const msgFile = join(tmpdir(), `dwa-commit-${Date.now()}.txt`);
    await writeFile(msgFile, commitMsg, 'utf8');

    // 2. Stage everything
    await git('git add -A', cwd);

    // 3. Commit
    const commitOut = await git(`git commit -F ${JSON.stringify(msgFile)}`, cwd);
    console.log(`[open_pr] commit: ${commitOut.split('\n')[0]}`);

    // 4. Push branch, setting upstream
    const pushOut = await git(`git push -u origin ${state.branchName}`, cwd);
    console.log(`[open_pr] push: ${pushOut.split('\n').slice(-2).join(' ')}`);

    // 5. Create PR via GitHub REST API (TypeScript — no shell dependency)
    const prTitle = `fix(${state.area}): ${state.fixSummary}`;
    const [owner, repo] = state.repoSlug.split('/');
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error('GITHUB_TOKEN not set — cannot create PR');

    const apiRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'dev-workflow-ai',
      },
      body: JSON.stringify({
        title: prTitle,
        body: prBody,
        head: state.branchName,
        base: 'main',
        draft: isDraft,
      }),
    });

    if (!apiRes.ok) {
      const errBody = await apiRes.text();
      throw new Error(`GitHub API ${apiRes.status}: ${errBody.slice(0, 300)}`);
    }

    const prData = await apiRes.json() as { html_url: string; number: number };
    const prUrl = prData.html_url;
    const prNumber = prData.number;

    // Clean up the local feature branch — PR is on the remote, local copy is stale
    try {
      const projConfig = await loadProjectConfig(state.project);
      const defaultBranch = projConfig?.default_branch ?? 'main';
      await git(`git checkout ${defaultBranch}`, cwd);
      await git(`git branch -D ${state.branchName}`, cwd);
      console.log(`[open_pr] deleted local branch: ${state.branchName}`);
    } catch {
      // Non-fatal — local cleanup failure doesn't affect the PR
    }

    return {
      prUrl,
      prNumber,
      messages: [`open_pr: ${prUrl}${isDraft ? ' [DRAFT]' : ''}`],
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      messages: [`open_pr: failed — ${msg}`],
      status: 'failed',
    };
  }
}
