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

import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import RunDetailPage from '@/pages/RunDetail';

export default function RunDetailContainer(): React.ReactElement {
  const { threadId } = useParams<{ threadId: string }>();
  const navigate = useNavigate();

  return <RunDetailPage threadId={threadId} onBack={() => navigate('/dashboard')} />;
}
