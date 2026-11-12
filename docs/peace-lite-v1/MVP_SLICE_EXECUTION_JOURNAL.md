# Peace Lite V1 MVP-SLICE — execution journal

This journal records actual M0/M1 setup and baseline results. It does not promote old V2/Lite results to MVP acceptance. Command logs are outside Git in `%LOCALAPPDATA%\Temp\opencode\avanpost-mvp-slice-baseline\`; credentials remain only in ignored `.env.v2`.

## M0 — 2026-11-11

- Fixed branch `setup/peace-v2-dev-environment`; pinned start SHA `4353ae5c7ba22f89c0c9f2ea1a684467cb72fb13`.
- M0 docs/instructions commit: `4c5d8628989dcb20abf852dd670f38d9fc154ad2`. No push or independent review has been run.
- `npm ci` — exit 0; 488 packages installed; audit reported 7 vulnerabilities (3 low, 4 moderate).
- `npm run typecheck` — exit 0.
- `npm run test:peace:v2` — exit 0; 30 files passed, 274 passed, 1 skipped.
- `npm run build:peace:v2` — exit 0; existing client bundle >500 kB advisory.
- `npm run check:peace:v2:contracts` — exit 0, PASS.
- `npm run check:peace:v2:source-map` — exit 0, structural check only.
- `npm run check:peace:v2:status` — exit 0, validates historical V2 status only.
- `npx vitest run --config vitest.peace-v2.config.ts apps/server-v2/test/database-identity.test.ts` — exit 0; 25 tests passed, including test-only acceptance of the new DB alias and rejection for dev/manual.
- `git diff --check` — exit 0 for the instruction/docs diff and later code/docs diff at the times checked.

## Isolated MVP DB — M1 prerequisite

Only `avanpost_v2_mvp_slice_20261111` was provisioned/migrated for MVP work. No V1, `avanpost_v2_dev`, `avanpost_v2_manual`, conventional `avanpost_v2_test`, or earlier acceptance database was reset or migrated. The local `.env.v2` is ignored by Git.

- Initial `npm run doctor:peace:v2` — exit 1, `V2_DB_URL_REQUIRED`; no connection because `.env.v2` did not exist.
- First configured `AVANPOST_V2_DATABASE_OPERATION=test npm run doctor:peace:v2` — exit 1 due to local password configuration not being loaded correctly; no migration/reset ran.
- After rewriting `.env.v2` without a UTF-8 BOM, the same doctor command — exit 1 because the new DB did not yet exist; the configured development DB identity check completed before that error.
- `docker exec --user postgres avanpost-peace-v2-peace-v2-postgres-1 createdb --username=<local-role> --maintenance-db=postgres --owner=<local-role> avanpost_v2_mvp_slice_20261111` — exit 0; created only the new empty database.
- Read-only identity/emptiness query returned `avanpost_v2_mvp_slice_20261111|0` (new DB name and zero user tables before migrations).
- `AVANPOST_V2_DATABASE_OPERATION=test npm run doctor:peace:v2` — exit 0; reported `operation=development-and-test`, databases `avanpost_v2_dev` and `avanpost_v2_mvp_slice_20261111`, host mode `local`. The dev target was identity-checked only; no writes were directed to it.
- `AVANPOST_V2_DATABASE_OPERATION=test npm run db:peace:v2:test:migrate` — exit 0; 19 migrations applied to the new MVP DB.
- `git check-ignore .env.v2` confirmed the credential file is ignored.

## M1 implementation checks — 2026-11-11

- `npm run typecheck` after adapter and E2E helper edits — exit 0, all workspaces.
- `npx vitest run --config vitest.peace-v2.config.ts packages/peace-v2-shared/test/lite-ledger.test.ts` — exit 0; 8 focused tests passed after integrating the adapter changes from the isolated Developer worktree.
- A concurrent `npm run test:peace:v2` — exit 0; 30 files, 275 passed, 1 skipped. Its ledger file reported 6 tests, so it ran before the later two adapter tests were present in the primary checkout; rerun the full suite after current changes before treating it as final.
- First post-pairing desktop G3.4 retry — exit 1; the first resident assignment passed, but the second worker-to-stone drag did not issue an assignment. The run followed a zoom anchored off-center; the scenario now recenters before that drag and is being retried. No criterion is accepted from this legacy scenario yet.
- The initial retry command with `--grep "^G3.4 ...$"` — exit 1, no tests found (Playwright title matching is not a full anchored regex here). The retry with `--grep=world-first` selected the intended desktop test.
- G3.4 recenter-only retry — exit 1. Instrumented canvas projection showed worker 2 at `(1598.76, 450.00)` on a `1440×900` canvas while the stone target was `(1081.56, 545.78)`; the resident was outside the right edge, so the drag was sent to blank canvas.
- Corrected desktop G3.4 retry — exit 0; 1 passed in 1.3m after the test recentered, zoomed out until both drag endpoints were on-canvas, and asserted the projections. This repairs the legacy browser scenario only; it is not MVP-01…16 acceptance.
- Post-change `npm run typecheck` — exit 0, all workspaces.
- Post-change `npm run test:peace:v2` — exit 0; 30 files, 277 passed, 1 skipped. The full suite includes all 8 focused ledger tests. It does not establish runtime ledger integration or MVP acceptance.
- Post-change `npm run build:peace:v2` — exit 0; existing client chunk advisory remains (>500 kB; built client JS 1,529.60 kB).
- `npm run check:peace:v2:contracts` — exit 0, PASS (`api_errors=21`, `runtime_codes=40`, `api_schemas=11`, `content_schemas=4`).
- `npm run check:peace:v2:source-map` — exit 0, PASS structural check (`requirements=37`, `scenarios=30`); not product completion evidence.
- `npm run check:peace:v2:status` — exit 0 for historical V2 status contract only; not MVP readiness.
- `git diff --check` — exit 0 after the current edits.

## Mobile G3.4 diagnosis — 2026-11-12

- First G3.4 mobile run — exit 1 at its 60-second test timeout. The 180-second retry also timed out; its stage marker ended at `phone-page-loaded`, pinpointing an unbounded browser fetch to the handoff endpoint.
- Replacing the browser fetch with a bounded request allowed the test to reach the catalog, where it exposed a fixture mismatch: the auto-provisioned Lite guest has zero stored wood, while the legacy regression expects the seeded `peace-home` world (40 wood).
- Mobile pairing now requests the handoff code with an explicit timeout and pairs through the UI. It passed fixture balance, touch placement, assignments, pinch/pan, reload and completed-building assertions: `AVANPOST_V2_DATABASE_OPERATION=test npx playwright test --config playwright.peace-v2.config.ts apps/client-v2/e2e/peaceful-slice.spec.ts --project=peace-v2-mobile --grep="G3.4 mobile"` — exit 0, 1 passed / 4 project skips. Legacy V2 pairing previously left a Lite guest cookie that shadowed the paired V2 session; `/api/session` now expires `peace_lite_session` atomically while setting `peace_v2_session`, covered by focused pairing-handoff tests (4 passed). During this legacy V2 test only, Lite-only account-management probes return expected 401s; the test permits those two exact API paths while other HTTP errors and console errors remain failures. This test-specific exception is not carried into MVP browser acceptance.

## Regression verification after session-pairing fix — 2026-11-12

These commands ran on the working tree based at `4c5d8628989dcb20abf852dd670f38d9fc154ad2`; the feature diff is uncommitted, so this is not a clean-commit or MVP acceptance SHA.

- `npm run typecheck` — exit 0, all workspaces.
- `npx vitest run --config vitest.peace-v2.config.ts apps/server-v2/test/pairing-handoff.test.ts` — exit 0; 4 passed, including expiry of the Lite guest cookie on successful V2 pairing.
- `AVANPOST_V2_DATABASE_OPERATION=test npx playwright test --config playwright.peace-v2.config.ts apps/client-v2/e2e/peaceful-slice.spec.ts --project=peace-v2-mobile --grep="G3.4 mobile"` — exit 0; 1 passed, 4 project skips, 58.4s. Test DB was only `avanpost_v2_mvp_slice_20261111`.
- `npm run test:peace:v2` — exit 0; 30 files passed, 277 passed, 1 skipped.
- `npm run build:peace:v2` — exit 0; existing client chunk-size advisory remains (>500 kB; JS 1,529.60 kB).
- `npm run check:peace:v2:contracts`, `npm run check:peace:v2:source-map`, `npm run check:peace:v2:status` — each exit 0. Contract and source-map checks pass; status check validates historical V2 status only.
- `git diff --check` — exit 0.

## M1 runtime boundary validation — 2026-11-12

- Integrated `normalizeLegacyPeaceWorldSnapshot` as a validation call after persisted snapshot parsing/compatibility repair and before serializing a snapshot to JSONB. This validates current wood/stone storage, source-buffer reservations, resident cargo and capacity constraints without treating aggregate `resources` as a second stock location.
- At the initial boundary-hook change, the adapter did not yet account for construction-site/school stock; the later “Legacy physical-location coverage” section records that mapping addition. Even with that addition, this does not store the resulting ledger, make it authoritative, govern simulation/command mutations, or implement the five new Lite SKUs. M1 remains `IN_PROGRESS`; this is a narrow validation boundary only.
- `npx vitest run --config vitest.peace-v2.config.ts apps/server-v2/test/server-state.test.ts` — exit 0; 20 passed, 1 skipped, including restart/persistence scenarios and rejection of duplicate physical location IDs at load.
- `npm run typecheck` — exit 0, all workspaces.
- Post-boundary `npm run test:peace:v2` before the new duplicate-location case — exit 0; 30 files, 277 passed, 1 skipped.
- After adding the duplicate-location load test, `npm run test:peace:v2` — exit 0; 30 files, 278 passed, 1 skipped. `npm run typecheck` — exit 0, all workspaces.
- Post-boundary `npm run build:peace:v2` — exit 0; existing >500 kB client chunk advisory remains.
- Post-boundary contracts, source-map, and historical status checks — each exit 0; same limitations described above.
- `git diff --check` after current docs/code changes — exit 0.

## Legacy physical-location coverage — 2026-11-12

- Extended the compatibility adapter to represent existing construction-site `reservedWood`/`reservedStone` and school `trainingMaterialsWood` as physical ledger locations, in addition to warehouse contents/reservations, source buffers and resident cargo. Aggregate `resources` remains deliberately excluded to avoid counting the storage projection twice.
- Added a focused adapter test with simultaneous site and school stock; expected totals include all represented locations.
- `npx vitest run --config vitest.peace-v2.config.ts packages/peace-v2-shared/test/lite-ledger.test.ts apps/server-v2/test/server-state.test.ts` — exit 0; 28 passed, 1 skipped.
- `npm run typecheck` — exit 0, all workspaces.
- This improves boundary validation but still does not produce a persisted or canonical ledger and does not validate tick-level transfers/conservation; M1 stays IN_PROGRESS.
- Final regression run after this change: `npm run test:peace:v2` — exit 0; 30 files, 278 passed, 1 skipped; `npm run build:peace:v2` — exit 0 with the existing >500 kB client chunk advisory; contract, source-map, and historical status checks — each exit 0. Typecheck passed above. These are regression results, not MVP acceptance.

## Review-cycle preflight rerun — 2026-11-12

- `AVANPOST_V2_DATABASE_OPERATION=test npm run doctor:peace:v2` — exit 0; doctor identified only the configured local `avanpost_v2_dev` and disposable `avanpost_v2_mvp_slice_20261111` databases. E2E reset helper uses `connectVerifiedV2Database(config, 'test')`; no other database is reset.
- Current-tree desktop `world-first` browser rerun first failed because the test hard-coded `tree-1` after reload, while the server legitimately retargeted the woodcutter to another existing tree. Relaxed the assertion to require the same role/task and a valid current tree ID, not a stale source ID.
- Repeated `AVANPOST_V2_DATABASE_OPERATION=test npx playwright test --config playwright.peace-v2.config.ts apps/client-v2/e2e/peaceful-slice.spec.ts --project=peace-v2-desktop --grep=world-first` — exit 0; 1 passed in 1.4m.
- Repeated mobile `... --project=peace-v2-mobile --grep="G3.4 mobile"` — exit 0; 1 passed, 4 project skips, 1.0m.
- Final current-tree `npm run typecheck` — exit 0, all workspaces; `npm run test:peace:v2` — exit 0, 30 files / 278 passed / 1 skipped; `npm run build:peace:v2` — exit 0, existing >500 kB JS chunk advisory; contract/source-map/historical status checks — all exit 0. This regression run does not pass MVP acceptance criteria.

## Browser/runtime check — not MVP acceptance

- `AVANPOST_V2_DATABASE_OPERATION=test npx playwright test --config playwright.peace-v2.config.ts apps/client-v2/e2e/peaceful-slice.spec.ts --grep "persistent work roles and ordered cabin queue survive reload and API restart"` — exit 0, but both selected project cases are explicitly skipped in source as superseded. No behavioral PASS.
- `AVANPOST_V2_DATABASE_OPERATION=test npx playwright test --config playwright.peace-v2.config.ts apps/client-v2/e2e/peaceful-slice.spec.ts --grep "G3.4 desktop: world-first resident assignment and safe camera gestures"` — exit 1; title matching selected 10 cases. Five failed and five were skipped. Four desktop cases timed out because stale helper `pairCurrentPage` waits for removed button `Показать код на этом компьютере`; the mobile case timed out at 60 seconds. These are legacy browser-suite failures, not MVP-01…16 results. Error contexts are under ignored `test-results/`.
- The E2E config's DB/migrate/reset steps resolved `TEST_DATABASE_URL` from ignored `.env.v2`, which targets only `avanpost_v2_mvp_slice_20261111`.

## ChatGPT access check

- In-app browser: page loads but is unauthenticated (`Войти` visible); this is not the review browser context.
- Global review-cycle CDP connection to `http://127.0.0.1:9222` — successful; connected Chrome 156 context already had the target `ChatGPT - GameDev` project open, project route loaded, and no login/sign-up controls. Profile name was not visible in current page text.
- `review-cycle status` — task `avanpost-mvp-vertical-slice` is `ACTIVE`, `iterations: []`. No review request has been sent; do not duplicate any previously transmitted request.

