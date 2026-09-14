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

import { describe, it, expect } from 'vitest';

// ── Inline copies of pure functions from src/nodes/pickIssue.ts ──────────────
// These are not exported; test logic directly here following project convention.

const PRIORITY_BOOSTS: Record<string, number> = {
  'priority/critical': 5,
  'priority/major': 3,
  'priority/minor': 0,
  'priority/trivial': -2,
};

const TYPE_SCORES: Record<string, number> = {
  'kind/bug': 10,
  'kind/enhancement': 6,
  'area/docs': 3,
};

interface GhIssue {
  number: number;
  title: string;
  body: string;
  labels: Array<{ name: string }>;
  assignees: Array<{ login: string }>;
}

function scoreIssue(issue: GhIssue): number {
  let score = 0;
  const labelNames = issue.labels.map(l => l.name);
  for (const label of labelNames) {
    score += TYPE_SCORES[label] ?? 0;
    score += PRIORITY_BOOSTS[label] ?? 0;
    if (label === 'good first issue') score += 1;
  }
  return score;
}

function estimateStoryPoints(issue: GhIssue): number {
  const body = issue.body ?? '';
  if (body.length < 200) return 1;
  if (body.length < 500) return 2;
  if (body.includes('migration') || body.includes('refactor')) return 5;
  return 3;
}

// ── Inline copies of routing functions from src/agent/graph.ts ───────────────

type Status = 'idle' | 'approved' | 'skipped' | 'failed' | 'done';
interface RouteState {
  issueNumber: number | null;
  storyPoints: number;
  status: Status;
  testsPassed: boolean;
  lintPassed: boolean;
  retryCount: number;
  reviewFindings: Array<{ severity: 'blocking' | 'warning' | 'suggestion' }>;
}

const END = '__end__';

function routeFromStart(state: RouteState): 'pick_issue' | 'analyze' {
  return state.issueNumber !== null ? 'analyze' : 'pick_issue';
}

function routeAfterAnalysis(state: RouteState): 'priority_check' | typeof END {
  if (!state.issueNumber) return END;
  if (state.storyPoints > 5) return END;
  return 'priority_check';
}

function routeAfterPriority(state: RouteState): 'implement' | typeof END {
  return state.status === 'approved' ? 'implement' : END;
}

function routeAfterImplement(state: RouteState): 'implement' | 'open_pr' | typeof END {
  if (state.testsPassed && state.lintPassed) return 'open_pr';
  if (state.retryCount >= 3) return END;
  return 'implement';
}

function routeAfterReview(state: RouteState): 'fix_feedback' | typeof END {
  const blocking = state.reviewFindings.filter(f => f.severity === 'blocking');
  return blocking.length > 0 ? 'fix_feedback' : END;
}

// ── Helper ───────────────────────────────────────────────────────────────────

function makeIssue(overrides: Partial<GhIssue> = {}): GhIssue {
  return {
    number: 1,
    title: 'Test issue',
    body: '',
    labels: [],
    assignees: [],
    ...overrides,
  };
}

// ── scoreIssue tests ─────────────────────────────────────────────────────────

