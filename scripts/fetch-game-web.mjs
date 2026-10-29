#!/usr/bin/env node
/**
 * Pull a game's latest web build into apps/hub/public/play/<gameId>/ so the
 * plaza can open the real game same-origin (ticket + /v2 proxy still work).
 *
 * Usage:
 *   node scripts/fetch-game-web.mjs hpos10i
 *   node scripts/fetch-game-web.mjs nobu
 *   node scripts/fetch-game-web.mjs peoples-bitcoin
 *   node scripts/fetch-game-web.mjs sproto
 *   node scripts/fetch-game-web.mjs --all
 *
 * Requires `gh` with read access to the game repo (Cursor GitHub App must
 * include that private repo, or the repo must be public).
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @type {Record<string, { repo: string; artifact?: string; pages?: string }>} */
const GAMES = {
  hpos10i: {
    repo: 'crrreatorrr/HPOS10I',
    artifact: 'web-build',
    pages: 'https://crrreatorrr.github.io/HPOS10I/',
  },
  nobu: { repo: 'crrreatorrr/nobu', artifact: 'web-build' },
  'peoples-bitcoin': { repo: 'crrreatorrr/peoples-bitcoin', artifact: 'web-build' },
  sproto: { repo: 'crrreatorrr/sproto-duel', artifact: 'web-build' },
};

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
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

function fetchArtifact(gameId) {
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
      'Add that repository to the Cursor GitHub App installation for this account,',
      'then re-run this script.',
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

  // Fallback: shallow clone and look for a committed web export.
  console.log(`No Web build artifact. Cloning ${game.repo} for a static export…`);
  const cloneDir = join(scratch, 'clone');
  run('gh', ['repo', 'clone', game.repo, cloneDir, '--', '--depth', '1']);
  for (const candidate of ['build/web', 'dist', 'web-build', 'public', 'export/web']) {
    const src = join(cloneDir, candidate);
    if (existsSync(join(src, 'index.html'))) {
      installFromDir(src, dest);
      console.log(`Installed ${gameId} from ${candidate} at ${dest}`);
      return;
    }
  }
  if (existsSync(join(cloneDir, 'index.html'))) {
    installFromDir(cloneDir, dest);
    console.log(`Installed ${gameId} from repo root at ${dest}`);
    return;
  }
  throw new Error(
    `${game.repo} has no Web build artifact named "${game.artifact}" and no index.html under build/web, dist, web-build, public, or export/web.`,
  );
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
    fetchArtifact(id);
  } catch (error) {
    failed += 1;
    console.error(`\n[${id}] ${error instanceof Error ? error.message : error}\n`);
  }
}
process.exit(failed === 0 ? 0 : 1);
