# AVANPOST Gameplay Prototype — PWA

The experimental game remains a static Phaser single-player app. There is no API, account, database, or cloud-save dependency.

## Architecture and cache

- Vite 8 builds the prototype; `vite-plugin-pwa` 2.0.0 generates a production-only Workbox Service Worker and web manifest.
- Phaser loads 15 prototype runtime media files from `apps/gameplay-prototype/public/assets/`: ten image files copied from Peace V2, the prototype stockpile-log image, a hand-authored sawmill vector, and three Eastern Fringe scene layers (`eastern-marsh-trees.svg`, `eastern-marsh-understory.svg`, and `eastern-marsh-ground.svg`). The copies leave Peace V2 source assets unchanged.
- DM Sans and Manrope are bundled locally. No runtime Google Fonts request is required.
- Workbox precaches production HTML, JS, CSS, WOFF2 fonts, icons, PNGs, and SVGs (the 6 MiB per-file limit accommodates the largest original art files). This includes the Eastern Fringe scene layers, so the complete prototype scene is available offline. Old precache versions are cleaned up on activation.
- The worker uses the built HTML as the navigation fallback. Saves remain in browser `localStorage`, under `avanpost:gameplay-prototype:v01`; the Service Worker does not cache or clear them.
- Dev mode does not register a Service Worker. On an update, the UI offers **Обновить** or **Позже**; accepting first calls the current save routine and then activates the waiting worker.

## Run and verify

From Windows PowerShell at the repository root (Node.js 22+ and npm for Windows):

```powershell
npm run dev:gameplay-prototype
```

For a production PWA build and local server, first run:

```powershell
npm run build:gameplay-prototype:production
npm run test:production-server -w @avanpost/gameplay-prototype
```

Then start the static server:

```powershell
npm run serve:gameplay-prototype:production
```

Open `http://127.0.0.1:7071/` for development. To prepare and serve the production PWA locally, use `npm run build:gameplay-prototype:production` and `npm run serve:gameplay-prototype:production`; the local production server defaults to `http://127.0.0.1:7070/`. Set `$env:GAMEPLAY_PRODUCTION_PORT = '7072'` in PowerShell first if port 7070 is occupied. For a subpath build, set `GAMEPLAY_BASE=/settlement/` before the production build; deploy the contents of `dist/` under that same path. Manifest URLs, module entry, and Phaser asset URLs are base-aware.

After the first successful online load, wait for the in-game offline-ready message before disconnecting. Then enable DevTools Network → **Offline**, reload, and verify the scene, resources, controls, and save. Reload/reopen after reconnecting and confirm there is no duplicate or reset world.

## Installation

- **Windows / Chrome / Edge:** use the browser's install icon/menu when offered. The in-game **Установить** button appears only after the browser supplies its install prompt.
- **Android:** in Chrome or another supported browser, use the in-game button when available or the browser's **Install app / Add to Home screen** menu.
- **iPhone / iPad:** in Safari, tap **Share → Add to Home Screen**. The app shows this instruction; installation is a browser/OS action, not an automatic prompt.

PWA installation and Service Workers require HTTPS on public hosts. `localhost` and `127.0.0.1` are treated as secure for local testing. iOS browser and installed-app storage may be separate; saves are not synchronized between them. Private browsing, low storage, or OS eviction may remove offline data.

## Static hosting (Nginx example)

Serve `dist/` as static files with a trusted public certificate. Redirect HTTP to HTTPS and preserve the subpath mount if one is used:

```nginx
server { listen 80; server_name game.example.org; return 301 https://$host$request_uri; }
server {
  listen 443 ssl http2;
  server_name game.example.org;
  root /srv/avanpost;
  index index.html;
  location = /manifest.webmanifest { default_type application/manifest+json; add_header Cache-Control "no-cache"; }
  location = /sw.js { add_header Cache-Control "no-cache"; }
  location ~ ^/(sw\.js|workbox-[^/]+\.js)$ { add_header Cache-Control "no-cache"; }
  location = /index.html { add_header Cache-Control "no-cache"; }
  location /assets/ { try_files $uri =404; add_header Cache-Control "public, max-age=31536000, immutable"; }
  location /icons/ { try_files $uri =404; add_header Cache-Control "public, max-age=86400"; }
  location / { try_files $uri $uri/ /index.html; }
}
```

For a subpath, build with the corresponding `GAMEPLAY_BASE` and expose the generated files at that prefix; configure the server fallback to that subpath's `index.html`. Use a valid certificate and normal HTTPS redirect; a self-signed certificate is not a public installation solution. No production deployment is included.

## Limitations

The game is an early prototype and intentionally has no cross-device save, backend, or account. Native install prompts depend on browser eligibility heuristics. Physical iPhone/iPad and Android devices must be checked manually; browser emulation is not a device test.
