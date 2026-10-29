import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const nakama = 'http://127.0.0.1:7350';
const proxy = {
  '/v2': { target: nakama, changeOrigin: true },
  '/ws': { target: nakama, ws: true, changeOrigin: true },
};

const PLAY_GAMES = ['hpos10i', 'nobu', 'peoples-bitcoin', 'sproto'] as const;

function redirectRoot(): Plugin {
  const redirect = (req: { url?: string }, res: { writeHead: (code: number, headers: Record<string, string>) => void; end: () => void }, next: () => void) => {
    if (req.url === '/' || req.url === '') {
      res.writeHead(302, { Location: '/hub/' });
      res.end();
      return;
    }
    // Real game builds live under public/play/<id>/ (see scripts/fetch-game-web.mjs).
    for (const id of PLAY_GAMES) {
      if (req.url === `/play/${id}` || req.url === `/play/${id}/`) {
        req.url = `/play/${id}/index.html`;
        break;
      }
    }
    next();
  };
  return {
    name: 'redirect-root',
    configureServer(server) {
      server.middlewares.use(redirect);
    },
    configurePreviewServer(server) {
      server.middlewares.use(redirect);
    },
  };
}

// Plaza at /hub/. Portals open real game builds under public/play/<id>/. Nakama at /v2.
export default defineConfig({
  base: '/',
  plugins: [redirectRoot()],
  resolve: {
    alias: {
      '@metaverse/hub-sdk': resolve(__dirname, '../../packages/hub-sdk/src/index.ts'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy,
  },
  preview: {
    proxy,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: {
        hub: resolve(__dirname, 'hub/index.html'),
      },
    },
  },
});