## External review recovery and follow-up — 2026-11-12

- The earlier in-app browser check was the wrong browser context. Following the user's correction, the global review-cycle was invoked through `~/.config/opencode/skills/review-cycle/scripts/review-cycle-wsl.sh`; `set-cdp --url http://127.0.0.1:9222` configured the dedicated Windows Chrome endpoint. No separate Playwright profile or HTTP request was used to validate ChatGPT access.
- Read-only Playwright CDP connection to Windows Chrome succeeded (`PAGES=2`); opened the configured project (`ChatGPT - GameDev`, no auth redirect/login controls), then navigated the existing saved review chat and captured the already-returned full response. No prompt was entered and no request resent. The full 17,638-byte response passed `parseVerdict` for SHA `5be67e93a996005da32fe0fb84b5ae0219363c12`, file evidence and report format; verdict `НЕ_ГОТОВО`. Review artifacts and state record iteration 1 as `NOT_READY`; task stays active. Reviewer independently confirms that the vertical slice is not complete.
- Follow-up defect fixes: legacy ledger adapter now includes each `undergroundDeposits[].bufferQuantity` and `reservedBuffer` as a distinct physical stone-buffer location; unit test verifies five units and two reserved. `pairCurrentPage()` now opens the hidden pairing panel and requires a real `peace-home` V2 session (V2 cookie, no Lite cookie, V2 session status); it no longer accepts an arbitrary `/api/me` guest session. Client pairing summary now distinguishes V2 pairing from Lite guest provisioning.
- `npm run doctor:peace:v2` with `AVANPOST_V2_DATABASE_OPERATION=test` — exit 0; verified configured dev/test DB identities; subsequent browser resets targeted only `avanpost_v2_mvp_slice_20261111`.
- Browser test discovery: the old fallback initially failed with `/api/me 401`; after making pairing explicit, pairing succeeded but a relative test request queried the wrong API origin. The helper now queries the origin that actually received the pairing POST and verifies the V2 cookie/session. First desktop G3.4 rerun then exposed expected 401 responses from Lite-only account endpoints after the Lite cookie is intentionally expired; the test now allowlists only `/api/me` and world-member 401s and rejects other API errors.
- Final `localhost client keeps its paired session` desktop Playwright run — exit 0, 1 passed (10.7s). Final desktop G3.4 `world-first` run — exit 0, 1 passed (55.1s / 1.4m overall). Final mobile G3.4 run — exit 0, 1 passed and 4 project skips (33.3s / 1.0m overall). These are legacy regressions, not MVP journey acceptance.
- `npm run typecheck` — exit 0, all workspaces; `npm run test:peace:v2` — exit 0, 30 files / 278 passed / 1 skipped; `npm run build:peace:v2` — exit 0 with the existing >500 kB Vite chunk advisory; contracts/source-map/status checks — exit 0; `git diff --check` — exit 0.
- Scope remains partial: the adapter is still compatibility validation, not a persisted/canonical ledger integrated into tick/command simulation; M1 remains `IN_PROGRESS`, M2–M7 and MVP-01…16 remain `NOT_VERIFIED`. Reviewer P0/P1 findings are not represented as resolved by these targeted changes.

