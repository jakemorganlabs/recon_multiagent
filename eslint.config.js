// ESLint v9 flat config for Recon Multi-Agent.
// Lints the TypeScript sources, tests, scripts, and evals with the
// typescript-eslint recommended ruleset, tuned for this repo.

import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'fixtures/**',
      '_release/**',
      '*.html',
      '*.md',
      'package-lock.json',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts', 'scripts/**/*.ts', 'evals/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      // The codebase deliberately uses staged console output (src/log.ts) and
      // console.warn for cassette cache-miss diagnostics. Don't blanket-ban.
      'no-console': 'off',
      // Several intentional any casts exist at module/mock boundaries.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Empty interface/typed-actor patterns are legitimate here.
      '@typescript-eslint/no-empty-interface': 'off',
      // Allow unused args prefixed with _ (common in vitest hooks).
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // Resolver hooks are .mjs and use Node internals; lint lightly.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
    },
  }
);
