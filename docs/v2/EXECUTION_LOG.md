# V2 execution log

## 2026-10-23 — bootstrap / G0-G1 in progress

- Branch: `feat/peace-v2-rebuild`; base `feat/peace-sideview-v2`; starting HEAD `87b463ae225f2c690d80f2cb29bba0f55eb4263a`.
- Starter archive `AVANPOST_V2_OPENCODE_STARTER.zip` inspected and extracted with `unzip -n`; all archive destinations were new. Existing untracked migration plan/backup report preserved.
- Read `AVANPOST_V2_MASTER_SPEC.md`, root GDD v0.9, reference GDD v0.9 and archived side-view analysis. Root/reference GDD SHA-256 matches; master and archive hashes recorded in `docs/v2/PLAN.md`.
- `docs/v2/PLAN.md`, `STATUS.md`, `NEXT_ACTION.md`, `SOURCE_MAP.md` and `TEST_MATRIX.md` created. Source map and 30 scenario rows are planning artifacts; tests are not yet run.
- Gstack autoplan detected UI+DX scope. CEO scope mode `SELECTIVE EXPANSION`; no optional capability accepted. Three CEO spec-review iterations completed (scores 5/10, 6/10, 6/10); findings dispositioned in the plan. Native CEO review completed with six findings; full 11-section review/output still in progress. Codex CLI, Aside and bounded Plan/TaskStop outside review unavailable.
- CEO primary review sections 1–11 and phase report are recorded in `docs/v2/PLAN.md`; CEO review status is `DONE_WITH_CONCERNS` because the third spec audit could not be independently re-run after fixes. The source-to-GDD map and 30-case test matrix now exist, all cases remain `NOT_STARTED`.
- Design Phase 2 completed in the existing Autoplan run. Reviewer input `693fd630e876d15c54e0f4509665b69a4d400d8ae5e93bbbdcbf0639dc0d1c0c` returned six findings; all six were reconciled into the accepted design block and re-exported. The close packet was read to EOF and checked against the updated portrait/layout/placement/state requirements. Design review log records score 6/10 → 8/10, no unresolved design findings; Codex/outside and visual mockup coverage remain unavailable.
- DX Phase 2.5 completed and was reclosed after Eng static evidence corrected its selected launcher: `apps/client/src/phaser/main.ts` is V1 and Vite proxies `/api` to port 8787, so the V2 client is isolated. Fixed checkpoint SHA `ad1505378922e422b67ab8ec5d8f29f0b0199bb3d72715267e668a46d0425283`; final close packet SHA `73801c7bff7aa72cbd207c75565392b49cb8a9619315b57d85d6f5c0ecd7a318` fully read/semantically checked and had proposed client-only `dev:peace:v2:client`. The current plan/master spec require integrated `npm run dev:peace:v2`; reopened DX must verify the one-command flow. No second DX reviewer launch; outside Codex/Aside/WebSearch unavailable. DX score remains 4/10 → 8/10; TTHW is unmeasured.
- No product code changed. No application server started. No V2 database created. V1 application and database were not written or migrated.
- Next: Phase 3 Engineering Review in `FULL_REVIEW`; then verify G0/V2 database isolation and finish G1 before starting G2.

## 2026-10-24 — initial Engineering FULL_REVIEW complete; G1 remains in progress

