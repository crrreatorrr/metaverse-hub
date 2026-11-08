// Live free 1v1 against the compose stack. Guests get one seat. Practice is not a
// match. The ledger does not move.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { createRealtime, HubSdkError, type MatchData } from '../../../packages/hub-sdk/src/index.ts';
import { call, guest, login, num, sqlId, ticketBalance, type GameLogin } from './harness.ts';

const BASE = process.env.NAKAMA_URL ?? 'http://127.0.0.1:7350';
const GAME = 'sproto-shooter';
const FP = 'f5949631';

type TestFn = (category: string, name: string, fn: () => Promise<void>) => Promise<void>;

interface Version {
  protocol: number;
  sim: number;
  content: string;
  stake: number;
  ticketsMinted: number;
  stakes: boolean;
  guests: string;
  practice: string;
  match: string;
  error?: string;
}

function socket(token: string) {
  return createRealtime({ serverUrl: BASE, getToken: () => token, reconnect: false });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function encoder(): { encodeInput(wish: { [key: string]: unknown }): Uint8Array } {
  const sandbox: { [key: string]: unknown } = { console: { log() {}, warn() {}, error() {} } };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(process.cwd(), 'server/modules/vendor/shooter-pvp-sim.js'), 'utf8'), sandbox, { filename: 'shooter-pvp-sim.js' });
  return (sandbox.SprotoShooterPvp as { encodeInput(wish: { [key: string]: unknown }): Uint8Array });
}

function ledger(userId: string): number {
  return num(`SELECT COALESCE(sum(delta), 0) FROM game.tickets_ledger WHERE user_id = '${sqlId(userId)}' AND game_id = '${GAME}'`);
}

async function until<T>(what: string, read: () => T | undefined, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(40);
  }
}

