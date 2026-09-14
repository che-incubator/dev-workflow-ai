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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAlerts } from '../contexts/AlertContext.js';
import {
  ActionList,
  ActionListItem,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  EmptyStateBody,
  Flex,
  FlexItem,
  Form,
  FormGroup,
  Gallery,
  GalleryItem,
  MenuToggle,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  PageSection,
  Select,
  SelectList,
  SelectOption,
  Spinner,
  TextArea,
  TextInput,
  Title,
  Tooltip,
} from '@patternfly/react-core';
import { CubesIcon, PencilAltIcon, PlusCircleIcon, SyncAltIcon, TrashIcon } from '@patternfly/react-icons';
import {
  AgentRun,
  createProject,
  deleteProject,
  getProjects,
  getRuns,
  Project,
  updateProject,
  updateProjectRepo,
} from '../api/client.js';
import styles from './Projects.module.css';

const PRIORITY_OPTS = ['critical', 'major', 'minor', 'trivial'];

const PRIORITY_COLOR: Record<string, string> = {
  critical: 'var(--pf-t--global--color--status--danger--default)',
  major:    'var(--pf-t--global--color--status--warning--default)',
  minor:    'var(--pf-t--global--color--status--info--default)',
  trivial:  'var(--pf-t--global--text--color--subtle)',
};

function ownerFromRepo(repo: string): string {
  return repo.split('/')[0] ?? '';
}

function githubAvatarUrl(repo: string): string {
  const owner = ownerFromRepo(repo);
  return owner ? `https://github.com/${owner}.png?size=40` : '';
}

function projectMatches(p: Project, filter: string): boolean {
  if (!filter) return true;
  const q = filter.toLowerCase();
  return (
    p.name.toLowerCase().includes(q) ||
    p.repo.toLowerCase().includes(q) ||
    (p.description ?? '').toLowerCase().includes(q) ||
    (p.stack ?? []).some(t => t.toLowerCase().includes(q))
  );
}

const EMPTY_FORM = {
  name: '',
  repo: '',
  description: '',
  auto_approve_min_priority: 'major',
  story_point_budget: 3,
};

// ── Project avatar — GitHub org/user PNG with CubesIcon fallback ──────────

