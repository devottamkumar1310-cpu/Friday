import type { Database } from '../client';

/**
 * Anything that can run a query — the pooled client or an open transaction.
 *
 * Repositories accept this rather than the concrete `Database` so a service can
 * compose several repository calls inside one transaction without the
 * repositories knowing or caring (SYSTEM_ARCHITECTURE §6.1).
 */
export type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];
