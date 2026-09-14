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

// LangChain-compatible wrapper around the Vertex AI rawPredict endpoint for
// Anthropic Claude models. Vertex AI uses OAuth Bearer tokens (not x-api-key),
// so this class handles GCP auth via google-auth-library and formats messages
// in the Anthropic API format accepted by rawPredict.
//
// Env vars:
//   ANTHROPIC_VERTEX_PROJECT_ID  — GCP project ID (required)
//   CLOUD_ML_REGION              — Vertex AI region (default: us-east5)
//   VERTEX_CLAUDE_MODEL          — model ID (default: claude-sonnet-4-6@default)
//   GOOGLE_APPLICATION_CREDENTIALS_JSON — service account JSON string (inline)
//   GOOGLE_APPLICATION_CREDENTIALS      — path to service account JSON file (file-based)

import { readFileSync } from 'node:fs';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type {
  BaseChatModelCallOptions,
  LangSmithParams,
} from '@langchain/core/language_models/chat_models';
import type { ChatResult, ChatGeneration } from '@langchain/core/outputs';
import type { BaseMessage } from '@langchain/core/messages';
import { AIMessage, ToolMessage } from '@langchain/core/messages';
import { GoogleAuth } from 'google-auth-library';

// ── Anthropic wire types for rawPredict ────────────────────────────────────

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'tool_result'; tool_use_id: string; content: string }
        | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
      >;
}

interface AnthropicResponseContent {
  type: 'text' | 'tool_use';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface AnthropicResponse {
  content: AnthropicResponseContent[];
  stop_reason: string;
  usage?: { input_tokens: number; output_tokens: number };
}

// ── LangChain message → Anthropic message conversion ──────────────────────

function toAnthropicContent(msg: BaseMessage): AnthropicMessage['content'] {
  const type = msg._getType();

  if (type === 'tool') {
    const tm = msg as ToolMessage;
    return [
      {
        type: 'tool_result' as const,
        tool_use_id: tm.tool_call_id,
        content: typeof tm.content === 'string' ? tm.content : JSON.stringify(tm.content),
      },
    ];
  }

  if (type === 'ai') {
    const ai = msg as AIMessage;
    const parts: AnthropicMessage['content'] = [];

    if (typeof ai.content === 'string' && ai.content) {
      parts.push({ type: 'text', text: ai.content });
    } else if (Array.isArray(ai.content)) {
      for (const c of ai.content as Array<{ type: string; text?: string }>) {
        if (c.type === 'text' && c.text) parts.push({ type: 'text', text: c.text });
      }
    }

    for (const tc of ai.tool_calls ?? []) {
      parts.push({
        type: 'tool_use',
        id: tc.id ?? '',
        name: tc.name,
        input: tc.args as Record<string, unknown>,
      });
    }

    return parts.length === 1 && parts[0].type === 'text'
      ? (parts[0] as { type: 'text'; text: string }).text
      : parts;
  }

  return typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
}

function toAnthropicMessages(messages: BaseMessage[]): {
  system: string | undefined;
  messages: AnthropicMessage[];
} {
  let system: string | undefined;
  const converted: AnthropicMessage[] = [];

  for (const msg of messages) {
    const type = msg._getType();
    if (type === 'system') {
      system = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      continue;
    }

    const role: 'user' | 'assistant' =
      type === 'human' ? 'user' : type === 'tool' ? 'user' : 'assistant';

    converted.push({ role, content: toAnthropicContent(msg) });
  }

  return { system, messages: converted };
}

// ── Tool schema conversion ─────────────────────────────────────────────────

interface LangChainTool {
  name: string;
  description?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema?: any;
}

function schemaToJsonSchema(schema: unknown): Record<string, unknown> {
  if (!schema) return { type: 'object', properties: {} };
  // Zod schema — convert using LangChain's bundled converter
  if (schema && typeof schema === 'object' && '_def' in schema) {
    try {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const {
        zodToJsonSchema,
      } = require('@langchain/core/dist/utils/zod-to-json-schema/index.cjs');
      /* eslint-enable @typescript-eslint/no-require-imports */
      const js = zodToJsonSchema(schema);
      return typeof js === 'object' && js !== null
        ? (js as Record<string, unknown>)
        : { type: 'object', properties: {} };
    } catch {
      return { type: 'object', properties: {} };
    }
  }
  // Already a JSON schema object — ensure type is set
  const obj = schema as Record<string, unknown>;
  return { type: 'object', ...obj };
}

function toAnthropicTools(tools: LangChainTool[]): AnthropicTool[] {
  return tools.map(t => ({
    name: t.name,
    description: t.description ?? '',
    input_schema: schemaToJsonSchema(t.schema),
  }));
}

// ── Anthropic response → LangChain ChatResult ─────────────────────────────

function fromAnthropicResponse(data: AnthropicResponse): ChatResult {
  const textParts = data.content.filter(c => c.type === 'text').map(c => c.text ?? '');
  const text = textParts.join('');

  const toolCalls = data.content
    .filter(c => c.type === 'tool_use')
    .map(c => ({
      name: c.name ?? '',
      args: c.input ?? {},
      id: c.id ?? '',
      type: 'tool_call' as const,
    }));

  const message = new AIMessage({ content: text || '', tool_calls: toolCalls });

  return {
    generations: [
      {
        text,
        message,
        generationInfo: {
          finish_reason: data.stop_reason,
          usage: data.usage,
        },
      } as ChatGeneration,
    ],
    llmOutput: { usage: data.usage },
  };
}

// ── VertexAnthropicLLM ─────────────────────────────────────────────────────

export interface VertexAnthropicOptions {
  projectId: string;
  region?: string;
  model?: string;
  maxTokens?: number;
  credentials?: Record<string, unknown>;
}

export class VertexAnthropicLLM extends BaseChatModel {
  protected auth: GoogleAuth;
  protected projectId: string;
  protected region: string;
  protected model: string;
  protected maxTokens: number;
  private _boundTools: LangChainTool[] = [];

