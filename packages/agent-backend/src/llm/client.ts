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
 * LLM client — builds from DB-configured provider first, falls back to env vars.
 *
 * Provider priority:
 *   1. Active provider in `llm_providers` DB table (configured via Settings UI)
 *   2. ANTHROPIC_API_KEY env var → Claude Sonnet
 *   3. OLLAMA_* env vars → local Ollama
 *
 * Claude extended thinking (budget_tokens=10k) is used for deep analysis phases
 * when the Anthropic provider is active.
 * Docs: https://platform.claude.com/docs/en/extended-thinking
 */

import { ChatOllama } from '@langchain/ollama';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { allTools } from '../tools/index.js';
import {
  buildVertexAnthropicLLM,
  isVertexConfigured,
  VertexAnthropicLLM,
} from './vertexAnthropicLLM.js';

export const MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5-coder:32b-q8_0';
export const OL_URL = process.env.OLLAMA_BASE_URL ?? 'http://ollama:11434';

const THINKING = process.env.CLAUDE_THINKING !== 'false';

// ── Provider config from DB row ────────────────────────────────────────────

export interface ProviderConfig {
  provider_id: string;
  api_key: string;
  base_url: string;
  model: string;
}

export function buildLLMFromProvider(cfg: ProviderConfig): BaseChatModel {
  switch (cfg.provider_id) {
    case 'vertex': {
      // Google Cloud Vertex AI — Claude via service account or ADC.
      // api_key field holds the GCP project ID; base_url holds the region.
      const projectId = cfg.api_key || process.env.ANTHROPIC_VERTEX_PROJECT_ID;
      if (!projectId) {
        throw new Error(
          'Vertex AI: set the project ID in the api_key field (Settings → AI Providers)',
        );
      }
      const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
      let credentials: Record<string, unknown> | undefined;
      if (credentialsJson) {
        try {
          credentials = JSON.parse(credentialsJson) as Record<string, unknown>;
        } catch {
          console.warn('[vertex] GOOGLE_APPLICATION_CREDENTIALS_JSON is invalid JSON');
        }
      }
      const region =
        cfg.base_url && cfg.base_url !== 'global'
          ? cfg.base_url
          : (process.env.CLOUD_ML_REGION ?? 'global');
      return new VertexAnthropicLLM({
        projectId,
        region,
        model: cfg.model || process.env.VERTEX_CLAUDE_MODEL || 'claude-sonnet-4-5@20250929',
        maxTokens: 8192,
        credentials,
      });
    }

    case 'anthropic':
      if (!cfg.api_key)
        throw new Error('Anthropic API key not set — configure it in Settings → AI Providers');
      if (THINKING) {
        return new ChatAnthropic({
          model: cfg.model || 'claude-sonnet-4-6',
          maxTokens: 16000,
          apiKey: cfg.api_key,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...({ thinking: { type: 'enabled', budget_tokens: 10000 } } as any),
        });
      }
      return new ChatAnthropic({
        model: cfg.model || 'claude-sonnet-4-6',
        maxTokens: 16000,
        apiKey: cfg.api_key,
      });

    case 'google':
    case 'gemini': {
      const geminiKey =
        cfg.api_key || process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      if (!geminiKey)
        throw new Error('Gemini API key not set — configure it in Settings → AI Providers');
      return new ChatGoogleGenerativeAI({
        model: cfg.model || 'gemini-3.6-flash',
        apiKey: geminiKey,
        maxOutputTokens: 8192,
        temperature: 0.1,
      });
    }

    case 'openai': {
      if (!cfg.api_key)
        throw new Error('OpenAI API key not set — configure it in Settings → AI Providers');
      return new ChatOpenAI({
        model: cfg.model || 'gpt-4o',
        apiKey: cfg.api_key,
        configuration: cfg.base_url ? { baseURL: cfg.base_url } : undefined,
        maxTokens: 8192,
        temperature: 0.1,
      });
    }

    case 'ollama':
    default:
      return new ChatOllama({
        model: cfg.model || MODEL,
        baseUrl: cfg.base_url || OL_URL,
        numCtx: 32768,
        temperature: 0.1,
        numPredict: 8192,
      });
  }
}

