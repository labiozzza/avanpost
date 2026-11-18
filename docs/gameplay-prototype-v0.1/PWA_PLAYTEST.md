# PWA playtest record

Tested 2026-11-15 with Node 22.23.4, npm 10.9.9, Vite 8.3.4, and shared Playwright Chromium against the production preview at `http://127.0.0.1:4173/`. The desktop browser test used a real generated Service Worker and Workbox precache. It is not a physical-device test.

| ID | Result | Environment / method | Evidence |
|---|---|---|---|
| PWA-01 | PASS | Production build | `vite-plugin-pwa` emitted `manifest.webmanifest`, `sw.js`, and Workbox runtime. 29 entries, ~5.05 MiB precache. `check:pwa` passed. |
| PWA-02 | PASS | Manifest and artifact script | Russian names/description, standalone display, stable relative `id`/start/scope, colors and three real PNG install icons (192, 512, maskable 512). Apple Touch Icon and favicon files also present. |
| PWA-03 | PASS | Chromium production preview, offline | After precache and `context.setOffline(true)`, fetched all eight game images (including tree stump) successfully with HTTP 200. A single Workbox precache was present. |
| PWA-04 | PASS | Chromium production preview, offline reload | Reloaded while offline with active Service Worker; game Canvas appeared, save restored, and controller remained active. |
| PWA-05 | PASS | Chromium production preview, offline play | Assigned woodcutter, miner and builder; watched resource trips and deliveries; house completed and fourth resident appeared while offline. |
| PWA-06 | PASS | Chromium production preview, offline reload | After house completion, offline reload restored the house and all four residents from `avanpost:gameplay-prototype:v01`. Cancelled New Game and confirmed the saved world remained. |
| PWA-07 | PASS | Two sequential production builds on same origin | Installed build `pwa-update-3`, built `pwa-update-4`, saw update prompt, chose update; then exercised another update to final `local` build. Existing save and resident roles survived activation. |
| PWA-08 | PARTIAL | Chromium production preview | Browser exposed the install button path; native install prompt was not accepted or installed. iOS Add to Home Screen guidance is implemented but not checked on physical iOS. |
| PWA-09 | NOT_TESTED | Playwright desktop Chromium | Attempted viewport emulation, but the shared browser retained a 500 CSS-pixel layout viewport despite resize requests. No reliable Android/iPhone portrait/landscape or touch-device result is claimed. |
| PWA-10 | PASS | Chromium production preview, offline → online | Reconnected after offline play and applied an update; save remained present and retained existing world structure/roles. |
| PWA-11 | PASS | WSL / Vitest | `npm run test:gameplay-prototype`: 1 test file, 5 tests passed. Typecheck also passed. |
| PWA-12 | PASS | Git diff scope review | Application edits are within `apps/gameplay-prototype`, lockfile dependency resolution, and prototype docs. No Peace V2 source, database, or server files changed. |

Screenshot: [offline production game](pwa-offline.png). It shows browser-rendered offline gameplay, not an installed standalone window.

## v0.7 PWA regression

Checked 2026-11-18 against the v0.7 prototype source. This supplements the 2026-11-15 browser run above; it does not claim physical-device acceptance.

| ID | Result | Environment / method | Evidence |
|---|---|---|---|
| PWA-v07-01 | PASS | Root production build and `npm run check:pwa -w @avanpost/gameplay-prototype` | Manifest includes standalone display, `orientation: any`, and the production HTML includes Apple's standalone meta tag. All ten prototype-scoped Peace V2 image files and the three Eastern Fringe SVG layers are present in `dist/` and named in the generated Service Worker precache. Build generated 34 precache entries (about 6.0 MiB). |
| PWA-v07-02 | PASS | Subpath production build with `GAMEPLAY_BASE=/settlement/`, followed by the same artifact check | The manifest, icons, game assets, and Service Worker passed artifact checks with the subpath base configured. Runtime testing behind an actual `/settlement/` host prefix was not performed. |
| PWA-v07-03 | PASS | Production preview at `http://127.0.0.1:4181/`, Chromium Service Worker/offline run | Loaded the production page until its Service Worker controlled the page, then disconnected the browser context, reloaded offline, confirmed the Phaser canvas remained visible, and fetched all 13 game art files from the offline cache with HTTP 200. One Workbox precache was present and no page errors were reported. |

Both builds reported Vite's existing large Phaser bundle warning (about 1.28 MB minified); the PWA build and asset checks passed. The offline browser run covers the Eastern Fringe SVG files present in the source tree; it does not certify generated raster sprites or a physical-device installation.

## Manual device checklist

1. Install from HTTPS on Android Chrome and open the standalone app.
2. On Safari iPhone/iPad use **Share → Add to Home Screen**, then separately verify offline launch; do not assume Safari-tab storage is shared.
3. Check portrait and landscape, safe-area inset behavior, canvas touch input, panel scrolling, and orientation-change save recovery.
4. Start with a populated save, update from a second static build, choose **Позже**, then **Обновить**; verify the world after restart. The acceptance run verified **Обновить**; physical-device update UX remains for manual confirmation.
