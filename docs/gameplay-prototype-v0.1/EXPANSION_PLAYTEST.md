# Eastern frontier & mobile camera playtest

Date: 2026-11-17  
Branch: `feat/gameplay-prototype-v0.1`  
Camera-fix commit: `295df6c57127816d57533d28f725f03edcfeda3a`  
Expansion commit: `367c90fb073d2668bae91ada5d8baf9310364a6e`  
Initial GitHub Actions run: [44068658538](https://github.com/labiozzza/avanpost/actions/runs/44068658538) — **FAILED** in two Playwright assertions; build, unit checks, and PWA checks passed. The migration/full-warehouse browser scenario passed in that run. Follow-up local camera and full gameplay scenarios now pass after correcting sheet occlusion, placement framing, and the time-dependent forest-regrowth assertion. A complete Actions rerun is pending.

## Scope and evidence

This is an experimental local-simulation expansion for the prototype branch only. It does not change the accepted GDD, Peace V2, production APIs, or databases. The experimental costs/recovery rates are centralized in `apps/gameplay-prototype/src/simulation.ts`.

The checkout contains no separate source document defining the exact CAM-01…10 or EXP-01…15 wording. The IDs below map to observable checks implemented for this playtest; if they refer to a separate external checklist, exact wording alignment remains **NOT VERIFIED**.

Manual production-preview evidence: [`eastern-expansion-start-local-20261117.png`](evidence/eastern-expansion-start-local-20261117.png). It was captured from the rebuilt PWA served on `http://localhost:4176/`; the visible starting settlement was reviewed. Browser emulation is not physical-iPhone acceptance.

## Camera checks

The Playwright scenario sends Chromium touch input through CDP at 375×667, 667×375, 390×844, 844×390, and 1440×900.

| ID | Check | Result | Evidence / limitation |
|---|---|---|---|
| CAM-01 | Touch-swipe up reveals more of the underground cross-section. | PENDING | Awaiting run 44068658538. |
| CAM-02 | Touch-swipe down returns toward the surface. | PENDING | Awaiting run 44068658538. |
| CAM-03 | Swipe left pans the world right. | PENDING | Awaiting run 44068658538. |
| CAM-04 | Swipe right pans the world left. | PENDING | Awaiting run 44068658538. |
| CAM-05 | Diagonal touch pan moves both camera axes. | PENDING | Awaiting run 44068658538. |
| CAM-06 | “К поселению” restores the initial settlement framing. | PENDING | Awaiting run 44068658538. |
| CAM-07 | Pinch-out increases camera zoom. | PENDING | Awaiting run 44068658538. |
| CAM-08 | Pinch-in decreases zoom while keeping the world view clamped. | PENDING | Awaiting run 44068658538. |
| CAM-09 | A fresh single-finger pan after a pinch does not replay pinch displacement. | PENDING / PARTIAL | The test uses protocol-valid complete touch-end followed by a fresh pan. CDP’s `touchEnd` does not model lifting only one of two fingers, so the surviving-finger transition itself is not verified by this automation. |
| CAM-10 | Camera remains within world bounds; selection and control-panel gestures remain usable. | PENDING | Awaiting run 44068658538. |

## Eastern expansion checks

The main scenario begins from a new browser save and uses in-game controls/touch input for the progression. LocalStorage reads are used only for assertions and save-recovery checks.

| ID | Check | Result | Evidence / limitation |
|---|---|---|---|
| EXP-01 | The eastern boundary, forest, and sector status are visible in the continuous side-view world. | PENDING | Awaiting production Chromium screenshots. |
| EXP-02 | An eastern plot cannot be built on while the sector is closed. | PENDING | The E2E attempts the plot through placement mode. |
| EXP-03 | Opening is gated by the first house and requires 8 wood + 5 stone. | PENDING | Unit test also covers house prerequisite and atomic spending. |
| EXP-04 | Opening deducts the exact cost across stores without a negative balance. | PENDING | E2E asserts before/after totals with workers idled through the UI. |
| EXP-05 | Owning the sector does not enable building before physical preparation. | PENDING | The E2E attempts a warehouse plot while the sector is only unlocked. |
| EXP-06 | A free resident physically walks to the clearing point before work progresses. | PENDING | Unit test covers movement and zero progress before arrival. |
| EXP-07 | Clearing takes work time and shows progress/stumps. | PENDING | Unit test and production screenshot pending run 44068658538. |
| EXP-08 | Reassigning the clearer pauses the job without losing progress. | PENDING | Unit test covers pause/preserve; browser scenario reads saved progress. |
| EXP-09 | The player can explicitly resume clearing; completion prepares the plots. | PENDING | Awaiting run 44068658538. |
| EXP-10 | Prepared land exposes two build plots and a separately selectable eastern forest. | PENDING | Awaiting production Chromium screenshots. |
| EXP-11 | A warehouse on eastern land uses the ordinary site, material-delivery, and staged-build loop. | PENDING | Unit tests cover regular construction; browser scenario awaits CI. |
| EXP-12 | Eastern wood can be selected only after preparation. | PENDING | Unit test covers the precondition; browser scenario uses the forest details action. |
| EXP-13 | A worker walks to the eastern forest and consumes its physical stock when harvesting. | PENDING | Unit test covers source depletion and cargo. |
| EXP-14 | Harvested wood remains cargo until physically delivered to a warehouse. | PENDING | Browser assertion checks unchanged warehouse totals while cargo is in transit. |
| EXP-15 | Expansion, source stock, buildings, population, and goal survive reload/offline reload; pre-expansion saves migrate; a full warehouse reports a blocked worker. | PENDING | Browser migration/full-store scenario and offline PWA reload await CI. |

## Automated checks already run locally

| Check | Result |
|---|---|
| `npm run typecheck -w @avanpost/gameplay-prototype` | PASS |
| `npm run typecheck:e2e -w @avanpost/gameplay-prototype` | PASS |
| `npm run test:gameplay-prototype` | PASS — 14 tests |
| `npm run build -w @avanpost/gameplay-prototype` | PASS — existing large Phaser bundle warning |
| `npm run check:pwa -w @avanpost/gameplay-prototype` | PASS — manifest, icons, Service Worker, and game assets |
| `git diff --check` | PASS — only Git’s LF/CRLF conversion warnings |

The first local Chromium attempt failed two assertions: an invalid partial `touchEnd` in the pinch test, and a plot tap too close to the viewport edge. Both tests were corrected before commit and push. The complete run’s final result is pending above; no independent QA agent was used.

## Owner verification still required

- Review the CI evidence screenshots after the run completes.
- Manually play the 5–10 minute loop and judge whether the expansion cadence and clearing feel engaging.
- Test on a physical iPhone and verify LAN/PWA installation/offline access there; neither is claimed by Chromium emulation.

The owner remains the final authority on gameplay acceptance.