- Continued the existing Autoplan run and reviewed `docs/v2/PLAN.md`; no product source was changed. User decisions D2-D5 are recorded in the plan and durable decision log.
- Engineering findings F1-F8 and independent in-host findings N1-N13 are dispositioned into the plan. Required P0 database guard work, isolated V2 test configs/build coverage, persistent paired G2, idempotency/ordering/ledger/versioning, stable source-map IDs and measurable performance/evidence requirements are explicit.
- `gstack-plan-reality check --phase eng --scope db,perf,dependency` completed with 14/14 rows, no missing rows and 0 unverified premises. `git fetch origin main` succeeded; relevant implementation/planning paths had no commits on `origin/main` since 2026-10-23. `npm run` confirmed that V2 commands do not yet exist.
- Engineering phase result is `issues_open`: 8 review findings are mapped to implementation work, with 0 unresolved Engineering decisions and 0 critical silent-failure gaps. Codex outside review unavailable. The 5-task phase JSONL is `/Users/labiozzza/.gstack/projects/avanpost/tasks-eng-review-20261024-015336.jsonl`; QA Test Plan remains at the path recorded in `PLAN.md`.
- D3/D4 changed the persistent G2 user flow after earlier Design/DX reviews. Reopen both against the updated G2, then rerun Engineering on the final plan. CEO's independent post-fix spec verification remains unresolved. G0/G1 remain `IN_PROGRESS`.
- No V2 tests/build, server, browser, database, benchmark, or physical-device check ran; V2 is not implemented, and V1 remains untouched.

## 2026-10-24 — Design re-review complete; DX and final Engineering remain

- Re-reviewed persistent paired G2 in `docs/v2/PLAN.md` across all seven Design passes. Initial rating 7/10; final 8/10; 3 user design decisions accepted and logged, 0 unresolved Design decisions. Existing D2-D5 and D-DES-1..6 were preserved.
- D-DES-7: unpaired phone sees the world read-only behind a focused pairing sheet; responsive placement follows approved mode-bar/inspector areas. D-DES-8: safe reason-specific recovery for invalid, expired/reused and rate-limited codes without code/attempt/internal-detail leakage. D-DES-9: one labelled full-code input with paste/manual entry, show/hide, explicit `Подключить`, no auto-submit, no logging/persistent client storage.
- Gstack designer was `DESIGN_READY`, but the `variants` command exited 2 before generation because no OpenAI API key was available; 0 images and no comparison board. Visual assessment is text-only and no pixel-level approval is claimed.
- Updated the screen hierarchy, journey/state contracts, Kenney placeholder-art rule, design tasks and decision ledger in `PLAN.md`; added pairing UX/privacy acceptance to `TEST_MATRIX.md` as `V2-PAIR-01`; updated the saved QA Test Plan. Tests and implementation were not run.
- Next: re-review DX against the integrated V2 launcher and protected persistent G2, then rerun Engineering on the final plan. G0/G1 remain `IN_PROGRESS`; V2 remains unimplemented and V1 untouched.

## 2026-10-24 — DX re-review complete; final Engineering pass next

- Re-reviewed DX for the user-specified OpenCode autonomous developer and nontechnical owner/player. Retained API/Service primary type, DX POLISH mode, and the approved competitive `<5 min` agent TTHW target; defined the useful-result endpoint as browser-verified pairing, assignment, delivery, build, reload and actual URL handoff. TTHW remains unmeasured.
- D-DX-15 separates agent setup/tests/recovery from owner browser play. D-DX-16 selects a loopback-only, in-memory owner code handoff with no code in stdout/chat/URLs/logs/evidence/persistent storage and no LAN access. Both are durable user decisions; previous game/design/security/architecture choices remain unchanged.
- Plan now separates `AGENT_RUNBOOK.md` from terminal-free Russian `PLAY_NOW.md`, documents the agent run sequence, service lifetime and owner flow, and updates journey, error matrix and scorecard. The saved QA plan and `V2-PAIR-01` include handoff privacy checks. No V2 code, app, tests, DB, browser or TTHW measurement ran.
- Outside Codex review unavailable; Codex CLI is missing and Plan/TaskStop fallback unavailable. Next: final Engineering FULL_REVIEW on the final plan; G0/G1 remain `IN_PROGRESS`.

## 2026-10-24 — final Engineering FULL_REVIEW complete

