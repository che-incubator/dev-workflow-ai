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
 * Default model ids, in one place.
 *
 * These were previously duplicated as string literals across `client.ts`,
 * `providers.ts`, `vertexAnthropicLLM.ts` and `anthropicClient.ts`, which let
 * them drift apart. Change a default here, not at the call site.
 *
 * Note the two Claude id formats are not interchangeable:
 *   Anthropic API → `claude-haiku-4-5-20251001`  (hyphen)
 *   Vertex AI     → `claude-haiku-4-5@20251001`  (at-sign)
 *
 * The frontend keeps its own copy in `pages/Settings.tsx`
 * (`PROVIDER_DEFAULT_MODEL`) because the packages share no common module —
 * keep the two in sync.
 */
export const DEFAULT_MODELS = {
  anthropic: 'claude-haiku-4-5-20251001',
  gemini: 'gemini-3.6-flash',
  ollama: 'qwen2.5-coder:7b',
  openai: 'gpt-4o',
  vertex: 'claude-haiku-4-5@20251001',
} as const;

/**
 * Models for the `llm` (fast) singleton — short, high-volume calls such as
 * issue scoring, priority checks and story-point estimation.
 *
 * Same as the provider defaults today; kept separate so the fast path can be
 * pointed at a smaller model than the main one without touching every default.
 */
export const FAST_MODELS = {
  anthropic: process.env.ANTHROPIC_FAST_MODEL ?? DEFAULT_MODELS.anthropic,
  vertex: process.env.VERTEX_FAST_MODEL ?? DEFAULT_MODELS.vertex,
} as const;
