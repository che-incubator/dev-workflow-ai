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

// Authentication is delegated to the Eclipse Che gateway (oauth-proxy).
// When running on OpenShift, the gateway handles the OpenShift OAuth flow and
// injects X-Forwarded-User / X-Forwarded-Preferred-Username headers on every
// authenticated request. The backend simply reads those headers — no sessions,
// no allowlist, no cookies needed.
//
// Dev mode (no gateway): headers absent → resolve identity from GITHUB_TOKEN
// (cached per process) or fall back to a synthetic "dev" user.

import type { FastifyPluginAsync } from 'fastify';

interface GithubUser {
  login: string;
  name: string;
  avatar: string;
}

// Cached on first request; undefined = not fetched yet, null = fetch failed / no token
let _cachedGithubUser: GithubUser | null | undefined = undefined;

async function resolveGithubUser(): Promise<GithubUser | null> {
  if (_cachedGithubUser !== undefined) return _cachedGithubUser;

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.log('[auth] GITHUB_TOKEN not set — using dev mode');
    _cachedGithubUser = null;
    return null;
  }

  try {
    const res = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'dev-workflow-ai' },
    });
    if (res.ok) {
      const gh = (await res.json()) as { login: string; name: string | null; avatar_url: string };
      _cachedGithubUser = {
        login: gh.login,
        name: gh.name || gh.login,
        avatar: gh.avatar_url ?? '',
      };
      console.log(`[auth] GitHub identity resolved: ${_cachedGithubUser.login}`);
      return _cachedGithubUser;
    }
    console.warn(`[auth] GitHub API returned ${res.status} — falling back to dev mode`);
  } catch (e) {
    console.warn('[auth] GitHub API call failed:', e instanceof Error ? e.message : String(e));
  }

  _cachedGithubUser = null;
  return null;
}

const tags = ['Preferences'];

export const authRoutes: FastifyPluginAsync = async app => {
  // GET /api/preferences/user — current user from gateway headers (or dev mode)
  app.get('/user', { schema: { tags } }, async (req, reply) => {
    const preferredUsername = req.headers['x-forwarded-preferred-username'] as string | undefined;
    const forwardedUser = req.headers['x-forwarded-user'] as string | undefined;
    const forwardedEmail = req.headers['x-forwarded-email'] as string | undefined;

    const login = preferredUsername ?? forwardedUser;

    if (!login) {
      // Dev mode: no gateway headers — use GITHUB_TOKEN identity when available
      const gh = await resolveGithubUser();
      if (gh) {
        return reply.send({ login: gh.login, name: gh.name, email: '', avatar: gh.avatar });
      }
      return reply.send({ login: 'dev', name: 'Dev Mode', email: '', avatar: '' });
    }

    return reply.send({
      login,
      name: login,
      email: forwardedEmail ?? '',
      avatar: '',
    });
  });
};