- Reran Engineering FULL_REVIEW on the final `docs/v2/PLAN.md` after the Design and DX re-reviews, including the OpenCode/owner role split and loopback-only pairing-code handoff. No new plan issues or unresolved Engineering decisions were found; the original F1-F8 and N1-N13 dispositions remain in the plan.
- `gstack-plan-reality check --phase eng docs/v2/PLAN.md --scope db,perf,dependency --session-kind interactive --plan docs/v2/PLAN.md` returned `PLAN_REALITY: phase=eng rows=14/14 missing=none verdict=complete`. The V2 command/handoff absence is an assigned G0/G2 implementation requirement, not runtime evidence.
- Current Design review log is 7/10 → 8/10 with three decisions; current DX log is 6/10 → 8/10 with D-DX-15/16; both have zero unresolved decisions. Outside Codex and bounded Plan/TaskStop review remain unavailable.
- Engineering is clear for implementation planning, not G1 acceptance. No V2 implementation, build, tests, database, browser or benchmark ran; no V1 application/database changes were made. CEO independent post-fix spec verification remains unresolved; G0/G1 stay `IN_PROGRESS`.

## 2026-10-24 — G0 safety baseline and G1 traceability started

- User authorized moving from the completed plan review into G0/G1 implementation. Added isolated `apps/server-v2` config/doctor/migrator/API and `apps/client-v2` baseline shell; V2 scripts, compose project, loopback-only DB port 5434, unique volume, `.env.v2.example`, dedicated Vitest/Playwright configs, baseline/runbook/contract docs and source-map checker are in place.
- V2 DB identity guard rejects V1 names and unapproved host/port/query overrides before connection, then checks database name, server endpoint and actual socket peer before migrations. Investigation reproduced `inet_server_addr()::text` as `172.29.240.2/32`; `host(inet_server_addr())` now returns the allowlisted IP without the CIDR suffix. Regression passed; live doctor then verified `avanpost_v2_dev` and `avanpost_v2_test`.
- `npm run db:peace:v2:up` created only project `avanpost-peace-v2`, service `peace-v2-postgres`, network `avanpost-peace-v2`, volume `avanpost-peace-v2_peace_v2_pgdata`; migration `0001_v2_bootstrap.sql` applied and replayed idempotently on dev, and applied to test by the E2E harness. V1 DBs were never connected to.
- Checks: `npm run test:peace:v2` 20/20; `npm run typecheck` passed all workspaces; `npm run build` passed (existing V1 client bundle-size warning >500 kB); `npm run check:peace:v2:source-map` structural PASS for 37 requirements and all 30 scenarios; `npm run e2e:peace:v2` 2/2 across desktop and mobile emulation against real API + `avanpost_v2_test`. Evidence: `docs/v2/evidence/G0/V2-BASELINE-01/` and `docs/v2/evidence/G0/V2-DBSAFE-01/`.
- Baseline UI intentionally says gameplay begins at G2. E2E screenshot/API health is infrastructure evidence, not playable-game acceptance. API and client were stopped after the test; isolated V2 Postgres remains running. `V1` source/config/database were not modified or accessed. The earlier checksum-verified restore report (`docs/reports/stage-1-backup-restore-20261023.md`) is reused; it was not rerun in this session. G0/G1 remain `IN_PROGRESS`.
- Added the isolated `peace-v2-shared` and `peace-v2-sim` workspaces. Shared Zod contracts reject fractional/unsafe coordinates and client-authored economic fields; pure sector transforms round-trip signed coordinates, including negative boundaries. Their unit coverage raises the V2 suite to 31/31.
- Extended `check:peace:v2:source-map` to verify canonical SHA-256 inputs, all 37 ordered `REQ-####` rows, linked contract paths/workspaces, all 30 `I-E2E` IDs and required supplemental security regressions. It reports `PASS_STRUCTURE`, not G1 acceptance.
- Re-ran root build/typecheck after the workspace additions. V2 E2E captures desktop/mobile screenshots and source hashes; current evidence matches the tested G0 source. G1 gameplay coverage and all 30 GDD cases remain NOT_STARTED.
- Added the shared Zod contracts for pairing requests, typed build/work intents, owner-free read-only previews and versioned Stage-I catalog/asset-manifest entries with provenance, cross-reference and DAG validation, plus signed-coordinate round-trip tests. `npm run test:peace:v2` now passes 43/43; root typecheck/build pass.
- Stop-timeout investigation found the launcher allowed 5s for Vite shutdown while the stop CLI waited 4s. The stop deadline now covers both phases; a fake-clock regression waits through a 5.5s child shutdown, and a live loopback API+Vite start/stop ended with `status=stopped` and no listeners on 8788/4174.
- One earlier redirected client-start attempt timed out once; the cause was not captured. Subsequent Playwright E2E and visible start/stop checks passed, and the transient did not recur; no code change was attributed to that unconfirmed signal.
- Expanded the doctor with Node ≥22, API/client loopback-port ownership and free-disk checks. The E2E webServer reran doctor and test migration successfully; source-map/API-contract checks verify status rationales, test links, schema/error-code agreement and evidence directories for matrix rows marked PASS. Latest suite is 43/43; G0/G1 are still not gate PASS.
- Added `check:peace:v2:status`; its static test confirms current gate, real URL/health fields, and no false playable/Stage I PASS claim. `V2-STATUS-01` evidence is saved at `docs/v2/evidence/G1/V2-STATUS-01/`.

