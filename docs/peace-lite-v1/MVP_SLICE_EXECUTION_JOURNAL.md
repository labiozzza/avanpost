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

- Source/test commit after the passing checks above: f43c14ae24de44f327829248d1c229c8f9861e44 (Cover underground stock and verify explicit V2 pairing). The follow-up journal-only commit records this SHA; no source files changed after the checks.
