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
 * RunState — plain TypeScript interface replacing LangGraph Annotation.Root.
 *
 * Fields mirror the LangGraph State exactly so node functions can be ported
 * incrementally. No reducers, no serialisation overhead — just a plain object
 * passed through the runner phases.
 */

export interface Finding {
  file: string;
  line?: number;
  severity: 'blocking' | 'warning' | 'suggestion';
  finding: string;
  tier: string;
}

export interface RunState {
  // ── Session config ───────────────────────────────────────────────────────
  project: string;
  repoSlug: string;
  repoLocal: string;
  dryRun: boolean;
  outputDir: string;

  // ── Issue ────────────────────────────────────────────────────────────────
  issueNumber: number | null;
  issueTitle: string;
  issueUrl: string;
  issueBody: string;
  issueLabels: string[];
  storyPoints: number;

  // ── Priority ─────────────────────────────────────────────────────────────
  priority: string;
  prioritySource: string;
  jiraKey: string;
  forcePriority: boolean;

  // ── Analysis ─────────────────────────────────────────────────────────────
  affectedFiles: string[];
  fixSummary: string;
  branchName: string;
  area: string;

  // ── Implementation ───────────────────────────────────────────────────────
  filesChanged: string[];
  testsPassed: boolean;
  lintPassed: boolean;
  retryCount: number;

  // ── PR ───────────────────────────────────────────────────────────────────
  prUrl: string;
  prNumber: number | null;

  // ── Review ───────────────────────────────────────────────────────────────
  reviewFindings: Finding[];
  reviewVerdict: 'approve' | 'request-changes' | 'comment' | '';

  // ── CVE batch mode ────────────────────────────────────────────────────────
  isBatch: boolean;
  batchIssues: Array<{ url: string; jiraKey?: string; title?: string }>;

  // ── Flow control ─────────────────────────────────────────────────────────
  status: 'idle' | 'approved' | 'skipped' | 'failed' | 'done';
  messages: string[];
}

export function defaultRunState(overrides: Partial<RunState> = {}): RunState {
  return {
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
    ...overrides,
  };
}

/** Apply a partial update — matches the LangGraph reducer behaviour (replace, concat messages). */
export function applyPatch(state: RunState, patch: Partial<RunState>): RunState {
  const next = { ...state, ...patch };
  // messages uses concat reducer in LangGraph — preserve that behaviour
  if (patch.messages) {
    next.messages = [...state.messages, ...patch.messages];
  }
  // reviewFindings uses concat reducer
  if (patch.reviewFindings) {
    next.reviewFindings = [...state.reviewFindings, ...patch.reviewFindings];
  }
  return next;
}
