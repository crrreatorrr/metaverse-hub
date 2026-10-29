import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const BASE = 'http://127.0.0.1:7350';
const SERVER_KEY = 'defaultkey';
const HTTP_KEY = 'localhttpkey';

const AUDIT = `
SELECT count(*) FROM (
  SELECT user_id, item_id, count(*) FROM game.item_ledger
   WHERE op = 'grant_relic' GROUP BY 1, 2 HAVING count(*) > 1
  UNION ALL
  SELECT c.user_id, c.relic_id, 0 FROM game.relic_claim c
    LEFT JOIN game.item_ledger l ON l.event_id = c.event_id
   WHERE l.seq IS NULL
  UNION ALL
  SELECT b.user_id, b.game_id, b.balance FROM game.tickets_balance b
    JOIN game.tickets_ledger l USING (user_id, game_id)
   GROUP BY 1, 2, 3 HAVING b.balance <> sum(l.delta)
  UNION ALL
  SELECT w.user_id, 'verse', w.balance FROM game.verse_wallet w
    JOIN game.verse_ledger l USING (user_id)
   GROUP BY 1, 2, 3 HAVING w.balance <> sum(l.delta)
) audit`;

interface RpcBody {
  error?: string;
  message?: string;
  token?: string;
  playerId?: string;
  granted?: string;
  code?: string;
  userId?: string;
  restored?: boolean;
  scope?: string;
  relics?: string[];
  gameBeaten?: string[];
  ticket?: string;
  balance?: number;
  capped?: boolean;
  verse?: number;
  ticketsLeft?: number;
  receiptId?: string;
  rows?: { gameId?: string; lifetime?: number }[];
}

function authHeader(): string {
  return `Basic ${Buffer.from(`${SERVER_KEY}:`).toString('base64')}`;
}

function userIdFrom(token: string): string {
  const part = token.split('.')[1];
  if (!part) throw new Error('token has no payload');
  const json = JSON.parse(Buffer.from(part, 'base64url').toString()) as { uid?: string };
  if (!json.uid) throw new Error(`token payload missing uid: ${JSON.stringify(json)}`);
  return json.uid;
}

