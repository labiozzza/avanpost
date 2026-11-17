# World & camera playtest — Gameplay Prototype v0.4

Date: 2026-11-16  
Branch: `feat/gameplay-prototype-v0.1`  
Base checked before changes: `66fc894eaa44e6e1fd35d24dd4d981d7c02ba107`

## Acceptance record

| ID | Result | Evidence / limitation |
|---|---|---|
| WORLD-01 | PASS (reference restore + screenshot) | `scene.ts` is restored from `66fc894`; the production screenshot shows the original resident/building/tree/stone sizing. No object sizes were changed in this rollback. |
| WORLD-02 | PASS (screenshot review) | Residents and buildings meet the single horizontal ground line as in the restored side-view scene. |
| WORLD-03 | PASS (screenshot review) | The original panorama sky, distant hills and horizontal ground are visible in the production capture. |
| WORLD-04 | PASS (Chromium gestures) | Horizontal pan left/right and diagonal pointer gestures passed on the side-view world; vertical camera travel is not part of this restored architecture. |
| WORLD-05 | NOT APPLICABLE | Multi-depth terrain rows belonged to the rejected top-down map; restored side-view uses one horizontal ground plane. |
| WORLD-06 | PASS (Chromium gestures) | Touch-emulated pinch zoom in/out passed. This is browser emulation, not physical-device validation. |
| WORLD-07 | PASS (screenshot review) | Restored production capture visibly contains the panorama, residents, warehouse, tree, stone and ground. |
| WORLD-08 | PASS (unit + browser gameplay) | Production browser completed resource collection/delivery, house construction and growth from 3/3 to 4/4; gameplay unit suite passed 6/6. |
| WORLD-09 | PASS (Chromium interaction) | Resident list/selection panels opened, stayed open during a world drag, closed by the close control, and mobile panel scrolling was exercised. |
| WORLD-10 | PASS (save compatibility test) | `mapVersion: 2` saves are projected onto the side-view coordinates while preserving residents, roles, resources, buildings, sites, progress and occupied plot IDs; storage key remains unchanged. |
| WORLD-11 | PASS (production Chromium offline reload) | Service Worker activated and controlled the page; offline production reload restored the four-resident settlement. See `offline-reload.png`. |
| WORLD-12 | PARTIAL (host + runner only) | GitHub runner preview returned HTTP 200; local Windows preview also returned HTTP 200 on `127.0.0.1:4176`. External LAN and physical iPhone access remain NOT VERIFIED. |

## Checks run

- `npm run typecheck` — PASS (all workspaces).
- `npm run test:gameplay-prototype` — PASS (6 tests, including compatibility migration).
- `npm run build` in `apps/gameplay-prototype` — PASS (large Phaser bundle warning remains).
- `npm run check:pwa` — PASS (manifest, icons, Service Worker, game assets).
- Root `npm test` — FAIL / BLOCKED: three server suites could not connect to PostgreSQL; other discovered suites passed (169 tests). No database was intentionally started or modified.
- GitHub Actions Chromium browser playtest for five viewport sizes, side-view gestures, gameplay progression, save restoration and offline Service Worker reload — PASS (rollback run 43902342627 below).
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
3. Confirm horizontal touch pan/pinch behavior and continue settlement growth manually. Do not treat Chromium emulation as physical iPhone acceptance.

## Earlier local-browser follow-up (historical)

Date: 2026-11-16

