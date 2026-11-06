import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import i18next from 'eslint-plugin-i18next'
import prettier from 'eslint-config-prettier'

// ---------------------------------------------------------------------------
// Layer boundaries. They mirror the import rules in the implementation plan:
//
//   1. core/diff, core/merge and core/text are pure: no Node, no browser.
//   2. core/git spawns child processes and is imported only by the main process.
//   3. the interface imports shared and the pure parts of core, never main.
//
// Each block below names the rule it enforces. `no-restricted-imports` replaces
// rather than merges, so a file must match a single block: the pattern lists are
// complete for their layer.
// ---------------------------------------------------------------------------

const TEST_FILES = ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}']

const NODE_BUILTINS = [
  'assert',
  'buffer',
  'child_process',
  'cluster',
  'crypto',
  'dgram',
  'dns',
  'events',
  'fs',
  'http',
  'http2',
  'https',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'querystring',
  'readline',
  'stream',
  'string_decoder',
  'timers',
  'tls',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'worker_threads',
  'zlib'
]

/** Import sources that mean "the Node runtime", in both `node:` and bare form. */
const NODE_MODULES = ['node:*', ...NODE_BUILTINS, ...NODE_BUILTINS.map((name) => `${name}/*`)]

const ELECTRON = ['electron', 'electron/*']

const NODE_GLOBALS = [
  'process',
  'Buffer',
  'require',
  'module',
  'exports',
  '__dirname',
  '__filename',
  'setImmediate',
  'clearImmediate'
]

const BROWSER_GLOBALS = [
  'window',
  'document',
  'navigator',
  'location',
  'localStorage',
  'sessionStorage',
  'fetch',
  'alert',
  'XMLHttpRequest',
  'WebSocket'
]

const GIT_LAYER = {
  group: ['**/core/git', '**/core/git/**'],
  message: 'core/git spawns child processes; only the main process may import it. Go through IPC.'
}

const restrict = (patterns) => ['error', { patterns }]

export default tseslint.config(
  {
    ignores: ['out/**', 'dist/**', 'release/**', 'coverage/**', 'node_modules/**']
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module'
    }
  },

  // Everything outside the interface runs on Node.
  {
    files: [
      '*.config.ts',
      'src/main/**/*.ts',
      'src/preload/**/*.ts',
      'src/shared/**/*.ts',
      'src/core/**/*.ts',
      'test/**/*.ts',
      'scripts/**/*.mjs'
    ],
    languageOptions: {
      globals: { ...globals.node }
    }
  },

  // Rule 1: the pure core cannot touch Node, the browser or the Electron layers.
  {
    files: ['src/core/diff/**/*.ts', 'src/core/merge/**/*.ts', 'src/core/text/**/*.ts'],
    ignores: TEST_FILES,
    rules: {
      'no-restricted-imports': restrict([
        {
          group: NODE_MODULES,
          message:
            'Pure core modules stay free of Node built-ins so they can run in the interface and in tests.'
        },
        { group: ELECTRON, message: 'Pure core modules must not depend on Electron.' },
        GIT_LAYER,
        {
          group: ['**/main/**', '**/renderer/**'],
          message: 'Pure core modules must not import the Electron layers.'
        }
      ]),
      'no-restricted-globals': ['error', ...NODE_GLOBALS, ...BROWSER_GLOBALS]
    }
  },

  // Rule 2, part one: core/git is independent of the Electron layers.
  {
    files: ['src/core/git/**/*.ts'],
    rules: {
      'no-restricted-imports': restrict([
        {
          group: ['**/main/**', '**/renderer/**'],
          message: 'core stays independent of the Electron layers.'
        },
        { group: ELECTRON, message: 'core/git runs Git as a child process, not through Electron.' }
      ])
    }
  },

  // shared holds IPC types and sits at the bottom of the graph.
  {
    files: ['src/shared/**/*.ts'],
    ignores: TEST_FILES,
    rules: {
      'no-restricted-imports': restrict([
        {
          group: ['**/main/**', '**/renderer/**', '**/core/**'],
          message: 'shared holds IPC types; nothing here may import the other layers.'
        },
        { group: ELECTRON, message: 'shared must stay runtime-agnostic.' },
        { group: NODE_MODULES, message: 'shared must stay runtime-agnostic.' }
      ])
    }
  },

  // Rule 2, part two: the preload bridge cannot reach core/git or the main process.
  {
    files: ['src/preload/**/*.ts'],
    ignores: ['src/preload/index.d.ts', ...TEST_FILES],
    rules: {
      'no-restricted-imports': restrict([
        { group: ['**/main/**'], message: 'The preload bridge must not import the main process.' },
        { group: ['**/renderer/**'], message: 'The preload bridge must not import the interface.' },
        GIT_LAYER
      ])
    }
  },

  // The main process must not import the interface.
  {
    files: ['src/main/**/*.ts'],
    ignores: TEST_FILES,
    rules: {
      'no-restricted-imports': restrict([
        { group: ['**/renderer/**'], message: 'The main process must not import the interface.' }
      ])
    }
  },

  // Rule 3: the interface imports shared and the pure core, never the main process.
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    ignores: TEST_FILES,
    languageOptions: {
      globals: { ...globals.browser }
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      i18next
    },
    settings: {
      react: { version: 'detect' }
    },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
      ...reactHooks.configs['recommended-latest'].rules,
      'react/prop-types': 'off',
      'i18next/no-literal-string': 'error',
      'no-restricted-imports': restrict([
        {
          group: ['**/main/**'],
          message: 'The interface talks to the main process over IPC, never by importing it.'
        },
        GIT_LAYER,
        { group: ELECTRON, message: 'The interface has no Node access; use the preload bridge.' },
        {
          group: NODE_MODULES,
          message: 'The interface has no Node access; use the preload bridge.'
        }
      ])
    }
  },

  prettier
)
