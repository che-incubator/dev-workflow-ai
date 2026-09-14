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

import React, { useMemo, useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import {
  Button,
  Card,
  CardBody,
  CardTitle,
  Dropdown,
  DropdownItem,
  DropdownList,
  EmptyState,
  EmptyStateBody,
  Flex,
  FlexItem,
  Label,
  MenuToggle,
  PageSection,
  SearchInput,
  Spinner,
  Title,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';
import { EllipsisVIcon, TrashIcon } from '@patternfly/react-icons';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import type { AgentRun } from '@/services/api/runsService';
import { formatDateTime } from '@/services/helpers/dates';
import styles from './index.module.css';

// ── helpers ───────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, 'green' | 'orange' | 'red' | 'grey' | 'blue'> = {
  done: 'green',
  running: 'orange',
  failed: 'red',
  skipped: 'grey',
};

function shortId(threadId: string): string {
  return threadId.slice(-10);
}

function issueRef(run: AgentRun): string {
  if (run.jira_key) return run.jira_key;
  if (run.issue_number) return `#${run.issue_number}`;
  return run.issue_url?.split('/').pop() ?? '—';
}

function orgFromRepo(repo: string): string {
  return repo?.split('/')[0] ?? '—';
}
function projectFromRepo(repo: string): string {
  return repo?.split('/')[1] ?? repo ?? '—';
}

function lastUpdateTs(run: AgentRun): number {
  return new Date(run.finished_at ?? run.started_at ?? 0).getTime();
}

function runMatches(run: AgentRun, q: string): boolean {
  if (!q) return true;
  const lq = q.toLowerCase();
  return [
    issueRef(run),
    run.issue_title,
    run.jira_key,
    orgFromRepo(run.repo),
    projectFromRepo(run.repo),
    run.project_slug,
    run.status,
  ].some(v => (v ?? '').toLowerCase().includes(lq));
}

type SortCol = 'issue' | 'org' | 'project' | 'status' | 'last_update';
const COL_IDX: Record<SortCol, number> = {
  issue: 2,
  org: 3,
  project: 4,
  status: 5,
  last_update: 6,
};

function sortRuns(runs: AgentRun[], col: SortCol | null, dir: 'asc' | 'desc'): AgentRun[] {
  if (!col) return runs;
  return [...runs].sort((a, b) => {
    if (col === 'last_update')
      return dir === 'asc' ? lastUpdateTs(a) - lastUpdateTs(b) : lastUpdateTs(b) - lastUpdateTs(a);
    const vals: Record<SortCol, [string, string]> = {
      issue: [issueRef(a), issueRef(b)],
      org: [orgFromRepo(a.repo), orgFromRepo(b.repo)],
      project: [projectFromRepo(a.repo), projectFromRepo(b.repo)],
      status: [a.status ?? '', b.status ?? ''],
      last_update: ['', ''],
    };
    const [av, bv] = vals[col];
    return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
  });
}

// ── Props ─────────────────────────────────────────────────────────────────

export type Props = {
  runs: AgentRun[];
  loading: boolean;
  onNavigate: NavigateFunction;
  onCancelRun: (threadId: string) => void;
  onDeleteRun: (threadId: string) => void;
};

// ── Component ─────────────────────────────────────────────────────────────

export default function DashboardPage({
  runs,
  loading,
  onNavigate,
  onCancelRun,
  onDeleteRun,
}: Props): React.ReactElement {
  const [filter, setFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [openKebab, setOpenKebab] = useState<string | null>(null);
  const [stopping, setStopping] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [sortCol, setSortCol] = useState<SortCol | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const filtered = useMemo(
    () =>
      sortRuns(
        runs.filter(r => runMatches(r, filter)),
        sortCol,
        sortDir,
      ),
    [runs, filter, sortCol, sortDir],
  );

  const allSelected = filtered.length > 0 && filtered.every(r => selectedIds.has(r.thread_id));

  function handleSelectAll(checked: boolean): void {
    setSelectedIds(checked ? new Set(filtered.map(r => r.thread_id)) : new Set());
  }

  function handleSelectOne(id: string, checked: boolean): void {
    setSelectedIds(prev => {
      const n = new Set(prev);
      if (checked) n.add(id);
      else n.delete(id);
      return n;
    });
  }

  function handleColSort(_e: React.MouseEvent, colIndex: number, direction: 'asc' | 'desc'): void {
    const col = Object.entries(COL_IDX).find(([, i]) => i === colIndex)?.[0] as SortCol | undefined;
    if (col) {
      setSortCol(col);
      setSortDir(direction);
    }
  }

  const sortBy = sortCol !== null ? { index: COL_IDX[sortCol], direction: sortDir } : {};

  async function handleStop(threadId: string): Promise<void> {
    setStopping(threadId);
    try {
      await onCancelRun(threadId);
    } finally {
      setStopping(null);
    }
  }

  function handleDelete(threadId: string): void {
    const run = runs.find(r => r.thread_id === threadId);
    if (run?.status === 'running') onCancelRun(threadId);
    onDeleteRun(threadId);
    setSelectedIds(prev => {
      const n = new Set(prev);
      n.delete(threadId);
      return n;
    });
  }

  async function handleBulkDelete(): Promise<void> {
    setDeleting(true);
    [...selectedIds].forEach(id => {
      const run = runs.find(r => r.thread_id === id);
      if (run?.status === 'running') onCancelRun(id);
      onDeleteRun(id);
    });
    setSelectedIds(new Set());
    setDeleting(false);
  }

  const activeCount = runs.filter(r => r.status === 'running').length;

  return (
    <>
      <PageSection>
        <Title headingLevel="h1" size="xl">
          Runtime
        </Title>
      </PageSection>

      <PageSection>
        <Card>
          <CardTitle>
            <Flex alignItems={{ default: 'alignItemsCenter' }} gap={{ default: 'gapSm' }}>
              <FlexItem>Recent runs</FlexItem>
              {activeCount > 0 && (
                <FlexItem>
                  <Label color="orange" isCompact>
                    {activeCount} running
                  </Label>
                </FlexItem>
              )}
            </Flex>
          </CardTitle>
          <CardBody>
            <Toolbar>
              <ToolbarContent>
                <ToolbarItem>
                  <SearchInput
                    id="dashboard-filter"
                    placeholder="Filter by"
                    value={filter}
                    onChange={(_e, v) => setFilter(v)}
                    onClear={() => setFilter('')}
                    aria-label="Filter runs"
                    className={styles.filterInput}
                  />
                </ToolbarItem>
                <ToolbarItem>
                  <Button
                    id="dashboard-bulk-delete"
                    variant="plain"
                    isDanger
                    isDisabled={selectedIds.size === 0 || deleting}
                    onClick={handleBulkDelete}
                    aria-label="Delete selected runs"
                  >
                    <TrashIcon />
                    {selectedIds.size > 0 && <>&nbsp;Delete ({selectedIds.size})</>}
                  </Button>
                </ToolbarItem>
              </ToolbarContent>
            </Toolbar>

            {loading ? (
              <Flex
                justifyContent={{ default: 'justifyContentCenter' }}
                style={{ padding: '24px' }}
              >
                <FlexItem>
                  <Spinner aria-label="Loading runs" />
                </FlexItem>
              </Flex>
            ) : filtered.length === 0 ? (
              <EmptyState>
                <EmptyStateBody>
                  {runs.length === 0
                    ? 'No runs yet. Go to Issues to start one.'
                    : 'No runs match the filter.'}
                </EmptyStateBody>
              </EmptyState>
            ) : (
              <Table
                id="runs-table"
                aria-label="Runs"
                variant="compact"
                className={styles.runsTable}
              >
                <Thead>
                  <Tr>
                    <Th
                      select={{ onSelect: (_e, c) => handleSelectAll(c), isSelected: allSelected }}
                    />
                    <Th>ID</Th>
                    <Th
                      sort={{ sortBy, onSort: handleColSort, columnIndex: COL_IDX.issue }}
                      style={{ cursor: 'pointer' }}
                    >
                      Issue
                    </Th>
                    <Th
                      sort={{ sortBy, onSort: handleColSort, columnIndex: COL_IDX.org }}
                      style={{ cursor: 'pointer' }}
                    >
                      Organization
                    </Th>
                    <Th
                      sort={{ sortBy, onSort: handleColSort, columnIndex: COL_IDX.project }}
                      style={{ cursor: 'pointer' }}
                    >
                      Project
                    </Th>
                    <Th
                      sort={{ sortBy, onSort: handleColSort, columnIndex: COL_IDX.status }}
                      style={{ cursor: 'pointer' }}
                    >
                      Status
                    </Th>
                    <Th
                      sort={{ sortBy, onSort: handleColSort, columnIndex: COL_IDX.last_update }}
                      style={{ cursor: 'pointer' }}
                    >
                      Last update
                    </Th>
                    <Th screenReaderText="Actions" />
                  </Tr>
                </Thead>
                <Tbody>
                  {filtered.map((run, rowIndex) => {
                    const ref = issueRef(run);
                    const isRunning = run.status === 'running';
                    return (
                      <Tr
                        key={run.thread_id}
                        id={`run-row-${shortId(run.thread_id)}`}
                        style={{ cursor: 'pointer' }}
                        onClick={() => onNavigate(`/runs/${run.thread_id}`)}
                      >
                        <Td
                          select={{
                            rowIndex,
                            onSelect: (_e, c) => handleSelectOne(run.thread_id, c),
                            isSelected: selectedIds.has(run.thread_id),
                          }}
                          onClick={e => e.stopPropagation()}
                        />
                        <Td className={styles.idCell}>{shortId(run.thread_id)}</Td>
                        <Td onClick={e => e.stopPropagation()}>
                          {run.issue_url ? (
                            <a
                              href={run.issue_url}
                              target="_blank"
                              rel="noreferrer"
                              className={styles.issueLink}
                            >
                              {ref}
                            </a>
                          ) : (
                            <span className={styles.issueLink}>{ref}</span>
                          )}
                        </Td>
                        <Td className={styles.orgCell}>{orgFromRepo(run.repo)}</Td>
                        <Td className={styles.projectCell}>
                          {projectFromRepo(run.repo) || run.project_slug || '—'}
                        </Td>
                        <Td>
                          <Label color={STATUS_COLOR[run.status] ?? 'blue'} isCompact>
                            {run.status}
                          </Label>
                        </Td>
                        <Td className={styles.dateCell}>
                          {formatDateTime(run.finished_at ?? run.started_at)}
                        </Td>
                        <Td isActionCell onClick={e => e.stopPropagation()}>
                          <Dropdown
                            isOpen={openKebab === run.thread_id}
                            onOpenChange={o => setOpenKebab(o ? run.thread_id : null)}
                            toggle={(ref: React.Ref<HTMLButtonElement>) => (
                              <MenuToggle
                                ref={ref}
                                id={`run-kebab-${shortId(run.thread_id)}`}
                                variant="plain"
                                className={styles.kebabToggle}
                                aria-label={`Actions for ${shortId(run.thread_id)}`}
                                onClick={() =>
                                  setOpenKebab(openKebab === run.thread_id ? null : run.thread_id)
                                }
                                isExpanded={openKebab === run.thread_id}
                              >
                                <EllipsisVIcon />
                              </MenuToggle>
                            )}
                            popperProps={{ position: 'right' }}
                          >
                            <DropdownList>
                              <DropdownItem
                                onClick={() => {
                                  onNavigate(`/runs/${run.thread_id}`);
                                  setOpenKebab(null);
                                }}
                                style={{ cursor: 'pointer' }}
                              >
                                View
                              </DropdownItem>
                              <DropdownItem
                                isDisabled={!isRunning || stopping === run.thread_id}
                                onClick={() => {
                                  void handleStop(run.thread_id);
                                  setOpenKebab(null);
                                }}
                                style={{ cursor: isRunning ? 'pointer' : 'default' }}
                              >
                                {stopping === run.thread_id ? 'Stopping…' : 'Stop'}
                              </DropdownItem>
                              <DropdownItem
                                isDanger
                                onClick={() => {
                                  handleDelete(run.thread_id);
                                  setOpenKebab(null);
                                }}
                                style={{ cursor: 'pointer' }}
                              >
                                Delete
                              </DropdownItem>
                            </DropdownList>
                          </Dropdown>
                        </Td>
                      </Tr>
                    );
                  })}
                </Tbody>
              </Table>
            )}
          </CardBody>
        </Card>
      </PageSection>
    </>
  );
}
