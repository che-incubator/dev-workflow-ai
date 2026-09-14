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

import React, { useState } from 'react';
import {
  Dropdown,
  DropdownGroup,
  DropdownItem,
  DropdownList,
  MenuToggle,
} from '@patternfly/react-core';
import { useAuth } from '../contexts/AuthContext.js';

const AVATAR_DEV = '/branding/avatar-dev.png';

export default function UserMenu() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  if (!user) return null;

  const displayName = user.name || user.login;
  const isDevMode = user.login === 'dev';
  const avatarSrc = user.avatar || AVATAR_DEV;

  return (
    <Dropdown
      isOpen={open}
      onOpenChange={setOpen}
      toggle={(ref: React.Ref<HTMLButtonElement>) => (
        <MenuToggle
          ref={ref}
          id="user-menu-toggle"
          variant="plain"
          onClick={() => setOpen(o => !o)}
          aria-label={`User menu — ${displayName}`}
        >
          <img
            src={avatarSrc}
            alt={displayName}
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              verticalAlign: 'middle',
              marginRight: 6,
            }}
          />
          {displayName}
        </MenuToggle>
      )}
      popperProps={{ position: 'right' }}
    >
      <DropdownList>
        <DropdownGroup label={displayName}>
          <DropdownItem id="user-menu-identity" isDisabled>
            <span style={{ fontSize: '0.8rem', color: 'var(--pf-t--global--text--color--subtle)' }}>
              {isDevMode ? 'dev mode — no GitHub auth' : `@${user.login}`}
            </span>
          </DropdownItem>
        </DropdownGroup>
      </DropdownList>
    </Dropdown>
  );
}
