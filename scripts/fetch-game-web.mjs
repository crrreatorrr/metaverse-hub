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
 *   node scripts/fetch-game-web.mjs --all
 *
 * With `gh` signed in, a game's latest "Web build" CI artifact is used when it has
 * one. Otherwise the repo is cloned (gh, or plain git for a public repo) and a Vite
 * game is built with its base at /play/<slug>/. HPOS10I is a Godot game: without an
 * artifact its portal keeps opening the GitHub Pages copy.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Keyed by URL slug. @type {Record<string, { repo: string; artifact?: string; pages?: string }>} */
const GAMES = {
  hpos10i: {
    repo: 'crrreatorrr/HPOS10I',
    artifact: 'web-build',
    pages: 'https://crrreatorrr.github.io/HPOS10I/',
  },
  nobu: { repo: 'crrreatorrr/nobu', artifact: 'web-build' },
  'peoples-bitcoin': { repo: 'crrreatorrr/peoples-bitcoin', artifact: 'web-build' },
  'sproto-duel': { repo: 'crrreatorrr/sproto-duel', artifact: 'web-build' },
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
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: cmd === 'gh' ? ghEnv() : process.env,
    ...opts,
  });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')}\n${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
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

/** True when `gh` is installed and can read the repo. */
function ghCanRead(repo) {
  try {
    run('gh', ['api', `repos/${repo}`, '--jq', '.full_name']);
    return true;
  } catch {
    return false;
  }
}

/** Latest successful "Web build" artifact, or false when there is none. */
function tryArtifact(game, scratch, dest) {
  if (!game.artifact) return false;
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
    return false;
  }
  if (!Array.isArray(runs) || runs.length === 0) return false;
  const runId = String(runs[0].databaseId);
  console.log(`Downloading ${game.artifact} from run ${runId} (${String(runs[0].headSha).slice(0, 7)})…`);
  try {
    run('gh', ['run', 'download', runId, '--repo', game.repo, '-D', scratch, '-n', game.artifact]);
  } catch (error) {
    // Artifacts expire (HPOS10I keeps them 14 days). Fall through to a source build.
    console.log(`Artifact download failed, building from source instead.\n${error instanceof Error ? error.message : error}`);
    return false;
  }
  const buildDir = join(scratch, game.artifact);
  installFromDir(existsSync(buildDir) ? buildDir : scratch, dest);
  return true;
}

/**
 * Clones the repo and installs a web build from it. A Vite game is built with its
 * base at /play/<slug>/ (vite build, not the repo's `build` script, so a failing
 * typecheck in its tests does not block playing). Otherwise a committed export.
 */
function buildFromSource(game, gameId, scratch, dest, useGh) {
  const cloneDir = join(scratch, 'clone');
  console.log(`Cloning ${game.repo}…`);
  if (useGh) run('gh', ['repo', 'clone', game.repo, cloneDir, '--', '--depth', '1']);
  else run('git', ['clone', '--depth', '1', `https://github.com/${game.repo}.git`, cloneDir]);

  const pkgPath = join(cloneDir, 'package.json');
  const viteConfig = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs'].some((f) => existsSync(join(cloneDir, f)));
  if (existsSync(pkgPath) && viteConfig) {
    const base = `/play/${gameId}/`;
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    console.log(`Installing ${game.repo} dependencies…`);
    run(npm, [existsSync(join(cloneDir, 'package-lock.json')) ? 'ci' : 'install', '--no-audit', '--no-fund'], { cwd: cloneDir });
    console.log(`Building ${game.repo} with base ${base}…`);
    run(npx, ['vite', 'build', '--base', base], { cwd: cloneDir, env: { ...process.env, VITE_BASE: base } });
    installFromDir(join(cloneDir, 'dist'), dest);
    return;
  }

  for (const candidate of ['build/web', 'dist', 'web-build', 'export/web']) {
    const src = join(cloneDir, candidate);
    if (existsSync(join(src, 'index.html'))) {
      installFromDir(src, dest);
      return;
    }
  }
  throw new Error(`${game.repo} has no Web build artifact and no Vite project or committed web export to install.`);
}

function fetchGame(name) {
  const gameId = ALIASES[name] ?? name;
  const game = GAMES[gameId];
  if (!game) throw new Error(`Unknown game "${gameId}". Known: ${Object.keys(GAMES).join(', ')}`);
  const dest = join(root, 'apps/hub/public/play', gameId);
  const scratch = mkdtempSync(join(tmpdir(), `hub-game-${gameId}-`));
  try {
    const useGh = ghCanRead(game.repo);
    if (!useGh) console.log(`gh cannot read ${game.repo}; using git clone.`);
    if (useGh && tryArtifact(game, scratch, dest)) {
      console.log(`Installed ${gameId} at ${dest}`);
      return;
    }
    buildFromSource(game, gameId, scratch, dest, useGh);
    console.log(`Installed ${gameId} at ${dest}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const args = process.argv.slice(2);
const ids = args.includes('--all') ? Object.keys(GAMES) : args;
if (ids.length === 0) {
  console.error(`Usage: node scripts/fetch-game-web.mjs <${Object.keys(GAMES).join('|')}|--all>`);
  process.exit(1);
}

let failed = 0;
for (const id of ids) {
  try {
    fetchGame(id);
  } catch (error) {
    const pages = GAMES[ALIASES[id] ?? id]?.pages;
    console.error(`\n[${id}] ${error instanceof Error ? error.message : error}\n`);
    // A game with a public Pages copy still opens from the plaza without a local build.
    if (pages) console.error(`[${id}] Skipped: its portal opens ${pages} instead.\n`);
    else failed += 1;
  }
}
process.exit(failed === 0 ? 0 : 1);