- Checkout remains on `feat/gameplay-prototype-v0.1`, HEAD `025f986d51fc9999e3f0bc75697386c010d2fd0a`; the two pre-existing untracked paths were left untouched.
- Re-ran the affected-app typecheck, gameplay suite (7/7), production build, and PWA artifact check: all pass. The server suites/PostgreSQL were not run.
- The production HTTP server is a Windows `python.exe`, not WSL; intended bind is `0.0.0.0:4176`. Ethernet remains `192.168.0.107/24` with Private network category. The host firewall profile is enabled and defaults inbound to Block.
- Attempted the explicitly scoped Private/LocalSubnet/TCP-4176 firewall rule through the standard Windows elevation flow. No rule was created; a normal non-elevated attempt returns Access Denied. No firewall profile was disabled and no portproxy was added.
- Browser alternatives were checked: `@playwright/test` 1.64.1, Chrome/Edge, and Playwright Chromium 1248/1254 plus headless-shell binaries are installed. Existing Chrome/Edge processes have no remote-debugging port. The shared Playwright endpoint again returned `ECONNREFUSED 127.0.0.1:9222`; in-app browser tab-open/navigation had previously timed out, leaving only `about:blank`. This runtime does not permit launching another browser process, so local `chromium.launch()` could not be attempted. No screenshot or gameplay interaction completed. Visual criteria remain NOT VERIFIED; no user browser/tab was repurposed.
- Preview diagnosis found the previous Anaconda Python server (PID 53260) accepted TCP but stalled HTTP GETs with zero bytes. That task-owned process was stopped and the production directory was served with Windows Python 3.10 (PID 35872). Verified HTTP 200 from both `127.0.0.1:4176` and the host's Ethernet address `192.168.0.107:4176`; listener is `0.0.0.0:4176`. No second server was left on the port.
- A persistent PowerShell window (PID 54012) remains open as requested. The scoped Private/LocalSubnet firewall rule is absent: normal creation is Access Denied and the UAC-launched attempt produced no result/rule. No Firewall profile was disabled and no portproxy was added. An HTTP 200 to the host's own LAN address does not prove access from another device; physical iPhone and external LAN access remain NOT VERIFIED.

## Previous GitHub Actions browser playtest (before side-view rollback)

