import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import i18next from 'eslint-plugin-i18next'
import prettier from 'eslint-config-prettier'

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

  // Layers without a browser: the main process, the preload bridge, the pure
  // core and the tests all run on Node.
  {
    files: [
      '*.config.ts',
      'src/main/**/*.ts',
      'src/preload/**/*.ts',
      'src/shared/**/*.ts',
      'src/core/**/*.ts',
      'test/**/*.ts'
    ],
    languageOptions: {
      globals: { ...globals.node }
    }
  },

  // The interface: React, browser globals, and the rule that forbids literal
  // text in components so every string goes through the i18n catalogs.
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
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
      'i18next/no-literal-string': 'error'
    }
  },

  prettier
)
