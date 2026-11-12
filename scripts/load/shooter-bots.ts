// Live Nakama check for the free Shooter 1v1.
//   docker compose -f server/docker-compose.yml up --build -d
//   npx tsx scripts/load/shooter-bots.ts
// Protocol 2 / sim 2. Two guests play one seat each. Inputs are delayed 100 ms and
// 200 ms with jitter. Snapshots are per seat; PONG answers only the pinger. A
// reconnect rebinds with HELLO. One quiet seat forfeits after 10 s, RESULT reveals
// the committed combat seed, and the server's replay of the match verifies. Both
// going quiet is a draw. Ten live matches stay under a 25 ms p95. Tickets stay at zero.
// Prints SHOOTER_REPORT as one JSON line.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { createRealtime, type HubRealtime, type MatchData, type MatchHandle } from '../../packages/hub-sdk/src/index.ts';
import { call, login, psql, sleep as sqlSleep, ticketBalance, waitReady, type GameLogin } from '../../server/test/dup/harness.ts';

const BASE = process.env.NAKAMA_URL ?? 'http://127.0.0.1:7350';
const GAME = 'sproto-shooter';
const FP = 'dc00f234';
const PROTOCOL = 2;
const SIM = 2;
const PIN = JSON.parse(readFileSync(join(process.cwd(), 'server/modules/vendor/shooter-pvp-sim.pin.json'), 'utf8')) as {
  commit: string; sha256: string; contentFingerprint: string; loadoutHash: string; protocol: number; sim: number;
};
const BENCH_MATCHES = 10;
const BENCH_MS = 4000;

interface Version {
  protocol: number;
  sim: number;
  content: string;
  stake: number;
  ticketsMinted: number;
  guests: string;
  practice: string;
  match: string;
  budgetMs: number;
  stallMs: number;
}

interface Metrics {
  n: number;
  p50: number;
  p95: number;
  max: number;
  over25: number;
  overBudget: number;
  budgetMs: number;
  snapBytes: number;
  snapCount: number;
  inBytes: number;
  tick: number;
  phase: string;
  endReason: string;
  outcome: string;
  ticketsMinted: number;
  stakes: boolean;
  stake: number;
  seated: number;
  replay?: { status: string; verified: boolean; policy: string; mismatch: string[]; stored: boolean };
  error?: string;
}

interface Seat {
  rt: HubRealtime;
  match: MatchHandle;
  mail: MatchData[];
  userId: string;
  seat: number;
  seq: number;
  sentFor: number;
}

const failures: string[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) console.log(`ok   ${name}`);
  else {
    failures.push(detail ? `${name}: ${detail}` : name);
    console.error(`FAIL ${name}${detail ? ` ${detail}` : ''}`);
  }
}

function socket(token: string): HubRealtime {
  return createRealtime({ serverUrl: BASE, getToken: () => token, reconnect: false });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pvp(): { encodeInput(wish: { [key: string]: unknown }): Uint8Array } {
  const sandbox: { [key: string]: unknown } = { console: { log() {}, warn() {}, error() {} } };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(process.cwd(), 'server/modules/vendor/shooter-pvp-sim.js'), 'utf8'), sandbox, { filename: 'shooter-pvp-sim.js' });
  return sandbox.SprotoShooterPvp as { encodeInput(wish: { [key: string]: unknown }): Uint8Array };
}

const api = pvp();

async function until<T>(what: string, read: () => T | undefined, ms = 6000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(40);
  }
}

async function pair(): Promise<{ matchId: string; ada: GameLogin; bea: GameLogin; seats: [Seat, Seat] }> {
  const ada = await login(GAME);
  const bea = await login(GAME);
  const created = await call('shooter.room_create', {}, ada.gameToken);
  if (created.body.error || created.body.stake !== 0) throw new Error(JSON.stringify(created.body));
  const matchId = String(created.body.matchId);
  const joined = await call('shooter.room_join', { code: created.body.code, v: PROTOCOL, sim: SIM, content: FP }, bea.gameToken);
  if (joined.body.matchId !== matchId) throw new Error(JSON.stringify(joined.body));
  const sessions = [ada, bea];
  const seats = [] as Seat[];
  for (const session of sessions) {
    const rt = socket(session.gameToken);
    await rt.connect();
    const match = await rt.joinMatch({ matchId });
    const mail: MatchData[] = [];
    match.onMessage((msg) => mail.push(msg));
    seats.push({ rt, match, mail, userId: session.hub.userId, seat: -1, seq: 0, sentFor: -1 });
  }
  for (const seat of seats) seat.match.send(1, { accountId: seat.userId, protocol: PROTOCOL, sim: SIM, content: FP, interpMs: 100 });
  for (const seat of seats) {
    const welcome = await until(`${seat.userId} welcome`, () => seat.mail.find((msg) => msg.opCode === 2 && msg.json<{ accountId?: string }>().accountId === seat.userId));
    seat.seat = welcome.json<{ seat: number }>().seat;
    seat.match.send(4, { accountId: seat.userId });
  }
  await until('live', () => seats[0]!.mail.find((msg) => msg.opCode === 5 && msg.json<{ phase?: string }>().phase === 'live'));
  return { matchId, ada, bea, seats: [seats[0]!, seats[1]!] };
}

