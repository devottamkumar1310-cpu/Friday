/**
 * @friday/contracts — the API contract.
 *
 * AP2: these Zod schemas are the single source. They generate openapi.v1.json,
 * they type the client, and route handlers import them for runtime validation.
 * Because there is only one definition, the spec cannot drift from the code.
 */

export { z } from './zod';

export * from './primitives';
export * from './envelope';
export * from './errors';
export * from './schemas';
export * from './registry';
export * from './client';
export { buildOpenApiDocument } from './openapi';
