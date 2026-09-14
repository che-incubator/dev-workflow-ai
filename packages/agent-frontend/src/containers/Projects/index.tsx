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
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { fetchProjects, selectProjects, selectProjectsLoading } from '@/store/Projects';
import ProjectsPage from '@/pages/Projects';

export default function ProjectsContainer(): React.ReactElement {
  const dispatch = useAppDispatch();
  const projects = useAppSelector(selectProjects);
  const loading = useAppSelector(selectProjectsLoading);

  useEffect(() => {
    dispatch(fetchProjects());
  }, [dispatch]);

  return (
    <ProjectsPage
      projects={projects}
      loading={loading}
      onReload={() => dispatch(fetchProjects({ force: true }))}
    />
  );
}
