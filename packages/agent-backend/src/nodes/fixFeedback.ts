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
import { llmDeep as llm } from '../llm/client.js';
import { getAnthropicClient } from '../llm/anthropicClient.js';
import { nodeLog } from '../agent/runner.js';
import { loadProjectConfig } from '../context/loader.js';
import { State } from '../agent/state.js';

export async function fixFeedbackNode(state: State): Promise<Partial<State>> {
  const config = await loadProjectConfig(state.project);
  const stack = config?.stack ?? [];
  const isTypeScript = stack.some(s => s.toLowerCase().includes('typescript'));
  const isGo = stack.some(s => s.toLowerCase().includes('go'));

  const testCmd = isTypeScript
    ? 'yarn test --no-cache 2>&1 | tail -10'
    : isGo
      ? 'make test 2>&1 | tail -10'
      : 'echo done';
  const lintCmd = isTypeScript
    ? 'yarn lint:fix && yarn format:fix'
    : isGo
      ? 'make lint'
      : 'echo done';

  const findingsList = state.reviewFindings
    .filter(f => f.severity === 'blocking')
    .map(f => `- [${f.tier}] ${f.file}${f.line ? `:${f.line}` : ''}: ${f.finding}`)
    .join('\n');

  const prompt = `
You are fixing blocking review findings for PR #${state.prNumber} in ${state.repoSlug}.
Working directory: ${state.repoLocal || '.'}
SAFETY: Only modify source files in ${state.repoLocal || '.'}.

BLOCKING FINDINGS TO FIX:
${findingsList}

STEPS:
1. Apply all fixes to the affected files. Be precise — only fix what's listed.
2. cd ${state.repoLocal || '.'} && ${testCmd}
3. ${lintCmd} 2>&1 | tail -10
4. git add -A && git commit -m "fix: address review feedback" && git push

After completing, respond with JSON only:
{
  "filesChanged": ["<file1>"],
  "fixesApplied": <number>
}
`;

  // Fast path: direct Anthropic SDK
  const anthropic = await getAnthropicClient();
  const blockingCount = state.reviewFindings.filter(f => f.severity === 'blocking').length;
  nodeLog(`fix_feedback: fixing ${blockingCount} blocking finding(s)…`);
  let text: string;
  if (anthropic) {
    text = await anthropic.ask(
      'You are a code reviewer applying fixes. Respond only with valid JSON.',
      prompt,
    );
  } else {
    // Fallback: LangChain for non-Anthropic providers
    const response = await llm.invoke([new HumanMessage(prompt)]);
    if (typeof response.content === 'string') {
      text = response.content;
    } else if (Array.isArray(response.content)) {
      text = response.content
        .map((p: unknown) => (typeof p === 'string' ? p : ((p as { text?: string }).text ?? '')))
        .join('');
    } else {
      text = JSON.stringify(response.content);
    }
  }
  // Strip markdown code fences
  text = text.replace(/```(?:json)?\s*/m, '').replace(/```\s*$/m, '');
  const jsonMatch = text.match(/\{[\s\S]+\}/);

  let filesChanged: string[] = [];
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as { filesChanged?: string[]; fixesApplied?: number };
      filesChanged = parsed.filesChanged ?? [];
    } catch {
      /* ignore */
    }
  }

  return {
    // reviewFindings uses concat reducer so [] is a no-op; routing uses reviewVerdict (replace reducer)
    reviewVerdict: '', // reset so routeAfterReview re-evaluates after next review
    filesChanged,
    retryCount: (state.retryCount ?? 0) + 1,
    messages: [
      `fix_feedback: applied ${state.reviewFindings.filter(f => f.severity === 'blocking').length} blocking fixes`,
    ],
  };
}