export async function runShooterMatch(test: TestFn): Promise<void> {
  const api = encoder();
  await test('shooter-match', 'guest game sessions play one free seat and the ledger stays at zero', async () => {
    const hub = await guest();
    const denied = await call('shooter.version', {}, hub.token);
    assert.equal(denied.body.error, 'wrong_scope');
    const ada = await login(GAME);
    const bea = await login(GAME);
    const before = [ticketBalance(ada.hub.userId, GAME), ticketBalance(bea.hub.userId, GAME)];
    assert.deepEqual(before, [0, 0]);
    const version = await call('shooter.version', {}, ada.gameToken);
    const info = version.body as unknown as Version;
    assert.equal(info.error, undefined);
    assert.equal(info.match, 'sproto_shooter_free');
    assert.equal(info.protocol, 1);
    assert.equal(info.sim, 1);
    assert.equal(info.content, FP);
    assert.equal(info.stake, 0);
    assert.equal(info.ticketsMinted, 0);
    assert.equal(info.stakes, false);
    assert.equal(info.guests, 'one_seat');
    assert.equal(info.practice, 'offline');
    const practice = await call('shooter.room_create', { mode: 'practice' }, ada.gameToken);
    assert.equal(practice.body.error, 'practice_offline');
    const forged = await call('shooter.room_create', { winner: 0, stake: 10 }, ada.gameToken);
    assert.equal(forged.body.error, 'rejected');
    const created = await call('shooter.room_create', {}, ada.gameToken);
    assert.equal(created.body.error, undefined);
    assert.equal(created.body.stake, 0);
    assert.equal(created.body.ticketsMinted, 0);
    const matchId = String(created.body.matchId);
    const code = String(created.body.code);
    const joined = await call('shooter.room_join', { code, v: 1, sim: 1, content: FP }, bea.gameToken);
    assert.equal(joined.body.matchId, matchId);
    const ra = socket(ada.gameToken);
    const rb = socket(bea.gameToken);
    await Promise.all([ra.connect(), rb.connect()]);
    const mailA: MatchData[] = [];
    const mailB: MatchData[] = [];
    const ma = await ra.joinMatch({ matchId });
    const mb = await rb.joinMatch({ matchId });
    ma.onMessage((msg) => mailA.push(msg));
    mb.onMessage((msg) => mailB.push(msg));
    const hello = (who: GameLogin) => ({ accountId: who.hub.userId, protocol: 1, sim: 1, content: FP });
    ma.send(1, hello(ada));
    mb.send(1, hello(bea));
    const welcomeA = await until('ada welcome', () => mailA.find((msg) => msg.opCode === 2 && msg.json<Version & { accountId?: string; seat?: number }>().accountId === ada.hub.userId));
    const welcomeB = await until('bea welcome', () => mailB.find((msg) => msg.opCode === 2 && msg.json<{ accountId?: string }>().accountId === bea.hub.userId));
    assert.equal(welcomeA.json<{ seat: number; ticketsMinted: number; stakes: boolean }>().ticketsMinted, 0);
    assert.equal(welcomeA.json<{ stakes: boolean }>().stakes, false);
    assert.notEqual(welcomeA.json<{ seat: number }>().seat, welcomeB.json<{ seat: number }>().seat);
    ma.send(1, hello(ada));
    await sleep(150);
    const seats = mailA.filter((msg) => msg.opCode === 2 && msg.json<{ accountId?: string }>().accountId === ada.hub.userId).map((msg) => msg.json<{ seat: number }>().seat);
    assert.equal(new Set(seats).size, 1, 'one account keeps a single seat');
    ma.send(4, { accountId: ada.hub.userId });
    mb.send(4, { accountId: bea.hub.userId });
    const phase = await until('live phase', () => mailA.find((msg) => msg.opCode === 5 && msg.json<{ phase?: string }>().phase === 'live'));
    assert.equal(phase.json<{ ticketsMinted: number }>().ticketsMinted, 0);
    const snap = await until('snapshot', () => mailA.find((msg) => msg.opCode === 7));
    assert.equal(snap.json<{ ticketsMinted: number; stakes: boolean; serverSeq: number }>().ticketsMinted, 0);
    assert.equal(snap.json<{ stakes: boolean }>().stakes, false);
    assert.equal(typeof snap.json<{ serverSeq: number }>().serverSeq, 'number');
    const tick = snap.json<{ tick: number }>().tick;
    const encode = (seq: number) => {
      const raw = api.encodeInput({ seq, frame: tick, yaw: 0, pitch: 0, moveX: 0, moveZ: 1, fire: true, slot: 0 });
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i += 1) bytes[i] = raw[i] ?? 0;
      return bytes;
    };
    await sleep(100);
    ma.send(6, encode(1));
    await sleep(200);
    mb.send(6, encode(1));
    ma.send(8, { winner: 0, outcome: 'ko', tickets: 20 });
    const rejected = await until('forged result rejected', () => mailA.find((msg) => msg.opCode === 3 && msg.json<{ reason?: string }>().reason === 'client_result'));
    assert.equal(rejected.json<{ ticketsMinted: number }>().ticketsMinted, 0);
    const cy = await login(GAME);
    const looked = await call('shooter.room_join', { code }, cy.gameToken);
    assert.equal(looked.body.matchId, matchId);
    const rc = socket(cy.gameToken);
    await rc.connect();
    await assert.rejects(rc.joinMatch({ matchId }), (error: unknown) => error instanceof HubSdkError);
    rc.disconnect();
    ra.disconnect();
    rb.disconnect();
    const earn = await call('tickets.earn', { amount: 20, reason: 'shooter.pvp_win', key: 'pvp-forge' }, ada.gameToken);
    assert.ok(earn.body.error, JSON.stringify(earn.body));
    await call('session.event', { eventId: 'shooter.pvp_win', key: 'pvp-event', data: { winner: ada.hub.userId } }, ada.gameToken);
    assert.equal(ticketBalance(ada.hub.userId, GAME), 0);
    assert.equal(ticketBalance(bea.hub.userId, GAME), 0);
    assert.equal(ledger(ada.hub.userId), 0);
    assert.equal(ledger(bea.hub.userId), 0);
    assert.equal(num(`SELECT count(*) FROM game.event_rule WHERE game_id = '${GAME}' AND tickets > 0`), 0);
    console.log(`shooter-match ledger delta ada=${ledger(ada.hub.userId)} bea=${ledger(bea.hub.userId)} balance=${ticketBalance(ada.hub.userId, GAME)}`);
  });
}