async function authenticate(deviceId: string, vars?: Record<string, string>): Promise<{ token: string; userId: string }> {
  const response = await fetch(`${BASE}/v2/account/authenticate/device?create=true`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify(vars ? { id: deviceId, vars } : { id: deviceId }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`auth ${response.status} ${text}`);
  const body = JSON.parse(text) as { token?: string };
  if (!body.token) throw new Error(text);
  return { token: body.token, userId: userIdFrom(body.token) };
}

async function call(name: string, body: object, token?: string): Promise<RpcBody> {
  const params = new URLSearchParams({ unwrap: 'true' });
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  else params.set('http_key', HTTP_KEY);
  const response = await fetch(`${BASE}/v2/rpc/${name}?${params}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: RpcBody;
  try {
    parsed = JSON.parse(text) as RpcBody;
  } catch {
    throw new Error(`${name} ${response.status} not json: ${text}`);
  }
  if (!response.ok) throw new Error(`${name} ${response.status} ${text}`);
  return parsed;
}

function psql(sql: string): string {
  return execFileSync(
    'docker',
    ['compose', '-f', 'server/docker-compose.yml', 'exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'nakama', '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql],
    { encoding: 'utf8' },
  ).trim();
}

async function waitReady(): Promise<void> {
  const deadline = Date.now() + 120_000;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const body = await call('healthcheck', {});
      if (body.error) last = body.error;
      else return;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Nakama did not become ready: ${last}`);
}

async function enter(token: string, game: string): Promise<string> {
  const opened = await call('portal.enter', { game, ranked: false }, token);
  if (!opened.ticket || opened.error) throw new Error(opened.error || 'no ticket');
  return opened.ticket;
}

async function redeem(ticket: string, game: string): Promise<string> {
  const body = await call('session.redeem', { ticket, gameId: game });
  if (body.error || !body.token) throw new Error(body.error || 'redeem failed');
  return body.token;
}

async function main(): Promise<void> {
  await waitReady();
  const deviceA = crypto.randomUUID();
  const forged = await authenticate(deviceA, { scope: 'game', game: 'sproto', sid: crypto.randomUUID() });
  const who = await call('profile.get', {}, forged.token);
  assert.equal(who.scope, 'hub', 'device auth must not keep a forged game scope');
  assert.equal(who.error, undefined);

  const again = await authenticate(deviceA);
  assert.equal(again.userId, forged.userId, 'the same device id keeps the same guest');

  const code = await call('recovery.create', {}, forged.token);
  assert.equal(code.error, undefined);
  assert.match(code.code ?? '', /^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
  const secondCode = await call('recovery.create', {}, forged.token);
  assert.equal(secondCode.error, 'recovery_exists');

  const ticket = await enter(forged.token, 'sproto');
  const [firstRedeem, secondRedeem] = await Promise.all([
    call('session.redeem', { ticket, gameId: 'sproto' }),
    call('session.redeem', { ticket, gameId: 'sproto' }),
  ]);
  const redeems = [firstRedeem, secondRedeem];
  const winners = redeems.filter((item) => item.token && !item.error);
  assert.equal(winners.length, 1, 'a ticket can be redeemed once');
  assert.equal(redeems.filter((item) => item.error === 'ticket_used').length, 1);
  const gameToken = winners[0]?.token;
  if (!gameToken) throw new Error('missing game token');

  const forgedTicket = `${ticket.slice(0, -4)}abcd`;
  const forgedRedeem = await call('session.redeem', { ticket: forgedTicket, gameId: 'sproto' });
  assert.equal(forgedRedeem.error, 'ticket_invalid');

  const hubEvent = await call('session.event', {
    eventId: 'sproto.boss_defeated',
    data: { boss: 'tinubu', godMode: true },
    key: 'from-hub',
  }, forged.token);
  assert.equal(hubEvent.error, 'not_game_session');

  const payload = { boss: 'tinubu', elapsed: 12, godMode: true };
  const first = await call('session.event', { eventId: 'sproto.boss_defeated', data: payload, key: 'tinubu' }, gameToken);
  assert.equal(first.granted, 'tinubu_crown');
  for (let i = 0; i < 100; i += 1) {
    const replay = await call('session.event', { eventId: 'sproto.boss_defeated', data: payload, key: 'tinubu' }, gameToken);
    assert.equal(replay.error, undefined);
    assert.equal(replay.granted, 'tinubu_crown');
  }
  const sameKey = await Promise.all(Array.from({ length: 20 }, () => (
    call('session.event', { eventId: 'sproto.boss_defeated', data: payload, key: 'tinubu' }, gameToken)
  )));
  for (const replay of sameKey) assert.equal(replay.granted, 'tinubu_crown');
  const otherKeys = await Promise.all(Array.from({ length: 20 }, (_, index) => (
    call('session.event', { eventId: 'sproto.boss_defeated', data: payload, key: `other-${index}` }, gameToken)
  )));
  for (const replay of otherKeys) {
    assert.equal(replay.error, undefined);
    assert.equal(replay.granted, undefined);
  }
  const mismatch = await call('session.event', {
    eventId: 'sproto.boss_defeated',
    data: { boss: 'tinubu', elapsed: 99, godMode: true },
    key: 'tinubu',
  }, gameToken);
  assert.equal(mismatch.error, 'idempotency_mismatch');
  const wrongGame = await call('session.event', {
    eventId: 'nobu.boss_defeated',
    data: { boss: 'cone' },
    key: 'not-cone',
  }, gameToken);
  assert.equal(wrongGame.granted, undefined);

  assert.equal(psql(`SELECT count(*) FROM game.relic_claim WHERE user_id = '${forged.userId}'`), '1');
  assert.equal(psql(`SELECT count(*) FROM game.item_ledger WHERE user_id = '${forged.userId}' AND op = 'grant_relic'`), '1');

  const deviceB = crypto.randomUUID();
  const guestB = await authenticate(deviceB);
  assert.notEqual(guestB.userId, forged.userId);
  const restored = await call('recovery.redeem', { code: code.code, deviceId: deviceB }, guestB.token);
  assert.equal(restored.error, undefined);
  assert.equal(restored.userId, forged.userId);
  const deviceC = crypto.randomUUID();
  const guestC = await authenticate(deviceC);
  const reused = await call('recovery.redeem', { code: code.code, deviceId: deviceC }, guestC.token);
  assert.equal(reused.error, 'recovery_invalid');
  const back = await authenticate(deviceB);
  assert.equal(back.userId, forged.userId, 'the restored device authenticates as the original guest');
  const againTicket = await enter(back.token, 'sproto');
  const againGame = await redeem(againTicket, 'sproto');
  const secondGrant = await call('session.event', {
    eventId: 'game_beaten',
    data: {},
    key: 'after-restore',
  }, againGame);
  assert.equal(secondGrant.granted, undefined);
  assert.equal(psql(`SELECT count(*) FROM game.item_ledger WHERE user_id = '${forged.userId}' AND op = 'grant_relic'`), '1');
  const beaten = psql(`SELECT count(*) FROM storage WHERE collection = 'metaverse' AND key = 'game_beaten:sproto' AND user_id = '${forged.userId}'`);
  assert.equal(beaten, '1');

  const other = await authenticate(crypto.randomUUID());
  const cases: { game: string; eventId: string; data: object; relic: string }[] = [
    { game: 'hpos10i', eventId: 'hpos10i.level_complete', data: { zone: 'z1_retro_rush_hills', act: 1, time: 40 }, relic: 'hpos10i_core' },
    { game: 'pb', eventId: 'pb.quest_complete', data: { questId: 'quest_tutorial', tick: 3 }, relic: 'genesis_shard' },
    { game: 'nobu', eventId: 'nobu.boss_defeated', data: { boss: 'cone', godMode: true }, relic: 'cones_tip' },
  ];
  for (const item of cases) {
    const gameTokenOther = await redeem(await enter(other.token, item.game), item.game);
    const granted = await call('session.event', { eventId: item.eventId, data: item.data, key: item.relic }, gameTokenOther);
    assert.equal(granted.granted, item.relic);
    const replay = await call('session.event', { eventId: item.eventId, data: item.data, key: `${item.relic}-2` }, gameTokenOther);
    assert.equal(replay.granted, undefined);
  }

  const economy = await authenticate(crypto.randomUUID());
  const econToken = await redeem(await enter(economy.token, 'sproto'), 'sproto');
  const earned = await call('tickets.earn', { amount: 40, reason: 'win', key: 'earn-1' }, econToken);
  assert.equal(earned.error, undefined);
  assert.equal(earned.balance, 40);
  assert.equal(earned.capped, false);
  for (let i = 0; i < 100; i += 1) {
    const replay = await call('tickets.earn', { amount: 40, reason: 'win', key: 'earn-1' }, econToken);
    assert.equal(replay.balance, 40);
  }
  const earnBurst = await Promise.all(Array.from({ length: 20 }, () => (
    call('tickets.earn', { amount: 40, reason: 'win', key: 'earn-1' }, econToken)
  )));
  for (const replay of earnBurst) assert.equal(replay.balance, 40);
  const traded = await call('tickets.exchange', { tickets: 25, key: 'ex-1' }, econToken);
  assert.equal(traded.error, undefined);
  assert.equal(traded.verse, 2);
  assert.equal(traded.ticketsLeft, 20);
  const receipt = traded.receiptId;
  for (let i = 0; i < 100; i += 1) {
    const replay = await call('tickets.exchange', { tickets: 25, key: 'ex-1' }, econToken);
    assert.equal(replay.receiptId, receipt);
    assert.equal(replay.verse, 2);
  }
  const exchangeBurst = await Promise.all(Array.from({ length: 20 }, () => (
    call('tickets.exchange', { tickets: 25, key: 'ex-1' }, econToken)
  )));
  for (const replay of exchangeBurst) assert.equal(replay.receiptId, receipt);
  const races = await Promise.all(Array.from({ length: 20 }, (_, index) => (
    call('tickets.exchange', { tickets: 10, key: `race-${index}` }, econToken)
  )));
  const raceWins = races.filter((item) => !item.error);
  assert.equal(raceWins.length, 2, '20 tickets can fund two 10-ticket exchanges');
  assert.equal(psql(`SELECT balance FROM game.verse_wallet WHERE user_id = '${economy.userId}'`), '4');
  assert.equal(psql(`SELECT balance FROM game.tickets_balance WHERE user_id = '${economy.userId}' AND game_id = 'sproto'`), '0');
  const topped = await call('tickets.earn', { amount: 1000, reason: 'grind', key: 'earn-cap' }, econToken);
  assert.equal(topped.error, undefined);
  assert.equal(topped.capped, true);
  const filled = await call('tickets.exchange', { tickets: 600, key: 'ex-fill' }, econToken);
  assert.equal(filled.error, undefined);
  assert.equal(filled.verse, 50);
  const over = await call('tickets.exchange', { tickets: 10, key: 'ex-over' }, econToken);
  assert.equal(over.error, 'verse_cap');
  const board = await call('verse.board', {}, economy.token);
  assert.equal(board.error, undefined);
  assert.ok((board.rows ?? []).some((row) => row.gameId === 'sproto' && (row.lifetime ?? 0) >= 50));
  assert.equal(psql(`SELECT lifetime FROM game.verse_earned WHERE user_id = '${economy.userId}' AND game_id = 'sproto'`), '50');

  assert.equal(psql(AUDIT), '0');
  console.log('duplication tests ok');
}

await main();
