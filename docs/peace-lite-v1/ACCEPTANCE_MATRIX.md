# Peace Lite V1 acceptance matrix

`NOT_VERIFIED` means no result has been established. A test is PASS only with the UI/API evidence and the SHA required by §15.2 of `TECHNICAL_SPEC.md`.

| ID | Required scenario | Status | Disposable DB / evidence | Verified SHA / failure |
|---|---|---|---|---|
| LITE-E2E-01 | Guest creates persistent account/world; reload restores it | PASS | `avanpost_v2_lite_test_20261107`; real Chromium client auto-login, reload, `/api/me` restores the same account/world; DB asserts 2 accounts, 2 worlds, 2 owner memberships, 2 hashed sessions and persisted world snapshots; both worlds retain `{wood:0,stone:0}`; screenshot + trace in `evidence/LITE-E2E-01/` | `b409889`; migration harness guard had a local-only uncommitted addition during this run |
| LITE-E2E-02 | Independent account gets isolated world; foreign read/write denied | PASS | Two distinct named isolated Chromium contexts (`peace-lite-profile-a` and `peace-lite-profile-b`) auto-provisioned different guest account IDs and owner-world IDs; each `/api/worlds` listed only its own world. Forged foreign world query on `/api/world` returned only the caller's own snapshot; foreign member listing and world selection returned 403. Forged foreign-world command attempts returned 200 only for each caller's own world; DB confirms one ledger row in each owner's world and no cross-world mutation. Disposable PostgreSQL confirms each world has only its own owner membership. | `4677b54` backend; fresh isolated-context browser + DB evidence in `evidence/LITE-E2E-02/isolated-profile-boundary.md` |
| LITE-E2E-03 | Email magic-link restores the same world on another device | PARTIAL | Real disposable PostgreSQL + Chromium: guest account linked to a normalized email through a one-time link, then a fresh link opened on the other cookie host (`localhost` vs `127.0.0.1`) restored the exact same account/world ID and world version. DB confirmed identity verified and auth link consumed; link replay redirects to invalid. Unknown and known addresses returned identical 202/body; sixth same-subject request returned 429 after five accepted requests. UI exposes account recovery; screenshot and reload trace in `evidence/LITE-E2E-03/`. Not a truly separate browser profile/device; production Resend credentials/delivery not configured. | Current checkpoint `L1 email recovery/UI`; separate-profile and production-mail limits remain |
| LITE-E2E-04 | Two editors issue concurrent commands without duplicate spending | PASS | Real disposable DB + Chromium: two distinct editor accounts in separate cookie-host sessions concurrently submitted the same valid `build-cabin` payload/request ID. Both received HTTP 200 with identical committed revision and resource result (30 wood → 27); DB recorded exactly one command row and exactly one cabin at the target; the next tick generated one wood. Reload showed the single cabin completed and both sessions saw the same world. Evidence: `evidence/LITE-E2E-04/`. This proves duplicate concurrent delivery/replay, not racing distinct request IDs. | `4677b54` collaboration backend; `ce4f906` account UI; extended evidence in `L1 concurrency` checkpoint |
| LITE-E2E-05 | Revoking an editor blocks subsequent commands | PASS | Editor committed a valid shared-world change; owner observed the same committed version/role before revocation. After owner revoked access, `/api/me` and `/api/worlds` fell back to the editor's private world, shared-world selection returned 403, and a valid post-revocation command with a forged old-world ID was logged only under the private world (DB confirms no write under the revoked shared world). Reload restored private-world state. Evidence: `evidence/LITE-E2E-05/`. | `4677b54` collaboration backend; extended real DB/browser evidence in `L1 revocation` checkpoint |
| LITE-E2E-06 | Produce, carry, and store all seven physical items | NOT_VERIFIED | — | — |
| LITE-E2E-07 | Full warehouses recover after consumption without duplicate reservations | NOT_VERIFIED | — | — |
| LITE-E2E-08 | Food production, consumption, migration, hunger, and recovery | NOT_VERIFIED | — | — |
| LITE-E2E-09 | Metal production physically consumes wood and uses an ore source | NOT_VERIFIED | — | — |
| LITE-E2E-10 | Textile and reagent chains show stages without hidden item SKUs | NOT_VERIFIED | — | — |
| LITE-E2E-11 | All 16 buildings and visible-footprint placement validation | NOT_VERIFIED | — | — |
| LITE-E2E-12 | Four schools, all profession paths, and persistent training history | NOT_VERIFIED | — | — |
| LITE-E2E-13 | Unqualified specialty action rejected through UI and direct API | NOT_VERIFIED | — | — |
| LITE-E2E-14 | All 12 technologies produce effects and require an assigned researcher | NOT_VERIFIED | — | — |
| LITE-E2E-15 | Physical delivery gates school and academy work | NOT_VERIFIED | — | — |
| LITE-E2E-16 | Royal orders physically deliver goods and pay once under retries | NOT_VERIFIED | — | — |
| LITE-E2E-17 | Expansion, ladders, and underground stone/metal extraction | NOT_VERIFIED | — | — |
| LITE-E2E-18 | Reload/API restart preserve cargo, construction, study, and research | NOT_VERIFIED | — | — |
| LITE-E2E-19 | Same seed/commands yield matching one-hour online/offline ledger hashes | NOT_VERIFIED | — | — |
| LITE-E2E-20 | Installable PWA, offline read-only view, reconnect, SW update | NOT_VERIFIED | — | — |
| LITE-E2E-21 | Desktop, Android Chrome, and iOS Safari/PWA interactions | NOT_VERIFIED | — | — |
| LITE-E2E-22 | 20 isolated worlds and two editors without leakage or duplicate ticks | NOT_VERIFIED | — | — |
| LITE-E2E-23 | New world reaches T12 and completes orders for all seven goods without PvP | NOT_VERIFIED | — | — |
| LITE-E2E-24 | Missing worker, entrance, capacity, technology, or food blocks with recovery reason | NOT_VERIFIED | — | — |

## Evidence policy

For each scenario, record fixture/source snapshot, disposable database name, real browser actions, server assertions, ledger/resource assertions, screenshots, video or trace, result, and tested commit SHA. Physical-device checks must be separately identified and cannot be replaced by browser emulation.
