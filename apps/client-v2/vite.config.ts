import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const bindHost = process.env.AVANPOST_V2_BIND_HOST ?? '127.0.0.1';
const clientPort = Number(process.env.AVANPOST_V2_CLIENT_PORT ?? '4174');
const apiPort = Number(process.env.AVANPOST_V2_PORT ?? '8788');
const apiProxyHost = process.env.AVANPOST_V2_API_PROXY_HOST ?? bindHost;
const proxyApi = process.env.AVANPOST_V2_API_PROXY === 'true';

export default defineConfig({
  resolve: {
    alias: {
      '@avanpost/peace-v2-shared': fileURLToPath(new URL('../../packages/peace-v2-shared/src/index.ts', import.meta.url))
    }
  },
  server: {
    host: bindHost,
    port: clientPort,
    strictPort: true,
    ...(proxyApi ? {
      proxy: {
        '/api': { target: `http://${apiProxyHost}:${apiPort}`, changeOrigin: true }
      }
    } : {})
  },
  preview: {
    host: bindHost,
    port: clientPort,
    strictPort: true
  }
});
