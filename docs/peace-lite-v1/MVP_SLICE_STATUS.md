# Peace Lite V1 — MVP-SLICE status

**Overall:** IN_PROGRESS — M0 complete; M1 ledger/save integration underway.
**Fixed branch:** `setup/peace-v2-dev-environment`
**Audit baseline SHA:** `4353ae5c7ba22f89c0c9f2ea1a684467cb72fb13`
**M0 planning checkpoint:** `4c5d8628989dcb20abf852dd670f38d9fc154ad2`; no feature-gate PASS is carried forward automatically.
**Scope:** intermediate MVP-SLICE only; full Peace Lite V1 is not complete.

## Gate tracking

| Gate | Status | Evidence / next action |
|---|---|---|
| M0 — audit and instruction alignment | PASS | Instructions aligned; architecture/gap/dependency map, QA/art preflight, acceptance matrix and baseline recorded. `git diff --check` passed. This is a planning gate only, not gameplay acceptance. |
| M1 — physical seven-SKU ledger and save compatibility | IN_PROGRESS | Added version-1 `liteLedger` to snapshots, legacy-location migration, JSONB persistence, and divergence rejection. Replaced inferred net-delta accounting with explicit events and added reconciliation that checks per-location quantity deltas when an event identifies a location; wrong-location royal delivery and same-location transfer are rejected. Emitters now include physical location IDs for several wood/stone production, site/school consumption, and territory-unlock paths. Migration 0022/schema 16 and the PostgreSQL restart regression were verified on `avanpost_v2_mvp_slice_20261111` (see 2026-11-12 correction in the journal). Still incomplete: not all existing transfer/delivery paths carry location accounting, the ledger is not yet the sole mutation authority, and five SKUs lack production paths. M1 is not PASS. |
| M2 — vegetables and nutrition | NOT_STARTED | No active Lite production/consumption path found. |
| M3 — metal processing | NOT_STARTED | No active Lite mine/metalworks/fuel/output path found. |
| M4 — qualification and research | NOT_STARTED | Reuse training; implement server capability enforcement and canonical research effects. |
| M5 — royal orders | NOT_STARTED | No active V2 royal-order delivery/wallet path found. |
| M6 — UI, onboarding and balance | NOT_STARTED | Must be evaluated through fresh ordinary play, not fixtures. |
| M7 — independent acceptance | NOT_STARTED | QA mapping complete; all MVP criteria remain NOT_VERIFIED pending current-SHA browser/DB evidence. |

## Baseline verification (clean clone, before feature implementation)

