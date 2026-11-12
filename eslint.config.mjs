import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { builtinModules } from 'node:module';
import prettier from 'eslint-config-prettier';

const nodeImports = [...new Set(builtinModules.flatMap((name) => [name, `node:${name}`]))];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.nuxt/**',
      '**/.output/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['packages/core/src/**/*.ts', 'packages/inspector/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: nodeImports,
          patterns: ['node:*', '@devanalyst/*-plugin', '@devanalyst/{ai,analyzer,cache,cli}'],
        },
      ],
    },
  },
  // Prettier owns formatting; ESLint checks code correctness.
  prettier,
);
