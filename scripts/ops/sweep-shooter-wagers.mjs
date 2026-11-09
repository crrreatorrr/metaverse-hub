// Refund Shooter holds older than the safe age (20 minutes). This does not
// enable wagers and it does not touch Fighter escrow. A row closes once.
//
//   node scripts/ops/sweep-shooter-wagers.mjs            # refund stale holds
//   node scripts/ops/sweep-shooter-wagers.mjs --dry-run  # print the match ids only
//
// Local Nakama from server/docker-compose.yml is the default. Set DATABASE_URL
// to use another Postgres (the URL is not printed).
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const compose = join(root, 'server/docker-compose.yml');
const dry = process.argv.includes('--dry-run');
const age = '1200 seconds';

const sql = dry
  ? `SELECT match_id FROM game.shooter_wager WHERE status = 'held' AND created_at < now() - interval '${age}' ORDER BY match_id`
  : `SELECT game.shooter_wager_expire(interval '${age}')`;

function run(statement) {
  if (process.env.DATABASE_URL) {
    return execFileSync('psql', [process.env.DATABASE_URL, '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A', '-c', statement], {
      encoding: 'utf8',
    }).trim();
  }
  return execFileSync('docker', [
    'compose', '-f', compose, 'exec', '-T', 'postgres',
    'psql', '-U', 'postgres', '-d', 'nakama',
    '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A', '-c', statement,
  ], { cwd: root, encoding: 'utf8' }).trim();
}

const out = run(sql);
if (dry) {
  const ids = out.split('\n').map((line) => line.trim()).filter(Boolean);
  console.log(`stale shooter holds: ${ids.length}`);
  for (const id of ids) console.log(id);
} else {
  console.log(`shooter wager sweep refunded ${out || '0'}`);
}
