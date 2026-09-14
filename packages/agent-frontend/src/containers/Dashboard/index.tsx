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

import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { fetchRuns, cancelRun, deleteRun, selectRuns, selectRunsLoading } from '@/store/Runs';
import DashboardPage from '@/pages/Dashboard';

export default function DashboardContainer(): React.ReactElement {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const runs = useAppSelector(selectRuns);
  const loading = useAppSelector(selectRunsLoading);

  // Poll every 5 s
  useEffect(() => {
    dispatch(fetchRuns({ force: true }));
    const id = setInterval(() => dispatch(fetchRuns({ force: true })), 5_000);
    return () => clearInterval(id);
  }, [dispatch]);

  return (
    <DashboardPage
      runs={runs}
      loading={loading}
      onNavigate={navigate}
      onCancelRun={(threadId: string) => dispatch(cancelRun(threadId))}
      onDeleteRun={(threadId: string) => dispatch(deleteRun(threadId))}
    />
  );
}
