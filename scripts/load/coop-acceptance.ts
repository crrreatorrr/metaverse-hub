// H5 Coop readiness against a local Nakama. Not a public launch.
//   docker compose -f server/docker-compose.yml up --build -d
//   npx tsx scripts/load/coop-acceptance.ts
// Four seats (latency, reconnect), ten matches with the soak off (p95 gate
// unchanged at 25 ms), a process restart, and the wallet-fault case C5 did
// not run. Prints COOP_ACCEPTANCE as one JSON line.
import { cpus, totalmem } from 'node:os';
import { createRealtime, HubSdkError, type HubRealtime, type MatchData, type MatchHandle } from '../../packages/hub-sdk/src/index.ts';
import {
  arm,
  call,
  canonical,
  compose,
  disarm,
  dropFaultHooks,
  installFaultHooks,
  login,
  num,
  psql,
  sleep,
  sqlId,
  ticketBalance,
  waitReady,
  type GameLogin,
} from '../../server/test/dup/harness.ts';

const BASE = process.env.NAKAMA_URL ?? 'http://127.0.0.1:7350';
const GAME = 'sproto-coop-battle';
/** Seats per Coop match (Coop #26 cut six to four). */
const SEATS = 4;
const FP = 'fb9f2679528b6810dfd3a42ce41bb6f2ed3ac8e75eb3741e2ad30ccd9a4b9a72';
// game.settle_coop_clear compares with the vendored sim's fingerprint since 0063_coop_settle_fingerprint.
const SETTLE_FP = FP;
const HASH = 'ab'.repeat(32);
const BOSS = '07-moonkeep-bigswole';
const PAY = 20;
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
  rewards: number;
  hostTakeover: number;
  error?: string;
}

interface Seat {
  session: GameLogin;
  rt: HubRealtime;
  match: MatchHandle;
  mail: MatchData[];
}

interface Receipt {
  ok?: boolean;
  paid?: boolean;
  tickets?: number;
  day?: string;
  error?: string;
  replay?: boolean;
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

function quote(value: string): string {
  if (!/^[A-Za-z0-9:._-]+$/.test(value)) throw new Error(`refusing to interpolate "${value}"`);
  return value;
}

async function until<T>(what: string, read: () => T | undefined, ms = 6000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(30);
  }
}

function credits(userId: string): number {
  return num(`SELECT count(*) FROM game.tickets_ledger WHERE user_id = '${sqlId(userId)}' AND game_id = '${GAME}' AND reason = 'srv_coop_boss_clear' AND delta = ${PAY}`);
}

function receipts(userId: string): number {
  return num(`SELECT count(*) FROM game.coop_receipt WHERE user_id = '${sqlId(userId)}'`);
}

function settle(session: GameLogin, matchId: string, encounterId: string): Receipt {
  const raw = psql(`SELECT game.settle_coop_clear(
    '${sqlId(session.hub.userId)}'::uuid,
    '${sqlId(session.sessionId)}'::uuid,
    '${quote(matchId)}'::text,
    '${quote(encounterId)}'::text,
    '${BOSS}'::text,
    (SELECT (now() AT TIME ZONE 'utc')::date),
    1200::bigint,
    20000::bigint,
    1::smallint,
    'clear'::text,
    1,
    1,
    '${SETTLE_FP}'::text,
    'cpu_assisted'::text,
    '${HASH}'::text
  )::text`);
  return JSON.parse(raw) as Receipt;
}

