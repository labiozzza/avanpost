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
| M1 — physical seven-SKU ledger and save compatibility | IN_PROGRESS | New disposable DB `avanpost_v2_mvp_slice_20261111` is identity-checked and migrated (19 migrations). Identity tests pass (25/25). The legacy validator now maps warehouse stock/reservations, tree/deposit buffers, resident cargo, construction-site stock and school training stock, excluding aggregate `resources`; it validates snapshot load and JSONB-write boundaries. This remains a reconstructed wood/stone compatibility view: no ledger is persisted or canonical in tick/command mutation, and the remaining five SKUs are not runtime-backed. Do not claim M1 complete until one authoritative representation, migration, conservation, and restart tests are implemented. |
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

## Current working-tree regression checks (2026-11-12)

The tree is based on M0 checkpoint `4c5d8628989dcb20abf852dd670f38d9fc154ad2` and contains uncommitted changes; results below are not tied to a committed feature SHA and do not constitute MVP acceptance.

| Check | Result |
|---|---|
| `npm run typecheck` | PASS, all workspaces. |
| `npm run test:peace:v2` | PASS, 30 files / 278 passed / 1 skipped. |
| `npm run build:peace:v2` | PASS; existing >500 kB client chunk advisory. |
| contracts / source-map / historical status checks | PASS; source map is structural only and status remains historical V2. |
| desktop + mobile legacy G3.4 browser regressions | PASS on disposable test DB; not MVP acceptance. |

## Capability / external conditions

- `review-cycle doctor`: GitHub authorized, Telegram verified, Playwright Chromium installed. Current task is fixed-branch/manual-merge. Local M0 commit exists; no push/review has been run yet. Global review-cycle CDP connected to authorized Windows Chrome at `http://127.0.0.1:9222`; target ChatGPT project was already open and had no login controls. `review-cycle status` reports zero review iterations; no request was sent.
- Genuine image-generation/edit tool: NOT_AVAILABLE. Existing V2 runtime art can be reused; no image generation is claimed.
- Physical Android/iOS, production email provider and public deployment are not available locally. These are outside MVP-SLICE where specified and cannot be substituted with fabricated evidence.

## Current verified implementation facts

- Shared seven-SKU ledger/catalog schemas and unit tests exist. The legacy adapter maps wood/stone locations including warehouses, source buffers, cargo, construction sites and school stock, and validates on persisted snapshot parse/JSONB serialization. It is not a persisted/canonical ledger and does not govern tick or command writes; there is still no runtime ledger acceptance.
- Existing sim supports wood/stone gathering, physical haul/storage/build, underground routes, population and historical schooling. Those are reuse points, not evidence for Lite vegetable/metal/research/order chains.
- No active Lite food, metal production, research effect, or royal order economy was found in the API/sim/UI at baseline.
- Historical Lite acceptance records (01/02/04/05) reference prior SHAs only. No historical result is promoted to current-SHA MVP PASS.
- CDP project access was verified at the user's request: page title `ChatGPT - GameDev`, target project route loaded, and no login/sign-up controls were present. Profile name was not visible in page text. No credentials were entered or exposed.

## Scope boundary

Do not mark full `LITE-E2E-06`, 08–24 as PASS because an MVP subset passes. Do not call this `Peace Lite V1 DONE`. The final slice may be called `MVP-SLICE READY FOR OWNER PLAYTEST` only after MVP-01…16 all pass on one SHA; owner acceptance is separate.