- Source/test commit after the passing checks above: `f43c14abddb9e50d9c0d1575c6312151faa68a9f` (Cover underground stock and verify explicit V2 pairing). Follow-up journal-only commit: `54e5080dee35bc1adde47f30725875757cdfeec1`. The source SHA is the exact parent of the journal-only commit, verified locally and independently against GitHub during review iteration 2.

## M1 ledger persistence groundwork — 2026-11-12

- Added version-1 `liteLedger` to `PeaceWorldSnapshotSchema`; existing snapshots remain compatible because the field is optional at parse time. The server derives an opening ledger from actual legacy physical locations on first load, stores it in JSONB on the next transaction (including zero-tick reads), and thereafter rejects any saved ledger that disagrees with legacy location quantities/reservations.
- Server tick/command commit boundaries reconcile physical location deltas against the prior persisted ledger, preserving `initial` and accumulating committed production/consumption. This is an incremental boundary bridge, not yet a single writable inventory: wood/stone legacy fields still drive simulation mutations; vegetables/meat/metal/cloth/reagents remain zero until later gates integrate their runtime paths. M1 remains `IN_PROGRESS`.
- Added SQL migration `0020_lite_physical_ledger.sql` to advance per-world schema metadata to 14 without rewriting world JSON. Lazy conversion occurs only in the transactionally locked server path, so cargo, source buffers, warehouse reservations, construction stock and training stock are mapped from each actual world.
- `npm ci` — exit 0; 488 packages installed; 7 advisories reported (3 low, 4 moderate); no automatic fixes.
- `npm run typecheck` — exit 0, all workspaces.
- Targeted Vitest — `npx vitest run --config vitest.peace-v2.config.ts packages/peace-v2-shared/test/lite-ledger.test.ts apps/server-v2/test/server-state.test.ts` — exit 0; 31 passed, 1 skipped.
- `npm run test:peace:v2` — exit 0; 30 files, 281 passed, 1 skipped.
- `npm run build:peace:v2` — exit 0; existing ~1.53 MB Vite client chunk warning.
- `npm run check:peace:v2:contracts`, `npm run check:peace:v2:source-map`, `npm run check:peace:v2:status` — each exit 0; none of these structural/historical checks establishes MVP acceptance.
- Before database migration, `AVANPOST_V2_DATABASE_OPERATION=test npm run doctor:peace:v2` — exit 0; `connectVerifiedV2Database` identity-checked both configured targets and reported `avanpost_v2_dev` plus `avanpost_v2_mvp_slice_20261111`. Then `AVANPOST_V2_DATABASE_OPERATION=test npm run migrate -w @avanpost/server-v2` — exit 0; 20 migrations applied/verified on disposable `avanpost_v2_mvp_slice_20261111`. No reset was run; V1, dev/manual and historical acceptance databases were not modified.
- Re-ran the doctor immediately before the real-PostgreSQL check — exit 0, same verified targets. `AVANPOST_V2_DATABASE_OPERATION=test AVANPOST_V2_DURABLE_RESTART_TEST=true npx vitest run --config vitest.peace-v2.config.ts apps/server-v2/test/server-state.test.ts -t "verified PostgreSQL-backed API restart"` — exit 0; 1 passed, 21 skipped by filter. The test uses `connectVerifiedV2Database`, verifies the persisted JSONB ledger after a legacy save is read, restarts the API, confirms the ledger survives and idempotent replay still returns it, then restores the original world row, occupancy rows, command log and temporary session in `finally`.
- `git diff --check` — exit 0. M1 implementation/source-test commit: `7198d09e7221cbeb35c47b8c45659d545fd193ff` (`Persist Lite ledger at world save boundaries`). The passing checks above apply to this source SHA; this journal/status-only follow-up records the exact SHA.