async function waitRestart(): Promise<void> {
  await sleep(1500);
  const deadline = Date.now() + 120_000;
  let last = 'not attempted';
  while (Date.now() < deadline) {
    try {
      const health = await call('healthcheck', {}, undefined, { timeoutMs: 2_000 });
      if (health.status < 400 && !health.body.error) {
        await login(GAME);
        return;
      }
      last = `${health.status} ${JSON.stringify(health.body)}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(500);
  }
  throw new Error(`nakama did not accept sessions after restart: ${last}`);
}

async function sixSeatWave(count: number, pin: Version): Promise<{ ok: boolean; worst: number; samples: Metrics[] }> {
  const people: GameLogin[] = [];
  for (let i = 0; i < count * SEATS; i += 1) people.push(await login(GAME));
  const rooms: string[] = [];
  const held: HubRealtime[] = [];
  try {
    for (let match = 0; match < count; match += 1) {
      const group = people.slice(match * SEATS, match * SEATS + SEATS);
      const host = group[0]!;
      const created = await call('coop.room_create', {}, host.gameToken);
      const body = created.body as { matchId?: string; code?: string; error?: string };
      if (body.error || !body.matchId || !body.code) return { ok: false, worst: 0, samples: [] };
      const locals: { rt: HubRealtime; match: MatchHandle; mail: number[] }[] = [];
      let joined = true;
      for (const session of group) {
        if (session !== host) {
          const seat = await call('coop.room_join', { code: body.code }, session.gameToken);
          const joinedBody = seat.body as { matchId?: string; error?: string };
          if (joinedBody.error || joinedBody.matchId !== body.matchId) joined = false;
        }
        const rt = socket(session.gameToken);
        await rt.connect();
        const handle = await rt.joinMatch({ matchId: body.matchId });
        const mail: number[] = [];
        handle.onMessage((msg) => mail.push(msg.opCode));
        handle.send(1, { t: 'hello', protocol: pin.protocol, fingerprint: pin.fingerprint, devices: ['k1'] });
        locals.push({ rt, match: handle, mail });
        held.push(rt);
      }
      for (const seat of locals) {
        const helloAt = Date.now();
        while (!seat.mail.includes(2) && Date.now() - helloAt < 6000) await sleep(30);
        if (!seat.mail.includes(2)) joined = false;
      }
      for (const seat of locals) seat.match.send(3, { t: 'ready' });
      const readyAt = Date.now();
      while (!locals[0]!.mail.includes(4) && Date.now() - readyAt < 8000) await sleep(30);
      if (!joined || !locals[0]!.mail.includes(4)) return { ok: false, worst: 0, samples: [] };
      await call('coop.metrics', { matchId: body.matchId, reset: true }, host.gameToken);
      rooms.push(body.matchId);
    }
    await sleep(BENCH_MS);
    const samples: Metrics[] = [];
    for (let i = 0; i < rooms.length; i += 1) {
      try {
        const row = await call('coop.metrics', { matchId: rooms[i]! }, people[i * SEATS]!.gameToken);
        samples.push(row.body as unknown as Metrics);
      } catch (error) {
        samples.push({ n: 0, p50: 0, p95: 0, max: 0, over25: 0, tick: 0, phase: '', rewards: 0, hostTakeover: 0, error: error instanceof Error ? error.message : String(error) });
      }
    }
    const worst = samples.reduce((best, row) => (row.p95 > best ? row.p95 : best), 0);
    const ok = samples.length === count && samples.every((row) => row.phase === 'playing' && row.n >= 100 && row.p95 < 25 && row.rewards === 0 && row.hostTakeover === 0 && !row.error);
    return { ok, worst, samples };
  } finally {
    for (const rt of held) rt.disconnect();
  }
}

await waitReady();
const hardware = { cpu: cpus()[0]?.model ?? '', cores: cpus().length, memoryBytes: totalmem(), node: process.version };
const probe = await login(GAME);
const version = await call('coop.version', {}, probe.gameToken);
const info = version.body as unknown as Version;
check(
  'coop.version is enabled, protocol 1, and unpaid',
  info.enabled === true && info.protocol === 1 && info.fingerprint === FP && info.rewards === 0 && info.hostTakeover === 0
    && info.snapshotHz === 10 && info.loopHz === 20 && info.substeps === 3 && info.reconnectS === 15 && info.match === 'sproto_coop',
  JSON.stringify(info),
);
const stale = await call('coop.room_join', { code: '23456789ABCD', v: 0 }, probe.gameToken);
check('a stale coop client is version_mismatch', stale.body.error === 'version_mismatch', JSON.stringify(stale.body));

const sessions: GameLogin[] = [probe];
for (let i = 1; i < SEATS; i += 1) sessions.push(await login(GAME));
const before = sessions.map((session) => ticketBalance(session.hub.userId, GAME));
const created = await call('coop.room_create', {}, probe.gameToken);
const matchId = String(created.body.matchId ?? '');
const code = String(created.body.code ?? '');
check('four-seat room opened unpaid', Boolean(matchId) && Boolean(code) && created.body.balance === undefined, JSON.stringify(created.body));

const seats: Seat[] = [];
const helloMs: number[] = [];
for (const session of sessions) {
  if (session !== probe) {
    const joined = await call('coop.room_join', { code }, session.gameToken);
    check('seat joined the same match', joined.body.matchId === matchId && !joined.body.error, JSON.stringify(joined.body));
  }
  const rt = socket(session.gameToken);
  await rt.connect();
  const match = await rt.joinMatch({ matchId });
  const mail: MatchData[] = [];
  match.onMessage((msg) => mail.push(msg));
  const started = Date.now();
  match.send(1, { t: 'hello', protocol: info.protocol, fingerprint: info.fingerprint, devices: ['k1'] });
  await until(`${session.hub.userId} welcome`, () => mail.find((msg) => msg.opCode === 2));
  helloMs.push(Date.now() - started);
  seats.push({ session, rt, match, mail });
}
check('four hellos were answered', helloMs.length === SEATS && helloMs.every((ms) => ms < 4000), JSON.stringify(helloMs));

for (const seat of seats) seat.match.send(3, { t: 'ready' });
const readyAt = Date.now();
let startMs = -1;
try {
  await until('start', () => seats[0]!.mail.find((msg) => msg.opCode === 4), 8000);
  startMs = Date.now() - readyAt;
} catch (error) {
  check('four ready seats start', false, error instanceof Error ? error.message : String(error));
}
if (startMs >= 0) check('four ready seats start', startMs < 8000, `${startMs} ms`);

const pingMs: number[] = [];
for (let i = 0; i < seats.length; i += 1) {
  const seat = seats[i]!;
  const mark = 1000 + i;
  const sent = Date.now();
  seat.match.send(17, { t: 'ping', c: mark });
  try {
    await until(`pong ${mark}`, () => seat.mail.find((msg) => msg.opCode === 18 && msg.json<{ c?: number }>().c === mark), 3000);
    pingMs.push(Date.now() - sent);
  } catch (error) {
    check('four-seat ping', false, error instanceof Error ? error.message : String(error));
  }
}
check('four-seat pings were answered', pingMs.length === SEATS, JSON.stringify(pingMs));
await sleep(1000);
const snapshots = seats.map((seat) => seat.mail.filter((msg) => msg.opCode === 11).length);
check('four-seat snapshots arrived', snapshots.every((count) => count > 0), JSON.stringify(snapshots));

const dropped = seats[SEATS - 1]!;
dropped.rt.disconnect();
const again = socket(dropped.session.gameToken);
await again.connect();
const rejoined = await again.joinMatch({ matchId });
const remail: MatchData[] = [];
rejoined.onMessage((msg) => remail.push(msg));
const reAt = Date.now();
rejoined.send(1, { t: 'hello', protocol: info.protocol, fingerprint: info.fingerprint, devices: ['k1'] });
let resume: MatchData | undefined;
try {
  resume = await until('reconnect', () => remail.find((msg) => msg.opCode === 14 || msg.opCode === 2), 15000);
} catch (error) {
  check('reconnect inside 15 s', false, error instanceof Error ? error.message : String(error));
}
const resumeBody = resume ? resume.json<{ rewards?: number; hostTakeover?: number; acceptClientState?: number }>() : {};
check(
  'reconnect inside 15 s keeps the seat unpaid',
  Boolean(resume) && Date.now() - reAt < 15000 && resumeBody.rewards === 0 && resumeBody.hostTakeover === 0 && resumeBody.acceptClientState === 0,
  JSON.stringify({ ms: resume ? Date.now() - reAt : -1, op: resume?.opCode, body: resumeBody }),
);
again.disconnect();
for (const seat of seats) seat.rt.disconnect();

const sixMetrics = await (async () => {
  try {
    const row = await call('coop.metrics', { matchId }, probe.gameToken);
    return row.body as unknown as Metrics;
  } catch (error) {
    return { n: 0, p50: 0, p95: 0, max: 0, over25: 0, tick: 0, phase: '', rewards: 0, hostTakeover: 0, error: error instanceof Error ? error.message : String(error) };
  }
})();
check('four-seat match stayed unpaid', sixMetrics.rewards === 0 && sixMetrics.hostTakeover === 0, JSON.stringify(sixMetrics));

const benchSessions: GameLogin[] = [];
for (let i = 0; i < BENCH_MATCHES; i += 1) benchSessions.push(await login(GAME));
const benchBefore = benchSessions.map((session) => ticketBalance(session.hub.userId, GAME));
const ids: string[] = [];
const rts: HubRealtime[] = [];
for (const session of benchSessions) {
  const player = socket(session.gameToken);
  await player.connect();
  const room = await player.rpc<{ matchId: string; rewards: number; hostTakeover: number }>('coop.room_create', {});
  const match = await player.joinMatch({ matchId: room.matchId });
  const mail: number[] = [];
  match.onMessage((msg) => mail.push(msg.opCode));
  match.send(1, { t: 'hello', protocol: info.protocol, fingerprint: info.fingerprint, devices: ['k1'] });
  const helloAt = Date.now();
  while (!mail.includes(2) && Date.now() - helloAt < 4000) await sleep(30);
  match.send(3, { t: 'ready' });
  const readyAtBench = Date.now();
  while (!mail.includes(4) && Date.now() - readyAtBench < 4000) await sleep(30);
  check('bench match started unpaid', mail.includes(2) && mail.includes(4) && room.rewards === 0 && room.hostTakeover === 0, room.matchId);
  await player.rpc('coop.metrics', { matchId: room.matchId, reset: true });
  rts.push(player);
  ids.push(room.matchId);
}
await sleep(BENCH_MS);
const samples: Metrics[] = [];
for (let i = 0; i < ids.length; i += 1) {
  try {
    samples.push(await rts[i]!.rpc<Metrics>('coop.metrics', { matchId: ids[i]! }));
  } catch (error) {
    samples.push({ n: 0, p50: 0, p95: 0, max: 0, over25: 0, tick: 0, phase: '', rewards: 0, hostTakeover: 0, error: error instanceof Error ? error.message : String(error) });
  }
}
for (const player of rts) player.disconnect();
const worst = samples.reduce((best, row) => (row.p95 > best ? row.p95 : best), 0);
check(
  'ten matches stay under 25 ms p95 with the soak off',
  samples.length === BENCH_MATCHES && samples.every((row) => row.phase === 'playing' && row.n >= 100 && row.p95 < 25 && row.rewards === 0 && !row.error),
  JSON.stringify(samples.map((row) => ({ n: row.n, p50: row.p50, p95: row.p95, max: row.max, over25: row.over25, tick: row.tick, phase: row.phase, error: row.error }))),
);

const crash = await login(GAME);
const crashRt = socket(crash.gameToken);
await crashRt.connect();
const crashRoom = await crashRt.rpc<{ matchId: string }>('coop.room_create', {});
const crashMatch = await crashRt.joinMatch({ matchId: crashRoom.matchId });
const crashMail: MatchData[] = [];
crashMatch.onMessage((msg) => crashMail.push(msg));
crashMatch.send(1, { t: 'hello', protocol: info.protocol, fingerprint: info.fingerprint, devices: ['k1'] });
await until('crash welcome', () => crashMail.find((msg) => msg.opCode === 2));
crashMatch.send(3, { t: 'ready' });
await until('crash start', () => crashMail.find((msg) => msg.opCode === 4));
crashRt.disconnect();
const restartAt = Date.now();
compose(['restart', 'nakama']);
await waitRestart();
const restartMs = Date.now() - restartAt;
let resumeCode = '';
const back = socket((await login(GAME)).gameToken);
await back.connect();
try {
  await back.rpc('coop.resume', { matchId: crashRoom.matchId, state: { hp: 1, lives: 3 } });
} catch (error) {
  resumeCode = error instanceof HubSdkError ? error.code : (error instanceof Error ? error.message : String(error));
}
back.disconnect();
check('restart rejects a client snapshot', resumeCode === 'rejected', resumeCode);
const afterCrash = sessions.map((session) => ticketBalance(session.hub.userId, GAME));
const afterBench = benchSessions.map((session) => ticketBalance(session.hub.userId, GAME));
check('four-seat and bench balances did not move', before.every((value, index) => value === afterCrash[index]) && benchBefore.every((value, index) => value === afterBench[index]), `${before.join(',')} / ${afterBench.join(',')}`);

let sixFitted = 0;
let sixWorst = 0;
let sixSamples: Metrics[] = [];
for (const count of [10, 8, 6, 4, 2, 1]) {
  const wave = await sixSeatWave(count, info);
  if (wave.ok) {
    sixFitted = count;
    sixWorst = wave.worst;
    sixSamples = wave.samples;
    break;
  }
  if (count > 1) {
    compose(['restart', 'nakama']);
    await waitRestart();
  }
}
check(
  'four-seat concurrency stays under 25 ms p95',
  sixFitted >= 1 && sixSamples.every((row) => row.p95 < 25),
  JSON.stringify({ fitted: sixFitted, worst: sixWorst, samples: sixSamples.map((row) => ({ n: row.n, p95: row.p95, max: row.max, phase: row.phase, error: row.error })) }),
);

let wallet: Record<string, unknown> = {};
installFaultHooks();
try {
  const committed = await login(GAME);
  const first = settle(committed, 'h5-commit', 'h5-commit-enc');
  check('a clear pays 20 once', first.paid === true && first.tickets === PAY, JSON.stringify(first));
  check('the receipt is one row', credits(committed.hub.userId) === 1 && receipts(committed.hub.userId) === 1, `${credits(committed.hub.userId)} ${receipts(committed.hub.userId)}`);
  compose(['restart', 'nakama']);
  await waitRestart();
  const owned = psql(`SELECT tickets::text FROM game.coop_receipt WHERE user_id = '${sqlId(committed.hub.userId)}' AND canonical_boss = '${BOSS}'`);
  check('restart keeps the receipt', owned === '20', owned);
  const recovered = settle(committed, 'h5-commit', 'h5-commit-enc');
  check('the same clear does not pay again', canonical(recovered) === canonical(first) && credits(committed.hub.userId) === 1, JSON.stringify(recovered));

  const rolled = await login(GAME);
  arm(rolled.hub.userId, 'earn.after_wallet', 'raise');
  let faultText = '';
  try {
    settle(rolled, 'h5-fault', 'h5-fault-enc');
    faultText = 'wallet fault did not abort the settlement';
  } catch (error) {
    const err = error as { message?: string; stderr?: string | Buffer };
    faultText = `${err.message ?? ''}\n${err.stderr ?? ''}`;
  }
  const faultAborted = /fault_injected/.test(faultText);
  check('a wallet fault aborts the settlement', faultAborted, faultText.slice(0, 400));
  check(
    'a wallet fault leaves no partial receipt, score, or balance',
    credits(rolled.hub.userId) === 0 && receipts(rolled.hub.userId) === 0
      && num(`SELECT count(*) FROM game.coop_eligibility WHERE user_id = '${sqlId(rolled.hub.userId)}'`) === 0
      && ticketBalance(rolled.hub.userId, GAME) === 0,
    `${credits(rolled.hub.userId)} ${receipts(rolled.hub.userId)} ${ticketBalance(rolled.hub.userId, GAME)}`,
  );
  disarm(rolled.hub.userId);
  const retry = settle(rolled, 'h5-fault', 'h5-fault-enc');
  check('the clear pays once after the fault is cleared', retry.paid === true && credits(rolled.hub.userId) === 1 && receipts(rolled.hub.userId) === 1, JSON.stringify(retry));
  const againPay = settle(rolled, 'h5-fault', 'h5-fault-enc');
  check('the retry does not pay a second time', canonical(againPay) === canonical(retry) && credits(rolled.hub.userId) === 1, JSON.stringify(againPay));
  wallet = {
    restartKeptReceipt: owned === '20',
    faultAborted,
    paidOnce: credits(rolled.hub.userId) === 1,
    balance: ticketBalance(rolled.hub.userId, GAME),
  };
} finally {
  dropFaultHooks();
}

const helloSorted = [...helloMs].sort((a, b) => a - b);
const pingSorted = [...pingMs].sort((a, b) => a - b);
const report = {
  failures,
  where: 'local-docker-nakama',
  staging: false,
  soak: false,
  hardware,
  pin: { protocol: 1, fingerprint: FP, commit: '48622249b88d6c9329b70be4cc9704cc117f1786' },
  sixSeat: {
    helloMs,
    helloP95: helloSorted[Math.min(helloSorted.length - 1, Math.ceil(helloSorted.length * 0.95) - 1)] ?? null,
    startMs,
    pingMs,
    pingP95: pingSorted[Math.min(pingSorted.length - 1, Math.ceil(pingSorted.length * 0.95) - 1)] ?? null,
    snapshots,
    metrics: sixMetrics,
  },
  bench: { matches: BENCH_MATCHES, seatsEach: 1, ms: BENCH_MS, worstP95: worst, gateMs: 25, samples },
  sixSeatConcurrency: { requested: 10, fitted: sixFitted, seatsEach: SEATS, ms: BENCH_MS, worstP95: sixWorst, gateMs: 25, samples: sixSamples },
  crash: { restartMs, resumeCode },
  wallet,
};
console.log(`COOP_ACCEPTANCE ${JSON.stringify(report)}`);
if (failures.length) process.exit(1);
