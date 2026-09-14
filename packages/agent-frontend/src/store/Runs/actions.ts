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
 * Copyright (c) 2026 Red Hat, Inc.
 * SPDX-License-Identifier: EPL-2.0
 */

import { createAsyncThunk } from '@reduxjs/toolkit';
import * as runsService from '@/services/api/runsService';
import type { AgentRun } from '@/services/api/runsService';
import type { RootState } from '@/store/index';

const CACHE_TTL_MS = 5_000;

export const fetchRuns = createAsyncThunk<
  AgentRun[],
  { force?: boolean } | undefined,
  { state: RootState; rejectValue: string }
>(
  'runs/fetchRuns',
  async (_arg, { rejectWithValue }) => {
    try {
      return await runsService.getRuns();
    } catch (e) {
      return rejectWithValue(e instanceof Error ? e.message : 'Failed to fetch runs');
    }
  },
  {
    condition: (arg, { getState }) => {
      if (arg?.force) return true;
      const { runs } = getState();
      return Date.now() - runs.lastFetchedAt > CACHE_TTL_MS;
    },
  },
);

export const cancelRun = createAsyncThunk<void, string, { rejectValue: string }>(
  'runs/cancelRun',
  async (threadId, { rejectWithValue }) => {
    try {
      await runsService.cancelRun(threadId);
    } catch (e) {
      return rejectWithValue(e instanceof Error ? e.message : 'Failed to cancel run');
    }
  },
);

export const deleteRun = createAsyncThunk<void, string, { rejectValue: string }>(
  'runs/deleteRun',
  async (threadId, { rejectWithValue }) => {
    try {
      await runsService.cancelRun(threadId);
    } catch (e) {
      return rejectWithValue(e instanceof Error ? e.message : 'Failed to delete run');
    }
  },
);

export const startRun = createAsyncThunk<
  { threadId: string },
  Parameters<typeof runsService.startRun>[0],
  { rejectValue: string }
>('runs/startRun', async (body, { rejectWithValue }) => {
  try {
    return await runsService.startRun(body);
  } catch (e) {
    return rejectWithValue(e instanceof Error ? e.message : 'Failed to start run');
  }
});
