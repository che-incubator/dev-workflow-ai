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

import React, { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Card,
  CardBody,
  CardTitle,
  DataList,
  DataListCell,
  DataListItem,
  DataListItemCells,
  DataListItemRow,
  Divider,
  Dropdown,
  DropdownItem,
  DropdownList,
  EmptyState,
  EmptyStateActions,
  EmptyStateBody,
  EmptyStateFooter,
  EmptyStateVariant,
  Flex,
  FlexItem,
  Form,
  FormGroup,
  FormGroupLabelHelp,
  Label,
  MenuToggle,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  PageSection,
  Popover,
  Select,
  SelectList,
  SelectOption,
  Spinner,
  Switch,
  TextArea,
  TextInput,
  Title,
} from '@patternfly/react-core';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import {
  CheckCircleIcon,
  CubesIcon,
  EllipsisVIcon,
  ExternalLinkAltIcon,
  PlusCircleIcon,
} from '@patternfly/react-icons';
import { useAlerts } from '../contexts/AlertContext.js';
import {
  AppSettings,
  LLMProvider,
  SamplePack,
  deleteProvider,
  exportKnowledge,
  getProviders,
  getSettings,
  getSamplePacks,
  loadSamplePack,
  ProviderHealthResult,
  saveSettings,
  testAllProviders,
  testProvider,
  triggerAutorun,
  upsertProvider,
} from '../api/client.js';

// ── helpers ────────────────────────────────────────────────────────────────

const PRIORITIES = ['critical', 'major', 'minor', 'trivial'];

const PROVIDER_DEFAULT_MODEL: Record<string, string> = {
  vertex:    'claude-sonnet-4-6@default',
  anthropic: 'claude-sonnet-4-6',
  openai:    'gpt-4o',
  gemini:    'gemini-3.6-flash',
  ollama:    'qwen2.5-coder:7b',
};

const PROVIDER_MODELS: Record<string, string[]> = {
  vertex: [
    'claude-sonnet-4-6@default',
    'claude-opus-4-6@default',
    'claude-sonnet-4-5@20250929',
    'claude-haiku-4-5@20251001',
    'claude-opus-4-5@20251101',
  ],
  anthropic: [
    'claude-sonnet-4-6',
    'claude-opus-4-6',
    'claude-haiku-4-5-20251001',
    'claude-sonnet-4-5-20250929',
    'claude-opus-4-5-20251101',
  ],
  openai: [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4-turbo',
    'o1',
    'o1-mini',
  ],
  gemini: [
    'gemini-3.6-flash',
    'gemini-3.6-pro',
    'gemini-2.0-pro',
  ],
  ollama: [
    'qwen2.5-coder:7b',
    'qwen2.5-coder:14b',
    'qwen2.5-coder:32b',
    'llama3.2',
    'llama3.1:8b',
    'mistral',
    'codestral',
    'deepseek-coder-v2',
  ],
};

const PROVIDER_META: Record<string, {
  key: string;
  keyPlaceholder: string;
  urlLabel?: string;
  urlPlaceholder?: string;
  noKey?: boolean;
}> = {
  vertex:    { key: 'GCP Project ID', keyPlaceholder: 'my-gcp-project', urlLabel: 'Region', urlPlaceholder: 'us-east5' },
  anthropic: { key: 'API key', keyPlaceholder: 'sk-ant-…' },
  openai:    { key: 'API key', keyPlaceholder: 'sk-…' },
  gemini:    { key: 'API key', keyPlaceholder: 'AIza…' },
  ollama:    { key: '', keyPlaceholder: '', noKey: true, urlLabel: 'Base URL', urlPlaceholder: 'http://ollama:11434' },
};

const KNOWN_PROVIDERS = ['vertex', 'anthropic', 'openai', 'gemini', 'ollama'];

function providerMeta(id: string) {
  return PROVIDER_META[id] ?? { key: 'API key', keyPlaceholder: 'Paste key…' };
}

function parseErrorBody(raw: string): { message: string; hint?: string } {
  const jsonMatch = raw.match(/\{.*\}/s);
  if (jsonMatch) {
    try {
      const body = JSON.parse(jsonMatch[0]) as { error?: string; hint?: string };
      return { message: body.error ?? raw, hint: body.hint };
    } catch { /* fall through */ }
  }
  return { message: raw };
}

const WIDGET_DESC: React.CSSProperties = {
  color: 'var(--pf-t--global--text--color--subtle)',
  fontSize: '0.875rem',
  fontWeight: 'normal',
  margin: '4px 0 0 0',
};

const FIELD_LABEL: React.CSSProperties = {
  minWidth: '200px',
  whiteSpace: 'nowrap',
  fontSize: '0.9rem',
};

// ── AI Providers ───────────────────────────────────────────────────────────

const EMPTY_ADD = { provider_id: '', label: '', api_key: '', model: '', base_url: '' };
type ProviderForm = typeof EMPTY_ADD;

interface AIProvidersProps {
  /** Currently pending active provider ID (not yet saved to DB) */
  pendingActiveId: string | null;
  onPendingActiveChange: (id: string) => void;
  /** Reload trigger: incremented by parent on Save/Cancel to force a fresh fetch */
  reloadKey: number;
  /** Providers added in the UI but not yet persisted (cleared on Cancel, saved on Save) */
  pendingProviders: ProviderForm[];
  onPendingProvidersChange: (providers: ProviderForm[]) => void;
}

