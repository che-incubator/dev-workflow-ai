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
 * implement node — ReAct agent loop that lets the LLM iteratively
 * call bash tools to actually implement the fix.
 *
 * Repo management:
 *   - If local_path is set in project context → use it directly
 *   - Otherwise → clone to /tmp/dwa-repos/<owner>/<repo> (one-time)
 *     On subsequent runs: git fetch && git checkout main && git pull -p
 */

import { HumanMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import { llmDeep as llm } from '../llm/client.js';
import { loadContext, loadProjectConfig } from '../context/loader.js';
import { State } from '../agent/state.js';
import {
  detectExecutor,
  runWithClaudeCli,
  runWithGeminiCli,
  runWithOpencodeCli,
} from '../agent/executor.js';
import { allTools } from '../tools/index.js';
import { join, resolve } from 'node:path';
import { writeFile, mkdir, access, readFile } from 'node:fs/promises';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const BASE = new URL('../../', import.meta.url).pathname;
const execAsync = promisify(exec);

// ── Read per-project commands from context.md frontmatter ─────────────────

interface ProjectCommands {
  test?: string;
  lint?: string;
  format?: string;
}

async function readContextCommands(contextFilePath?: string): Promise<ProjectCommands> {
  if (!contextFilePath) return {};
  try {
    const raw = await readFile(contextFilePath, 'utf8');
    const match = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};
    const fm = match[1];
    const section = fm.match(/^commands:\n((?: {2}.*\n?)*)/m);
    if (!section) return {};
    const parse = (key: string): string | undefined => {
      const m = section[1].match(new RegExp(`  ${key}:\\s+"([^"]+)"`));
      return m?.[1];
    };
    return { test: parse('test'), lint: parse('lint'), format: parse('format') };
  } catch {
    return {};
  }
}

// ── Repo management ────────────────────────────────────────────────────────

// In Eclipse Che devworkspace /projects/ is PVC-backed and survives restarts.
// Locally /tmp/ is fine and avoids cluttering ~/workspace.
const REPOS_DIR = process.env.REPOS_DIR ?? '/tmp/dwa-repos';

/**
 * Ensure the repo is available locally.
 * - If config.local_path is set and exists → return it
 * - Otherwise → clone to /tmp/dwa-repos/<owner>/<repo>, or pull if already there
 */
async function ensureRepo(repoSlug: string, localPath?: string): Promise<string> {
  // Use configured local path if it exists
  if (localPath) {
    try {
      await access(localPath);
      // Pull latest main
      await execAsync('git fetch && git checkout main && git pull -p', {
        cwd: localPath,
        timeout: 60_000,
      }).catch(() => {}); // non-fatal
      console.log(`[repo] Using local clone: ${localPath}`);
      return localPath;
    } catch {
      console.log(`[repo] local_path not accessible, falling back to tmp clone`);
    }
  }

  // Auto-clone to /tmp/dwa-repos/<owner>/<repo>
  const [owner, repo] = repoSlug.split('/');
  const tmpPath = join(REPOS_DIR, owner, repo);

  await mkdir(join(REPOS_DIR, owner), { recursive: true });

  try {
    await access(join(tmpPath, '.git'));
    // Already cloned — just pull
    console.log(`[repo] Pulling ${repoSlug} in ${tmpPath}...`);
    await execAsync('git fetch && git checkout main && git pull -p', {
      cwd: tmpPath,
      timeout: 60_000,
    });
  } catch {
    // Clone fresh
    console.log(`[repo] Cloning ${repoSlug} to ${tmpPath}...`);
    const token = process.env.GITHUB_TOKEN;
    const url = token
      ? `https://${token}@github.com/${repoSlug}.git`
      : `https://github.com/${repoSlug}.git`;
    await execAsync(`git clone --depth=50 "${url}" "${tmpPath}"`, { timeout: 120_000 });
  }

  return tmpPath;
}

// ── Tool execution loop ────────────────────────────────────────────────────

