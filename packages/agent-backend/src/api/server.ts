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

import Fastify from 'fastify';
import staticPlugin from '@fastify/static';
import websocketPlugin from '@fastify/websocket';
import cookiePlugin from '@fastify/cookie';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { logger } from '../utils/logger.js';
import { registerSwagger } from './swagger.js';
import { projectsRoutes } from './routes/projects.js';
import { issuesRoutes } from './routes/issues.js';
import { runsRoutes } from './routes/runs.js';
import { sourcesRoutes } from './routes/sources.js';
import { providersRoutes } from './routes/providers.js';
import { settingsRoutes } from './routes/settings.js';
import { authRoutes } from './routes/auth.js';
import { agentStream } from './ws/agentStream.js';

export async function buildServer() {
  const app = Fastify({
    loggerInstance: logger,
  });

  // Override the default JSON parser to allow Content-Type: application/json
  // with an empty body (browsers send this on DELETE requests — Fastify rejects
  // it by default with FST_ERR_CTP_EMPTY_JSON_BODY).
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    if (!body || (body as Buffer).length === 0) { done(null, null); return; }
    try { done(null, JSON.parse((body as Buffer).toString())); }
    catch (e) { done(e as Error, undefined); }
  });

  await app.register(cookiePlugin, {
    secret: process.env.SESSION_SECRET ?? 'dev-secret-change-me',
  });

  registerSwagger(app);

  await app.register(websocketPlugin);

  // Auth is handled by the Eclipse Che gateway (oauth-proxy) before requests reach
  // this server. No application-level session check is needed — the gateway is the
  // enforcement point on OpenShift. In dev mode (no gateway), all routes are open.

  // Serve built React UI
  const __dir = dirname(fileURLToPath(import.meta.url));
  const distDir = join(__dir, '../../../../dist'); // from packages/agent-backend/lib/server/ → root dist/
  if (existsSync(distDir)) {
    await app.register(staticPlugin, {
      root: distDir,
      prefix: '/',
      preCompressed: true,
    });
  }

  // User identity (public — no session check)
  await app.register(authRoutes, { prefix: '/api/preferences' });

  // Protected API routes
  await app.register(projectsRoutes, { prefix: '/api/projects' });
  await app.register(issuesRoutes, { prefix: '/api/issues' });
  await app.register(runsRoutes, { prefix: '/api/runs' });
  await app.register(sourcesRoutes, { prefix: '/api/sources' });
  await app.register(providersRoutes, { prefix: '/api/providers' });
  await app.register(settingsRoutes, { prefix: '/api/settings' });

  // WebSocket
  app.get('/ws', { websocket: true }, agentStream);

  // Health check
  app.get('/health', async (_req, reply) =>
    reply.send({ status: 'ok', ts: new Date().toISOString() }),
  );

  // SPA fallback
  if (existsSync(distDir)) {
    app.setNotFoundHandler((_req, reply) => {
      reply.sendFile('index.html');
    });
  }

  return app;
}
