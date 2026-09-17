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

import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';
import { logger } from '../utils/logger.js';

const ROUTE_PREFIX = '/swagger';

export function registerSwagger(server: FastifyInstance): void {
  logger.info(`dev-workflow-ai API swagger is running on "${ROUTE_PREFIX}".`);

  server.register(fastifySwagger, {
    openapi: {
      openapi: '3.0.0',
      info: {
        title: 'dev-workflow-ai API',
        description: 'Autonomous AI engineer — issue → implement → review → PR API',
        version: '0.2.0',
      },
    },
    hideUntagged: true,
  });

  server.register(fastifySwaggerUi, {
    routePrefix: ROUTE_PREFIX,
    logo: {
      type: 'image/svg+xml',
      content: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 24">' +
          '<text x="0" y="18" font-family="monospace" font-size="14" fill="#333">dev-workflow-ai</text>' +
          '</svg>',
      ),
    },
    uiConfig: {
      tryItOutEnabled: true,
      validatorUrl: null,
      layout: 'BaseLayout',
    },
  });
}