## Review iteration 3 follow-up: hidden geology response leak — 2026-11-12

- Review iteration 3 identified that the full internal `liteLedger` was spread into the public `/api/world` response, exposing IDs like `underground-deposit:udeposit-X-Y` for unrevealed deposits.
- The public route now projects the ledger without unrevealed underground deposit locations. The authoritative in-memory and persisted ledger is unchanged; revealed deposit locations remain public.
- Added server route regression coverage using a hidden deposit with nonzero buffer: its coordinate-bearing ledger ID is absent from the entire public JSON response, while the same location is still present in the persisted internal state.
- `npm run typecheck` — exit 0, all workspaces.
- Focused test `npx vitest run --config vitest.peace-v2.config.ts apps/server-v2/test/server-state.test.ts -t "undiscovered underground deposits"` — exit 0; 1 passed, 22 skipped by focus filter.
- `npm run test:peace:v2` — exit 0; 30 files, 282 passed, 1 skipped. First full run caught a stale assertion equating the public projection with full persisted ledger; revised it to assert both hidden-ID omission and persisted hidden-location retention, then reran the suite successfully.
- `npm run build:peace:v2` — exit 0; existing client bundle-size warning (~1.53 MB).
- `npm run check:peace:v2:contracts`, `npm run check:peace:v2:source-map`, `npm run check:peace:v2:status` — each exit 0; these structural/historical checks are not MVP acceptance.
- `git diff --check` — exit 0. Source/test commit: `006a2451402339da25a5a7e2c825e98493c0f5cf` (`Hide`). The listed checks apply to this source SHA; documentation-only follow-up records this evidence and SHA.

