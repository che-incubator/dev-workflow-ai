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
import { loadContext, loadProjectConfig } from '../context/loader.js';
import { getSetting } from '../db/settingsHelper.js';
import { llmDeep, logTokenUsage } from '../llm/client.js';
import { HumanMessage } from '@langchain/core/messages';

const execAsync = promisify(exec);

const agentName = () =>
  process.env.ANTHROPIC_VERTEX_PROJECT_ID
    ? `Claude Sonnet 4.6 (Vertex AI ${process.env.CLOUD_ML_REGION ?? 'global'})`
    : process.env.ANTHROPIC_API_KEY
      ? 'Claude Sonnet 4.6'
      : process.env.GEMINI_API_KEY
        ? `Gemini ${process.env.GEMINI_MODEL ?? 'gemini-3.6-flash'}`
        : `Ollama ${process.env.OLLAMA_MODEL ?? 'qwen2.5-coder:32b'}`;

// ── PR description builder — LLM generates full body using project-specific skills ──

async function buildPrDescription(state: State, isDraft: boolean): Promise<string> {
  const isBatch = state.isBatch && (state.batchIssues ?? []).length > 0;
  const batchIssues = state.batchIssues ?? [];

  const prContext = await loadContext(state.project, [
    'context-pr-template',
    'skills-pr-description',
    'skills-pr-test-section',
  ]).catch(() => '');

  const issueRefs = isBatch
    ? batchIssues.map(i => `fixes ${i.url}`).join('\n')
    : `fixes ${state.issueUrl || (state.issueNumber ? `https://github.com/${state.repoSlug}/issues/${state.issueNumber}` : '')}`;

  const assistedBy = `Assisted-by: ${agentName()}`;

  const metadata = [
    `Project: ${state.project} (${state.repoSlug})`,
    `Fix summary: ${state.fixSummary}`,
    `Area: ${state.area}`,
    `Changed files: ${state.affectedFiles.join(', ')}`,
    `Tests passed: ${state.testsPassed}`,
    `Lint passed: ${state.lintPassed}`,
    `Issue references:\n${issueRefs}`,
    isDraft ? 'Draft PR — not all checks passed locally.' : '',
    isBatch
      ? `Batch CVE mode: ${batchIssues.length} issues\nCVE issues:\n${batchIssues.map(i => `- ${i.jiraKey ?? i.url.split('/').pop()}: ${i.title ?? '(CVE fix)'}`).join('\n')}`
      : '',
  ].filter(Boolean);

  try {
    const resp = await llmDeep.invoke([
      new HumanMessage(
        `${prContext ? `PROJECT PR CONVENTIONS AND SKILLS:\n${prContext}\n\n` : ''}You are writing a GitHub PR description for the ${state.project} project.

PR METADATA:
${metadata.join('\n')}

INSTRUCTIONS:
- Follow the project's PR template structure exactly (from the context-pr-template above).
- Use the pr-description skill for writing style (action verb lead, Root Cause + Fix for bugs, numbered bold list for multiple changes).
- Use the pr-test-section skill to write the test section — pick the template that matches the change type.
- Fill in issue references exactly as given above.
- End with a trailer line: ${assistedBy}
${isDraft ? '- Add a note: "> ⚠️ Draft — not all checks passed locally."' : ''}

Write the COMPLETE PR body. No markdown code fences around the output. Output ONLY the PR body content.`,
      ),
    ]);
    logTokenUsage('openPr', resp);
    const text = typeof resp.content === 'string' ? resp.content : JSON.stringify(resp.content);
    if (text.trim()) return text.trim();
  } catch {
    // Fall through to fallback
  }

  return `### What does this PR do?\n\n${state.fixSummary}\n\n### What issues does this PR fix or reference?\n\n${issueRefs}\n\n---\n${assistedBy}`;
}

async function git(cmd: string, cwd: string): Promise<string> {
  const env = { ...process.env, GH_TOKEN: process.env.GITHUB_TOKEN ?? '' };
  const { stdout, stderr } = await execAsync(cmd, { cwd, env, timeout: 60_000 });
  return (stdout + stderr).trim();
}

// ── Export-mode output (write files, no PR) ──────────────────────────────────

async function writeExportFiles(state: State, prBody: string): Promise<void> {
  const outDir = state.outputDir ?? 'output';
  const slug = state.repoSlug.replace('/', '-');
  const dir = join(outDir, slug);
  await mkdir(dir, { recursive: true });

  await writeFile(join(dir, 'pr-description.md'), prBody, 'utf8');

  if (state.repoLocal && state.branchName) {
    try {
      const defaultBranch = (await loadProjectConfig(state.project))?.default_branch ?? 'main';
      const { stdout } = await execAsync(
        `git -C ${JSON.stringify(state.repoLocal)} diff ${defaultBranch}...${state.branchName}`,
        { timeout: 30_000 },
      );
      if (stdout.trim()) {
        await writeFile(join(dir, 'changes.patch'), stdout, 'utf8');
      }
    } catch {
      /* ignore */
    }
  }

  console.log(`[export] Output written to: ${dir}`);
}

