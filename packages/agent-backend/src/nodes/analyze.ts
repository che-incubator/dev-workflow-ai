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

import { HumanMessage } from '@langchain/core/messages';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { llmDeep as llm, logTokenUsage } from '../llm/client.js';
import { getAnthropicClient } from '../llm/anthropicClient.js';
import { nodeLog } from '../agent/runner.js';
import { loadContext } from '../context/loader.js';
import { State } from '../agent/state.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

/** Pre-fetch the issue body from GitHub so the LLM gets complete data upfront.
 *  This avoids tool-call loops when models (Gemini) try to call gh_issue_view themselves. */
async function fetchIssueBody(repoSlug: string, issueNumber: number): Promise<string> {
  try {
    const { stdout } = await execAsync(
      `gh issue view ${issueNumber} --repo ${repoSlug} --json body,title,labels,comments --jq '"Title: " + .title + "\\n\\nBody:\\n" + (.body // "") + "\\n\\nLabels: " + ([.labels[].name] | join(", "))'`,
      { env: { ...process.env }, timeout: 15_000 },
    );
    return stdout.trim();
  } catch {
    return '';
  }
}

/** Build an LLM without tools bound for pure JSON-response tasks.
 *  This prevents models from trying to call tools when we just need structured output. */
function buildPureLLM() {
  if (process.env.GEMINI_API_KEY) {
    return new ChatGoogleGenerativeAI({
      model: process.env.GEMINI_MODEL ?? 'gemini-3.6-flash',
      apiKey: process.env.GEMINI_API_KEY,
      maxOutputTokens: 4096,
      temperature: 0.1,
    });
  }
  // For Ollama/Claude, the tools-bound llm works fine since they follow
  // the "respond with JSON" instruction without trying to call tools
  return llm;
}

export async function analyzeNode(state: State): Promise<Partial<State>> {
  const context = await loadContext(state.project, [
    'context', // project description, stack, local_path
    'rules-issue-analysis', // shared: how to identify affected files and scope
    'rules-issue-filtering', // shared: scoring rules, priority boosts, CVE handling
    'rules-issue-description-quality', // shared: min description quality, CVE signals, red flags
    'rules-cve-batch', // shared: CVE batch rules and priority
    'skills-analyze-issue', // project-specific analyze skill (if present)
  ]);

  // Fetch issue data — try DB first (works for Jira + GitHub), then GitHub API
  let issueTitle = state.issueTitle ?? '';
  let issueBody = state.issueBody ?? '';

  if ((!issueTitle || !issueBody) && (state.jiraKey || state.issueUrl)) {
    try {
      const { db } = await import('../db/client.js');
      const { rows } = await db.query<{ title: string; body: string }>(
        `SELECT title, body FROM issues WHERE url = $1 OR external_id = $2 LIMIT 1`,
        [state.issueUrl ?? '', state.jiraKey ?? ''],
      );
      if (rows[0]) {
        issueTitle = issueTitle || rows[0].title;
        issueBody = issueBody || rows[0].body;
      }
    } catch {
      /* ignore */
    }
  }
  if (!issueBody && state.issueNumber) {
    issueBody = await fetchIssueBody(state.repoSlug, state.issueNumber);
  }

  const issueRef = state.jiraKey
    ? `Jira issue ${state.jiraKey}`
    : state.issueNumber
      ? `GitHub issue #${state.issueNumber} in ${state.repoSlug}`
      : state.issueUrl || 'unspecified issue';

  const prompt = `
You are analyzing ${issueRef} to plan a code fix.

PROJECT CONTEXT (use this to identify affected files — do NOT call any tools):
${context}

ISSUE TITLE: ${issueTitle || '(see URL)'}
ISSUE URL: ${state.issueUrl || state.jiraKey || ''}
ISSUE BODY:
${issueBody || '(body not available — use issue title and URL for context)'}

Based on the issue title, body, and project context above:
1. Identify the affected area: "frontend" | "backend" | "common" | "operator" | "docs" | "ci"
2. List the specific files that need changing (use context above, not tool calls)
3. Write a one-sentence fix summary
4. Estimate story points: 1 (trivial), 2 (small), 3 (medium), 5 (large), 8 (complex)
5. Propose branch name: ${state.jiraKey ?? `issue-${state.issueNumber ?? 'N'}`}-<2-4-word-slug>

Respond with ONLY valid JSON, no markdown fences, no explanation:
{
  "area": "<area>",
  "affectedFiles": ["<path1>", "<path2>"],
  "fixSummary": "<one sentence>",
  "storyPoints": <number>,
  "branchName": "issue-${state.issueNumber ?? 'N'}-<slug>"
}
`;

  // Fast path: direct Anthropic SDK (no LangChain overhead)
  const anthropic = await getAnthropicClient();
  let text: string;
  if (anthropic) {
    nodeLog(`analyze: calling ${anthropic.model} via direct SDK…`);
    text = await anthropic.ask(
      'You are a code analysis assistant. Respond only with valid JSON, no markdown.',
      prompt,
    );
  } else {
    // Fallback: LangChain (Gemini / Ollama / other providers)
    const pureLlm = buildPureLLM();
    const response = await pureLlm.invoke([new HumanMessage(prompt)]);
    logTokenUsage('analyze', response);
    if (typeof response.content === 'string') {
      text = response.content;
    } else if (Array.isArray(response.content)) {
      text = response.content
        .map(p => (typeof p === 'string' ? p : ((p as { text?: string }).text ?? '')))
        .join('');
    } else {
      text = JSON.stringify(response.content);
    }
  }

  // Strip markdown code fences (```json ... ```) that some models add
  const stripped = text.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '');
  const jsonMatch = stripped.match(/\{[\s\S]+\}/);

  if (!jsonMatch) {
    return {
      messages: ['analyze: could not parse LLM JSON response'],
      status: 'failed',
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      area: string;
      affectedFiles: string[];
      fixSummary: string;
      storyPoints: number;
      branchName: string;
    };

    // In dry-run mode: write analysis.md immediately so the result is visible
    // even if implement/openPr nodes don't run (no local clone available)
    if (state.dryRun && state.outputDir) {
      const slug = `${state.repoSlug.replace('/', '-')}-${state.issueNumber ?? 'unknown'}`;
      const outDir = resolve(state.outputDir, slug);
      await mkdir(outDir, { recursive: true });

      const patchNote = state.repoLocal
        ? `\`\`\`bash\ngit diff main...${parsed.branchName}\n\`\`\``
        : `**No local clone** — set \`local_path\` in \`pg_seed/eclipse-che/subprojects/${state.project}/context.md\` to get a real diff.\n\n\`\`\`yaml\nlocal_path: /path/to/${state.repoSlug.split('/')[1]}\n\`\`\``;

      const analysisContent = `# Issue Analysis

**Issue:** ${state.issueUrl || `#${state.issueNumber} in ${state.repoSlug}`}
**Project:** ${state.project}
**LLM:** ${process.env.ANTHROPIC_VERTEX_PROJECT_ID ? 'Claude (Vertex AI)' : process.env.GEMINI_API_KEY ? 'Gemini ' + (process.env.GEMINI_MODEL ?? 'gemini-3.6-flash') : process.env.ANTHROPIC_API_KEY ? 'Claude' : 'Ollama ' + (process.env.OLLAMA_MODEL ?? '')}

## Analysis result

- **Area:** ${parsed.area}
- **Story points:** ${parsed.storyPoints}
- **Fix summary:** ${parsed.fixSummary}
- **Suggested branch:** \`${parsed.branchName}\`

## Affected files

${(parsed.affectedFiles ?? []).map(f => `- \`${f}\``).join('\n')}

