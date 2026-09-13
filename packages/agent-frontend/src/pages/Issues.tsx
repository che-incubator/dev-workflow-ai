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

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardTitle,
  Divider,
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
  Switch,
  TextInput,
  Title,
  ToggleGroup,
  ToggleGroupItem,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
  Tooltip,
} from '@patternfly/react-core';
import { EllipsisVIcon, TrashIcon } from '@patternfly/react-icons';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { useAlerts } from '../contexts/AlertContext.js';
import {
  addSource,
  deleteIssue,
  deleteSource,
  getAllIssues,
  getSources,
  IssueSource,
  importIssue,
  refreshIssue,
  startRun,
  StoredIssue,
  syncSource,
  syncJiraAssigned,
  isJiraAssignedUrl,
  triggerCveBatch,
} from '../api/client.js';

// ── helpers ───────────────────────────────────────────────────────────────

const PRIORITY_COLOR: Record<string, 'red' | 'orange' | 'grey'> = {
  critical: 'red',
  major: 'orange',
  minor: 'grey',
  trivial: 'grey',
};

function isPrioritized(issue: StoredIssue): boolean {
  return issue.priority === 'critical' || issue.priority === 'major';
}

function srcMatches(src: IssueSource, q: string): boolean {
  if (!q) return true;
  const lq = q.toLowerCase();
  return src.label.toLowerCase().includes(lq) || src.url.toLowerCase().includes(lq);
}

function issueMatches(issue: StoredIssue, q: string): boolean {
  if (!q) return true;
  const lq = q.toLowerCase();
  return (
    issue.title.toLowerCase().includes(lq) ||
    issue.external_id.toLowerCase().includes(lq) ||
    issue.source_label.toLowerCase().includes(lq)
  );
}

function shortenIssueUrl(url: string): string {
  const ghMatch = url.match(/github\.com\/([^/]+\/[^/]+)\/(?:issues|pull)\/(\d+)/);
  if (ghMatch) return `${ghMatch[1]}#${ghMatch[2]}`;
  const jiraMatch = url.match(/\/browse\/([A-Z]+-\d+)/);
  if (jiraMatch) return jiraMatch[1];
  return url.replace(/^https?:\/\/[^/]+/, '').slice(0, 50) || url;
}

// ── QueueItem ─────────────────────────────────────────────────────────────

interface QueueItem {
  key: string;
  issueId: number | null;   // DB id, null while importing
  url: string;
  title: string;
  forceP: boolean;
}

// ── Issues Sources section ────────────────────────────────────────────────

