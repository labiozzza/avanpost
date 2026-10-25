import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(path.join(projectRoot, relativePath), 'utf8');
const failures = [];
const api = read('docs/v2/API.md');
const registry = read('docs/v2/ERROR_REGISTRY.md');
const shared = read('packages/peace-v2-shared/src/index.ts');
const catalogSchemas = read('packages/peace-v2-shared/src/catalog.ts');

const apiErrorCodes = [
  'SESSION_REQUIRED', 'PAIR_INVALID', 'PAIR_EXPIRED', 'PAIR_REUSED', 'OWNER_MISMATCH',
  'WORLD_NOT_FOUND', 'STALE_WORLD', 'STALE_GEOMETRY', 'REQUEST_ID_PAYLOAD_CONFLICT',
  'NO_PATH', 'NO_SUPPORT', 'NO_ENTRANCE', 'OCCUPIED', 'RESOURCE_MISSING', 'CATALOG_INVALID',
  'STORAGE_FULL', 'NO_SPECIALIST', 'PAIR_RATE_LIMITED', 'CARGO_NOT_EMPTY', 'WORKER_BUSY',
  'INVALID_COORDINATE'
];
for (const code of apiErrorCodes) {
  if (!api.includes(`\`${code}\``)) failures.push(`API.md omits stable error code ${code}`);
  if (!registry.includes(`\`${code}\``)) failures.push(`ERROR_REGISTRY.md omits API error code ${code}`);
}

const runtimeSources = [
  'apps/server-v2/src/config.ts',
  'apps/server-v2/src/database/identity.ts',
  'apps/server-v2/src/server.ts',
  'apps/server-v2/src/cli/doctor.ts',
  'apps/server-v2/src/cli/doctor-checks.ts',
  'apps/server-v2/src/cli/migrate.ts',
  'apps/server-v2/src/cli/dev.ts',
  'apps/server-v2/src/cli/stop.ts',
  'packages/peace-v2-sim/src/coordinates.ts',
  'packages/peace-v2-sim/src/settlement.ts',
  'apps/client-v2/src/main.ts'
];
const runtimeCodes = new Set();
for (const source of runtimeSources) {
  for (const match of read(source).matchAll(/['"`]\s*(V2_[A-Z][A-Z0-9_]+)(?::|['"`])/g)) {
    if (!match[1].endsWith('_')) runtimeCodes.add(match[1]);
  }
}
for (const code of runtimeCodes) {
  if (!registry.includes(`\`${code}\``)) failures.push(`ERROR_REGISTRY.md omits implementation code ${code}`);
}

const apiSchemas = [
  'GlobalCoordinateSchema', 'CommandEnvelopeSchema', 'BuildIntentSchema', 'AssignWorkIntentSchema',
  'PairingRequestSchema', 'WorldRevisionSchema', 'ProblemDetailsSchema', 'ReadOnlyWorldPreviewSchema',
  'PeaceCommandSchema', 'PeaceWorkerTaskSchema', 'PeaceWorldSnapshotSchema'
];
for (const schema of apiSchemas) {
  const exportedInline = shared.includes(`export const ${schema}`);
  const exportedFromCatalog = catalogSchemas.includes(`export const ${schema}`) && shared.includes(schema);
  if (!exportedInline && !exportedFromCatalog) failures.push(`shared contracts omit ${schema}`);
  if (!api.includes(schema)) failures.push(`API.md does not name shared contract ${schema}`);
}
const contentSchemas = ['CatalogVersionSchema', 'PeaceCatalogSchema', 'AssetManifestEntrySchema', 'PeaceAssetManifestSchema'];
for (const schema of contentSchemas) {
  if (!catalogSchemas.includes(`export const ${schema}`) || !shared.includes(schema)) {
    failures.push(`shared catalog contracts omit ${schema}`);
  }
  if (!read('docs/v2/CONTENT.md').includes(schema)) failures.push(`CONTENT.md does not name ${schema}`);
}
if (!shared.includes('parsePeaceCatalog') || !read('docs/v2/CONTENT.md').includes('parsePeaceCatalog')) {
  failures.push('CONTENT.md does not name the shared parsePeaceCatalog boundary');
}
if (!shared.includes('parsePeaceAssetManifest') || !read('docs/v2/CONTENT.md').includes('parsePeaceAssetManifest')) {
  failures.push('CONTENT.md does not name the shared parsePeaceAssetManifest boundary');
}
if (!registry.includes('`ASSET_MANIFEST_INVALID`') || !read('docs/v2/CONTENT.md').includes('ASSET_MANIFEST_INVALID')) {
  failures.push('asset-manifest failure code is missing from the content/error contract');
}

const routeRows = api.split(/\r?\n/).filter((line) => /^\| (GET|POST|PUT|PATCH|DELETE) `?\/api\//.test(line));
for (const row of routeRows) {
  if (/\/api\/(pvp|market|trade|crystal|payment|combat)(\/|`)/i.test(row)) {
    failures.push(`Stage II route leaked into Stage I API contract: ${row}`);
  }
}
if (!api.includes('GET /api/world/preview') || !api.includes('read-only')) {
  failures.push('API contract must preserve the unpaired read-only preview boundary');
}

if (failures.length) {
  console.error(`CONTRACT_CHECK: FAIL failures=${failures.length}`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`CONTRACT_CHECK: PASS api_errors=${apiErrorCodes.length} runtime_codes=${runtimeCodes.size} api_schemas=${apiSchemas.length} content_schemas=${contentSchemas.length} stage_ii_routes=0`);
}
