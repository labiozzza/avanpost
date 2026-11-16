# World & camera playtest — Gameplay Prototype v0.4

Date: 2026-11-16  
Branch: `feat/gameplay-prototype-v0.1`  
Base checked before changes: `66fc894eaa44e6e1fd35d24dd4d981d7c02ba107`

## Acceptance record

| ID | Result | Evidence / limitation |
|---|---|---|
| WORLD-01 | PASS (asset geometry) | Unified `OBJECT_SIZE` in `src/scene.ts`: worker display height 57; worker alpha bounds are 178/224 (~45 visible units). House alpha height is 129/256 at display height 184 (~93 visible units), so visible resident/house ratio is about 49%. Store and tree use the same shared sizing configuration. Not visually browser-verified in this run. |
| WORLD-02 | NOT VERIFIED | Object anchors and 2D resident positions use ground contact points; visual contact needs browser playtest. |
| WORLD-03 | NOT VERIFIED | `drawTerrain()` draws an irregular continuous ground shape, separate grass patches, and connected paths. Rendering/screen evidence unavailable. |
| WORLD-04 | NOT VERIFIED | Single-pointer drag updates both camera scroll axes. Shared browser was unavailable. |
| WORLD-05 | NOT VERIFIED | World and plot coordinates now span multiple depth rows; visual coverage needs playtest. |
| WORLD-06 | NOT VERIFIED | Camera clamps X/Y and pinch preserves its world-space anchor in code. Gesture verification unavailable. |
| WORLD-07 | NOT VERIFIED | Resident/building/resource visuals use Y-based depth values and contact shadows; visual overlap needs playtest. |
| WORLD-08 | PASS (automated simulation) | Prototype unit suite passes, including harvest/delivery, staged house construction, new resident, warehouse capacity, and 2D route movement. |
| WORLD-09 | PARTIAL | Outside-panel close now waits for pointer-up and rejects drags; panel scroll uses existing `overflow-y: auto`. Browser interaction was not verified. |
| WORLD-10 | PASS (automated parsing) | Added a migration test for a legacy one-row save; preserves storage key and plot IDs and assigns new map coordinates. |
| WORLD-11 | PARTIAL | Production build and PWA artifact check pass. Offline browser smoke was not run. |
| WORLD-12 | PASS (Windows host only) | Preview responds HTTP 200 from `192.168.0.107:4176`; listener is `0.0.0.0:4176`. Physical iPhone access is NOT VERIFIED. Private Windows Firewall is enabled with inbound default `Block`. |

## Checks run

- `npm run typecheck` — PASS (all workspaces).
- `npm run test:gameplay-prototype` — PASS (7 tests).
- `npm run build` in `apps/gameplay-prototype` — PASS (large Phaser bundle warning remains).
- `npm run check:pwa` — PASS (manifest, icons, Service Worker, game assets).
- Root `npm test` — FAIL / BLOCKED: three server suites could not connect to PostgreSQL; other discovered suites passed (169 tests). No database was intentionally started or modified.
- Browser playtest and screenshots for the requested viewport sizes — NOT VERIFIED. Shared Playwright CDP initialization returned `ECONNREFUSED 127.0.0.1:9222`; no separate browser was launched.
- Physical iPhone and offline Service Worker smoke — NOT VERIFIED.

## LAN preview

From the repository root, build and serve the production output:

```powershell
npm run build --workspace @avanpost/gameplay-prototype
python -m http.server 4176 --bind 0.0.0.0 --directory E:\Avanpost-mvp-slice\apps\gameplay-prototype\dist
```

The preview URL is `http://192.168.0.107:4176/`. A one-line Windows host check:

```powershell
(Invoke-WebRequest http://192.168.0.107:4176/ -UseBasicParsing).StatusCode
```

The preview process listens on all Windows interfaces; no WSL portproxy is used. The Windows Private profile currently blocks inbound traffic by default. If the owner chooses to allow this port, run the following one-line command in an elevated PowerShell; it was **not** run:

```powershell
New-NetFirewallRule -DisplayName "AVANPOST gameplay preview 4176" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 4176 -Profile Private
```

Remove only that rule later, if desired:

```powershell
Remove-NetFirewallRule -DisplayName "AVANPOST gameplay preview 4176"
```

Plain HTTP may let Safari load the page after LAN/firewall access is allowed, but it is not a secure context for Service Worker/PWA installation on iPhone. Use HTTPS on a trusted local hostname/certificate for phone PWA/offline verification.

## Manual playtest still required

1. Open the LAN URL on a phone after the owner resolves inbound Firewall access.
2. Drag the terrain in all four directions and diagonally; pinch in/out and verify the map stays bounded.
3. Select a resident, assign woodcutter/miner/builder, and watch a delivery and construction complete.
4. Reload and confirm the settlement returns; on a trusted HTTPS origin, repeat offline after the Service Worker is ready.
5. Capture the requested five viewport sizes and the gameplay states listed in the task. Do not treat desktop emulation as a physical iPhone test.
