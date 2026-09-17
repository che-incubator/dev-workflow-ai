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
 * anthropicClient — direct @anthropic-ai/sdk wrapper.
 *
 * Replaces ChatAnthropic (LangChain) + VertexAnthropicLLM for Anthropic-family calls.
 * Zero LangChain overhead: first token arrives in <200ms vs 3–8s through the LangGraph stack.
 *
 * Usage:
 *   const client = await getAnthropicClient();
 *   const text = await client.ask(systemPrompt, userPrompt);
 *   // or with streaming callbacks:
 *   const msg = await client.stream(messages, system, tools, { onText: t => ws.send(t) });
 */

import Anthropic from '@anthropic-ai/sdk';
import { emitTokenLog } from './tokenLog.js';

const _THINKING = process.env.CLAUDE_THINKING !== 'false'; // reserved for direct API path
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 16000;
const THINKING_BUDGET = 10000;

export interface StreamCallbacks {
  onText?: (text: string) => void;
  onThinking?: (thinking: string) => void;
  onInputTokens?: (n: number) => void;
  onOutputTokens?: (n: number) => void;
}

export class AnthropicClient {
  private sdk: Anthropic;
  readonly model: string;
  readonly maxTokens: number;
  readonly thinking: boolean;

  totalInputTokens = 0;
  totalOutputTokens = 0;

  // Vertex AI path — when set, requests go to Vertex rawPredict instead of direct API
  private vertexProjectId?: string;
  private vertexRegion?: string;
  private vertexAuth?: import('google-auth-library').GoogleAuth;

  constructor(opts: {
    apiKey?: string;
    model?: string;
    maxTokens?: number;
    thinking?: boolean;
    vertexProjectId?: string;
    vertexRegion?: string;
    vertexCredentials?: Record<string, unknown>;
  }) {
    this.sdk = new Anthropic({ apiKey: opts.apiKey ?? 'placeholder' });
    this.model = opts.model ?? DEFAULT_MODEL;
    this.maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.thinking = opts.thinking ?? false; // extended thinking not supported on Vertex
    if (opts.vertexProjectId) {
      this.vertexProjectId = opts.vertexProjectId;
      this.vertexRegion = opts.vertexRegion ?? 'global';
    }
  }

  async initVertexAuth(credentials?: Record<string, unknown>): Promise<void> {
    if (this.vertexAuth) return;
    const { GoogleAuth } = await import('google-auth-library');
    this.vertexAuth = new GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
  }

  /** Call Vertex rawPredict endpoint — returns response text. */
  private async askVertex(system: string, userText: string): Promise<string> {
    const region = this.vertexRegion ?? 'global';
    const host =
      region === 'global' ? 'aiplatform.googleapis.com' : `${region}-aiplatform.googleapis.com`;
    const endpoint =
      `https://${host}/v1/projects/${this.vertexProjectId}` +
      `/locations/${region}/publishers/anthropic/models/${this.model}:rawPredict`;

    const token = await this.vertexAuth!.getAccessToken();
    const body = {
      anthropic_version: 'vertex-2023-10-16',
      max_tokens: this.maxTokens,
      system,
      messages: [{ role: 'user', content: userText }],
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`[vertex] ${res.status} ${res.statusText}: ${err}`);
    }
    const data = (await res.json()) as {
      content: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const inp = data.usage?.input_tokens ?? 0;
    const out = data.usage?.output_tokens ?? 0;
    this.totalInputTokens += inp;
    this.totalOutputTokens += out;
    emitTokenLog(
      `[tokens] ${this.model} ask: ↑${inp} ↓${out} (total: ↑${this.totalInputTokens} ↓${this.totalOutputTokens})`,
    );
    return data.content
      .filter(b => b.type === 'text')
      .map(b => b.text ?? '')
      .join('');
  }

