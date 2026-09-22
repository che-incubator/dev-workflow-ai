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
 * runner — plain async loop replacing the LangGraph StateGraph.
 *
 * Eliminates:
 *   - LangGraph StateGraph compilation (~500ms cold start)
 *   - Checkpoint serialization on every node transition
 *   - LangChain message conversion overhead (~50–200ms per LLM call)
 *
 * The runner calls the existing node functions directly. Node functions
 * are not changed — they still take State and return Partial<State>.
 * The State type is reused from state.ts (LangGraph Annotation type is
 * just a TypeScript interface — no runtime dependency needed here).
 */

import type { State } from './state.js';

export type AgentEvent =
  | { type: 'log'; node: string; message: string }
  | { type: 'node_start'; node: string }
  | { type: 'node_complete'; node: string; status: string }
  | { type: 'run_complete'; prUrl?: string }
  | { type: 'run_failed'; error: string }
  | { type: 'run_skipped'; reason: string };

export type EmitFn = (event: AgentEvent) => void | Promise<void>;

// ── Real-time node logger ──────────────────────────────────────────────────
// Nodes can call nodeLog(message) at any point during execution for
// real-time progress without changing their function signature.
// The runner sets _currentEmit and _currentNode before each step call.

let _currentEmit: EmitFn | null = null;
let _currentNode = 'agent';

/**
 * Emit a log message from inside a node during execution.
 * Nodes import and call this for verbose mid-step progress.
 */
export function nodeLog(message: string): void {
  _currentEmit?.({ type: 'log', node: _currentNode, message });
}

function isDepUpgrade(state: State): boolean {
  const summary = state.messages.find(m => m.startsWith('analyze:')) ?? '';
  return (
    /upgrad\w+\s+\w[\w./]*(?:\s+(?:in|dependency|dep)\s+\S+)?\s+to\s+(?:version\s+)?[\d]/i.test(
      summary,
    ) ||
    /bump\s+\S+\s+to/i.test(summary) ||
    /vulnerabilit\w+/i.test(summary) ||
    (/(?:CVE|security)/i.test(summary) && /(?:version|upgrad)/i.test(summary))
  );
}

/** Apply a partial update with concat reducers matching LangGraph behaviour. */
function apply(state: State, patch: Partial<State>): State {
  const next = { ...state, ...patch };
  if (patch.messages) next.messages = [...state.messages, ...patch.messages];
  if (patch.reviewFindings)
    next.reviewFindings = [...state.reviewFindings, ...patch.reviewFindings];
  return next;
}

/** Run a node, emit events with timing, return updated state. */
async function step(
  name: string,
  state: State,
  nodeFn: (s: State) => Promise<Partial<State>>,
  emit: EmitFn,
): Promise<State> {
  _currentEmit = emit;
  _currentNode = name;

  const t0 = Date.now();
  emit({ type: 'node_start', node: name });
  emit({ type: 'log', node: name, message: `${name}: starting…` });

  const patch = await nodeFn(state);
  const next = apply(state, patch);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  for (const msg of patch.messages ?? []) {
    emit({ type: 'log', node: name, message: msg });
  }
  emit({ type: 'log', node: name, message: `${name}: done in ${elapsed}s` });
  emit({ type: 'node_complete', node: name, status: next.status ?? '' });

  _currentEmit = null;
  return next;
}

const MAX_FIX_ROUNDS = 3;

/**
 * Run the full agent pipeline without LangGraph.
 *
 * @param initialState  Pre-filled state (project, repoSlug, issueNumber, …)
 * @param emit          Event callback — wired to WebSocket/DB in runs.ts
 * @param signal        AbortSignal for cancellation support
 */
