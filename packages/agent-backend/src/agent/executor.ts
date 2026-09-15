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
 * Executor — selects the right AI tool to run a task.
 *
 * Priority (highest first):
 *   1. Claude Code CLI  (`claude --print`)   — when provider = anthropic/claude  AND binary available
 *   2. Gemini CLI       (`gemini -p`)        — when provider = google/gemini      AND binary available
 *   3. OpenCode CLI     (`opencode run`)     — when provider = opencodeai/opencode AND binary available
 *   4. LangGraph        (existing fallback)  — always available, uses ChatOllama or ChatAnthropic
 *
 * CLI tools are preferred because they have full filesystem access, can run arbitrary
 * bash commands, and support the project's .claude/ / GEMINI.md / opencode.json configs
 * natively — no need to manually wire tool calls.
 */

import { spawn } from 'node:child_process';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type ExecutorKind = 'claude-cli' | 'gemini-cli' | 'opencode-cli' | 'langgraph';

interface ExecutorResult {
  output: string;
  exitCode: number; // 0 = success; non-zero = failure
  executor: ExecutorKind;
}

/** Check if a binary exists in PATH — uses spawn to avoid shell injection */
function commandExists(cmd: string): Promise<boolean> {
  return new Promise(resolve => {
    const child = spawn('which', [cmd], { stdio: 'ignore' });
    child.on('close', code => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

/** Run a command with args using spawn — no shell interpolation, returns exit code + output */
function spawnCommand(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number; stdin?: string },
): Promise<{ output: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd ?? process.cwd(),
      env: opts.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let output = '';
    child.stdout?.on('data', (d: Buffer) => {
      output += d.toString();
    });
    child.stderr?.on('data', (d: Buffer) => {
      output += d.toString();
    });

    if (opts.stdin) {
      child.stdin?.write(opts.stdin);
      child.stdin?.end();
    }

    const timer = opts.timeout
      ? setTimeout(() => {
          child.kill();
          reject(new Error(`Command timed out: ${cmd}`));
        }, opts.timeout)
      : null;

    child.on('close', exitCode => {
      if (timer) clearTimeout(timer);
      resolve({ output: output.trim(), exitCode: exitCode ?? 1 });
    });
    child.on('error', err => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
  });
}

/** Resolve provider from env vars when DB has no active provider configured. */
function resolveProviderFromEnv(dbProviderId: string): string {
  if (dbProviderId !== 'ollama') return dbProviderId; // DB has a real provider
  // No DB provider — infer from env vars
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_VERTEX_PROJECT_ID) return 'anthropic';
  if (process.env.GEMINI_API_KEY) return 'gemini';
  return 'ollama';
}

/** Pick the best executor for the given provider */
export async function detectExecutor(providerId: string): Promise<ExecutorKind> {
  const effectiveProvider = resolveProviderFromEnv(providerId);

  if (effectiveProvider === 'anthropic/claude' || effectiveProvider === 'anthropic') {
    if (await commandExists('claude')) return 'claude-cli';
  }
  if (effectiveProvider === 'google/gemini' || effectiveProvider === 'google') {
    if (await commandExists('gemini')) return 'gemini-cli';
  }
  if (effectiveProvider === 'opencodeai/opencode' || effectiveProvider === 'opencode') {
    if (await commandExists('opencode')) return 'opencode-cli';
  }
  return 'langgraph';
}

/**
 * Run a task using Claude Code CLI.
 *
 * Copies the project context into ~/.claude/CLAUDE.md and project skills,
 * then runs: claude --print "<task>" --allowedTools bash,read,write,edit
 *
 * The .claude/ config in the dev-workflow-ai repo (shared/skills/, rules/)
 * is used automatically because claude looks for it from CWD upwards.
 */
export async function runWithClaudeCli(
  task: string,
  repoLocal: string,
  projectContextPath?: string,
): Promise<ExecutorResult> {
  const claudeHome = `${process.env.HOME ?? '/tmp'}/.claude`;
  await mkdir(claudeHome, { recursive: true });

  // Inject project context as CLAUDE.md if provided
  if (projectContextPath) {
    try {
      const ctx = await readFile(projectContextPath, 'utf8');
      await writeFile(join(claudeHome, 'CLAUDE.md'), ctx, 'utf8');
    } catch {
      /* ignore if context not found */
    }
  }

  // Use spawn with stdin pipe — no shell injection risk
  const { output, exitCode } = await spawnCommand(
    'claude',
    ['--print', '--allowedTools', 'bash,read,write,edit'],
    {
      cwd: repoLocal || process.cwd(),
      timeout: 10 * 60 * 1000,
      stdin: task, // passed via stdin, not as shell argument
    },
  );

  return { output, exitCode, executor: 'claude-cli' };
}

/**
 * Run a task using Gemini CLI.
 *
 * Writes a GEMINI.md file in the project root with context, then runs:
 *   gemini -p "<task>"
 */
export async function runWithGeminiCli(
  task: string,
  repoLocal: string,
  projectContextPath?: string,
): Promise<ExecutorResult> {
  if (projectContextPath && repoLocal) {
    try {
      const ctx = await readFile(projectContextPath, 'utf8');
      // Gemini reads GEMINI.md from CWD
      await writeFile(join(repoLocal, 'GEMINI.md'), ctx, 'utf8');
    } catch {
      /* ignore */
    }
  }

  // Also ensure $HOME/.gemini/projects.json exists (required by gemini-cli)
  const geminiHome = `${process.env.HOME ?? '/tmp'}/.gemini`;
  await mkdir(geminiHome, { recursive: true });
  try {
    await readFile(join(geminiHome, 'projects.json'));
  } catch {
    await writeFile(join(geminiHome, 'projects.json'), '{"projects":{}}', 'utf8');
  }

  const { output, exitCode } = await spawnCommand('gemini', ['-p', task], {
    cwd: repoLocal || process.cwd(),
    timeout: 10 * 60 * 1000,
    env: { ...process.env, GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? '' },
  });

  return { output, exitCode, executor: 'gemini-cli' };
}

/**
 * Run a task using OpenCode CLI.
 *
 * OpenCode reads opencode.json for config (provider, model, instructions).
 * The config is written with the project context as instructions.
 *   opencode run "<task>"
 */
export async function runWithOpencodeCli(
  task: string,
  repoLocal: string,
  projectContextPath?: string,
  model?: string,
): Promise<ExecutorResult> {
  if (repoLocal) {
    let instructions = '';
    if (projectContextPath) {
      try {
        instructions = await readFile(projectContextPath, 'utf8');
      } catch {
        /* ignore */
      }
    }

    // Write opencode.json with context injected as instructions
    const config = {
      model: model ?? 'anthropic/claude-sonnet-4-5',
      instructions: instructions.slice(0, 8000), // opencode has a limit
    };
    await writeFile(join(repoLocal, 'opencode.json'), JSON.stringify(config, null, 2), 'utf8');
  }

  const { output, exitCode } = await spawnCommand('opencode', ['run', task], {
    cwd: repoLocal || process.cwd(),
    timeout: 10 * 60 * 1000,
  });

  return { output, exitCode, executor: 'opencode-cli' };
}
