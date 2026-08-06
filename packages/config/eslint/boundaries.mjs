/**
 * Dependency-boundary enforcement for the FRIDAY monorepo.
 *
 * Encodes SYSTEM_ARCHITECTURE.md §9 as lint rules. These are not style
 * preferences — they are the mechanism that keeps `core` pure (ADR-003) and
 * keeps `ai` unable to fetch its own data (ADR-017). A violation must fail CI,
 * because the path of least resistance in a hurry is always to add the import.
 *
 *   apps/web       ──▶ contracts, ui, core, ai, db, observability
 *   packages/ai    ──▶ core, contracts, observability      (NOT db)
 *   packages/db    ──▶ core, contracts
 *   packages/core  ──▶ nothing
 *   packages/contracts ──▶ nothing but zod
 */

const ALL_PACKAGES = [
  '@friday/core',
  '@friday/contracts',
  '@friday/db',
  '@friday/ai',
  '@friday/ui',
  '@friday/observability',
];

/** Packages each workspace is permitted to import. Anything absent is forbidden. */
export const ALLOWED_DEPENDENCIES = {
  // The invariant that matters most. A pure function library over plain data.
  '@friday/core': [],

  // Schemas only. Zod is its sole runtime dependency.
  '@friday/contracts': [],

  // Leaf utility — logging and tracing must never depend on domain code.
  '@friday/observability': [],

  // Presentational. May not reach into domain, data, or model layers.
  '@friday/ui': [],

  // Repositories map rows to domain types, so it may read core and contracts.
  '@friday/db': ['@friday/core', '@friday/contracts'],

  // Agents receive context and executors; they never resolve data themselves.
  '@friday/ai': ['@friday/core', '@friday/contracts', '@friday/observability'],

  // The composition root. May import everything.
  '@friday/web': ALL_PACKAGES,
};

const REASON = {
  '@friday/core':
    'packages/core must stay pure — no I/O, no framework, no LLM (ADR-003). Accept the data as an argument instead.',
  '@friday/contracts':
    'packages/contracts defines schemas only. Its sole runtime dependency is zod.',
  '@friday/observability':
    'packages/observability is a leaf utility. Domain code depends on it, never the reverse.',
  '@friday/ui': 'packages/ui is presentational. Pass data in as props.',
  '@friday/db': 'packages/db may only depend on core and contracts.',
  '@friday/ai':
    'packages/ai may not import packages/db (ADR-017). Declare the tool schema here and let the service layer inject an executor — that keeps the context builder the single auditable entry point for everything a model sees.',
  '@friday/web': '',
};

/**
 * Build the `no-restricted-imports` config for one workspace.
 *
 * Uses the typescript-eslint variant so that `import type` is caught too: a
 * type-only import of a repository still couples the packages conceptually.
 *
 * @param {keyof typeof ALLOWED_DEPENDENCIES} packageName
 */
export function boundariesFor(packageName) {
  const allowed = ALLOWED_DEPENDENCIES[packageName];
  if (!allowed) {
    throw new Error(
      `No dependency boundary defined for "${packageName}". Add it to ALLOWED_DEPENDENCIES in packages/config/eslint/boundaries.mjs — a new workspace without a declared boundary is not permitted.`,
    );
  }

  const forbidden = ALL_PACKAGES.filter((pkg) => pkg !== packageName && !allowed.includes(pkg));
  if (forbidden.length === 0) return {};

  return {
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: forbidden.map((pkg) => ({
            group: [pkg, `${pkg}/*`],
            message: `${packageName} may not import ${pkg}. ${REASON[packageName]}`,
          })),
        },
      ],
    },
  };
}

/**
 * Route handlers are an HTTP boundary: parse, validate, authenticate, delegate,
 * serialize. Business logic and data access belong in the service layer
 * (SYSTEM_ARCHITECTURE §6.1), so a handler reaching for a repository is a
 * layering violation even though both live inside apps/web.
 */
export function routeHandlerBoundary() {
  return {
    files: ['src/app/api/**/*.ts', 'src/app/api/**/*.tsx'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@friday/db', '@friday/db/*'],
              message:
                'Route handlers may not access repositories directly (SYSTEM_ARCHITECTURE §6.1). Call a service in src/modules/* — it owns the transaction, the authorization check, and the event emission.',
            },
          ],
        },
      ],
    },
  };
}
