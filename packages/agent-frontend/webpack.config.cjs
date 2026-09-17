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

'use strict';

const path = require('path');
const fs = require('fs');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

const srcDir = path.resolve(__dirname, 'src');
const publicDir = path.resolve(__dirname, 'public');
const distDir = path.resolve(__dirname, '../../dist');

module.exports = {
  entry: { client: path.join(srcDir, 'main.tsx') },

  output: {
    path: distDir,
    filename: 'assets/[name].[contenthash:8].js',
    chunkFilename: 'assets/[name].[contenthash:8].chunk.js',
    publicPath: '/',
    clean: true,
  },

  mode: 'development',
  devtool: 'eval-cheap-module-source-map',

  resolve: {
    extensions: ['.tsx', '.ts', '.js', '.jsx'],
    extensionAlias: {
      '.js': ['.tsx', '.ts', '.js'],
    },
    alias: {
      '@': srcDir,
    },
  },

  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: [
          {
            loader: 'ts-loader',
            options: {
              transpileOnly: true,
              compilerOptions: { module: 'CommonJS' },
            },
          },
        ],
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        exclude: /\.module\.css$/,
        use: [MiniCssExtractPlugin.loader, 'css-loader'],
      },
      {
        test: /\.module\.css$/,
        use: [
          MiniCssExtractPlugin.loader,
          {
            loader: 'css-loader',
            options: {
              modules: {
                auto: true,
                namedExport: false,
                localIdentName: '[path][name]__[local]',
              },
            },
          },
        ],
      },
      {
        test: /\.(png|jpg|gif|svg|ttf|woff|woff2|eot)$/,
        type: 'asset/resource',
        generator: { filename: 'assets/media/[name].[hash:8][ext]' },
      },
    ],
  },

  plugins: [
    new HtmlWebpackPlugin({
      template: path.join(__dirname, 'index.html'),
      filename: 'index.html',
      inject: true,
    }),
    ...(fs.existsSync(publicDir)
      ? [new CopyWebpackPlugin({ patterns: [{ from: publicDir, to: distDir }] })]
      : []),
    new MiniCssExtractPlugin({
      filename: 'assets/[name].[contenthash:8].css',
      chunkFilename: 'assets/[name].[contenthash:8].chunk.css',
    }),
  ],

  optimization: {
    splitChunks: {
      chunks: 'all',
      cacheGroups: {
        patternfly: {
          test: /[\\/]node_modules[\\/]@patternfly[\\/]/,
          name: 'patternfly',
          chunks: 'all',
          priority: 10,
        },
        vendor: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendors',
          chunks: 'all',
        },
      },
    },
  },

  devServer: {
    host: '0.0.0.0',
    port: 5173,
    hot: true,
    historyApiFallback: true,
    allowedHosts: 'all',
    proxy: [
      { context: ['/api', '/health'], target: 'http://localhost:3000' },
      { context: ['/ws'], target: 'ws://localhost:3000', ws: true },
    ],
  },
};