function IssuesSourcesSection({
  sources,
  loading,
  onReload,
}: {
  sources: IssueSource[];
  loading: boolean;
  onReload: () => void;
}) {
  const { addAlert } = useAlerts();
  const [srcFilter, setSrcFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [newUrl, setNewUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [syncing, setSyncing] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [openKebab, setOpenKebab] = useState<number | null>(null);

  const filtered = useMemo(
    () => sources.filter(s => srcMatches(s, srcFilter)),
    [sources, srcFilter],
  );

  const allSelected = filtered.length > 0 && filtered.every(s => selectedIds.has(s.id));

  function handleSelectAll(isSelected: boolean): void {
    setSelectedIds(isSelected ? new Set(filtered.map(s => s.id)) : new Set());
  }

  function handleSelectOne(id: number, isSelected: boolean): void {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (isSelected) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleAdd(): Promise<void> {
    if (!newUrl.trim()) return;
    setAdding(true);
    try {
      await addSource(newUrl.trim());
      setNewUrl('');
      addAlert('success', 'Source added');
      onReload();
    } catch (e) {
      addAlert('danger', e instanceof Error ? e.message : 'Failed to add source');
    } finally {
      setAdding(false);
    }
  }

  async function handleSync(src: IssueSource): Promise<void> {
    setSyncing(src.id);
    try {
      if (isJiraAssignedUrl(src.url)) {
        const result = await syncJiraAssigned(src.id);
        addAlert('success', `Synced ${result.upserted} assigned Jira issues`);
        onReload();
      } else {
        await syncSource(src.id);
        addAlert('info', 'Sync started — issues will appear shortly');
        setTimeout(onReload, 4000);
      }
    } catch (e) {
      addAlert('danger', e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setSyncing(null);
    }
  }

  async function handleDeleteOne(id: number): Promise<void> {
    try {
      await deleteSource(id);
      setSelectedIds(prev => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
      addAlert('success', 'Source removed');
      onReload();
    } catch (e) {
      addAlert('danger', e instanceof Error ? e.message : 'Failed to remove source');
    }
  }

  async function handleBulkDelete(): Promise<void> {
    setDeleting(true);
    try {
      await Promise.all([...selectedIds].map(id => deleteSource(id)));
      setSelectedIds(new Set());
      addAlert('success', `${selectedIds.size} source(s) removed`);
      onReload();
    } catch (e) {
      addAlert('danger', e instanceof Error ? e.message : 'Bulk delete failed');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Card>
      <CardTitle>
        Issues Sources
        <p style={{ color: 'var(--pf-t--global--text--color--subtle)', fontSize: '0.875rem', fontWeight: 'normal', margin: '4px 0 0 0' }}>
          GitHub repositories and Jira boards to watch for issues. Sync to fetch the latest.
        </p>
      </CardTitle>
      <CardBody>
        <Flex gap={{ default: 'gapSm' }} alignItems={{ default: 'alignItemsCenter' }} style={{ marginBottom: '12px' }}>
          <FlexItem flex={{ default: 'flex_1' }}>
            <TextInput
              id="sources-url-input"
              value={newUrl}
              onChange={(_e, v) => setNewUrl(v)}
              placeholder="GitHub repository URL or Jira board URL"
              aria-label="New source URL"
              onKeyDown={e => {
                if (e.key === 'Enter') handleAdd();
              }}
            />
          </FlexItem>
          <FlexItem>
            <Button id="sources-add-btn" variant="primary" isDisabled={adding || !newUrl.trim()} onClick={handleAdd}>
              {adding ? 'Adding…' : 'Add'}
            </Button>
          </FlexItem>
        </Flex>

        <Divider style={{ margin: '0 0 12px' }} />

        <Toolbar>
          <ToolbarContent>
            <ToolbarItem>
              <SearchInput
                id="sources-filter"
                placeholder="Filter by"
                value={srcFilter}
                onChange={(_e, v) => setSrcFilter(v)}
                onClear={() => setSrcFilter('')}
                aria-label="Filter sources"
                style={{ width: '220px' }}
              />
            </ToolbarItem>
            <ToolbarItem>
              <Button
                variant="plain"
                isDanger
                isDisabled={selectedIds.size === 0 || deleting}
                onClick={handleBulkDelete}
                aria-label="Delete selected sources"
              >
                <TrashIcon />
                {selectedIds.size > 0 && <>&nbsp;Delete ({selectedIds.size})</>}
              </Button>
            </ToolbarItem>
          </ToolbarContent>
        </Toolbar>

        {loading ? (
          <Flex justifyContent={{ default: 'justifyContentCenter' }} style={{ padding: '24px' }}>
            <FlexItem>
              <Spinner aria-label="Loading sources" />
            </FlexItem>
          </Flex>
        ) : filtered.length === 0 ? (
          <EmptyState>
            <EmptyStateBody>
              {sources.length === 0
                ? 'No sources yet. Add a GitHub or Jira URL above.'
                : 'No sources match the filter.'}
            </EmptyStateBody>
          </EmptyState>
        ) : (
          <Table id="sources-table" aria-label="Issues Sources" variant="compact">
            <Thead>
              <Tr>
                <Th
                  select={{
                    onSelect: (_e, isSelected) => handleSelectAll(isSelected),
                    isSelected: allSelected,
                  }}
                />
                <Th>Kind</Th>
                <Th>Source</Th>
                <Th>Last synced</Th>
                <Th screenReaderText="Actions" />
              </Tr>
            </Thead>
            <Tbody>
              {filtered.map((src, rowIndex) => (
                <Tr key={src.id}>
                  <Td
                    select={{
                      rowIndex,
                      onSelect: (_e, isSelected) => handleSelectOne(src.id, isSelected),
                      isSelected: selectedIds.has(src.id),
                    }}
                  />
                  <Td>
                    <Label color={src.kind === 'github' ? 'blue' : 'purple'} isCompact>
                      {src.kind}
                    </Label>
                  </Td>
                  <Td>
                    <a href={src.url} target="_blank" rel="noreferrer">
                      {src.label}
                    </a>
                  </Td>
                  <Td>{src.last_synced_at ? new Date(src.last_synced_at).toLocaleString() : 'Never'}</Td>
                  <Td isActionCell>
                    <Dropdown
                      isOpen={openKebab === src.id}
                      onOpenChange={o => setOpenKebab(o ? src.id : null)}
                      toggle={(ref: React.Ref<HTMLButtonElement>) => (
                        <MenuToggle
                          ref={ref}
                          variant="plain"
                          aria-label={`Actions for ${src.label}`}
                          onClick={() => setOpenKebab(openKebab === src.id ? null : src.id)}
                          isExpanded={openKebab === src.id}
                        >
                          <EllipsisVIcon />
                        </MenuToggle>
                      )}
                      popperProps={{ position: 'right' }}
                    >
                      <DropdownList>
                        <DropdownItem onClick={() => { void handleSync(src); setOpenKebab(null); }}>
                          {syncing === src.id ? 'Syncing…' : 'Sync'}
                        </DropdownItem>
                        <DropdownItem isDanger onClick={() => { void handleDeleteOne(src.id); setOpenKebab(null); }}>
                          Delete
                        </DropdownItem>
                      </DropdownList>
                    </Dropdown>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </CardBody>
    </Card>
  );
}

// ── Issue Picker section ──────────────────────────────────────────────────

function IssuePickerSection({ onIssueImported }: { onIssueImported?: () => void }) {
  const { addAlert } = useAlerts();
  const [inputUrl, setInputUrl] = useState('');
  const [forceP, setForceP] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>(() => {
    try { return JSON.parse(localStorage.getItem('dwa_picker_queue') ?? '[]') as QueueItem[]; }
    catch { return []; }
  });
  const [starting, setStarting] = useState<string | null>(null);
  const [queueFilter, setQueueFilter] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [openKebab, setOpenKebab] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem('dwa_picker_queue', JSON.stringify(queue));
  }, [queue]);

  // On mount: re-import all queue items to sync with DB (handles fresh PGlite restarts
  // where issueId from localStorage refers to a row that no longer exists).
  useEffect(() => {
    queue.forEach(item => {
      importIssue(item.url)
        .then(issue => {
          setQueue(prev => prev.map(i =>
            i.key === item.key ? { ...i, issueId: issue.id, title: issue.title } : i));
          onIssueImported?.();
        })
        .catch(() => {
          if (item.issueId !== null) {
            setQueue(prev => prev.map(i =>
              i.key === item.key ? { ...i, issueId: null } : i));
          }
        });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredQueue = useMemo(
    () => queue.filter(i => !queueFilter || i.url.toLowerCase().includes(queueFilter.toLowerCase())),
    [queue, queueFilter],
  );

  const allSelected =
    filteredQueue.length > 0 && filteredQueue.every(i => selectedKeys.has(i.key));

  function handleSelectAll(checked: boolean): void {
    setSelectedKeys(checked ? new Set(filteredQueue.map(i => i.key)) : new Set());
  }

  function handleSelectOne(key: string, checked: boolean): void {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (checked) next.add(key); else next.delete(key);
      return next;
    });
  }

  function handleAddToQueue(): void {
    if (!inputUrl.trim()) return;
    const url = inputUrl.trim();
    const key = `${Date.now()}-${Math.random()}`;
    setQueue(prev => [...prev, { key, issueId: null, url, title: '', forceP }]);
    setInputUrl('');
    importIssue(url)
      .then(issue => {
        setQueue(prev => prev.map(i =>
          i.key === key ? { ...i, issueId: issue.id, title: issue.title } : i));
        onIssueImported?.();
      })
      .catch(() => setQueue(prev => prev.map(i =>
        i.key === key ? { ...i, title: shortenIssueUrl(url) } : i)));
  }

  async function handleStart(item: QueueItem): Promise<void> {
    setStarting(item.key);
    try {
      // Refresh issue data from source before running
      if (item.issueId !== null) {
        await refreshIssue(item.url).catch(() => {});
      }
      const { threadId } = await startRun({ issueUrl: item.url, forcePriority: item.forceP });
      addAlert('success', `Run started — thread: ${threadId.slice(0, 8)}…`);
      setQueue(prev => prev.filter(q => q.key !== item.key));
      setSelectedKeys(prev => { const n = new Set(prev); n.delete(item.key); return n; });
    } catch (e) {
      addAlert('danger', e instanceof Error ? e.message : 'Failed to start run');
    } finally {
      setStarting(null);
    }
  }

  function handleRemove(key: string): void {
    const item = queue.find(i => i.key === key);
    if (item?.issueId !== null && item?.issueId !== undefined) {
      deleteIssue(item.issueId).catch(() => {});
    }
    setQueue(prev => prev.filter(q => q.key !== key));
    setSelectedKeys(prev => { const n = new Set(prev); n.delete(key); return n; });
  }

  function handleBulkDelete(): void {
    queue.filter(i => selectedKeys.has(i.key) && i.issueId !== null)
      .forEach(i => deleteIssue(i.issueId!).catch(() => {}));
    setQueue(prev => prev.filter(i => !selectedKeys.has(i.key)));
    setSelectedKeys(new Set());
  }

  function handleTogglePriority(key: string): void {
    setQueue(prev => prev.map(i => i.key === key ? { ...i, forceP: !i.forceP } : i));
  }

  return (
    <Card>
      <CardTitle>
        Issue Picker
        <p style={{ color: 'var(--pf-t--global--text--color--subtle)', fontSize: '0.875rem', fontWeight: 'normal', margin: '4px 0 0 0' }}>
          Queue specific issues to run. Paste a GitHub or Jira URL, choose the priority mode, then start each run individually.
        </p>
      </CardTitle>
      <CardBody>
        {/* Add row */}
        <Flex gap={{ default: 'gapSm' }} alignItems={{ default: 'alignItemsCenter' }} style={{ marginBottom: '12px' }}>
          <FlexItem flex={{ default: 'flex_1' }}>
            <TextInput
              id="queue-url-input"
              value={inputUrl}
              onChange={(_e, v) => setInputUrl(v)}
              placeholder="GitHub issue URL or Jira URL"
              aria-label="Issue URL"
              onKeyDown={e => { if (e.key === 'Enter') handleAddToQueue(); }}
            />
          </FlexItem>
          <FlexItem>
            <Button id="queue-add-btn" variant="primary" isDisabled={!inputUrl.trim()} onClick={handleAddToQueue}>
              Add
            </Button>
          </FlexItem>
        </Flex>

        <div
          onKeyDown={(e: React.KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setForceP(v => !v); }
          }}
          style={{ marginBottom: '12px' }}
        >
          <Switch
            id="force-priority-switch"
            label={`Priority mode: ${forceP ? 'Force priority' : 'Auto'}`}
            isChecked={forceP}
            onChange={(_e, checked) => setForceP(checked)}
          />
        </div>

        <Divider style={{ margin: '12px 0' }} />

        {/* Toolbar */}
        <Toolbar>
          <ToolbarContent>
            <ToolbarItem>
              <SearchInput
                id="queue-filter"
                placeholder="Filter by"
                value={queueFilter}
                onChange={(_e, v) => setQueueFilter(v)}
                onClear={() => setQueueFilter('')}
                aria-label="Filter queue"
                style={{ width: '220px' }}
              />
            </ToolbarItem>
            <ToolbarItem>
              <Button
                variant="plain"
                isDanger
                isDisabled={selectedKeys.size === 0}
                onClick={handleBulkDelete}
                aria-label="Delete selected queue items"
              >
                <TrashIcon />
                {selectedKeys.size > 0 && <>&nbsp;Delete ({selectedKeys.size})</>}
              </Button>
            </ToolbarItem>
          </ToolbarContent>
        </Toolbar>

        {queue.length === 0 ? (
          <EmptyState>
            <EmptyStateBody>No issues queued. Add an issue URL above.</EmptyStateBody>
          </EmptyState>
        ) : (
          <Table id="queue-table" aria-label="Issue queue" variant="compact">
            <Thead>
              <Tr>
                <Th
                  select={{
                    onSelect: (_e, checked) => handleSelectAll(checked),
                    isSelected: allSelected,
                  }}
                />
                <Th>Issue</Th>
                <Th>Title</Th>
                <Th>Mode</Th>
                <Th screenReaderText="Actions" />
              </Tr>
            </Thead>
            <Tbody>
              {filteredQueue.map(item => (
                <Tr key={item.key}>
                  <Td
                    select={{
                      rowIndex: filteredQueue.indexOf(item),
                      onSelect: (_e, checked) => handleSelectOne(item.key, checked),
                      isSelected: selectedKeys.has(item.key),
                    }}
                  />
                  <Td>
                    {item.url.startsWith('http') ? (
                      <a href={item.url} target="_blank" rel="noreferrer" style={{ fontSize: '0.85rem' }}>
                        {shortenIssueUrl(item.url)}
                      </a>
                    ) : item.url}
                  </Td>
                  <Td>
                    {item.title
                      ? <span style={{ fontSize: '0.9rem' }}>{item.title}</span>
                      : <Spinner size="sm" aria-label="Loading title" />}
                  </Td>
                  <Td>
                    <Label color={item.forceP ? 'orange' : 'blue'} isCompact>
                      {item.forceP ? 'force' : 'auto'}
                    </Label>
                  </Td>
                  <Td isActionCell>
                    <Dropdown
                      isOpen={openKebab === item.key}
                      onOpenChange={o => setOpenKebab(o ? item.key : null)}
                      toggle={(ref: React.Ref<HTMLButtonElement>) => (
                        <MenuToggle
                          ref={ref}
                          variant="plain"
                          aria-label={`Actions for ${shortenIssueUrl(item.url)}`}
                          onClick={() => setOpenKebab(openKebab === item.key ? null : item.key)}
                          isExpanded={openKebab === item.key}
                        >
                          <EllipsisVIcon />
                        </MenuToggle>
                      )}
                      popperProps={{ position: 'right' }}
                    >
                      <DropdownList>
                        <DropdownItem
                          isDisabled={starting !== null}
                          onClick={() => { void handleStart(item); setOpenKebab(null); }}
                        >
                          {starting === item.key ? 'Starting…' : 'Force run'}
                        </DropdownItem>
                        <DropdownItem
                          onClick={() => { handleTogglePriority(item.key); setOpenKebab(null); }}
                        >
                          {item.forceP ? 'Switch to Auto' : 'Switch to Force priority'}
                        </DropdownItem>
                        <DropdownItem
                          isDanger
                          onClick={() => { handleRemove(item.key); setOpenKebab(null); }}
                        >
                          Delete
                        </DropdownItem>
                      </DropdownList>
                    </Dropdown>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </CardBody>
    </Card>
  );
}

// ── All Issues section ────────────────────────────────────────────────────

type IssueView = 'all' | 'prioritized' | 'skipped';

function CveBatchButton() {
  const { addAlert } = useAlerts();
  const [loading, setLoading] = React.useState(false);

  async function handleBatch(): Promise<void> {
    setLoading(true);
    try {
      const result = await triggerCveBatch();
      addAlert('success', `Batch CVE run started (${result.count} issues) — thread: ${result.threadId.slice(-8)}`);
    } catch (e) {
      addAlert('danger', e instanceof Error ? e.message : 'Batch CVE fix failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      id="cve-batch-btn"
      variant="secondary"
      isDisabled={loading}
      onClick={() => void handleBatch()}
      title="Combine all open CVE / Security issues into one PR"
    >
      {loading ? <><Spinner size="sm" /> Running…</> : 'Batch CVE fix'}
    </Button>
  );
}

function AllIssuesSection({
  issues,
  loading,
}: {
  issues: StoredIssue[];
  loading: boolean;
}) {
  const { addAlert } = useAlerts();
  const [view, setView] = useState<IssueView>('all');
  const [search, setSearch] = useState('');
  const [skippedIds, setSkippedIds] = useState<Set<number>>(new Set());
  const [starting, setStarting] = useState<string | null>(null);
  const [openKebab, setOpenKebab] = useState<number | null>(null);
  const [localIssues, setLocalIssues] = useState<StoredIssue[]>(issues);

  React.useEffect(() => { setLocalIssues(issues); }, [issues]);

  const filtered = useMemo(() => {
    let list = localIssues.filter(i => issueMatches(i, search));
    if (view === 'prioritized') list = list.filter(i => isPrioritized(i) && !skippedIds.has(i.id));
    if (view === 'skipped') list = list.filter(i => !isPrioritized(i) || skippedIds.has(i.id));
    return list;
  }, [localIssues, search, view, skippedIds]);

  async function handleStart(issue: StoredIssue, force?: boolean): Promise<void> {
    const key = String(issue.id);
    setStarting(key);
    try {
      const { threadId } = await startRun({ issueUrl: issue.url, forcePriority: force });
      addAlert('success', `Run started — thread: ${threadId.slice(0, 8)}…`);
    } catch (e) {
      addAlert('danger', e instanceof Error ? e.message : 'Failed to start run');
    } finally {
      setStarting(null);
    }
  }

  function handleSkip(id: number): void {
    setSkippedIds(prev => new Set([...prev, id]));
  }

  async function handleDelete(issue: StoredIssue): Promise<void> {
    try {
      await deleteIssue(issue.id);
      setLocalIssues(prev => prev.filter(i => i.id !== issue.id));
      addAlert('success', `Issue ${issue.external_id} removed`);
    } catch (e) {
      addAlert('danger', e instanceof Error ? e.message : 'Failed to delete issue');
    }
  }

  function formatOpened(dateStr: string): string {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  return (
    <Card>
      <CardTitle>
        All Issues
        <p style={{ color: 'var(--pf-t--global--text--color--subtle)', fontSize: '0.875rem', fontWeight: 'normal', margin: '4px 0 0 0' }}>
          Issues fetched from all sources. Prioritized = critical/major. Skipped = minor/trivial.
        </p>
      </CardTitle>
      <CardBody>
        <Flex
          alignItems={{ default: 'alignItemsCenter' }}
          justifyContent={{ default: 'justifyContentSpaceBetween' }}
          style={{ marginBottom: '12px' }}
        >
          <FlexItem>
            <Flex alignItems={{ default: 'alignItemsCenter' }} gap={{ default: 'gapMd' }}>
              <FlexItem>
                <ToggleGroup aria-label="Issue view">
                  <ToggleGroupItem
                    text="All"
                    buttonId="view-all"
                    isSelected={view === 'all'}
                    onChange={() => setView('all')}
                  />
                  <ToggleGroupItem
                    text="Prioritized"
                    buttonId="view-prio"
                    isSelected={view === 'prioritized'}
                    onChange={() => setView('prioritized')}
                  />
                  <ToggleGroupItem
                    text="Skipped"
                    buttonId="view-skip"
                    isSelected={view === 'skipped'}
                    onChange={() => setView('skipped')}
                  />
                </ToggleGroup>
              </FlexItem>
              <FlexItem>
                <span style={{ fontSize: '0.85rem', color: 'var(--pf-t--global--text--color--subtle)' }}>
                  {filtered.length} {filtered.length === 1 ? 'item' : 'items'}
                </span>
              </FlexItem>
            </Flex>
          </FlexItem>
          <FlexItem>
            <Flex gap={{ default: 'gapSm' }} alignItems={{ default: 'alignItemsCenter' }}>
              <FlexItem>
                <CveBatchButton />
              </FlexItem>
              <FlexItem>
            <SearchInput
              id="issues-filter"
              placeholder="Filter by"
              value={search}
              onChange={(_e, v) => setSearch(v)}
              onClear={() => setSearch('')}
              aria-label="Filter issues"
              style={{ width: '220px' }}
            />
              </FlexItem>
            </Flex>
          </FlexItem>
        </Flex>

        {loading ? (
          <Flex justifyContent={{ default: 'justifyContentCenter' }} style={{ padding: '24px' }}>
            <FlexItem>
              <Spinner aria-label="Loading issues" />
            </FlexItem>
          </Flex>
        ) : filtered.length === 0 ? (
          <EmptyState>
            <EmptyStateBody>
              {issues.length === 0
                ? 'No issues yet — add a source and sync it.'
                : 'No issues match the current filter.'}
            </EmptyStateBody>
          </EmptyState>
        ) : (
          <Table id="issues-table" aria-label="All Issues" variant="compact">
            <Thead>
              <Tr>
                <Th>ID</Th>
                <Th>Title</Th>
                <Th>Opened</Th>
                <Th>Priority</Th>
                <Th>SP</Th>
                <Th screenReaderText="Actions" />
              </Tr>
            </Thead>
            <Tbody>
              {filtered.map(issue => {
                const key = String(issue.id);
                const isStarting = starting === key;
                const shortTitle = issue.title.length > 60
                  ? `${issue.title.slice(0, 60)}…`
                  : issue.title;
                return (
                  <Tr key={issue.id}>
                    <Td>
                      <a href={issue.url} target="_blank" rel="noreferrer">
                        {issue.source_kind === 'github' ? `#${issue.external_id}` : issue.external_id}
                      </a>
                    </Td>
                    <Td>
                      <Tooltip
                        content={issue.body || issue.title}
                        isVisible={undefined}
                        position="bottom"
                      >
                        <div style={{ cursor: 'default' }}>{shortTitle}</div>
                      </Tooltip>
                      <Flex gap={{ default: 'gapXs' }} style={{ marginTop: '4px' }}>
                        {issue.labels.slice(0, 3).map(l => (
                          <FlexItem key={l}>
                            <Label isCompact>{l}</Label>
                          </FlexItem>
                        ))}
                      </Flex>
                    </Td>
                    <Td style={{ whiteSpace: 'nowrap', color: 'var(--pf-t--global--text--color--subtle)', fontSize: '0.85rem' }}>
                      {formatOpened(issue.fetched_at)}
                    </Td>
                    <Td>
                      {issue.priority && (
                        <Label color={PRIORITY_COLOR[issue.priority] ?? 'grey'} isCompact>
                          {issue.priority}
                        </Label>
                      )}
                    </Td>
                    <Td>{issue.story_points || '?'}</Td>
                    <Td isActionCell>
                      <Dropdown
                        isOpen={openKebab === issue.id}
                        onOpenChange={o => setOpenKebab(o ? issue.id : null)}
                        toggle={(ref: React.Ref<HTMLButtonElement>) => (
                          <MenuToggle
                            ref={ref}
                            variant="plain"
                            aria-label={`Actions for ${issue.external_id}`}
                            onClick={() => setOpenKebab(openKebab === issue.id ? null : issue.id)}
                            isExpanded={openKebab === issue.id}
                          >
                            <EllipsisVIcon />
                          </MenuToggle>
                        )}
                        popperProps={{ position: 'right' }}
                      >
                        <DropdownList>
                          <DropdownItem
                            isDisabled={starting !== null}
                            onClick={() => { void handleStart(issue); setOpenKebab(null); }}
                          >
                            {isStarting ? 'Starting…' : 'Force run'}
                          </DropdownItem>
                          {view === 'prioritized' && (
                            <DropdownItem onClick={() => { handleSkip(issue.id); setOpenKebab(null); }}>
                              Skip
                            </DropdownItem>
                          )}
                          {view === 'skipped' && (
                            <DropdownItem
                              isDisabled={starting !== null}
                              onClick={() => { void handleStart(issue, true); setOpenKebab(null); }}
                            >
                              Force priority
                            </DropdownItem>
                          )}
                          <DropdownItem
                            isDanger
                            onClick={() => { void handleDelete(issue); setOpenKebab(null); }}
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
  );
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function Issues() {
  const [sources, setSources] = useState<IssueSource[]>([]);
  const [issues, setIssues] = useState<StoredIssue[]>([]);
  const [srcLoading, setSrcLoading] = useState(true);
  const [issueLoading, setIssueLoading] = useState(true);

  const loadSources = useCallback(async () => {
    try {
      const s = await getSources();
      setSources(s);
    } catch {
      /* ignore — alerts shown in sub-components */
    } finally {
      setSrcLoading(false);
    }
  }, []);

  const loadIssues = useCallback(async () => {
    try {
      const i = await getAllIssues();
      setIssues(i);
    } catch {
      /* ignore */
    } finally {
      setIssueLoading(false);
    }
  }, []);

  function handleReload(): void {
    loadSources();
    loadIssues();
  }

  useEffect(() => {
    handleReload();
  }, []);

  return (
    <>
      <PageSection>
        <Title headingLevel="h1" size="xl">Issues</Title>
      </PageSection>

      <PageSection>
        <IssuesSourcesSection sources={sources} loading={srcLoading} onReload={handleReload} />
      </PageSection>

      <PageSection>
        <IssuePickerSection onIssueImported={loadIssues} />
      </PageSection>

      <PageSection>
        <AllIssuesSection issues={issues} loading={issueLoading} />
      </PageSection>
    </>
  );
}