## To get a real code patch

${patchNote}
`;
      await writeFile(join(outDir, 'analysis.md'), analysisContent, 'utf8');

      // Write a real PR description from the analysis (not the stub placeholder)
      const agentName = process.env.ANTHROPIC_VERTEX_PROJECT_ID
        ? `Claude Sonnet 4.6 (Vertex AI)`
        : process.env.GEMINI_API_KEY
          ? `Gemini ${process.env.GEMINI_MODEL ?? 'gemini-3.6-flash'}`
          : process.env.ANTHROPIC_API_KEY
            ? 'Claude Sonnet 4.6'
            : `Ollama ${process.env.OLLAMA_MODEL ?? ''}`;

      const prContent = `# fix(${parsed.area}): ${parsed.fixSummary}

## Summary

${parsed.fixSummary}

## Changes

${(parsed.affectedFiles ?? []).map(f => `- \`${f}\``).join('\n') || '- See analysis.md for affected area'}

## Issue

Closes ${state.issueUrl || `#${state.issueNumber}`}

## Test plan

- [ ] Unit tests pass
- [ ] Lint and format clean
- [ ] Manual verification: ${parsed.fixSummary.toLowerCase()}

---
*Branch: \`${parsed.branchName}\`*
*To implement: set \`local_path\` in context.md and re-run with a real LLM*
*LLM used: ${agentName}*
`;
      await writeFile(join(outDir, 'pr-description.md'), prContent, 'utf8');
    }

    return {
      area: parsed.area,
      affectedFiles: parsed.affectedFiles ?? [],
      fixSummary: parsed.fixSummary,
      storyPoints: parsed.storyPoints,
      branchName: parsed.branchName,
      messages: [
        `analyze: ${parsed.area} — ${parsed.affectedFiles.length} files — "${parsed.fixSummary}" (${parsed.storyPoints} SP)`,
      ],
    };
  } catch {
    return { messages: ['analyze: JSON parse error'], status: 'failed' };
  }
}
