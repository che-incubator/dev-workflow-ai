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

import { StateGraph, START, END, MemorySaver } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { AgentState, State } from './state.js';
import { pickIssueNode } from '../nodes/pickIssue.js';
import { analyzeNode } from '../nodes/analyze.js';
import { priorityCheckNode } from '../nodes/priorityCheck.js';
import { implementNode } from '../nodes/implement.js';
import { implementDepUpgradeNode } from '../nodes/implementDepUpgrade.js';
import { openPrNode } from '../nodes/openPr.js';
import { reviewNode } from '../nodes/review.js';
import { fixFeedbackNode } from '../nodes/fixFeedback.js';

// ── Conditional routers ─────────────────────────────────────────────────────

function routeFromStart(state: State): 'pick_issue' | 'analyze' {
  // Skip pick_issue when issue is pre-specified (GitHub number OR Jira URL/key)
  if (state.issueNumber !== null) return 'analyze';
  if (state.issueUrl || state.jiraKey) return 'analyze';
  return 'pick_issue';
}

function routeAfterAnalysis(state: State): 'priority_check' | 'implement' | 'implement_dep_upgrade' | typeof END {
  const hasIssue = state.issueNumber !== null || !!state.jiraKey || !!state.issueUrl;
  if (!hasIssue) return END;
  if (state.storyPoints > 8) return END; // over hard limit

  // priority_check is for autonomous issue picks only.
  // When a specific issue was requested (Force run from UI), go straight to implement.
  if (state.issueUrl || state.jiraKey || state.forcePriority) {
    return isDepUpgrade(state) ? 'implement_dep_upgrade' : 'implement';
  }
  return 'priority_check';
}

function isDepUpgrade(state: State): boolean {
  const summary = state.messages.find(m => m.startsWith('analyze:')) ?? '';
  // "Upgrade X to N.N.N" / "Upgrade X in Y to version N" / bump / CVE + version / vulnerability
  return /upgrad\w+\s+\w[\w./]*(?:\s+(?:in|dependency|dep)\s+\S+)?\s+to\s+(?:version\s+)?[\d]/i.test(summary)
    || /bump\s+\S+\s+to/i.test(summary)
    || /vulnerabilit\w+/i.test(summary)
    || (/(?:CVE|security)/i.test(summary) && /(?:version|upgrad)/i.test(summary));
}

function routeAfterPriority(state: State): 'implement' | 'implement_dep_upgrade' | typeof END {
  if (state.status !== 'approved') return END;
  return isDepUpgrade(state) ? 'implement_dep_upgrade' : 'implement';
}

function routeAfterImplement(state: State): 'implement' | 'review' | typeof END {
  if (state.testsPassed && state.lintPassed) return 'review';
  if (state.retryCount >= 3) return END; // give up after 3 retries
  return 'implement';
}

const MAX_FIX_ROUNDS = 3;

function routeAfterReview(state: State): 'fix_feedback' | 'open_pr' | typeof END {
  // reviewVerdict uses a REPLACE reducer (not concat) — it always reflects
  // the LATEST review result. reviewFindings accumulates across rounds so
  // cannot be used for routing without false positives from prior rounds.
  if (state.reviewVerdict === 'approve') return 'open_pr';

  // Still blocking — but cap fix rounds to avoid infinite loops
  if (state.retryCount >= MAX_FIX_ROUNDS) {
    console.warn(`[review] Reached max fix rounds (${MAX_FIX_ROUNDS}) — opening PR anyway`);
    return 'open_pr';
  }

  return 'fix_feedback';
}

// ── Build and compile ───────────────────────────────────────────────────────

let _compiledGraph: Awaited<ReturnType<typeof buildGraph>> | null = null;

export async function buildGraph(databaseUrl?: string) {
  const url = databaseUrl ?? process.env.DATABASE_URL ?? '';
  let checkpointer: MemorySaver | InstanceType<typeof PostgresSaver>;
  if (url) {
    const pg = await PostgresSaver.fromConnString(url);
    await pg.setup();
    checkpointer = pg;
  } else {
    // PGlite mode — use in-memory checkpointing (runs don't survive restart)
    console.log('[graph] No DATABASE_URL — using MemorySaver (run state not persisted)');
    checkpointer = new MemorySaver();
  }

  const graph = new StateGraph(AgentState)
    .addNode('pick_issue', pickIssueNode)
    .addNode('analyze', analyzeNode)
    .addNode('priority_check', priorityCheckNode)
    .addNode('implement', implementNode)
    .addNode('implement_dep_upgrade', implementDepUpgradeNode)
    .addNode('open_pr', openPrNode)
    .addNode('review', reviewNode)
    .addNode('fix_feedback', fixFeedbackNode)

    .addConditionalEdges(START, routeFromStart, {
      pick_issue: 'pick_issue',
      analyze: 'analyze',
    })
    .addEdge('pick_issue', 'analyze')
    .addConditionalEdges('analyze', routeAfterAnalysis, {
      priority_check: 'priority_check',
      implement: 'implement',
      implement_dep_upgrade: 'implement_dep_upgrade',
      [END]: END,
    })
    .addConditionalEdges('priority_check', routeAfterPriority, {
      implement: 'implement',
      implement_dep_upgrade: 'implement_dep_upgrade',
      [END]: END,
    })
    .addConditionalEdges('implement', routeAfterImplement, {
      implement: 'implement',
      review: 'review',
      [END]: END,
    })
    // dep-upgrade agent goes to review on success, END on failure
    .addConditionalEdges('implement_dep_upgrade',
      (s: State) => (s.testsPassed && s.lintPassed) ? 'review' : END,
      { review: 'review', [END]: END }
    )
    .addConditionalEdges('review', routeAfterReview, {
      fix_feedback: 'fix_feedback',
      open_pr: 'open_pr',
      [END]: END,
    })
    .addEdge('fix_feedback', 'review')
    .addEdge('open_pr', END);

  return graph.compile({ checkpointer, recursionLimit: 50 });
}

/** Cached singleton — reuse across API requests */
export async function getGraph() {
  if (!_compiledGraph) {
    _compiledGraph = await buildGraph();
  }
  return _compiledGraph;
}
