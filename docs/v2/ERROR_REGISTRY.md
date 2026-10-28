# Peace V2 error and recovery registry

Status: G0/G2.1 local slice codes implemented; broader gameplay and physical-device acceptance remain in progress.

| Code | Boundary | Safe meaning | Recovery | Test/evidence |
|---|---|---|---|---|
| `V2_DB_URL_REQUIRED` | config preflight | Required operation-specific V2 URL absent | Create/check `.env.v2`; never copy root `.env` | V2 config unit test |
| `V2_DB_URL_INVALID` | config preflight | URL cannot be parsed | Re-enter V2-only connection config without printing it | Unit test |
| `V2_DB_SCHEME_REJECTED` | config preflight | URL is not PostgreSQL | Use only a PostgreSQL URL for the dedicated V2 endpoint | Unit test |
| `V2_DB_URL_OPTIONS_REJECTED` | config preflight | Query/hash could override connection behavior | Remove URL options; use approved host/mode | Unit test |
| `V2_DB_NAME_REJECTED` | config preflight | URL DB name is not the exact allowed V2 DB | Use `avanpost_v2_dev` or `avanpost_v2_test` for the matching operation | V1-name and alias regression |
| `V2_DB_HOST_REJECTED` | config preflight | Host is outside the exact local/compose allowlist | Use loopback or the named V2 compose service | Unit test |
| `V2_DB_PORT_REJECTED` | config preflight | Port is outside the V2-only mapping | Use local 5434 or compose 5432 | Unit test |
| `V2_DB_URLS_NOT_DISTINCT` | config preflight | Development and test identities collapsed to one DB | Keep operation-specific dev/test database names separate | Config regression |
| `V2_DB_IDENTITY_QUERY_FAILED` | post-connect | Actual server identity could not be verified | Stop before migration/reset and inspect local V2 DB health | Query-failure regression |
| `V2_DB_IDENTITY_MISMATCH` | post-connect | Connected database differs from operation target | Stop; never migrate/reset this connection | Identity mismatch regression |
| `V2_DB_SERVER_ADDRESS_REJECTED` | post-connect | Server address/port is not the configured local V2 endpoint | Stop and inspect the V2 compose/port mapping | Address/port regression |
| `V2_DB_CLIENT_PEER_REJECTED` | post-connect | Actual socket peer is outside the V2 boundary | Stop; do not trust forwarded headers or retry elsewhere | Socket-peer regression |
| `V2_API_PORT_INVALID` | API config | V2 API port is not a valid TCP port | Choose a valid V2-only port; do not change the V1 port | Config regression |
| `V2_HANDOFF_PORT_INVALID` | API config | Loopback pairing handoff port is invalid or overlaps the API | Choose a separate V2-only local port | Config unit test |
| `V2_CLIENT_PORT_INVALID` | API/client config | Public/client Vite port is invalid or overlaps the API or handoff | Choose a distinct V2-only client port | Config unit test |
| `V2_LOOPBACK_CLIENT_PORT_INVALID` | API/client config | Additional localhost client port is invalid or overlaps another V2 port | Choose a separate loopback-only client port | Config unit test |
| `V2_LAN_BIND_BLOCKED` | API config | LAN binding is not explicitly enabled, private, or assigned to this host | Keep loopback mode or choose the computer's assigned private IPv4 with explicit opt-in | Config unit test |
| `V2_NODE_VERSION_UNSUPPORTED` | doctor | Node.js runtime is below the V2 project minimum | Use the repo's declared Node.js ≥22 runtime | Doctor unit test |
| `V2_PORT_IN_USE` | doctor | A required loopback API/client port is already owned | Leave the process untouched; identify it and choose the safe V2 recovery path | Doctor port-ownership test |
| `V2_DISK_SPACE_UNAVAILABLE` | doctor | Project storage is unavailable or reports no free blocks | Preserve the V2 volume; free/expand local project storage before retrying | Doctor storage test |
| `V2_DOCTOR_FAILED` | doctor | Safe health probe failed outside a known DB error | Use the printed stable code and rerun only after repair | Doctor integration |
| `V2_MIGRATION_NAME_INVALID` | migrator | Migration filename is not ordered/valid | Rename only an unapplied migration; never edit an applied file | Migration unit |
| `V2_MIGRATION_DRIFT` | migrator | Applied migration checksum changed | Preserve DB; restore migration file or design a new migration | Checksum mismatch test |
| `V2_MIGRATION_FAILED` | migrator | Migration SQL failed and its transaction rolled back | Preserve DB; inspect protected local trace and repair forward | Migration rollback integration |
| `V2_MIGRATION_BLOCKED` | migrator | Migration could not proceed safely | Use the stable code and preserve the V2 volume | Migration integration |
| `V2_API_START_BLOCKED` | launcher | Loopback API failed to start or PID ownership could not be claimed | Preserve other processes and inspect the safe blocker | Launcher integration |
| `V2_WORLD_NOT_INITIALIZED` | world API | The V2 world row is absent after guarded migrations | Stop play; rerun only the V2 migration path and inspect V2 DB identity | World API integration |
| `V2_WORLD_STATE_INVALID` | world API | Persisted world state fails its schema or decoding checks | Stop play and inspect the isolated V2 world state; server logs only the safe code and world ID | `apps/server-v2/test/server-state.test.ts` |
| `V2_SIMULATION_TICK_FAILED` | simulation loop | A server tick could not be committed | Preserve the database; inspect V2 process/database health and resume from the persisted tick timestamp | V2 tick integration test |
| `V2_UI_MISSING` | V2 client bootstrap | A required game interface element is missing | Stop client startup and inspect the V2 screen markup | Client build/E2E |
| `V2_CLIENT_START_FAILED` | launcher | Vite client process exited before HTTP readiness | Preserve the API/DB state and inspect client workspace build/output | Launcher integration |
| `V2_CLIENT_START_TIMEOUT` | launcher | Vite did not answer on its strict V2 bind address/port in time | Do not return a URL; inspect port ownership and V2 client output | Launcher timeout regression |
| `V2_API_PID_INVALID` | stop command | PID file is malformed or not signalable | Do not signal; verify only the V2-owned process | Stop safety unit |
| `V2_API_PID_OWNERSHIP_MISMATCH` | stop command | PID does not identify the V2 API launcher | Leave it running; do not kill by port | Stop ownership unit |
| `V2_API_STOP_TIMEOUT` | stop command | V2 launcher/client did not exit after graceful stop | Keep DB volume; inspect the named V2 process safely | Stop timeout regression |
| `V2_API_STOP_BLOCKED` | stop command | Stop safety check could not verify ownership | Do not signal a process; report the stable code | Stop safety unit |
| `V2_DB_UNAVAILABLE` | health route | Verified V2 database stopped responding after launch | Return 503 and safe retry/recovery; do not claim saved state is current | Health route regression |
| `ORIGIN_REJECTED` | API CORS/pairing | Browser Origin is not the configured V2 UI origin | Use the exact V2 client address; no read/mutation is processed | API Origin regression |
| `SESSION_REQUIRED` | private API route | Owner-scoped session is absent or expired | Pair the device; no private read/mutation occurs | Session/API security test |
| `INVALID_COMMAND` | mutation API | Command kind or strict payload is invalid | Refresh the world and select an available action | Shared-schema/API test |
| `CARGO_NOT_EMPTY` | worker actions | Worker carries a log reserved by an active delivery task | Wait for the server-owned route/unload to finish before another order or cabin placement | `apps/server-v2/test/server-state.test.ts` |
| `WORKER_BUSY` | task assignment | Worker already has a durable active task | Let the current server-owned route/work phase finish before assigning another | V2 command integration |
| `BUILD_ORDER_NOT_FOUND` | construction queue | Queue command references an order that is no longer present | Refresh the queue and select an existing order | Build-order API regression |
| `BUILD_ORDER_NOT_EDITABLE` | construction queue | Attempt to move or cancel an order after a builder has started it | Let the assigned builder finish; only waiting orders can be reordered/cancelled | Queue state transition test |
| `INVALID_COORDINATE` | placement API | Placement anchor is not a signed integer grid coordinate | Reposition the ghost on a grid cell and retry | V2 placement API test |
| `PAIR_INVALID` | pairing | Code is invalid | Show safe re-pair action without echoing submitted text | Pairing recovery E2E |
| `PAIR_EXPIRED` | pairing | Code expired or was consumed | Request a fresh code through the local handoff | Expiry/replay test |
| `PAIR_REUSED` | pairing | One-time code has already been consumed | Request a fresh code; no session or mutation is created | Atomic one-use test |
| `PAIR_RATE_LIMITED` | pairing | Pair attempts exceeded the configured window | Show cooldown without remaining-attempt count | Rate-limit integration |
| `OWNER_MISMATCH` | owner-scoped API | Session does not own the requested world | Do not disclose world data; no effect | Forged-owner security test |
| `WORLD_NOT_FOUND` | world API | Owner has no matching world/layout | Offer safe setup/retry; do not mutate a different world | Empty/missing-world E2E |
| `STALE_GEOMETRY` | spatial command | Geometry revision changed | Refresh snapshot and preview before retry | Concurrency/placement regression |
| `REQUEST_ID_PAYLOAD_CONFLICT` | idempotency | Existing request ID was reused with a different payload | Reconcile the original ID; do not apply a second effect | Payload-hash regression |
| `NO_ENTRANCE` | placement | Building footprint has no valid accessible entrance | Show the entrance/support reason; leave occupancy and stock unchanged | Placement regression |
| `RESOURCE_MISSING` | economy/haul | Required physical item is unavailable/reserved | Show actual source/buffer and wait or choose another source | Ledger integration |
| `NO_SPECIALIST` | craft/research | Required qualified worker is absent/unreachable | Pause progress and show the qualification/path reason | Simulation/API regression |
| `V2_BASELINE_UI_MISSING` | V2 client bootstrap | Required baseline UI status/button could not mount | Stop client startup and inspect the V2 shell; no world mutation occurred | Client type/build smoke |
| `V2_SECTOR_SIZE_INVALID` | pure simulation | Sector size is not a positive safe integer | Reject coordinate conversion before any world operation | Coordinate unit test |
| `V2_COORDINATE_INVALID` | pure simulation | Global/sector coordinate is fractional or unsafe | Reject input before geometry/world mutation | Signed-coordinate regression |
| `V2_LOCAL_COORDINATE_OUT_OF_RANGE` | pure simulation | Local coordinate does not belong to the declared sector | Recompute sector/local coordinates using floor-based conversion | Sector-boundary unit test |
| `STALE_WORLD` | mutation API | Client snapshot version is old | Fetch authoritative snapshot and decide whether to resubmit same intent | API concurrency test |
| `NO_PATH` | work/haul | No legal route to target | Show blocked route and allow path repair | Simulation + browser test |
| `OCCUPIED` | placement | One or more footprint cells are reserved | Keep preview visible; select a different location | Parallel placement test |
| `NO_SUPPORT` | placement | Footprint lacks valid support | Show exact support reason and keep materials unchanged | Placement regression |
| `STORAGE_FULL` | haul/storage | No compatible capacity remains | Keep cargo at actual location and wait for capacity | Ledger integration test |
| `CATALOG_INVALID` | catalog load | Versioned content failed schema, reference, or invariant validation | Keep the last accepted catalog/world unchanged; show safe file/entry path and stable issue code | Catalog validator regression |
| `ASSET_MANIFEST_INVALID` | asset manifest | Stage I asset metadata/path/pivot/checksum shape failed validation | Keep the last valid asset manifest/cache; show the safe row path and stable code | Asset-manifest schema regression |

Never expose database URLs, credentials, raw driver exceptions, pairing codes or internal validation details in user-facing errors.
