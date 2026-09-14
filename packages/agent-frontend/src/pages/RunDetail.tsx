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

import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  PageSection,
  Title,
  Breadcrumb,
  BreadcrumbItem,
  Card,
  CardBody,
  CardTitle,
  Button,
  Label,
  Flex,
  FlexItem,
  DescriptionList,
  DescriptionListGroup,
  DescriptionListTerm,
  DescriptionListDescription,
  CodeBlock,
  CodeBlockCode,
  Alert,
  Spinner,
  EmptyState,
  EmptyStateBody,
  Grid,
  GridItem,
} from '@patternfly/react-core';
import {
  getRun,
  cancelRun,
  subscribeToRun,
  RunDetail as RunDetailType,
  RunEvent,
  WsEvent,
  Finding,
} from '../api/client.js';

const PHASES = ['Analyze', 'Implement', 'Review', 'Fix if needed', 'Open PR', 'Done'];

// Map backend node names → phase display labels
const NODE_TO_PHASE: Record<string, string> = {
  analyze: 'Analyze',
  implement: 'Implement',
  implement_dep_upgrade: 'Implement',
  review: 'Review',
  fix_feedback: 'Fix if needed',
  open_pr: 'Open PR',
};

interface Props {
  threadId?: string;
  onBack?: () => void;
}