## Review iteration 4 follow-up: shared public projection — 2026-11-12

- Iteration 4 confirmed the `/api/world` leak fix but found command/replay responses still returned internal snapshots and that deleting hidden ledger rows invalidated conservation/client schema parsing for nonzero hidden buffers.
- Added shared `toPublicWorldSnapshot()`: unrevealed deposit location IDs are mapped deterministically to opaque `underground-deposit:hidden-N` values while location quantities/accounting remain intact; hidden deposits are omitted and concealed geology remains masked. This retains `PeaceWorldSnapshotSchema` validity and does not alter the full persisted internal snapshot.
- Applied the projection to GET `/api/world`, successful POST `/api/commands`, and saved idempotent replay. Command logs keep full internal responses in PostgreSQL; every response is projected at the transport boundary.
- Expanded regression test: parses GET/first command/replay payloads with `PeaceWorldSnapshotSchema.parse()`, checks hidden IDs are not serialized on any of the three paths, verifies replay equals first public command result, and confirms hidden nonzero ledger locations remain persisted.
- `npm run typecheck` — exit 0, all workspaces.
- Focused regression `npx vitest run --config vitest.peace-v2.config.ts apps/server-v2/test/server-state.test.ts -t "undiscovered underground deposits"` — exit 0; 1 passed, 22 skipped.
- `npm run test:peace:v2` — exit 0; 30 files, 282 passed, 1 skipped.
- `npm run build:peace:v2` — exit 0; existing ~1.53 MB client bundle warning. `npm run check:peace:v2:contracts`, `npm run check:peace:v2:source-map`, `npm run check:peace:v2:status` — each exit 0; structural/historical checks only.
- `git diff --check` — exit 0. Implementation/source-test commit: `85554d6b705482a3112ab24e1362fa9cdbdefe12` (`Project`). The listed checks apply to this source SHA; the next commit only records exact evidence. Event accounting, authoritative seven-SKU writes, and M2–M7 remain incomplete.