function cursor(seat: Seat): number {
  const snap = [...seat.mail].reverse().find((msg) => msg.opCode === 7);
  return snap ? snap.json<{ tick: number }>().tick : 0;
}

/** Aim at the cursor the server will have when a delayed packet arrives. */
async function sendDelayed(seat: Seat, delayMs: number): Promise<void> {
  const frameNow = cursor(seat);
  const lead = Math.max(0, Math.round(delayMs / (1000 / 30)) - 1);
  const frame = frameNow + lead;
  if (seat.sentFor >= frame) return;
  seat.seq += 1;
  const seq = seat.seq;
  seat.sentFor = frame;
  if (delayMs > 0) await sleep(delayMs);
  if (resultOf(seat)) return;
  const raw = api.encodeInput({
    seq, frame, yaw: 0, pitch: 0, moveX: 0, moveZ: 1, fire: false, zoom: false, slot: 0,
  });
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw[i] ?? 0;
  seat.match.send(6, bytes);
}

function resultOf(seat: Seat): { outcome?: string; reason?: string; winner?: number | null; ticketsMinted?: number; combatSeed?: string } | null {
  const row = [...seat.mail].reverse().find((msg) => msg.opCode === 8);
  return row ? row.json() : null;
}

await waitReady();
psql(`UPDATE game.server_flags SET state = 'on', allowlist = '{}', percent = 0, updated_at = now() WHERE key = 'shooter_pvp'`);
await sqlSleep(6500);
try {
const probe = await login(GAME);
const version = await call('shooter.version', {}, probe.gameToken);
const info = version.body as unknown as Version;
check(
  'version is the free arena and unpaid',
  info.match === 'sproto_shooter_free' && info.protocol === PROTOCOL && info.sim === SIM && info.content === FP
    && info.stake === 0 && info.ticketsMinted === 0 && info.guests === 'one_seat' && info.practice === 'offline'
    && info.budgetMs === 10 && info.stallMs === 10000,
  JSON.stringify(info),
);

const latency = await pair();
await until('latency snapshot', () => latency.seats[0]!.mail.find((msg) => msg.opCode === 7));
const delays = [100, 200, 100, 200, 100, 200];
for (let i = 0; i < delays.length; i += 1) {
  const jitter = (i % 2) * 17 + (i % 3) * 11;
  await Promise.all([
    sendDelayed(latency.seats[0]!, delays[i]! + jitter),
    sendDelayed(latency.seats[1]!, delays[i]! + jitter),
  ]);
}
await sleep(400);
const mid = resultOf(latency.seats[0]!);
check('100/200 ms delayed inputs with jitter do not end the match', mid === null, JSON.stringify(mid));
const ownSnapshots = latency.seats.every((seat) => seat.mail.filter((msg) => msg.opCode === 7).every((msg) => msg.json<{ you?: { seat?: number } }>().you?.seat === seat.seat));
check('each socket only gets its own seat\'s snapshots', ownSnapshots);
latency.seats[0]!.match.send(10, { t: 4242 });
await sleep(300);
const pongs = latency.seats.map((seat) => seat.mail.filter((msg) => msg.opCode === 11 && msg.json<{ t?: number }>().t === 4242).length);
check('PONG goes only to the pinger', pongs[0] === 1 && pongs[1] === 0, JSON.stringify(pongs));
latency.seats[0]!.rt.disconnect();
await sleep(400);
const again = socket(latency.ada.gameToken);
await again.connect();
const rejoined = await again.joinMatch({ matchId: latency.matchId });
const remail: MatchData[] = [];
rejoined.onMessage((msg) => remail.push(msg));
// A new session rebinds with HELLO; RESYNC only serves the session already bound.
rejoined.send(1, { accountId: latency.ada.hub.userId, protocol: PROTOCOL, sim: SIM, content: FP, interpMs: 100 });
let welcomed = false;
try {
  await until('resync welcome', () => remail.find((msg) => msg.opCode === 2 && msg.json<{ accountId?: string }>().accountId === latency.ada.hub.userId), 4000);
  welcomed = true;
} catch (error) {
  welcomed = false;
  check('reconnect welcome', false, error instanceof Error ? error.message : String(error));
}
if (welcomed) check('reconnect within 10 s keeps the seat', resultOf(latency.seats[1]!) === null, JSON.stringify(resultOf(latency.seats[1]!)));
again.disconnect();
latency.seats[1]!.rt.disconnect();

const stall = await pair();
const quietSeat = stall.seats[1]!.seat;
const activeUntil = Date.now() + 11000;
while (Date.now() < activeUntil && !resultOf(stall.seats[1]!)) {
  await sendDelayed(stall.seats[1]!, 0);
  await sleep(60);
}
await sleep(500);
const forfeited = resultOf(stall.seats[1]!);
const stallRejects = stall.seats[1]!.mail.filter((msg) => msg.opCode === 3).slice(0, 4).map((msg) => msg.json<{ reason?: string }>().reason);
check(
  'a 10 s input stall forfeits that seat',
  !!forfeited && forfeited.outcome === 'forfeit' && forfeited.reason === 'stall' && forfeited.winner === quietSeat && forfeited.ticketsMinted === 0,
  JSON.stringify({ forfeited, stallRejects }),
);
const committed = stall.seats[1]!.mail.find((msg) => msg.opCode === 2)?.json<{ combatCommit?: string }>().combatCommit ?? '';
const revealed = forfeited && forfeited.combatSeed ? createHash('sha256').update(forfeited.combatSeed).digest('hex') : '';
check('RESULT reveals the combat seed committed in WELCOME', !!committed && revealed === committed, JSON.stringify({ committed }));
const leaked = forfeited && forfeited.combatSeed
  ? stall.seats.some((seat) => seat.mail.some((msg) => msg.opCode !== 8 && JSON.stringify(msg.json()).includes(forfeited.combatSeed!)))
  : true;
check('the combat seed is in no message before RESULT', !leaked);
await sleep(400);
const audited = (await call('shooter.metrics', { matchId: stall.matchId }, stall.bea.gameToken)).body as unknown as Metrics;
check(
  'the server replay of the forfeited match verifies',
  !!audited.replay && audited.replay.status === 'done' && audited.replay.verified && audited.replay.stored,
  JSON.stringify(audited.replay ?? audited),
);
stall.seats[0]!.rt.disconnect();
stall.seats[1]!.rt.disconnect();

const drawn = await pair();
await sleep(11000);
const draw = resultOf(drawn.seats[0]!);
check(
  'both quiet seats draw',
  !!draw && draw.outcome === 'draw' && draw.reason === 'both_stall' && draw.winner === null && draw.ticketsMinted === 0,
  JSON.stringify(draw),
);
drawn.seats[0]!.rt.disconnect();
drawn.seats[1]!.rt.disconnect();

const benchAccounts: GameLogin[] = [];
for (let i = 0; i < BENCH_MATCHES * 2; i += 1) benchAccounts.push(await login(GAME));
const before = await Promise.all(benchAccounts.map((session) => ticketBalance(session.hub.userId, GAME)));
const samples: Metrics[] = [];
const rts: HubRealtime[] = [];
const ids: string[] = [];
for (let i = 0; i < BENCH_MATCHES; i += 1) {
  const ada = benchAccounts[i * 2]!;
  const bea = benchAccounts[i * 2 + 1]!;
  const created = await call('shooter.room_create', {}, ada.gameToken);
  const matchId = String(created.body.matchId);
  await call('shooter.room_join', { code: created.body.code }, bea.gameToken);
  const players = [ada, bea];
  const joined: { rt: HubRealtime; match: MatchHandle; mail: MatchData[]; userId: string }[] = [];
  for (const session of players) {
    const rt = socket(session.gameToken);
    await rt.connect();
    const match = await rt.joinMatch({ matchId });
    const mail: MatchData[] = [];
    match.onMessage((msg) => mail.push(msg));
    match.send(1, { accountId: session.hub.userId, protocol: PROTOCOL, sim: SIM, content: FP, interpMs: 100 });
    joined.push({ rt, match, mail, userId: session.hub.userId });
    rts.push(rt);
  }
  for (const seat of joined) {
    await until(`${seat.userId} bench welcome`, () => seat.mail.find((msg) => msg.opCode === 2 && msg.json<{ accountId?: string }>().accountId === seat.userId));
    seat.match.send(4, { accountId: seat.userId });
  }
  ids.push(matchId);
  await call('shooter.metrics', { matchId, reset: true }, ada.gameToken);
}
await sleep(BENCH_MS);
for (let i = 0; i < ids.length; i += 1) {
  // shooter.metrics answers only the match's own seats (or the server's http key).
  const row = await call('shooter.metrics', { matchId: ids[i]! }, benchAccounts[i * 2]!.gameToken);
  samples.push(row.body as unknown as Metrics);
}
for (const rt of rts) rt.disconnect();
const worst = samples.reduce((best, row) => (row.p95 > best ? row.p95 : best), 0);
const snapBytes = samples.reduce((sum, row) => sum + (row.snapBytes || 0), 0);
const snapCount = samples.reduce((sum, row) => sum + (row.snapCount || 0), 0);
check(
  'ten live matches stay under 25 ms p95',
  samples.length === BENCH_MATCHES && samples.every((row) => row.phase === 'live' && row.n >= 40 && row.p95 < 25 && row.ticketsMinted === 0 && row.stake === 0 && !row.error),
  JSON.stringify(samples.map((row) => ({ n: row.n, p95: row.p95, max: row.max, over25: row.over25, phase: row.phase, tick: row.tick, error: row.error }))),
);
const after = await Promise.all(benchAccounts.map((session) => ticketBalance(session.hub.userId, GAME)));
check('bench balances did not move', before.every((value, index) => value === after[index]), `${before.join(',')} -> ${after.join(',')}`);
const watched = [probe, latency.ada, latency.bea, drawn.ada, drawn.bea, ...benchAccounts];
const idsSql = watched.map((session) => `'${session.hub.userId}'`).join(',');
let ledger = '';
try {
  ledger = execFileSync('docker', ['compose', '-f', 'server/docker-compose.yml', 'exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'nakama', '-tAc',
    `SELECT COALESCE(sum(delta), 0) FROM game.tickets_ledger WHERE game_id = '${GAME}' AND user_id IN (${idsSql})`], { encoding: 'utf8' }).trim();
} catch (error) {
  ledger = `unavailable ${error instanceof Error ? error.message : String(error)}`;
}
check('ledger delta for these accounts is zero', ledger === '0', ledger);

const perSnap = snapCount ? Math.round(snapBytes / snapCount) : 0;
const hardware = { cpu: cpus()[0]?.model ?? '', cores: cpus().length, memoryBytes: totalmem(), node: process.version };
const report = {
  failures,
  ledger,
  pin: { commit: PIN.commit, fingerprint: PIN.contentFingerprint, loadoutHash: PIN.loadoutHash, protocol: PIN.protocol, sim: PIN.sim, bundleSha256: PIN.sha256 },
  campaignFingerprint: '73c6eb0f',
  latencyMs: [100, 200],
  jitterMs: [0, 17, 11, 22],
  forfeit: forfeited,
  draw,
  egress: { snapBytes, snapCount, bytesPerSnapshot: perSnap, note: 'JSON snapshot payload only, before websocket framing' },
  bench: { matches: BENCH_MATCHES, ms: BENCH_MS, worstP95: worst, budgetMs: 10, gateMs: 25, samples },
  hardware,
};
console.log(`SHOOTER_REPORT ${JSON.stringify(report)}`);
try {
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  writeFileSync('/opt/cursor/artifacts/shooter-h3s-report.json', `${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  console.log(`report file skipped ${error instanceof Error ? error.message : String(error)}`);
}
if (failures.length) {
  console.error(`${failures.length} shooter bot check(s) failed`);
  process.exit(1);
}
} finally {
  psql(`UPDATE game.server_flags SET state = 'off', allowlist = '{}', percent = 0, updated_at = now() WHERE key = 'shooter_pvp'`);
}
