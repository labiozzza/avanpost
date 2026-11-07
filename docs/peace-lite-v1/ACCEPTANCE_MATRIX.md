# Peace Lite V1 acceptance matrix

`NOT_VERIFIED` means no result has been established. A test is PASS only with the UI/API evidence and the SHA required by §15.2 of `TECHNICAL_SPEC.md`.

| ID | Required scenario | Status | Disposable DB / evidence | Verified SHA / failure |
|---|---|---|---|---|
| LITE-E2E-01 | Guest creates persistent account/world; reload restores it | PASS | `avanpost_v2_lite_test_20261107`; real Chromium client auto-login, reload, `/api/me` restores the same account/world; DB asserts 2 accounts, 2 worlds, 2 owner memberships, 2 hashed sessions and persisted world snapshots; both worlds retain `{wood:0,stone:0}`; screenshot + trace in `evidence/LITE-E2E-01/` | `b409889`; migration harness guard had a local-only uncommitted addition during this run |
| LITE-E2E-02 | Independent account gets isolated world; foreign read/write denied | PARTIAL | Same disposable DB; two real client tabs under separate cookie hosts returned distinct account/world IDs and matching world seeds. A forged foreign `worldId` read returned only caller's world. After revocation, a forged foreign-world command committed only to caller's private world; shared-world selection returned 403. Unauthenticated reads/writes returned 401. Not two separate browser profiles. Evidence: `evidence/LITE-E2E-01/` and `evidence/LITE-E2E-02/`. | `4677b54`; limited only by unavailable separate-profile run |
| LITE-E2E-03 | Email magic-link restores the same world on another device | PARTIAL | Real disposable PostgreSQL + Chromium: guest account linked to a normalized email through a one-time link, then a fresh link opened on the other cookie host (`localhost` vs `127.0.0.1`) restored the exact same account/world ID and world version. DB confirmed identity verified and auth link consumed; link replay redirects to invalid. Unknown and known addresses returned identical 202/body; sixth same-subject request returned 429 after five accepted requests. UI exposes account recovery; screenshot and reload trace in `evidence/LITE-E2E-03/`. Not a truly separate browser profile/device; production Resend credentials/delivery not configured. | Current checkpoint `L1 email recovery/UI`; separate-profile and production-mail limits remain |
| LITE-E2E-04 | Two editors issue concurrent commands without duplicate spending | PARTIAL | Real DB: owner invited an editor; invitee loaded the same world and performed a valid server command; owner observed the committed shared world revision. One-use invite replay returned 404; viewer write/invite attempts returned 403. Also exercised same-request replay and conflicting payload behavior. No two simultaneous valid writes or resource-ledger spending comparison; no invite management UI. Evidence: `evidence/LITE-E2E-02/` and `evidence/LITE-E2E-04/`. | `4677b54`; concurrency/ledger/UI gaps remain |
| LITE-E2E-05 | Revoking an editor blocks subsequent commands | PARTIAL | Owner observed the editor's final commit (world version 2), revoked membership in real DB, then invitee fell back to private world; shared-world listing omitted it and selection returned 403. A forged command carrying the revoked world's query ID affected only the invitee's private world, never the shared world. Evidence: `evidence/LITE-E2E-05/`. | `4677b54`; full UI action while command in flight remains |
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