## 2026-10-24 — G0 accepted; G1 remains in progress

- G0 acceptance evidence is complete: isolated V2 dev/test databases, exact pre-/post-connect identity guard, bootstrap migration, compile-only V2 build, root build/typecheck, dedicated unit/E2E configs, doctor, runbook and owned-process stop. `V2-BASELINE-01`, `V2-DBSAFE-01`, `V2-RUNBOOK-01`, `REQ-0003` and `REQ-0004` have evidence; the prior checksum-verified V1 scratch restore is reused from `docs/reports/stage-1-backup-restore-20261023.md`.
- Current checks: `npm run test:peace:v2` 43/43; root `npm run typecheck` and `npm run build`; `check:peace:v2:source-map`, `check:peace:v2:contracts`, `check:peace:v2:status`; `npm run e2e:peace:v2` 2/2. The loopback API/client were stopped afterward; the dedicated V2 Postgres container remains running.
- G1 remains `IN_PROGRESS`: 37 source rows map to tests/evidence, but most gameplay rows are future G2–G11 work. CEO's independent post-fix review concern remains recorded; no G1 PASS, gameplay, owner URL, or Stage I acceptance is claimed.

## 2026-10-24 — G0 PASS; G1 remains in progress

- Closed G0 from its acceptance evidence: V2 dev/test databases and doctor identity checks, bootstrap migrations, compile-only V2 build, V2 unit/E2E harnesses, OpenCode runbook, scoped launcher/stop and evidence artifacts all pass. `REQ-0003` and `REQ-0004` have G0 evidence; `V2-BASELINE-01`, `V2-DBSAFE-01`, `V2-RUNBOOK-01` and `V2-STATUS-01` are recorded as PASS.
- Reused the prior checksum-verified V1 scratch-restore report at `docs/reports/stage-1-backup-restore-20261023.md`; did not reconnect to `avanpost` or `avanpost_test`. Existing V1 source/DB state remains untouched.
- G1 remains `IN_PROGRESS`: 37 requirement rows, exact test links, canonical hashes, contract schemas, rescue/error registry and tests are in place, but most mapped gameplay behavior is future work and the CEO post-fix independent review concern remains recorded.
- Final checks for this stage: `npm run test:peace:v2` 43/43, root `npm run typecheck` and `npm run build` pass, `check:peace:v2:source-map`, `check:peace:v2:contracts` and `check:peace:v2:status` pass, `npm run e2e:peace:v2` 2/2. No playable game, owner URL, G1 PASS, commit or G2 work is claimed.

## 2026-10-24 — D7-A G1 disposition; G2 authorized

- User selected D7-A: accept the recorded CEO independent post-fix spec-verification concern and proceed. Receipt `9a18c437-279e-4a9e-9696-e004722a762a`; binding decision B8 is in `PLAN.md` and `DECISIONS.md`.
- G1 is now PASS by user disposition; CEO remains `DONE_WITH_CONCERNS`. No independent CEO reread or clean-review claim is made. G2 is authorized but remains `NOT_STARTED` until implementation begins.
- Updated `STATUS.md`, `SOURCE_MAP.md`, `NEXT_ACTION.md` and the status-check contract. Next: implement the persistent G2 playable slice within the existing V2 isolation and pairing constraints.

