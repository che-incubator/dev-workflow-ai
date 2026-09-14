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
import * as projectsService from '@/services/api/projectsService';
import type { Project } from '@/services/api/projectsService';
import type { RootState } from '@/store/index';

const CACHE_TTL_MS = 30_000;

export const fetchProjects = createAsyncThunk<
  Project[],
  { force?: boolean } | undefined,
  { state: RootState; rejectValue: string }
>(
  'projects/fetchProjects',
  async (_arg, { rejectWithValue }) => {
    try {
      return await projectsService.getProjects();
    } catch (e) {
      return rejectWithValue(e instanceof Error ? e.message : 'Failed');
    }
  },
  {
    condition: (arg, { getState }) => {
      if (arg?.force) return true;
      return Date.now() - getState().projects.lastFetchedAt > CACHE_TTL_MS;
    },
  },
);
