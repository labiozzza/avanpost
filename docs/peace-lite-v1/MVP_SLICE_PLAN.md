# Peace Lite V1 — MVP-SLICE plan

**Status:** M0 complete; implementation gates M1–M7 remain
**Fixed branch:** `setup/peace-v2-dev-environment`
**Audit baseline:** `4353ae5c7ba22f89c0c9f2ea1a684467cb72fb13`
**Scope:** the intermediate, playable vertical slice in `AVANPOST_MVP_VERTICAL_SLICE_OPENCODE_TZ.md`; not full Peace Lite V1.

## 1. Product and implementation boundary

The slice is complete only when an ordinary new guest can use the game UI to gather and deliver wood/stone, build, produce and consume vegetables, produce metal from an actual geological source with real wood-fuel consumption, train/assign a specialist, finish a canonical research project with a measurable server effect, physically fulfil a royal order for an exactly-once coin reward, continue with another goal, and reload into the same saved world. Desktop Chromium and mobile viewport acceptance are required. MVP-01…16 must all pass on one SHA before `MVP-SLICE READY FOR OWNER PLAYTEST`; only the owner can state `OWNER ACCEPTED`.

The slice does **not** imply completion of all 7 production chains, all 16 buildings, all 15 professions, all 12 technologies, production email, physical phones, full PWA/offline, Stage II/PvP, or the 24 full-Lite E2Es. Do not upgrade their statuses based on this intermediate scope.

## 2. Authority and constraints

1. `Avanpost_GDD_v0.9.md` for game principles and unchanged product direction.
2. `docs/peace-lite-v1/TECHNICAL_SPEC.md` for canonical SKU, recipes, buildings, schools, technology graph, orders, persistence, and security rules.
3. The attached MVP-SLICE task for this intermediate deliverable and its acceptance criteria.
4. This plan plus `MVP_SLICE_STATUS.md` and `MVP_SLICE_ACCEPTANCE.md` for current execution state.
5. `docs/v2/*` and existing code/tests for reusable implementation and regression constraints only; historical G7.2 gates do not block the slice or authorize branch changes.

Keep the current fixed branch. Preserve the original Linux checkout and its untracked evidence. Never touch V1, `avanpost_v2_dev`, `avanpost_v2_manual`, or prior acceptance databases. All real DB/browser acceptance must use a newly named disposable MVP database whose identity is verified before migrations or resets. No merge/deploy; the review-cycle policy is manual merge.

## 3. M0 audit: current architecture and gaps

### Reusable implementation

- `packages/peace-v2-shared/src/lite-ledger.ts` already declares exactly seven SKU IDs, strict quantities, physical locations, stock conservation, reservation/capacity rules, and transfers. `content/peace-lite-v1/items.json` is the only Lite content catalog currently present.
- `packages/peace-v2-sim/src/settlement.ts` already simulates finite stone, renewable tree/wood gathering, resident movement/cargo, storage reservation/capacity, construction, logistics dispatch, training queues, and persisted actions. `underground.ts` and `underground-routing.ts` provide reusable connected geology, excavation, and ladders.
- `packages/peace-v2-sim/src/g72-professions.ts` and the school flow in `settlement.ts` provide historical training and learning-history mechanics; they do not yet prove a Lite capability gate.
- `apps/server-v2/src/server.ts` is the authoritative snapshot/tick/command transaction boundary. Snapshot loads, ticks, and commands persist JSON in `peace_v2_world_state`; Lite account/world membership and idempotency are already additive in `lite-identity.ts` and migrations 0016–0019.
- `apps/client-v2/src/main.ts` and `settlement-scene.ts` provide the existing Phaser world, interaction panels, resident/task UI, and accessible command path. These are the UI reuse point.

### Verified gaps at the audit baseline

- The Lite ledger is a standalone shared contract; no active server/sim/client path consumes it. `PeaceWorldSnapshotSchema` and `PeaceResidentSchema` still describe legacy wood/stone totals/cargo, and current warehouses/logistics aggregate those two items.
- No Lite vegetable production/food consumption, metalworks/fuel recipe, canonical Lite research cycle/effect, or royal-order delivery/wallet path was found in the active V2 sim/server/client.
- Existing training and G7.2 research-related code is not evidence of server-side Lite capability enforcement or a canonical Lite technology effect.
- Prior LITE-E2E-01/02/04/05 records are historical checkpoints; none establish this branch's current SHA or the MVP flow. The QA audit found MVP-01…16 all `NOT_VERIFIED` on the requested SHA.
- Existing e2e config resets the conventional `avanpost_v2_test` world. It must not be used for acceptance in this task; add/use an isolated, newly named disposable database before destructive E2E setup.

### Dependency graph

`M1 typed physical economy + compatibility migration`
→ `M2 vegetable source/production/haul + consumption/shortage/recovery`
→ `M3 accessible geology + metalworks with wood fuel + output haul`
→ `M4 user-visible schooling + server capability check + canonical research materials/time/effect`
→ `M5 royal order accept/reserve/physical delivery/exactly-once reward/next order`
→ `M6 tutorial, clear blockers, balancing, fresh-world desktop/mobile journey`
→ `M7 independent QA, persistence/restart/security/regression evidence and owner handoff`.