Executed with Node `v22.23.4`, npm `10.9.9`; command output is stored outside Git in `%LOCALAPPDATA%\Temp\opencode\avanpost-mvp-slice-baseline\`.

| Command | Result |
|---|---|
| `npm ci` (exit 0) | PASS; 488 packages installed; audit reports 7 vulnerabilities (3 low, 4 moderate); no auto-fix. |
| `npm run typecheck` (exit 0) | PASS, all workspaces. |
| `npm run test:peace:v2` (exit 0) | PASS, 30 files / 274 passed / 1 skipped. The opt-in durable DB test stayed skipped; no DB was configured or mutated. |
| `npm run build:peace:v2` (exit 0) | PASS; existing client chunk-size advisory (>500 kB). |
| `npm run check:peace:v2:contracts` (exit 0) | PASS. |
| `npm run check:peace:v2:source-map` (exit 0) | PASS; structural map only, does not establish feature completion. |
| `npm run check:peace:v2:status` (exit 0) | PASS for its historical V2 status contract; it is not an MVP-SLICE status check. |
| `git diff --check` (exit 0) | PASS for the M0 instruction/documentation diff. |
| `npx vitest run --config vitest.peace-v2.config.ts apps/server-v2/test/database-identity.test.ts` (exit 0) | PASS, 25 tests; new MVP DB alias is accepted only for test identity and rejected for development/manual. |
| Initial `npm run doctor:peace:v2` (exit 1) | No `.env.v2`, so `DATABASE_URL` was required and no connection was made. A local ignored `.env.v2` was later configured with the new disposable test DB; see `MVP_SLICE_EXECUTION_JOURNAL.md`. |
| Existing Playwright E2E | Not run at initial baseline. After DB isolation, legacy G3.4 desktop and mobile flows now pass after fixing stale pairing/setup assumptions and on-canvas drag coordinates; exact commands and earlier failures are in `MVP_SLICE_EXECUTION_JOURNAL.md`. These legacy scenarios are not MVP acceptance. |

## Prior reviewed regression checks (2026-11-12)

These checks were completed before review iteration 2 at source commit `f43c14abddb9e50d9c0d1575c6312151faa68a9f` and final journal commit `54e5080dee35bc1adde47f30725875757cdfeec1`; they do not constitute MVP acceptance.

| Check | Result |
|---|---|
| `npm run typecheck` | PASS, all workspaces. |
| `npm run test:peace:v2` | PASS, 30 files / 278 passed / 1 skipped. |
| `npm run build:peace:v2` | PASS; existing >500 kB client chunk advisory. |
| contracts / source-map / historical status checks | PASS; source map is structural only and status remains historical V2. |
| desktop + mobile legacy G3.4 browser regressions | PASS on disposable test DB; not MVP acceptance. |

## M1 persisted-ledger groundwork (working tree, 2026-11-12)

This is an incremental implementation checkpoint, not M1 completion or MVP acceptance. Implementation commit: `7198d09e7221cbeb35c47b8c45659d545fd193ff`.

| Check / change | Result |
|---|---|
| `npm ci` | PASS, exit 0; 488 packages installed; audit reports 7 existing dependency advisories (3 low, 4 moderate); no auto-fix. |
| `npm run typecheck` | PASS, all workspaces, exit 0. |
| `npx vitest run --config vitest.peace-v2.config.ts packages/peace-v2-shared/test/lite-ledger.test.ts apps/server-v2/test/server-state.test.ts` | PASS, 31 passed / 1 skipped. Covers opening-balance conservation, legacy snapshot migration, persisted state after simulated API restart, and ledger/projection mismatch rejection. |
| `npm run test:peace:v2` | PASS, 30 files / 281 passed / 1 skipped, exit 0. |
| `npm run build:peace:v2` | PASS, exit 0; existing client chunk-size warning remains (~1.53 MB). |
| `npm run check:peace:v2:contracts`, `check:peace:v2:source-map`, `check:peace:v2:status` | PASS, each exit 0; these structural/historical checks do not establish MVP acceptance. |
| `AVANPOST_V2_DATABASE_OPERATION=test npm run doctor:peace:v2` | PASS, exit 0; identity-checked targets reported as `avanpost_v2_dev` and disposable `avanpost_v2_mvp_slice_20261111`. |
| `AVANPOST_V2_DATABASE_OPERATION=test npm run migrate -w @avanpost/server-v2` | PASS, exit 0; migration 0020 applied to `avanpost_v2_mvp_slice_20261111`; 20 migrations. No reset or mutation of V1/dev/manual/prior acceptance databases. |
| `AVANPOST_V2_DATABASE_OPERATION=test AVANPOST_V2_DURABLE_RESTART_TEST=true npx vitest run --config vitest.peace-v2.config.ts apps/server-v2/test/server-state.test.ts -t "verified PostgreSQL-backed API restart"` | PASS, exit 0; 1 passed, 21 skipped by focused filter. Connected through `connectVerifiedV2Database` to the disposable configured test target, asserted legacy snapshot ledger was written to PostgreSQL and survived API restart, then restored the original world/occupancy/session/command-log state in `finally`. |
| `git diff --check` | PASS, exit 0. |

### Review iteration 3 follow-up: hidden geology public projection

Implementation commit: `006a2451402339da25a5a7e2c825e98493c0f5cf` (`Hide`).

The internal/persisted ledger retains hidden underground deposit locations, while `GET /api/world` now filters coordinate-bearing ledger location IDs for unrevealed deposits. Added a route regression asserting hidden deposits are absent from every serialized public ledger field and remain present in persisted internal state. This closes the iteration-3 information leak only; it does not resolve the review's other blocking findings.

| Check | Result |
|---|---|
| `npm run typecheck` | PASS, all workspaces, exit 0. |
| `npm run test:peace:v2` | PASS, 30 files; 282 passed / 1 skipped, exit 0. An initial run exposed an outdated test assumption that public and persisted ledgers are identical; the test was updated to assert the security projection while preserving internal hidden locations, then the full suite passed. |
| `npm run build:peace:v2` | PASS, exit 0; existing ~1.53 MB client chunk warning. |
| `npm run check:peace:v2:contracts`, `check:peace:v2:source-map`, `check:peace:v2:status` | PASS, each exit 0. Historical/structural checks only; not MVP acceptance. |
| Focused public projection regression | PASS, 1 passed; verifies no hidden coordinate-bearing deposit location ID occurs in public response JSON while it remains persisted. |

### Review iteration 4 follow-up: shared schema-valid world projection

Implementation commit: `85554d6b705482a3112ab24e1362fa9cdbdefe12` (`Project`).

Iteration 5 supersedes this projection detail: the public world omits the internal ledger and the private geology seed entirely, rather than exposing opaque per-deposit quantities.

### Review iteration 5 follow-up: geology privacy and legacy migration

Implementation commit: `a7953d7e384cbe7a8f297537edfa5bb96d559415` (`Protect`).

The shared schema-valid public projection now omits `liteLedger` and `undergroundSeed` (both optional to the client schema), while continuing to filter hidden deposits and conceal geology. Newly provisioned worlds use a random persisted underground seed distinct from the public world ID/surface seed. Legacy worlds lacking this field receive a random persisted seed; concealed geology and unrevealed deposits are regenerated/relocated within the same sector while cell coordinates, tunnels, revealed geology, deposit quantities and buffers are preserved. The `/api/underground/route` endpoint and underground mining/planning commands now return identical `DEPOSIT_UNAVAILABLE` responses for absent and unrevealed deposits. Revealed route behavior remains available.

Regression coverage verifies: hidden/nonexistent route and command probes are indistinguishable; GET/command/replay snapshots remain parseable; internal ledger and geology seed stay persisted but never enter public response bodies; legacy concealed geology migration preserves cell geometry and explored areas; and a revealed deposit route still succeeds. Event-based accounting and the remainder of M1–M7 remain open.

### M1 event-accounting follow-up (implementation checkpoint)

Implementation/source/test/migration commit: `f59917e5c6340923e29c65c3169c22f4ef049fc7` (`Account Lite stock changes from explicit events`).

`reconcilePeaceLiteLedger()` now applies explicit production, consumption, royal-delivery and transfer events. It verifies aggregate stock deltas exactly match the submitted production/consumption/delivery events, preserves simultaneous production and consumption with zero net delta, ignores exact duplicate event IDs for idempotent replay, and rejects event-ID payload conflicts or unexplained stock changes. Event sequence is stored in world state; pending events are applied inside the same server transaction as the corresponding world snapshot and cleared before persistence. Current runtime emitters cover legacy wood harvesting, surface/underground stone mining, obstacle-clearing output, building material consumption, school training consumption, territory unlock costs, and several source/cargo/storage/build-site transfers. The `transferPeaceLiteItems()` ledger operation emits an explicit transfer event. This is partial instrumentation only: not all legacy transfer/delivery paths are covered, no royal-order runtime emits delivery events yet, and the ledger is not the sole mutation authority.

| Verification | Result |
|---|---|
| `npm run typecheck` | PASS, all workspaces, exit 0. |
| `npm run test:peace:v2` | PASS, 30 files; 288 passed, 1 skipped, exit 0. |
| Focused ledger/server/simulation tests | PASS, 3 files; 102 passed, 1 skipped, exit 0. |
| `npm run build:peace:v2` | PASS, exit 0; existing ~1.53 MB client chunk warning. |
| contracts/source-map/status checks | PASS, each exit 0; structural/historical checks only. |
| PostgreSQL migration/restart verification | Initially BLOCKED when Docker Desktop was stopped; superseded by the verified recovery evidence in the 2026-11-12 correction section of the execution journal. |
| `git diff --check` | PASS, exit 0. |

| Verification | Result |
|---|---|
| `npm run typecheck` | PASS, all workspaces, exit 0. |
| `npm run test:peace:v2` | PASS, 30 files; 285 passed, 1 skipped, exit 0. |
| `npm run build:peace:v2` | PASS, exit 0; existing ~1.53 MB client chunk warning. |
| contracts/source-map/status checks | PASS, each exit 0; structural/historical checks only. |
| `AVANPOST_V2_DATABASE_OPERATION=test npm run doctor:peace:v2` | PASS, exit 0; verified targets `avanpost_v2_dev` and disposable `avanpost_v2_mvp_slice_20261111`. |
| `AVANPOST_V2_DATABASE_OPERATION=test AVANPOST_V2_DURABLE_RESTART_TEST=true npx vitest run --config vitest.peace-v2.config.ts apps/server-v2/test/server-state.test.ts -t "verified PostgreSQL-backed API restart"` | PASS after migration 0021, 1 passed, 24 skipped by filter, exit 0; verified JSONB ledger/private geology seed survive API restart, remain absent from public GET/command/replay payloads, and original DB rows are restored in `finally`. |
| `git diff --check` | PASS, exit 0. |
| `AVANPOST_V2_DATABASE_OPERATION=test npm run migrate -w @avanpost/server-v2` after a fresh doctor | PASS, exit 0; migration 0021 advanced metadata to schema version 15 on disposable `avanpost_v2_mvp_slice_20261111`; 21 migrations total, no reset. |

## Capability / external conditions

- `review-cycle doctor`: GitHub authorized, Telegram verified, Playwright Chromium installed. Current task is fixed-branch/manual-merge. Iterations 1 and 2 were submitted through configured Windows Chrome CDP and both returned `NOT_READY`; iteration 2 confirms the two narrow regression fixes while M1/MVP remain open. Current reviewed remote SHA is `54e5080dee35bc1adde47f30725875757cdfeec1`; task remains active. No merge is authorized.
- Genuine image-generation/edit tool: NOT_AVAILABLE. Existing V2 runtime art can be reused; no image generation is claimed.
- Physical Android/iOS, production email provider and public deployment are not available locally. These are outside MVP-SLICE where specified and cannot be substituted with fabricated evidence.

## Current verified implementation facts

- Shared seven-SKU ledger/catalog schemas and unit tests exist. The version-1 snapshot ledger now persists and reconciles physical wood/stone locations at server tick/command commit boundaries; stale/mismatched ledger projections are rejected. Legacy simulation data is still the mutation source, so M1 is partial until commands/ticks mutate canonical ledger locations directly and all seven SKU locations are exercised by later gates.
- Existing sim supports wood/stone gathering, physical haul/storage/build, underground routes, population and historical schooling. Those are reuse points, not evidence for Lite vegetable/metal/research/order chains.
- No active Lite food, metal production, research effect, or royal order economy was found in the API/sim/UI at baseline.
- Historical Lite acceptance records (01/02/04/05) reference prior SHAs only. No historical result is promoted to current-SHA MVP PASS.
- CDP project access was verified at the user's request: page title `ChatGPT - GameDev`, target project route loaded, and no login/sign-up controls were present. Profile name was not visible in page text. No credentials were entered or exposed.

## Scope boundary

Do not mark full `LITE-E2E-06`, 08–24 as PASS because an MVP subset passes. Do not call this `Peace Lite V1 DONE`. The final slice may be called `MVP-SLICE READY FOR OWNER PLAYTEST` only after MVP-01…16 all pass on one SHA; owner acceptance is separate.