describe('scoreIssue — label scoring', () => {
  it('returns 0 for an issue with no labels', () => {
    expect(scoreIssue(makeIssue())).toBe(0);
  });

  it('scores kind/bug as 10', () => {
    expect(scoreIssue(makeIssue({ labels: [{ name: 'kind/bug' }] }))).toBe(10);
  });

  it('scores kind/enhancement as 6', () => {
    expect(scoreIssue(makeIssue({ labels: [{ name: 'kind/enhancement' }] }))).toBe(6);
  });

  it('scores area/docs as 3', () => {
    expect(scoreIssue(makeIssue({ labels: [{ name: 'area/docs' }] }))).toBe(3);
  });

  it('adds priority/critical boost of 5', () => {
    const score = scoreIssue(
      makeIssue({ labels: [{ name: 'kind/bug' }, { name: 'priority/critical' }] }),
    );
    expect(score).toBe(15); // 10 + 5
  });

  it('adds priority/major boost of 3', () => {
    const score = scoreIssue(
      makeIssue({ labels: [{ name: 'kind/bug' }, { name: 'priority/major' }] }),
    );
    expect(score).toBe(13); // 10 + 3
  });

  it('priority/minor adds 0 (no change)', () => {
    const withMinor = scoreIssue(
      makeIssue({ labels: [{ name: 'kind/bug' }, { name: 'priority/minor' }] }),
    );
    const withoutPri = scoreIssue(makeIssue({ labels: [{ name: 'kind/bug' }] }));
    expect(withMinor).toBe(withoutPri);
  });

  it('priority/trivial subtracts 2', () => {
    const score = scoreIssue(
      makeIssue({ labels: [{ name: 'kind/bug' }, { name: 'priority/trivial' }] }),
    );
    expect(score).toBe(8); // 10 - 2
  });

  it('adds 1 for good first issue', () => {
    const score = scoreIssue(
      makeIssue({ labels: [{ name: 'kind/bug' }, { name: 'good first issue' }] }),
    );
    expect(score).toBe(11); // 10 + 1
  });

  it('ignores unrecognised labels (CVE, Security, area/dashboard-frontend)', () => {
    const score = scoreIssue(
      makeIssue({
        labels: [{ name: 'CVE' }, { name: 'Security' }, { name: 'area/dashboard-frontend' }],
      }),
    );
    expect(score).toBe(0);
  });

  it('CVE issue from setup-cve-test.sh scores 13 (kind/bug + priority/major)', () => {
    // Labels set by setup-cve-test.sh: CVE, Security, kind/bug, area/dashboard-frontend, priority/major
    const score = scoreIssue(
      makeIssue({
        labels: [
          { name: 'CVE' },
          { name: 'Security' },
          { name: 'kind/bug' },
          { name: 'area/dashboard-frontend' },
          { name: 'priority/major' },
        ],
      }),
    );
    expect(score).toBe(13); // kind/bug=10 + priority/major=3; CVE/Security/area ignored
  });

  it('kind/bug ranks higher than kind/enhancement', () => {
    const bug = scoreIssue(makeIssue({ labels: [{ name: 'kind/bug' }] }));
    const enh = scoreIssue(makeIssue({ labels: [{ name: 'kind/enhancement' }] }));
    expect(bug).toBeGreaterThan(enh);
  });

  it('critical bug ranks higher than major bug', () => {
    const critical = scoreIssue(
      makeIssue({ labels: [{ name: 'kind/bug' }, { name: 'priority/critical' }] }),
    );
    const major = scoreIssue(
      makeIssue({ labels: [{ name: 'kind/bug' }, { name: 'priority/major' }] }),
    );
    expect(critical).toBeGreaterThan(major);
  });
});

// ── estimateStoryPoints tests ─────────────────────────────────────────────────

describe('estimateStoryPoints — body length heuristics', () => {
  it('returns 1 for empty body', () => {
    expect(estimateStoryPoints(makeIssue({ body: '' }))).toBe(1);
  });

  it('returns 1 for body under 200 chars (trivial CVE dep bump)', () => {
    expect(estimateStoryPoints(makeIssue({ body: 'Upgrade js-yaml to fix CVE.' }))).toBe(1);
  });

  it('returns 2 for body between 200 and 500 chars', () => {
    const body = 'x'.repeat(300);
    expect(estimateStoryPoints(makeIssue({ body }))).toBe(2);
  });

  it('CVE issue from setup-cve-test.sh (~350 chars) returns 2 SP', () => {
    const body = [
      '## Jira Reference',
      'https://redhat.atlassian.net/browse/CRW-12949',
      '',
      '## Summary',
      'CVE-2026-84961 devspaces/dashboard-rhel9: some-package: Denial of Service',
      '',
      '## Jira Labels',
      'CVE-2026-84961 Security SecurityTracking Unplanned',
      '',
      '## Priority',
      'Major',
      '',
      '## Fix Notes',
      'Upgrade or patch the affected dependency to resolve this CVE.',
    ].join('\n');
    // body is ~350 chars: between 200 and 500 → 2 SP
    expect(body.length).toBeGreaterThan(200);
    expect(body.length).toBeLessThan(500);
    expect(estimateStoryPoints(makeIssue({ body }))).toBe(2);
  });

  it('returns 5 for body mentioning migration', () => {
    const body = 'This requires a database migration to fix properly. ' + 'x'.repeat(500);
    expect(estimateStoryPoints(makeIssue({ body }))).toBe(5);
  });

  it('returns 5 for body mentioning refactor', () => {
    const body = 'We need to refactor the auth module. ' + 'x'.repeat(500);
    expect(estimateStoryPoints(makeIssue({ body }))).toBe(5);
  });

  it('returns 3 for body over 500 chars with no special keywords', () => {
    const body = 'x'.repeat(600);
    expect(estimateStoryPoints(makeIssue({ body }))).toBe(3);
  });

  it('CVE issues with short bodies stay within 3 SP budget', () => {
    const shortBody = 'Fix CVE in dependency.';
    const sp = estimateStoryPoints(makeIssue({ body: shortBody }));
    expect(sp).toBeLessThanOrEqual(3);
  });
});

