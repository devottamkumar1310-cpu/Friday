/**
 * @friday/db — schema, connection, and repositories.
 *
 * Repositories are the enforcement point for tenancy (NFR-3.3): every method
 * that touches learner-owned data takes an owning identifier, so there is no
 * method that *can* return another user's rows. The handful of unscoped
 * lookups are the authentication entry points, and each is named and documented
 * as such.
 *
 * Route handlers may not import this package — services do (SYSTEM_ARCHITECTURE
 * §6.1). That rule is lint-enforced.
 */

export * from './client';
export * from './ids';
export * from './schema';
export * from './repositories';
export * from './seed-data/jee-physics-foundations';
