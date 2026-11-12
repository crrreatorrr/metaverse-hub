// Live Nakama check for the authoritative Coop match.
//   docker compose -f server/docker-compose.yml up --build -d
//   npx tsx scripts/load/coop-bots.ts
// Confirms coop.version is enabled with zero rewards, the fault-inject seed-3
// six-seat fight reaches the offline gameover (tick 10347, same stateHash),
// and ten concurrent matches stay under a 25 ms p95. Tickets stay at zero.
// Prints COOP_REPORT as one JSON line.
import { execFileSync } from 'node:child_process';
import { cpus, totalmem } from 'node:os';
import { createRealtime, HubSdkError } from '../../packages/hub-sdk/src/index.ts';
import { call, login, waitReady, type GameLogin } from '../../server/test/dup/harness.ts';

const BASE = process.env.NAKAMA_URL ?? 'http://127.0.0.1:7350';
const GAME = 'sproto-coop-battle';
const GOLDEN_TICK = 10347;
const GOLDEN_HASH = '0ace8b5604e871232143b85a8ae035b9054de908604adcd1f557acdc9998ed96';
const BENCH_MATCHES = 10;
const BENCH_MS = 8000;

interface Version {
  protocol: number;
  fingerprint: string;
  rewards: number;
  hostTakeover: number;
  snapshotHz: number;
  loopHz: number;
  substeps: number;
  reconnectS: number;
  enabled: boolean;
  match: string;
}

interface Metrics {
  n: number;
  p50: number;
  p95: number;
  max: number;
  over25: number;
  tick: number;
  phase: string;
  endReason: string;
  stateHash: string;
  rewards: number;
  hostTakeover: number;
  error?: string;
}

const failures: string[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`ok   ${name}`);
  else {
    failures.push(detail ? `${name}: ${detail}` : name);
    console.error(`FAIL ${name}${detail ? ` ${detail}` : ''}`);
  }
}