## 2026-10-24 — G2 local playable slice in progress

- Added migration 0002 with an isolated persistent starter world, hashed owner sessions and transactionally logged command results. Pairing uses a random one-time code, bounded expiry/attempts, a separate actual-loopback-only handoff service, strict configured UI Origin/Referer and an HttpOnly/SameSite session cookie. API/client can bind only to loopback by default; private-interface bind requires an explicit opt-in and an assigned RFC1918 IPv4.
- Replaced the G0 shell with a Phaser strict side-view settlement and Russian touch-first actions. The owner can send a worker for a log, see it carried, deliver it into storage, build a cabin, and restore the world after page reload. Unpaired preview remains read-only.
- Added a test-only, identity-verified reset of `avanpost_v2_test` to keep the browser flow repeatable; it cannot target the dev DB. V1 was not accessed.
- `V2-G2-SLICE-01` passes against real `avanpost_v2_test` with `AVANPOST_V2_ENABLE_LAN=true` and assigned private bind `192.168.0.100`: a separate mobile-emulated browser pairs from the direct API, desktop remains unpaired, stale command is rejected, duplicate replay is idempotent, wood is delivered, cabin is built, and reload restores the world. This is not a physical-phone check. Evidence/source hashes: `docs/v2/evidence/G2/V2-G2-SLICE-01/`.
- Screenshot review removed an unlabeled decorative progress bar, renders an exhausted tree as a stump, and ensures the hidden pairing-code output stays hidden. This was a limited screenshot inspection, not a completed Aside design audit.
- Verification: 47/47 V2 unit tests, 2/2 Playwright checks, typecheck, V2 build, status/source-map/API contract checks pass. Full G2 remains in progress: physical-device verification and broader restart/security sweep are outstanding.

## 2026-10-24 — live personal playtest ready

- Confirmed `192.168.0.100` is still assigned to `en0`; V2 remains explicitly bound to that address, with a separate `127.0.0.1` localhost client and `127.0.0.1:8789` handoff. No wildcard or public bind.
- V2 API health returns `200` for `avanpost_v2_dev`. Headed Chromium loaded both client URLs: `http://localhost:4175/` and `http://192.168.0.100:4174/`; both browser pages have no console errors after reload. Handoff GET returns `200`, 32-character code present, `Cache-Control: no-store, private`; code was neither printed nor consumed.
- Started and left V2 PostgreSQL, API, LAN Vite and loopback Vite running. Localhost pairing now survives reload; the worker-select control becomes enabled. The headed Chromium window is left open on the computer URL; the phone URL is also open in a second tab with a mobile-sized viewport. A fresh phone pairing code is visible only in the localhost page; it has not been consumed or emitted to chat/logs.
- Production client bundle: `apps/client-v2/dist/assets/index-CV_gAJDN.js`, SHA-256 `a161b994571061d52c22c79117c7df8fa49972e8c8e021616073337fb5ee9c5e` (1,301,895 bytes). Vite warns at ~349 KB gzip; recorded as optimization work only.
- Manual physical-phone playtest is still pending and is the next gate input; G2 is not accepted.

## 2026-10-24 — pairing code expiry recovery

- Reproduced the user's `410 Gone`: the initial code's five-minute expiry started with API startup, so an idle running server could no longer show a code.
- Changed the local handoff to renew an expired or consumed code when the owner requests it. The new five-minute window starts at reveal; API validates against the current in-memory code. Code remains loopback-only, no-store, and absent from logs.
- Added tests for expired-code renewal, re-issue after consumption, one-time session use and invalid-attempt rate limiting. Verification is 51/51 unit tests plus 2/2 E2E; no secret values were output.
- Fixed localhost pairing after the owner reported the UI remained in read-only preview: a localhost page cannot reliably use an API-host cookie across the private-IP site boundary. The localhost-only Vite listener now proxies `/api` to the API's private bind, keeping the HttpOnly cookie first-party; the phone client still calls the private API directly. E2E now pairs localhost, reloads with its session, issues a fresh code, then pairs the mobile-emulated client.
- Serialized V2 database access on the single `pg.Client`, avoiding its concurrent-query deprecation warning when desktop and mobile preview load together.
- Added repository-contract and starter-archive tests for the ship pre-gate; final V2-only run passed 59/59 tests, typecheck/build, 2/2 E2E evidence reuse, status/source-map/contracts checks and pregate (with only documented synthetic-PII/internal-URL warnings). No V1 test suite or database was used.

