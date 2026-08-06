import { z } from './zod';
import { DateTimeSchema, UuidSchema } from './primitives';

/**
 * Response envelopes — API_SPECIFICATION.md §3.2.
 *
 * AP3: never return a bare array. Wrapping collections from day one means
 * pagination and metadata can be added later without a breaking change.
 */

export const MetaSchema = z
  .object({
    requestId: UuidSchema,
    timestamp: DateTimeSchema,
    /** Set when AI ran at a reduced tier because a budget ceiling was hit (§6.4). */
    degraded: z.boolean().optional(),
  })
  .openapi('ResponseMeta');

export type ResponseMeta = z.infer<typeof MetaSchema>;

export const PaginationSchema = z
  .object({
    cursor: z.string().nullable().openapi({ description: 'Opaque. Do not parse.' }),
    hasMore: z.boolean(),
    limit: z.number().int().min(1).max(100),
  })
  .openapi('Pagination');

/** Wrap a single resource: `{ data, meta }`. */
export function envelope<T extends z.ZodTypeAny>(data: T) {
  return z.object({ data, meta: MetaSchema });
}

/** Wrap a collection: `{ data[], pagination, meta }`. */
export function collection<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    data: z.array(item),
    pagination: PaginationSchema,
    meta: MetaSchema,
  });
}

/** Cursor pagination query params (§3.3). Offset paging is never used. */
export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;
