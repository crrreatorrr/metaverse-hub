// H5 Shooter readiness against a local Nakama. Not a public launch.
//   docker compose -f server/docker-compose.yml up --build -d
//   npx tsx scripts/load/shooter-acceptance.ts
// 1v1 latency and reconnect, ten live matches under the existing 25 ms p95
// gate, a version mismatch, and a rollback: flags off stop a new hold, a
// restart refunds the held pot once, and no hold is left behind. Prints
// SHOOTER_ACCEPTANCE as one JSON line. Flags are allowlisted only in this
// process's database session and put back to off before the script exits.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { join } from 'node:path';
import { createRealtime, type HubRealtime, type MatchData, type MatchHandle } from '../../packages/hub-sdk/src/index.ts';
import {
  call,
  compose,
  guest,
  login,
  num,
  openGame,
  psql,
  psqlFile,
  sleep,
  sqlId,
  ticketBalance,
  waitReady,
  type GameLogin,
  type Guest,
} from '../../server/test/dup/harness.ts';

const BASE = process.env.NAKAMA_URL ?? 'http://127.0.0.1:7350';
const CADDY = process.env.CADDY_URL ?? 'http://127.0.0.1:8080';
const GAME = 'sproto-shooter';
const FP = 'e749d2fd';
const PROTOCOL = 2;
const SIM = 2;
const ROOT = process.cwd();
const BENCH_MATCHES = 10;
const BENCH_MS = 4000;

interface Version {
  protocol: number;
  sim: number;
  content: string;
  stake: number;
  ticketsMinted: number;
  match: string;
  commit: string;
  bundleSha256: string;
  wagerEnabled: boolean;
}

interface Metrics {
  n: number;
  p50: number;
  p95: number;
  max: number;
  phase: string;
  tick: number;
  ticketsMinted: number;
  stake: number;
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

function socket(token: string, base = BASE): HubRealtime {
  return createRealtime({ serverUrl: base, getToken: () => token, reconnect: false });
}

function quoteId(value: string): string {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(value)) throw new Error(`bad id ${value}`);
  return value;
}

async function until<T>(what: string, read: () => T | undefined, ms = 6000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(40);
  }
}

function fund(userId: string, amount: number, label: string): void {
  if (!Number.isInteger(amount) || amount <= 0 || amount > 1000) throw new Error(`bad credit ${amount}`);
  if (!/^w[a-z0-9-]{1,40}$/.test(label)) throw new Error(`bad fund label ${label}`);
  psql(
    `INSERT INTO game.idempotency (user_id, key, rpc, req_hash, response)
     VALUES ('${sqlId(userId)}', '${label}', 'tickets.earn', decode('00', 'hex'), '{}'::jsonb);
     INSERT INTO game.tickets_ledger (event_id, user_id, game_id, delta, balance_after, reason, kind)
     VALUES (
       gen_random_uuid(), '${sqlId(userId)}', '${GAME}', ${amount},
       COALESCE((SELECT balance FROM game.tickets_balance WHERE user_id = '${sqlId(userId)}' AND game_id = '${GAME}'), 0) + ${amount},
       'shooter_fund', 'earn'
     );
     INSERT INTO game.tickets_balance (user_id, game_id, balance)
     VALUES (
       '${sqlId(userId)}', '${GAME}',
       COALESCE((SELECT balance FROM game.tickets_balance WHERE user_id = '${sqlId(userId)}' AND game_id = '${GAME}'), 0) + ${amount}
     )
     ON CONFLICT (user_id, game_id) DO UPDATE SET balance = game.tickets_balance.balance + ${amount}`,
  );
}

async function claimed(): Promise<GameLogin> {
  const who: Guest = await guest();
  const tag = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  const res = await call('account.claim', {
    username: `u${tag}`,
    email: `u${tag}@example.com`,
    password: 'correct-horse-1',
  }, who.token);
  const body = res.body as { claimed?: boolean };
  if (body.claimed !== true) throw new Error(JSON.stringify(res.body));
  return openGame(who.token, GAME);
}

function flagsOff(): string {
  return psql(`SELECT string_agg(key || '=' || state, ',' ORDER BY key) FROM game.server_flags WHERE key IN ('shooter_pvp', 'shooter_pvp_wager', 'shooter_pvp_ranked')`);
}

