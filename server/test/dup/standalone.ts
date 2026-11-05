/**
 * Duplication and escalation checks for sproto.standalone_session.
 * A hub session that sends {app:'sproto-duel'} receives a game token. That
 * token must not be able to mint Tickets, and issuance must stop at the
 * documented buckets. Product failures are left failing.
 */
import assert from 'node:assert/strict';
import { createRealtime, HubSdkError, type HubRealtime, type MatchData, type MatchHandle } from '../../../packages/hub-sdk/src/index.ts';
import {
  SERVER_KEY,
  call,
  compose,
  guest,
  login,
  num,
  openGame,
  psql,
  sleep,
  sqlId,
  ticketBalance,
  verseBalance,
  waitReady,
  type Guest,
  type RpcResult,
} from './harness.ts';

const BASE = process.env.NAKAMA_URL ?? 'http://127.0.0.1:7350';
const APP = 'sproto-duel';
const RPC = 'sproto.standalone_session';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OP = { HELLO: 1, START: 2, INPUT: 10, SNAPSHOT: 11, ROUND: 12, RESULT: 13, OUTCOME: 14, ACCEPT: 19 };
const NET_VERSION = '2';
const BASIC = `Basic ${Buffer.from(`${SERVER_KEY}:`).toString('base64')}`;

type TestFn = (category: string, name: string, fn: () => Promise<void>) => Promise<void>;

interface Body {
  error?: string;
  message?: string;
  token?: string;
  exp?: number;
  sid?: string;
  matchId?: string;
  code?: string;
}

interface Claims {
  exp?: number;
  vrs?: Record<string, string>;
  keys: string[];
}

function bodyOf(result: RpcResult): Body {
  return result.body as Body;
}

function errorCode(result: RpcResult): string {
  const body = bodyOf(result);
  if (typeof body.error === 'string' && /^[a-z0-9_]+$/.test(body.error)) return body.error;
  const text = `${body.message ?? ''} ${body.error ?? ''}`;
  const tagged = /(?:Error:\s*)([a-z0-9_]+)/.exec(text);
  return tagged?.[1] ?? '';
}

function accepted(result: RpcResult): boolean {
  const body = bodyOf(result);
  return typeof body.token === 'string' && body.token.length > 0 && !body.error;
}

function sessionClaims(token: string): Claims {
  const part = token.split('.')[1] ?? '';
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(Buffer.from(part, 'base64url').toString()) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`session token payload is not a JWT claim set: ${error instanceof Error ? error.message : String(error)}`);
  }
  const vrs = json.vrs;
  return {
    exp: typeof json.exp === 'number' ? json.exp : undefined,
    vrs: vrs && typeof vrs === 'object' && !Array.isArray(vrs) ? vrs as Record<string, string> : undefined,
    keys: Object.keys(json),
  };
}

function issue(token: string, payload: object = { app: APP }): Promise<RpcResult> {
  return call(RPC, payload, token);
}

async function clearRateLimits(): Promise<void> {
  // The production counter persists in storage across runtime restarts.
  // Reset only this isolated test database's bucket fixtures.
  psql("DELETE FROM storage WHERE collection = 'sproto_sa_rl'");
  compose(['restart', 'nakama']);
  await waitReady();
  // Device auth can 503 for a moment after the gateway is healthy (dial 7349 refused).
  const deadline = Date.now() + 20_000;
  let last = 'auth not attempted';
  while (Date.now() < deadline) {
    try {
      await guest();
      return;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
      if (!last.includes('503') && !last.includes('connection refused')) throw error;
      await sleep(250);
    }
  }
  throw new Error(`Nakama auth did not recover after restart: ${last}`);
}

function purse(userId: string): string {
  return [
    `tickets=${ticketBalance(userId, 'sproto')}`,
    `ledger=${num(`SELECT count(*) FROM game.tickets_ledger WHERE user_id = '${sqlId(userId)}'`)}`,
    `verse=${verseBalance(userId)}`,
    `idem=${num(`SELECT count(*) FROM game.idempotency WHERE user_id = '${sqlId(userId)}'`)}`,
    `sessions=${num(`SELECT count(*) FROM game.game_session WHERE user_id = '${sqlId(userId)}'`)}`,
    `wins=${num(`SELECT count(*) FROM game.win_record WHERE user_id = '${sqlId(userId)}'`)}`,
    `pvp=${num(`SELECT count(*) FROM game.sproto_pvp_result WHERE winner = '${sqlId(userId)}' OR loser = '${sqlId(userId)}'`)}`,
    `wagers=${num(`SELECT count(*) FROM game.sproto_wager WHERE player_a = '${sqlId(userId)}' OR player_b = '${sqlId(userId)}'`)}`,
    `score=${num(`SELECT COALESCE((SELECT value FROM game.ranked_score WHERE user_id = '${sqlId(userId)}' AND board_id = 'sproto_wins' AND variant = ''), 0)`)}`,
  ].join(' ');
}