## 2026-10-25 — review fixes and V2 verification

- Fixed the E2E timing race when reading a refreshed pairing code by waiting for the 32-character code to render; the explicit-LAN Playwright run passes 2/2, and current source hashes/screenshots are recorded in `docs/v2/evidence/G2/V2-G2-SLICE-01/`.
- Review found and fixed a worker dead-end: server and UI now reject cabin construction while carrying wood; `apps/server-v2/test/server-state.test.ts` proves the rejected transition leaves delivery possible.
- Persisted-world decoding/schema failures now return `V2_WORLD_STATE_INVALID`, distinct from `V2_DB_UNAVAILABLE`, and emit a structured safe log containing only the code and world ID. Added a sanitized response regression and documented the code in API/error contracts.
- Review decisions: RH-1 and RH-16 kept as justified; command request-ID/payload mismatch regression skipped and recorded in `NEXT_ACTION.md` while the existing server guard remains; migration-lock improvement and redundant post-command fetch optimization skipped/deferred.
- Latest checks: typecheck passed; V2 suite 61/61; V2 build passed with the existing Phaser bundle-size advisory; source-map/contracts/status checks passed; explicit-LAN E2E 2/2. V2 runtime was stopped after browser verification; V1 was not used.

## 2026-10-25 — G2.1 live settlement implementation and playtest handoff

- Applied immutable migration `0003_live_settlement.sql` to the existing `avanpost_v2_dev` and to the disposable E2E DB. It adds saved simulation time/schema version and upgrades worker/storage/tree/building JSON in place; no dev-world reset or V1 DB access occurred. The observed dev preview still contains its existing 1 wood, 3 tree logs and one completed cabin.
- Implemented deterministic 500 ms server ticks and persisted worker phases/path/progress/cargo; wood leaves the tree only after loading and enters storage only after unloading. Restart catches up a saved route once. Idle ticks no longer invalidate command versions. Building validates the exact 2×1 anchor, reserves 3 wood atomically and persists planned/foundation/scaffold/complete progress.
- Replaced viewport-relative drawing with stable 48 px side-view coordinates, continuous decorative soil/stone cutaway, Phaser mouse/touch pan, wheel/pinch zoom, center/recenter, selected worker/building inspector and a server-validated construction ghost/catalog. The cave is explicitly decorative and has no mining mechanic.
- Added a shared-pivot 15-frame generated worker atlas for idle/chop/load/walk/carry-walk/build, plus prompt/provenance/SHA manifest and atlas builder. The current images are project-specific AI placeholders, not final art or an external licensed pack.
- Verification: root typecheck passed; `npm run test:peace:v2` 67/67; `npm run build:peace:v2`; API/source-map/status checks passed. Full explicit-LAN Playwright passed 2/2, including task/load/carry/unload, selected-anchor placement, duplicate replay, reload, API process restart while building and mobile camera. Evidence/source fingerprints: `docs/v2/evidence/G2/G2.1-LIVE-SETTLEMENT/`.
- Live developer API, localhost and private-interface clients were started after doctor and dev migration passed. Current URLs and the preserved dev-world baseline are recorded in `PLAY_NOW.md`/`STATUS.md`. macOS currently reports no AirPort association, so physical-phone reachability remains unverified; the one-time code was not recorded or sent to chat.
- G2 remains `IN_PROGRESS` pending owner and physical-phone acceptance. G3–G9 were not started. V1 source/schema/data remain untouched.
