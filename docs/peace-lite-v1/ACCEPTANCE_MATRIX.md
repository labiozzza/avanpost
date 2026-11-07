# Peace Lite V1 acceptance matrix

`NOT_VERIFIED` means no result has been established. A test is PASS only with the UI/API evidence and the SHA required by §15.2 of `TECHNICAL_SPEC.md`.

| ID | Required scenario | Status | Disposable DB / evidence | Verified SHA / failure |
|---|---|---|---|---|
| LITE-E2E-01 | Guest creates persistent account/world; reload restores it | NOT_VERIFIED | — | — |
| LITE-E2E-02 | Independent account gets isolated world; foreign read/write denied | NOT_VERIFIED | — | — |
| LITE-E2E-03 | Email magic-link restores the same world on another device | NOT_VERIFIED | — | — |
| LITE-E2E-04 | Two editors issue concurrent commands without duplicate spending | NOT_VERIFIED | — | — |
| LITE-E2E-05 | Revoking an editor blocks subsequent commands | NOT_VERIFIED | — | — |
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
