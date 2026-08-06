import { customType } from 'drizzle-orm/pg-core';

/**
 * Case-insensitive text. Used for email so uniqueness holds regardless of
 * casing, without a normalisation step that can be forgotten at one call site.
 * Requires the `citext` extension, installed by migration 0000.
 */
export const citext = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'citext';
  },
});
