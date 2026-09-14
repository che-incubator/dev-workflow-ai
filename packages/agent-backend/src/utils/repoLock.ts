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

/*
 * Repo-level mutex: only one agent run may work on a given local repo path
 * at a time. Others wait with exponential back-off.
 *
 * Uses an in-memory Map (sufficient for single-process server). If the
 * server restarts, all locks are cleared automatically.
 */

import { execSync } from 'node:child_process';

// Map<repoPath, threadId>
const held = new Map<string, string>();

const POLL_INTERVAL_MS = 15_000; // 15 s between retry attempts
const MAX_WAIT_MS = 10 * 60_000; // give up after 10 min

/**
 * Acquire the lock for `repoPath`. Waits until the lock is free.
 * @returns a release function — call it when the run is done.
 */
export async function acquireRepoLock(repoPath: string, threadId: string): Promise<() => void> {
  if (!repoPath) return () => {};

  const deadline = Date.now() + MAX_WAIT_MS;

  while (true) {
    const owner = held.get(repoPath);
    if (!owner || owner === threadId) {
      held.set(repoPath, threadId);
      console.log(`[repo-lock] acquired ${repoPath} → ${threadId}`);
      return () => {
        if (held.get(repoPath) === threadId) {
          held.delete(repoPath);
          console.log(`[repo-lock] released ${repoPath}`);
        }
      };
    }

    if (Date.now() > deadline) {
      console.warn(
        `[repo-lock] timeout waiting for ${repoPath} (held by ${owner}) — proceeding anyway`,
      );
      held.set(repoPath, threadId);
      return () => {
        if (held.get(repoPath) === threadId) held.delete(repoPath);
      };
    }

    console.log(
      `[repo-lock] ${repoPath} held by ${owner} — ${threadId} waiting ${POLL_INTERVAL_MS / 1000}s…`,
    );
    await new Promise<void>(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

/**
 * Checkout to defaultBranch and pull latest before starting implementation.
 * Runs synchronously (small repo) to simplify the lock critical section.
 */
export function resetRepoBranch(repoPath: string, defaultBranch: string): void {
  if (!repoPath) return;
  try {
    execSync(
      `git -C ${JSON.stringify(repoPath)} fetch --all --prune && ` +
        `git -C ${JSON.stringify(repoPath)} checkout ${defaultBranch} && ` +
        `git -C ${JSON.stringify(repoPath)} reset --hard origin/${defaultBranch}`,
      { timeout: 60_000, stdio: 'pipe' },
    );
    console.log(`[repo-lock] reset ${repoPath} to ${defaultBranch}`);
  } catch (e) {
    console.warn(
      `[repo-lock] reset failed for ${repoPath}: ${e instanceof Error ? e.message.slice(0, 150) : e}`,
    );
  }
}