M1 is a cross-cutting prerequisite. Migration must be additive/versioned and preserve residents, task phases, cargo, buildings, stocks, reservations, geometry, and old Lite worlds. Choose one authoritative physical representation; legacy fields may only be a validated migration/compatibility projection, never a second writable inventory. Do not create parallel economy state or perform broad JSON rewrites without migration tests.

**Canonical dependency note:** `TECHNICAL_SPEC.md` §7 makes T04 Metallurgy depend on T03 Deep Geology and T04 is what permits the metalworks building/full metal cycle (§4.1, §7). Therefore M3 may implement and test the complete chain behind its real technology gate, but it must not grant early access to bypass research. M4 must provide the ordinary player path through the canonical T03→T04 research requirements/effects; MVP-06 is not PASS until the previously implemented M3 chain becomes reachable and completes after that unlock. The M4 research acceptance can use T03/T04 as the required real technologies (more than the minimum one), and M4 must include the selected specialized-action qualification denial/grant path. Keep this cross-gate dependency visible in status and evidence rather than weakening the spec.

## 4. Engineering sequence and gate exit criteria

| Gate | Planned work | Exit evidence |
|---|---|---|
| M0 | Align project/agent instructions; map real call paths; record baseline; create this plan, status and acceptance files. | Baseline commands/results and bounded architecture/dependency map are recorded. |
| M1 | Integrate the seven-item contract through snapshot normalization, sim, source/buffers/cargo/storage/reservations, commands, persistence and UI; add additive old-save compatibility. | Conservation, migration, capacity, reservation, idempotency, restart and legacy-regression tests pass. |
| M2 | Implement canonical vegetables via a reachable source/farm, staged work, physical delivery and deterministic server food consumption with shortage/recovery UI. | Fresh-world production/delivery/eating/shortage/recovery assertions plus persistence. |
| M3 | Implement reachable finite metal geology and canonical metalworks stages; consume wood physically as fuel; produce/haul/store metal and resume on blockers. | Input/output conservation, no hidden SKU, blocked/resume and browser evidence. |
| M4 | Make a canonical specialty action require server-verified qualification; expose training in ordinary UI; run one or more canonical prerequisite technologies as needed for the metal chain, with delivered materials/time/persisted measurable effect. | Direct API denial before qualification; UI training; effect assertion and reload. Never bypass T03→T04 if needed for metalworks. |
| M5 | Add achievable order lifecycle, reservations, physical delivery to the royal point, exactly-once wallet reward, and a subsequent achievable order. | Retry/two-client idempotency, physical ledger and DB assertions, second-order evidence. |
| M6 | Surface goal, next steps, resources/in-transit, food, workers, production/research/order/coins, and clear recovery reasons; tune only within canonical rules. | Ordinary fresh-world end-to-end desktop and mobile viewport playthrough; no test-only state injection. |
| M7 | Independent QA against the 16 MVP cases; targeted regressions, isolated DB/restart, security and evidence audit; address findings. | Every MVP criterion passes on same SHA; honest owner-playtest handoff, no full-V1 claim. |

## 5. Baseline and initial decisions

- `npm ci` completed on the clean clone; npm reported 7 audit vulnerabilities (3 low, 4 moderate). No automatic audit fix was applied.
- Baseline `npm run typecheck` (exit 0): PASS.
- Baseline `npm run test:peace:v2` (exit 0): 30 files passed; 274 passed, 1 skipped (durable PostgreSQL restart test is opt-in); no DB mutation was configured.
- Baseline `npm run build:peace:v2` (exit 0): PASS with existing >500 kB client bundle advisory.
- Baseline `npm run check:peace:v2:contracts`, `check:peace:v2:source-map`, and `check:peace:v2:status` (each exit 0): PASS (status validates historical V2 status, not MVP readiness).
- At the original baseline no E2E was run because the existing config targets the shared conventional V2 test DB. A new disposable `avanpost_v2_mvp_slice_20261111` is now provisioned and identity-checked; the first legacy G3.4 browser run failed because its pairing helper expects a removed button. See `MVP_SLICE_EXECUTION_JOURNAL.md`; this is not an MVP result.
- No genuine image-generation tool is available. Functional implementation does not depend on new art; reuse preserved assets where appropriate and record art acceptance separately.
- Proposed recipe durations/costs in the spec remain proposals. Do not present them as approved balance; make content versioned and disclose any testable balancing assumptions.

## 6. Change and review policy

Before feature work, complete M0 outputs. Preserve the fixed branch and use global `review-cycle` for the task. Commit only relevant project files plus factual evidence/docs; keep command logs, original request, DB credentials, and local browser artifacts outside Git. Push only the current task branch as review-cycle requires; do not merge without separate owner authorization. Continue safe gates if optional art/device/provider access is absent; do not turn that into a false PASS.
