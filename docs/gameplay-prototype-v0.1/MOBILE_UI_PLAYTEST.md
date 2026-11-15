# Gameplay Prototype v0.1 — mobile UI playtest

Tested 2026-11-15 against the production build served at `http://127.0.0.13:4176/`, using the shared Playwright Chromium browser. Mobile checks used Chromium device-metrics and touch emulation; desktop used a 1440×900 viewport. These are browser emulation results, **not** tests on a physical iPhone or Android device or an installed standalone PWA.

## Acceptance results

| ID | Result | Evidence |
|---|---|---|
| UI-01 | PASS — At 390×844, the game opens directly into the full-screen Phaser world with three visible residents. The canvas fills the viewport. | [Mobile start](mobile-ui-start.png) |
| UI-02 | PASS — The panorama fills the scene and the horizon/ground continue behind the game. No fit-to-map green bars appear. | [Mobile start](mobile-ui-start.png), [landscape](mobile-ui-landscape.png) |
| UI-03 | PASS — Resource HUD, menu and bottom action dock stay over the scene; document dimensions equal the viewport in portrait and landscape, with no page scrolling. | [Mobile start](mobile-ui-start.png), [landscape](mobile-ui-landscape.png) |
| UI-04 | PASS — Selected residents show a compact card; profession choices expand in place and collapse after assignment. Woodcutter, miner and builder assignments drove visible work, hauling and construction. | [Selected resident](mobile-ui-selected-resident.png), [professions](mobile-ui-professions.png), [completed house](mobile-ui-house-complete.png) |
| UI-05 | PASS — A one-finger drag pans the camera to the map edges; the wood source and stone source can be reached, and **К поселению** recenters the settlement. | [Camera pan](mobile-ui-pan-right.png), [landscape](mobile-ui-landscape.png) |
| UI-06 | PASS — Building mode remains active while panning. A touch on a visible plot marker created a house site; the normal simulation delivered materials, completed the house and added the fourth resident. No test fixtures or direct API calls were used. | [House placement](mobile-ui-house-placement.png), [completed house](mobile-ui-house-complete.png) |
| UI-07 | PASS — Context sheets overlay the scene without resizing the canvas. The selected resident remains visible above the sheet; close returns to the world. | [Selected resident](mobile-ui-selected-resident.png), [professions](mobile-ui-professions.png) |
| UI-08 | PASS — A short touch selects; a drag pans without selecting; two-finger pinch changed zoom from 0.78 to 1.35. Zoom is clamped to 0.58–1.35 and camera horizontal movement is bounded by the world. | [Pinch](mobile-ui-pinch.png), [camera pan](mobile-ui-pan-right.png) |
| UI-09 | PASS — Portrait 390×844 and landscape 844×390 emulation both keep the canvas and controls in the viewport without document scrolling. | [Portrait](mobile-ui-house-complete.png), [landscape](mobile-ui-landscape.png) |
| UI-10 | PASS — At 1440×900, the canvas remains the full-screen primary surface and the dock/HUD remain overlaid. | [Desktop](desktop-ui.png) |
| UI-11 | PASS — Reload restored the completed house and all four residents from `avanpost:gameplay-prototype:v01`. The storage key and save format were not changed. | Browser reload of the production preview; [completed house](mobile-ui-house-complete.png) |
| UI-12 | PASS — With the generated Service Worker active, offline reload displayed the Canvas and restored the saved completed house and four residents. `check:pwa` also passed. | Offline production-preview reload; see `PWA_PLAYTEST.md` for existing PWA evidence. |

### Environment limits

- The mobile viewport, DPR and touch input were emulated in Chromium. No physical iPhone/Android device, iOS Safari, Android Chrome, or installed PWA was available for this run.
- The production preview is local to this development environment. The owner should perform final visual and installed-PWA acceptance on their target phones.

## Owner walkthrough

1. Run `npm run dev:gameplay-prototype` from the repository root and open `http://127.0.0.1:4175/`.
2. Tap a resident, open **Профессии**, and assign a lumberjack, miner and builder.
3. Tap **Строить → Дом**, swipe to an available marker and tap it.
4. Leave the residents assigned while they collect and deliver resources and build. The completed house adds a fourth resident.
5. Use **К поселению** to return; try a second house or warehouse, then reload to confirm the settlement save.

The prototype is ready for owner hands-on review; this report does not claim owner acceptance.
