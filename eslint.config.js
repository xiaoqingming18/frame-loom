import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import importX from 'eslint-plugin-import-x';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import query from '@tanstack/eslint-plugin-query';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const root = dirname(fileURLToPath(import.meta.url));
const renderer = './apps/desktop/src/renderer/src';
const features = `${renderer}/features`;
// 按现有 feature 目录生成同层隔离规则，新 feature 不需要手工登记。
const featureZones = existsSync(resolve(root, features))
  ? readdirSync(resolve(root, features), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ target: `${features}/${entry.name}`, from: features, except: [`./${entry.name}`] }))
  : [];

export default defineConfig(
  globalIgnores([
    '**/dist/**', '**/out/**', '**/release/**', '**/build/**', '**/coverage/**',
    '**/test-results/**', '**/playwright-report/**', '**/routeTree.gen.ts',
    '.agents/**', '.cache/**', '.husky/**', 'docs/design/**',
  ]),
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: root },
    },
  },
  {
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite, query.configs['flat/recommended']],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['apps/desktop/src/renderer/src/main.tsx'],
    // 当前挂载入口没有导出，使用整页重载；普通组件文件仍检查 Fast Refresh 边界。
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  {
    files: ['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}'],
    plugins: { 'import-x': importX },
    settings: {
      'import-x/resolver': {
        typescript: {
          project: ['apps/desktop/tsconfig.json', 'apps/engine/tsconfig.json', 'packages/contracts/tsconfig.json'],
          // 三个 workspace 项目是刻意配置，后续 tsconfig 拆分时同步此列表。
          noWarnOnMultipleProjects: true,
        },
      },
    },
    rules: {
      'import-x/no-restricted-paths': ['error', {
        basePath: root,
        zones: [
          { target: './apps/desktop/src/renderer', from: ['./apps/desktop/src/main', './apps/desktop/src/preload', './apps/engine'] },
          { target: './apps/engine', from: './apps/desktop' },
          { target: [`${renderer}/lib`, `${renderer}/components`], from: [features, `${renderer}/routes`, `${renderer}/app`] },
          { target: features, from: [`${renderer}/routes`, `${renderer}/app`] },
          ...featureZones,
        ],
      }],
    },
  },
  prettier,
);
