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
 * review node — 5 parallel specialized reviewers with confidence filtering.
 *
 * Reviewer prompts sourced from claude-code/plugins/pr-review-toolkit/:
 *   1. code-reviewer.md      → Correctness (bugs, security, logic errors)
 *   2. silent-failure-hunter → Error handling (swallowed errors, empty catch)
 *   3. pr-test-analyzer.md   → Test coverage (critical gaps, behavioral tests)
 *   4. type-design-analyzer  → TypeScript types (TS projects only)
 *   5. Conventions           → Project rules (CLAUDE.md, copyright, no-any)
 *
 * All run simultaneously (code-review plugin pattern).
 * Each scores findings 0-100; filter below CONFIDENCE_THRESHOLD (75).
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { HumanMessage } from '@langchain/core/messages';
import { llmDeep as llm, logTokenUsage } from '../llm/client.js';
import { getAnthropicClient } from '../llm/anthropicClient.js';
import { nodeLog } from '../agent/runner.js';
import { loadContext, loadProjectConfig } from '../context/loader.js';
import { State, Finding } from '../agent/state.js';

const execAsync = promisify(exec);

const CONFIDENCE_THRESHOLD = 75;

function extractJson(text: string): string | null {
  const cleaned = text.replace(/```(?:json)?\s*/gm, '').replace(/```\s*$/gm, '');
  const m = cleaned.match(/\{[\s\S]+\}/);
  return m?.[0] ?? null;
}

const JSON_SCHEMA = `
Respond with JSON only — no markdown fences:
{
  "findings": [
    {
      "file": "<path>",
      "line": <number or null>,
      "severity": "blocking|warning|suggestion",
      "finding": "<concise description>",
      "tier": "<reviewer-name>",
      "confidence": <0-100>
    }
  ]
}
confidence: 90+ = certain, 75-89 = likely, <75 = uncertain (will be filtered out).
Only report issues with confidence ≥ 75.`;

// Cached per-request: avoids N DB queries for N parallel reviewers
let _reviewerAnthropicClient: Awaited<ReturnType<typeof getAnthropicClient>> | undefined;

