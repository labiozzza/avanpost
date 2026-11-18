# Notifications & multitouch regression playtest — v0.6.3

- Date: 2026-11-18
- Branch: `feat/gameplay-prototype-v0.1`
- Code/test commit: `a641547530f0827094c27c1e53d3b4383be52b75`
- Production Chromium workflow: [44245874106](https://github.com/labiozzza/avanpost/actions/runs/44245874106) — **PASS**
- Evidence directory: [`evidence/ci-44245874106/`](evidence/ci-44245874106/)

## Scope and method

This slice keeps notifications to one bounded slot: newer information replaces stale information, action errors are not dismissed by subsequent informational events, and errors receive a longer display interval. When no context card is open, a floating notice is placed in measured free space around the HUD, placement controls, action dock, wayfinder, and install/update banners. When a card is open, the active notice moves into the card's inline status area. Notices are non-interactive so a drag that begins over a floating notice can still reach the world canvas.

The camera regression coverage exercises pan, pinch in/out, a repeated pinch, and a fresh pan after a complete pinch. Controller unit tests cover pinch-to-pan rebasing and cancellation. The CDP `Input.dispatchTouchEvent` protocol requires `touchEnd` and `touchCancel` events to have an empty `touchPoints` array; it cannot identify one finger to release while another remains. The surviving-finger transition is therefore not presented as a native Chromium result.

The production GitHub Actions workflow builds the PWA, runs typechecks and gameplay unit tests, serves the production build, runs the Playwright/Chromium suite, and uploads screenshots and logs. Touch and viewport emulation are not physical-device tests. The save key remains `avanpost:gameplay-prototype:v01`; this slice does not intentionally reset or migrate the owner's save.

An intermediate attempt to disable Phaser touch capture ([run 44244667771](https://github.com/labiozzza/avanpost/actions/runs/44244667771)) caused compatibility mouse events to duplicate touch activation and failed two existing gameplay scenarios. The setting was reverted; the final candidate retains Phaser's default capture behavior. The browser scenario also avoids synthesizing a native `touchCancel` that triggers Phaser's non-cancelable-event console diagnostic; cancellation remains covered at the gesture-controller unit level.

The NOTIFY/CAM/REG identifiers below are the observable checks recorded for this slice; no separate canonical v0.6.3 checklist was present in the checkout.

Before evidence shows the earlier notification overlaying the lower part of an open card: [historical context-card overlap](evidence/ci-44151956666/hud-wayfinder-context-card-390x844.png). The corresponding after capture is [the eastern-sector card with an inline notice](evidence/ci-44245874106/notification-eastern-sector-inline-390x844.png). I reviewed the current-run screenshots at all five target viewport sizes; notices remain legible and clear of the primary controls.

## Acceptance results

| ID | Observable check | Result | Evidence |
|---|---|---|---|
| NOTIFY-01 | A newer informational notice replaces stale information without a backlog. | **PASS** | Queue unit test and production UI replacement scenario; [replacement capture](evidence/ci-44245874106/notification-replaced-sequential-390x844.png). |
| NOTIFY-02 | An action error outranks an informational event and stays visible longer; an error raised through a stale/disabled-action guard is shown inline. | **PASS** | Queue unit tests and production UI scenario; [insufficient-resources notice](evidence/ci-44245874106/notification-insufficient-resources-390x844.png). |
| NOTIFY-03 | Floating notices stay within the viewport and avoid visible HUD, dock, and placement-banner bounds at the five required viewport sizes; the update banner is also checked during orientation reflow. | **PASS** | Five viewport geometry checks passed. Reviewed [375×667](evidence/ci-44245874106/notification-floating-iphone-se.png), [390×844](evidence/ci-44245874106/notification-floating-modern-iphone.png), [667×375](evidence/ci-44245874106/notification-floating-iphone-se-landscape.png), [844×390](evidence/ci-44245874106/notification-floating-smartphone-landscape.png), and [1440×900](evidence/ci-44245874106/notification-floating-desktop.png). The wayfinder and iOS install prompt are not forced concurrently in this scenario. |
| NOTIFY-04 | Notices move into resident/build/world cards without covering the card detail or actionable controls, and an active notice returns to the floating lane when the card closes. | **PASS** | Resident, build, and eastern-sector UI scenarios and rectangle assertions passed; [resident](evidence/ci-44245874106/notification-resident-inline-390x844.png), [build](evidence/ci-44245874106/notification-build-inline-390x844.png), [eastern sector](evidence/ci-44245874106/notification-eastern-sector-inline-390x844.png). |
| NOTIFY-05 | Notices expire and clear rather than remaining stale in either display location. | **PASS** | Queue timer tests and UI expiry scenario passed; [cleared-notice capture](evidence/ci-44245874106/notification-cleared-390x844.png). |
| NOTIFY-06 | A drag beginning on a floating notice still pans the world; the notice does not intercept the gesture. | **PASS** | Mobile drag regression and camera-state assertion passed; [floating notice during action](evidence/ci-44245874106/notification-floating-action-390x844.png). |
| CAM-01 | Browser-emulated one-finger pan and pinch zoom continue to work, including a repeated pinch and a fresh pan after a complete pinch. | **PASS** | Production camera scenario and gesture unit tests passed; [zoom in](evidence/ci-44245874106/camera-zoom-in.png), [zoom out](evidence/ci-44245874106/camera-zoom-out.png), [touch pan](evidence/ci-44245874106/camera-touch-up-modern-iphone.png). |
| CAM-09 | Lifting one finger from an active pinch rebases the remaining finger into a smooth one-finger pan. | **PARTIAL** | `CameraGestureController` unit test covers rebase and subsequent pan/pinch. The CDP production scenario cannot model an individual finger lift; a physical-device check remains necessary. |
| REG-01 | Existing gameplay progression, save restoration, PWA/offline behavior, and legacy-save migration remain unchanged. | **PASS** | Production workflow's progression, resident-on-plot, persistence/offline reload, and migration scenarios passed; [house completion](evidence/ci-44245874106/house-complete-four-residents.png), [offline reload](evidence/ci-44245874106/offline-reload-eastern-expansion.png), [legacy migration](evidence/ci-44245874106/legacy-save-migrated.png). |

## Checks

| Check | Result |
|---|---|
| `npm run typecheck -w @avanpost/gameplay-prototype` | **PASS** |
| `npm run typecheck:e2e -w @avanpost/gameplay-prototype` | **PASS** |
| `npm run test:gameplay-prototype` | **PASS** — 27 unit tests |
| `npm run build -w @avanpost/gameplay-prototype` | **PASS** — existing large Phaser bundle warning |
| `npm run check:pwa -w @avanpost/gameplay-prototype` | **PASS** |
| Production Chromium workflow [44245874106](https://github.com/labiozzza/avanpost/actions/runs/44245874106) | **PASS** — all 8 browser scenarios passed; complete workflow succeeded in 12m17s |
| Local production preview `http://127.0.0.1:4176/` | **PASS** — HTTP 200; serves `panel-notice` markup and bundle `index-DAUsHJf5.js`; preview remains running |
| Physical iPhone/Android, native OS touch, and installed-PWA playtest | **NOT VERIFIED** |

No independent QA agent was used. Owner hands-on acceptance is still required; automated checks do not constitute owner acceptance.

## Owner spot-check

1. Open the running production preview at `http://127.0.0.1:4176/`.
2. Select **Строить → Дом** and confirm its floating instruction stays clear of visible controls; drag from the notice to confirm the world still pans.
3. Open **Жители**, select a resident, assign a role, and confirm the current notice sits inside the card. Close the card and confirm the active notice returns to the floating lane and then expires.
4. Open the eastern-sector controls and, when resources are insufficient, confirm its action error is visible and not immediately replaced by informational simulation messages.
5. On a physical phone, pinch to zoom and lift one finger while keeping the other down; verify the remaining finger smoothly pans. This specific CAM-09 step was not verified on hardware during this run.

For the full settlement-growth walkthrough, see [`PLAYTEST.md`](PLAYTEST.md). The owner decides final gameplay acceptance after hands-on review.
