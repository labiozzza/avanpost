import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  base: process.env.GAMEPLAY_BASE || '/',
  define: { __APP_BUILD_ID__: JSON.stringify(process.env.GAMEPLAY_BUILD_ID || 'local') },
  publicDir: 'public',
  optimizeDeps: { entries: ['index.html'] },
  server: {
    host: '127.0.0.1',
    port: 7070,
    strictPort: true,
    allowedHosts: ['tester.a.2na.am'],
    watch: { ignored: ['**/playwright-report*/**', '**/test-results*/**'] }
  },
  build: { outDir: 'dist', emptyOutDir: true },
  plugins: [VitePWA({
    registerType: 'prompt',
    includeAssets: ['icons/favicon-32.png', 'icons/apple-touch-icon.png'],
    manifest: {
      id: './',
      name: 'Аванпост',
      short_name: 'Аванпост',
      description: 'Строй поселение, добывай ресурсы и помогай жителям развиваться.',
      lang: 'ru',
      display: 'standalone',
      orientation: 'any',
      start_url: './',
      scope: './',
      theme_color: '#1e2a25',
      background_color: '#e9e8df',
      icons: [
        { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
      ]
    },
    workbox: {
      navigateFallback: 'index.html',
      cleanupOutdatedCaches: true,
      maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      globPatterns: ['**/*.{html,js,css,woff2,png,svg,ico,webmanifest}'],
      globIgnores: ['**/dev-dist/**']
    },
    devOptions: { enabled: false }
  })]
});