export async function runAgent(
  initialState: Partial<State>,
  emit: EmitFn,
  signal?: AbortSignal,
): Promise<State> {
  // Lazy import nodes so this module loads fast
  const { pickIssueNode } = await import('../nodes/pickIssue.js');
  const { analyzeNode } = await import('../nodes/analyze.js');
  const { priorityCheckNode } = await import('../nodes/priorityCheck.js');
  const { implementNode } = await import('../nodes/implement.js');
  const { implementDepUpgradeNode } = await import('../nodes/implementDepUpgrade.js');
  const { reviewNode } = await import('../nodes/review.js');
  const { fixFeedbackNode } = await import('../nodes/fixFeedback.js');
  const { openPrNode } = await import('../nodes/openPr.js');

  // Build initial state with defaults matching LangGraph Annotation defaults
  let state: State = {
    project: '',
    repoSlug: '',
    repoLocal: '',
    dryRun: false,
    outputDir: 'output',
    issueNumber: null,
    issueTitle: '',
    issueUrl: '',
    issueBody: '',
    issueLabels: [],
    storyPoints: 0,
    priority: '',
    prioritySource: '',
    jiraKey: '',
    forcePriority: false,
    affectedFiles: [],
    fixSummary: '',
    branchName: '',
    area: '',
    filesChanged: [],
    testsPassed: false,
    lintPassed: false,
    retryCount: 0,
    prUrl: '',
    prNumber: null,
    reviewFindings: [],
    reviewVerdict: '',
    isBatch: false,
    batchIssues: [],
    status: 'idle',
    messages: [],
    ...initialState,
  };

  const aborted = () => signal?.aborted ?? false;

  try {
    // ── Phase 0: pick issue (only when no issue specified) ─────────────────
    emit({ type: 'log', node: 'runner', message: 'pipeline: starting agent run' });
    const hasIssue = state.issueNumber !== null || !!state.issueUrl || !!state.jiraKey;
    if (!hasIssue) {
      state = await step('pick_issue', state, pickIssueNode, emit);
      if (aborted()) return state;
      if (!state.issueNumber && !state.jiraKey && !state.issueUrl) {
        emit({ type: 'run_skipped', reason: 'No open issue found to work on' });
        return state;
      }
    }

    // ── Phase 1: analyze ──────────────────────────────────────────────────
    emit({ type: 'log', node: 'runner', message: 'pipeline: phase 1 — analyze issue' });
    state = await step('analyze', state, analyzeNode, emit);
    if (aborted()) return state;

    const hasIssueAfterAnalyze = state.issueNumber !== null || !!state.jiraKey || !!state.issueUrl;
    if (!hasIssueAfterAnalyze || state.storyPoints > 8) {
      emit({
        type: 'run_skipped',
        reason: `Story points too high (${state.storyPoints}) or no issue`,
      });
      return state;
    }

    // ── Phase 2: priority check (autonomous mode only) ────────────────────
    emit({ type: 'log', node: 'runner', message: 'pipeline: phase 2 — priority check' });
    const skipPriority = state.issueUrl || state.jiraKey || state.forcePriority;
    if (!skipPriority) {
      state = await step('priority_check', state, priorityCheckNode, emit);
      if (aborted()) return state;
      if (state.status !== 'approved') {
        emit({ type: 'run_skipped', reason: `Priority check: ${state.status}` });
        return state;
      }
    }

    // ── Phase 3: implement (with retry) ───────────────────────────────────
    emit({ type: 'log', node: 'runner', message: 'pipeline: phase 3 — implement' });
    const implementFn = isDepUpgrade(state) ? implementDepUpgradeNode : implementNode;
    const implNodeName = isDepUpgrade(state) ? 'implement_dep_upgrade' : 'implement';

    for (let attempt = 0; attempt < 3; attempt++) {
      state = await step(implNodeName, state, implementFn, emit);
      if (aborted()) return state;
      if (state.testsPassed && state.lintPassed) break;
      if (state.retryCount >= 3) break;
    }

    // ── Phase 4: review + fix loop (skipped for dep upgrades) ────────────────
    emit({ type: 'log', node: 'runner', message: 'pipeline: phase 4 — review + fix loop' });
    if (isDepUpgrade(state)) {
      emit({
        type: 'log',
        node: 'review',
        message: 'review: skipped — dep upgrade only, no code logic to review',
      });
    } else {
      for (let round = 0; round < MAX_FIX_ROUNDS; round++) {
        state = await step('review', state, reviewNode, emit);
        if (aborted()) return state;

        if (state.reviewVerdict === 'approve') break;
        if (round >= MAX_FIX_ROUNDS - 1) {
          emit({
            type: 'log',
            node: 'review',
            message: 'Max fix rounds reached — opening PR anyway',
          });
          break;
        }

        state = await step('fix_feedback', state, fixFeedbackNode, emit);
        if (aborted()) return state;
      }
    }

    // ── Phase 5: open PR ──────────────────────────────────────────────────
    emit({ type: 'log', node: 'runner', message: 'pipeline: phase 5 — open PR' });
    state = await step('open_pr', state, openPrNode, emit);
    emit({ type: 'run_complete', prUrl: state.prUrl });
    return state;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emit({ type: 'run_failed', error: msg });
    return { ...state, status: 'failed', messages: [...state.messages, `error: ${msg}`] };
  }
}
