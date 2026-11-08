// Docker must give Nakama longer to stop than Nakama gives its matches to terminate.
// Without that, `docker compose up`/`stop` SIGKILLs Nakama mid-shutdown and matchTerminate
// (escrow refunds, coop checkpoints, PB saves) never finishes. HUB-W-1-05.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

/** Lines of one top-level service block in a compose file (two-space indented key). */
function serviceBlock(compose, name) {
  const lines = compose.split('\n');
  const start = lines.findIndex((l) => l === `  ${name}:`);
  assert.ok(start >= 0, `service ${name} not found`);
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (/^ {0,2}\S/.test(line)) break;
    out.push(line);
  }
  return out;
}

/** Compose duration ("90s", "1m30s", "2m") in seconds. */
function durationSec(text) {
  const m = /^(?:(\d+)m)?(?:(\d+)s)?$/.exec(text);
  assert.ok(m && (m[1] || m[2]), `unsupported duration ${text}`);
  return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0);
}

const nakama = serviceBlock(read('deploy/compose.yml'), 'nakama');
const stopLine = nakama.find((l) => /^ {4}stop_grace_period:/.test(l));
assert.ok(stopLine, 'deploy/compose.yml nakama needs stop_grace_period (Docker default is 10 s)');
const stopSec = durationSec(stopLine.split(':')[1].trim().replace(/^"|"$/g, ''));

const graceLine = read('deploy/nakama/config.yml')
  .split('\n')
  .find((l) => /^shutdown_grace_sec:/.test(l));
assert.ok(graceLine, 'deploy/nakama/config.yml needs a top-level shutdown_grace_sec');
const graceSec = Number(graceLine.split(':')[1].trim());

assert.equal(graceSec, 60, 'shutdown_grace_sec is 60 (plan §R.9 step 1)');
assert.equal(stopSec, 90, 'stop_grace_period is 90s (plan §R.9 step 1)');
// Headroom for socket close and process exit after the match grace window.
assert.ok(stopSec >= graceSec + 15, `stop_grace_period ${stopSec}s must exceed shutdown_grace_sec ${graceSec}s by 15 s`);

console.log(`deploy grace ok (nakama shutdown_grace_sec ${graceSec}s, docker stop_grace_period ${stopSec}s)`);