async function executeToolCalls(
  toolCalls: Array<{ id?: string; name: string; args: Record<string, unknown> }>,
): Promise<ToolMessage[]> {
  const toolMap = Object.fromEntries(allTools.map(t => [t.name, t]));
  const results: ToolMessage[] = [];

  for (const call of toolCalls) {
    const tool = toolMap[call.name];
    if (!tool) {
      results.push(
        new ToolMessage({ tool_call_id: call.id ?? '', content: `Unknown tool: ${call.name}` }),
      );
      continue;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const output = await (tool as any).invoke(call.args);
      // Cap tool output to prevent Gemini context overflow (e.g. yarn test dumps MBs)
      const out = String(output);
      const capped =
        out.length > 3000
          ? `[...truncated ${out.length - 3000} chars...]\n` + out.slice(-3000)
          : out;
      results.push(new ToolMessage({ tool_call_id: call.id ?? '', content: capped }));
    } catch (e) {
      results.push(new ToolMessage({ tool_call_id: call.id ?? '', content: `Error: ${e}` }));
    }
  }
  return results;
}

async function runAgentLoop(
  systemPrompt: string,
  userPrompt: string,
  maxTurns = 15,
): Promise<{ finalOutput: string; toolOutputs: string[] }> {
  const messages: (HumanMessage | AIMessage | ToolMessage)[] = [new HumanMessage(userPrompt)];
  const toolOutputs: string[] = [];

  for (let turn = 0; turn < maxTurns; turn++) {
    const response = await llm.invoke(messages, { system: systemPrompt } as Parameters<
      typeof llm.invoke
    >[1]);

    let textContent: string;
    if (typeof response.content === 'string') {
      textContent = response.content;
    } else if (Array.isArray(response.content)) {
      textContent = response.content
        .map((p: unknown) => (typeof p === 'string' ? p : ((p as { text?: string }).text ?? '')))
        .join('');
    } else {
      textContent = '';
    }

    const aiMsg = response as AIMessage;
    const hasToolCalls = Array.isArray(aiMsg.tool_calls) && aiMsg.tool_calls.length > 0;
    messages.push(aiMsg);

    if (!hasToolCalls) {
      return { finalOutput: textContent, toolOutputs };
    }

    const toolResults = await executeToolCalls(aiMsg.tool_calls ?? []);
    for (const tr of toolResults) {
      const toolName =
        (aiMsg.tool_calls ?? []).find(tc => tc.id === tr.tool_call_id)?.name ?? 'tool';
      toolOutputs.push(`[${toolName}]: ${tr.content}`);
      messages.push(tr);
    }
  }

  return { finalOutput: '(max turns reached)', toolOutputs };
}

// ── Main node ──────────────────────────────────────────────────────────────