async function runReviewer(
  name: string,
  prompt: string,
): Promise<Array<Finding & { confidence: number }>> {
  nodeLog(`review: [${name}] starting…`);
  try {
    let text: string;

    // Fast path: direct Anthropic SDK (no LangChain overhead, works with parallel calls)
    if (_reviewerAnthropicClient === undefined) {
      _reviewerAnthropicClient = await getAnthropicClient();
    }
    if (_reviewerAnthropicClient) {
      text = await _reviewerAnthropicClient.ask(
        'You are a code reviewer. Respond only with valid JSON, no markdown fences.',
        prompt,
      );
    } else {
      // Fallback: LangChain for non-Anthropic providers
      const response = await llm.invoke([new HumanMessage(prompt)]);
      logTokenUsage(`review:${name}`, response);
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

    const jsonStr = extractJson(text);
    if (!jsonStr) {
      nodeLog(`review: [${name}] no JSON in response`);
      return [];
    }
    const parsed = JSON.parse(jsonStr) as { findings: Array<Finding & { confidence: number }> };
    const findings = parsed.findings ?? [];
    nodeLog(`review: [${name}] ${findings.length} finding(s)`);
    return findings;
  } catch (e) {
    nodeLog(`review: [${name}] error — ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}

export async function reviewNode(state: State): Promise<Partial<State>> {
  const rulesContext = await loadContext(state.project, ['rules-dev', 'skills-review-pr']);
  const config = await loadProjectConfig(state.project);
  const rawPath = config?.local_path ?? state.repoLocal ?? '';
  const repoRoot = rawPath.startsWith('/') ? rawPath : resolve(process.cwd(), rawPath);

  const stack = (config?.stack ?? []).map(s => s.toLowerCase());
  const isTS = stack.some(s => s.includes('typescript') || s.includes('react'));
  const isGo = stack.some(s => s.includes('go'));

  // Get diff from local branch (review before opening PR)
  let diffText = '';
  if (state.branchName && repoRoot) {
    try {
      // Try against origin/main first, fall back to main
      const base = 'origin/main';
      const { stdout } = await execAsync(
        `git -C ${JSON.stringify(repoRoot)} diff ${base}...${state.branchName}`,
        { timeout: 30_000 },
      );
      diffText = stdout.trim();
    } catch {
      // Try without origin/ prefix
      try {
        const { stdout } = await execAsync(
          `git -C ${JSON.stringify(repoRoot)} diff main...${state.branchName}`,
          { timeout: 30_000 },
        );
        diffText = stdout.trim();
      } catch {
        /* no diff available */
      }
    }
  }

  if (!diffText) {
    // Fall back to affected files list if no diff available
    const files = state.affectedFiles.join(', ') || '(unknown)';
    diffText = `No diff available. Affected files: ${files}\nFix summary: ${state.fixSummary}`;
  }

  const MAX_DIFF = 30_000; // ~30k chars is enough for most diffs
  const truncated = diffText.length > MAX_DIFF;
  const diffSnippet = truncated ? diffText.slice(0, MAX_DIFF) + '\n... (truncated)' : diffText;

  const diffHeader = `
Branch: ${state.branchName ?? 'unknown'} in ${state.repoSlug ?? state.project}
Fix: ${state.fixSummary ?? ''}
SAFETY: Read only — do NOT modify any files.

--- DIFF ---
${diffSnippet}
--- END DIFF ---
`.trim();

  // ── Reviewer 1: Correctness ──────────────────────────────────────────────
  // Adapted from claude-code/plugins/pr-review-toolkit/agents/code-reviewer.md
  const correctnessPrompt = `
You are an expert code reviewer. ${diffHeader}

Focus: bugs, logic errors, security vulnerabilities, null/undefined handling.
Rate each issue 0-100 confidence. Only report ≥75.

Checks:
${
  isTS
    ? `- Unhandled promise rejections (missing await/catch) → confidence 90
- Type assertions bypassing null checks ("as Type" without guard) → 85
- SQL/HTML injection via string concatenation → 95
- API routes without input validation → 85`
    : ''
}
${
  isGo
    ? `- Unchecked error returns ("_ =") → 95
- Goroutines without cancellation → 85
- Unchecked type assertions → 85`
    : ''
}
- Hardcoded credentials or secrets → 95
- Missing auth checks on new endpoints → 90
- Race conditions in concurrent code → 85
- Logic errors that invert conditions or use wrong operators → 85

${JSON_SCHEMA}`;

  // ── Reviewer 2: Silent Failure Hunter ────────────────────────────────────
  // Adapted from claude-code/plugins/pr-review-toolkit/agents/silent-failure-hunter.md
  const silentFailurePrompt = `
You are an elite error handling auditor with zero tolerance for silent failures. ${diffHeader}

Your mission: find every place where errors are suppressed, swallowed, or inadequately handled.

Check each try-catch and error handler:
- Empty catch blocks → confidence 95, BLOCKING
- Catch block that only logs and continues without user feedback → 80, warning
- Returning null/undefined/default on error without logging → 85, blocking
- Broad catch (catches Exception/Error base type when a specific subtype is expected) → 80
- Fallback to mock or stub outside test code → 90, blocking
- Optional chaining (?.) silently skipping operations that should fail loudly → 75
- Retry logic that exhausts without informing the user → 80
- Error swallowed with ".catch(() => {})" (empty arrow) → 90, blocking

For each finding: describe what types of errors could be hidden and the debugging impact.

${JSON_SCHEMA}`;

  // ── Reviewer 3: Test Coverage ────────────────────────────────────────────
  // Adapted from claude-code/plugins/pr-review-toolkit/agents/pr-test-analyzer.md
  const testCoveragePrompt = `
You are an expert test coverage analyst. ${diffHeader}

Focus on BEHAVIORAL coverage (not line coverage). Identify critical gaps only.

Check:
- New business logic functions without any test → confidence 85, warning
- Error paths in new code with no error-case test → 80, warning
- Async/concurrent behavior without tests → 85, warning
- Validation logic without negative (rejection) test cases → 80
- New API endpoint without integration or unit test → 90, warning
- Tests that couple tightly to implementation (brittle tests) → 75, suggestion

Skip: trivial getters/setters, one-line wrappers, generated code.
Only flag gaps where a real bug would go undetected.

${JSON_SCHEMA}`;

  // ── Reviewer 4: Conventions (project-specific) ────────────────────────────
  const conventionsPrompt = `
You are a conventions reviewer. ${diffHeader}

PROJECT RULES:
${rulesContext}

Check ONLY rule violations:
${
  isTS
    ? `- Missing EPL-2.0 copyright header in new .ts/.tsx files → confidence 90, BLOCKING
- \`any\` type usage (": any", "as any", "<any>") → 95, BLOCKING
- Relative imports ("from './" or "from '../") → 90, BLOCKING
- PatternFly deep imports (@patternfly/*/dist/...) → 85, BLOCKING
- No test file for new component or utility → 80, warning`
    : ''
}
${
  isGo
    ? `- Error returned but not checked at call site → 90, BLOCKING
- Context not propagated to I/O function → 85, BLOCKING`
    : ''
}
- Forbidden patterns from project rules above → match their severity

${JSON_SCHEMA}`;

  // ── Reviewer 5: TypeScript Type Design (TS projects only) ────────────────
  // Adapted from claude-code/plugins/pr-review-toolkit/agents/type-design-analyzer.md
  const typeDesignPrompt = isTS
    ? `
You are a TypeScript type design expert. ${diffHeader}

Analyze new and modified types/interfaces for design quality.
Rate each issue 0-100 confidence. Only report ≥75.

Check:
- Type that uses \`any\` or overly broad union preventing compile-time safety → 90, BLOCKING
- Interface with optional fields that should be required (weakens invariants) → 80, warning
- Mutable type where ReadOnly would prevent accidental mutation → 75, suggestion
- Type alias that could be a branded type to prevent primitive obsession → 75, suggestion
- Missing discriminant on union type (hard to narrow) → 80, warning
- Type that allows invalid states to be represented → 85, warning

${JSON_SCHEMA}`
    : null;

  // ── Run all reviewers in parallel ─────────────────────────────────────────
  const diffLines = diffText.split('\n').length;
  nodeLog(`review: diff is ${diffLines} lines — launching ${isTS ? 5 : 4} parallel reviewers…`);
  const reviewerPromises = [
    runReviewer('correctness', correctnessPrompt),
    runReviewer('silent-failures', silentFailurePrompt),
    runReviewer('test-coverage', testCoveragePrompt),
    runReviewer('conventions', conventionsPrompt),
    ...(typeDesignPrompt ? [runReviewer('type-design', typeDesignPrompt)] : []),
  ];

  const allResults = await Promise.all(reviewerPromises);
  const all = allResults.flat();

  // Filter by confidence threshold
  const filtered = all.filter(f => (f.confidence ?? 100) >= CONFIDENCE_THRESHOLD);
  const blocking = filtered.filter(f => f.severity === 'blocking').length;
  const filteredOut = all.length - filtered.length;

  const verdict = blocking > 0 ? 'request-changes' : filtered.length > 0 ? 'comment' : 'approve';

  return {
    reviewFindings: filtered,
    reviewVerdict: verdict,
    messages: [
      `review: ${reviewerPromises.length} parallel reviewers — ${all.length} raw → ${filtered.length} kept (${filteredOut} filtered <${CONFIDENCE_THRESHOLD}% confidence), ${blocking} blocking → ${verdict}`,
    ],
  };
}
