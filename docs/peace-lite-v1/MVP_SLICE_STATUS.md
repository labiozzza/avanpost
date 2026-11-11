# Peace Lite V1 — MVP-SLICE status

**Overall:** IN_PROGRESS — M0 complete; gameplay gates not started.
**Fixed branch:** `setup/peace-v2-dev-environment`
**Audit baseline SHA:** `4353ae5c7ba22f89c0c9f2ea1a684467cb72fb13`
**M0 planning checkpoint:** documentation/instruction commit directly after the audit baseline; no feature-gate PASS is carried forward automatically.
**Scope:** intermediate MVP-SLICE only; full Peace Lite V1 is not complete.

## Gate tracking

| Gate | Status | Evidence / next action |
|---|---|---|
| M0 — audit and instruction alignment | PASS | Instructions aligned; architecture/gap/dependency map, QA/art preflight, acceptance matrix and baseline recorded. `git diff --check` passed. This is a planning gate only, not gameplay acceptance. |
| M1 — physical seven-SKU ledger and save compatibility | NOT_STARTED | Ledger is currently standalone; integrate through snapshots, sim, persistence, commands, UI and old-save normalization. |
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
| Existing Playwright E2E | NOT_AVAILABLE at baseline: the config explicitly runs `reset:peace:v2:test-world` against `avanpost_v2_test`; task policy requires a separately named disposable MVP DB first. |

## Capability / external conditions

- `review-cycle doctor`: GitHub authorized, Telegram verified, Playwright Chromium installed. Current task started on the fixed branch; its policy is `fixed` branch / `manual` merge.
- Genuine image-generation/edit tool: NOT_AVAILABLE. Existing V2 runtime art can be reused; no image generation is claimed.
- Physical Android/iOS, production email provider and public deployment are not available locally. These are outside MVP-SLICE where specified and cannot be substituted with fabricated evidence.

## Current verified implementation facts

- Shared seven-SKU ledger/catalog schemas and unit tests exist; they are not wired into active world snapshots, persistence, simulation ticks, gameplay commands or UI at the audit SHA.
- Existing sim supports wood/stone gathering, physical haul/storage/build, underground routes, population and historical schooling. Those are reuse points, not evidence for Lite vegetable/metal/research/order chains.
- No active Lite food, metal production, research effect, or royal order economy was found in the API/sim/UI at baseline.
- Historical Lite acceptance records (01/02/04/05) reference prior SHAs only. No historical result is promoted to current-SHA MVP PASS.

## Scope boundary

Do not mark full `LITE-E2E-06`, 08–24 as PASS because an MVP subset passes. Do not call this `Peace Lite V1 DONE`. The final slice may be called `MVP-SLICE READY FOR OWNER PLAYTEST` only after MVP-01…16 all pass on one SHA; owner acceptance is separate.
