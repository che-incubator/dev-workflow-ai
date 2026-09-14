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

import { LevelWithSilent, pino } from 'pino';
import pretty from 'pino-pretty';
import type { FastifyInstance } from 'fastify';

export const stream = pretty({
  levelFirst: true,
  colorize: true,
  ignore: 'pid,hostname',
  translateTime: 'HH:MM:ss Z',
});

export const logger = pino(stream);

const logLevels = [
  'debug',
  'error',
  'fatal',
  'info',
  'silent',
  'trace',
  'warn',
] as LevelWithSilent[];

/* eslint-disable no-redeclare */
export function updateLogLevel(logLevel: LevelWithSilent, server: FastifyInstance): void;
export function updateLogLevel(logLevel: string, server: FastifyInstance): void;
export function updateLogLevel(logLevel: LevelWithSilent | string, server: FastifyInstance): void {
  const level = logLevel.toLowerCase();
  if (isLevelWithSilent(level)) {
    logger.info('[logger] logLevel: %s', logLevel);
    logger.level = level;
    server.log.level = level;
  }
}

function isLevelWithSilent(logLevel: string): logLevel is LevelWithSilent {
  return logLevels.includes(logLevel as LevelWithSilent);
}