export default function RunDetail({ threadId: propThreadId, onBack }: Props) {
  const { threadId: paramThreadId } = useParams<{ threadId: string }>();
  const navigate = useNavigate();
  const threadId = propThreadId ?? paramThreadId ?? '';

  const [run, setRun] = useState<RunDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveEvents, setLiveEvents] = useState<{ ts: string; level: string; message: string }[]>(
    [],
  );
  const [activePhase, setActivePhase] = useState('');
  const [donePhases, setDonePhases] = useState<Set<string>>(new Set());
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!threadId) return;
    getRun(threadId).then(r => {
      setRun(r);
      setLoading(false);
      // Reconstruct done phases from stored events
      const done = new Set<string>();
      for (const e of r?.events ?? []) {
        const phase = NODE_TO_PHASE[e.node ?? ''];
        if (phase) done.add(phase);
        // Also infer from message prefix
        const nodePrefix = (e.message ?? '').match(/^([a-z_]+):/)?.[1];
        if (nodePrefix && NODE_TO_PHASE[nodePrefix]) done.add(NODE_TO_PHASE[nodePrefix]);
      }
      setDonePhases(done);
      if (r?.status === 'done') setDonePhases(prev => new Set([...prev, 'Done']));
    });
  }, [threadId]);

  useEffect(() => {
    if (!threadId) return;
    const unsub = subscribeToRun(threadId, (e: WsEvent) => {
      if (e.type === 'log') {
        const msg: string = e.payload.message ?? '';
        setLiveEvents(prev => [
          ...prev,
          { ts: new Date().toISOString(), level: e.payload.level, message: msg },
        ]);
        // Infer active phase from log prefix (e.g. "analyze: ..." → Analyze)
        const nodePrefix = msg.match(/^([a-z_]+):/)?.[1];
        if (nodePrefix && NODE_TO_PHASE[nodePrefix]) {
          setActivePhase(NODE_TO_PHASE[nodePrefix]);
        }
      }
      // node_complete marks a phase done and advances activePhase
      if (e.type === 'node_complete') {
        const phase = NODE_TO_PHASE[e.payload?.node as string];
        if (phase) {
          setDonePhases(prev => new Set([...prev, phase]));
          setActivePhase('');
        }
      }
      // legacy phase events still supported
      if (e.type === 'phase_start') setActivePhase(e.payload.phase);
      if (e.type === 'phase_complete') setDonePhases(prev => new Set([...prev, e.payload.phase]));
      if (e.type === 'run_complete' || e.type === 'run_failed') {
        getRun(threadId).then(setRun);
      }
    });
    return unsub;
  }, [threadId]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [liveEvents]);

  const getPhaseIcon = (phase: string) => {
    if (donePhases.has(phase)) return '✅';
    if (activePhase === phase) return '⏳';
    return '○';
  };

  const allEvents = [
    ...(run?.events ?? []).map((e: RunEvent) => ({ ts: e.ts, level: e.level, message: e.message })),
    ...liveEvents,
  ];

  const handleBack = () => {
    if (onBack) onBack();
    else navigate('/dashboard');
  };

  if (loading) {
    return (
      <PageSection>
        <Flex justifyContent={{ default: 'justifyContentCenter' }}>
          <FlexItem>
            <Spinner aria-label="Loading run" />
          </FlexItem>
        </Flex>
      </PageSection>
    );
  }

  if (!run) {
    return (
      <PageSection>
        <EmptyState>
          <EmptyStateBody>Run not found.</EmptyStateBody>
        </EmptyState>
      </PageSection>
    );
  }

  return (
    <>
      <PageSection>
        <Breadcrumb>
          <BreadcrumbItem onClick={handleBack} style={{ cursor: 'pointer' }}>
            Runtime
          </BreadcrumbItem>
          <BreadcrumbItem isActive>
            {run.project_slug}
            {(run.jira_key || run.issue_number) && <> [{run.jira_key || `#${run.issue_number}`}]</>}
          </BreadcrumbItem>
        </Breadcrumb>
        <Flex
          alignItems={{ default: 'alignItemsCenter' }}
          justifyContent={{ default: 'justifyContentSpaceBetween' }}
          style={{ marginTop: '1rem' }}
        >
          <FlexItem>
            <Title headingLevel="h1" size="xl">
              {run.issue_title ||
                run.jira_key ||
                (run.issue_number ? `Issue #${run.issue_number}` : run.issue_url || 'Run detail')}
            </Title>
          </FlexItem>
          {run.status === 'running' && (
            <FlexItem>
              <Button
                variant="danger"
                onClick={() => cancelRun(threadId).then(() => getRun(threadId).then(setRun))}
              >
                Cancel
              </Button>
            </FlexItem>
          )}
        </Flex>
      </PageSection>

      <PageSection>
        <DescriptionList isHorizontal isCompact>
          {/* Issue */}
          {(run.issue_url || run.jira_key || run.issue_number) && (
            <DescriptionListGroup>
              <DescriptionListTerm>Issue</DescriptionListTerm>
              <DescriptionListDescription>
                {run.issue_url ? (
                  <a
                    href={run.issue_url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ cursor: 'pointer' }}
                  >
                    {run.issue_url}
                  </a>
                ) : (
                  run.jira_key || `#${run.issue_number}`
                )}
              </DescriptionListDescription>
            </DescriptionListGroup>
          )}

          {/* Title */}
          {run.issue_title && (
            <DescriptionListGroup>
              <DescriptionListTerm>Title</DescriptionListTerm>
              <DescriptionListDescription>{run.issue_title}</DescriptionListDescription>
            </DescriptionListGroup>
          )}

          {/* Project — link to GitHub repo */}
          {run.repo && (
            <DescriptionListGroup>
              <DescriptionListTerm>Project</DescriptionListTerm>
              <DescriptionListDescription>
                <a
                  href={`https://github.com/${run.repo}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ cursor: 'pointer' }}
                >
                  {`https://github.com/${run.repo}`}
                </a>
              </DescriptionListDescription>
            </DescriptionListGroup>
          )}

          {/* Status */}
          <DescriptionListGroup>
            <DescriptionListTerm>Status</DescriptionListTerm>
            <DescriptionListDescription>
              <Label
                color={
                  run.status === 'done'
                    ? 'green'
                    : run.status === 'failed'
                      ? 'red'
                      : run.status === 'running'
                        ? 'orange'
                        : 'grey'
                }
              >
                {run.status}
              </Label>
            </DescriptionListDescription>
          </DescriptionListGroup>

          {/* Priority */}
          {run.priority && (
            <DescriptionListGroup>
              <DescriptionListTerm>Priority</DescriptionListTerm>
              <DescriptionListDescription>
                <Label
                  color={
                    run.priority === 'critical'
                      ? 'red'
                      : run.priority === 'major'
                        ? 'orange'
                        : 'grey'
                  }
                  isCompact
                >
                  {run.priority}
                </Label>
                {run.jira_key && <> [{run.jira_key}]</>}
                {run.priority_source && <> ({run.priority_source})</>}
              </DescriptionListDescription>
            </DescriptionListGroup>
          )}

          {/* Story Points */}
          {run.story_points > 0 && (
            <DescriptionListGroup>
              <DescriptionListTerm>Story Points</DescriptionListTerm>
              <DescriptionListDescription>{run.story_points} SP</DescriptionListDescription>
            </DescriptionListGroup>
          )}

          {/* Pull Request */}
          {run.pr_url && (
            <DescriptionListGroup>
              <DescriptionListTerm>Pull Request</DescriptionListTerm>
              <DescriptionListDescription>
                <a href={run.pr_url} target="_blank" rel="noreferrer" style={{ cursor: 'pointer' }}>
                  {run.pr_url}
                </a>
              </DescriptionListDescription>
            </DescriptionListGroup>
          )}

          {/* Review Verdict */}
          {run.verdict && (
            <DescriptionListGroup>
              <DescriptionListTerm>Review Verdict</DescriptionListTerm>
              <DescriptionListDescription>{run.verdict}</DescriptionListDescription>
            </DescriptionListGroup>
          )}
        </DescriptionList>
      </PageSection>

      <PageSection>
        <Grid hasGutter>
          {/* Phase timeline */}
          <GridItem span={3}>
            <Card isCompact>
              <CardTitle>Phases</CardTitle>
              <CardBody>
                {PHASES.map(p => (
                  <Flex key={p} gap={{ default: 'gapSm' }} style={{ padding: '6px 0' }}>
                    <FlexItem>{getPhaseIcon(p)}</FlexItem>
                    <FlexItem
                      style={{
                        color:
                          activePhase === p
                            ? 'var(--pf-t--global--text--color--default)'
                            : 'var(--pf-t--global--text--color--subtle)',
                      }}
                    >
                      {p}
                    </FlexItem>
                  </Flex>
                ))}
              </CardBody>
            </Card>
          </GridItem>

          {/* Live log */}
          <GridItem span={9}>
            <Card isCompact>
              <CardTitle>Log</CardTitle>
              <CardBody>
                <CodeBlock>
                  <CodeBlockCode
                    ref={logRef}
                    style={{ maxHeight: '400px', overflowY: 'auto', fontSize: '0.8rem' }}
                  >
                    {allEvents.length === 0
                      ? 'Waiting for events…'
                      : allEvents
                          .map((e, _i) => `[${new Date(e.ts).toLocaleTimeString()}] ${e.message}\n`)
                          .join('')}
                  </CodeBlockCode>
                </CodeBlock>
              </CardBody>
            </Card>
          </GridItem>
        </Grid>
      </PageSection>

      {/* Findings */}
      {(run.findings ?? []).length > 0 && (
        <PageSection>
          <Title headingLevel="h2" size="lg" style={{ marginBottom: '1rem' }}>
            Review Findings ({run.findings.length})
          </Title>
          {run.findings.map((f: Finding) => (
            <Alert
              key={f.id}
              variant={
                f.severity === 'blocking' ? 'danger' : f.severity === 'warning' ? 'warning' : 'info'
              }
              title={`${f.severity.toUpperCase()} · ${f.tier}${f.file ? ` · ${f.file}${f.line ? `:${f.line}` : ''}` : ''}`}
              isInline
              style={{ marginBottom: '8px' }}
            >
              {f.finding}
            </Alert>
          ))}
        </PageSection>
      )}
    </>
  );
}