export async function implementNode(state: State): Promise<Partial<State>> {
  const context = await loadContext(state.project, [
    'context',
    'rules-dev',
    'rules-commit-conventions', // shared: commit message format, trailers, types
    'skills-fix-issue', // project-specific implementation skill (if present)
    'skills-fix-cve-dep', // project-specific CVE dep upgrade steps (if present)
  ]);
  const config = await loadProjectConfig(state.project);

  // ── Detect executor ───────────────────────────────────────────────────────
  let activeProviderId = 'ollama';
  try {
    const { db } = await import('../db/client.js');
    const { rows } = await db.query<{ provider_id: string }>(
      'SELECT provider_id FROM llm_providers WHERE is_active = true LIMIT 1',
    );
    if (rows[0]) activeProviderId = rows[0].provider_id;
  } catch {
    /* use env fallback */
  }

  const executor = await detectExecutor(activeProviderId);
  const contextFilePath = state.project
    ? join(BASE, `pg_seed/eclipse-che/subprojects/${state.project}/context.md`)
    : undefined;

  // ── Ensure repo is available locally ─────────────────────────────────────
  let repoLocal = state.repoLocal;
  if (!repoLocal || repoLocal === '') {
    try {
      repoLocal = await ensureRepo(state.repoSlug, config?.local_path);
    } catch (e) {
      console.warn(`[implement] Could not clone repo: ${e}`);
      repoLocal = '';
    }
  }

  // ── Commands — per-project overrides > stack detection ────────────────────
  const projectCmds = await readContextCommands(contextFilePath);
  const stack = config?.stack ?? [];
  const isTypeScript = stack.some(s => s.toLowerCase().includes('typescript'));
  const isGo = stack.some(s => s.toLowerCase().includes('go'));
  const isJava = stack.some(
    s => s.toLowerCase().includes('java') || s.toLowerCase().includes('maven'),
  );

  const affectedTest = state.affectedFiles
    .map(
      f =>
        f
          .split('/')
          .pop()
          ?.replace(/\.(ts|tsx)$/, '') ?? '',
    )
    .filter(Boolean)
    .join('|');

  const testCmdDefault = isTypeScript
    ? `yarn workspace @eclipse-che/dashboard-frontend test --testPathPatterns="${affectedTest || 'helpers'}" --no-cache 2>&1 | tail -15`
    : isGo
      ? 'make test 2>&1 | tail -30'
      : isJava
        ? 'mvn test -q 2>&1 | tail -30'
        : "echo 'no test command'";
  const lintCmdDefault = isTypeScript
    ? 'yarn lint:fix 2>&1 | tail -20'
    : isGo
      ? 'make lint 2>&1 | tail -20'
      : isJava
        ? 'mvn checkstyle:check -q 2>&1 | tail -20'
        : "echo 'no lint command'";
  const formatCmdDefault = isTypeScript ? 'yarn format:fix 2>&1 | tail -10' : '';

  const testCmd = projectCmds.test ?? testCmdDefault;
  const lintCmd = projectCmds.lint ?? lintCmdDefault;
  const formatCmd = projectCmds.format ?? formatCmdDefault;

  const retryNote =
    state.retryCount > 0
      ? `\nRetry attempt ${state.retryCount} — previous run failed. Fix those issues.`
      : '';

  const taskDescription = `
Fix GitHub issue #${state.issueNumber} in ${state.repoSlug}.
Working directory: ${repoLocal || '/tmp/dwa-repos/'}
${retryNote}

Area: ${state.area}
Summary: ${state.fixSummary}
Branch: ${state.branchName}
Affected files: ${state.affectedFiles.join(', ')}

Steps (use bash tool to execute each):
1. cd ${repoLocal || '.'} && git checkout main && git pull -p && git checkout -b ${state.branchName}
2. Read the affected files to understand the current code
3. Implement the fix following coding rules (no any, absolute imports, EPL-2.0 header in new .ts files)
4. Run: ${testCmd}
5. Run: ${lintCmd}
${formatCmd ? `6. Run: ${formatCmd}` : ''}
7. git add -A && git commit -m "fix(${state.area}): ${state.fixSummary}\n\nCloses #${state.issueNumber}\n\nAssisted-by: dev-workflow-ai"

After completing all steps, reply with JSON:
{"filesChanged":["path1"],"testsPassed":true,"lintPassed":true}
`;

  // ── CLI executor path ─────────────────────────────────────────────────────
  if (executor !== 'langgraph') {
    try {
      let result;
      if (executor === 'claude-cli') {
        result = await runWithClaudeCli(taskDescription, repoLocal, contextFilePath);
      } else if (executor === 'gemini-cli') {
        result = await runWithGeminiCli(taskDescription, repoLocal, contextFilePath);
      } else {
        result = await runWithOpencodeCli(taskDescription, repoLocal, contextFilePath);
      }
      const passed = result.exitCode === 0;
      return {
        filesChanged: state.affectedFiles,
        testsPassed: passed,
        lintPassed: passed,
        messages: [`implement[${result.executor}]: ${passed ? '✓' : '⚠'} — ${repoLocal}`],
      };
    } catch (err) {
      console.warn(`[implement] ${executor} failed: ${err}. Using LangGraph ReAct.`);
    }
  }

  // ── LangGraph ReAct tool loop ─────────────────────────────────────────────
  const systemPrompt = `You are an expert software engineer. Implement the fix by executing bash commands.

CRITICAL RULES:
1. Always pass cwd="${repoLocal || REPOS_DIR}" to every bash tool call.
2. WRITE all file changes using bash. Never describe changes — execute them.
3. To edit a file use Python (most reliable):
   bash: python3 -c "
   content = open('path/to/file.ts').read()
   content = content.replace('old_code', 'new_code')
   open('path/to/file.ts', 'w').write(content)
   " cwd=${repoLocal || REPOS_DIR}
4. For multi-line changes use heredoc:
   bash: cat > path/to/file.ts << 'ENDOFFILE'
   ...full file content...
   ENDOFFILE    cwd=${repoLocal || REPOS_DIR}
5. After editing ALL files: git add -A && git commit
6. Only after committing: respond with the JSON result.

PROJECT CONTEXT:
${context}

CODING RULES: ${isTypeScript ? "No 'any'. @/ absolute imports. EPL-2.0 header in new files." : isGo ? 'Check all errors. Context propagation.' : 'Follow existing style.'}

MANDATORY final response — JSON only, no markdown:
{"filesChanged":["file1","file2"],"testsPassed":true,"lintPassed":true}`;

  const { finalOutput, toolOutputs } = await runAgentLoop(systemPrompt, taskDescription);

  const stripped = finalOutput.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '');
  const jsonMatch = stripped.match(/\{[\s\S]+\}/);

  if (!jsonMatch) {
    const newRetry = state.retryCount + 1;
    const isLastRetry = newRetry >= 3;

    if (state.dryRun && state.outputDir) {
      const slug = `${state.repoSlug.replace('/', '-')}-${state.issueNumber ?? 'unknown'}`;
      const outDir = resolve(state.outputDir, slug);
      await mkdir(outDir, { recursive: true });

      // Always write the agent plan so at least exploration is visible
      await writeFile(
        join(outDir, 'agent-plan.md'),
        `# Agent Implementation Plan\n\n**Repo:** ${repoLocal || '(no clone)'}\n**Branch:** ${state.branchName || '(none)'}\n**Summary:** ${state.fixSummary}\n\n## Tool outputs\n\n${toolOutputs.join('\n\n')}`,
        'utf8',
      );

      // Try to generate a real patch from any commits that may have been made
      if (isLastRetry && repoLocal && state.branchName) {
        try {
          const { stdout: patch } = await execAsync(
            `git diff main...${state.branchName} 2>/dev/null || git diff HEAD~1 2>/dev/null || echo ''`,
            { cwd: repoLocal, timeout: 15_000 },
          );
          if (patch.trim()) {
            await writeFile(join(outDir, 'changes.patch'), patch, 'utf8');
          } else {
            // No commits — write a placeholder so the user knows there's no diff
            await writeFile(
              join(outDir, 'changes.patch'),
              `# No changes committed\n# The agent explored the code but did not commit changes.\n# Branch: ${state.branchName}\n# Repo: ${repoLocal}\n`,
              'utf8',
            );
          }
        } catch {
          // Non-fatal
        }
      }
    }

    return {
      testsPassed: false,
      lintPassed: false,
      retryCount: newRetry,
      messages: [`implement: no JSON (retry ${newRetry}/3)`, ...toolOutputs.slice(-2)],
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      filesChanged: string[];
      testsPassed: boolean;
      lintPassed: boolean;
    };
    const allPassed = parsed.testsPassed && parsed.lintPassed;

    // Generate real patch from the branch
    if (state.dryRun && state.outputDir && repoLocal) {
      try {
        const { stdout: patch } = await execAsync(`git diff main...${state.branchName}`, {
          cwd: repoLocal,
          timeout: 30_000,
        });
        if (patch.trim()) {
          const slug = `${state.repoSlug.replace('/', '-')}-${state.issueNumber ?? 'unknown'}`;
          const outDir = resolve(state.outputDir, slug);
          await mkdir(outDir, { recursive: true });
          await writeFile(join(outDir, 'changes.patch'), patch, 'utf8');
        }
      } catch {
        /* non-fatal */
      }
    }

    return {
      filesChanged: parsed.filesChanged ?? [],
      testsPassed: parsed.testsPassed,
      lintPassed: parsed.lintPassed,
      retryCount: allPassed ? state.retryCount : state.retryCount + 1,
      messages: [
        `implement: ${parsed.filesChanged?.length ?? 0} files — tests:${parsed.testsPassed ? '✓' : '❌'} lint:${parsed.lintPassed ? '✓' : '❌'}`,
      ],
    };
  } catch {
    return {
      testsPassed: false,
      lintPassed: false,
      retryCount: state.retryCount + 1,
      messages: ['implement: JSON parse error'],
    };
  }
}
