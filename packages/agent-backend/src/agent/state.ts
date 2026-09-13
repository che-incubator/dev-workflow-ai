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

import { Annotation } from '@langchain/langgraph';

export interface Finding {
  file: string;
  line?: number;
  severity: 'blocking' | 'warning' | 'suggestion';
  finding: string;
  tier: string;
}

export const AgentState = Annotation.Root({
  // ── Session config ───────────────────────────────────────────────────────
  project: Annotation<string>({ reducer: (_, v) => v, default: () => '' }),
  repoSlug: Annotation<string>({ reducer: (_, v) => v, default: () => '' }),
  repoLocal: Annotation<string>({ reducer: (_, v) => v, default: () => '' }),

  // dryRun = true when GITHUB_TOKEN is absent:
  // skips push/PR creation, writes patch + PR description to outputDir instead
  dryRun: Annotation<boolean>({ reducer: (_, v) => v, default: () => false }),
  outputDir: Annotation<string>({ reducer: (_, v) => v, default: () => 'output' }),

  // ── Issue ────────────────────────────────────────────────────────────────
  issueNumber: Annotation<number | null>({ reducer: (_, v) => v, default: () => null }),
  issueTitle: Annotation<string>({ reducer: (_, v) => v, default: () => '' }),
  issueUrl: Annotation<string>({ reducer: (_, v) => v, default: () => '' }),
  issueBody: Annotation<string>({ reducer: (_, v) => v, default: () => '' }),
  issueLabels: Annotation<string[]>({ reducer: (_, v) => v, default: () => [] }),
  storyPoints: Annotation<number>({ reducer: (_, v) => v, default: () => 0 }),

  // ── Priority ─────────────────────────────────────────────────────────────
  priority: Annotation<string>({ reducer: (_, v) => v, default: () => '' }),
  prioritySource: Annotation<string>({ reducer: (_, v) => v, default: () => '' }),
  jiraKey: Annotation<string>({ reducer: (_, v) => v, default: () => '' }),
  forcePriority: Annotation<boolean>({ reducer: (_, v) => v, default: () => false }),

  // ── Analysis ─────────────────────────────────────────────────────────────
  affectedFiles: Annotation<string[]>({ reducer: (_, v) => v, default: () => [] }),
  fixSummary: Annotation<string>({ reducer: (_, v) => v, default: () => '' }),
  branchName: Annotation<string>({ reducer: (_, v) => v, default: () => '' }),
  area: Annotation<string>({ reducer: (_, v) => v, default: () => '' }),

  // ── Implementation ───────────────────────────────────────────────────────
  filesChanged: Annotation<string[]>({ reducer: (_, v) => v, default: () => [] }),
  testsPassed: Annotation<boolean>({ reducer: (_, v) => v, default: () => false }),
  lintPassed: Annotation<boolean>({ reducer: (_, v) => v, default: () => false }),
  retryCount: Annotation<number>({ reducer: (_, v) => v, default: () => 0 }),

  // ── PR ───────────────────────────────────────────────────────────────────
  prUrl: Annotation<string>({ reducer: (_, v) => v, default: () => '' }),
  prNumber: Annotation<number | null>({ reducer: (_, v) => v, default: () => null }),

  // ── Review ───────────────────────────────────────────────────────────────
  reviewFindings: Annotation<Finding[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  reviewVerdict: Annotation<'approve' | 'request-changes' | 'comment' | ''>({
    reducer: (_, v) => v,
    default: () => '',
  }),

  // ── CVE batch mode ────────────────────────────────────────────────────────
  isBatch: Annotation<boolean>({ reducer: (_, v) => v, default: () => false }),
  batchIssues: Annotation<Array<{ url: string; jiraKey?: string; title?: string }>>({
    reducer: (_, v) => v,
    default: () => [],
  }),

  // ── Flow control ─────────────────────────────────────────────────────────
  status: Annotation<'idle' | 'approved' | 'skipped' | 'failed' | 'done'>({
    reducer: (_, v) => v,
    default: () => 'idle',
  }),
  messages: Annotation<string[]>({
    reducer: (left, right) => left.concat(Array.isArray(right) ? right : [right]),
    default: () => [],
  }),
});

export type State = typeof AgentState.State;
