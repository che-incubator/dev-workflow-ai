# Rework Plan: agent-backend — Direct Anthropic SDK, Anthropic-first

**Goal**: Make the agent as fast and direct as Claude Code CLI by replacing the LangChain/LangGraph
stack with `@anthropic-ai/sdk` + a lightweight state machine. Start with the Anthropic provider only.

---

## Why the current stack is slow

| Problem | Root cause |
|---|---|
| LangChain message conversion overhead | Every call goes through `BaseChatModel` → LangChain message format → provider wire format → back |
| LangGraph checkpoint serialization | Every node transition serializes/deserializes full state to PGlite/Postgres |
| Tool schema conversion (`schemaToJsonSchema`) | Zod → JSON Schema via internal LangChain path, now broken/patched out |
| `buildLLMFromDB()` on every run | Async DB query to resolve provider before first token |
| LangGraph `StateGraph` overhead | Graph compilation, node routing, and annotation diffing per step |
| `ChatAnthropic` thinking workaround | `as any` cast to pass `thinking` param — bypasses SDK type safety |

Claude Code CLI calls the Anthropic API directly with `@anthropic-ai/sdk`, streams tokens immediately,
and manages state in a plain TypeScript object. Zero framework overhead between the token and the UI.

---

## Target architecture

```
client (WebSocket)
    │
    ▼
AgentRunner (new: src/agent/runner.ts)
    │  plain async loop — no LangGraph
    │  Anthropic SDK streaming directly
    │
    ├── analyzePhase()   → sdk.messages.stream(...)
    ├── implementPhase() → sdk.messages.stream(...)
    ├── reviewPhase()    → sdk.messages.stream(...)
    └── openPrPhase()    → deterministic (git/gh CLI, no LLM)
```

State = plain TypeScript interface (no Annotation.Root, no reducers).
Persistence = write a JSON snapshot to PGlite after each phase (not after every LLM token).

---

## Step 1 — Anthropic provider direct SDK (this PR)

### 1.1 Install `@anthropic-ai/sdk`

```bash
yarn add @anthropic-ai/sdk
```

Remove from package.json (once all providers migrated):

```
@langchain/anthropic
@langchain/core          # keep until other providers migrated
@langchain/langgraph
@langchain/langgraph-checkpoint-postgres
```

### 1.2 New file: `src/llm/anthropicClient.ts`

```typescript
import Anthropic from '@anthropic-ai/sdk';
import type { MessageStreamEvent } from '@anthropic-ai/sdk/resources/messages';

export interface AnthropicConfig {
  apiKey?: string;
  vertexProjectId?: string;
  vertexRegion?: string;
  vertexCredentials?: Record<string, unknown>;
  model?: string;
  maxTokens?: number;
  thinking?: boolean;
}

export interface StreamCallbacks {
  onText?: (text: string) => void;
  onThinking?: (thinking: string) => void;
  onToolUse?: (name: string, input: Record<string, unknown>) => void;
  onInputTokens?: (n: number) => void;
  onOutputTokens?: (n: number) => void;
}

export class AnthropicClient {
  private sdk: Anthropic;
  private model: string;
  private maxTokens: number;
  private thinking: boolean;

  constructor(cfg: AnthropicConfig) {
    this.sdk = new Anthropic({ apiKey: cfg.apiKey });
    this.model = cfg.model ?? 'claude-sonnet-4-6';
    this.maxTokens = cfg.maxTokens ?? 16000;
    this.thinking = cfg.thinking ?? false;
  }

  async stream(
    messages: Anthropic.MessageParam[],
    system: string,
    tools: Anthropic.Tool[],
    callbacks: StreamCallbacks,
  ): Promise<Anthropic.Message> {
    const params: Anthropic.MessageStreamParams = {
      model: this.model,
      max_tokens: this.maxTokens,
      system,
      messages,
      ...(tools.length ? { tools } : {}),
      ...(this.thinking
        ? { thinking: { type: 'enabled', budget_tokens: 10000 }, betas: ['interleaved-thinking-2025-05-14'] }
        : {}),
    };

    const stream = this.sdk.messages.stream(params);

    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') callbacks.onText?.(event.delta.text);
        if (event.delta.type === 'thinking_delta') callbacks.onThinking?.(event.delta.thinking);
      }
      if (event.type === 'message_delta' && event.usage) {
        callbacks.onOutputTokens?.(event.usage.output_tokens);
      }
    }

    const msg = await stream.finalMessage();
    callbacks.onInputTokens?.(msg.usage.input_tokens);
    return msg;
  }
}
```