function assertUntouched(userId: string, label: string): void {
  assert.equal(purse(userId), 'tickets=0 ledger=0 verse=0 idem=0 sessions=0 wins=0 pvp=0 wagers=0 score=0', label);
}

function assertNoEconomy(userId: string): void {
  assert.equal(ticketBalance(userId, 'sproto'), 0, purse(userId));
  assert.equal(num(`SELECT count(*) FROM game.tickets_ledger WHERE user_id = '${sqlId(userId)}'`), 0, purse(userId));
  assert.equal(verseBalance(userId), 0, purse(userId));
  assert.equal(num(`SELECT count(*) FROM game.idempotency WHERE user_id = '${sqlId(userId)}'`), 0, purse(userId));
  assert.equal(num(`SELECT count(*) FROM game.game_session WHERE user_id = '${sqlId(userId)}'`), 0, purse(userId));
  assert.equal(num(`SELECT count(*) FROM game.sproto_pvp_result WHERE winner = '${sqlId(userId)}' OR loser = '${sqlId(userId)}'`), 0, purse(userId));
  assert.equal(num(`SELECT count(*) FROM game.sproto_wager WHERE player_a = '${sqlId(userId)}' OR player_b = '${sqlId(userId)}'`), 0, purse(userId));
}

async function devicesOf(token: string): Promise<string[]> {
  const response = await fetch(`${BASE}/v2/account`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  const json = await response.json() as { devices?: { id?: string }[]; account?: { devices?: { id?: string }[] } };
  const list = json.devices ?? json.account?.devices ?? [];
  return list.map((device) => device.id ?? '').filter((id) => id.length > 0);
}

async function emailHub(): Promise<Guest> {
  const tag = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  const query = new URLSearchParams({ create: 'true', username: `u${tag}` });
  const response = await fetch(`${BASE}/v2/account/authenticate/email?${query}`, {
    method: 'POST',
    headers: { Authorization: BASIC, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `u${tag}@example.com`, password: 'correct-horse-1' }),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`email auth ${response.status} ${text}`);
  const parsed = JSON.parse(text) as { token?: string };
  if (!parsed.token) throw new Error(text);
  const claims = sessionClaims(parsed.token);
  const uid = JSON.parse(Buffer.from(parsed.token.split('.')[1] ?? '', 'base64url').toString()) as { uid?: string };
  if (!uid.uid) throw new Error(`email token missing uid (${claims.keys.join(',')})`);
  assert.deepEqual(claims.vrs, { scope: 'hub' });
  return { token: parsed.token, userId: uid.uid };
}

function socket(token: string): HubRealtime {
  return createRealtime({ serverUrl: BASE, getToken: () => token, reconnect: false });
}

async function until<T>(what: string, fn: () => T | undefined | null | false, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = fn();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(50);
  }
}

async function fill(token: string, count: number): Promise<RpcResult[]> {
  const out: RpcResult[] = [];
  for (let i = 0; i < count; i += 1) {
    const result = await issue(token);
    assert.equal(accepted(result), true, `issue ${i + 1}: ${result.status} ${JSON.stringify(result.body)}`);
    out.push(result);
  }
  return out;
}

