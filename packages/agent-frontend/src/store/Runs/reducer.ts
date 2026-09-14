/*
 * Copyright (c) 2026 Red Hat, Inc.
 * SPDX-License-Identifier: EPL-2.0
 */

import { createReducer } from '@reduxjs/toolkit';
import type { AgentRun } from '@/services/api/runsService';
import { fetchRuns, cancelRun, deleteRun } from './actions';

export interface State {
  items: AgentRun[];
  loading: boolean;
  error: string | null;
  lastFetchedAt: number;
}

const unloadedState: State = {
  items: [],
  loading: false,
  error: null,
  lastFetchedAt: 0,
};

export const reducer = createReducer(unloadedState, builder =>
  builder
    .addCase(fetchRuns.pending, state => { state.loading = true; state.error = null; })
    .addCase(fetchRuns.fulfilled, (state, action) => {
      state.loading = false;
      state.items = action.payload;
      state.lastFetchedAt = Date.now();
    })
    .addCase(fetchRuns.rejected, (state, action) => {
      state.loading = false;
      state.error = action.payload ?? 'Unknown error';
    })
    .addCase(cancelRun.fulfilled, (state, action) => {
      const threadId = action.meta.arg;
      const run = state.items.find(r => r.thread_id === threadId);
      if (run) run.status = 'failed';
    })
    .addCase(deleteRun.fulfilled, (state, action) => {
      const threadId = action.meta.arg;
      state.items = state.items.filter(r => r.thread_id !== threadId);
    })
    .addDefaultCase(state => state),
);