### 1.3 New file: `src/llm/clientFactory.ts`

Replaces `buildLLMFromDB()` + `buildLLMFromProvider()`.

```typescript
import { AnthropicClient } from './anthropicClient.js';

let _cached: AnthropicClient | null = null;

export async function getAnthropicClient(): Promise<AnthropicClient> {
  if (_cached) return _cached;

  // 1. DB-configured provider
  const row = await getActiveProviderRow();
  if (row?.provider_id === 'anthropic') {
    _cached = new AnthropicClient({ apiKey: row.api_key, model: row.model, thinking: true });
    return _cached;
  }

  // 2. Vertex AI
  if (process.env.ANTHROPIC_VERTEX_PROJECT_ID) {
    // Keep existing VertexAnthropicLLM for now — Phase 2 replaces this
    throw new Error('Vertex: use existing VertexAnthropicLLM in Phase 2');
  }

  // 3. Direct API key
  if (process.env.ANTHROPIC_API_KEY) {
    _cached = new AnthropicClient({
      apiKey: process.env.ANTHROPIC_API_KEY,
      thinking: process.env.CLAUDE_THINKING !== 'false',
    });
    return _cached;
  }

  throw new Error('No Anthropic provider configured');
}
```

### 1.4 New file: `src/agent/runner.ts`

Replace `graph.ts` + LangGraph `StateGraph` with a plain async loop:

```typescript
import type { AnthropicClient } from '../llm/anthropicClient.js';
import type { RunState } from './runState.js';

export async function runAgent(
  state: RunState,
  llm: AnthropicClient,
  onEvent: (event: AgentEvent) => void,
): Promise<RunState> {
  // Phase 1: analyze
  state = await analyzePhase(state, llm, onEvent);
  if (state.skip) return state;

  // Phase 2: implement
  state = await implementPhase(state, llm, onEvent);

  // Phase 3: review (up to 3 rounds)
  for (let round = 0; round < 3; round++) {
    state = await reviewPhase(state, llm, onEvent);
    if (!state.reviewHasBlockers) break;
    state = await fixFeedbackPhase(state, llm, onEvent);
  }

  // Phase 4: open PR (deterministic)
  state = await openPrPhase(state, onEvent);
  return state;
}
```

State type (`src/agent/runState.ts`):

```typescript
export interface RunState {
  // input
  project: string;
  repoSlug: string;
  issueNumber: number | null;
  issueUrl: string;
  dryRun: boolean;
  forcePriority: boolean;
  outputDir: string;

  // accumulated
  messages: Anthropic.MessageParam[];
  issueTitle: string;
  issueBody: string;
  affectedFiles: string[];
  fixSummary: string;
  branchName: string;
  prUrl: string;

  // control
  skip: boolean;
  reviewHasBlockers: boolean;
  reviewRounds: number;
}
```

### 1.5 Tool definitions — native SDK format

No more Zod / `schemaToJsonSchema`. Tools as plain objects:

```typescript
// src/tools/ghTool.ts
import type Anthropic from '@anthropic-ai/sdk';

export const ghTool: Anthropic.Tool = {
  name: 'gh_run_command',
  description: 'Run a gh CLI command and return stdout',
  input_schema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The gh command arguments (e.g. "issue view 123 --repo owner/repo")' },
    },
    required: ['command'],
  },
};

export async function executeGhTool(input: { command: string }): Promise<string> {
  const { exec } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execAsync = promisify(exec);
  const { stdout } = await execAsync(`gh ${input.command}`, { timeout: 30_000 });
  return stdout;
}
```