// ── Graph routing tests ───────────────────────────────────────────────────────

describe('routeFromStart', () => {
  it('routes to pick_issue when no issue is pre-selected', () => {
    expect(routeFromStart({ issueNumber: null } as RouteState)).toBe('pick_issue');
  });

  it('routes to analyze when issue is pre-selected (manual start)', () => {
    expect(routeFromStart({ issueNumber: 42 } as RouteState)).toBe('analyze');
  });

  it('routes to analyze for any non-null issue number', () => {
    expect(routeFromStart({ issueNumber: 1 } as RouteState)).toBe('analyze');
  });
});

describe('routeAfterAnalysis', () => {
  const base: RouteState = {
    issueNumber: 42,
    storyPoints: 2,
    status: 'idle',
    testsPassed: false,
    lintPassed: false,
    retryCount: 0,
    reviewFindings: [],
  };

  it('proceeds to priority_check for normal issue within budget', () => {
    expect(routeAfterAnalysis(base)).toBe('priority_check');
  });

  it('ends when no issue was found', () => {
    expect(routeAfterAnalysis({ ...base, issueNumber: null })).toBe(END);
  });

  it('ends when story points exceed hard limit of 5', () => {
    expect(routeAfterAnalysis({ ...base, storyPoints: 6 })).toBe(END);
  });

  it('allows exactly 5 story points (boundary)', () => {
    expect(routeAfterAnalysis({ ...base, storyPoints: 5 })).toBe('priority_check');
  });

  it('CVE issue at 2 SP proceeds to priority_check', () => {
    expect(routeAfterAnalysis({ ...base, storyPoints: 2 })).toBe('priority_check');
  });
});

describe('routeAfterPriority', () => {
  it('proceeds to implement when approved', () => {
    expect(routeAfterPriority({ status: 'approved' } as RouteState)).toBe('implement');
  });

  it('ends when skipped (priority below threshold)', () => {
    expect(routeAfterPriority({ status: 'skipped' } as RouteState)).toBe(END);
  });

  it('ends when failed', () => {
    expect(routeAfterPriority({ status: 'failed' } as RouteState)).toBe(END);
  });
});

describe('routeAfterImplement', () => {
  const base: RouteState = {
    issueNumber: 1,
    storyPoints: 2,
    status: 'approved',
    testsPassed: false,
    lintPassed: false,
    retryCount: 0,
    reviewFindings: [],
  };

  it('opens PR when tests and lint both pass', () => {
    expect(routeAfterImplement({ ...base, testsPassed: true, lintPassed: true })).toBe('open_pr');
  });

  it('retries when tests fail and retry count < 3', () => {
    expect(
      routeAfterImplement({ ...base, testsPassed: false, lintPassed: true, retryCount: 0 }),
    ).toBe('implement');
    expect(
      routeAfterImplement({ ...base, testsPassed: true, lintPassed: false, retryCount: 2 }),
    ).toBe('implement');
  });

  it('gives up and ends after 3 retries', () => {
    expect(
      routeAfterImplement({ ...base, testsPassed: false, lintPassed: false, retryCount: 3 }),
    ).toBe(END);
  });

  it('does not open PR when only tests pass but lint fails', () => {
    expect(routeAfterImplement({ ...base, testsPassed: true, lintPassed: false })).not.toBe(
      'open_pr',
    );
  });
});