function AIProviders({ pendingActiveId, onPendingActiveChange, reloadKey, pendingProviders, onPendingProvidersChange }: AIProvidersProps) {
  const [providers, setProviders] = useState<LLMProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [openKebab, setOpenKebab] = useState<string | null>(null);

  // Add modal
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState<ProviderForm>({ ...EMPTY_ADD });
  const [addProviderOpen, setAddProviderOpen] = useState(false);
  const [addModelOpen, setAddModelOpen] = useState(false);
  const [adding, setAdding] = useState(false);


  // Edit modal
  const [editTarget, setEditTarget] = useState<LLMProvider | null>(null);
  const [editForm, setEditForm] = useState<ProviderForm>({ ...EMPTY_ADD });
  const [editSaving, setEditSaving] = useState(false);

  // Test
  const [testPrompt, setTestPrompt] = useState('What model are you and who made you? One sentence.');
  const [testResponse, setTestResponse] = useState('');
  const [testHint, setTestHint] = useState('');
  const [testing, setTesting] = useState(false);
  const [healthChecking, setHealthChecking] = useState(false);
  const [healthResults, setHealthResults] = useState<ProviderHealthResult[]>([]);

  const { addAlert } = useAlerts();

  const load = useCallback(() => {
    setLoading(true);
    getProviders().then(setProviders).catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load, reloadKey]);

  const handleDelete = async (providerId: string) => {
    try {
      await deleteProvider(providerId);
      addAlert('success', 'Provider removed');
      load();
    } catch (e) { addAlert('danger', e instanceof Error ? e.message : String(e)); }
  };

  const [editOriginal, setEditOriginal] = useState<ProviderForm>({ ...EMPTY_ADD });

  const openEdit = (p: LLMProvider) => {
    const form = { provider_id: p.provider_id, label: p.label, api_key: '', model: p.model ?? '', base_url: p.base_url ?? '' };
    setEditTarget(p);
    setEditForm(form);
    setEditOriginal(form);
  };

  const handleEditSave = async () => {
    if (!editTarget) return;
    setEditSaving(true);
    try {
      const patch: Partial<LLMProvider> & { provider_id: string } = {
        provider_id: editTarget.provider_id,
        label: editForm.label || editTarget.label,
        model: editForm.model,
        base_url: editForm.base_url,
      };
      if (editForm.api_key) patch.api_key = editForm.api_key;
      await upsertProvider(patch);
      addAlert('success', `${editTarget.label} updated`);
      setEditTarget(null);
      load();
    } catch (e) {
      addAlert('danger', e instanceof Error ? e.message : String(e));
    } finally {
      setEditSaving(false);
    }
  };

  const handleAdd = () => {
    if (!addForm.provider_id) return;
    // Stage the new provider — it will be persisted when the parent saves
    onPendingProvidersChange([...pendingProviders, { ...addForm, label: addForm.label || addForm.provider_id }]);
    setShowAdd(false);
    setAddForm({ ...EMPTY_ADD });
  };

  const handleTest = async () => {
    if (!testPrompt.trim()) return;
    setTesting(true); setTestResponse(''); setTestHint('');
    try {
      const result = await testProvider(testPrompt, pendingActiveId ?? undefined);
      setTestResponse(result.response);
      if ('note' in result) setTestHint(String((result as Record<string, unknown>).note ?? ''));
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const { message, hint } = parseErrorBody(raw);
      if (hint) setTestHint(hint);
      setTestResponse(`Error: ${message}`);
    } finally {
      setTesting(false);
    }
  };

  const existingIds = new Set([...providers.map(p => p.provider_id), ...pendingProviders.map(p => p.provider_id)]);
  const availableToAdd = KNOWN_PROVIDERS.filter(id => !existingIds.has(id));
  const addMeta = providerMeta(addForm.provider_id);
  const editMeta = editTarget ? providerMeta(editTarget.provider_id) : null;

  return (
    <PageSection>
      <Card>
        <CardTitle>
          <Flex alignItems={{ default: 'alignItemsCenter' }} justifyContent={{ default: 'justifyContentSpaceBetween' }}>
            <FlexItem>
              AI Providers
              <p style={WIDGET_DESC}>
                Configure LLM backends. Click a provider name to select it as active, then save.
              </p>
            </FlexItem>
            <FlexItem>
              <Button variant="link" icon={<PlusCircleIcon />} iconPosition="start"
                onClick={() => setShowAdd(true)} isDisabled={availableToAdd.length === 0}>
                Add provider
              </Button>
            </FlexItem>
          </Flex>
        </CardTitle>
        <CardBody>
          <Divider />

          {/* ── Table ── */}
          {loading ? (
            <Spinner size="md" aria-label="Loading" style={{ margin: '16px 0' }} />
          ) : providers.length === 0 ? (
            <EmptyState
              style={{ minHeight: '180px' }}
              variant={EmptyStateVariant.full}
              headingLevel="h2"
              icon={CubesIcon}
              titleText="No providers"
            >
              <EmptyStateBody>
                Providers are seeded automatically on server start.
              </EmptyStateBody>
              <EmptyStateFooter>
                <EmptyStateActions>
                  <Button variant="link" onClick={load}>Reload</Button>
                </EmptyStateActions>
              </EmptyStateFooter>
            </EmptyState>
          ) : (
            <Table aria-label="AI providers" variant="compact">
              <Thead>
                <Tr>
                  <Th style={{ minWidth: '235px' }}>Provider</Th>
                  <Th>Credential</Th>
                  <Th>Model</Th>
                  <Th>Region / URL</Th>
                  <Th screenReaderText="Actions" />
                </Tr>
              </Thead>
              <Tbody>
                {providers.map(p => {
                  const meta = providerMeta(p.provider_id);
                  const isKebabOpen = openKebab === p.provider_id;
                  const isPendingActive = p.provider_id === pendingActiveId;

                  return (
                    <Tr key={p.provider_id}>
                      {/* Provider name — click to select as active */}
                      <Td style={{ minWidth: '235px' }}>
                        <Flex gap={{ default: 'gapSm' }} alignItems={{ default: 'alignItemsCenter' }}>
                          {isPendingActive ? (
                            <strong>{p.label}</strong>
                          ) : (
                            <Button variant="link" isInline onClick={() => onPendingActiveChange(p.provider_id)}
                              title="Click to set as active (then Save)">
                              {p.label}
                            </Button>
                          )}
                          {isPendingActive && <Label color="green" isCompact>Active</Label>}
                        </Flex>
                      </Td>

                      {/* Credential */}
                      <Td>
                        {meta.noKey ? (
                          <span style={{ color: 'var(--pf-t--global--text--color--subtle)', fontSize: '0.8rem' }}>—</span>
                        ) : p.api_key === '***' ? (
                          <Label color="green" isCompact><CheckCircleIcon /> {meta.key} set</Label>
                        ) : (
                          <Label color="grey" isCompact>No {meta.key}</Label>
                        )}
                      </Td>

                      {/* Model */}
                      <Td>
                        <span style={{ fontSize: '0.85rem' }}>
                          {p.model || <span style={{ color: 'var(--pf-t--global--text--color--subtle)' }}>—</span>}
                        </span>
                      </Td>

                      {/* Region / URL */}
                      <Td>
                        {p.base_url ? (
                          <span style={{ fontSize: '0.85rem', color: 'var(--pf-t--global--text--color--subtle)' }}>
                            {meta.urlLabel ? `${meta.urlLabel}: ${p.base_url}` : p.base_url}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--pf-t--global--text--color--subtle)', fontSize: '0.8rem' }}>—</span>
                        )}
                      </Td>

                      {/* Actions */}
                      <Td isActionCell>
                        <Dropdown
                          isOpen={isKebabOpen}
                          onOpenChange={o => setOpenKebab(o ? p.provider_id : null)}
                          toggle={ref => (
                            <MenuToggle ref={ref} variant="plain"
                              onClick={() => setOpenKebab(isKebabOpen ? null : p.provider_id)}
                              aria-label={`Actions for ${p.label}`}>
                              <EllipsisVIcon />
                            </MenuToggle>
                          )}
                          popperProps={{ position: 'right' }}
                        >
                          <DropdownList>
                            {!isPendingActive && (
                              <DropdownItem onClick={() => { setOpenKebab(null); onPendingActiveChange(p.provider_id); }}>
                                Set active
                              </DropdownItem>
                            )}
                            <DropdownItem onClick={() => { setOpenKebab(null); openEdit(p); }}>
                              Edit
                            </DropdownItem>
                            <DropdownItem isDanger onClick={() => { setOpenKebab(null); handleDelete(p.provider_id); }}>
                              Remove
                            </DropdownItem>
                          </DropdownList>
                        </Dropdown>
                      </Td>
                    </Tr>
                  );
                })}
                {/* Pending (staged) providers — shown before Save */}
                {pendingProviders.map((p, idx) => {
                  const meta = providerMeta(p.provider_id);
                  return (
                    <Tr key={`pending-${p.provider_id}`} style={{ opacity: 0.85 }}>
                      <Td style={{ minWidth: '235px' }}>
                        <Flex gap={{ default: 'gapSm' }} alignItems={{ default: 'alignItemsCenter' }}>
                          <span>{p.label}</span>
                          <Label color="orange" isCompact>Unsaved</Label>
                        </Flex>
                      </Td>
                      <Td>
                        {meta.noKey ? (
                          <span style={{ color: 'var(--pf-t--global--text--color--subtle)', fontSize: '0.8rem' }}>—</span>
                        ) : p.api_key ? (
                          <Label color="green" isCompact>{meta.key} set</Label>
                        ) : (
                          <Label color="grey" isCompact>No {meta.key}</Label>
                        )}
                      </Td>
                      <Td><span style={{ fontSize: '0.85rem' }}>{p.model || '—'}</span></Td>
                      <Td><span style={{ fontSize: '0.85rem', color: 'var(--pf-t--global--text--color--subtle)' }}>{p.base_url || '—'}</span></Td>
                      <Td isActionCell>
                        <Button variant="plain" isDanger aria-label="Remove pending provider"
                          onClick={() => onPendingProvidersChange(pendingProviders.filter((_, i) => i !== idx))}>
                          ×
                        </Button>
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          )}

          <Divider style={{ margin: '16px 0 12px' }} />

          {/* ── Health check all providers (agent-sdk-verifier pattern) ── */}
          <Flex gap={{ default: 'gapSm' }} alignItems={{ default: 'alignItemsCenter' }} style={{ marginBottom: '12px' }}>
            <FlexItem>
              <Button
                variant="secondary"
                isDisabled={healthChecking}
                onClick={async () => {
                  setHealthChecking(true);
                  setHealthResults([]);
                  try {
                    const { results } = await testAllProviders();
                    setHealthResults(results);
                  } catch (e) {
                    addAlert('danger', e instanceof Error ? e.message : 'Health check failed');
                  } finally {
                    setHealthChecking(false);
                  }
                }}
              >
                {healthChecking ? <><Spinner size="sm" /> Checking…</> : 'Check all providers'}
              </Button>
            </FlexItem>
          </Flex>
          {healthResults.length > 0 && (
            <div style={{ marginBottom: '16px', fontSize: '0.85rem' }}>
              {healthResults.map(r => (
                <Flex key={r.provider_id} gap={{ default: 'gapSm' }} alignItems={{ default: 'alignItemsCenter' }}
                  style={{ padding: '4px 0', borderBottom: '1px solid var(--pf-t--global--border--color--default)' }}>
                  <FlexItem style={{ minWidth: '16px' }}>
                    {r.status === 'ok' ? '✅' : r.status === 'no_key' ? '🔑' : '❌'}
                  </FlexItem>
                  <FlexItem style={{ minWidth: '180px', fontWeight: 600 }}>{r.label}</FlexItem>
                  <FlexItem style={{ color: 'var(--pf-t--global--text--color--subtle)' }}>
                    {r.status === 'ok'
                      ? `${r.latency_ms}ms — ${r.response_snippet}`
                      : r.hint || r.error?.slice(0, 100)}
                  </FlexItem>
                </Flex>
              ))}
            </div>
          )}

          {/* ── Test selected provider ── */}
          <p style={{ fontWeight: 600, marginBottom: '4px' }}>Test selected provider</p>
          <p style={{ fontSize: '0.85rem', color: 'var(--pf-t--global--text--color--subtle)', marginBottom: '8px' }}>
            Tests the currently selected provider — you can verify it works before clicking Save.
          </p>
          <Flex gap={{ default: 'gapSm' }} alignItems={{ default: 'alignItemsFlexEnd' }}>
            <FlexItem flex={{ default: 'flex_1' }}>
              <TextArea id="test-prompt" value={testPrompt}
                onChange={(_e, v) => setTestPrompt(v)}
                placeholder="Type a prompt to test the active AI provider…"
                rows={3} autoResize aria-label="Test prompt"
                onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleTest(); }}
              />
            </FlexItem>
            <FlexItem>
              <Button variant="primary" isDisabled={testing || !testPrompt.trim()} onClick={handleTest}>
                {testing ? <Spinner size="sm" /> : 'Send'}
              </Button>
            </FlexItem>
            <FlexItem>
              <Button variant="link"
                onClick={() => { setTestPrompt(''); setTestResponse(''); setTestHint(''); }}>
                Clear
              </Button>
            </FlexItem>
          </Flex>
          {testResponse && (
            <>
              <pre style={{ marginTop: '12px', padding: '12px', background: 'var(--pf-t--global--background--color--secondary--default)', border: '1px solid var(--pf-t--global--border--color--default)', borderRadius: '4px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.875rem', maxHeight: '400px', overflowY: 'auto' }}>
                {testResponse}
              </pre>
              {testHint && (
                <p style={{ marginTop: '8px', padding: '8px 12px', fontSize: '0.82rem', background: 'var(--pf-t--global--background--color--warning--default)', borderLeft: '3px solid var(--pf-t--global--color--status--warning--default)', borderRadius: '2px' }}>
                  {testHint}
                </p>
              )}
              {!testHint && testResponse.startsWith('Error:') && (
                <p style={{ marginTop: '6px', fontSize: '0.8rem', color: 'var(--pf-t--global--text--color--subtle)' }}>
                  Tip: set the required API key via Edit, then try again.
                </p>
              )}
            </>
          )}
        </CardBody>
      </Card>

      {/* ── Add Provider Modal ── */}
      <Modal isOpen={showAdd} onClose={() => { setShowAdd(false); setAddForm({ ...EMPTY_ADD }); }} variant="small" aria-labelledby="add-provider-title">
        <ModalHeader title="Add Provider" labelId="add-provider-title" />
        <ModalBody>
          <Form>
            <FormGroup label="Provider type" isRequired fieldId="add-prov-type">
              <Select id="add-prov-type" isOpen={addProviderOpen} selected={addForm.provider_id}
                onSelect={(_e, val) => { const id = String(val); setAddForm(f => ({ ...f, provider_id: id, model: f.model || PROVIDER_DEFAULT_MODEL[id] || '' })); setAddProviderOpen(false); }}
                onOpenChange={setAddProviderOpen}
                toggle={ref => (
                  <MenuToggle ref={ref} onClick={() => setAddProviderOpen(o => !o)} isExpanded={addProviderOpen} style={{ minWidth: '160px' }}>
                    {addForm.provider_id || 'Select…'}
                  </MenuToggle>
                )}>
                <SelectList>
                  {availableToAdd.map(id => <SelectOption key={id} value={id}>{id}</SelectOption>)}
                </SelectList>
              </Select>
            </FormGroup>
            {addForm.provider_id && !addMeta.noKey && (
              <FormGroup label={addMeta.key} isRequired fieldId="add-prov-key">
                <TextInput id="add-prov-key" type="password" value={addForm.api_key}
                  onChange={(_e, v) => setAddForm(f => ({ ...f, api_key: v }))} placeholder={addMeta.keyPlaceholder} />
              </FormGroup>
            )}
            {addForm.provider_id && (() => {
              const staticModels = PROVIDER_MODELS[addForm.provider_id] ?? [];
              const knownModels = staticModels;
              const isKnown = knownModels.includes(addForm.model);
              return (
                <FormGroup label="Model" fieldId="add-prov-model">
                  {knownModels.length > 0 ? (
                    <>
                      <Select
                        id="add-prov-model-select"
                        isOpen={addModelOpen}
                        selected={isKnown ? addForm.model : undefined}
                        onSelect={(_e, val) => {
                          setAddForm(f => ({ ...f, model: String(val) }));
                          setAddModelOpen(false);
                        }}
                        onOpenChange={setAddModelOpen}
                        toggle={ref => (
                          <MenuToggle ref={ref} onClick={() => setAddModelOpen(o => !o)} isExpanded={addModelOpen} style={{ minWidth: '260px' }}>
                            {addForm.model || 'Select model…'}
                          </MenuToggle>
                        )}
                      >
                        <SelectList>
                          {knownModels.map(m => <SelectOption key={m} value={m}>{m}</SelectOption>)}
                        </SelectList>
                      </Select>
                      {!isKnown && (
                        <TextInput
                          id="add-prov-model"
                          value={addForm.model}
                          onChange={(_e, v) => setAddForm(f => ({ ...f, model: v }))}
                          placeholder="Or type a custom model ID"
                          style={{ marginTop: '6px' }}
                        />
                      )}
                    </>
                  ) : (
                    <TextInput id="add-prov-model" value={addForm.model}
                      onChange={(_e, v) => setAddForm(f => ({ ...f, model: v }))}
                      placeholder="model-name" />
                  )}
                </FormGroup>
              );
            })()}
            {addForm.provider_id && (addForm.provider_id === 'vertex' || addForm.provider_id === 'ollama') && (
              <FormGroup label={addMeta.urlLabel ?? 'Base URL'} fieldId="add-prov-url">
                <TextInput id="add-prov-url" value={addForm.base_url}
                  onChange={(_e, v) => setAddForm(f => ({ ...f, base_url: v }))} placeholder={addMeta.urlPlaceholder} />
              </FormGroup>
            )}
          </Form>
        </ModalBody>
        <ModalFooter>
          <Button variant="primary" isDisabled={!addForm.provider_id || adding} onClick={handleAdd}>
            {adding ? 'Adding…' : 'Add'}
          </Button>
          <Button variant="link" onClick={() => { setShowAdd(false); setAddForm({ ...EMPTY_ADD }); }}>Cancel</Button>
        </ModalFooter>
      </Modal>

      {/* ── Edit Provider Modal ── */}
      {editTarget && editMeta && (
        <Modal isOpen onClose={() => setEditTarget(null)} variant="small" aria-labelledby="edit-provider-title" elementToFocus="[data-pf-initial-focus]">
          <ModalHeader title={`Edit ${editTarget.label}`} labelId="edit-provider-title" />
          <ModalBody>
            <div data-pf-initial-focus tabIndex={-1} style={{ outline: 'none' }}>
              <Form>
                <FormGroup label="Label" fieldId="edit-prov-label">
                  <TextInput id="edit-prov-label" value={editForm.label}
                    onChange={(_e, v) => setEditForm(f => ({ ...f, label: v }))} />
                </FormGroup>
                {!editMeta.noKey && (
                  <FormGroup label={editMeta.key} fieldId="edit-prov-key" helperText="Leave blank to keep the existing value">
                    <TextInput id="edit-prov-key" type="password" value={editForm.api_key}
                      onChange={(_e, v) => setEditForm(f => ({ ...f, api_key: v }))}
                      placeholder={editTarget.api_key === '***' ? '(unchanged)' : editMeta.keyPlaceholder} />
                  </FormGroup>
                )}
                <FormGroup label="Model" fieldId="edit-prov-model">
                  <TextInput id="edit-prov-model" value={editForm.model}
                    onChange={(_e, v) => setEditForm(f => ({ ...f, model: v }))} />
                </FormGroup>
                {(editTarget.provider_id === 'vertex' || editTarget.provider_id === 'ollama') && (
                  <FormGroup label={editMeta.urlLabel ?? 'Base URL'} fieldId="edit-prov-url">
                    <TextInput id="edit-prov-url" value={editForm.base_url}
                      onChange={(_e, v) => setEditForm(f => ({ ...f, base_url: v }))} placeholder={editMeta.urlPlaceholder} />
                  </FormGroup>
                )}
              </Form>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="primary"
              isDisabled={editSaving || (
                editForm.label === editOriginal.label &&
                !editForm.api_key &&
                editForm.model === editOriginal.model &&
                editForm.base_url === editOriginal.base_url
              )}
              onClick={handleEditSave}>
              {editSaving ? 'Saving…' : 'Save'}
            </Button>
            <Button variant="link" onClick={() => setEditTarget(null)}>Cancel</Button>
          </ModalFooter>
        </Modal>
      )}
    </PageSection>
  );
}

// ── Knowledge Sources ──────────────────────────────────────────────────────

function KnowledgeSources() {
  const [samples, setSamples] = useState<SamplePack[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState<string | null>(null);
  const { addAlert } = useAlerts();

  useEffect(() => {
    getSamplePacks().then(setSamples).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleLoad = async (name: string) => {
    setImporting(name);
    try {
      const r = await loadSamplePack(name);
      addAlert('success', `Loaded '${r.sample}': ${r.imported} files, ${r.projects} projects`);
    } catch (e) {
      addAlert('danger', e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(null);
    }
  };

  return (
    <PageSection>
      <Card>
        <CardTitle>
          Knowledge Sources
          <p style={WIDGET_DESC}>
            Project knowledge packs from <code>pg_seed/</code> — load them into the database so the agent can read project context and skills.
          </p>
        </CardTitle>
        <CardBody>
          {loading ? (
            <Spinner size="sm" aria-label="Loading samples" />
          ) : samples.length === 0 ? (
            <EmptyState variant={EmptyStateVariant.sm} icon={CubesIcon} titleText="No knowledge packs">
              <EmptyStateBody>
                <Popover bodyContent="No directories found in pg_seed/. Create one like pg_seed/my-project/ with subprojects/, context/, and shared/ subdirectories, then restart the server.">
                  <FormGroupLabelHelp aria-label="More info" />
                </Popover>
              </EmptyStateBody>
            </EmptyState>
          ) : (
            <DataList aria-label="Sample packs" isCompact>
              {samples.map(s => (
                <DataListItem key={s.name} aria-labelledby={`sample-${s.name}`}>
                  <DataListItemRow>
                    <DataListItemCells
                      dataListCells={[
                        <DataListCell key="name" width={2} id={`sample-${s.name}`}>
                          <strong>{s.name}</strong>
                          <div style={{ marginTop: '4px' }}>
                            {s.hasSubprojects && <Label isCompact style={{ marginRight: '4px' }}>subprojects</Label>}
                            {s.hasContext && <Label isCompact style={{ marginRight: '4px' }}>context</Label>}
                            {s.hasShared && <Label isCompact>shared</Label>}
                          </div>
                        </DataListCell>,
                        <DataListCell key="subdirs" width={3}>
                          <span style={{ fontSize: '0.85rem', color: 'var(--pf-t--global--text--color--subtle)' }}>
                            {s.subdirs.join(' · ')}
                          </span>
                        </DataListCell>,
                        <DataListCell key="action" width={2} alignRight>
                          <Button variant="primary" size="sm" isDisabled={importing !== null} onClick={() => handleLoad(s.name)}>
                            {importing === s.name ? <><Spinner size="sm" aria-label="Loading" /> Loading…</> : '↓ Load into DB'}
                          </Button>
                        </DataListCell>,
                      ]}
                    />
                  </DataListItemRow>
                </DataListItem>
              ))}
            </DataList>
          )}

          <Divider style={{ margin: '12px 0 8px' }} />
          <Button variant="link" size="sm" onClick={exportKnowledge}>
            Export to JSON
          </Button>
        </CardBody>
      </Card>
    </PageSection>
  );
}

// ── Main Settings page ─────────────────────────────────────────────────────

// ── Autorun widget ─────────────────────────────────────────────────────────

function AutorunWidget({
  settings,
  set,
  addAlert,
}: {
  settings: AppSettings;
  set: (patch: Partial<AppSettings>) => void;
  addAlert: (variant: 'success' | 'danger' | 'info', msg: string) => void;
}) {
  const enabled = settings.autorunEnabled === 'true';
  const times = settings.autorunTimes
    ? settings.autorunTimes.split(',').map(t => t.trim()).filter(Boolean)
    : [];
  const [starting, setStarting] = React.useState(false);

  function setTimes(newTimes: string[]) {
    set({ autorunTimes: newTimes.join(',') });
  }

  function addTime() {
    setTimes([...times, '09:00']);
  }

  function removeTime(idx: number) {
    setTimes(times.filter((_, i) => i !== idx));
  }

  function updateTime(idx: number, val: string) {
    setTimes(times.map((t, i) => (i === idx ? val : t)));
  }

  async function handleForceStart() {
    setStarting(true);
    try {
      const result = await triggerAutorun();
      addAlert('success', `Autorun started: ${result.title || result.issueUrl}`);
    } catch (e) {
      addAlert('danger', e instanceof Error ? e.message : 'Autorun failed');
    } finally {
      setStarting(false);
    }
  }

  return (
    <PageSection>
      <Card>
        <CardTitle>
          Daily Autorun
          <p style={WIDGET_DESC}>Automatically pick and run one issue at scheduled times each day.</p>
        </CardTitle>
        <CardBody>
          <Flex direction={{ default: 'column' }} gap={{ default: 'gapMd' }}>
            {/* Enable switch */}
            <FlexItem>
              <Switch
                id="autorun-enabled"
                label="Enabled"
                labelOff="Disabled"
                isChecked={enabled}
                onChange={(_e, checked) => set({ autorunEnabled: checked ? 'true' : 'false' })}
              />
            </FlexItem>

            {/* Scheduled times */}
            {enabled && (
              <FlexItem>
                <Flex direction={{ default: 'column' }} gap={{ default: 'gapSm' }}>
                  <span style={{ fontWeight: 500, fontSize: '0.9rem' }}>Scheduled times (HH:MM):</span>
                  {times.map((t, idx) => (
                    <Flex key={idx} gap={{ default: 'gapSm' }} alignItems={{ default: 'alignItemsCenter' }}>
                      <FlexItem>
                        <TextInput
                          id={`autorun-time-${idx}`}
                          type="time"
                          value={t}
                          onChange={(_e, v) => updateTime(idx, v)}
                          style={{ width: '120px' }}
                          aria-label={`Scheduled time ${idx + 1}`}
                        />
                      </FlexItem>
                      <FlexItem>
                        <Button variant="plain" isDanger onClick={() => removeTime(idx)} aria-label="Remove time">
                          ×
                        </Button>
                      </FlexItem>
                    </Flex>
                  ))}
                  <FlexItem>
                    <Button variant="link" onClick={addTime} style={{ paddingLeft: 0 }}>
                      + Add time
                    </Button>
                  </FlexItem>
                </Flex>
              </FlexItem>
            )}

            {/* Force start */}
            <FlexItem>
              <Button
                id="autorun-force-start"
                variant="secondary"
                isDisabled={starting}
                onClick={() => void handleForceStart()}
              >
                {starting ? <><Spinner size="sm" /> Starting…</> : 'Force start now'}
              </Button>
            </FlexItem>
          </Flex>
        </CardBody>
      </Card>
    </PageSection>
  );
}

const DEFAULT_SETTINGS: AppSettings = {
  defaultMinPriority: 'major',
  defaultBudget: '3',
  cloneDir: '.repos',
  executionMode: 'pr',
  outputDir: 'output',
  autorunEnabled: 'false',
  autorunTimes: '',
};

export default function Settings() {
  const [saved, setSaved] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [executionModeOpen, setExecutionModeOpen] = useState(false);

  // Active provider — pending (UI) vs saved (DB)
  const [pendingActiveId, setPendingActiveId] = useState<string | null>(null);
  const [savedActiveId, setSavedActiveId] = useState<string | null>(null);
  // Providers staged in the UI, not yet persisted to DB
  const [pendingProviders, setPendingProviders] = useState<ProviderForm[]>([]);
  // Increment to force AIProviders to re-fetch after Save/Cancel
  const [reloadKey, setReloadKey] = useState(0);

  const { addAlert } = useAlerts();

  useEffect(() => {
    getSettings().then(s => { setSaved(s); setSettings(s); }).catch(() => {});
    // Load current active provider from DB
    getProviders().then(providers => {
      const active = providers.find(p => p.is_active);
      const id = active?.provider_id ?? null;
      setPendingActiveId(id);
      setSavedActiveId(id);
    }).catch(() => {});
  }, []);

  const providerDirty = pendingActiveId !== savedActiveId || pendingProviders.length > 0;
  const settingsDirty = JSON.stringify(settings) !== JSON.stringify(saved);
  const isDirty = settingsDirty || providerDirty;

  const set = (patch: Partial<AppSettings>) => setSettings(p => ({ ...p, ...patch }));

  const handleSave = async () => {
    try {
      await saveSettings(settings);
      setSaved(settings);
      if (pendingActiveId !== savedActiveId && pendingActiveId) {
        await upsertProvider({ provider_id: pendingActiveId, is_active: true });
        setSavedActiveId(pendingActiveId);
      }
      // Persist staged providers
      for (const p of pendingProviders) {
        await upsertProvider({
          provider_id: p.provider_id,
          label: p.label,
          api_key: p.api_key,
          model: p.model,
          base_url: p.base_url,
          is_active: false,
        });
      }
      if (pendingProviders.length > 0) setPendingProviders([]);
      setReloadKey(k => k + 1);
      addAlert('success', 'Settings saved');
    } catch (e) {
      addAlert('danger', e instanceof Error ? e.message : 'Failed to save settings');
    }
  };

  const handleCancel = () => {
    setSettings(saved);
    setPendingActiveId(savedActiveId);
    setPendingProviders([]);
  };

  return (
    <>
      <PageSection>
        <Title headingLevel="h1" size="xl">Settings</Title>
      </PageSection>

      {/* ── Agent Defaults ── */}
      <PageSection>
        <Card>
          <CardTitle>
            Agent Defaults
            <p style={WIDGET_DESC}>Global thresholds applied to every run unless overridden per project.</p>
          </CardTitle>
          <CardBody>
            <Flex direction={{ default: 'column' }} gap={{ default: 'gapMd' }}>
              {/* 1st: max budget */}
              <FlexItem>
                <Flex gap={{ default: 'gapMd' }} alignItems={{ default: 'alignItemsCenter' }}>
                  <span style={FIELD_LABEL}>Auto-approve max budget:</span>
                  <FlexItem style={{ maxWidth: '60px' }}>
                    <TextInput
                      id="budget" type="number"
                      value={settings.defaultBudget}
                      onChange={(_e, v) => set({ defaultBudget: v })}
                      style={{ width: '100%' }}
                      aria-label="Story point budget"
                    />
                  </FlexItem>
                </Flex>
              </FlexItem>

              {/* 2nd: min priority */}
              <FlexItem>
                <Flex gap={{ default: 'gapMd' }} alignItems={{ default: 'alignItemsCenter' }}>
                  <span style={FIELD_LABEL}>Auto-approve min priority:</span>
                  <Select id="prio" isOpen={priorityOpen} selected={settings.defaultMinPriority}
                    onSelect={(_e, val) => { set({ defaultMinPriority: String(val) }); setPriorityOpen(false); }}
                    onOpenChange={setPriorityOpen}
                    toggle={ref => (
                      <MenuToggle ref={ref} onClick={() => setPriorityOpen(o => !o)} isExpanded={priorityOpen} style={{ minWidth: '120px' }}>
                        {settings.defaultMinPriority}
                      </MenuToggle>
                    )}>
                    <SelectList>
                      {PRIORITIES.map(o => <SelectOption key={o} value={o}>{o}</SelectOption>)}
                    </SelectList>
                  </Select>
                </Flex>
              </FlexItem>

              {/* 3rd: clone dir */}
              <FlexItem>
                <Flex gap={{ default: 'gapMd' }} alignItems={{ default: 'alignItemsCenter' }}>
                  <span style={FIELD_LABEL}>Clone directory path:</span>
                  <FlexItem style={{ maxWidth: 'calc(100% - 250px)' }}>
                    <TextInput
                      id="clone-dir"
                      value={settings.cloneDir}
                      onChange={(_e, v) => set({ cloneDir: v })}
                      placeholder=".repos"
                      style={{ width: '100%' }}
                      aria-label="Clone directory"
                    />
                  </FlexItem>
                </Flex>
              </FlexItem>

              {/* 4th: execution mode */}
              <FlexItem>
                <Flex gap={{ default: 'gapMd' }} alignItems={{ default: 'alignItemsCenter' }}>
                  <span style={FIELD_LABEL}>Execution mode:</span>
                  <Select
                    id="execution-mode"
                    isOpen={executionModeOpen}
                    selected={settings.executionMode}
                    onSelect={(_e, val) => { set({ executionMode: String(val) }); setExecutionModeOpen(false); }}
                    onOpenChange={setExecutionModeOpen}
                    toggle={ref => (
                      <MenuToggle ref={ref} onClick={() => setExecutionModeOpen(o => !o)} isExpanded={executionModeOpen} style={{ minWidth: '200px' }}>
                        {settings.executionMode === 'export' ? 'Export to Directory' : 'Create Pull Request'}
                      </MenuToggle>
                    )}
                  >
                    <SelectList>
                      <SelectOption value="pr">Create Pull Request</SelectOption>
                      <SelectOption value="export">Export to Directory</SelectOption>
                    </SelectList>
                  </Select>
                </Flex>
              </FlexItem>

              {/* 5th: output dir — only when export mode */}
              {settings.executionMode === 'export' && (
                <FlexItem>
                  <Flex gap={{ default: 'gapMd' }} alignItems={{ default: 'alignItemsCenter' }}>
                    <span style={FIELD_LABEL}>Output directory path:</span>
                    <FlexItem style={{ maxWidth: 'calc(100% - 250px)' }}>
                      <TextInput
                        id="output-dir"
                        value={settings.outputDir}
                        onChange={(_e, v) => set({ outputDir: v })}
                        placeholder="output"
                        style={{ width: '100%' }}
                        aria-label="Output directory"
                      />
                    </FlexItem>
                  </Flex>
                </FlexItem>
              )}
            </Flex>
          </CardBody>
        </Card>
      </PageSection>

      {/* ── AI Providers ── */}
      <AIProviders
        pendingActiveId={pendingActiveId}
        onPendingActiveChange={setPendingActiveId}
        reloadKey={reloadKey}
        pendingProviders={pendingProviders}
        onPendingProvidersChange={setPendingProviders}
      />

      {/* ── Daily Autorun ── */}
      <AutorunWidget settings={settings} set={set} addAlert={addAlert} />

      {/* ── Save / Cancel (after AI Providers) ── */}
      <PageSection>
        <Flex gap={{ default: 'gapSm' }}>
          <FlexItem>
            <Button variant="primary" isDisabled={!isDirty} onClick={handleSave}>Save</Button>
          </FlexItem>
          <FlexItem>
            <Button variant="link" onClick={handleCancel}>Cancel</Button>
          </FlexItem>
        </Flex>
      </PageSection>

      <KnowledgeSources />
    </>
  );
}
