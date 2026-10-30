# Avanpost V2 status

Updated: 2026-10-30

| Field | Current status |
|---|---|
| Branch | `feat/peace-v2-rebuild` |
| HEAD | G4.1 release commit `bfbca0f0711315a8cbb077cb2f5ce4182b7093d0`, anchored by annotated tag `peace-v2-g4.1-accepted`; G4.2 follows on this branch |
| Current gate | G0 `PASS`; G1 `PASS` by user D7-A with CEO concern recorded; G2 `IN_PROGRESS`; G3.3 `ACCEPTED PASS 6/6`; G3.4 `ACCEPTED PASS 9/9`; G4.1 `ACCEPTED`; G4.2 `IN_PROGRESS` |
| G2.1 owner acceptance | PASS 7/7 scenarios; forest-exhaustion P1 closed; physical-phone acceptance remains pending |
| G2.2 automated acceptance | PASS in isolated V2 Playwright: richer side-view, 3 source IDs, chosen two-cabin anchors, no-material/overlap rejection, reload and API restart |
| G2.2 owner acceptance | PASS 7/7 by owner report; physical phone remains unverified |
| G3.1 owner acceptance | PASS by owner report; functional two-resident scenarios accepted |
| G3.1.1 owner acceptance | PASS 7/7 by owner report: repeated harvest, source switching, no duplicate resources, ordinary-tree regrowth, permanent uprooting and persistence |
| G3.2 owner acceptance | ACCEPTED PASS 5/5; D1 carried-wood logistics and D2 persistent priority confirmed |
| G3.3 owner acceptance | ACCEPTED PASS 6/6 by owner report; full-store P1 direct-delivery fix included |
| Current implementation | Owner accepted G4.1: schema-8 physical warehouse stock/reservations, hauler and builder loop, multi-storage Phaser visuals, durable haul state and context-menu sync fix. G4.2 smart logistics is now the active slice |
| Playable V2 | NO current URL verified for ordinary dev during phase-A checks; manual world is tracked separately. G4.1 owner acceptance is recorded; G2 physical-phone cases remain `NOT VERIFIED` |
| Computer URL | N/A — not rechecked during phase-A release checks |
| Phone URL | N/A — not rechecked during phase-A release checks; physical phone remains pending |
| V2 API health | N/A — dev runtime was not queried or changed during phase A |
| Manual test game | `http://localhost:15174/` — isolated `avanpost_v2_manual`, current scenario `g4-multi-storage`; API `127.0.0.1:19888`, PID `.gstack/run/peace-v2-api-manual.pid` |
| Code handoff | Loopback handoff is running at `http://127.0.0.1:8789`; no pairing code was requested or exposed |
| Computer session | G4.1 owner acceptance is recorded in `ACCEPTANCE.md`; dev runtime was not rechecked |
| LAN binding | Current `en0` is `192.168.0.100`; API and LAN client bind to that address. Physical-phone reachability remains unverified |
| V2 build | `apps/client-v2/dist/assets/index-BWdfsHKZ.js`; SHA-256 `67df414f77165f72ede74358902344421dc297076a37040779e4b5680a5f0dc6`; 1,385,889 bytes |
| V1 safety | UNTOUCHED; no V1 application or database writes |
| V2 database | `avanpost_v2_dev` remains schema 7; migration 0010 is not applied there. Test/manual are schema 8; manual scenario is `g4-multi-storage`. Test E2E uses only the isolated test world |
| Tests | G4.1 release checks: root typecheck/build, 135/135 Peace V2 tests, source-map/contracts/status checks, targeted G4.1 Playwright: 1 desktop passed, 1 mobile skipped. Earlier full LAN suite was 15 passed/17 skipped. G4.2 results go in the G4.2 section |
| Runtime | Dev was not changed or queried. Manual PID/client health will be checked during phase B. E2E teardown targets only its `-test` PID |
| Gstack | Targeted G3.5.1 and G3.6 desktop/mobile Chromium interactions pass. Live HTTP smoke verified health and both clients for dev/manual (200). No full-site score or full gstack Review is claimed |
| Inputs | Master spec v1.0, GDD v0.9 and archive checksummed; 37 stable `REQ-####` rows link to test IDs; source-map/API-error/status-contract checks pass; 30 `I-E2E` IDs retained plus supplemental V2 rows |
| Known blockers | Owner playtest of G3.5.1/G3.6, G3.5 cases 8/9 including physical-phone verification, and all 30 full GDD scenarios remain outstanding |
| Next action | Continue G4.2 priority dispatch and multi-hauler validation in `g4-logistics-priority`; keep G4.2 `IN_PROGRESS` pending owner playtest. Preserve `avanpost_v2_dev`; no merge or production deploy |