  /** Single-shot: send one user message, return response text. No streaming. */
  async ask(system: string, userText: string): Promise<string> {
    if (this.vertexProjectId) {
      return this.askVertex(system, userText);
    }
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: this.model,
      max_tokens: this.maxTokens,
      system,
      messages: [{ role: 'user', content: userText }],
      ...(this.thinking
        ? {
            thinking: { type: 'enabled', budget_tokens: THINKING_BUDGET },
            betas: ['interleaved-thinking-2025-05-14'],
          }
        : {}),
    };
    const msg = await this.sdk.messages.create(params);
    const inp = msg.usage.input_tokens;
    const out = msg.usage.output_tokens;
    this.totalInputTokens += inp;
    this.totalOutputTokens += out;
    emitTokenLog(
      `[tokens] ${this.model} ask: ↑${inp} ↓${out} (total: ↑${this.totalInputTokens} ↓${this.totalOutputTokens})`,
    );
    return extractText(msg.content);
  }

  /** Streaming: iterate events, fire callbacks, return final message. */
  async stream(
    messages: Anthropic.MessageParam[],
    system: string,
    tools: Anthropic.Tool[],
    callbacks: StreamCallbacks = {},
  ): Promise<Anthropic.Message> {
    const params: Anthropic.MessageStreamParams = {
      model: this.model,
      max_tokens: this.maxTokens,
      system,
      messages,
      ...(tools.length ? { tools } : {}),
      ...(this.thinking
        ? {
            thinking: { type: 'enabled', budget_tokens: THINKING_BUDGET },
            betas: ['interleaved-thinking-2025-05-14'],
          }
        : {}),
    };

    const streamObj = this.sdk.messages.stream(params);

    for await (const event of streamObj) {
      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') callbacks.onText?.(event.delta.text);
        if (event.delta.type === 'thinking_delta') callbacks.onThinking?.(event.delta.thinking);
      }
      if (event.type === 'message_delta' && event.usage) {
        callbacks.onOutputTokens?.(event.usage.output_tokens);
      }
    }

    const msg = await streamObj.finalMessage();
    const inp = msg.usage.input_tokens;
    const out = msg.usage.output_tokens;
    this.totalInputTokens += inp;
    this.totalOutputTokens += out;
    emitTokenLog(
      `[tokens] ${this.model} stream: ↑${inp} ↓${out} (total: ↑${this.totalInputTokens} ↓${this.totalOutputTokens})`,
    );
    callbacks.onInputTokens?.(inp);
    return msg;
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────

let _client: AnthropicClient | null = null;

/**
 * Return the singleton AnthropicClient, built from DB config or env vars.
 * Returns null if no Anthropic provider is configured (Gemini/Ollama/OpenAI only).
 */
export async function getAnthropicClient(): Promise<AnthropicClient | null> {
  if (_client) return _client;

  // 1. DB-configured Anthropic provider
  try {
    const { db } = await import('../db/client.js');
    const { rows } = await db.query<{
      provider_id: string;
      api_key: string;
      model: string;
    }>(
      "SELECT provider_id, api_key, model FROM llm_providers WHERE is_active = true AND provider_id IN ('anthropic','vertex') LIMIT 1",
    );
    const row = rows[0];
    if (row?.provider_id === 'anthropic' && row.api_key) {
      console.log(`[anthropic] DB provider: anthropic (${row.model || DEFAULT_MODEL})`);
      _client = new AnthropicClient({ apiKey: row.api_key, model: row.model || DEFAULT_MODEL });
      return _client;
    }
  } catch {
    // DB unavailable — fall through to env vars
  }

  // 2. Direct Anthropic API key from env
  if (process.env.ANTHROPIC_API_KEY) {
    console.log(`[anthropic] env ANTHROPIC_API_KEY (${DEFAULT_MODEL})`);
    _client = new AnthropicClient({ apiKey: process.env.ANTHROPIC_API_KEY });
    return _client;
  }

  // 3. Vertex AI (ANTHROPIC_VERTEX_PROJECT_ID + GOOGLE_APPLICATION_CREDENTIALS_JSON)
  if (process.env.ANTHROPIC_VERTEX_PROJECT_ID) {
    let credentials: Record<string, unknown> | undefined;
    const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    if (raw) {
      try {
        credentials = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        console.warn('[anthropic] GOOGLE_APPLICATION_CREDENTIALS_JSON is not valid JSON');
      }
    }
    const model = process.env.VERTEX_CLAUDE_MODEL ?? 'claude-sonnet-4-6@default';
    console.log(`[anthropic] Vertex AI (${process.env.ANTHROPIC_VERTEX_PROJECT_ID}, ${model})`);
    const client = new AnthropicClient({
      vertexProjectId: process.env.ANTHROPIC_VERTEX_PROJECT_ID,
      vertexRegion: process.env.CLOUD_ML_REGION ?? 'global',
      model,
    });
    await client.initVertexAuth(credentials);
    _client = client;
    return _client;
  }

  return null; // No Anthropic provider — caller should use LangChain fallback
}

/** True when an Anthropic or Vertex provider is active. */
export async function isAnthropicActive(): Promise<boolean> {
  if (process.env.ANTHROPIC_API_KEY) return true;
  if (process.env.ANTHROPIC_VERTEX_PROJECT_ID) return true;
  try {
    const { db } = await import('../db/client.js');
    const { rows } = await db.query<{ c: string }>(
      "SELECT count(*)::text AS c FROM llm_providers WHERE is_active = true AND provider_id IN ('anthropic','vertex')",
    );
    return parseInt(rows[0]?.c ?? '0') > 0;
  } catch {
    return false;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter(b => b.type === 'text')
    .map(b => (b as Anthropic.TextBlock).text)
    .join('');
}
