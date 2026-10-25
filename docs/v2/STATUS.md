# Avanpost V2 status

Updated: 2026-10-25

| Field | Current status |
|---|---|
| Branch | `feat/peace-v2-rebuild` |
| HEAD | G2.1 forest fix committed as `ec293a6`; G2.2 worktree uncommitted on top |
| Current gate | G0 `PASS`; G1 `PASS` by user D7-A with CEO concern recorded; G2 `IN_PROGRESS`; no clean CEO reread claimed |
| G2.1 owner acceptance | PASS 7/7 scenarios; forest-exhaustion P1 closed; physical-phone acceptance remains pending |
| G2.2 automated acceptance | PASS in isolated V2 Playwright: richer side-view, 3 source IDs, chosen two-cabin anchors, no-material/overlap rejection, reload and API restart |
| G2.2 owner acceptance | Pending browser playtest; physical phone remains unverified |
| Playable V2 | RUNNING for owner playtest of G2.2; G2 remains `IN_PROGRESS` pending physical-phone verification |
| Computer URL | `http://localhost:4175/` — HTTP 200 in Playwright Chromium |
| Phone URL | `http://192.168.0.100:4174/` — HTTP 200 in Playwright Chromium; physical phone pending |
| V2 API health | HTTP 200 `{"status":"ok","api":"peace-v2","database":"avanpost_v2_dev"}` at private IPv4 port 8788 |
| Code handoff | Loopback-only handoff is available from the computer page; code is hidden until owner presses reveal and is never emitted to logs/chat |
| Computer session | The live localhost page is unpaired in this check; owner can reveal a local code and pair the computer, then reveal a new code for the phone |
| LAN binding | `192.168.0.100` rechecked on `en0`; localhost, private client, health and preview returned HTTP 200. Physical-phone reachability remains unverified |
| V2 build | Client bundle `apps/client-v2/dist/assets/index-_FAWRDWn.js`; SHA-256 `4fb0cedc3bbc14d11c1c4d687d3ddca9e200f431b7589d61ded4123ed549208b`; 1,329,546 bytes; G2.2 source uncommitted |
| V1 safety | UNTOUCHED; no V1 application or database writes |
| V2 database | Created only in project `avanpost-peace-v2`: `avanpost_v2_dev` and `avanpost_v2_test`; separate V2 volume; migrations 0001–0004 apply to both. Migration 0004 preserves the dev world in place |
| Tests | Typecheck passed; 68/68 V2 unit tests; V2 build passed; 2/2 LAN Playwright E2E passed on `avanpost_v2_test`. E2E covered 390×844, 375×667, 1440×900, cursor zoom/pan, three source IDs, exact anchors 1 and 4, rejected overlap/insufficient wood, reload and API restart. All 30 full GDD E2E scenarios remain `NOT_STARTED` |
| Runtime | V2 PostgreSQL and migration 0004 are intact; G2.2 E2E uses only `avanpost_v2_test`. Owner-play runtime will be restarted on the existing dev world after QA; no dev reset occurred |
| Gstack | `/investigate` confirmed and closed the forest-exhaustion P1. Addressed gameplay QA is in progress. No new CEO/Design/DX/Autoplan/Ship run |
| Inputs | Master spec v1.0, GDD v0.9 and archive checksummed; 37 stable `REQ-####` rows link to test IDs; source-map/API-error/status-contract checks pass; 30 `I-E2E` IDs retained plus supplemental V2 rows |
| Known blockers | No physical-phone acceptance; macOS reports no active Wi-Fi association, so a handset connection cannot be confirmed. Art remains project-specific placeholder art, not final licensed G10/G11 art. |
| Next action | Owner opens the existing dev settlement, pairs, gathers from the selected grove and builds another cabin at a chosen point. G2 stays `IN_PROGRESS` pending physical-phone verification and G2.2 owner acceptance |

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
- G2.1 implementation from base commit `4c7fb019a2db17adb208da4472ace44eb98d54ad`: versioned migration 0003, server-ticked worker task/load/carry/unload, placement validation/material reserve/staged building, world camera, mouse/touch pan and zoom, animation atlas, and playable placement UI. Owner and physical-phone acceptance remain pending.
- G1 gate disposition is PASS by user D7-A with the CEO concern accepted and recorded; this is not independent CEO post-fix verification. G2 is in progress; evidence is scoped to `V2-G2-SLICE-01` and is not full G2 acceptance.
- Live DB identity debugging found PostgreSQL returns `inet_server_addr()::text` with `/32`; switched to `host(inet_server_addr())` and added a regression assertion. `V2-DBSAFE-01` now has unit/live doctor/migration evidence; G1 source-map and domain contracts remain in progress. Prior V1 scratch-restore evidence was reused and not rerun.
