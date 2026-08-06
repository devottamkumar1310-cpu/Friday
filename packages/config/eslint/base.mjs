import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import { boundariesFor } from './boundaries.mjs';

const IGNORES = ['dist/**', '.next/**', 'coverage/**', 'node_modules/**', '**/*.config.*'];

/**
 * Base ESLint config for a FRIDAY workspace.
 *
 * @param {string} packageName  Workspace name, e.g. "@friday/core". Must have a
 *   declared dependency boundary — an unknown name is a hard error, so a new
 *   package cannot be added without consciously deciding what it may import.
 * @param {{ extraConfigs?: import('eslint').Linter.Config[] }} [options]
 */
export function baseConfig(packageName, options = {}) {
  const boundaries = boundariesFor(packageName);

  return tseslint.config(
    { ignores: IGNORES },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
      languageOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        globals: { ...globals.node, ...globals.es2022 },
      },
      rules: {
        // NFR-5.1: `any` requires an inline justification comment. Making this an
        // error forces an explicit eslint-disable, which is the justification.
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
        ],
        '@typescript-eslint/consistent-type-imports': [
          'error',
          { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
        ],
        eqeqeq: ['error', 'always', { null: 'ignore' }],
        'no-console': ['error', { allow: ['warn', 'error'] }],
      },
    },
    ...(Object.keys(boundaries).length > 0 ? [boundaries] : []),
    ...(options.extraConfigs ?? []),
    prettier,
  );
}
