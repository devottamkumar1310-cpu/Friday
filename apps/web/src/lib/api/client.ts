import { createClient } from '@friday/contracts';

/**
 * Browser API client, typed from the same endpoint registry that generates
 * openapi.v1.json — so a contract change surfaces as a type error rather than
 * as a runtime surprise.
 */
export const api = createClient({
  // Response validation stays on in development, where contract drift should be
  // loud, and off in production, where the schema check is redundant cost.
  validate: process.env.NODE_ENV !== 'production',
});
