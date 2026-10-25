# V2 repository baseline

Status: G0 `PASS`. This is a static V1 source inspection plus isolated V2 runtime evidence; no V1 database, server, migration, or destructive test command was run during this G0 implementation.

| Surface | Current evidence | V2 disposition | Boundary |
|---|---|---|---|
| V1 server runtime | `apps/server/src/app.ts`, `index.ts`, `config.ts` | `ARCHIVE` as a running application; create `apps/server-v2` entry points | V1 config upward-loads root `.env` and defaults to `avanpost`; never import it into V2 |
| V1 database/migrations | `apps/server/src/db/`, `db/migrations/`, `docker-compose.yml` | `ARCHIVE`; establish independent V2 migrations, compose project, volume and database names | Existing compose maps V1 Postgres to 5433 and its volume is `pgdata`; V2 binds only 127.0.0.1:5434 and uses a separate named volume |
| V1 domain | `apps/server/src/domain/{commands,construction,craft,economy,logistics,population,region,research,run,simulate,snapshot,xp}.ts` | `REWRITE` for V2 world/persistence contracts; use only as read-only reference for candidate rules | No direct imports or copied geometry/persistence assumptions; prove any later adaptation with V2 tests first |
| V1 client | `apps/client/src/{game,phaser,simple,spike}` | `ARCHIVE` as a V1 UI; create an isolated V2 client and scene | V1 build/dev scripts and API proxy remain unchanged |
| Existing art | `apps/client/public/assets/avanpost/` | `ARCHIVE` pending license and side-view review | No asset is treated as licensed Kenney art or copied into V2 without provenance verification |
| V1 tests | `apps/server/test/`, `apps/client/test/`, root `vitest.config.ts`, `playwright.config.ts` | `ADAPT` testing lessons only; add dedicated V2 unit/E2E configs | Root `npm test` and Playwright currently include V1 paths; V2 tests use explicit V2 configs and names |
| Shared packages | `packages/shared`, `packages/sim` | `REUSE_UNCHANGED` only for third-party toolchain dependencies; create new V2 contract/simulation packages | No V1 domain package or module is imported by a V2 workspace |
| Root scripts/toolchain | `package.json`, root workspaces and installed Node/TypeScript/Phaser/Fastify/Postgres tooling | `ADAPT` root build/test commands while preserving V1 workspace scripts | `npm run build` includes all touched V2 workspaces; V2 DB commands name their compose file/project explicitly |
| New V2 workspaces | `apps/client-v2`, `apps/server-v2`, `packages/peace-v2-shared`, `packages/peace-v2-sim` | `REWRITE` as separate V2-owned packages/contracts | The G0 client is only an honest health-check shell; gameplay and side-view rendering remain G2 work |

## Data safety and backup

- Static V1 database hazard confirmed in `apps/server/src/config.ts`: V1 defaults to the `avanpost` database on localhost port 5433; existing V1 tests default to `avanpost_test` and truncate V1 tables.
- V2 code rejects either V1 database name before connection and checks connected identity before migration SQL.
- No V1 DB connection, backup, restore, migration, or data write was attempted in this G0 session. Existing evidence in `docs/reports/stage-1-backup-restore-20261023.md` documents a prior checksum-verified restore to `avanpost_restore_check_20261023_1400`, with row-count/MD5 parity across 22 tables and no source-DB writes, at commit `87b463a`. This evidence is reused, not independently repeated.
- G0 static tests cover both V1 database-name refusals without opening a V1 connection. The live doctor verified both isolated V2 database identities. V1 source/database remain untouched.
