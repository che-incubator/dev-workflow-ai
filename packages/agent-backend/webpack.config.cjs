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

const path = require('path');
const webpack = require('webpack');

module.exports = {
  entry: {
    index: path.join(__dirname, 'src/index.ts'),
    'init-db': path.join(__dirname, 'src/init-db.ts'),
  },
  output: {
    // Use .cjs extension so Node.js treats this as CommonJS regardless of
    // the root package.json "type": "module" setting. The webpack bundle
    // uses require() internally and must not be loaded as an ES module.
    filename: path.join('server', '[name].cjs'),
    path: path.join(__dirname, 'lib'),
    clean: true,
    libraryTarget: 'commonjs2',
  },
  mode: 'development',
  devtool: 'eval-source-map',
  watchOptions: {
    ignored: /node_modules/,
    poll: 1000,
  },
  module: {
    rules: [
      {
        enforce: 'pre',
        test: /\.(ts|js)$/,
        use: ['source-map-loader'],
        include: [path.resolve(__dirname, 'src')],
      },
      {
        test: /\.ts$/,
        loader: 'ts-loader',
        options: {
          configFile: path.resolve(__dirname, 'tsconfig.webpack.json'),
          transpileOnly: true,
        },
      },
    ],
  },
  resolve: {
    extensions: ['.ts', '.js'],
    extensionAlias: {
      '.js': ['.ts', '.js'],
    },
    alias: {
      '@': path.resolve(__dirname, 'src/'),
    },
  },
  plugins: [
    new webpack.ProgressPlugin(),
  ],
  node: { __dirname: false },
  target: 'node',
  optimization: {
    concatenateModules: false,
  },
  // Externals — modules that must NOT be bundled:
  //   pg              — CJS/ESM interop issue when bundled (pg.Pool becomes undefined)
  //   pglite          — ships a WASM binary that webpack cannot bundle
  //   swagger-ui      — uses __dirname to locate its static assets (CSS/JS)
  externals: [
    'bufferutil', 'utf-8-validate', 'pg-native',
    { pg: 'commonjs pg' },
    { '@electric-sql/pglite': 'commonjs @electric-sql/pglite' },
    { '@fastify/swagger-ui': 'commonjs @fastify/swagger-ui' },
  ],
};