## Verified so far

- Branch created from the current Stage I.5 working branch without dropping its commits or untracked files.
- Starter archive extracted with `unzip -n`; all five archive files were new destinations.
- No V1 application source or database was changed. G0 V2 code, compose project, volume and local `.env.v2` are isolated from V1.
- V2 commands must not inherit the current `.env` database target; the V1 server default points to database `avanpost` on port 5433 and must not be used for V2.
- `docs/v2/SOURCE_MAP.md` contains 37 stable requirement rows and a per-requirement test/evidence mapping; source-map and API/error-code contract checks pass, verify canonical hashes/paths/rationales and evidence for PASS rows, and preserve all 30 `I-E2E` IDs. This is not a G1 pass; most mapped behavior remains `NOT_STARTED`.
- Design Phase 2 close report is published. Checkpoint `.gstack/tmp/autoplan/autoplan-design-T43tp4/design-implementation.md` SHA-256 `693fd630e876d15c54e0f4509665b69a4d400d8ae5e93bbbdcbf0639dc0d1c0c`; close packet `.gstack/tmp/autoplan/autoplan-design-sp593M/close-packet.md` SHA-256 `fb7e2f1a18898bfa7a42a76095280cc3a8b06bdb01272a41943b33dc797ad792` was fully read. Updated implementation input after the six findings: `.gstack/tmp/autoplan/autoplan-design-HUfCzd/design-implementation.md`, SHA-256 `a2f1b2c82beaa56d711e32c3d23a92ac71638e42a5900594ba7fbc0bfb9509f2`.
- DX Phase 2.5 was reclosed after Eng source inspection found that V1 `dev:client` proxies to V1 API port 8787. Its final packet `.gstack/tmp/autoplan/autoplan-dx-ZPrKml/close-packet.md`, SHA-256 `73801c7bff7aa72cbd207c75565392b49cb8a9619315b57d85d6f5c0ecd7a318`, proposed a client-only command; the completed DX re-review superseded it with the integrated `npm run dev:peace:v2` contract and verified the updated agent/owner flow. Fixed original checkpoint: `.gstack/tmp/autoplan/autoplan-dx-LtNz2G/dx-implementation.md`, SHA-256 `ad1505378922e422b67ab8ec5d8f29f0b0199bb3d72715267e668a46d0425283`.
- Initial Engineering FULL_REVIEW completed in the existing Autoplan run. User decisions D2–D5 are recorded; F1–F8 and native in-host N1–N13 are reconciled in `PLAN.md`. The final Engineering rerun is now complete after Design/DX re-reviews. The CEO plan still carries its separate unresolved post-fix spec re-verification.
- At initial plan review, `npm run` showed no V2 scripts and no V2 runtime/database/tests existed. G0 infrastructure has since been added and tested; gameplay acceptance remains separate.
- Previous live session used `192.168.0.100`; the address changed. The V2 config correctly blocked the stale bind. `192.168.3.138` was revalidated on `en0`, and the restarted API/client returned HTTP 200; the physical-phone flow remains pending owner action.
- G2 slice E2E pairs the localhost browser first, confirms its session survives reload, requests a fresh code, then pairs a separate mobile-emulated browser over the private interface. G2.1 also verifies task/cargo/build persistence across page reload and an actual API process restart on the isolated test DB. Physical phone and owner acceptance remain outstanding.
- Design re-review completed after D3/D4. D-DES-7/8/9 specify the read-only world/pairing sheet and safe recovery. At that plan-review time no runtime/UI test had run; subsequent tests cover local pairing and the live G2 slice.
- DX re-review completed for the OpenCode-agent / nontechnical-owner workflow. D-DX-15/16 separate autonomous setup from browser-only play and use a loopback-only code handoff; the under-5-minute Agent TTHW target is retained for the full flow but remains unmeasured. Codex and bounded Plan/TaskStop review were unavailable.
- Final Engineering FULL_REVIEW completed after Design/DX. No new plan issue or unresolved Engineering decision; reality check 14/14, zero unverified premises. User D7-A accepted the recorded CEO independent post-fix review concern for G1 progression (receipt `9a18c437-279e-4a9e-9696-e004722a762a`); CEO remains `DONE_WITH_CONCERNS` and no independent reread is claimed. G2.1 is playable; physical-phone and owner acceptance remain open.
- Initial G0 added the four isolated V2 workspaces: `apps/server-v2`, `apps/client-v2`, `packages/peace-v2-shared`, and `packages/peace-v2-sim`. Server config/doctor/migrator enforce exact local/compose DB allowlists and post-connect identity.
- Isolated V2 Compose service is running with separate project/volume and loopback-only port 5434. Live doctor verified both V2 database identities; migrations `0001_v2_bootstrap.sql` and `0002_persistent_world.sql` applied to dev and test. V1 `avanpost`/`avanpost_test` were not connected to; prior scratch-restore report: `docs/reports/stage-1-backup-restore-20261023.md`.
- `npm run test:peace:v2`: 59/59 passed; root typecheck and `npm run build:peace:v2` passed. Client bundle SHA-256: `1ca458e623642d18d88e25e6bfbb1ff61da24cb0ce896a16e0722a6a8518e096`. `npm run e2e:peace:v2` passed 2/2 against `avanpost_v2_test`; evidence/source hashes: `docs/v2/evidence/G2/V2-G2-SLICE-01/`. Phaser's 1.30 MB / 349 KB gzip warning is tracked as optimization work and does not block this playtest.
- Latest verification on 2026-10-25: `npm run typecheck`, `npm run test:peace:v2` (59/59), `npm run build:peace:v2`, source-map/contracts/status checks all passed. The first E2E attempt exposed an assertion race when reading the refreshed one-time code; the test now waits for its 32-character value, and the LAN E2E rerun passed 2/2. Build still reports the Phaser 1.30 MB / 349 KB gzip advisory.
- Owner's G2.1 visual gap is addressed with a generated four-frame walk/carry atlas plus server-driven gather/load/unload/build poses; the atlas is explicitly temporary project art, not final G10/G11 art.
- G2.1 implementation from base commit `4c7fb019a2db17adb208da4472ace44eb98d54ad`: versioned migration 0003, server-ticked worker task/load/carry/unload, placement validation/material reserve/staged building, world camera, mouse/touch pan and zoom, animation atlas, and playable placement UI. Owner accepted seven G2.1 checks; physical-phone acceptance remains pending.
- G2.2 preserves the dev world read-only during QA. The latest preview shows 3 stored wood, two completed cabins (anchors 0 and -9), Илья at x=-4, two exhausted stumps, one finite log and one coppice log. The owner has accumulated additional saved progress since the initial G2.1 baseline; none was reset or overwritten.
- G1 gate disposition is PASS by user D7-A with the CEO concern accepted and recorded; this is not independent CEO post-fix verification. G2 is in progress; evidence is scoped to `V2-G2-SLICE-01` and is not full G2 acceptance.
- Live DB identity debugging found PostgreSQL returns `inet_server_addr()::text` with `/32`; switched to `host(inet_server_addr())` and added a regression assertion. `V2-DBSAFE-01` now has unit/live doctor/migration evidence; G1 source-map and domain contracts remain in progress. Prior V1 scratch-restore evidence was reused and not rerun.
