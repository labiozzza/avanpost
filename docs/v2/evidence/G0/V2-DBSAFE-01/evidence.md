# V2-DBSAFE-01 evidence

- Unit command: `npm run test:peace:v2`
- Unit result: 18 tests passed in `apps/server-v2/test/database-identity.test.ts`; 20 total V2 unit tests passed.
- Type/build commands: root `npm run typecheck` passed for all workspaces; root `npm run build` passed for V1 and V2 workspaces.
- Source section: G0 database boundary (`PLAN.md` G0, `SECURITY.md`, and `TEST_MATRIX.md` V2-DBSAFE-01).
- Live command: `npm run doctor:peace:v2`
- Live result: `{"status":"ready","operation":"development-and-test","databases":["avanpost_v2_dev","avanpost_v2_test"],"hostMode":"local","freeDiskBytes":47506984960}`
- Migration command: `npm run db:peace:v2:migrate`; bootstrap migration `0001_v2_bootstrap.sql` applied once to `avanpost_v2_dev`; repeat returned ready with one applied migration and no reapplication.
- E2E startup additionally ran `npm run db:peace:v2:test:migrate` and served `V2-BASELINE-01` against `avanpost_v2_test`.
- Database target: dedicated Docker project `avanpost-peace-v2`, service `peace-v2-postgres`, host port 5434, volume `avanpost-peace-v2_peace_v2_pgdata`; no V1 compose/service/volume was used.
- Rejections covered before connection: `avanpost`, `avanpost_test`, using dev DB for test, remote host, unexpected/missing port, malformed escaped DB name, URL host override and compose host without explicit compose mode. Post-connect stubs cover wrong DB, public/unapproved server, wrong peer, identity-query failure, and IPv4-mapped loopback.
- Rejected wrong result: any V1 connection, unknown host or migration before identity verification. `no_claim`: no connection to a V1 DB was attempted; unit tests prove those names are rejected by the pre-connect allowlist.
- Fixture/seed/clock: no fixture or clock; isolated V2 dev/test PostgreSQL only. Hosts/targets were `127.0.0.1:5434/avanpost_v2_dev` and `127.0.0.1:5434/avanpost_v2_test`.
- Actual result: live doctor verified both V2 database names and socket boundary; bootstrap migration applied and replayed without reapplication. No V1 target was connected to.
- The V2 dev/test databases were checked by the live doctor. No connection attempt to V1 databases was made.
