# World & camera playtest — Gameplay Prototype v0.4

Date: 2026-11-16  
Branch: `feat/gameplay-prototype-v0.1`  
Base checked before changes: `66fc894eaa44e6e1fd35d24dd4d981d7c02ba107`

## Acceptance record

| ID | Result | Evidence / limitation |
|---|---|---|
| WORLD-01 | PASS (runner + screenshot review) | Production Chromium sampled worker/house/store/tree alpha bounds against configured display heights; visible resident/house ratio is constrained to 45–60%. Five viewport screenshots were reviewed. |
| WORLD-02 | PASS (screenshot review) | Residents and buildings visually meet the settlement ground/path plane in the five initial viewport captures and completed-house capture. |
| WORLD-03 | PASS (screenshot review) | Ground patches and connected curved paths render in the production screenshots; no blank terrain or missing paths observed. |
| WORLD-04 | PASS (Chromium gestures) | Automated drag assertions moved camera up, down, left, right, and diagonally; before/after and direction screenshots are in the run artifact. |
| WORLD-05 | PASS (screenshot review) | Production world captures show multiple terrain/depth rows beyond the initial settlement. |
| WORLD-06 | PASS (Chromium gestures) | Two-finger touch emulation zoomed in and out; browser tests verified camera movement on both axes. This is browser emulation, not physical-device validation. |
| WORLD-07 | PASS (screenshot review) | Worker, warehouse, trees/resources, roads, and completed house were visible together; the completed-house capture shows a fourth resident without major sprite overlap. |
| WORLD-08 | PASS (unit + browser gameplay) | Runner completed resource collection, delivery to the house site, construction, and population growth from 3/3 to 4/4; gameplay unit suite passed 7/7. |
| WORLD-09 | PASS (Chromium interaction) | Resident list/selection panels opened, remained visible while dragging on the world, closed with the close control, and mobile panel height/scroll behavior was exercised. |
| WORLD-10 | PASS (automated parsing) | Added a migration test for a legacy one-row save; preserves storage key and plot IDs and assigns new map coordinates. |
| WORLD-11 | PASS (production Chromium offline reload) | Service Worker activated and controlled the page; with the browser context set offline, production PWA reloaded and restored the four-resident settlement. See `offline-reload.png`. |
| WORLD-12 | PARTIAL (host + runner only) | GitHub runner preview returned HTTP 200; local Windows preview also returned HTTP 200 on `127.0.0.1:4176`. External LAN and physical iPhone access remain NOT VERIFIED. |

## Checks run

- `npm run typecheck` — PASS (all workspaces).
- `npm run test:gameplay-prototype` — PASS (7 tests).
- `npm run build` in `apps/gameplay-prototype` — PASS (large Phaser bundle warning remains).
- `npm run check:pwa` — PASS (manifest, icons, Service Worker, game assets).
- Root `npm test` — FAIL / BLOCKED: three server suites could not connect to PostgreSQL; other discovered suites passed (169 tests). No database was intentionally started or modified.
- GitHub Actions Chromium browser playtest for five requested viewport sizes, camera gestures, gameplay progression, save restoration and offline Service Worker reload — PASS (run 43840533886 below).
- Physical iPhone and external LAN access — NOT VERIFIED. Chromium device emulation is not a physical-device test.

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

## Owner's physical-device playtest still required

1. Open the LAN URL on a phone after inbound Firewall access is available.
2. On a trusted HTTPS origin, install the PWA, play, reload, then repeat with the phone offline.
3. Confirm touch camera/pinch behavior and continue settlement growth manually. Do not treat Chromium emulation as physical iPhone acceptance.

## Earlier local-browser follow-up (historical)

Date: 2026-11-16

- Checkout remains on `feat/gameplay-prototype-v0.1`, HEAD `025f986d51fc9999e3f0bc75697386c010d2fd0a`; the two pre-existing untracked paths were left untouched.
- Re-ran the affected-app typecheck, gameplay suite (7/7), production build, and PWA artifact check: all pass. The server suites/PostgreSQL were not run.
- The production HTTP server is a Windows `python.exe`, not WSL; intended bind is `0.0.0.0:4176`. Ethernet remains `192.168.0.107/24` with Private network category. The host firewall profile is enabled and defaults inbound to Block.
- Attempted the explicitly scoped Private/LocalSubnet/TCP-4176 firewall rule through the standard Windows elevation flow. No rule was created; a normal non-elevated attempt returns Access Denied. No firewall profile was disabled and no portproxy was added.
- Browser alternatives were checked: `@playwright/test` 1.64.1, Chrome/Edge, and Playwright Chromium 1248/1254 plus headless-shell binaries are installed. Existing Chrome/Edge processes have no remote-debugging port. The shared Playwright endpoint again returned `ECONNREFUSED 127.0.0.1:9222`; in-app browser tab-open/navigation had previously timed out, leaving only `about:blank`. This runtime does not permit launching another browser process, so local `chromium.launch()` could not be attempted. No screenshot or gameplay interaction completed. Visual criteria remain NOT VERIFIED; no user browser/tab was repurposed.
- Preview diagnosis found the previous Anaconda Python server (PID 53260) accepted TCP but stalled HTTP GETs with zero bytes. That task-owned process was stopped and the production directory was served with Windows Python 3.10 (PID 35872). Verified HTTP 200 from both `127.0.0.1:4176` and the host's Ethernet address `192.168.0.107:4176`; listener is `0.0.0.0:4176`. No second server was left on the port.
- A persistent PowerShell window (PID 54012) remains open as requested. The scoped Private/LocalSubnet firewall rule is absent: normal creation is Access Denied and the UAC-launched attempt produced no result/rule. No Firewall profile was disabled and no portproxy was added. An HTTP 200 to the host's own LAN address does not prove access from another device; physical iPhone and external LAN access remain NOT VERIFIED.

## GitHub Actions browser playtest (current)

- The independent Ubuntu runner executes on pushes/PRs affecting the prototype and supports manual dispatch. It installs Node 22, `npm ci`, Playwright Chromium with system dependencies, typechecks, runs gameplay tests, builds/checks the production PWA, starts its preview, verifies HTTP 200, then runs Chromium.
- Successful run: [43840533886](https://github.com/labiozzza/avanpost/actions/runs/43840533886), commit `51ab67e7c5bcd1d1221755464d92d733e9c1912b`. App/E2E typechecks, unit tests (7/7), production build, PWA check, runner preview HTTP 200, and both Playwright tests passed.
- Artifact: [`gameplay-prototype-playtest-43840533886`](https://github.com/labiozzza/avanpost/actions/runs/43840533886#artifacts) (30-day retention). It contains five initial viewport screenshots, camera-before/after/directional/pinch screenshots, gameplay/save/offline screenshots, and the HTML report and preview log. Traces are retained and uploaded when a test fails; this successful run has no failure trace.
- Inspected runner captures include mobile portrait, desktop, completed house/four residents, restored save, and offline reload. No page or browser-console errors were reported.
- The E2E test clears localStorage only on the initial document; subsequent normal/offline reloads preserve the save. The production world rendered from that restored save.
- The local Windows production preview remains served from `apps/gameplay-prototype/dist` on port 4176 and returned HTTP 200 after the runner completed. Physical iPhone and external LAN access remain NOT VERIFIED.
