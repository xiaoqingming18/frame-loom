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
import betterTailwindcss from 'eslint-plugin-better-tailwindcss';

const root = dirname(fileURLToPath(import.meta.url));
const renderer = './apps/desktop/src/renderer/src';
const features = `${renderer}/features`;
// 按现有 feature 目录生成同层隔离规则，新 feature 不需要手工登记。
const featureZones = existsSync(resolve(root, features))
  ? readdirSync(resolve(root, features), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        target: `${features}/${entry.name}`,
        from: features,
        except: [`./${entry.name}`],
      }))
  : [];

export default defineConfig(
  globalIgnores([
    '**/dist/**',
    '**/out/**',
    '**/release/**',
    '**/build/**',
    '**/coverage/**',
    '**/test-results/**',
    '**/playwright-report/**',
    '**/routeTree.gen.ts',
    '.agents/**',
    '.cache/**',
    '.husky/**',
    'docs/design/**',
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
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}', 'packages/ui/src/**/*.{ts,tsx}'],
    extends: [
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      query.configs['flat/recommended'],
    ],
    languageOptions: { globals: globals.browser },
    plugins: { 'better-tailwindcss': betterTailwindcss },
    settings: {
      'better-tailwindcss': {
        cwd: resolve(root, 'apps/desktop'),
        entryPoint: resolve(root, renderer, 'styles/globals.css'),
        tsconfig: resolve(root, 'apps/desktop/tsconfig.web.json'),
        detectComponentClasses: true,
      },
    },
    rules: {
      'better-tailwindcss/no-unknown-classes': 'error',
      'better-tailwindcss/no-conflicting-classes': 'error',
      'better-tailwindcss/no-deprecated-classes': 'error',
      'better-tailwindcss/no-duplicate-classes': 'error',
      'better-tailwindcss/no-restricted-classes': [
        'error',
        {
          restrict: [
            {
              pattern:
                '(?:^|:)!?(?:bg|text|border(?:-[trblxyse])?|divide(?:-[xy])?|outline|ring(?:-offset)?|shadow|inset-shadow|fill|stroke|from|via|to|decoration|placeholder|accent|caret)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white)(?:-\\d+)?(?:/[^ ]+)?!?$',
              message: '颜色必须使用主题语义 token，不能使用调色板。',
            },
            {
              pattern: String.raw`(?:^|:)!?(?:bg|text|border(?:-[trblxyse])?|divide(?:-[xy])?|outline|ring(?:-offset)?|shadow|inset-shadow|fill|stroke|from|via|to|decoration|placeholder|accent|caret)-(?:\[(?:color:|#|[a-zA-Z-]+\(|[a-zA-Z]+\])|\(--)|\[(?:color|background|background-color|border-color|fill|stroke):`,
              message: '颜色必须使用主题语义 token，不能使用任意值颜色。',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'JSXAttribute[name.name="style"] Property:matches([key.name=/^(color|background|backgroundColor|backgroundImage|border(Top|Right|Bottom|Left)?(Color)?|outline|outlineColor|boxShadow|textShadow|fill|stroke|caretColor|accentColor)$/], [key.value=/^(color|background|backgroundColor|backgroundImage|border(Top|Right|Bottom|Left)?(Color)?|outline|outlineColor|boxShadow|textShadow|fill|stroke|caretColor|accentColor)$/])',
          message: '颜色必须使用主题语义 token 类，不能写在内联样式中。',
        },
      ],
    },
  },
  {
    files: ['packages/ui/src/components/{button,toggle,tabs}.tsx'],
    // shadcn 的变体函数供其他基础组件复用，保持生成组件的导出契约。
    rules: {
      'react-refresh/only-export-components': [
        'error',
        {
          allowConstantExport: true,
          allowExportNames: ['buttonVariants', 'toggleVariants', 'tabsListVariants'],
        },
      ],
    },
  },
  {
    files: ['apps/desktop/src/renderer/src/routes/**/*.tsx'],
    // 文件路由导出的是路由配置，组件仍由 Router 插件处理热更新。
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  {
    files: ['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}'],
    plugins: { 'import-x': importX },
    settings: {
      'import-x/resolver': {
        typescript: {
          project: [
            'apps/desktop/tsconfig.node.json',
            'apps/desktop/tsconfig.web.json',
            'apps/engine/tsconfig.json',
            'packages/contracts/tsconfig.json',
            'packages/ui/tsconfig.json',
          ],
          // Node 与浏览器配置分别解析，保持 renderer 别名和跨层检查一致。
          noWarnOnMultipleProjects: true,
        },
      },
    },
    rules: {
      'import-x/no-restricted-paths': [
        'error',
        {
          basePath: root,
          zones: [
            {
              target: './apps/desktop/src/renderer',
              from: ['./apps/desktop/src/main', './apps/desktop/src/preload', './apps/engine'],
            },
            { target: './apps/engine', from: './apps/desktop' },
            {
              target: `${renderer}/lib`,
              from: [features, `${renderer}/routes`, `${renderer}/app`],
            },
            // 工作区包不能反向依赖应用；共享组件不能依赖画布。
            { target: './packages', from: './apps' },

            { target: features, from: [`${renderer}/routes`, `${renderer}/app`] },
            ...featureZones,
          ],
        },
      ],
    },
  },
  prettier,
);