  static lc_name(): string {
    return 'VertexAnthropicLLM';
  }

  get lc_secrets(): Record<string, string> {
    return {};
  }

  constructor(opts: VertexAnthropicOptions) {
    super({});
    this.projectId = opts.projectId;
    this.region = opts.region ?? 'global';
    this.model = opts.model ?? 'claude-sonnet-4-6@default';
    this.maxTokens = opts.maxTokens ?? 8192;
    this.auth = new GoogleAuth({
      credentials: opts.credentials,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
  }

  _llmType(): string {
    return 'vertex-anthropic';
  }

  bindTools(
    tools: LangChainTool[],
    _kwargs?: Partial<BaseChatModelCallOptions>,
  ): VertexAnthropicLLM {
    const bound = new VertexAnthropicLLM({
      projectId: this.projectId,
      region: this.region,
      model: this.model,
      maxTokens: this.maxTokens,
    });
    bound.auth = this.auth;
    bound._boundTools = tools;
    return bound;
  }

  getLsParams(_options: BaseChatModelCallOptions): LangSmithParams {
    return {
      ls_provider: 'vertex-anthropic',
      ls_model_name: this.model,
      ls_model_type: 'chat',
    };
  }

  async _generate(messages: BaseMessage[], options: BaseChatModelCallOptions): Promise<ChatResult> {
    const token = await this.auth.getAccessToken();
    if (!token) throw new Error('[vertex-anthropic] Failed to get GCP access token');

    const host =
      this.region === 'global'
        ? 'aiplatform.googleapis.com'
        : `${this.region}-aiplatform.googleapis.com`;
    const endpoint =
      `https://${host}/v1/projects/${this.projectId}` +
      `/locations/${this.region}/publishers/anthropic/models/${this.model}:rawPredict`;

    const { system, messages: anthMessages } = toAnthropicMessages(messages);

    const tools = (options as { tools?: LangChainTool[] }).tools ?? this._boundTools;

    const body: Record<string, unknown> = {
      anthropic_version: 'vertex-2023-10-16',
      max_tokens: this.maxTokens,
      messages: anthMessages,
      ...(system ? { system } : {}),
      ...(tools?.length ? { tools: toAnthropicTools(tools) } : {}),
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`[vertex-anthropic] ${response.status} ${response.statusText}: ${err}`);
    }

    const data = (await response.json()) as AnthropicResponse;
    return fromAnthropicResponse(data);
  }
}

// ── Factory ────────────────────────────────────────────────────────────────

function loadCredentials(): Record<string, unknown> | undefined {
  // Inline JSON takes precedence
  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (raw) {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      console.warn('[vertex-anthropic] GOOGLE_APPLICATION_CREDENTIALS_JSON is not valid JSON');
    }
  }
  // Fall back to file path (standard ADC env var)
  const filePath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (filePath) {
    try {
      return JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
    } catch {
      console.warn(
        `[vertex-anthropic] Could not read GOOGLE_APPLICATION_CREDENTIALS file: ${filePath}`,
      );
    }
  }
  return undefined;
}

export function buildVertexAnthropicLLM(opts?: {
  model?: string;
  maxTokens?: number;
}): VertexAnthropicLLM {
  const projectId = process.env.ANTHROPIC_VERTEX_PROJECT_ID;
  if (!projectId) {
    throw new Error(
      '[vertex-anthropic] ANTHROPIC_VERTEX_PROJECT_ID is required. ' +
        'Set it to your GCP project ID.',
    );
  }

  return new VertexAnthropicLLM({
    projectId,
    region: process.env.CLOUD_ML_REGION ?? 'global',
    model: opts?.model ?? process.env.VERTEX_CLAUDE_MODEL ?? 'claude-sonnet-4-6@default',
    maxTokens: opts?.maxTokens ?? 8192,
    credentials: loadCredentials(),
  });
}

export function isVertexConfigured(): boolean {
  return !!process.env.ANTHROPIC_VERTEX_PROJECT_ID;
}
