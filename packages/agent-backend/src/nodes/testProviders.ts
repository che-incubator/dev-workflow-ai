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
 * testProviders — parallel provider health checker.
 *
 * Inspired by Claude Code patterns:
 *   - agent-sdk-verifier-ts: structured 4-step checklist per provider
 *   - code-review:  parallel independent probes, one per dimension
 *   - security-guidance: pattern validation + live LLM call dual-mode
 *
 * Steps per provider (agent-sdk-verifier checklist adapted):
 *   1. Credential check    — key/project ID present?
 *   2. Config validation   — model ID format valid? region known?
 *   3. Connectivity probe  — endpoint reachable? (no LLM call)
 *   4. Live PONG probe     — send "Reply PONG", measure latency, check coherence
 */

import { HumanMessage } from '@langchain/core/messages';
import { buildLLMFromProvider } from '../llm/client.js';
import { db } from '../db/client.js';

export interface ProviderResult {
  provider_id: string;
  label: string;
  status: 'ok' | 'config_error' | 'auth_error' | 'model_error' | 'network_error' | 'no_key';
  latency_ms: number | null;
  response_snippet: string | null;
  error: string | null;
  hint: string | null;
}

interface ProviderRow {
  provider_id: string;
  label: string;
  api_key: string;
  base_url: string;
  model: string;
  is_active: boolean;
}

// ── Step 1+2: config validation (no network call) ─────────────────────────

const MODEL_PATTERNS: Record<string, RegExp> = {
  vertex: /^claude-[\w.-]+@\d{8}$|^claude-[\w.-]+@default$/,
  anthropic: /^claude-/,
  openai: /^gpt-|^o\d/,
  gemini: /^gemini-/,
  ollama: /.+/, // any non-empty string
};

function validateConfig(p: ProviderRow): string | null {
  if (p.provider_id !== 'ollama' && !p.api_key) {
    return 'API key / credential not set';
  }
  const pattern = MODEL_PATTERNS[p.provider_id];
  if (pattern && p.model && !pattern.test(p.model)) {
    return `Model ID "${p.model}" does not match expected format for ${p.provider_id}`;
  }
  if (
    p.provider_id === 'vertex' &&
    p.base_url &&
    p.base_url !== 'global' &&
    !/^[a-z]+-[a-z]+\d?$/.test(p.base_url)
  ) {
    return `Region "${p.base_url}" looks incorrect (expected e.g. "global", "us-east5")`;
  }
  return null;
}

// ── Step 3+4: live probe ───────────────────────────────────────────────────

async function probeProvider(p: ProviderRow): Promise<ProviderResult> {
  const configError = validateConfig(p);
  if (configError) {
    return {
      provider_id: p.provider_id,
      label: p.label,
      status: p.api_key === '' && p.provider_id !== 'ollama' ? 'no_key' : 'config_error',
      latency_ms: null,
      response_snippet: null,
      error: configError,
      hint:
        p.provider_id !== 'ollama'
          ? `Go to Settings → AI Providers → Edit ${p.label} → set the API key`
          : null,
    };
  }

  const t0 = Date.now();
  try {
    const llm = buildLLMFromProvider({
      provider_id: p.provider_id,
      api_key: p.api_key,
      base_url: p.base_url,
      model: p.model,
    });
    const result = await llm.invoke([
      new HumanMessage('Reply with exactly the word PONG and nothing else.'),
    ]);
    const latency = Date.now() - t0;
    const text =
      typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
    const snippet = text.slice(0, 80).trim();
    const coherent = snippet.toLowerCase().includes('pong');
    return {
      provider_id: p.provider_id,
      label: p.label,
      status: coherent ? 'ok' : 'model_error',
      latency_ms: latency,
      response_snippet: snippet,
      error: coherent ? null : `Unexpected response (expected "PONG"): ${snippet}`,
      hint: coherent
        ? null
        : `Model "${p.model}" may not be following instructions — try a different model ID`,
    };
  } catch (e) {
    const latency = Date.now() - t0;
    const msg = e instanceof Error ? e.message : String(e);
    let status: ProviderResult['status'] = 'network_error';
    let hint: string | null = null;

    if (
      msg.includes('401') ||
      msg.includes('403') ||
      msg.includes('authentication') ||
      msg.includes('api_key')
    ) {
      status = 'auth_error';
      hint = `Check the API key in Settings → AI Providers → Edit ${p.label}`;
    } else if (msg.includes('404') || msg.includes('not found') || msg.includes('not exist')) {
      status = 'model_error';
      hint = `Model "${p.model}" not found. Check the model ID in Settings → AI Providers → Edit ${p.label}`;
      if (msg.includes('does not have access')) {
        hint = `Enable the model in the provider's console (e.g. Vertex AI Model Garden for Claude)`;
      }
    } else if (msg.includes('ENOTFOUND') || msg.includes('ECONNREFUSED')) {
      status = 'network_error';
      hint = `Cannot reach ${p.label} endpoint — check Base URL and network connectivity`;
    }

    return {
      provider_id: p.provider_id,
      label: p.label,
      status,
      latency_ms: latency,
      response_snippet: null,
      error: msg.slice(0, 300),
      hint,
    };
  }
}

// ── Main export ────────────────────────────────────────────────────────────

export async function testAllProviders(): Promise<ProviderResult[]> {
  const { rows } = await db.query<ProviderRow>(
    'SELECT provider_id, label, api_key, base_url, model, is_active FROM llm_providers ORDER BY id ASC',
  );

  // code-review pattern: all probes in parallel
  const results = await Promise.all(rows.map(probeProvider));

  return results;
}

/** Auto-activate the best working provider (lowest latency among 'ok' ones). */
export async function autoActivateBestProvider(results: ProviderResult[]): Promise<string | null> {
  const working = results
    .filter(r => r.status === 'ok' && r.latency_ms !== null)
    .sort((a, b) => (a.latency_ms ?? 9999) - (b.latency_ms ?? 9999));

  if (working.length === 0) return null;
  const best = working[0];
  await db.query('UPDATE llm_providers SET is_active = false, updated_at = now()');
  await db.query(
    'UPDATE llm_providers SET is_active = true, updated_at = now() WHERE provider_id = $1',
    [best.provider_id],
  );
  return best.provider_id;
}