function setWagerFlags(state: 'off' | 'allowlist', ids: string[] = []): void {
  const list = ids.length ? `ARRAY[${ids.map((id) => `'${sqlId(id)}'`).join(',')}]::uuid[]` : `'{}'::uuid[]`;
  psql(`UPDATE game.server_flags
    SET state = '${state}', allowlist = ${list}, percent = 0, updated_at = now()
    WHERE key IN ('shooter_pvp', 'shooter_pvp_wager')`);
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

function readText(path: string): string {
  return readFileSync(path, 'utf8');
}

function edge(): { caddy: string[]; cors: string; ws: string; secrets: string } {
  const caddy = readText(join(ROOT, 'deploy/Caddyfile'));
  const rules = [
    ['html no-cache', caddy.includes('Cache-Control "no-cache"')],
    ['hashed immutable', caddy.includes('public, max-age=31536000, immutable')],
    ['wasm mime', caddy.includes('Content-Type "application/wasm"')],
    ['api no-store', caddy.includes('Cache-Control "no-store"')],
    ['wss upstream', caddy.includes('handle /ws*') && caddy.includes('reverse_proxy 127.0.0.1:7350')],
    ['https cert', caddy.includes('tls /etc/caddy/certs/origin.pem')],
    ['hsts', caddy.includes('Strict-Transport-Security')],
    ['shooter path', caddy.includes('import game sproto-shooter')],
    ['coop path', caddy.includes('import game sproto-coop-battle')],
    ['nosniff', caddy.includes('X-Content-Type-Options nosniff')],
  ] as const;
  for (const [name, ok] of rules) check(`caddy ${name}`, ok);
  let cors = 'not-reached';
  try {
    const response = execFileSync('curl', ['-sS', '-D', '-', '-o', '/dev/null', '-X', 'OPTIONS', `${CADDY}/v2/healthcheck`], { encoding: 'utf8', timeout: 5000 });
    cors = response;
    check('local caddy answers CORS preflight', /204/.test(response) && /access-control-allow-origin:\s*\*/i.test(response), response.split('\n').slice(0, 8).join(' | '));
  } catch (error) {
    cors = error instanceof Error ? error.message : String(error);
    check('local caddy answers CORS preflight', false, cors);
  }
  return { caddy: rules.filter((rule) => rule[1]).map((rule) => rule[0]), cors: cors.split('\n')[0] ?? cors, ws: '', secrets: '' };
}

await waitReady();
const hardware = { cpu: cpus()[0]?.model ?? '', cores: cpus().length, memoryBytes: totalmem(), node: process.version };
const probe = await login(GAME);
const version = await call('shooter.version', {}, probe.gameToken);
const info = version.body as unknown as Version;
check(
  'shooter.version is protocol 2 / sim 2 and unpaid',
  info.match === 'sproto_shooter_free' && info.protocol === PROTOCOL && info.sim === SIM && info.content === FP
    && info.stake === 0 && info.ticketsMinted === 0 && info.wagerEnabled === false,
  JSON.stringify(info),
);
const stale = await call('shooter.room_create', { v: 1 }, probe.gameToken);
check('a stale shooter client is version_mismatch', stale.body.error === 'version_mismatch', JSON.stringify(stale.body));
const flagsAtStart = flagsOff();
check('launch flags start off', flagsAtStart === 'shooter_pvp=off,shooter_pvp_ranked=off,shooter_pvp_wager=off', flagsAtStart);
const blocked = await call('shooter.room_create', {}, probe.gameToken);
check('shooter_pvp off refuses a new free room', blocked.body.error === 'pvp_off', JSON.stringify(blocked.body));
psql(`UPDATE game.server_flags SET state = 'on', allowlist = '{}', percent = 0, updated_at = now() WHERE key = 'shooter_pvp'`);
await sleep(6500);

const ada = await login(GAME);
const bea = await login(GAME);
const adaBefore = ticketBalance(ada.hub.userId, GAME);
const beaBefore = ticketBalance(bea.hub.userId, GAME);
const created = await call('shooter.room_create', {}, ada.gameToken);
const matchId = String(created.body.matchId ?? '');
check('free room is stake 0', created.body.stake === 0 && Boolean(matchId), JSON.stringify(created.body));
await call('shooter.room_join', { code: created.body.code, v: PROTOCOL, sim: SIM, content: FP }, bea.gameToken);
const players = [ada, bea];
const seats: { rt: HubRealtime; match: MatchHandle; mail: MatchData[]; userId: string }[] = [];
for (const session of players) {
  const rt = socket(session.gameToken);
  await rt.connect();
  const match = await rt.joinMatch({ matchId });
  const mail: MatchData[] = [];
  match.onMessage((msg) => mail.push(msg));
  match.send(1, { accountId: session.hub.userId, protocol: PROTOCOL, sim: SIM, content: FP, interpMs: 100 });
  seats.push({ rt, match, mail, userId: session.hub.userId });
}
for (const seat of seats) {
  await until(`${seat.userId} welcome`, () => seat.mail.find((msg) => msg.opCode === 2 && msg.json<{ accountId?: string }>().accountId === seat.userId));
  seat.match.send(4, { accountId: seat.userId });
}
await until('live', () => seats[0]!.mail.find((msg) => msg.opCode === 5 && msg.json<{ phase?: string }>().phase === 'live'));
const pingMs: number[] = [];
for (let i = 0; i < 8; i += 1) {
  const mark = 5000 + i;
  const sent = Date.now();
  seats[0]!.match.send(10, { t: mark });
  await until(`pong ${mark}`, () => seats[0]!.mail.find((msg) => msg.opCode === 11 && msg.json<{ t?: number }>().t === mark));
  pingMs.push(Date.now() - sent);
  await sleep(40);
}
const otherPongs = seats[1]!.mail.filter((msg) => msg.opCode === 11 && (msg.json<{ t?: number }>().t ?? 0) >= 5000).length;
check('1v1 pongs stay on the pinger', otherPongs === 0 && pingMs.length === 8, JSON.stringify({ pingMs, otherPongs }));
seats[0]!.rt.disconnect();
const again = socket(ada.gameToken);
await again.connect();
const rejoined = await again.joinMatch({ matchId });
const remail: MatchData[] = [];
rejoined.onMessage((msg) => remail.push(msg));
const reAt = Date.now();
rejoined.send(1, { accountId: ada.hub.userId, protocol: PROTOCOL, sim: SIM, content: FP, interpMs: 100 });
let welcomed = false;
try {
  await until('reconnect welcome', () => remail.find((msg) => msg.opCode === 2 && msg.json<{ accountId?: string }>().accountId === ada.hub.userId), 4000);
  welcomed = true;
} catch (error) {
  check('1v1 reconnect', false, error instanceof Error ? error.message : String(error));
}
if (welcomed) check('1v1 reconnect keeps the free match', Date.now() - reAt < 10000, `${Date.now() - reAt} ms`);
again.disconnect();
seats[1]!.rt.disconnect();

const benchSessions: GameLogin[] = [];
for (let i = 0; i < BENCH_MATCHES * 2; i += 1) benchSessions.push(await login(GAME));
const benchBefore = benchSessions.map((session) => ticketBalance(session.hub.userId, GAME));
const ids: string[] = [];
const rts: HubRealtime[] = [];
for (let i = 0; i < BENCH_MATCHES; i += 1) {
  const left = benchSessions[i * 2]!;
  const right = benchSessions[i * 2 + 1]!;
  const room = await call('shooter.room_create', {}, left.gameToken);
  const id = String(room.body.matchId);
  await call('shooter.room_join', { code: room.body.code }, right.gameToken);
  const joined: { match: MatchHandle; mail: MatchData[]; userId: string }[] = [];
  for (const session of [left, right]) {
    const rt = socket(session.gameToken);
    await rt.connect();
    const match = await rt.joinMatch({ matchId: id });
    const mail: MatchData[] = [];
    match.onMessage((msg) => mail.push(msg));
    match.send(1, { accountId: session.hub.userId, protocol: PROTOCOL, sim: SIM, content: FP, interpMs: 100 });
    joined.push({ match, mail, userId: session.hub.userId });
    rts.push(rt);
  }
  for (const seat of joined) {
    await until(`${seat.userId} bench welcome`, () => seat.mail.find((msg) => msg.opCode === 2 && msg.json<{ accountId?: string }>().accountId === seat.userId));
    seat.match.send(4, { accountId: seat.userId });
  }
  ids.push(id);
  await call('shooter.metrics', { matchId: id, reset: true }, left.gameToken);
}
await sleep(BENCH_MS);
const samples: Metrics[] = [];
for (let i = 0; i < ids.length; i += 1) {
  const row = await call('shooter.metrics', { matchId: ids[i]! }, benchSessions[i * 2]!.gameToken);
  samples.push(row.body as unknown as Metrics);
}
for (const rt of rts) rt.disconnect();
const worst = samples.reduce((best, row) => (row.p95 > best ? row.p95 : best), 0);
check(
  'ten live matches stay under 25 ms p95',
  samples.length === BENCH_MATCHES && samples.every((row) => row.phase === 'live' && row.n >= 40 && row.p95 < 25 && row.ticketsMinted === 0 && row.stake === 0 && !row.error),
  JSON.stringify(samples.map((row) => ({ n: row.n, p95: row.p95, max: row.max, phase: row.phase, tick: row.tick, error: row.error }))),
);

psql(`UPDATE game.server_flags SET state = 'off', allowlist = '{}', percent = 0, updated_at = now() WHERE key = 'shooter_pvp'`);
await sleep(6500);
const stopped = await call('shooter.room_create', {}, ada.gameToken);
check('turning shooter_pvp off stops another free room', stopped.body.error === 'pvp_off', JSON.stringify(stopped.body));

let rollback: Record<string, unknown> = {};
const flagsBefore = flagsOff();
check('launch flags are off before the wager drill', flagsBefore === 'shooter_pvp=off,shooter_pvp_ranked=off,shooter_pvp_wager=off', flagsBefore);
try {
  const host = await claimed();
  const rival = await claimed();
  const tag = host.hub.userId.replace(/-/g, '').slice(0, 8);
  fund(host.hub.userId, 20, `wh${tag}`);
  fund(rival.hub.userId, 20, `wr${tag}`);
  const startHost = ticketBalance(host.hub.userId, GAME);
  const startRival = ticketBalance(rival.hub.userId, GAME);
  setWagerFlags('allowlist', [host.hub.userId, rival.hub.userId]);
  await sleep(6500);
  const room = await call('shooter.room_create', { mode: 'wager' }, host.gameToken);
  const wagerId = String(room.body.matchId ?? '');
  check('allowlisted pair can open a wager room', !room.body.error && room.body.stake === 10 && Boolean(wagerId), JSON.stringify(room.body));
  const joined = await call('shooter.room_join', { code: room.body.code }, rival.gameToken);
  check('rival joined the wager room', joined.body.matchId === wagerId && !joined.body.error, JSON.stringify(joined.body));
  const wagerSeats: { rt: HubRealtime; match: MatchHandle; mail: MatchData[]; userId: string }[] = [];
  for (const session of [host, rival]) {
    const rt = socket(session.gameToken);
    await rt.connect();
    const match = await rt.joinMatch({ matchId: wagerId });
    const mail: MatchData[] = [];
    match.onMessage((msg) => mail.push(msg));
    match.send(1, { accountId: session.hub.userId, protocol: PROTOCOL, sim: SIM, content: FP, interpMs: 100 });
    wagerSeats.push({ rt, match, mail, userId: session.hub.userId });
  }
  for (const seat of wagerSeats) {
    await until(`${seat.userId} wager welcome`, () => seat.mail.find((msg) => msg.opCode === 2));
    seat.match.send(4, { accountId: seat.userId });
  }
  let status = 'missing';
  const holdDeadline = Date.now() + 8000;
  while (Date.now() < holdDeadline && status !== 'held') {
    status = psql(`SELECT COALESCE((SELECT status FROM game.shooter_wager WHERE match_id = '${quoteId(wagerId)}'), 'missing')`);
    if (status !== 'held') await sleep(100);
  }
  const heldHost = ticketBalance(host.hub.userId, GAME);
  const heldRival = ticketBalance(rival.hub.userId, GAME);
  const pot = num(`SELECT COALESCE(sum(stake * 2), 0) FROM game.shooter_wager WHERE match_id = '${quoteId(wagerId)}' AND status = 'held'`);
  check('both seats are held at 10 and the pot is 20', status === 'held' && heldHost === startHost - 10 && heldRival === startRival - 10 && pot === 20, `${status} ${heldHost} ${heldRival} pot ${pot}`);
  check('drift is zero while the pot is held', num('SELECT game.shooter_wager_drift()') === 0, String(num('SELECT game.shooter_wager_drift()')));
  for (const seat of wagerSeats) seat.rt.disconnect();
  setWagerFlags('off');
  await sleep(6500);
  const refused = await call('shooter.room_create', { mode: 'wager' }, host.gameToken);
  check('flags off refuse a new hold', refused.body.error === 'stakes_disabled', JSON.stringify(refused.body));
  const heldBeforeRestart = num(`SELECT count(*) FROM game.shooter_wager WHERE status = 'held'`);
  const restartAt = Date.now();
  compose(['restart', 'nakama']);
  await waitRestart();
  const restartMs = Date.now() - restartAt;
  const closed = psql(`SELECT status || ' ' || COALESCE(reason, '') FROM game.shooter_wager WHERE match_id = '${quoteId(wagerId)}'`);
  const heldAfter = num(`SELECT count(*) FROM game.shooter_wager WHERE status = 'held'`);
  const locks = num(`SELECT count(*) FROM game.shooter_wager_active WHERE match_id = '${quoteId(wagerId)}'`);
  const endHost = ticketBalance(host.hub.userId, GAME);
  const endRival = ticketBalance(rival.hub.userId, GAME);
  const drift = num('SELECT game.shooter_wager_drift()');
  check('restart refunds the held pot once', closed.startsWith('refunded'), closed);
  check('no orphaned hold remains for that match', locks === 0 && heldAfter <= heldBeforeRestart && !closed.startsWith('held'), `locks ${locks} held ${heldBeforeRestart}->${heldAfter} ${closed}`);
  check('both wallets are back to their start and drift is zero', endHost === startHost && endRival === startRival && drift === 0, `${endHost} ${endRival} drift ${drift}`);
  check('free 1v1 balances did not move across the restart', ticketBalance(ada.hub.userId, GAME) === adaBefore && ticketBalance(bea.hub.userId, GAME) === beaBefore, `${adaBefore}->${ticketBalance(ada.hub.userId, GAME)}`);
  check('bench balances did not move', benchBefore.every((value, index) => value === ticketBalance(benchSessions[index]!.hub.userId, GAME)));
  rollback = { closed, restartMs, drift, endHost, endRival, heldAfter };
} finally {
  setWagerFlags('off');
  psql(`UPDATE game.server_flags SET state = 'off', allowlist = '{}', percent = 0, updated_at = now() WHERE key IN ('shooter_pvp', 'shooter_pvp_wager', 'shooter_pvp_ranked')`);
}
const flagsAfter = flagsOff();
check('launch flags are off at the end', flagsAfter === 'shooter_pvp=off,shooter_pvp_ranked=off,shooter_pvp_wager=off', flagsAfter);

let audit = 'ok';
try {
  psqlFile(join(ROOT, 'server/test/dup/audit.sql'));
  psqlFile(join(ROOT, 'server/test/dup/shooter_wager_audit.sql'));
} catch (error) {
  const err = error as { stdout?: string; stderr?: string; message?: string };
  audit = `${err.stderr ?? ''}\n${err.message ?? ''}`.slice(0, 800);
}
check('escrow audits pass after the rollback', audit === 'ok', audit);

let ws = 'not-tried';
try {
  const edgeLogin = await login(GAME);
  const edgeRt = socket(edgeLogin.gameToken, CADDY);
  await edgeRt.connect();
  edgeRt.disconnect();
  ws = 'connected';
  check('local caddy proxies the websocket', true);
} catch (error) {
  ws = error instanceof Error ? error.message : String(error);
  check('local caddy proxies the websocket', false, ws);
}
const edgeReport = edge();
edgeReport.ws = ws;

const dist = join(ROOT, 'apps/hub/dist');
let secrets = 'dist-not-built';
if (existsSync(dist)) {
  try {
    secrets = execFileSync('bash', ['deploy/scripts/check-dist-secrets.sh', '--defaults-only', dist], { encoding: 'utf8', cwd: ROOT }).trim();
    check('hub dist has no dev secrets or private keys', true);
  } catch (error) {
    const err = error as { stderr?: string; message?: string };
    secrets = `${err.stderr ?? ''}\n${err.message ?? ''}`.slice(0, 400);
    check('hub dist has no dev secrets or private keys', false, secrets);
  }
} else {
  check('hub dist scan waits for the build job', true, 'apps/hub/dist is not in this process');
}

const pingSorted = [...pingMs].sort((a, b) => a - b);
const report = {
  failures,
  where: 'local-docker-nakama',
  staging: false,
  publicFlags: flagsAfter,
  hardware,
  pin: { protocol: PROTOCOL, sim: SIM, content: FP, commit: info.commit, bundleSha256: info.bundleSha256 },
  latency: { pingMs, pingP95: pingSorted[Math.min(pingSorted.length - 1, Math.ceil(pingSorted.length * 0.95) - 1)] ?? null },
  bench: { matches: BENCH_MATCHES, ms: BENCH_MS, worstP95: worst, gateMs: 25, budgetMs: 10, samples },
  rollback,
  audit,
  edge: edgeReport,
  secrets,
};
console.log(`SHOOTER_ACCEPTANCE ${JSON.stringify(report)}`);
if (failures.length) process.exit(1);