- The independent Ubuntu runner executes on pushes/PRs affecting the prototype and supports manual dispatch. It installs Node 22, `npm ci`, Playwright Chromium with system dependencies, typechecks, runs gameplay tests, builds/checks the production PWA, starts its preview, verifies HTTP 200, then runs Chromium.
- Successful run: [43840533886](https://github.com/labiozzza/avanpost/actions/runs/43840533886), commit `51ab67e7c5bcd1d1221755464d92d733e9c1912b`. App/E2E typechecks, unit tests (7/7), production build, PWA check, runner preview HTTP 200, and both Playwright tests passed.
- Artifact: [`gameplay-prototype-playtest-43840533886`](https://github.com/labiozzza/avanpost/actions/runs/43840533886#artifacts) (30-day retention). It contains five initial viewport screenshots, camera-before/after/directional/pinch screenshots, gameplay/save/offline screenshots, and the HTML report and preview log. Traces are retained and uploaded when a test fails; this successful run has no failure trace.
- Inspected runner captures include mobile portrait, desktop, completed house/four residents, restored save, and offline reload. No page or browser-console errors were reported.
- The E2E test clears localStorage only on the initial document; subsequent normal/offline reloads preserve the save. The production world rendered from that restored save.
- The local Windows production preview remains served from `apps/gameplay-prototype/dist` on port 4176 and returned HTTP 200 after the runner completed. Physical iPhone and external LAN access remain NOT VERIFIED.

## Side-view rollback verification (current)

- Restored `scene.ts`, `simulation.ts`, and baseline simulation tests from `66fc894eaa44e6e1fd35d24dd4d981d7c02ba107`. Kept the current `main.ts` panel gesture behavior so a swipe does not accidentally dismiss context menus. PWA, fullscreen mobile UI, Actions workflow and Playwright setup remain intact.
- Successful run: [43902342627](https://github.com/labiozzza/avanpost/actions/runs/43902342627) on code commit `7649d607545497b8deb0d53913424738bb3f7242`. Both Playwright scenarios passed; six gameplay unit tests, app/E2E typechecks, PWA build/check, and runner HTTP 200 passed.
- Artifact: [`gameplay-prototype-playtest-43902342627`](https://github.com/labiozzza/avanpost/actions/runs/43902342627#artifacts). The committed [production side-view screenshot](evidence/side-view-restored-actions-43902342627.png) shows the original panorama, ground, three residents, tree, stone and warehouse.
- Save compatibility is additive: existing `avanpost:gameplay-prototype:v01` data is never cleared or reset; depth-map saves are converted in memory to the side-view layout and naturally persisted by the existing save loop.
- The local production preview is rebuilt from this side-view implementation and remains at `http://127.0.0.1:4176/`. Physical iPhone/network access remains NOT VERIFIED.

## Side-view art and scale verification (2026-11-16)

- Final implementation commit: `84f9204be592709646faa1b39b2fa6eaaa7a4f5f`.
- GitHub Actions Chromium playtest: [43918525840](https://github.com/labiozzza/avanpost/actions/runs/43918525840) — SUCCESS on the final implementation commit. Both browser scenarios, app/E2E typechecks, 7/7 gameplay tests, production PWA build/check, and production preview passed.
- Art evidence in this directory was captured by that run from the production build: `art-start-375x667.png`, `art-start-390x844.png`, `art-start-844x390.png`, `art-start-1440x900.png`, `art-resident-house-proportions.png`, `art-ground-cross-section.png`, `art-house-construction-site.png`, and `art-settlement-growth-four-residents.png`. Existing before/rollback evidence remains unchanged.

| ID | Result | Evidence |
|---|---|---|
| ART-01 | PASS | Side-view composition and continuous horizontal surface: `art-start-390x844.png`. |
| ART-02 | PASS | Three visible starting residents, warehouse, tree and stone source: `art-start-390x844.png`. |
| ART-03 | PASS | Existing painted panorama fills the playable sky/background: `art-start-1440x900.png`. |
| ART-04 | PASS | Ground cutaway reads as distinct topsoil, darker root/stone layer and red lower strata: `art-ground-cross-section.png`. |
| ART-05 | PASS | Ground surface has a dedicated authored meadow tile derived from the existing panorama; provenance is recorded in `apps/gameplay-prototype/public/assets/peace-v2/ART_PROVENANCE.md`. |
| ART-06 | PASS | Existing geology artwork is reused and packed as a horizontal-repeat-friendly atlas; no programmatic flat-color replacement: `art-ground-cross-section.png`. |
| ART-07 | PASS | Alpha-bound scale contract is checked in E2E: house/resident visible-height ratio 1.8–2.3; visible house and resident side by side: `art-resident-house-proportions.png`. |
| ART-08 | PASS | Warehouse and resident proportions are included in the same viewport evidence; warehouse/resident ratio is asserted above 1.5. |
| ART-09 | PASS | Tree/resident visible-height ratio is asserted above 2.2; source and resource area are visible at `art-start-1440x900.png`. |
| ART-10 | PASS | Terrain layers extend below the settlement and are reachable by vertical camera drag: `art-ground-cross-section.png`; browser gesture and reset passed. |
| ART-11 | PASS | Layout evidence at 375×667, 390×844 and 844×390: the three `art-start-*` mobile captures; the landscape camera keeps the complete warehouse, residents and nearby resource label in frame. Desktop is 1440×900. |
| ART-12 | PASS | Completed first house visibly adds a resident and the production screenshot shows the grown settlement: `art-settlement-growth-four-residents.png`. Nearby resident labels use alternating vertical lanes to avoid collisions. |

Local final checks: app and E2E typechecks PASS; gameplay suite 7/7 PASS; production build PASS (existing large Phaser chunk warning); PWA/offline asset check PASS. The production preview still responds HTTP 200 at `http://127.0.0.1:4176/`. This evidence is browser-emulated, not physical-device owner acceptance.

## Composition and camera follow-up (2026-11-17)

- Implementation commit: `da33dfef4eb9b6fc476bd2aa135e51739956e881`.
- GitHub Actions production Chromium playtest: [run 44009252404](https://github.com/labiozzza/avanpost/actions/runs/44009252404) — **SUCCESS** on that commit. App and E2E typechecks, 7/7 gameplay unit tests, production PWA build/check, both Chromium scenarios, production preview HTTP 200, screenshots and HTML report all completed.
- Reviewed the screenshots downloaded from that production run. At 375×667 and 390×844, the warehouse facade and all three resident sprites/names fit without label collisions; the tree/resource area remains reachable by panning and is fully shown in landscape/desktop. At 844×390, the tree, forest label, warehouse and residents are in frame. The five tested viewport sizes also include 667×375 landscape.
- Phaser camera bounds now report the actual zoomed world view. The camera returns to the settlement framing after vertical travel; vertical drag exposes the underground cross-section. Resident labels are placed in non-overlapping lanes and kept within the visible frame; selecting a resident or expanding the role card does not resize the game canvas.
- The browser playthrough placed a house site, delivered resources, completed the first house and grew the settlement from 3 to 4 residents. Reload restored the save; the offline reload was served by the production Service Worker.

| ID | Result | Production evidence / limit |
|---|---|---|
| COM-01 | PASS | 375×667 start view: [screenshot](evidence/composition-start-375x667-44009252404.png). |
| COM-02 | PASS | 390×844 start view: [screenshot](evidence/composition-start-390x844-44009252404.png). |
| COM-03 | PASS | 844×390 start view: [screenshot](evidence/composition-start-844x390-44009252404.png). |
| COM-04 | PASS | 1440×900 start view: [screenshot](evidence/composition-start-1440x900-44009252404.png). |
| COM-05 | PASS | Five viewport sizes assert the requested surface position, key warehouse/resident bounds and the original asset scale ratios; visual evidence is linked above. |
| COM-06 | PASS | Automated label-overlap checks and resident-label in-frame checks pass; portrait, landscape and desktop captures were visually reviewed. |
| COM-07 | PASS (visual fixture only) | Five-resident composition: [screenshot](evidence/composition-settlement-five-visual-fixture-44009252404.png). It is derived from the actual first-house playthrough, but synthesizes the second house/fifth resident and **does not prove completion of a second house in gameplay**. |
| COM-08 | PASS | Horizontal camera pan in both directions: covered by the production Chromium scenario and its left/right captures in the run artifact. |
| COM-09 | PASS | Vertical travel into the terrain layers and return-to-settlement: [underground](evidence/composition-camera-underground-44009252404.png), [returned](evidence/composition-camera-return-44009252404.png). |
| COM-10 | PASS | Touch-emulated pinch zoom-in/out passed; [zoom-in](evidence/composition-camera-zoom-in-44009252404.png), [zoom-out](evidence/composition-camera-zoom-out-44009252404.png). This is browser emulation, not physical-device validation. |
| COM-11 | PASS | Resident selection and expanded role card preserve canvas geometry and camera zoom: [selected](evidence/composition-resident-selected-44009252404.png), [expanded](evidence/composition-resident-expanded-44009252404.png). |
| COM-12 | PASS | First-house site/completion, four-resident growth, save restoration and offline reload: [site](evidence/composition-house-site-44009252404.png), [completed house](evidence/composition-house-complete-four-44009252404.png), [four residents](evidence/composition-settlement-four-44009252404.png), [saved state](evidence/composition-save-restored-44009252404.png), [offline](evidence/composition-offline-reload-44009252404.png). |

**ID note:** no standalone COM-01…COM-12 criteria document was present in the checkout. This table records the requested coverage against the operational checks in this playtest; COM-07’s visual-fixture limitation is explicit. If these IDs refer to a separate external checklist, its exact wording still needs to be matched.

The local production preview remains available at `http://127.0.0.1:4176/` and returned HTTP 200 for the built `index-D64LHHrk.js` bundle. Physical iPhone/LAN access and owner acceptance remain **NOT VERIFIED / pending owner playtest**.
