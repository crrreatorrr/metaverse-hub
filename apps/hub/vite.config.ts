import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin, type UserConfig } from 'vite';

const nakama = 'http://127.0.0.1:7350';
const proxy = {
  '/v2': { target: nakama, changeOrigin: true },
  '/ws': { target: nakama, ws: true, changeOrigin: true },
};

/**
 * Real game web builds, pulled by `npm run fetch:games` into public/play/<slug>/
 * (gitignored). Slugs match GAME_URLS in src/games.ts. Served same-origin so the
 * `#t=` ticket and the /v2 proxy work as they will on play.<domain>.
 */
const PLAY_ROOT = resolve(__dirname, 'public/play');
const PLAY_GAMES = [
  { slug: 'hpos10i', env: 'VITE_GAME_URL_HPOS10I' },
  { slug: 'nobu', env: 'VITE_GAME_URL_NOBU' },
  { slug: 'peoples-bitcoin', env: 'VITE_GAME_URL_PEOPLES_BITCOIN' },
  { slug: 'sproto-duel', env: 'VITE_GAME_URL_SPROTO_DUEL' },
  { slug: 'sproto-fighter', env: 'VITE_GAME_URL_SPROTO_FIGHTER' },
  { slug: 'sproto-arcade', env: 'VITE_GAME_URL_SPROTO_ARCADE' },
  { slug: 'sproto-shooter', env: 'VITE_GAME_URL_SPROTO_SHOOTER' },
] as const;

function fetchedBuild(slug: string): boolean {
  return existsSync(resolve(PLAY_ROOT, slug, 'index.html'));
}

/**
 * `/play/<slug>/` opens a fetched build's index.html. Without a fetched Sproto Duel
 * build, `/play/sproto-duel/` falls back to the M1 mock at play/sproto.
 */
function rewritePlay(url: string): string {
  const queryAt = url.indexOf('?');
  const path = queryAt === -1 ? url : url.slice(0, queryAt);
  const query = queryAt === -1 ? '' : url.slice(queryAt);
  for (const { slug } of PLAY_GAMES) {
    const base = `/play/${slug}`;
    if (path !== base && !path.startsWith(`${base}/`)) continue;
    if (fetchedBuild(slug)) return path === base || path === `${base}/` ? `${base}/index.html${query}` : url;
    if (slug !== 'sproto-duel') return url;
    const rest = path.slice(base.length);
    return `${rest === '' ? '/play/sproto/' : `/play/sproto${rest}`}${query}`;
  }
  return url;
}

/**
 * Dev only: a fetched build wins over a game's default page (HPOS10I otherwise opens
 * its GitHub Pages copy, which cannot reach the local /v2). An explicit
 * VITE_GAME_URL_* still wins. Production builds keep play.<domain>.
 */
function preferFetchedBuilds(): void {
  for (const { slug, env } of PLAY_GAMES) {
    if (process.env[env] === undefined && fetchedBuild(slug)) process.env[env] = `/play/${slug}/`;
  }
}

/** Fetched builds are for local play. Production serves games from play.<domain>, so keep them out of dist. */
function dropFetchedBuilds(): Plugin {
  return {
      name: 'drop-fetched-builds',
      apply: 'build',
      closeBundle() {
        for (const { slug } of PLAY_GAMES) rmSync(resolve(__dirname, 'dist/play', slug), { recursive: true, force: true });
      },
    };
  }

function realmPages(): Plugin {
  let pages: string[] = [];
  return {
    name: 'realm-page-manifest',
    configResolved(config) {
      const input = config.build.rollupOptions.input;
      const entries = typeof input === 'string' ? [input] : Array.isArray(input) ? input : Object.values(input ?? {});
      pages = entries.flatMap(entry => {
        const match = entry.replaceAll('\\', '/').match(/\/realm\/([a-z0-9_-]+)\/index\.html$/);
        return match ? [`realm/${match[1]}/index.html`] : [];
      }).sort();
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'realm-pages.txt', source: pages.join('\n') + '\n' });
    },
  };
}

  function redirectRoot(): Plugin {
    const redirect = (req: { url?: string }, res: { writeHead: (code: number, headers: Record<string, string>) => void; end: () => void }, next: () => void) => {
      if (req.url === '/' || req.url === '') {
        res.writeHead(302, { Location: '/hub/' });
        res.end();
        return;
      }
      if (req.url) req.url = rewritePlay(req.url);
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

  // Plaza at /hub/. Portals open /play/<slug>/: a fetched real build, or the
  // Sproto Duel mock at /play/sproto/ until that build is fetched. Nakama at /v2.
  // The dev server key is inlined only for `vite dev`. Production builds take
  // VITE_NAKAMA_SERVER_KEY and never embed the compose default.
  export default defineConfig(({ command, mode }) => {
    if (command === 'serve') preferFetchedBuilds();
    return {
    base: '/',
    plugins: [redirectRoot(), dropFetchedBuilds(), realmPages()],
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
          sandbox: resolve(__dirname, 'realm/sandbox/index.html'),
          sproto: resolve(__dirname, 'play/sproto/index.html'),
        },
      },
    },
  } satisfies UserConfig;
});