## Review iteration 5 follow-up: geology side channels — 2026-11-12

- Implementation/source-test/migration commit: `a7953d7e384cbe7a8f297537edfa5bb96d559415` (`Protect`). The typecheck, full Peace V2 test suite, production build, structural checks, and PostgreSQL restart/migration verification documented below apply to this source commit.

- Iteration 5 accepted the shared GET/command/replay projection and its schema/conservation behavior, but identified geology probing through route error codes, public generator seed, and per-deposit opaque ledger rows.
- Public snapshots now omit both the internal Lite ledger and private `undergroundSeed`; the client schema allows these optional internal fields to be absent. New guest worlds receive a random 256-bit underground seed distinct from the public world ID. `ensureUndergroundWorld()` uses that private value for cell/deposit generation.
- Legacy saves without the private seed get a random persisted seed. On first conversion, only unrevealed/untunnelled geology is regenerated and unrevealed deposits relocate within their existing sector; cell coordinate grid, tunnel/revealed geology, deposit quantities, buffers and reservations remain. Legacy deposit-ID references in the ledger/jobs/plans are updated before validation/persistence.
- GET `/api/underground/route/:depositId`, `mine-underground`, and `plan-underground-route` normalize both absent and unrevealed deposit cases to the same `DEPOSIT_UNAVAILABLE` status/body. A revealed-source route regression confirms normal behavior is retained.
- Tests cover hidden-vs-missing route and command probes, public response schema parse for GET/command/idempotent replay, omission of private seed/internal ledger from all public bodies, hidden ledger persistence, old-save geology conversion/restart persistence, and preservation of map coordinates plus explored geology.
- Event-based accounting, canonical seven-SKU runtime storage, and M2–M7 remain open; no MVP readiness claim.
- Verification on the working tree: `npm run typecheck` — exit 0; `npm run test:peace:v2` — exit 0, 30 files / 285 passed / 1 skipped; `npm run build:peace:v2` — exit 0, existing ~1.53 MB client chunk warning; contracts/source-map/status checks — each exit 0. `git diff --check` — exit 0.
- Before PostgreSQL verification, `AVANPOST_V2_DATABASE_OPERATION=test npm run doctor:peace:v2` — exit 0 and verified configured targets `avanpost_v2_dev` plus disposable `avanpost_v2_mvp_slice_20261111`. Then `AVANPOST_V2_DATABASE_OPERATION=test AVANPOST_V2_DURABLE_RESTART_TEST=true npx vitest run --config vitest.peace-v2.config.ts apps/server-v2/test/server-state.test.ts -t "verified PostgreSQL-backed API restart"` — exit 0, 1 passed / 24 skipped by filter. Verified private seed and internal ledger JSONB migration, restart persistence, and public omission; original world/occupancy/session/command rows are restored in the test `finally` block. An earlier run failed because its assertion expected the now-private ledger in the public response; the assertion was corrected and the DB test rerun successfully. No DB reset was run; no V1, dev/manual, or historical acceptance DB was mutated.
- After a fresh `AVANPOST_V2_DATABASE_OPERATION=test npm run doctor:peace:v2` — exit 0 with the same identity-checked targets — `AVANPOST_V2_DATABASE_OPERATION=test npm run migrate -w @avanpost/server-v2` — exit 0, verified/applied 21 migrations (including 0021, schema metadata 15) only to `avanpost_v2_mvp_slice_20261111`. No reset; no other database modified.
- Then reran the doctor (exit 0, same target identities) before repeating the focused durable restart test after migration 0021 — exit 0, 1 passed / 24 skipped. This post-migration run also restored original data in `finally`.
- Source SHA and final verification commit will be added after commit. Browser MVP acceptance remains NOT_VERIFIED; M1 event accounting and all remaining MVP economic gates remain open.