export async function runStandalone(test: TestFn): Promise<void> {
  await clearRateLimits();
  await test('standalone', 'marker is required, extra fields cannot inject vars, and expiry is 7200s', async () => {
    const who = await guest();
    const injected = '11111111-1111-4111-8111-111111111111';
    for (const payload of [{}, { app: '' }, { app: 'sproto' }, { app: 'SPROTO-DUEL' }, { app: 'sproto-duel ' }, { app: ['sproto-duel'] }]) {
      const rejected = await issue(who.token, payload);
      assert.equal(errorCode(rejected), 'bad_app', JSON.stringify(rejected.body));
      assert.equal(bodyOf(rejected).token, undefined);
    }
    const minted = await issue(who.token, {
      app: APP,
      scope: 'hub',
      game: 'sproto-fighter',
      sid: injected,
      ranked: '1',
      vars: { scope: 'hub', game: 'nobu', sid: injected, ranked: '1', admin: '1' },
      userId: injected,
      token: 'forged',
      exp: 1,
    });
    const body = bodyOf(minted);
    assert.equal(accepted(minted), true, JSON.stringify(minted.body));
    assert.deepEqual(Object.keys(body).sort(), ['exp', 'sid', 'token']);
    assert.match(body.sid ?? '', UUID);
    assert.notEqual(body.sid, injected);
    const claims = sessionClaims(body.token ?? '');
    assert.ok(claims.vrs, `token claims ${claims.keys.join(',') || '(none)'} have no vrs`);
    assert.deepEqual(Object.keys(claims.vrs).sort(), ['game', 'ranked', 'scope', 'sid']);
    assert.deepEqual(claims.vrs, { scope: 'game', game: 'sproto', sid: body.sid, ranked: '0' });
    const now = Math.floor(Date.now() / 1000);
    assert.equal(claims.exp, body.exp);
    assert.ok(typeof body.exp === 'number' && Math.abs(body.exp - now - 7200) <= 30, `expiry delta ${body.exp === undefined ? 'missing' : body.exp - now}, expected 7200`);
    assertUntouched(who.userId, 'a minted standalone session writes no economy row');
    assert.equal(num(`SELECT count(*) FROM game.game_session WHERE session_id = '${sqlId(body.sid ?? '')}'`), 0);
  });

  await test('standalone', 'hub scope is required and a game or t: session is rejected', async () => {
    const anon = await call(RPC, { app: APP });
    assert.equal(errorCode(anon), 'unauthorized', JSON.stringify(anon.body));
    assert.equal(bodyOf(anon).token, undefined);

    const portal = await login('sproto');
    const beforePortal = purse(portal.hub.userId);
    const game = await issue(portal.gameToken, { app: APP, scope: 'hub', ranked: '1', game: 'sproto' });
    assert.equal(errorCode(game), 'wrong_scope', JSON.stringify(game.body));
    assert.equal(bodyOf(game).token, undefined);
    assert.equal(sessionClaims(portal.gameToken).vrs?.scope, 'game', 'the redeemed t: custom-auth session is game scope');
    assert.equal(purse(portal.hub.userId), beforePortal, 'a rejected t: game session mints nothing');

    const fighter = await login('sproto-fighter');
    const beforeFighter = purse(fighter.hub.userId);
    const other = await issue(fighter.gameToken, { app: APP });
    assert.equal(errorCode(other), 'wrong_scope', JSON.stringify(other.body));
    assert.equal(bodyOf(other).token, undefined);
    assert.equal(purse(fighter.hub.userId), beforeFighter, 'a rejected fighter session mints nothing');
  });

  await test('standalone', 'earn apply_event spend sell and exchange return session_closed', async () => {
    const who = await guest();
    const minted = await issue(who.token);
    assert.equal(accepted(minted), true, JSON.stringify(minted.body));
    const token = bodyOf(minted).token ?? '';
    const before = purse(who.userId);
    const writes: [string, object][] = [
      ['tickets.earn', { amount: 20, reason: 'win', key: 'sa-earn' }],
      ['session.event', { eventId: 'win', key: 'sa-event', data: { boss: 'tinubu' } }],
      ['tickets.spend', { game: 'sproto', shop_id: 'shop_staffwright', item_id: 'duel_staff_sproto', packs: 1, key: 'sa-spend' }],
      ['tickets.sell', { game: 'sproto', shop_id: 'shop_staffwright', item_id: 'duel_staff_sproto', packs: 1, key: 'sa-sell' }],
      ['tickets.exchange', { tickets: 10, key: 'sa-exchange' }],
    ];
    for (const [name, payload] of writes) {
      const result = await call(name, payload, token);
      assert.equal(errorCode(result), 'session_closed', `${name} ${result.status} ${JSON.stringify(result.body)}`);
      const replay = await call(name, payload, token);
      assert.equal(errorCode(replay), 'session_closed', `${name} replay ${JSON.stringify(replay.body)}`);
    }
    assert.equal(purse(who.userId), before, 'rejected writes left the ledger and balances unchanged');
  });

  await test('standalone', 'a fighter ticket or another game token is wrong_game', async () => {
    const who = await guest();
    const minted = await issue(who.token);
    const token = bodyOf(minted).token ?? '';
    assert.equal(accepted(minted), true, JSON.stringify(minted.body));
    const before = purse(who.userId);
    const rt = socket(token);
    await rt.connect();
    await assert.rejects(
      rt.addMatchmaker({
        query: '+properties.game:sproto-fighter',
        minCount: 2,
        maxCount: 2,
        stringProperties: { game: 'sproto-fighter', wager: '10', sim: 'standalone-qa' },
      }),
      (error: unknown) => error instanceof HubSdkError && error.code === 'wrong_game',
    );
    rt.disconnect();
    assert.equal(purse(who.userId), before, 'a rejected fighter ticket holds no wager');

    for (const game of ['nobu', 'sproto-fighter']) {
      const other = await login(game);
      const otherRt = socket(other.gameToken);
      await otherRt.connect();
      const beforeOther = purse(other.hub.userId);
      await assert.rejects(
        otherRt.addMatchmaker({
          query: '+properties.game:sproto +properties.v:2',
          minCount: 2,
          maxCount: 2,
          stringProperties: { game: 'sproto', v: NET_VERSION },
        }),
        (error: unknown) => error instanceof HubSdkError && error.code === 'wrong_game',
      );
      otherRt.disconnect();
      assert.equal(purse(other.hub.userId), beforeOther, `${game} token did not open a sproto wager`);
    }
  });

  await test('standalone', 'arena result ranked 0 records one win and mints nothing', async () => {
    const [a, b] = await Promise.all([guest(), guest()]);
    const [mintA, mintB] = await Promise.all([issue(a.token), issue(b.token)]);
    assert.equal(accepted(mintA) && accepted(mintB), true, `${JSON.stringify(mintA.body)} ${JSON.stringify(mintB.body)}`);
    const tokenA = bodyOf(mintA).token ?? '';
    const tokenB = bodyOf(mintB).token ?? '';
    assert.equal(sessionClaims(tokenA).vrs?.ranked, '0');
    assert.equal(sessionClaims(tokenB).vrs?.ranked, '0');

    const created = await call('sproto.room_create', { v: NET_VERSION }, tokenA);
    assert.equal(created.status < 400 && !bodyOf(created).error, true, JSON.stringify(created.body));
    const code = bodyOf(created).code ?? '';
    const roomId = bodyOf(created).matchId ?? '';
    assert.match(code, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
    let joined = await call('sproto.room_join', { code, v: NET_VERSION }, tokenB);
    const joinDeadline = Date.now() + 5000;
    while (errorCode(joined) === 'room_not_found' && Date.now() < joinDeadline) {
      await sleep(200);
      joined = await call('sproto.room_join', { code, v: NET_VERSION }, tokenB);
    }
    assert.equal(bodyOf(joined).matchId, roomId, JSON.stringify(joined.body));

    const ra = socket(tokenA);
    const rb = socket(tokenB);
    await Promise.all([ra.connect(), rb.connect()]);
    const roomA = await ra.joinMatch({ matchId: roomId });
    const roomB = await rb.joinMatch({ matchId: roomId });
    await Promise.all([roomA.leave(), roomB.leave()]);

    const matched: { userId: string; matchId: string }[] = [];
    ra.onMatchmakerMatched((event) => { if (event.matchId) matched.push({ userId: a.userId, matchId: event.matchId }); });
    rb.onMatchmakerMatched((event) => { if (event.matchId) matched.push({ userId: b.userId, matchId: event.matchId }); });
    const ticket = {
      query: '+properties.game:sproto +properties.v:2',
      minCount: 2,
      maxCount: 2,
      stringProperties: { game: 'sproto', v: NET_VERSION },
    };
    const addedA = await ra.addMatchmaker(ticket);
    const addedB = await rb.addMatchmaker(ticket);
    assert.ok(addedA.ticket && addedB.ticket, 'standalone tokens are accepted by the sproto matchmaker');
    await until('matchmaker match', () => matched.length === 2 && matched[0]!.matchId === matched[1]!.matchId, 15_000);
    const matchId = matched[0]!.matchId;

    const inbox = new Map<string, MatchData[]>();
    async function enter(rt: HubRealtime, userId: string): Promise<MatchHandle> {
      const box: MatchData[] = [];
      inbox.set(userId, box);
      const handle = await rt.joinMatch({ matchId });
      handle.onMessage((msg) => box.push(msg));
      handle.send(OP.HELLO, { v: NET_VERSION, staff: 'duel_staff_sproto' });
      handle.send(OP.ACCEPT, { v: NET_VERSION });
      return handle;
    }
    const [matchA, matchB] = await Promise.all([enter(ra, a.userId), enter(rb, b.userId)]);
    const startA = await until('START for A', () => inbox.get(a.userId)!.find((msg) => msg.opCode === OP.START), 10_000);
    const startB = await until('START for B', () => inbox.get(b.userId)!.find((msg) => msg.opCode === OP.START));
    const seatA = startA.json<{ seat: number; hostSeat: number }>();
    const seatB = startB.json<{ seat: number; hostSeat: number }>();
    const bySeat = new Map<number, { handle: MatchHandle; userId: string }>([
      [seatA.seat, { handle: matchA, userId: a.userId }],
      [seatB.seat, { handle: matchB, userId: b.userId }],
    ]);
    const host = bySeat.get(seatA.hostSeat)!;
    const guestSeat = bySeat.get(1 - seatA.hostSeat)!;
    const winner = bySeat.get(0)!;
    const result = { winnerSeat: 0, wins: [2, 0], rounds: 2 };
    const started = Date.now();
    let sentRounds = 0;
    let sentResult = false;
    while (Date.now() - started < 18_000) {
      const elapsed = Date.now() - started;
      guestSeat.handle.send(OP.INPUT, '{"t":1,"f":[]}');
      host.handle.send(OP.SNAPSHOT, '{"v":1}');
      if (sentRounds === 0 && elapsed > 5000) {
        host.handle.send(OP.ROUND, { round: 1, winnerSeat: 0, reason: 'ko', wins: [1, 0] });
        sentRounds = 1;
      } else if (sentRounds === 1 && elapsed > 10_000) {
        host.handle.send(OP.ROUND, { round: 2, winnerSeat: 0, reason: 'time', wins: [2, 0] });
        sentRounds = 2;
      } else if (!sentResult && elapsed > 16_500) {
        host.handle.send(OP.RESULT, result);
        guestSeat.handle.send(OP.RESULT, result);
        host.handle.send(OP.RESULT, result);
        guestSeat.handle.send(OP.RESULT, result);
        sentResult = true;
      }
      const outcome = [...inbox.values()].flat().find((msg) => msg.opCode === OP.OUTCOME);
      if (outcome) break;
      await sleep(200);
    }
    const outcome = await until(
      'OUTCOME',
      () => [...inbox.values()].flat().find((msg) => msg.opCode === OP.OUTCOME),
      5000,
    );
    const outcomeBody = outcome.json<{ status: string; winnerSeat: number | null; paid?: Record<string, number> }>();
    assert.equal(outcomeBody.status, 'verified', JSON.stringify(outcomeBody));
    assert.equal(outcomeBody.winnerSeat, 0);
    const paid = outcomeBody.paid ?? {};
    assert.deepEqual(paid, {}, `ranked 0 paid ${JSON.stringify(paid)}`);
    host.handle.send(OP.RESULT, result);
    guestSeat.handle.send(OP.RESULT, result);
    await sleep(1000);
    assert.equal(num(`SELECT count(*) FROM game.win_record WHERE user_id = '${sqlId(winner.userId)}'`), 1);
    assert.equal(num(`SELECT count(*) FROM game.win_record WHERE user_id = '${sqlId(winner.userId === a.userId ? b.userId : a.userId)}'`), 0);
    assert.equal(
      num(`SELECT COALESCE((SELECT value FROM game.ranked_score WHERE user_id = '${sqlId(winner.userId)}' AND board_id = 'sproto_wins' AND variant = ''), 0)`),
      1,
    );
    assert.equal(num(`SELECT count(*) FROM game.sproto_pvp_result WHERE winner = '${sqlId(winner.userId)}' OR loser = '${sqlId(winner.userId)}'`), 0);
    assertNoEconomy(a.userId);
    assertNoEconomy(b.userId);
    ra.disconnect();
    rb.disconnect();
  });

  await test('standalone', 'rate limit rejects do not count toward the ten good calls', async () => {
    await clearRateLimits();
    const who = await guest();
    const game = await openGame(who.token, 'nobu');
    assert.equal(game.hub.userId, who.userId);
    const before = purse(who.userId);
    for (let i = 0; i < 30; i += 1) {
      const bad = await issue(who.token, { app: i % 2 === 0 ? 'sproto' : '' });
      assert.equal(errorCode(bad), 'bad_app', JSON.stringify(bad.body));
    }
    for (let i = 0; i < 45; i += 1) {
      const bad = await issue(game.gameToken, { app: APP, scope: 'hub', ranked: '1' });
      assert.equal(errorCode(bad), 'wrong_scope', JSON.stringify(bad.body));
    }
    await fill(who.token, 10);
    const blocked = await issue(who.token);
    assert.equal(errorCode(blocked), 'rate_limited', JSON.stringify(blocked.body));
    assert.equal(bodyOf(blocked).token, undefined);
    assert.equal(purse(who.userId), before, 'rejected marker and scope calls were not counted and minted nothing');
  });

  await test('standalone', 'rate limit is 10 per user, 10 per device and 40 per ip', async () => {
    await clearRateLimits();
    const email = await emailHub();
    assert.deepEqual(await devicesOf(email.token), [], JSON.stringify(await devicesOf(email.token)));
    await fill(email.token, 10);
    const emailBlocked = await issue(email.token);
    assert.equal(errorCode(emailBlocked), 'rate_limited', JSON.stringify(emailBlocked.body));
    assert.equal(bodyOf(emailBlocked).token, undefined);
    assertUntouched(email.userId, 'the 11th user call minted nothing');

    const device = await guest();
    assert.equal((await devicesOf(device.token)).length, 1);
    await fill(device.token, 10);
    const deviceBlocked = await issue(device.token);
    assert.equal(errorCode(deviceBlocked), 'rate_limited', JSON.stringify(deviceBlocked.body));
    assert.equal(bodyOf(deviceBlocked).token, undefined);
    const otherDevice = await guest();
    const otherOk = await issue(otherDevice.token);
    assert.equal(accepted(otherOk), true, 'a second device is not blocked by the first device bucket');
    assertUntouched(device.userId, 'the 11th device call minted nothing');

    // email 10 + device 10 + the other device's one success = 21 on this IP.
    // Fill to 40. The next new user's first call can only be the IP bucket.
    let issued = 21;
    while (issued < 40) {
      const extra = await guest();
      const n = Math.min(10, 40 - issued);
      await fill(extra.token, n);
      issued += n;
    }
    const pastIp = await guest();
    const ipBlocked = await issue(pastIp.token);
    assert.equal(errorCode(ipBlocked), 'rate_limited', JSON.stringify(ipBlocked.body));
    assert.equal(bodyOf(ipBlocked).token, undefined);
    assert.equal((await devicesOf(pastIp.token)).length, 1, 'the blocked caller still has a free device and user bucket');
    assertUntouched(pastIp.userId, 'the IP limit minted nothing');
  });

  await test('standalone', 'rate limit concurrent issuance never exceeds the cap', async () => {
    await clearRateLimits();
    for (let round = 0; round < 3; round += 1) {
      const who = await guest();
      await fill(who.token, 9);
      const burst = await Promise.all(Array.from({ length: 12 }, () => issue(who.token)));
      let total = 9;
      for (const result of burst) {
        if (accepted(result)) total += 1;
        else assert.equal(errorCode(result), 'rate_limited', `round ${round} unexpected ${result.status} ${JSON.stringify(result.body)}`);
      }
      assert.ok(total <= 10, `round ${round} concurrent issuance minted ${total}, limit is 10`);
      while (total < 10) {
        const next = await issue(who.token);
        assert.equal(accepted(next), true, `round ${round} stopped at ${total}: ${JSON.stringify(next.body)}`);
        total += 1;
      }
      const extra = await issue(who.token);
      assert.equal(errorCode(extra), 'rate_limited', `round ${round} ${JSON.stringify(extra.body)}`);
      assert.equal(bodyOf(extra).token, undefined);
      assert.equal(total, 10);
      assertUntouched(who.userId, `round ${round} concurrent issuance minted no tickets`);
    }
  });
}
