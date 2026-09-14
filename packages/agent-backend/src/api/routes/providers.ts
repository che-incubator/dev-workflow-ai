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

import type { FastifyPluginAsync } from 'fastify';
import { HumanMessage } from '@langchain/core/messages';
import { db } from '../../db/client.js';
import { buildLLMFromDB, buildLLMFromProvider, buildEnvLLM } from '../../llm/client.js';
import { providerTestSchema } from '../../constants/schemas.js';

interface ProviderRow {
  id: number;
  provider_id: string;
  label: string;
  api_key: string;
  base_url: string;
  model: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

function mask(row: ProviderRow): ProviderRow {
  return { ...row, api_key: row.api_key ? '***' : '' };
}

export async function seedDefaultProviders(): Promise<void> {
  const { rows: existing } = await db.query('SELECT COUNT(*) as n FROM llm_providers');
  const hasRows = parseInt((existing[0] as { n: string }).n, 10) > 0;

  const vertexProjectIdNow = process.env.ANTHROPIC_VERTEX_PROJECT_ID;
  const vertexRegionNow = process.env.CLOUD_ML_REGION ?? 'global';
  const vertexModelNow = process.env.VERTEX_CLAUDE_MODEL ?? 'claude-sonnet-4-6@default';

  // Keep vertex project ID up to date from env; preserve model/region set by the user
  if (hasRows && vertexProjectIdNow) {
    await db.query(
      `INSERT INTO llm_providers (provider_id, label, api_key, base_url, model, is_active, updated_at)
       VALUES ('vertex', 'Vertex AI (Claude)', $1, $2, $3, false, now())
       ON CONFLICT (provider_id) DO UPDATE SET
         api_key    = CASE WHEN $1 <> '' THEN $1 ELSE llm_providers.api_key END,
         base_url   = CASE WHEN llm_providers.base_url <> '' THEN llm_providers.base_url ELSE $2 END,
         model      = CASE WHEN llm_providers.model    <> '' THEN llm_providers.model    ELSE $3 END,
         updated_at = now()`,
      [vertexProjectIdNow, vertexRegionNow, vertexModelNow],
    );

    // If a non-vertex provider is active with no credentials, activate vertex
    const { rows: activeRows } = await db.query<{ provider_id: string; api_key: string }>(
      'SELECT provider_id, api_key FROM llm_providers WHERE is_active = true LIMIT 1',
    );
    const active = activeRows[0];
    const needsSwitch = active &&
      active.provider_id !== 'vertex' &&
      active.provider_id !== 'ollama' &&
      !active.api_key;
    if (needsSwitch || !active) {
      await db.query('UPDATE llm_providers SET is_active = false, updated_at = now()');
      await db.query(
        'UPDATE llm_providers SET is_active = true, updated_at = now() WHERE provider_id = $1',
        ['vertex'],
      );
      console.log('[providers] Activated Vertex AI provider');
    }
    return;
  }

  // Existing DB but no Vertex env — still sync env keys for other providers
  if (hasRows) {
    const syncKey = async (providerId: string, key: string) => {
      if (!key) return;
      await db.query(
        `UPDATE llm_providers SET api_key = $2, updated_at = now()
         WHERE provider_id = $1 AND api_key = ''`,
        [providerId, key],
      );
    };
    await syncKey('anthropic', process.env.ANTHROPIC_API_KEY ?? '');
    await syncKey('openai', process.env.OPENAI_API_KEY ?? '');
    await syncKey('gemini',
      (process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY) ?? '');
    return;
  }

  const vertexProjectId = process.env.ANTHROPIC_VERTEX_PROJECT_ID;
  const vertexRegion = process.env.CLOUD_ML_REGION ?? 'global';
  const vertexModel = process.env.VERTEX_CLAUDE_MODEL ?? 'claude-sonnet-4-6@default';

  const anthropicKey = process.env.ANTHROPIC_API_KEY ?? '';
  const geminiKey    = (process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY) ?? '';
  const openaiKey    = process.env.OPENAI_API_KEY ?? '';

  // Prefer Vertex AI when configured, Anthropic API when key is set, else Ollama
  const defaultActive = vertexProjectId ? 'vertex' : anthropicKey ? 'anthropic' : 'ollama';

  interface ProviderSeed {
    provider_id: string; label: string; api_key: string;
    base_url: string; model: string; is_active: boolean;
  }

  const defaults: ProviderSeed[] = [
    ...(vertexProjectId
      ? [{
          provider_id: 'vertex', label: 'Vertex AI (Claude)',
          api_key: vertexProjectId, base_url: vertexRegion, model: vertexModel,
          is_active: defaultActive === 'vertex',
        }]
      : []),
    {
      provider_id: 'ollama', label: 'Ollama (local)', api_key: '',
      base_url: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
      model: process.env.OLLAMA_MODEL ?? 'qwen2.5-coder:7b',
      is_active: defaultActive === 'ollama',
    },
    // Only seed Anthropic/OpenAI/Gemini when their keys are configured
    ...(anthropicKey
      ? [{ provider_id: 'anthropic', label: 'Anthropic (Claude)', api_key: anthropicKey,
           base_url: '', model: 'claude-sonnet-4-6', is_active: defaultActive === 'anthropic' }]
      : []),
    ...(openaiKey
      ? [{ provider_id: 'openai', label: 'OpenAI', api_key: openaiKey,
           base_url: '', model: 'gpt-4o', is_active: false }]
      : []),
    ...(geminiKey
      ? [{ provider_id: 'gemini', label: 'Gemini', api_key: geminiKey,
           base_url: '', model: process.env.GEMINI_MODEL ?? 'gemini-3.6-flash', is_active: false }]
      : []),
  ];

  for (const d of defaults) {
    await db.query(
      `INSERT INTO llm_providers (provider_id, label, api_key, base_url, model, is_active)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (provider_id) DO NOTHING`,
      [d.provider_id, d.label, d.api_key, d.base_url, d.model, d.is_active],
    );
  }
  console.log('[providers] Seeded default LLM providers');
}

const tags = ['Providers'];

export const providersRoutes: FastifyPluginAsync = async app => {
  // GET / — list all providers (api_key masked)
  app.get('/', { schema: { tags } }, async (_req, reply) => {
    const { rows } = await db.query<ProviderRow>(
      'SELECT * FROM llm_providers ORDER BY id ASC',
    );
    return reply.send(rows.map(mask));
  });

  // GET /active — active provider config (api_key unmasked for agent use)
  app.get('/active', { schema: { tags } }, async (_req, reply) => {
    const { rows } = await db.query<ProviderRow>(
      'SELECT * FROM llm_providers WHERE is_active = true LIMIT 1',
    );
    return reply.send(rows[0] ?? null);
  });

  // POST / — upsert provider
  app.post<{
    Body: Partial<ProviderRow> & { provider_id: string };
  }>('/', async (req, reply) => {
    const { provider_id, label, base_url, model, is_active } = req.body;
    if (!provider_id) return reply.status(400).send({ error: 'provider_id is required' });

    // Fall back to env var when no explicit key is provided
    const ENV_KEYS: Record<string, string> = {
      gemini:    process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? '',
      anthropic: process.env.ANTHROPIC_API_KEY ?? '',
      openai:    process.env.OPENAI_API_KEY ?? '',
      vertex:    process.env.ANTHROPIC_VERTEX_PROJECT_ID ?? '',
    };
    const api_key = req.body.api_key || ENV_KEYS[provider_id] || '';

    if (is_active) {
      await db.query('UPDATE llm_providers SET is_active = false, updated_at = now()');
    }

    const { rows } = await db.query<ProviderRow>(
      `INSERT INTO llm_providers (provider_id, label, api_key, base_url, model, is_active, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (provider_id) DO UPDATE SET
         label      = COALESCE(NULLIF($2, ''), llm_providers.label),
         api_key    = CASE WHEN $3 = '' THEN llm_providers.api_key ELSE $3 END,
         base_url   = COALESCE(NULLIF($4, ''), llm_providers.base_url),
         model      = COALESCE(NULLIF($5, ''), llm_providers.model),
         is_active  = $6,
         updated_at = now()
       RETURNING *`,
      [provider_id, label ?? '', api_key ?? '', base_url ?? '', model ?? '', is_active ?? false],
    );

    return reply.send(mask(rows[0]));
  });

  // DELETE /:providerId
  app.delete<{ Params: { providerId: string } }>('/:providerId', { schema: { tags } }, async (req, reply) => {
    await db.query('DELETE FROM llm_providers WHERE provider_id = $1', [req.params.providerId]);
    return reply.status(204).send();
  });

  // POST /test — send a prompt to the specified or active provider
  app.post<{ Body: { prompt: string; provider_id?: string } }>('/test', { schema: { tags, body: providerTestSchema } }, async (req, reply) => {
    const { prompt, provider_id } = req.body;
    if (!prompt?.trim()) {
      return reply.status(400).send({ error: 'prompt is required' });
    }
    try {
      let llm;
      if (provider_id) {
        const { rows } = await db.query<ProviderConfig>(
          'SELECT provider_id, api_key, base_url, model FROM llm_providers WHERE provider_id = $1',
          [provider_id],
        );
        if (!rows[0]) return reply.status(404).send({ error: `Provider '${provider_id}' not found` });
        llm = buildLLMFromProvider(rows[0]);
      } else {
        llm = await buildLLMFromDB();
      }
      const result = await llm.invoke([new HumanMessage(prompt)]);
      const content =
        typeof result.content === 'string'
          ? result.content
          : JSON.stringify(result.content);
      return reply.send({ response: content });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Provide a clear action hint for Vertex AI access errors
      if (msg.includes('404') && msg.includes('does not have access')) {
        return reply.status(500).send({
          error: msg,
          hint: 'Claude is not enabled for this GCP project. To enable it: GCP Console → Vertex AI → Model Garden → search "Claude" → Enable → accept Anthropic terms. Then wait ~2 min and retry.',
        });
      }
      // If a specific provider was requested, surface its error directly — no fallback
      if (provider_id) {
        return reply.status(500).send({ error: msg });
      }
      // Active provider is misconfigured (missing key) — try env-based LLM as fallback
      if (msg.includes('API key not set') || msg.includes('not configured')) {
        try {
          const envLlm = buildEnvLLM();
          const result2 = await envLlm.invoke([new HumanMessage(prompt)]);
          const content2 =
            typeof result2.content === 'string' ? result2.content : JSON.stringify(result2.content);
          return reply.send({ response: content2, note: 'Used env-based LLM (DB provider misconfigured)' });
        } catch (e2) {
          const envMsg = e2 instanceof Error ? e2.message : String(e2);
          // Check if env fallback also has no access to Claude on Vertex
          if (envMsg.includes('404') && envMsg.includes('does not have access')) {
            return reply.status(500).send({
              error: 'No working LLM provider is configured.',
              hint: 'Options: (1) Enable Claude in GCP Console → Vertex AI → Model Garden → search "Claude" → Enable. (2) Set an Anthropic API key in Settings → AI Providers → Anthropic. (3) Get a free Gemini key at aistudio.google.com/apikey and add it to Settings.',
            });
          }
          return reply.status(500).send({ error: envMsg });
        }
      }
      return reply.status(500).send({ error: msg });
    }
  });

  // POST /test-all — parallel health check for all configured providers
  // Inspired by Claude Code agent-sdk-verifier (4-step checklist) +
  // code-review plugin (parallel independent probes per dimension).
  app.post<{ Body: { autoActivate?: boolean } }>('/test-all', { schema: { tags } }, async (req, reply) => {
    const { testAllProviders, autoActivateBestProvider } = await import('../../nodes/testProviders.js');
    const results = await testAllProviders();
    let activated: string | null = null;
    if (req.body?.autoActivate) {
      activated = await autoActivateBestProvider(results);
    }
    return reply.send({ results, activated });
  });
};
