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

import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import noticePlugin from 'eslint-plugin-notice';
import prettierPlugin from 'eslint-plugin-prettier';
import globals from 'globals';

const COPYRIGHT_TEMPLATE = `/*
 * Copyright (c) 2026 Red Hat, Inc.
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Contributors:
 *   Red Hat, Inc. - initial API and implementation
 */`;

const COMMON_RULES = {
  'prettier/prettier': 'error',
  'no-tabs': 'error',
  'linebreak-style': ['error', 'unix'],
  semi: ['error', 'always'],
  'no-multiple-empty-lines': ['error', { max: 1, maxEOF: 1 }],
  'notice/notice': [
    'error',
    {
      template: COPYRIGHT_TEMPLATE,
      onNonMatchingHeader: 'report',
      messages: { reportAndSkip: 'Missing EPL-2.0 license header' },
    },
  ],
  'spaced-comment': 'error',
  '@typescript-eslint/no-explicit-any': 'warn',
  '@typescript-eslint/no-unused-vars': [
    'error',
    { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
  ],
  '@typescript-eslint/explicit-module-boundary-types': 'off',
  quotes: 'off',
};

/** @type {import('eslint').Linter.Config[]} */
export default [
  // Global ignores
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      'packages/*/node_modules/**',
      '*.cjs',
      'packages/**/*.cjs',
      'eslint.config.js',
      'output/**',
      'tmp/**',
    ],
  },

  js.configs.recommended,

  // TypeScript backend (Node.js environment — has fetch, URLSearchParams in Node 22)
  // Disable no-undef for TS files — TypeScript's own checker handles undefined variables better
  {
    files: [
      'packages/agent-backend/src/**/*.ts',
      'packages/agent-frontend/src/**/*.{ts,tsx}',
      'scripts/**/*.ts',
    ],
    rules: { 'no-undef': 'off' },
  },

  {
    files: ['packages/agent-backend/src/**/*.ts', 'scripts/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { sourceType: 'module', ecmaVersion: 2022 },
      globals: {
        ...globals.node,         // process, Buffer, __dirname, etc.
        ...globals.nodeBuiltin,  // fetch, URLSearchParams, URL (Node 18+)
        NodeJS: 'readonly',      // TypeScript namespace for Node types
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      notice: noticePlugin,
      prettier: prettierPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...COMMON_RULES,
    },
  },

  // Plain JS scripts (Node.js, ESM)
  {
    files: ['scripts/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      ecmaVersion: 2022,
      globals: {
        ...globals.node,
        ...globals.nodeBuiltin,
      },
    },
    plugins: {
      notice: noticePlugin,
      prettier: prettierPlugin,
    },
    rules: {
      ...COMMON_RULES,
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },

  // React UI (browser environment)
  {
    files: ['packages/agent-frontend/src/**/*.ts', 'packages/agent-frontend/src/**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { sourceType: 'module', ecmaVersion: 2022, ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,   // window, document, HTMLElement, fetch, URLSearchParams, etc.
        ...globals.es2022,    // Promise, Map, Set, etc.
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      notice: noticePlugin,
      prettier: prettierPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...COMMON_RULES,
    },
  },
];
