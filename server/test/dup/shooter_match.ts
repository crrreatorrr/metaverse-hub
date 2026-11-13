// Live free 1v1 against the compose stack. The suite category is shooter-free.
// A failure in that category, or a run that records no pass, exits non-zero.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { createRealtime, HubSdkError, type MatchData, type MatchHandle } from '../../../packages/hub-sdk/src/index.ts';
import { call, guest, login, num, psql, sqlId, ticketBalance, type GameLogin } from './harness.ts';

const BASE = process.env.NAKAMA_URL ?? 'http://127.0.0.1:7350';
const GAME = 'sproto-shooter';
const FP = 'dc00f234';
const PROTOCOL = 2;
const SIM = 2;
const CATEGORY = 'shooter-free';

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

interface Pair {
  ada: GameLogin;
  bea: GameLogin;
  matchId: string;
  code: string;
  mailA: MatchData[];
  mailB: MatchData[];
  ma: MatchHandle;
  mb: MatchHandle;
  close: () => void;
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

const api = encoder();

function packet(wish: { [key: string]: unknown }): Uint8Array {
  const raw = api.encodeInput(wish);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw[i] ?? 0;
  return bytes;
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

async function openPair(): Promise<Pair> {
  const ada = await login(GAME);
  const bea = await login(GAME);
  const created = await call('shooter.room_create', {}, ada.gameToken);
  assert.equal(created.body.error, undefined, JSON.stringify(created.body));
  assert.equal(created.body.stake, 0);
  const matchId = String(created.body.matchId);
  const code = String(created.body.code);
  const joined = await call('shooter.room_join', { code, v: PROTOCOL, sim: SIM, content: FP }, bea.gameToken);
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
  const hello = (who: GameLogin) => ({ accountId: who.hub.userId, protocol: PROTOCOL, sim: SIM, content: FP });
  ma.send(1, hello(ada));
  mb.send(1, hello(bea));
  await until('ada welcome', () => mailA.find((msg) => msg.opCode === 2 && msg.json<{ accountId?: string }>().accountId === ada.hub.userId));
  await until('bea welcome', () => mailB.find((msg) => msg.opCode === 2 && msg.json<{ accountId?: string }>().accountId === bea.hub.userId));
  ma.send(4, { accountId: ada.hub.userId });
  mb.send(4, { accountId: bea.hub.userId });
  await until('live', () => mailA.find((msg) => msg.opCode === 5 && msg.json<{ phase?: string }>().phase === 'live'));
  return {
    ada, bea, matchId, code, mailA, mailB, ma, mb,
    close: () => { ra.disconnect(); rb.disconnect(); },
  };
}

function setPvp(state: 'on' | 'off'): void {
  psql(`UPDATE game.server_flags SET state = '${state}', allowlist = '{}', percent = 0, updated_at = now() WHERE key = 'shooter_pvp'`);
}

export async function runShooterMatch(test: TestFn): Promise<void> {
  // The committed row stays off. This suite turns it on only while it opens free matches, then puts it back.
  setPvp('on');
  await sleep(6500);
  try {
  await test(CATEGORY, 'guest game sessions play one free seat and the ledger stays at zero', async () => {
    const hub = await guest();
    const denied = await call('shooter.version', {}, hub.token);
    assert.equal(denied.body.error, 'wrong_scope');
    const ada = await login(GAME);
    const version = await call('shooter.version', {}, ada.gameToken);
    const info = version.body as unknown as Version;
    assert.equal(info.match, 'sproto_shooter_free');
    assert.equal(info.stake, 0);
    assert.equal(info.ticketsMinted, 0);
    assert.equal(info.guests, 'one_seat');
    assert.equal(info.practice, 'offline');
    const practice = await call('shooter.room_create', { mode: 'practice' }, ada.gameToken);
    assert.equal(practice.body.error, 'practice_offline');
    const seated = await openPair();
    seated.ma.send(1, { accountId: seated.ada.hub.userId, protocol: PROTOCOL, sim: SIM, content: FP });
    await sleep(200);
    const seats = seated.mailA.filter((msg) => msg.opCode === 2 && msg.json<{ accountId?: string }>().accountId === seated.ada.hub.userId).map((msg) => msg.json<{ seat: number }>().seat);
    assert.equal(new Set(seats).size, 1);
    const cy = await login(GAME);
    await call('shooter.room_join', { code: seated.code }, cy.gameToken);
    const rc = socket(cy.gameToken);
    await rc.connect();
    await assert.rejects(rc.joinMatch({ matchId: seated.matchId }), (error: unknown) => error instanceof HubSdkError);
    rc.disconnect();
    seated.close();
    const earn = await call('tickets.earn', { amount: 20, reason: 'shooter.pvp_win', key: `pvp-forge-${ada.hub.userId.slice(0, 8)}` }, ada.gameToken);
    assert.ok(earn.body.error, JSON.stringify(earn.body));
    await call('session.event', { eventId: 'shooter.pvp_win', key: `pvp-event-${ada.hub.userId.slice(0, 8)}`, data: { winner: ada.hub.userId } }, ada.gameToken);
    assert.equal(ticketBalance(ada.hub.userId, GAME), 0);
    assert.equal(ticketBalance(seated.bea.hub.userId, GAME), 0);
    assert.equal(ledger(ada.hub.userId), 0);
    assert.equal(ledger(seated.bea.hub.userId), 0);
    assert.equal(num(`SELECT count(*) FROM game.event_rule WHERE game_id = '${GAME}' AND tickets > 0`), 0);
    console.log(`shooter-free ledger delta ada=${ledger(ada.hub.userId)} bea=${ledger(seated.bea.hub.userId)}`);
  });

  await test(CATEGORY, 'forged result and claim-winner are rejected', async () => {
    const seated = await openPair();
    try {
      seated.ma.send(8, { winner: 0, outcome: 'ko', claimWinner: true, tickets: 20 });
      seated.ma.send(4, { accountId: seated.ada.hub.userId, winner: 0, earnTickets: 20 });
      const rejected = await until('client result', () => seated.mailA.find((msg) => msg.opCode === 3 && msg.json<{ reason?: string }>().reason === 'client_result'));
      assert.equal(rejected.json<{ ticketsMinted: number }>().ticketsMinted, 0);
      await sleep(150);
      assert.equal(seated.mailA.some((msg) => msg.opCode === 8), false, 'a client result must not publish RESULT');
      assert.equal(ticketBalance(seated.ada.hub.userId, GAME), 0);
      assert.equal(ledger(seated.ada.hub.userId), 0);
    } finally {
      seated.close();
    }
  });

  await test(CATEGORY, 'injected and wrong-seat input are rejected', async () => {
    const seated = await openPair();
    try {
      seated.ma.send(7, { winner: 1, hp: 1, snapshot: true });
      seated.ma.send(1, { accountId: seated.bea.hub.userId, protocol: PROTOCOL, sim: SIM, content: FP });
      const found = await until('injected and wrong seat', () => {
        const reasons = seated.mailA.filter((msg) => msg.opCode === 3).map((msg) => msg.json<{ reason?: string }>().reason);
        return reasons.includes('wrong_sender') && reasons.some((item) => item === 'malformed' || item === 'client_result') ? reasons : undefined;
      });
      assert.ok(found.includes('wrong_sender'), JSON.stringify(found));
      assert.ok(found.includes('malformed') || found.includes('client_result'), JSON.stringify(found));
      assert.equal(seated.mailA.some((msg) => msg.opCode === 8), false);
      assert.equal(ledger(seated.ada.hub.userId) + ledger(seated.bea.hub.userId), 0);
    } finally {
      seated.close();
    }
  });

  await test(CATEGORY, 'oversized and out-of-order frames are rejected', async () => {
    const seated = await openPair();
    try {
      const snap = await until('snapshot', () => seated.mailA.find((msg) => msg.opCode === 7));
      await until('bea snapshot', () => seated.mailB.find((msg) => msg.opCode === 7));
      // Per-recipient snapshots: each socket only ever gets its own seat's private state.
      const seatOf = (mail: MatchData[], id: string) => mail.find((msg) => msg.opCode === 2 && msg.json<{ accountId?: string }>().accountId === id)?.json<{ seat: number }>().seat;
      const adaSeat = seatOf(seated.mailA, seated.ada.hub.userId);
      const beaSeat = seatOf(seated.mailB, seated.bea.hub.userId);
      for (const msg of seated.mailA.filter((m) => m.opCode === 7)) assert.equal(msg.json<{ you: { seat: number } }>().you.seat, adaSeat);
      for (const msg of seated.mailB.filter((m) => m.opCode === 7)) assert.equal(msg.json<{ you: { seat: number } }>().you.seat, beaSeat);
      const tick = snap.json<{ tick: number }>().tick;
      seated.ma.send(6, new Uint8Array(80));
      // Gaps are fine in protocol 2; a sequence number that goes backwards is not.
      seated.ma.send(6, packet({ seq: 9, frame: tick + 1, yaw: 0, pitch: 0, moveX: 0, moveZ: 0, fire: false, slot: 0 }));
      seated.ma.send(6, packet({ seq: 5, frame: tick + 2, yaw: 0, pitch: 0, moveX: 0, moveZ: 0, fire: false, slot: 0 }));
      let reasons: string[] = [];
      try {
        reasons = await until('oversized and sequence', () => {
          const found = seated.mailA.filter((msg) => msg.opCode === 3).map((msg) => `${msg.json<{ accountId?: string }>().accountId}:${msg.json<{ reason?: string }>().reason}`);
          const text = found.join(',');
          return text.includes('malformed') && text.includes('sequence') ? found : undefined;
        });
      } catch (error) {
        const seen = seated.mailA.map((msg) => `${msg.opCode}${msg.opCode === 3 ? ':' + msg.json<{ reason?: string }>().reason : ''}`).join(',');
        throw new Error(`${error instanceof Error ? error.message : String(error)} mail=${seen}`);
      }
      assert.ok(reasons.some((item) => item.endsWith(':malformed')), JSON.stringify(reasons));
      assert.ok(reasons.some((item) => item.endsWith(':sequence')), JSON.stringify(reasons));
      assert.equal(seated.mailA.some((msg) => msg.opCode === 8), false);
    } finally {
      seated.close();
    }
  });

  await test(CATEGORY, 'protocol, sim, and content mismatch are rejected', async () => {
    const ada = await login(GAME);
    const badVersion = await call('shooter.room_join', { code: 'AAAAAAAAAAAA', v: 9, sim: SIM, content: FP }, ada.gameToken);
    assert.equal(badVersion.body.error, 'version_mismatch');
    const badSim = await call('shooter.room_create', { sim: 9 }, ada.gameToken);
    assert.equal(badSim.body.error, 'version_mismatch');
    const badContent = await call('shooter.room_create', { content: 'deadbeef' }, ada.gameToken);
    assert.equal(badContent.body.error, 'version_mismatch');
    const rt = socket(ada.gameToken);
    await rt.connect();
    await assert.rejects(
      rt.addMatchmaker({
        query: `+properties.game:sproto-shooter +properties.mode:free +properties.protocol:${PROTOCOL} +properties.content:deadbeef`,
        minCount: 2,
        maxCount: 2,
        stringProperties: { game: GAME, mode: 'free', protocol: String(PROTOCOL), sim: String(SIM), content: 'deadbeef' },
      }),
      (error: unknown) => error instanceof HubSdkError && error.code === 'version_mismatch',
    );
    const created = await call('shooter.room_create', {}, ada.gameToken);
    assert.equal(created.body.error, undefined, JSON.stringify(created.body));
    const matchId = String(created.body.matchId);
    const joined = await rt.joinMatch({ matchId });
    const mail: MatchData[] = [];
    joined.onMessage((msg) => mail.push(msg));
    joined.send(1, { accountId: ada.hub.userId, protocol: PROTOCOL, sim: 1, content: FP });
    const rejected = await until('hello version', () => mail.find((msg) => msg.opCode === 3));
    assert.equal(rejected.json<{ reason?: string; ticketsMinted?: number }>().reason, 'version');
    assert.equal(rejected.json<{ ticketsMinted?: number }>().ticketsMinted, 0);
    rt.disconnect();
    assert.equal(ledger(ada.hub.userId), 0);
  });
  } finally {
    setPvp('off');
  }
}
