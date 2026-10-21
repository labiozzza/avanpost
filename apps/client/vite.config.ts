import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
) as { version: string };

const buildVersion = process.env.APP_VERSION ?? pkg.version;

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(buildVersion)
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787'
    }
  },
  preview: {
    port: 4173,
    proxy: {
      '/api': 'http://localhost:8787'
    }
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Аванпост',
        short_name: 'Аванпост',
        description: 'Мирное поселение и военный аванпост',
        lang: 'ru',
        theme_color: '#6f9d52',
        background_color: '#6f9d52',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}']
      }
    })
  ],
  build: {
    target: 'es2022'
  }
});
