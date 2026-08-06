/**
 * Renders the endpoint registry to openapi.v1.json.
 *
 * The output is committed. CI re-runs this and fails if the working tree is
 * dirty, which is how the published spec is kept honest (API_SPECIFICATION §7.4).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOpenApiDocument } from '../src/openapi';

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, '../src/generated/openapi.v1.json');

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`, 'utf8');

// eslint-disable-next-line no-console -- this is a CLI script; stdout is its interface
console.log(`openapi.v1.json written to ${outPath}`);
