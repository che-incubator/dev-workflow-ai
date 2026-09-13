/*
 * Copyright (c) 2026 Red Hat, Inc.
 * SPDX-License-Identifier: EPL-2.0
 */

import { db } from './client.js';

export async function getSetting(key: string, defaultValue: string): Promise<string> {
  const { rows } = await db.query<{ value: string }>('SELECT value FROM settings WHERE key = $1', [key]);
  return rows[0]?.value ?? defaultValue;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
    [key, value],
  );
}