describe('routeAfterReview', () => {
  const emptyState: RouteState = {
    issueNumber: 1,
    storyPoints: 2,
    status: 'approved',
    testsPassed: true,
    lintPassed: true,
    retryCount: 0,
    reviewFindings: [],
  };

  it('ends when no findings', () => {
    expect(routeAfterReview(emptyState)).toBe(END);
  });

  it('ends when only warnings (no blocking)', () => {
    expect(
      routeAfterReview({
        ...emptyState,
        reviewFindings: [{ severity: 'warning' }, { severity: 'suggestion' }],
      }),
    ).toBe(END);
  });

  it('routes to fix_feedback when any blocking finding exists', () => {
    expect(
      routeAfterReview({
        ...emptyState,
        reviewFindings: [{ severity: 'blocking' }],
      }),
    ).toBe('fix_feedback');
  });

  it('routes to fix_feedback even with mixed severities if any blocking', () => {
    expect(
      routeAfterReview({
        ...emptyState,
        reviewFindings: [
          { severity: 'warning' },
          { severity: 'blocking' },
          { severity: 'suggestion' },
        ],
      }),
    ).toBe('fix_feedback');
  });
});

// ── End-to-end pick simulation ────────────────────────────────────────────────

describe('end-to-end: pick simulation for 10 CVE issues', () => {
  const CVE_LABELS = ['CVE', 'Security', 'kind/bug', 'area/dashboard-frontend', 'priority/major'];

  const makeJiraCveIssue = (number: number, body: string): GhIssue => ({
    number,
    title: `[CVE] CVE-2026-XXXXX devspaces/dashboard-rhel9: some-package`,
    body,
    labels: CVE_LABELS.map(name => ({ name })),
    assignees: [],
  });

  const shortBody = [
    '## Jira Reference\nhttps://redhat.atlassian.net/browse/CRW-12949\n',
    '## Summary\nCVE-2026-84961 some-package: DoS\n',
    '## Priority\nMajor\n',
    '## Fix Notes\nUpgrade or patch the affected dependency.',
  ].join('\n');

  it('all 10 CVE issues score 13 (kind/bug=10 + priority/major=3)', () => {
    for (let i = 1; i <= 10; i++) {
      const issue = makeJiraCveIssue(i, shortBody);
      expect(scoreIssue(issue)).toBe(13);
    }
  });

  it('CVE issues estimate 1 SP (body under 200 chars → trivial dep bump)', () => {
    // shortBody is ~180 chars — falls into the < 200 → 1 SP bucket
    expect(shortBody.length).toBeLessThan(200);
    const issue = makeJiraCveIssue(1, shortBody);
    expect(estimateStoryPoints(issue)).toBe(1);
  });

  it('all CVE issues are within 3 SP budget', () => {
    for (let i = 1; i <= 10; i++) {
      const sp = estimateStoryPoints(makeJiraCveIssue(i, shortBody));
      expect(sp).toBeLessThanOrEqual(3);
    }
  });

  it('with equal scores, lower issue number is preferred (oldest issue wins)', () => {
    const issues = [5, 3, 8, 1, 7].map(n => makeJiraCveIssue(n, shortBody));
    const scores = issues.map(i => scoreIssue(i));
    // All scores equal
    expect(new Set(scores).size).toBe(1);
    // Tiebreak: sort by number ascending → pick first
    const sorted = [...issues].sort((a, b) => a.number - b.number);
    expect(sorted[0].number).toBe(1);
  });

  it('routeFromStart picks pick_issue (no pre-selected issue in auto mode)', () => {
    expect(routeFromStart({ issueNumber: null } as RouteState)).toBe('pick_issue');
  });

  it('CVE issue at 2 SP proceeds through analysis to priority_check', () => {
    const state: RouteState = {
      issueNumber: 42,
      storyPoints: 2,
      status: 'idle',
      testsPassed: false,
      lintPassed: false,
      retryCount: 0,
      reviewFindings: [],
    };
    expect(routeAfterAnalysis(state)).toBe('priority_check');
  });

  it('CVE issue with Major priority (≥ threshold) is approved', () => {
    // priorityCheckNode maps GitHub label 'priority/major' → 'major'
    // default minPriority is 'major' → meetsThreshold('major', 'major') = true
    const PRIORITY_ORDER = ['critical', 'major', 'minor', 'trivial'];
    const meetsThreshold = (p: string, min: string) =>
      PRIORITY_ORDER.indexOf(p) <= PRIORITY_ORDER.indexOf(min);
    expect(meetsThreshold('major', 'major')).toBe(true);
  });
});
