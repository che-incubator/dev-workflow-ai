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
import { HashRouter, Routes, Route, NavLink, useLocation, Navigate } from 'react-router-dom';
import {
  Page,
  Masthead,
  MastheadMain,
  MastheadToggle,
  MastheadBrand,
  MastheadContent,
  PageSidebar,
  PageSidebarBody,
  Nav,
  NavList,
  NavItem,
  SkipToContent,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
  ToolbarGroup,
  Dropdown,
  DropdownItem,
  DropdownList,
  MenuToggle,
  Brand,
  Spinner,
  Bullseye,
  PageContext,
} from '@patternfly/react-core';
import { QuestionCircleIcon } from '@patternfly/react-icons';

import DashboardContainer from '@/containers/Dashboard';
import RunDetailContainer from '@/containers/RunDetail';
import ProjectsContainer from '@/containers/Projects';
import Issues from '@/pages/Issues';
import Settings from '@/pages/Settings';
import About from '@/pages/About';
import Login from '@/pages/Login';
import Unauthorized from '@/pages/Unauthorized';
import UserMenu from '@/components/UserMenu';
import AppAlertGroup from '@/components/AppAlertGroup';
import WsBanner from '@/components/WsBanner';
import { useBranding } from '@/contexts/BrandingContext';
import { useAuth } from '@/contexts/AuthContext';
import { AlertProvider } from '@/contexts/AlertContext';

const NAV_ITEMS = [
  { to: '/runtime', label: 'Runtime' },
  { to: '/issues', label: 'Issues' },
  { to: '/projects', label: 'Subprojects' },
  { to: '/settings', label: 'Settings' },
];

function AppNav() {
  const location = useLocation();
  return (
    <Nav aria-label="Global navigation">
      <NavList>
        {NAV_ITEMS.map(item => {
          const isActive =
            item.to === '/runtime'
              ? location.pathname === '/' ||
                location.pathname.startsWith('/runtime') ||
                location.pathname.startsWith('/dashboard')
              : location.pathname.startsWith(item.to);
          const navId = `nav-item-${item.label.toLowerCase().replace(/\s+/g, '-')}`;
          return (
            <NavItem key={item.to} id={navId} isActive={isActive}>
              <NavLink to={item.to}>{item.label}</NavLink>
            </NavItem>
          );
        })}
      </NavList>
    </Nav>
  );
}

function HelpMenu({ onAbout }: { onAbout: () => void }) {
  const [open, setOpen] = useState(false);
  const branding = useBranding();

  return (
    <Dropdown
      isOpen={open}
      onOpenChange={setOpen}
      toggle={(ref: React.Ref<HTMLButtonElement>) => (
        <MenuToggle
          ref={ref}
          id="help-menu-toggle"
          variant="plain"
          onClick={() => setOpen(o => !o)}
          aria-label="Help"
        >
          <QuestionCircleIcon />
        </MenuToggle>
      )}
      popperProps={{ position: 'right' }}
    >
      <DropdownList>
        {(branding.links ?? []).map(link => (
          <DropdownItem
            key={link.text}
            onClick={() => {
              window.open(link.href, '_blank');
              setOpen(false);
            }}
          >
            {link.text}
          </DropdownItem>
        ))}
        <DropdownItem
          onClick={() => {
            setOpen(false);
            setTimeout(onAbout, 0);
          }}
        >
          About
        </DropdownItem>
      </DropdownList>
    </Dropdown>
  );
}

// Hamburger button that calls PF6's own sidebar toggle from Page context
function NavToggleButton() {
  const { onSidebarToggle, isSidebarOpen } = React.useContext(PageContext);
  return (
    <button
      id="nav-toggle"
      className="pf-v6-c-button pf-m-plain pf-m-hamburger"
      type="button"
      aria-label="Global navigation"
      aria-expanded={isSidebarOpen}
      onClick={onSidebarToggle}
    >
      <span className="pf-v6-c-button__icon">
        <svg
          viewBox="0 0 10 10"
          className="pf-v6-c-button--hamburger-icon pf-v6-svg"
          width="1em"
          height="1em"
          aria-hidden="true"
        >
          <path className="pf-v6-c-button--hamburger-icon--top" d="M1,1 L9,1" />
          <path className="pf-v6-c-button--hamburger-icon--middle" d="M1,5 L9,5" />
          <path className="pf-v6-c-button--hamburger-icon--arrow" d="M1,5 L1,5 L1,5" />
          <path className="pf-v6-c-button--hamburger-icon--bottom" d="M9,9 L1,9" />
        </svg>
      </span>
    </button>
  );
}

function AppShell() {
  const [aboutOpen, setAboutOpen] = useState(false);
  const branding = useBranding();

  const masthead = (
    <Masthead>
      <MastheadMain>
        <MastheadToggle>
          <NavToggleButton />
        </MastheadToggle>
        <MastheadBrand>
          <Brand
            src={branding.logoFile}
            alt={branding.name}
            style={{ height: '36px', maxWidth: '40px' }}
            onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
              (e.target as HTMLImageElement).src =
                'https://cdn-icons-png.flaticon.com/512/1766/1766950.png';
            }}
          />
        </MastheadBrand>
      </MastheadMain>
      <MastheadContent>
        <Toolbar isStatic>
          <ToolbarContent>
            <ToolbarGroup
              variant="action-group-plain"
              align={{ default: 'alignEnd' }}
              gap={{ default: 'gapNone', md: 'gapMd' }}
            >
              <ToolbarItem>
                <HelpMenu onAbout={() => setAboutOpen(true)} />
              </ToolbarItem>
              <ToolbarItem>
                <UserMenu />
              </ToolbarItem>
            </ToolbarGroup>
          </ToolbarContent>
        </Toolbar>
      </MastheadContent>
    </Masthead>
  );

  return (
    <>
      <Page
        isManagedSidebar
        masthead={masthead}
        sidebar={
          <PageSidebar>
            <PageSidebarBody>
              <AppNav />
            </PageSidebarBody>
          </PageSidebar>
        }
        skipToContent={<SkipToContent href="#main-content">Skip to content</SkipToContent>}
        mainContainerId="main-content"
      >
        <WsBanner />
        <Routes>
          <Route path="/" element={<Navigate to="/runtime" replace />} />
          <Route path="/runtime" element={<DashboardContainer />} />
          <Route path="/dashboard" element={<Navigate to="/runtime" replace />} />
          <Route path="/issues" element={<Issues />} />
          <Route path="/projects" element={<ProjectsContainer />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/runs/:threadId" element={<RunDetailContainer />} />
        </Routes>
      </Page>
      <About isOpen={aboutOpen} onClose={() => setAboutOpen(false)} />
    </>
  );
}

/** Auth guard — redirects to /login when unauthenticated */
function AuthGate() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <Bullseye style={{ minHeight: '100vh' }}>
        <Spinner size="xl" aria-label="Loading" />
      </Bullseye>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/unauthorized" element={<Unauthorized />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return <AppShell />;
}

export default function App() {
  return (
    <AlertProvider>
      <AppAlertGroup />
      <HashRouter>
        <AuthGate />
      </HashRouter>
    </AlertProvider>
  );
}
