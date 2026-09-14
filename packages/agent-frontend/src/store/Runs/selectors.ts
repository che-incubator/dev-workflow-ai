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

import { createSelector } from '@reduxjs/toolkit';
import type { RootState } from '@/store/index';

const selectRunsState = (state: RootState) => state.runs;

export const selectRuns = createSelector(selectRunsState, s => s.items);
export const selectRunsLoading = createSelector(selectRunsState, s => s.loading);
export const selectRunsError = createSelector(selectRunsState, s => s.error);
export const selectActiveRuns = createSelector(selectRuns, runs =>
  runs.filter(r => r.status === 'running'),
);
export const selectRunById = (threadId: string) =>
  createSelector(selectRuns, runs => runs.find(r => r.thread_id === threadId));
