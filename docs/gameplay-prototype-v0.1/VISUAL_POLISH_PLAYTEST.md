# Visual polish & regression playtest — v0.6.2

- Date: 2026-11-18
- Branch: `feat/gameplay-prototype-v0.1`
- Reviewed code/test SHA: `a4ae643c32f6a036c7cd9f5e60adad8952610ed7`
- Production Chromium workflow: [44151956666](https://github.com/labiozzza/avanpost/actions/runs/44151956666) — **SUCCESS**
- Evidence: [`evidence/ci-44151956666/`](evidence/ci-44151956666/)

## Scope and method

This slice removes the visible panorama join and prevents the eastern-forest wayfinder from covering HUD or action controls. The panorama is rendered once, centered with uniform scale and cropped vertically as needed; it is not horizontally tiled. The wayfinder is placed in the top HUD grid. Simulation, economy, construction rules, forest behavior, camera/zoom mechanics, PWA behavior, and the save key `avanpost:gameplay-prototype:v01` were not changed for this visual-polish slice.

There is no separate canonical BG-01…06, HUD-01…09, or REG-01…12 checklist in the repository. The IDs below are mapped here to the observable production-browser assertions and visual checks in `apps/gameplay-prototype/e2e/world-camera.spec.ts`; alignment with any external checklist is **NOT VERIFIED**.

The GitHub Actions workflow built the production PWA, served its production preview, ran all four Playwright/Chromium scenarios, and uploaded screenshots, traces, report, and logs. The retained images are production-preview captures. Chromium viewport/touch emulation is not a physical-iPhone test.

## Background checks

| ID | Observable check | Result | Evidence |
|---|---|---|---|
| BG-01 | The scene renders exactly one panorama instance; no horizontal tiling is used. | **PASS** | Geometry assertion in `expectPanoramaCoversWorld`; [current forest camera](evidence/ci-44151956666/background-former-seam-after-show.png). |
| BG-02 | Panorama remains centered on the world and preserves its source aspect ratio under scaling/cropping. | **PASS** | Center and aspect-ratio assertions; [maximum zoom](evidence/ci-44151956666/background-maximum-zoom.png). |
| BG-03 | Panorama coverage extends beyond both horizontal world edges, avoiding uncovered background while the camera is clamped. | **PASS** | Coverage and camera-bound assertions; [eastern edge](evidence/ci-44151956666/background-eastern-world-edge.png), [minimum zoom](evidence/ci-44151956666/background-minimum-zoom.png). |
| BG-04 | Panorama covers the top of the world view and its lower crop is anchored to the ground line. | **PASS** | `visibleTop`/`visibleBottom` geometry assertions; [current forest camera](evidence/ci-44151956666/background-former-seam-after-show.png). |
| BG-05 | Coverage remains valid at camera extremes and across responsive viewport/orientation changes. | **PASS** | Production Chromium checks at camera edges and zoom limits; [minimum zoom](evidence/ci-44151956666/background-minimum-zoom.png), [maximum zoom](evidence/ci-44151956666/background-maximum-zoom.png), [post-orientation forest view](evidence/ci-44151956666/eastern-forest-camera-after-orientation.png). |
| BG-06 | The previously visible rectangular join is absent in the matched eastern-forest view after navigation. | **PASS** | Visual comparison: historical [before](evidence/ci-44095769659/eastern-forest-camera-after-show.png) versus current [after](evidence/ci-44151956666/background-former-seam-after-show.png). The historical capture is a visual reference, not a pixel-identical replay. |

## HUD checks

| ID | Observable check | Result | Evidence |
|---|---|---|---|
| HUD-01 | Resource indicators and current-goal text are visible and legible. | **PASS** | [390×844 HUD](evidence/ci-44151956666/hud-wayfinder-and-goal-390x844.png). |
| HUD-02 | Goal text fits without clipping and does not overlap resource indicators. | **PASS** | Bounding-box and scroll-size assertions; [390×844 HUD](evidence/ci-44151956666/hud-wayfinder-and-goal-390x844.png). |
| HUD-03 | Resource indicators and goal do not overlap the menu control. | **PASS** | DOM geometry assertions; [390×844 HUD](evidence/ci-44151956666/hud-wayfinder-and-goal-390x844.png). |
| HUD-04 | The visible wayfinder includes its action button, with a minimum 44×44 px target. | **PASS** | Button-size assertion; [wayfinder and goal](evidence/ci-44151956666/hud-wayfinder-and-goal-390x844.png). |
| HUD-05 | The wayfinder remains inside viewport bounds and avoids the resources and current goal. | **PASS** | Bounding-box assertions; [390×844 HUD](evidence/ci-44151956666/hud-wayfinder-and-goal-390x844.png). |
| HUD-06 | The wayfinder does not cover the menu control. | **PASS** | DOM geometry assertion; [wayfinder with context card](evidence/ci-44151956666/hud-wayfinder-context-card-390x844.png). |
| HUD-07 | The wayfinder does not overlap placement controls or the bottom action dock. | **PASS** | DOM geometry assertions; portrait [wayfinder](evidence/ci-44151956666/hud-wayfinder-and-goal-390x844.png) and [landscape wayfinder](evidence/ci-44151956666/hud-wayfinder-landscape-844x390.png). |
| HUD-08 | The wayfinder does not cover actionable controls in an open context card or build menu. | **PASS** | Panel-action rectangle assertions; [context card](evidence/ci-44151956666/hud-wayfinder-context-card-390x844.png), [build menu](evidence/ci-44151956666/hud-wayfinder-build-menu-390x844.png). |
| HUD-09 | HUD layout remains in bounds at portrait, landscape, and after an orientation change/reload. | **PASS** | Assertions and captures at [375×667](evidence/ci-44151956666/hud-wayfinder-iphone-se-375x667.png), [844×390](evidence/ci-44151956666/hud-wayfinder-landscape-844x390.png), and [after orientation change](evidence/ci-44151956666/hud-wayfinder-after-orientation-change.png). |

## Regression checks

| ID | Regression check | Result | Evidence |
|---|---|---|---|
| REG-01 | A fresh world starts with three residents and the expected HUD in responsive scenes. | **PASS** | Assertions across five viewport sizes; [mobile start](evidence/ci-44151956666/start-iphone-se.png). |
| REG-02 | Scene assets load and the exercised responsive scenes produce no page or console errors. | **PASS** | Production Chromium asset/error assertions across the viewport suite. |
| REG-03 | Horizontal, vertical, and diagonal camera gestures and “К поселению” continue to work. | **PASS** | [Left](evidence/ci-44151956666/camera-touch-left.png), [right](evidence/ci-44151956666/camera-touch-right.png), [diagonal](evidence/ci-44151956666/camera-touch-diagonal.png), [settlement focus](evidence/ci-44151956666/camera-touch-return-settlement.png). |
| REG-04 | Pinch zoom in/out and world-bound clamping continue to work. | **PASS** | [Zoom in](evidence/ci-44151956666/camera-zoom-in.png), [zoom out](evidence/ci-44151956666/camera-zoom-out.png); min/max panorama captures above. |
| REG-05 | Selection, contextual controls, and camera interaction remain usable. | **PASS** | [Selected resident](evidence/ci-44151956666/context-selected-resident.png); selection/panel gesture assertions passed. |
| REG-06 | Scene labels remain within the safe area and avoid collisions/overlays at camera edges. | **PASS** | Automated overlap, safe-area, and obstruction assertions; [western edge](evidence/ci-44151956666/labels-western-world-edge.png), [eastern edge](evidence/ci-44151956666/labels-eastern-world-edge.png). |
| REG-07 | Residents can be assigned and collect/haul resources through the normal simulation. | **PASS** | Main progression browser scenario; [worker en route](evidence/ci-44151956666/eastern-clearing-worker-en-route.png), [wood in transit](evidence/ci-44151956666/eastern-forest-wood-in-transit.png), [delivered](evidence/ci-44151956666/eastern-forest-wood-delivered.png). |
| REG-08 | Completing the first house visibly increases population to four. | **PASS** | Population/building assertions; [completed house and four residents](evidence/ci-44151956666/house-complete-four-residents.png). |
| REG-09 | A second warehouse follows the ordinary construction loop and increases storage capacity. | **PASS** | Browser progression and capacity assertions; [second warehouse capacity](evidence/ci-44151956666/second-warehouse-capacity-increased.png). |
| REG-10 | Eastern-sector admission remains gated; opening applies the configured cost exactly without negative stock. | **PASS** | Browser assertions for prerequisites, before/after totals, and nonnegative balances; [before opening](evidence/ci-44151956666/eastern-sector-before-opening.png), [opened](evidence/ci-44151956666/eastern-sector-opened.png). |
| REG-11 | Clearing requires a worker to travel and work; reassignment pauses progress and explicit resume completes preparation. | **PASS** | Movement/progress/pause/resume assertions; [en route](evidence/ci-44151956666/eastern-clearing-worker-en-route.png), [working](evidence/ci-44151956666/eastern-clearing-in-progress.png), [prepared land](evidence/ci-44151956666/eastern-forest-wayfinder-out-of-view.png). |
| REG-12 | Prepared-forest harvesting, physical cargo delivery, warehouse completion, persistence/offline reload, legacy migration, and full-store feedback remain functional. | **PASS** | [Harvesting](evidence/ci-44151956666/eastern-forest-woodcutter-harvesting.png), [completed eastern warehouse](evidence/ci-44151956666/eastern-warehouse-complete.png), [restored save](evidence/ci-44151956666/save-restored-eastern-expansion.png), [offline reload](evidence/ci-44151956666/offline-reload-eastern-expansion.png), [legacy save](evidence/ci-44151956666/legacy-save-migrated.png), [full warehouse feedback](evidence/ci-44151956666/full-warehouse-blocked-through-ui.png). |

## Automation and limitations

| Check | Result |
|---|---|
| `npm run typecheck -w @avanpost/gameplay-prototype` | **PASS** |
| `npm run typecheck:e2e -w @avanpost/gameplay-prototype` | **PASS** |
| `npm run test:gameplay-prototype` | **PASS** — 21 unit tests |
| `npm run build -w @avanpost/gameplay-prototype` | **PASS** — existing large Phaser bundle warning |
| `npm run check:pwa -w @avanpost/gameplay-prototype` | **PASS** |
| Production Chromium workflow [44151956666](https://github.com/labiozzza/avanpost/actions/runs/44151956666) | **PASS** — all workflow steps, including four browser tests and evidence upload |
| Visual seam comparison | **PASS** — historical seam is visible before; no join is visible in the current matched production capture |
| CAM-09: surviving finger after lifting one finger from an active pinch | **PARTIAL** — a fresh pan after a complete touch-end is exercised; CDP coverage does not verify the surviving-finger transition |
| Physical iPhone / physical-device interaction | **NOT VERIFIED** — Chromium emulation only |

No independent QA agent was used. The owner must still review the evidence and perform the hands-on playtest; automated results do not constitute owner acceptance.
