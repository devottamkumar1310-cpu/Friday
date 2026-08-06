import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import { baseConfig } from './base.mjs';

/**
 * ESLint config for React workspaces (packages/ui, apps/web).
 *
 * @param {string} packageName
 * @param {{ extraConfigs?: import('eslint').Linter.Config[] }} [options]
 */
export function reactConfig(packageName, options = {}) {
  return baseConfig(packageName, {
    extraConfigs: [
      {
        files: ['**/*.{ts,tsx}'],
        plugins: { 'react-hooks': reactHooks },
        languageOptions: {
          globals: { ...globals.browser, ...globals.node },
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
        rules: {
          ...reactHooks.configs.recommended.rules,
        },
      },
      ...(options.extraConfigs ?? []),
    ],
  });
}
