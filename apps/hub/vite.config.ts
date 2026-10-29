import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const nakama = 'http://127.0.0.1:7350';
const proxy = {
  '/v2': { target: nakama, changeOrigin: true },
  '/ws': { target: nakama, ws: true, changeOrigin: true },
};

function redirectRoot(): Plugin {
  const redirect = (req: { url?: string }, res: { writeHead: (code: number, headers: Record<string, string>) => void; end: () => void }, next: () => void) => {
    if (req.url === '/' || req.url === '') {
      res.writeHead(302, { Location: '/hub/' });
      res.end();
      return;
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

// Plaza at /hub/, mock Sproto Duel at /play/sproto/. Nakama is proxied at /v2.
// The dev server key is inlined only for `vite dev`. Production builds take
// VITE_NAKAMA_SERVER_KEY and never embed the compose default.
export default defineConfig(({ mode }) => ({
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
  define: {
    __NAKAMA_SERVER_KEY__: JSON.stringify(
      mode === 'development' ? 'defaultkey' : (process.env.VITE_NAKAMA_SERVER_KEY ?? ''),
    ),
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: {
        hub: resolve(__dirname, 'hub/index.html'),
        sproto: resolve(__dirname, 'play/sproto/index.html'),
      },
    },
  },
}));
