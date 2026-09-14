#!/usr/bin/env node
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
 * run-issue-direct.js — run the agent directly (no API server needed)
 *
 * Usage:
 *   node scripts/run-issue-direct.js https://github.com/eclipse-che/che/issues/20670
 *   node scripts/run-issue-direct.js https://github.com/eclipse-che/che/issues/20670 --force-priority=true
 *   node scripts/run-issue-direct.js https://github.com/eclipse-che/che/issues/20670 --project=che-dashboard
 *
 * Requires env: DATABASE_URL (Postgres), GITHUB_TOKEN (optional — dry-run if absent)
 * For Ollama: OLLAMA_BASE_URL (default: http://localhost:11434), OLLAMA_MODEL
 */

import { runMigrations } from "../packages/agent-backend/src/db/migrations.js";
import { importKnowledge } from "../packages/agent-backend/src/init/importKnowledge.js";
import { buildGraph } from "../packages/agent-backend/src/agent/graph.js";

// ── Parse CLI args ─────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const issueUrl = args.find(a => a.startsWith("http")) ?? "";
const forcePriority =
  args.includes("--force-priority=true") || args.includes("--force-priority");
const projectOverride =
  args.find(a => a.startsWith("--project="))?.split("=")[1] ?? "";
const outputDir = args.find(a => a.startsWith("--output="))?.split("=")[1] ?? "output";

if (!issueUrl) {
  console.error(
    "Usage: node scripts/run-issue-direct.js <github-issue-url> [--force-priority] [--project=<slug>]",
  );
  process.exit(1);
}

// ── Parse GitHub issue URL ─────────────────────────────────────────────────

const urlMatch = issueUrl.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
if (!urlMatch) {
  console.error("Cannot parse GitHub issue URL:", issueUrl);
  process.exit(1);
}
const [, owner, repo, issueNumStr] = urlMatch;
const issueNumber = parseInt(issueNumStr);
const repoSlug = `${owner}/${repo}`;

const REPO_TO_PROJECT = {
  "eclipse-che/che-dashboard": "che-dashboard",
  "eclipse-che/che-server": "che-server",
  "eclipse-che/che": "che",
  "eclipse-che/che-docs": "che-docs",
  "che-incubator/che-ai-tool-images": "che-ai-tool-images",
  "che-incubator/devworkspace-generator": "devworkspace-generator",
  "devfile/devworkspace-operator": "devworkspace-operator",
  "che-incubator/dash-licenses": "dash-licenses",
};

const project = projectOverride || REPO_TO_PROJECT[repoSlug] || repo;
const dryRun = !process.env.GITHUB_TOKEN;

console.log("─────────────────────────────────────────────");
console.log("  dev-workflow-ai — direct run");
console.log("─────────────────────────────────────────────");
console.log(`  Issue:    ${issueUrl}`);
console.log(`  Project:  ${project} (${repoSlug})`);
console.log(
  `  Mode:     ${dryRun ? "DRY-RUN (no GITHUB_TOKEN)" : "LIVE (will push + create PR)"}`,
);
if (dryRun) console.log(`  Output:   ./${outputDir}/`);
console.log(
  `  Model:    ${process.env.OLLAMA_MODEL ?? "qwen2.5-coder:32b-q8_0"} @ ${process.env.OLLAMA_BASE_URL ?? "http://localhost:11434"}`,
);
console.log("─────────────────────────────────────────────");
console.log();

// ── Bootstrap ──────────────────────────────────────────────────────────────

if (process.env.DATABASE_URL) {
  console.log("[boot] Running DB migrations...");
  await runMigrations();

  const knowledgeDir = process.env.KNOWLEDGE_DIR ?? "./";
  console.log(`[boot] Importing knowledge from ${knowledgeDir}...`);
  await importKnowledge();
} else {
  console.log("[boot] No DATABASE_URL — skipping DB (context loaded from files)");
}

// ── Build and run graph ────────────────────────────────────────────────────

const threadId = `direct-${Date.now()}`;
const app = await buildGraph(process.env.DATABASE_URL ?? "");

const initialState = {
  project,
  repoSlug,
  repoLocal: "",
  issueNumber,
  issueUrl,
  forcePriority,
  dryRun,
  outputDir,
};

console.log("[agent] Starting run:", threadId);
console.log();

let lastPhase = "";
try {
  for await (const chunk of await app.stream(initialState, {
    configurable: { thread_id: threadId },
  })) {
    for (const [nodeName, nodeOutput] of Object.entries(chunk)) {
      if (nodeName !== lastPhase) {
        lastPhase = nodeName;
        console.log(`\n── ${nodeName.toUpperCase()} ──`);
      }
      for (const msg of nodeOutput.messages ?? []) {
        console.log("  ", msg);
      }
      if (nodeOutput.status && nodeOutput.status !== "idle") {
        console.log(`  status: ${nodeOutput.status}`);
      }
      if (nodeOutput.prUrl) {
        console.log(`  PR/output: ${nodeOutput.prUrl}`);
      }
    }
  }
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  const isLLMError =
    msg.includes("ECONNREFUSED") ||
    msg.includes("fetch failed") ||
    msg.includes("connect");
  console.error("\n✗ Agent run failed:");
  if (isLLMError) {
    console.error("  LLM connection error — is Ollama running?");
    console.error(`  URL: ${process.env.OLLAMA_BASE_URL ?? "http://localhost:11434"}`);
    console.error(
      "  Fix: ollama serve && ollama pull " +
        (process.env.OLLAMA_MODEL ?? "qwen2.5-coder:32b-q8_0"),
    );
    console.error("  Or:  export ANTHROPIC_API_KEY=sk-ant-...");
  } else {
    console.error(" ", msg);
  }
  process.exit(1);
}

console.log("\n─────────────────────────────────────────────");
console.log("  Run complete");
if (dryRun) {
  console.log(`  Check output: ls -la ${outputDir}/`);
}
console.log("─────────────────────────────────────────────");