function ProjectAvatar({ repo }: { repo: string }) {
  const [error, setError] = useState(false);
  const src = githubAvatarUrl(repo);

  if (!src || error) {
    return <CubesIcon className={styles.projectIcon} aria-hidden />;
  }
  return (
    <img
      src={src}
      alt={ownerFromRepo(repo)}
      className={styles.projectIcon}
      onError={() => setError(true)}
    />
  );
}

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addPriorityOpen, setAddPriorityOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const [editTarget, setEditTarget] = useState<Project | null>(null);
  const [editPriorityOpen, setEditPriorityOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    description: '',
    auto_approve_min_priority: 'major',
    story_point_budget: 3,
  });
  const [editSaving, setEditSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [updatingName, setUpdatingName] = useState<string | null>(null);
  const [runningRepos, setRunningRepos] = useState<Set<string>>(new Set());
  const { addAlert } = useAlerts();

  const filterRef = useRef<HTMLInputElement>(null);

  const load = () =>
    getProjects()
      .then(setProjects)
      .finally(() => setLoading(false));

  const loadRuns = () =>
    getRuns()
      .then(runs => setRunningRepos(new Set(runs.filter(r => r.status === 'running').map(r => r.repo).filter(Boolean))))
      .catch(() => {});

  useEffect(() => {
    load();
    loadRuns();
    const id = setInterval(loadRuns, 10_000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(
    () =>
      projects
        .filter(p => projectMatches(p, filter))
        .sort((a, b) => a.repo.localeCompare(b.repo)),
    [projects, filter],
  );

  const handleAdd = async () => {
    if (!form.name || !form.repo) return;
    setSaving(true);
    try {
      await createProject(form);
      addAlert('success', `Project "${form.name}" added`);
      setShowAdd(false);
      setForm({ ...EMPTY_FORM });
      load();
    } catch (e) {
      addAlert('danger', e instanceof Error ? e.message : 'Failed to add project');
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (p: Project) => {
    setEditTarget(p);
    setEditForm({
      description: p.description ?? '',
      auto_approve_min_priority: p.auto_approve_min_priority ?? 'major',
      story_point_budget: p.story_point_budget ?? 3,
    });
  };

  const handleEdit = async () => {
    if (!editTarget) return;
    setEditSaving(true);
    try {
      await updateProject(editTarget.name, editForm);
      addAlert('success', `Project "${editTarget.name}" updated`);
      setEditTarget(null);
      load();
    } catch (e) {
      addAlert('danger', e instanceof Error ? e.message : 'Failed to update project');
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteProject(deleteTarget.name);
      addAlert('success', `Project "${deleteTarget.name}" deleted`);
      setDeleteTarget(null);
      load();
    } catch (e) {
      addAlert('danger', e instanceof Error ? e.message : 'Failed to delete project');
    } finally {
      setDeleting(false);
    }
  };

  const handleUpdate = async (p: Project) => {
    setUpdatingName(p.name);
    try {
      const { cloned } = await updateProjectRepo(p.name);
      addAlert('success', `${p.name}: ${cloned ? 'cloned successfully' : 'pulled latest changes'}`);
      load();
    } catch (e) {
      addAlert('danger', e instanceof Error ? e.message : `Failed to update ${p.name}`);
    } finally {
      setUpdatingName(null);
    }
  };

  return (
    <>
      <PageSection>
        <Flex
          alignItems={{ default: 'alignItemsCenter' }}
          justifyContent={{ default: 'justifyContentSpaceBetween' }}
        >
          <FlexItem>
            <Title headingLevel="h1" size="xl">Subprojects</Title>
          </FlexItem>
          <FlexItem>
            <Button variant="link" icon={<PlusCircleIcon />} iconPosition="start" onClick={() => setShowAdd(true)}>
              Add project
            </Button>
          </FlexItem>
        </Flex>
      </PageSection>

      <PageSection>
        {!loading && projects.length > 0 && (
          <Flex alignItems={{ default: 'alignItemsCenter' }} gap={{ default: 'gapMd' }} className={styles.filterRow}>
            <FlexItem>
              <TextInput
                ref={filterRef}
                aria-label="Filter subprojects"
                placeholder="Filter by"
                value={filter}
                onChange={(_e, v) => setFilter(v)}
                className={styles.filterInput}
              />
            </FlexItem>
            <FlexItem>
              <span className={styles.itemCount}>
                {filtered.length} {filtered.length === 1 ? 'item' : 'items'}
              </span>
            </FlexItem>
          </Flex>
        )}

        {loading ? (
          <Flex justifyContent={{ default: 'justifyContentCenter' }} style={{ marginTop: '2rem' }}>
            <FlexItem><Spinner aria-label="Loading projects" /></FlexItem>
          </Flex>
        ) : filtered.length === 0 ? (
          <EmptyState>
            <EmptyStateBody>
              {filter
                ? `No projects match "${filter}".`
                : 'No projects yet. Click "+ Add project" or run yarn init-db.'}
            </EmptyStateBody>
          </EmptyState>
        ) : (
          <Gallery hasGutter minWidths={{ default: '280px' }} className={styles.gallery}>
            {filtered.map(p => {
              const isUpdating = updatingName === p.name;
              const isRepoRunning = runningRepos.has(p.repo);
              const visibleStack = (p.stack ?? []).slice(0, 3);

              return (
                <GalleryItem key={p.name}>
                  <Card isCompact className={styles.projectCard} aria-label={p.name}>
                    <CardHeader
                      actions={{
                        actions: (
                          <ActionList isIconList>
                            <ActionListItem>
                              <Tooltip content={isRepoRunning ? 'Agent is running on this repo' : 'Clone / pull'}>
                                <Button
                                  variant="plain"
                                  aria-label="Update repo"
                                  isDisabled={isUpdating || isRepoRunning}
                                  onClick={() => handleUpdate(p)}
                                >
                                  {isUpdating ? <Spinner size="sm" /> : <SyncAltIcon />}
                                </Button>
                              </Tooltip>
                            </ActionListItem>
                            <ActionListItem>
                              <Tooltip content="Edit settings">
                                <Button variant="plain" aria-label="Edit project" onClick={() => openEdit(p)}>
                                  <PencilAltIcon />
                                </Button>
                              </Tooltip>
                            </ActionListItem>
                            <ActionListItem>
                              <Tooltip content={isRepoRunning ? 'Agent is running on this repo' : 'Delete project'}>
                                <Button
                                  variant="plain"
                                  aria-label="Delete project"
                                  isDisabled={isRepoRunning}
                                  onClick={() => !isRepoRunning && setDeleteTarget(p)}
                                  className={styles.deleteBtn}
                                >
                                  <TrashIcon />
                                </Button>
                              </Tooltip>
                            </ActionListItem>
                          </ActionList>
                        ),
                      }}
                    >
                      <ProjectAvatar repo={p.repo} />
                      <CardTitle className={styles.projectSlug}>{p.name}</CardTitle>
                    </CardHeader>

                    <CardBody>
                      {p.repo && (
                        <a
                          href={`https://github.com/${p.repo}`}
                          target="_blank"
                          rel="noreferrer"
                          className={styles.repoLink}
                        >
                          {p.repo}
                        </a>
                      )}

                      {visibleStack.length > 0 && (
                        <Flex gap={{ default: 'gapXs' }} flexWrap={{ default: 'nowrap' }} className={styles.stackRow}>
                          {visibleStack.map(t => (
                            <FlexItem key={t}>
                              <Badge isRead className={styles.stackBadge}>{t}</Badge>
                            </FlexItem>
                          ))}
                        </Flex>
                      )}

                      {p.description && (
                        <p className={styles.description}>{p.description}</p>
                      )}

                      <p className={styles.meta}>
                        Auto-approve: <strong>{p.auto_approve_min_priority}</strong>
                        {' · '}
                        Budget: <strong>{p.story_point_budget} SP</strong>
                      </p>
                      <p className={styles.metaRow}>
                        <span className={styles.metaLabel}>Last update:</span>{' '}
                        {p.updated_at ? (
                          <span>{new Date(p.updated_at).toLocaleString()}</span>
                        ) : (
                          <span className={styles.metaDash}>—</span>
                        )}
                      </p>
                      <p className={styles.metaRow}>
                        <span className={styles.metaLabel}>Path:</span>{' '}
                        {p.local_path ? (
                          <span className={styles.localPath}>{p.local_path}</span>
                        ) : (
                          <span className={styles.metaDash}>—</span>
                        )}
                      </p>
                    </CardBody>
                  </Card>
                </GalleryItem>
              );
            })}
          </Gallery>
        )}
      </PageSection>

      {/* ── Add Project modal ── */}
      <Modal isOpen={showAdd} onClose={() => setShowAdd(false)} variant="small" aria-labelledby="add-project-title">
        <ModalHeader title="Add Project" labelId="add-project-title" />
        <ModalBody>
          <Form>
            <FormGroup label="Name" isRequired fieldId="add-name">
              <TextInput
                id="add-name"
                value={form.name}
                onChange={(_e, v) => setForm(p => ({ ...p, name: v }))}
                placeholder="my-service"
                className={styles.shortInput}
              />
            </FormGroup>
            <FormGroup label="GitHub repo" isRequired fieldId="add-repo">
              <TextInput
                id="add-repo"
                value={form.repo}
                onChange={(_e, v) => setForm(p => ({ ...p, repo: v }))}
                placeholder="owner/repo"
                className={styles.shortInput}
              />
            </FormGroup>
            <FormGroup label="Description" fieldId="add-description">
              <TextArea
                id="add-description"
                value={form.description}
                onChange={(_e, v) => setForm(p => ({ ...p, description: v }))}
                placeholder="Short description of the project"
                rows={3}
                autoResize
              />
            </FormGroup>
            <AutoApproveRow
              priorityId="add-priority"
              budgetId="add-budget"
              priorityValue={form.auto_approve_min_priority}
              priorityOpen={addPriorityOpen}
              onPriorityToggle={setAddPriorityOpen}
              onPriorityChange={v => setForm(p => ({ ...p, auto_approve_min_priority: v }))}
              budgetValue={form.story_point_budget}
              onBudgetChange={v => setForm(p => ({ ...p, story_point_budget: v }))}
            />
          </Form>
        </ModalBody>
        <ModalFooter>
          <Button variant="primary" isDisabled={saving || !form.name || !form.repo} onClick={handleAdd}>
            {saving ? 'Saving…' : 'Add Project'}
          </Button>
          <Button variant="link" onClick={() => setShowAdd(false)}>Cancel</Button>
        </ModalFooter>
      </Modal>

      {/* ── Edit modal ── */}
      {editTarget && (
        <Modal isOpen onClose={() => setEditTarget(null)} variant="small" aria-labelledby="edit-project-title">
          <ModalHeader title={`Edit — ${editTarget.name}`} labelId="edit-project-title" />
          <ModalBody>
            <Form>
              <FormGroup label="Description" fieldId="edit-description">
                <TextArea
                  id="edit-description"
                  value={editForm.description}
                  onChange={(_e, v) => setEditForm(p => ({ ...p, description: v }))}
                  placeholder="Short description of the project"
                  rows={3}
                  autoResize
                />
              </FormGroup>
              <AutoApproveRow
                priorityId="edit-priority"
                budgetId="edit-budget"
                priorityValue={editForm.auto_approve_min_priority}
                priorityOpen={editPriorityOpen}
                onPriorityToggle={setEditPriorityOpen}
                onPriorityChange={v => setEditForm(p => ({ ...p, auto_approve_min_priority: v }))}
                budgetValue={editForm.story_point_budget}
                onBudgetChange={v => setEditForm(p => ({ ...p, story_point_budget: v }))}
              />
            </Form>
          </ModalBody>
          <ModalFooter>
            <Button variant="primary" isDisabled={editSaving} onClick={handleEdit}>
              {editSaving ? 'Saving…' : 'Update'}
            </Button>
            <Button variant="link" onClick={() => setEditTarget(null)}>Cancel</Button>
          </ModalFooter>
        </Modal>
      )}

      {/* ── Delete confirmation ── */}
      {deleteTarget && (
        <Modal isOpen onClose={() => setDeleteTarget(null)} variant="small" aria-labelledby="delete-project-title">
          <ModalHeader title="Delete project?" labelId="delete-project-title" />
          <ModalBody>
            <p>
              Delete <strong>{deleteTarget.name}</strong>?
              {deleteTarget.local_path && (
                <> The cloned repository at <code>{deleteTarget.local_path}</code> will also be removed.</>
              )}
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="danger" isDisabled={deleting} onClick={handleDelete}>
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
            <Button variant="link" onClick={() => setDeleteTarget(null)}>Cancel</Button>
          </ModalFooter>
        </Modal>
      )}
    </>
  );
}

// ── Shared auto-approve row (priority + budget) ───────────────────────────

function AutoApproveRow({
  priorityId,
  budgetId,
  priorityValue,
  priorityOpen,
  onPriorityToggle,
  onPriorityChange,
  budgetValue,
  onBudgetChange,
}: {
  priorityId: string;
  budgetId: string;
  priorityValue: string;
  priorityOpen: boolean;
  onPriorityToggle: (o: boolean) => void;
  onPriorityChange: (v: string) => void;
  budgetValue: number;
  onBudgetChange: (v: number) => void;
}) {
  return (
    <Flex gap={{ default: 'gapMd' }} alignItems={{ default: 'alignItemsFlexEnd' }}>
      <FlexItem>
        <FormGroup label="Auto-approve min priority" fieldId={priorityId}>
          <Select
            id={priorityId}
            isOpen={priorityOpen}
            selected={priorityValue}
            onSelect={(_e, val) => { onPriorityChange(String(val)); onPriorityToggle(false); }}
            onOpenChange={onPriorityToggle}
            toggle={(ref: React.Ref<HTMLButtonElement>) => (
              <MenuToggle
                ref={ref}
                onClick={() => onPriorityToggle(!priorityOpen)}
                isExpanded={priorityOpen}
                style={{ minWidth: '120px' }}
              >
                <span
                  className={styles.priorityDot}
                  style={{ backgroundColor: PRIORITY_COLOR[priorityValue] ?? '#888' }}
                />
                {priorityValue}
              </MenuToggle>
            )}
          >
            <SelectList>
              {PRIORITY_OPTS.map(o => (
                <SelectOption key={o} value={o}>
                  <span
                    className={styles.priorityDot}
                    style={{ backgroundColor: PRIORITY_COLOR[o] ?? '#888' }}
                  />
                  {o}
                </SelectOption>
              ))}
            </SelectList>
          </Select>
        </FormGroup>
      </FlexItem>
      <FlexItem>
        <FormGroup label="Max story points" fieldId={budgetId}>
          <TextInput
            id={budgetId}
            type="number"
            value={String(budgetValue)}
            onChange={(_e, v) => onBudgetChange(parseInt(v) || 1)}
            style={{ width: '64px' }}
          />
        </FormGroup>
      </FlexItem>
    </Flex>
  );
}
