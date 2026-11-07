#!/usr/bin/env node
/**
 * Pull a game's latest web build into apps/hub/public/play/<slug>/ so the dev
 * plaza opens the real game same-origin (ticket + /v2 proxy still work). Slugs
 * match GAME_URLS in apps/hub/src/games.ts. The folders are gitignored, and the
 * production build leaves them out: production serves games from play.<domain>.
 *
 * Usage:
 *   node scripts/fetch-game-web.mjs hpos10i
 *   node scripts/fetch-game-web.mjs nobu
 *   node scripts/fetch-game-web.mjs peoples-bitcoin
 *   node scripts/fetch-game-web.mjs sproto-duel   (or: sproto)
 *   node scripts/fetch-game-web.mjs sproto-fighter (the Bar's arcade cabinet)
 *   node scripts/fetch-game-web.mjs sproto-arcade  (the cabinet's second game)
 *   node scripts/fetch-game-web.mjs sproto-shooter (dark ring; no plaza placement in H0)
 *   node scripts/fetch-game-web.mjs sproto-coop-battle (Bar cabinet game; no separate portal)
 *   node scripts/fetch-game-web.mjs --all
 *
 * Games without a "Web build" artifact are cloned. A clone whose package.json
 * has a build script is built with VITE_BASE=/play/<slug>/ and its dist/ is
 * installed, because raw source (index.html pointing at src/main.ts) does not
 * run in the browser. Only repos with no build script fall back to a committed
 * static export or the repo root.
 *
 * Requires `gh` with read access to the game repo (Cursor GitHub App must
 * include that private repo, or the repo must be public), plus npm for games
 * that are built here.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Keyed by URL slug. @type {Record<string, { repo: string; artifact?: string; pages?: string; entry: 'ring' | 'cabinet' }>} */
export const GAMES = {
  hpos10i: {
    repo: 'crrreatorrr/HPOS10I',
    artifact: 'web-build',
    pages: 'https://crrreatorrr.github.io/HPOS10I/',
    entry: 'ring',
  },
  nobu: { repo: 'crrreatorrr/nobu', artifact: 'web-build', entry: 'ring' },
  'peoples-bitcoin': { repo: 'crrreatorrr/peoples-bitcoin', artifact: 'web-build', entry: 'ring' },
  'sproto-duel': { repo: 'crrreatorrr/sproto-duel', artifact: 'web-build', entry: 'ring' },
  'sproto-fighter': { repo: 'crrreatorrr/Sproto-Fighter', artifact: 'web-build', entry: 'cabinet' },
  'sproto-arcade': { repo: 'crrreatorrr/Sproto-Arcade', artifact: 'web-build', entry: 'cabinet' },
  // Cloned and built from source. No web-build artifact and no CDN SDK.
  'sproto-shooter': { repo: 'crrreatorrr/sproto-shooter', entry: 'ring' },
  // The trailing dot is part of the GitHub repo name. The public slug has no dot.
  // Cabinet game: the fetch path is /play/sproto-coop-battle/, not a plaza ring.
  'sproto-coop-battle': { repo: 'crrreatorrr/Sproto-Coop-Battle.', entry: 'cabinet' },
};

/** Nakama game ids that differ from their slug. */
const ALIASES = { sproto: 'sproto-duel' };

/** Prefer an explicit PAT so private game repos work even when the Cloud Agent install token is scoped to metaverse-hub only. */
function ghEnv() {
  const token = process.env.GAME_REPOS_GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) return process.env;
  return { ...process.env, GH_TOKEN: token, GITHUB_TOKEN: token };
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: cmd === 'gh' ? ghEnv() : process.env,
    ...opts,
  });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')}\n${result.stderr || result.stdout || `exit ${result.status}`}`);
  }
  return (result.stdout ?? '').trim();
}

/**
 * How to install a cloned game repo:
 * - `{ kind: 'build' }` when package.json has a build script,
 * - `{ kind: 'static', dir }` for a committed export or a plain static repo root,
 * - `null` when there is nothing to serve.
 * @param {string} cloneDir
 * @returns {{ kind: 'build' } | { kind: 'static'; dir: string } | null}
 */
export function planClone(cloneDir) {
  const pkgPath = join(cloneDir, 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    if (pkg && pkg.scripts && typeof pkg.scripts.build === 'string') return { kind: 'build' };
  }
  for (const candidate of ['build/web', 'dist', 'web-build', 'public', 'export/web']) {
    if (existsSync(join(cloneDir, candidate, 'index.html'))) return { kind: 'static', dir: candidate };
  }
  if (existsSync(join(cloneDir, 'index.html'))) return { kind: 'static', dir: '.' };
  return null;
}

/** Folders a game build may write its page to: Vite's default, then HPOS10I's `build/web`, then other exports. */
const BUILD_OUTPUTS = ['dist', 'build/web', 'web-build', 'export/web'];

/**
 * The first build output whose index.html was written at or after `sinceMs`, so a
 * stale committed export is never mistaken for the fresh build.
 * @param {string} cloneDir
 * @param {number} sinceMs
 * @returns {string | null}
 */
