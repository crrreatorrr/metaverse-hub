// Live Nakama check for the dark Coop match.
//   docker compose -f server/docker-compose.yml up --build -d
//   npx tsx scripts/load/coop-bots.ts
// The authoritative fight stays dark: Nakama 3.41 copies match state between
// callbacks and turns a Set into an empty array, so the sim's hitDone.has
// throws on the next tick. This script checks that create, join, and quick
// queue refuse with capacity_dark, the version pin is visible, and Tickets
// stay at zero. Prints COOP_REPORT as one JSON line.
import { execFileSync } from 'node:child_process';
import { createRealtime, HubSdkError } from '../../packages/hub-sdk/src/index.ts';
import { call, login, waitReady, type GameLogin } from '../../server/test/dup/harness.ts';

const BASE = process.env.NAKAMA_URL ?? 'http://127.0.0.1:7350';
const GAME = 'sproto-coop-battle';

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

async function balance(token: string): Promise<number> {
  const result = await call('tickets.balance', { game: GAME }, token);
  return Number(result.body.balance ?? 0);
}

await waitReady();
const accounts: GameLogin[] = [];
const host = await login(GAME);
const guest = await login(GAME);
accounts.push(host, guest);
const before = await Promise.all(accounts.map((session) => balance(session.gameToken)));

const rt = socket(host.gameToken);
await rt.connect();
const info = await rt.rpc<Version>('coop.version', {});
check(
  'version pin is visible and unpaid',
  info.protocol === 1 && info.fingerprint.length === 64 && info.rewards === 0 && info.hostTakeover === 0
    && info.snapshotHz === 10 && info.loopHz === 20 && info.substeps === 3 && info.reconnectS === 15
    && info.match === 'sproto_coop',
  JSON.stringify(info),
);
check('authoritative play is dark', info.enabled === false);

let createCode = '';
try {
  await rt.rpc('coop.room_create', {});
} catch (error) {
  createCode = error instanceof HubSdkError ? error.code : '';
}
check('room create refuses while dark', createCode === 'capacity_dark', createCode);

let joinCode = '';
try {
  await rt.rpc('coop.room_join', { code: '23456789ABCD', v: info.protocol, sim: info.fingerprint });
} catch (error) {
  joinCode = error instanceof HubSdkError ? error.code : '';
}
check('room join refuses while dark', joinCode === 'capacity_dark', joinCode);

let resumeCode = '';
try {
  await rt.rpc('coop.resume', { matchId: 'none', state: { hp: 1 } });
} catch (error) {
  resumeCode = error instanceof HubSdkError ? error.code : '';
}
check('resume refuses a client state while dark', resumeCode === 'capacity_dark', resumeCode);

const gt = socket(guest.gameToken);
await gt.connect();
let queueCode = '';
try {
  await gt.addMatchmaker({
    query: `+properties.game:${GAME} +properties.v:${info.protocol} +properties.sim:${info.fingerprint}`,
    minCount: 2,
    maxCount: 6,
    stringProperties: { game: GAME, v: String(info.protocol), sim: info.fingerprint },
  });
} catch (error) {
  queueCode = error instanceof HubSdkError ? error.code : '';
}
check('quick queue refuses while dark', queueCode === 'capacity_dark', queueCode);
const cancel = await gt.rpc<{ ok: boolean; queued: boolean }>('coop.queue_cancel', {});
const cancelAgain = await gt.rpc<{ ok: boolean; queued: boolean }>('coop.queue_cancel', {});
check('queue cancel is idempotent', cancel.ok === true && cancel.queued === false && cancelAgain.ok === true);
rt.disconnect();
gt.disconnect();

const after = await Promise.all(accounts.map((session) => balance(session.gameToken)));
check('balances did not move', before.every((value, index) => value === after[index]), `${before.join(',')} -> ${after.join(',')}`);

const ids = accounts.map((session) => session.hub.userId);
let ledger = '';
try {
  ledger = execFileSync('docker', ['compose', '-f', 'server/docker-compose.yml', 'exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'nakama', '-tAc',
    `SELECT count(*) FROM game.tickets_ledger WHERE game_id = '${GAME}' AND user_id IN (${ids.map((id) => `'${id}'`).join(',')})`], { encoding: 'utf8' }).trim();
} catch (error) {
  ledger = `unavailable ${error instanceof Error ? error.message : String(error)}`;
}
check('ledger rows for these accounts are zero', ledger === '0', ledger);

console.log(`COOP_REPORT ${JSON.stringify({ failures, ledger, balances: after, enabled: info.enabled, fingerprint: info.fingerprint })}`);
if (failures.length) process.exit(1);
