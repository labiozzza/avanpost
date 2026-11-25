# AVANPOST — mobile UX, drag assignment, and offline catch-up

**Status:** implementation is locally verified and code SHA `e211a02b4d11934de68ae615bd1761b7608d11d9` is pushed. GitHub Actions run [#49](https://github.com/labiozzza/avanpost/actions/runs/45650671858) passed setup, both typechecks, unit tests, production build, PWA artifact check, and preview startup. Its Chromium playtest was **CANCELLED by the 60-minute job timeout** after 37 tests passed and 2 skipped; test 38 was interrupted while still running. The workflow timeout is being raised to 120 minutes before the full rerun. The public deployment is **NOT DEPLOYED**. The physical iPhone is **NOT VERIFIED**.

## Cause and fix: controls after closing a building card

`closePanel()` hid the information panel but left `placementKind` active. While placement was active, the Phaser pointer handler treated scene taps as placement input, so returning to the scene could appear to disable normal controls. The placement banner and its cancel action could also remain in a contradictory grid state.

Panel visibility and placement state now have separate actions. Closing a card only closes the card; the placement banner remains visible with an explicit cancel button. `cancelPlacement()` clears building and road placement, selected plot/road, preview and transient outside-panel pointer state, removes active build-button styling, and restores the prior grid label. Navigation to residents, menu, build, or settlement cancels placement before changing panels. Escape cancels placement when active. Opening an already-built sawmill is covered by a browser regression.

The HUD now labels the forced grid as **«Режим размещения»**, keeps its instruction in a separate row, and retains the cancel action. Toast placement and dock safe space account for the required narrow, landscape, and desktop viewports. No invisible overlay was found intercepting the tested actions.

## Drag assignment

Residents can be dragged from the Phaser scene to adult trees, trees served by a sawmill, available ore, a completed mine, active construction, and a warehouse. The scene uses screen pointer coordinates transformed through the Phaser camera. A threshold distinguishes a drag from a tap or camera pan; invalid targets show a reason and leave the prior role intact. `pointercancel` cancels without assignment. A successful drop persists the role and the resident follows the normal route; the resident is not teleported.

The saved sequence of screenshots is used in place of a video:

- `../../apps/gameplay-prototype/docs/mobile-ux-catchup-fix/drag-01-sawmill-target.png`
- `../../apps/gameplay-prototype/docs/mobile-ux-catchup-fix/drag-02-adult-tree-target.png`
- `../../apps/gameplay-prototype/docs/mobile-ux-catchup-fix/drag-03-ore-target.png`
- `../../apps/gameplay-prototype/docs/mobile-ux-catchup-fix/drag-04-construction-target.png`
- `../../apps/gameplay-prototype/docs/mobile-ux-catchup-fix/drag-05-warehouse-target.png`
- `../../apps/gameplay-prototype/docs/mobile-ux-catchup-fix/drag-07-completed-mine-target.png`
- Invalid target feedback: `../../apps/gameplay-prototype/docs/mobile-ux-catchup-fix/drag-06-invalid-growing-tree.png`
- Six-resident result: `../../apps/gameplay-prototype/docs/mobile-ux-catchup-fix/drag-assignments-six-residents.png`

## Offline catch-up measurements

Measurements compare the branch-base implementation (`b6473bb008aac57288f877e08ca5df53ec26bd48`) with the current implementation in the same Node process and synthetic six-resident world, with a mine, a construction site, and identical resources. Catch-up advances in exact 0.1-second economic steps. The baseline was rebuilt from the branch-base simulation and catch-up sources; the current run used the modified sources. Times are local Windows measurements, not iPhone measurements.

| Absence | Before | After | Change | Full-state checkpoints before → after |
| --- | ---: | ---: | ---: | ---: |
| 15 minutes | 773 ms | 698 ms | 10% faster | 61 → 3 |
| 1 hour | 1,983 ms | 1,480 ms | 25% faster | 241 → 13 |
| 4 hours | 8,152 ms | 5,663 ms | 31% faster | 961 → 48 |
| 8 hours | 15,062 ms | 11,448 ms | 24% faster | 1,921 → 96 |

The largest remaining costs in the six-resident eight-hour profile are logistics refreshes (about 4.94 s) and resident updates (about 4.21 s). Diagnostic refreshes fell from 288,001 calls to 1,921. JSON serialization fell from about 324 ms to 17 ms. The measured scenario therefore improves materially, while the 8-hour desktop result is still about 11.4 seconds; that duration is **not** presented as a verified iPhone result.

Offline simulation continues to use the same capped 0.1-second transition, so the speedup does not come from passing a larger delta to `simulation.step()`. The offline path skips rebuilding whole-world progress diagnostics on every transition, refreshing them on diagnostic intervals and at completion. Progress callbacks report processed simulation time. Full serialized checkpoints are now spaced 300 seconds of simulated time apart; the UI yields every 150 simulated seconds. A checkpoint stores the exact processed timestamp so a restart resumes from the saved prefix instead of crediting the same interval twice. `resumePromise` coalesces overlapping `pageshow` and `visibilitychange` requests.

## Screenshots

- Desktop HUD 1366×768: `../../apps/gameplay-prototype/docs/mobile-ux-catchup-fix/hud-desktop-1366x768.png`
- Wide desktop HUD 1792×828: `../../apps/gameplay-prototype/docs/mobile-ux-catchup-fix/hud-desktop-1792x828.png`
- Phone portrait 390×844: `../../apps/gameplay-prototype/docs/mobile-ux-catchup-fix/hud-portrait-390x844.png`
- Phone portrait 375×667: `../../apps/gameplay-prototype/docs/mobile-ux-catchup-fix/hud-portrait-375x667.png`
- Phone landscape 844×390: `../../apps/gameplay-prototype/docs/mobile-ux-catchup-fix/hud-landscape-844x390.png`
- Placement cancellation and navigation: `../../apps/gameplay-prototype/docs/mobile-ux-catchup-fix/placement-cancel-and-navigation-1366x768.png`
- Catch-up in the visible scene: `../../apps/gameplay-prototype/docs/mobile-ux-catchup-fix/catchup-one-hour-complete.png`

## Save safety

The save key remains `avanpost:gameplay-prototype:v01`; no owner save was read, cleared, or rewritten. The browser tests use isolated seeded contexts. They verify 120 drag assignments through the UI and reload, and that a six-resident settlement with its assigned roles survives reload. Catch-up checkpoints preserve the processed timestamp for safe interruption recovery.

## Automated verification

| Check | Result |
| --- | --- |
| App typecheck | PASS |
| E2E typecheck | PASS |
| Gameplay unit tests | PASS — 132 tests |
| Production build | PASS |
| PWA artifact check | PASS — 32 cached files, 17 game assets |
| Full Playwright local run | 37 PASS, 2 SKIPPED, 1 FAIL in an existing mine-lifecycle test; its unnecessary “clear the source pile after idling its producer” precondition was removed, then the same scenario passed on targeted rerun (2.2 min) |
| GitHub CI | INCOMPLETE — run [#49](https://github.com/labiozzza/avanpost/actions/runs/45650671858): 37 browser tests PASS, 2 SKIPPED; test 38 interrupted by the 60-minute job timeout. A 120-minute rerun is pending the workflow update. |
| Physical iPhone | NOT VERIFIED |
| Public Tuna release ID | NOT VERIFIED; current public route was previously observed returning Tuna `404 Tunnel not found` |

The default test runner in this Windows workspace cannot spawn worker processes in the sandbox. Unit tests passed with Vitest's thread pool. Browser tests ran with the approved local worker process against the fresh preview at `127.0.0.1:4178`; the preview build is not Vite dev mode. The test-only adjustment uses the remaining ore in its baseline and verifies that the infinite mine increases total visible ore after the miner resumes. The source pile remains saved and visible; the game does not promise a generic hauler will keep a source-specific request after its producer is reassigned.

## Release record

- Branch: `feat/gameplay-prototype-v0.1`
- Tested source SHA: `e211a02b4d11934de68ae615bd1761b7608d11d9`
- CI run: [#49](https://github.com/labiozzza/avanpost/actions/runs/45650671858) **CANCELLED by timeout** (37 PASS, 2 SKIPPED, test 38 interrupted); workflow timeout raised to 120 minutes for rerun
- Public URL: [https://tester.a.2na.am/](https://tester.a.2na.am/)
- Public status: **NOT DEPLOYED**; no new release ID has been generated. The last recorded public response was Tuna's HTML `404 Tunnel not found`. The owner reports reconnecting the existing Tuna service; this has not been externally verified. A fresh HTTPS check in this executor could not pass its configured local proxy (`127.0.0.1:9` refused the connection), so the current edge response is **NOT REVERIFIED**. The expected local target `127.0.0.1:7070` had no listener during the check. Do not mark deployment complete until the existing route serves the new release ID and matching production assets. The HTTPS origin and save key must be retained.