/** Load active provider from DB; fall back to env vars if DB unavailable. */
export async function buildLLMFromDB(): Promise<BaseChatModel> {
  let row: ProviderConfig | undefined;
  try {
    const { db } = await import('../db/client.js');
    const { rows } = await db.query<ProviderConfig>(
      'SELECT provider_id, api_key, base_url, model FROM llm_providers WHERE is_active = true LIMIT 1',
    );
    row = rows[0];
  } catch {
    // DB not available — fall back to env
    return buildEnvLLM();
  }

  if (row) {
    // Let provider-build errors surface — they indicate misconfiguration, not a DB issue
    console.log(`[llm] Using DB provider: ${row.provider_id} (${row.model})`);
    return buildLLMFromProvider(row);
  }

  return buildEnvLLM();
}

// ── Env-var fallback ───────────────────────────────────────────────────────

export function buildEnvLLM(): BaseChatModel {
  if (isVertexConfigured()) {
    console.log('[llm] Using Claude via Vertex AI (ANTHROPIC_VERTEX_PROJECT_ID set)');
    return buildVertexAnthropicLLM();
  }

  if (process.env.ANTHROPIC_API_KEY) {
    console.log(
      `[llm] Using Claude (env ANTHROPIC_API_KEY)${THINKING ? ' + extended thinking' : ''}`,
    );
    if (THINKING) {
      return new ChatAnthropic({
        model: 'claude-sonnet-4-6',
        maxTokens: 16000,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({ thinking: { type: 'enabled', budget_tokens: 10000 } } as any),
      });
    }
    return new ChatAnthropic({ model: 'claude-sonnet-4-6', maxTokens: 8192 });
  }
  const envGeminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (envGeminiKey) {
    const geminiModel = process.env.GEMINI_MODEL ?? 'gemini-3.6-flash';
    console.log(`[llm] Using Gemini (env key) — ${geminiModel}`);
    return new ChatGoogleGenerativeAI({
      model: geminiModel,
      apiKey: envGeminiKey,
      maxOutputTokens: 8192,
      temperature: 0.1,
    });
  }
  console.log(`[llm] Using Ollama (env) — ${MODEL} @ ${OL_URL}`);
  return new ChatOllama({
    model: MODEL,
    baseUrl: OL_URL,
    numCtx: 32768,
    temperature: 0.1,
    numPredict: 8192,
  });
}

// ── Singleton instances (env-based, used before DB is ready) ───────────────

const fastBase = (() => {
  if (process.env.ANTHROPIC_API_KEY) {
    return new ChatAnthropic({ model: 'claude-sonnet-4-6', maxTokens: 4096 });
  }
  if (isVertexConfigured()) {
    return buildVertexAnthropicLLM();
  }
  const ollamaUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
  return new ChatOllama({
    model: MODEL,
    baseUrl: ollamaUrl,
    numCtx: 16384,
    temperature: 0.1,
    numPredict: 2048,
  });
})();

const deepBase = buildEnvLLM();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const llm = (fastBase as any).bindTools(allTools) as BaseChatModel;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const llmDeep = (deepBase as any).bindTools(allTools) as BaseChatModel;

// ── Token usage tracking for LangChain responses ─────────────────────────

import { emitTokenLog } from './tokenLog.js';

let _totalInputTokens = 0;
let _totalOutputTokens = 0;

export function logTokenUsage(
  node: string,
  response: { response_metadata?: Record<string, unknown> },
): void {
  const meta = response.response_metadata as
    | { usage?: { input_tokens?: number; output_tokens?: number; prompt_tokens?: number; completion_tokens?: number } }
    | undefined;
  const inp = meta?.usage?.input_tokens ?? meta?.usage?.prompt_tokens ?? 0;
  const out = meta?.usage?.output_tokens ?? meta?.usage?.completion_tokens ?? 0;
  if (inp || out) {
    _totalInputTokens += inp;
    _totalOutputTokens += out;
    emitTokenLog(
      `[tokens] ${node}: ↑${inp} ↓${out} (total: ↑${_totalInputTokens} ↓${_totalOutputTokens})`,
    );
  }
}