// ── Main node ────────────────────────────────────────────────────────────────

export async function openPrNode(state: State): Promise<Partial<State>> {
  const isDraft = !state.testsPassed || !state.lintPassed;

  // Check execution mode — 'export' writes files instead of opening a PR
  const executionMode = await getSetting('executionMode', 'pr');
  const prBody = await buildPrDescription(state, isDraft);

  const issueRef = state.jiraKey
    ? state.jiraKey
    : state.issueNumber
      ? `#${state.issueNumber}`
      : (state.issueUrl ?? '');

  const batchIssues = state.batchIssues ?? [];
  const batchRefs = batchIssues
    .map(i => i.jiraKey ?? i.url.split('/').pop() ?? '')
    .filter(Boolean)
    .join(', ');

  const prTitle = batchRefs
    ? `fix(deps): batch CVE fix — ${batchRefs} (${batchIssues.length} packages)`
    : `fix(${state.area}): ${state.fixSummary}`;

  const commitMsg = [
    prTitle,
    '',
    batchIssues.length > 0
      ? batchIssues.map(i => `Closes ${i.url}`).join('\n')
      : issueRef
        ? `Closes ${issueRef}`
        : '',
    '',
    `Assisted-by: ${agentName()}`,
  ]
    .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
    .join('\n');

  // ── Export mode: write files, no git/GitHub operations ────────────────────
  if (executionMode === 'export') {
    await writeExportFiles(state, prBody);
    return {
      messages: [
        `open_pr: export mode — PR description written to ${state.outputDir ?? 'output'}/`,
      ],
      prUrl: '',
      prNumber: null,
    };
  }

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
        let patch = '';
        try {
          const { stdout } = await execAsync(
            `git -C ${JSON.stringify(state.repoLocal)} diff main...${state.branchName}`,
            { timeout: 30_000 },
          );
          patch = stdout;
        } catch { /* branch may not exist yet */ }

        if (!patch.trim()) {
          try {
            const { stdout } = await execAsync(
              `git -C ${JSON.stringify(state.repoLocal)} diff HEAD`,
              { timeout: 30_000 },
            );
            patch = stdout;
          } catch { /* non-fatal */ }
        }

        if (patch.trim()) {
          patchPath = join(outDir, 'changes.patch');
          await writeFile(patchPath, patch, 'utf8');
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
        '**Affected files:**',
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
        patchPath ? `dry-run: Patch → ${patchPath}` : 'dry-run: No patch',
        `dry-run: Analysis → ${analysisPath}`,
      ],
      prUrl: `file://${outDir}`,
      prNumber: null,
    };
  }

  // ── Normal mode: commit → push → open PR via GitHub API ──────────────────
  const cwd = state.repoLocal;
  if (!cwd)
    return { messages: ['open_pr: repoLocal not set — cannot commit or push'], status: 'failed' };
  if (!state.branchName) return { messages: ['open_pr: branchName not set'], status: 'failed' };

  try {
    const msgFile = join(tmpdir(), `dwa-commit-${Date.now()}.txt`);
    await writeFile(msgFile, commitMsg, 'utf8');

    await git('git add -A', cwd);
    const commitOut = await git(`git commit -F ${JSON.stringify(msgFile)}`, cwd);
    console.log(`[open_pr] commit: ${commitOut.split('\n')[0]}`);

    const pushOut = await git(`git push -u origin ${state.branchName}`, cwd);
    console.log(`[open_pr] push: ${pushOut.split('\n').slice(-2).join(' ')}`);

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

    const prData = (await apiRes.json()) as { html_url: string; number: number };
    const prUrl = prData.html_url;
    const prNumber = prData.number;

    // Clean up local feature branch
    try {
      const projConfig = await loadProjectConfig(state.project);
      const defaultBranch = projConfig?.default_branch ?? 'main';
      await git(`git checkout ${defaultBranch}`, cwd);
      await git(`git branch -D ${state.branchName}`, cwd);
      console.log(`[open_pr] deleted local branch: ${state.branchName}`);
    } catch {
      /* Non-fatal */
    }

    return { prUrl, prNumber, messages: [`open_pr: ${prUrl}${isDraft ? ' [DRAFT]' : ''}`] };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { messages: [`open_pr: failed — ${msg}`], status: 'failed' };
  }
}
