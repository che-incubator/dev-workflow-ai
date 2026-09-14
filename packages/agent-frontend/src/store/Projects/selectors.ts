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

const selectProjectsState = (state: RootState) => state.projects;
export const selectProjects = createSelector(selectProjectsState, s => s.items);
export const selectProjectsLoading = createSelector(selectProjectsState, s => s.loading);