Tool execution loop inside each phase:

```typescript
while (true) {
  const msg = await llm.stream(state.messages, systemPrompt, tools, callbacks);
  state.messages.push({ role: 'assistant', content: msg.content });

  if (msg.stop_reason !== 'tool_use') break;

  const results: Anthropic.MessageParam = { role: 'user', content: [] };
  for (const block of msg.content) {
    if (block.type !== 'tool_use') continue;
    const output = await dispatchTool(block.name, block.input as Record<string, unknown>);
    (results.content as Anthropic.ToolResultBlockParam[]).push({
      type: 'tool_result',
      tool_use_id: block.id,
      content: output,
    });
  }
  state.messages.push(results);
}
```

---

## Step 2 — Vertex AI via `@anthropic-ai/sdk` (follow-up PR)

`@anthropic-ai/sdk` supports Vertex AI natively:

```typescript
import AnthropicVertex from '@anthropic-ai/sdk/vertex';

const client = new AnthropicVertex({
  projectId: process.env.ANTHROPIC_VERTEX_PROJECT_ID,
  region: process.env.CLOUD_ML_REGION ?? 'us-east5',
  googleAuth: new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/cloud-platform'] }),
});
```

This replaces the hand-rolled `VertexAnthropicLLM` class entirely.

---

## Step 3 — Remove LangChain entirely (follow-up PR)

After Steps 1+2, audit remaining LangChain imports:
- `@langchain/ollama` → use Ollama's REST API directly (`/api/chat` with streaming)
- `@langchain/google-genai` → use `@google/generative-ai` SDK directly
- `@langchain/openai` → use `openai` npm package directly
- `@langchain/core` → no longer needed
- `@langchain/langgraph` → replaced by `runner.ts`
- `@langchain/langgraph-checkpoint-postgres` → replaced by simple JSON snapshots in PGlite

---

## Files to create / modify

| Action | File | What |
|---|---|---|
| Create | `src/llm/anthropicClient.ts` | Direct SDK wrapper with streaming |
| Create | `src/llm/clientFactory.ts` | Replaces `buildLLMFromDB` + `buildLLMFromProvider` |
| Create | `src/agent/runner.ts` | Plain async loop replaces StateGraph |
| Create | `src/agent/runState.ts` | Plain TS interface replaces `Annotation.Root` |
| Create | `src/tools/ghTool.ts` | Native SDK tool format |
| Modify | `src/api/routes/runs.ts` | Call `runAgent()` instead of `app.stream()` |
| Modify | `src/api/ws/agentStream.ts` | Wire `onEvent` callbacks to WebSocket |
| Delete | `src/agent/graph.ts` | LangGraph StateGraph |
| Delete | `src/agent/state.ts` | LangGraph Annotation state |
| Delete | `src/llm/client.ts` | LangChain BaseChatModel builders |
| Delete | `src/llm/vertexAnthropicLLM.ts` | Hand-rolled Vertex wrapper (Step 2) |

---

## Expected gains

| Metric | Now (LangGraph) | Target (direct SDK) |
|---|---|---|
| Time to first token | ~3–8s (graph init + DB query + LangChain overhead) | <1s (SDK streams immediately) |
| Tool call round-trip | ~2s (LangChain message conversion) | ~200ms (SDK native) |
| Extended thinking | `as any` cast, may break | First-class SDK support |
| Memory per run | LangGraph checkpoint state | Plain object, GC-friendly |
| Bundle size | 7 LangChain packages | 1 SDK package |

---

## What to keep unchanged

- Fastify REST API and WebSocket — no changes needed
- PGlite / Postgres DB schema — keep `agent_runs`, `issues`, `projects` tables
- Phase logic (analyze → implement → review → openPr) — same sequence, different execution engine
- Frontend — no changes needed; WebSocket event format stays the same
- Non-Anthropic providers (Gemini, Ollama, OpenAI) — keep LangChain wrappers until Step 3