export function findBuildOutput(cloneDir, sinceMs) {
  for (const candidate of BUILD_OUTPUTS) {
    const page = join(cloneDir, candidate, 'index.html');
    if (existsSync(page) && statSync(page).mtimeMs >= sinceMs) return join(cloneDir, candidate);
  }
  return null;
}

/** Install dependencies and build a cloned game for the dev hub's /play/<slug>/ path. */
function buildClone(cloneDir, gameId) {
  const install = existsSync(join(cloneDir, 'package-lock.json')) ? ['ci'] : ['install'];
  const opts = { cwd: cloneDir, stdio: ['ignore', 'inherit', 'inherit'] };
  console.log(`Installing ${gameId} dependencies…`);
  run('npm', [...install, '--no-audit', '--no-fund'], opts);
  console.log(`Building ${gameId} for /play/${gameId}/…`);
  const started = Date.now() - 1000;
  run('npm', ['run', 'build'], { ...opts, env: { ...process.env, VITE_BASE: `/play/${gameId}/` } });
  const out = findBuildOutput(cloneDir, started);
  if (!out) throw new Error(`${gameId} built, but no fresh index.html under ${BUILD_OUTPUTS.join(', ')}`);
  return out;
}

function installFromDir(src, dest) {
  if (!existsSync(join(src, 'index.html'))) {
    throw new Error(`No index.html under ${src}`);
  }
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
  writeFileSync(join(dest, '.gitkeep'), '');
}

function fetchArtifact(name) {
  const gameId = ALIASES[name] ?? name;
  const game = GAMES[gameId];
  if (!game) throw new Error(`Unknown game "${gameId}". Known: ${Object.keys(GAMES).join(', ')}`);
  const dest = join(root, 'apps/hub/public/play', gameId);
  const scratch = mkdtempSync(join(tmpdir(), `hub-game-${gameId}-`));

  console.log(`Checking access to ${game.repo}…`);
  try {
    run('gh', ['api', `repos/${game.repo}`, '--jq', '.full_name']);
  } catch (error) {
    const hint = [
      `Cannot read ${game.repo}.`,
      'This Cloud Agent token is scoped to the environment repos (usually only metaverse-hub).',
      'Unblock with one of:',
      '1) Make the game repo Public for a few minutes and re-run,',
      '2) Set secret GAME_REPOS_GITHUB_TOKEN (fine-grained PAT, Contents: Read) and re-run,',
      '3) Create a multi-repo Cloud Agent environment that includes the game repos and start a new agent.',
      game.pages ? `Public Pages fallback (cross-origin, no local /v2): ${game.pages}` : '',
    ]
      .filter(Boolean)
      .join(' ');
    throw new Error(`${hint}\n${error instanceof Error ? error.message : error}`);
  }

  let runs = [];
  try {
    runs = JSON.parse(
      run('gh', [
        'run',
        'list',
        '--repo',
        game.repo,
        '--workflow',
        'Web build',
        '--status',
        'success',
        '--limit',
        '1',
        '--json',
        'databaseId,headSha,displayTitle',
      ]),
    );
  } catch {
    runs = [];
  }

  if (Array.isArray(runs) && runs.length > 0 && game.artifact) {
    const runId = String(runs[0].databaseId);
    console.log(`Downloading ${game.artifact} from run ${runId} (${String(runs[0].headSha).slice(0, 7)})…`);
    run('gh', ['run', 'download', runId, '--repo', game.repo, '-D', scratch, '-n', game.artifact]);
    const buildDir = join(scratch, game.artifact);
    installFromDir(existsSync(buildDir) ? buildDir : scratch, dest);
    console.log(`Installed ${gameId} at ${dest}`);
    return;
  }

  // Fallback: shallow clone, then build it or use a committed static export.
  console.log(`No Web build artifact. Cloning ${game.repo}…`);
  const cloneDir = join(scratch, 'clone');
  run('gh', ['repo', 'clone', game.repo, cloneDir, '--', '--depth', '1']);
  const plan = planClone(cloneDir);
  if (plan?.kind === 'build') {
    installFromDir(buildClone(cloneDir, gameId), dest);
    console.log(`Built and installed ${gameId} at ${dest}`);
    return;
  }
  if (plan?.kind === 'static') {
    installFromDir(join(cloneDir, plan.dir), dest);
    console.log(`Installed ${gameId} from ${plan.dir === '.' ? 'repo root' : plan.dir} at ${dest}`);
    return;
  }
  throw new Error(
    `${game.repo} has no Web build artifact named "${game.artifact}", no build script, and no index.html under build/web, dist, web-build, public, export/web, or the repo root.`,
  );
}

function main() {
  const args = process.argv.slice(2);
  const ids = args.includes('--all') ? Object.keys(GAMES) : args;
  if (ids.length === 0) {
    console.error(`Usage: node scripts/fetch-game-web.mjs <${Object.keys(GAMES).join('|')}|--all>`);
    process.exit(1);
  }

  let failed = 0;
  for (const id of ids) {
    try {
      fetchArtifact(id);
    } catch (error) {
      failed += 1;
      console.error(`\n[${id}] ${error instanceof Error ? error.message : error}\n`);
    }
  }
  process.exit(failed === 0 ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