function socket(token: string) {
  return createRealtime({ serverUrl: BASE, getToken: () => token, reconnect: false });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function balance(token: string): Promise<number> {
  const result = await call('tickets.balance', { game: GAME }, token);
  return Number(result.body.balance ?? 0);
}

async function metrics(token: string, matchId: string): Promise<Metrics> {
  const rt = socket(token);
  await rt.connect();
  try {
    return await rt.rpc<Metrics>('coop.metrics', { matchId });
  } finally {
    rt.disconnect();
  }
}

await waitReady();
const accounts: GameLogin[] = [];
const host = await login(GAME);
accounts.push(host);
const before = [await balance(host.gameToken)];

const rt = socket(host.gameToken);
await rt.connect();
const info = await rt.rpc<Version>('coop.version', {});
check(
  'version pin is visible, enabled, and unpaid',
  info.enabled === true && info.protocol === 1 && info.fingerprint.length === 64 && info.rewards === 0 && info.hostTakeover === 0
    && info.snapshotHz === 10 && info.loopHz === 20 && info.substeps === 3 && info.reconnectS === 15
    && info.match === 'sproto_coop',
  JSON.stringify(info),
);

let resumeCode = '';
try {
  await rt.rpc('coop.resume', { matchId: 'none', state: { hp: 1 } });
} catch (error) {
  resumeCode = error instanceof HubSdkError ? error.code : '';
}
check('resume rejects a client snapshot', resumeCode === 'rejected', resumeCode);
const cancel = await rt.rpc<{ ok: boolean; queued: boolean }>('coop.queue_cancel', {});
const cancelAgain = await rt.rpc<{ ok: boolean; queued: boolean }>('coop.queue_cancel', {});
check('queue cancel is idempotent', cancel.ok === true && cancel.queued === false && cancelAgain.ok === true);

const goldenStarted = Date.now();
const golden = await rt.rpc<{ matchId: string; rewards: number; hostTakeover: number }>('coop.golden', { id: 'human-seed3' });
check('golden match started unpaid', Boolean(golden.matchId) && golden.rewards === 0 && golden.hostTakeover === 0, JSON.stringify(golden));
rt.disconnect();

let goldenMetrics: Metrics = { n: 0, p50: 0, p95: 0, max: 0, over25: 0, tick: 0, phase: '', endReason: '', stateHash: '', rewards: 0, hostTakeover: 0 };
const goldenDeadline = Date.now() + 6 * 60 * 1000;
await sleep(110000);
while (Date.now() < goldenDeadline) {
  try {
    goldenMetrics = await metrics(host.gameToken, golden.matchId);
  } catch (error) {
    goldenMetrics = { ...goldenMetrics, error: error instanceof HubSdkError ? error.code : (error instanceof Error ? error.message : String(error)) };
  }
  if (goldenMetrics.phase === 'done' || goldenMetrics.endReason === 'gameover' || goldenMetrics.tick === GOLDEN_TICK) break;
  await sleep(2000);
}
check(
  'nakama seed-3 gameover matches the offline golden',
  goldenMetrics.tick === GOLDEN_TICK && goldenMetrics.endReason === 'gameover' && goldenMetrics.stateHash === GOLDEN_HASH && goldenMetrics.rewards === 0,
  `tick=${goldenMetrics.tick} reason=${goldenMetrics.endReason} hash=${goldenMetrics.stateHash} phase=${goldenMetrics.phase} ms=${Date.now() - goldenStarted} ${goldenMetrics.error || ''}`,
);

const sessions = [host];
for (let i = 1; i < BENCH_MATCHES; i += 1) sessions.push(await login(GAME));
accounts.push(...sessions.slice(1));
const benchBefore = await Promise.all(accounts.map((session) => balance(session.gameToken)));
const ids: string[] = [];
const rts = [];
for (const session of sessions) {
  const player = socket(session.gameToken);
  await player.connect();
  const created = await player.rpc<{ matchId: string; rewards: number; hostTakeover: number }>('coop.room_create', {});
  check('bench room is unpaid', created.rewards === 0 && created.hostTakeover === 0, created.matchId);
  const match = await player.joinMatch({ matchId: created.matchId });
  const mail: number[] = [];
  match.onMessage((msg) => mail.push(msg.opCode));
  match.send(1, { t: 'hello', protocol: info.protocol, fingerprint: info.fingerprint, devices: ['k1'] });
  const helloAt = Date.now();
  while (!mail.includes(2) && Date.now() - helloAt < 4000) await sleep(30);
  match.send(3, { t: 'ready' });
  const readyAt = Date.now();
  while (!mail.includes(4) && Date.now() - readyAt < 4000) await sleep(30);
  check('bench match started', mail.includes(2) && mail.includes(4), created.matchId);
  await player.rpc('coop.metrics', { matchId: created.matchId, reset: true });
  rts.push(player);
  ids.push(created.matchId);
}
await sleep(BENCH_MS);
const samples: Metrics[] = [];
for (let i = 0; i < ids.length; i += 1) {
  try {
    samples.push(await rts[i]!.rpc<Metrics>('coop.metrics', { matchId: ids[i]! }));
  } catch (error) {
    samples.push({ n: 0, p50: 0, p95: 0, max: 0, over25: 0, tick: 0, phase: '', endReason: '', stateHash: '', rewards: 0, hostTakeover: 0, error: error instanceof Error ? error.message : String(error) });
  }
}
for (const player of rts) player.disconnect();
const worst = samples.reduce((best, row) => (row.p95 > best ? row.p95 : best), 0);
check(
  'ten matches stay under 25 ms p95',
  samples.length === BENCH_MATCHES && samples.every((row) => row.phase === 'playing' && row.n >= 100 && row.p95 < 25 && row.rewards === 0 && !row.error),
  JSON.stringify({
    cpu: cpus()[0]?.model ?? '',
    samples: samples.map((row) => ({ n: row.n, p50: row.p50, p95: row.p95, max: row.max, over25: row.over25, tick: row.tick, phase: row.phase, error: row.error })),
  }),
);

const after = await Promise.all(accounts.map((session) => balance(session.gameToken)));
check('balances did not move', benchBefore.every((value, index) => value === after[index]) && before[0] === after[0], `${before.join(',')} -> ${after.join(',')}`);

const idsSql = accounts.map((session) => session.hub.userId);
let ledger = '';
try {
  ledger = execFileSync('docker', ['compose', '-f', 'server/docker-compose.yml', 'exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'nakama', '-tAc',
    `SELECT count(*) FROM game.tickets_ledger WHERE game_id = '${GAME}' AND user_id IN (${idsSql.map((id) => `'${id}'`).join(',')})`], { encoding: 'utf8' }).trim();
} catch (error) {
  ledger = `unavailable ${error instanceof Error ? error.message : String(error)}`;
}
check('ledger rows for these accounts are zero', ledger === '0', ledger);

const hardware = { cpu: cpus()[0]?.model ?? '', cores: cpus().length, memoryBytes: totalmem(), node: process.version };
console.log(`COOP_REPORT ${JSON.stringify({ failures, ledger, balances: after, enabled: info.enabled, fingerprint: info.fingerprint, golden: { tick: goldenMetrics.tick, endReason: goldenMetrics.endReason, stateHash: goldenMetrics.stateHash, ms: Date.now() - goldenStarted }, bench: { worstP95: worst, samples }, hardware })}`);
if (failures.length) process.exit(1);