## M1 explicit accounting-event progress — 2026-11-12

- Implementation/source/test/migration commit: `f59917e5c6340923e29c65c3169c22f4ef049fc7` (`Account Lite stock changes from explicit events`). The typecheck, focused and full test runs, production build, and structural checks below apply to this source SHA; the following journal/status commit only records evidence.

- Replaced inferred net-delta accounting in `reconcilePeaceLiteLedger()` with explicit event input for production, consumption, royal delivery and transfer. Aggregate physical quantity change must exactly equal the event-derived change; arbitrary positive or negative drift rejects. Counter updates retain simultaneous production and consumption even when net stock is unchanged.
- Added persisted accounting event history and monotonic per-world event sequence. Replaying an identical event ID/payload is idempotent; reusing an ID with a different payload rejects. Server tick and command commit paths apply pending events within the DB transaction, then clear pending events; event sequence and accounting history persist with the world/ledger.
- Instrumented existing runtime operations for wood/stone extraction and clearing output, construction material consumption, school training consumption, and territory unlock costs. The shared ledger transfer primitive emits an explicit transfer event. This remains partial: not every legacy haul/storage mutation emits transfer events, the simulation still mutates compatibility structures, and new SKU production paths remain absent. M1 stays IN_PROGRESS.
- Added tests for unchanged net quantity with simultaneous +3 production/-3 consumption, unexplained quantity increase rejection, idempotent replay and event-ID conflict rejection, distinct royal delivery accounting, transfer event preservation, and server-side wood production persistence across API restart.
- `npm run typecheck` — PASS, all workspaces, exit 0.
- `npm run test:peace:v2` — PASS, 30 files; 288 passed, 1 skipped, exit 0.
- Focused ledger/server/simulation tests — PASS, 3 files; 150 passed, 1 skipped, exit 0.
- `npm run build:peace:v2` — PASS, exit 0; existing Vite client bundle advisory (~1.53 MB).
- `npm run check:peace:v2:contracts`, `npm run check:peace:v2:source-map`, `npm run check:peace:v2:status` — each PASS, exit 0; structural/historical checks only.
- Added migration 0022 for schema metadata 16. Before any DB operation, ran `AVANPOST_V2_DATABASE_OPERATION=test npm run doctor:peace:v2`; it failed with `ECONNREFUSED 127.0.0.1:5434`. Per database guardrails, stopped DB work there: migration 0022 and durable PostgreSQL restart test are NOT_VERIFIED and no DB was modified.
- Current review-cycle state still reflects five submitted iterations and is marked BLOCKED. The user explicitly lifted the task iteration limit; review submission is being resumed without rewriting prior iteration records.
