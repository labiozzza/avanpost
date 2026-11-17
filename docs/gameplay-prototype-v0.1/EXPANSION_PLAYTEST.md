# Eastern frontier & mobile camera playtest

- Date: 2026-11-17
- Branch: `feat/gameplay-prototype-v0.1`
- Camera-fix commit: `295df6c57127816d57533d28f725f03edcfeda3a`
- Expansion commit: `367c90fb073d2668bae91ada5d8baf9310364a6e`
- Gameplay/code verification commit: `e984a16b38b5aaa19cb4e363ebc3a4b089152a77`
- Successful GitHub Actions run: [44081581169](https://github.com/labiozzza/avanpost/actions/runs/44081581169) — **SUCCESS**, all workflow steps passed; Chromium reported **4 passed (9.5m)**.

## Scope and evidence

This is an experimental local-simulation expansion for the prototype branch only. It does not change the accepted GDD, Peace V2, production APIs, or databases. The experimental costs/recovery rates are centralized in `apps/gameplay-prototype/src/simulation.ts`.

The checkout contains no separate source document defining the exact CAM-01…10 or EXP-01…15 wording. The IDs below map to observable checks implemented for this playtest; if they refer to a separate external checklist, exact wording alignment remains **NOT VERIFIED**.

Local production-preview evidence: [`eastern-expansion-start-local-20261117.png`](evidence/eastern-expansion-start-local-20261117.png). It was captured from the rebuilt PWA served on `http://localhost:4176/`; the visible starting settlement was reviewed.

The successful CI artifact was downloaded and its selected production-Chromium screenshots were visually reviewed and retained in [`evidence/ci-44081581169/`](evidence/ci-44081581169/). CI uses real Chromium touch input through CDP at mobile viewport sizes; this is browser emulation, not a physical-iPhone test.

## Camera checks

The Playwright scenario sends Chromium touch input through CDP at 375×667, 667×375, 390×844, 844×390, and 1440×900.

| ID | Check | Result | Evidence / limitation |
|---|---|---|---|
| CAM-01 | Touch-swipe up reveals more of the underground cross-section. | PASS | CI: [touch up](evidence/ci-44081581169/camera-touch-up-modern-iphone.png). |
| CAM-02 | Touch-swipe down returns toward the surface. | PASS | CI: [touch down](evidence/ci-44081581169/camera-touch-down-modern-iphone.png). |
| CAM-03 | Swipe left pans the world right. | PASS | CI: [touch left](evidence/ci-44081581169/camera-touch-left.png). |
| CAM-04 | Swipe right pans the world left. | PASS | CI: [touch right](evidence/ci-44081581169/camera-touch-right.png). |
| CAM-05 | Diagonal touch pan moves both camera axes. | PASS | CI: [diagonal pan](evidence/ci-44081581169/camera-touch-diagonal.png). |
| CAM-06 | “К поселению” restores the initial settlement framing. | PASS | CI: [return to settlement](evidence/ci-44081581169/camera-touch-return-settlement.png). |
| CAM-07 | Pinch-out increases camera zoom. | PASS | CI: [zoom in](evidence/ci-44081581169/camera-zoom-in.png). |
| CAM-08 | Pinch-in decreases zoom while keeping the world view clamped. | PASS | CI: [zoom out](evidence/ci-44081581169/camera-zoom-out.png); automated world-bound assertions passed. |
| CAM-09 | A fresh single-finger pan after a pinch does not replay pinch displacement. | PARTIAL | The post-pinch fresh pan passed in CI. The test uses protocol-valid complete touch-end followed by a fresh pan; CDP’s `touchEnd` does not model lifting only one of two fingers, so the surviving-finger transition itself is **NOT VERIFIED**. |
| CAM-10 | Camera remains within world bounds; selection and control-panel gestures remain usable. | PASS | CI: [selected resident](evidence/ci-44081581169/context-selected-resident.png); panel gestures, selection, repeated edge drags, and bounds assertions passed. |

## Eastern expansion checks

The main scenario begins from a new browser save and uses in-game controls/touch input for the progression. LocalStorage reads are used only for assertions and save-recovery checks.

| ID | Check | Result | Evidence / limitation |
|---|---|---|---|
| EXP-01 | The eastern boundary, forest, and sector status are visible in the continuous side-view world. | PASS | CI: [sector opened](evidence/ci-44081581169/eastern-sector-opened.png), [prepared plots and forest](evidence/ci-44081581169/eastern-sector-prepared-two-plots-and-forest.png). |
| EXP-02 | An eastern plot cannot be built on while the sector is closed. | PASS | CI: [closed plot blocked](evidence/ci-44081581169/eastern-closed-plot-blocked.png). |
| EXP-03 | Opening is gated by the first house and requires 8 wood + 5 stone. | PASS | CI browser flow and unit test verify house prerequisite and configured cost; [before opening](evidence/ci-44081581169/eastern-sector-before-opening.png). |
| EXP-04 | Opening deducts the exact cost across stores without a negative balance. | PASS | CI asserted exact before/after totals and nonnegative stores; [opened sector](evidence/ci-44081581169/eastern-sector-opened.png). |
| EXP-05 | Owning the sector does not enable building before physical preparation. | PASS | CI: [unprepared plot blocked](evidence/ci-44081581169/eastern-unprepared-plot-blocked.png). |
| EXP-06 | A free resident physically walks to the clearing point before work progresses. | PASS | CI asserted the resident moved in `moving` mode before progress began; [clearing in progress](evidence/ci-44081581169/eastern-clearing-in-progress.png). |
| EXP-07 | Clearing takes work time and shows progress/stumps. | PASS | CI and unit tests verified delayed progress and completion; [progress](evidence/ci-44081581169/eastern-clearing-in-progress.png), [prepared land](evidence/ci-44081581169/eastern-sector-prepared-two-plots-and-forest.png). |
| EXP-08 | Reassigning the clearer pauses the job without losing progress. | PASS | CI asserted saved progress remained unchanged while paused; [paused clearing](evidence/ci-44081581169/eastern-clearing-paused-progress-preserved.png). |
| EXP-09 | The player can explicitly resume clearing; completion prepares the plots. | PASS | CI asserted explicit resume and `prepared` completion; [prepared land](evidence/ci-44081581169/eastern-sector-prepared-two-plots-and-forest.png). |
| EXP-10 | Prepared land exposes two build plots and a separately selectable eastern forest. | PASS | CI: [plots and forest](evidence/ci-44081581169/eastern-sector-prepared-two-plots-and-forest.png), [selected forest](evidence/ci-44081581169/eastern-forest-wood-in-transit.png). |
| EXP-11 | A warehouse on eastern land uses the ordinary site, material-delivery, and staged-build loop. | PASS | CI followed placement, material delivery, and completion through the normal construction simulation; [site](evidence/ci-44081581169/eastern-warehouse-construction-site.png), [completed warehouse](evidence/ci-44081581169/eastern-warehouse-complete.png). |
| EXP-12 | Eastern wood can be selected only after preparation. | PARTIAL | The implementation guard rejects the source before preparation, and CI assigned the worker from the selected forest after preparation: [forest details](evidence/ci-44081581169/eastern-forest-wood-in-transit.png). The rejection path itself was not directly exercised in this playtest. |
| EXP-13 | A worker walks to the eastern forest and consumes its physical stock when harvesting. | PASS | Deterministic simulation test asserts stock depletion; CI browser flow assigned the eastern source and observed harvested cargo. |
| EXP-14 | Harvested wood remains cargo until physically delivered to a warehouse. | PASS | CI asserted warehouse totals stayed unchanged while cargo was in transit, then increased after delivery; [in transit](evidence/ci-44081581169/eastern-forest-wood-in-transit.png), [delivered](evidence/ci-44081581169/eastern-forest-wood-delivered.png). |
| EXP-15 | Expansion, source stock, buildings, population, and goal survive reload/offline reload; pre-expansion saves migrate; a full warehouse reports a blocked worker. | PASS | CI verified normal and offline reload, legacy-save migration, and full-store blocked feedback: [restored](evidence/ci-44081581169/save-restored-eastern-expansion.png), [offline](evidence/ci-44081581169/offline-reload-eastern-expansion.png), [legacy](evidence/ci-44081581169/legacy-save-migrated.png), [full warehouse](evidence/ci-44081581169/full-warehouse-blocked-through-ui.png). |

## Automated verification

| Check | Result |
|---|---|
| `npm run typecheck -w @avanpost/gameplay-prototype` | PASS |
| `npm run typecheck:e2e -w @avanpost/gameplay-prototype` | PASS |
| `npm run test:gameplay-prototype` | PASS — 14 tests |
| `npm run build -w @avanpost/gameplay-prototype` | PASS — existing large Phaser bundle warning |
| `npm run check:pwa -w @avanpost/gameplay-prototype` | PASS — manifest, icons, Service Worker, and game assets |
| `git diff --check` | PASS — only Git’s LF/CRLF conversion warnings |
| Production Chromium workflow [44081581169](https://github.com/labiozzza/avanpost/actions/runs/44081581169) | PASS — all steps; 4 browser tests passed; selected CI screenshots reviewed and retained above |

Earlier CI runs exposed brittle test assumptions and a real overlapping-resident placement race. Plot taps now take priority while placement mode is active. The final production Chromium run passed all four browser tests, including the dedicated overlap regression, full expansion/offline-reload flow, and legacy/full-store scenario. The time-sensitive forest-stock snapshot was removed from the browser assertion; deterministic depletion remains covered by simulation tests. No independent QA agent was used.

## Owner verification still required

- Owner review of the retained CI evidence screenshots and hands-on playthrough.
- Follow the [player walkthrough](PLAY_NOW.md), play the 5–10 minute loop, and judge whether the expansion cadence and clearing feel engaging.
- Test on a physical iPhone and verify LAN/PWA installation/offline access there; neither is claimed by Chromium emulation.

The owner remains the final authority on gameplay acceptance.
