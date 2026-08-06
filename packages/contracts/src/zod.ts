import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

/**
 * Zod, extended with `.openapi()` metadata support.
 *
 * `extendZodWithOpenApi` mutates the zod module, so it must run exactly once
 * before any schema is declared. Every schema file in this package imports `z`
 * from here rather than from 'zod' directly — that ordering guarantee is the
 * whole reason this module exists.
 */
extendZodWithOpenApi(z);

export { z };
