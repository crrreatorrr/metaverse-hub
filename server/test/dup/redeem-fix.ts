/**
 * Redeem-fix cases for #25 (custom auth) stacked on #22.
 * A rejection mints no Nakama account, no session token, and no ledger row.
 * audit.sql runs from the suite wrapper after every case.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createHubSdk,
  createNakamaClient,
  memoryKeyValue,
  type HubSdkEnv,
} from '../../../packages/hub-sdk/src/index.ts';
import {
  authenticateCustom,
  call,
  compose,
  customAuthLanded,
  guest,
  note,
  num,
  psql,
  redeemPortalTicket,
  sqlId,
  waitReady,
  type RpcResult,
} from './harness.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

type Game = 'sproto' | 'hpos10i';
type TestFn = (category: string, name: string, fn: () => Promise<void>) => Promise<void>;
type PendingFn = (category: string, name: string, reason: string) => void;

const REDEEM_FIX_CASES = [
  'ticket reuse sequential is exactly one session',
  'ticket reuse concurrent is exactly one session',
  'expired ticket over 60s server clock is rejected',
  'wrong-game ticket is burned and the right game is rejected',
  'raw hub and hold ids are rejected',
  'missing or empty ticket is rejected',
  'http-key writes with no user are rejected',
  'redeemTicket strips #t= from the url',
  'client bundles contain no http key',
  'rate_limited portal.enter mints no ticket',
  'ticket sweep leaves credits and used tickets',
] as const;

const PENDING_REASON = 'waiting for registerBeforeAuthenticateCustom (#25)';

function userCount(): number {
  return num('SELECT count(*) FROM users');
}

function ticketLedger(userId: string): number {
  return num(`SELECT COALESCE(SUM(delta), 0) FROM game.tickets_ledger WHERE user_id = '${sqlId(userId)}'`);
}

function itemRows(userId: string): number {
  return num(`SELECT count(*) FROM game.item_ledger WHERE user_id = '${sqlId(userId)}'`);
}

function verseLedger(userId: string): number {
  return num(`SELECT COALESCE(SUM(delta), 0) FROM game.verse_ledger WHERE user_id = '${sqlId(userId)}'`);
}

function economy(userId: string): string {
  return `tickets=${ticketLedger(userId)} items=${itemRows(userId)} verse=${verseLedger(userId)}`;
}

function sessionRows(userId: string): number {
  return num(`SELECT count(*) FROM game.game_session WHERE user_id = '${sqlId(userId)}'`);
}

function redeemedRows(userId: string): number {
  return num(
    `SELECT count(*) FROM game.game_session WHERE user_id = '${sqlId(userId)}' AND ticket_redeemed_at IS NOT NULL`,
  );
}

async function enter(hubToken: string, game: Game): Promise<{ ticket: string; sessionId: string }> {
  const opened = await call('portal.enter', { game, ranked: false }, hubToken);
  if (opened.body.error || !opened.body.ticket || !opened.body.sessionId) {
    throw new Error(`portal.enter ${opened.status} ${JSON.stringify(opened.body)}`);
  }
  return { ticket: opened.body.ticket, sessionId: opened.body.sessionId };
}

function assertRejected(status: number, token: string | undefined, body: string, label: string): void {
  assert.equal(Boolean(token) && status < 400, false, `${label} minted a session: ${status} ${body.slice(0, 300)}`);
}

async function reuse(parallel: boolean): Promise<void> {
  const who = await guest();
  const usersBefore = userCount();
  const opened = await enter(who.token, 'sproto');
  const sessionsBefore = sessionRows(who.userId);
  const economyBefore = economy(who.userId);
  const attempts = parallel
    ? await Promise.all([
      redeemPortalTicket(opened.ticket, 'sproto'),
      redeemPortalTicket(opened.ticket, 'sproto'),
    ])
    : [
      await redeemPortalTicket(opened.ticket, 'sproto'),
      await redeemPortalTicket(opened.ticket, 'sproto'),
    ];
  const won = attempts.filter((item) => item.token && item.status < 400);
  const lost = attempts.filter((item) => !item.token || item.status >= 400);
  assert.equal(won.length, 1, attempts.map((item) => `${item.status}:${item.body.slice(0, 160)}`).join(' | '));
  assert.equal(lost.length, 1, 'the second redeem was not rejected');
  assert.equal(userCount(), usersBefore, 'redeem created a Nakama account');
  assert.equal(sessionRows(who.userId), sessionsBefore, 'redeem created a second game session');
  assert.equal(redeemedRows(who.userId), 1);
  assert.equal(economy(who.userId), economyBefore, 'redeem wrote the ledger');
}

async function expiredTicket(): Promise<void> {
  const who = await guest();
  const usersBefore = userCount();
  const opened = await enter(who.token, 'sproto');
  const sessionsBefore = sessionRows(who.userId);
  const economyBefore = economy(who.userId);
  const ttl = num(
    `SELECT EXTRACT(EPOCH FROM (expires_at - now()))::int FROM game.auth_ticket WHERE session_id = '${sqlId(opened.sessionId)}'`,
  );
  assert.ok(ttl > 0 && ttl <= 60, `issued ttl ${ttl}s is not the server's 60s window`);
  psql(
    `UPDATE game.auth_ticket SET expires_at = now() - interval '1 second' WHERE session_id = '${sqlId(opened.sessionId)}'`,
  );
  const expired = await redeemPortalTicket(opened.ticket, 'sproto');
  assertRejected(expired.status, expired.token, expired.body, 'expired ticket');
  assert.equal(redeemedRows(who.userId), 0);
  assert.equal(userCount(), usersBefore);
  assert.equal(sessionRows(who.userId), sessionsBefore);
  assert.equal(economy(who.userId), economyBefore);
  const fresh = await enter(who.token, 'sproto');
  const ok = await redeemPortalTicket(fresh.ticket, 'sproto');
  assert.ok(ok.token, `fresh ticket rejected ${ok.status} ${ok.body.slice(0, 180)}`);
  assert.equal(userCount(), usersBefore, 'fresh redeem created an account');
  assert.equal(economy(who.userId), economyBefore);
}

async function wrongGame(): Promise<void> {
  const who = await guest();
  const usersBefore = userCount();
  const opened = await enter(who.token, 'sproto');
  const economyBefore = economy(who.userId);
  const sessionsBefore = sessionRows(who.userId);
  const wrong = await redeemPortalTicket(opened.ticket, 'hpos10i');
  assertRejected(wrong.status, wrong.token, wrong.body, 'wrong-game ticket');
  const burned = psql(
    `SELECT (used_at IS NOT NULL) FROM game.auth_ticket WHERE session_id = '${sqlId(opened.sessionId)}'`,
  );
  assert.equal(burned, 't', 'wrong-game redeem left the ticket unburned');
  assert.equal(redeemedRows(who.userId), 0, 'wrong-game redeem activated a game session');
  const own = await redeemPortalTicket(opened.ticket, 'sproto');
  assertRejected(own.status, own.token, own.body, 'right-game redeem after a burned ticket');
  note('wrong-game redeem burned the ticket; the later sproto redeem was rejected');
  assert.equal(sessionRows(who.userId), sessionsBefore);
  assert.equal(redeemedRows(who.userId), 0);
  assert.equal(userCount(), usersBefore);
  assert.equal(economy(who.userId), economyBefore);
}

async function rawHubId(): Promise<void> {
  const who = await guest();
  const usersBefore = userCount();
  const economyBefore = economy(who.userId);
  const hubId = await authenticateCustom(`hub:${who.userId}`);
  assertRejected(hubId.status, hubId.token, hubId.body, `hub:${who.userId}`);
  const holdId = await authenticateCustom(`hold${who.userId.replace(/-/g, '')}`);
  assertRejected(holdId.status, holdId.token, holdId.body, 'hold id');
  assert.equal(userCount(), usersBefore, 'rejected custom id created an account');
  assert.equal(economy(who.userId), economyBefore);
  assert.equal(sessionRows(who.userId), 0);
}

async function missingTicket(): Promise<void> {
  const usersBefore = userCount();
  for (const [label, id] of [['t: alone', 't:'], ['empty id', ''], ['missing id', undefined]] as const) {
    const result = await authenticateCustom(id);
    assertRejected(result.status, result.token, result.body, label);
    assert.equal(userCount(), usersBefore, `${label} created an account`);
  }
}

function rejectedWrite(result: RpcResult): boolean {
  return result.status >= 400 || Boolean(result.body.error);
}

async function httpKeyWrites(): Promise<void> {
  const who = await guest();
  const usersBefore = userCount();
  const economyBefore = economy(who.userId);
  const calls: Array<[string, object]> = [
    ['session.redeem', { ticket: 'not-a-ticket', gameId: 'sproto' }],
    ['tickets.earn', { amount: 20, reason: 'win', key: 'http-earn' }],
    ['tickets.exchange', { tickets: 20, key: 'http-exchange' }],
    ['tickets.spend', { game: 'sproto', shop_id: 'shop', item_id: 'item', packs: 1, key: 'http-spend' }],
    ['tickets.sell', { game: 'sproto', shop_id: 'shop', item_id: 'item', packs: 1, key: 'http-sell' }],
    ['session.event', { eventId: 'sproto.boss_defeated', data: { boss: 'tinubu', elapsed: 12 }, key: 'http-crown' }],
    ['score.submit', { boardId: 'sproto_wins', value: 1, meta: {} }],
    ['relic.grant', { relicId: 'tinubu_crown', amount: 1, key: 'http-relic' }],
  ];
  for (const [name, body] of calls) {
    const result = await call(name, body);
    assert.equal(rejectedWrite(result), true, `${name} accepted an HTTP-key call: ${result.status} ${JSON.stringify(result.body)}`);
    assert.equal(result.body.token, undefined, `${name} minted a session`);
    assert.equal(result.body.balance, undefined, `${name} credited tickets`);
    assert.equal(result.body.granted, undefined, `${name} granted a relic`);
    assert.equal(result.body.verse, undefined, `${name} credited verse`);
    assert.equal(economy(who.userId), economyBefore, `${name} wrote the ledger`);
    assert.equal(userCount(), usersBefore, `${name} created an account`);
  }
}

async function hashStripped(): Promise<void> {
  const who = await guest();
  const opened = await enter(who.token, 'sproto');
  const usersBefore = userCount();
  let hash = `#t=${opened.ticket}`;
  const client = createNakamaClient({ serverUrl: 'http://127.0.0.1:7350', serverKey: 'defaultkey' });
  const env: HubSdkEnv = {
    serverUrl: 'http://127.0.0.1:7350',
    serverKey: 'defaultkey',
    client,
    local: memoryKeyValue(),
    session: memoryKeyValue(),
    hubUrl: '/hub/',
    now: () => Date.now(),
    readHash: () => hash,
    writeHash: (next) => {
      hash = next;
    },
    assign: () => undefined,
    releasePointer: () => undefined,
    clearBeforeUnload: () => undefined,
  };
  const sdk = createHubSdk(env);
  const session = await sdk.redeemTicket({ game: 'sproto' });
  assert.equal(hash.includes('t='), false, `fragment still ${hash}`);
  assert.ok(session.token);
  assert.equal(userCount(), usersBefore);
  assert.equal(economy(who.userId), 'tickets=0 items=0 verse=0');
  assert.equal(redeemedRows(who.userId), 1);
}

function clientFiles(): string[] {
  const roots = [
    path.join(ROOT, 'packages/hub-sdk/src'),
    path.join(ROOT, 'apps/hub/src'),
    path.join(ROOT, 'apps/hub/play'),
    path.join(ROOT, 'apps/hub/dist'),
    path.join(ROOT, 'packages/hub-sdk/dist'),
  ];
  const files: string[] = [];
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === 'node_modules') continue;
      const full = path.join(dir, name);
      let info: ReturnType<typeof statSync>;
      try {
        info = statSync(full);
      } catch {
        continue;
      }
      if (info.isDirectory()) walk(full);
      else if (/\.(ts|js|mjs|css|html)$/.test(name)) files.push(full);
    }
  };
  for (const root of roots) walk(root);
  return files;
}

async function bundlesHaveNoHttpKey(): Promise<void> {
  const needles = ['localhttpkey', 'http_key', 'NAKAMA_HTTP_KEY'];
  const hits: string[] = [];
  for (const file of clientFiles()) {
    const text = readFileSync(file, 'utf8');
    for (const needle of needles) {
      if (text.includes(needle)) hits.push(`${path.relative(ROOT, file)} contains ${needle}`);
    }
  }
  assert.equal(hits.length, 0, `client bundle still has the HTTP key:\n${hits.join('\n')}`);
}

async function rateLimitedEnter(): Promise<void> {
  const who = await guest();
  const usersBefore = userCount();
  const economyBefore = economy(who.userId);
  for (let i = 0; i < 10; i += 1) {
    const opened = await call('portal.enter', { game: 'sproto', ranked: false }, who.token);
    assert.equal(opened.body.error, undefined, JSON.stringify(opened.body));
    assert.ok(opened.body.ticket, `enter ${i + 1} did not mint a ticket`);
  }
  const blocked = await call('portal.enter', { game: 'sproto', ranked: false }, who.token);
  assert.equal(blocked.body.error, 'rate_limited', JSON.stringify(blocked.body));
  assert.equal(blocked.body.ticket, undefined, JSON.stringify(blocked.body));
  assert.equal(sessionRows(who.userId), 10);
  assert.equal(num(`SELECT count(*) FROM game.auth_ticket WHERE user_id = '${sqlId(who.userId)}'`), 10);
  assert.equal(userCount(), usersBefore);
  assert.equal(economy(who.userId), economyBefore);
  assert.equal(redeemedRows(who.userId), 0);
}

function economyRows(userId: string): string {
  return [
    economy(userId),
    `idem=${num(`SELECT count(*) FROM game.idempotency WHERE user_id = '${sqlId(userId)}'`)}`,
    `claims=${num(`SELECT count(*) FROM game.relic_claim WHERE user_id = '${sqlId(userId)}'`)}`,
  ].join(' ');
}

async function sweepLeavesEconomy(): Promise<void> {
  const who = await guest();
  const opened = await enter(who.token, 'sproto');
  const redeemed = await redeemPortalTicket(opened.ticket, 'sproto');
  assert.ok(redeemed.token, redeemed.body);
  const earned = await call('tickets.earn', { amount: 20, reason: 'win', key: 'sweep-earn' }, redeemed.token);
  assert.equal(earned.body.error, undefined, JSON.stringify(earned.body));
  assert.equal(earned.body.capped, false, JSON.stringify(earned.body));
  assert.equal(earned.body.balance, 20);
  const crowned = await call('session.event', {
    eventId: 'sproto.boss_defeated',
    data: { boss: 'tinubu', elapsed: 12 },
    key: 'sweep-crown',
  }, redeemed.token);
  assert.equal(crowned.body.granted, 'tinubu_crown', JSON.stringify(crowned.body));
  const before = economyRows(who.userId);
  psql(
    `INSERT INTO game.auth_ticket (ticket_hash, user_id, game_id, session_id, ranked, expires_at, created_at)
     VALUES (decode('${'ab'.repeat(32)}', 'hex'), '${sqlId(who.userId)}', 'sproto', '${sqlId(opened.sessionId)}', false, now() + interval '1 minute', now() - interval '2 hours')`,
  );
  psql(
    `INSERT INTO game.portal_attempt (user_id, created_at) VALUES ('${sqlId(who.userId)}', now() - interval '2 hours')`,
  );
  psql(`UPDATE game.maint_sweep SET ran_at = now() - interval '2 hours' WHERE name = 'auth_ticket'`);
  const sweepEnter = await call('portal.enter', { game: 'hpos10i', ranked: false }, who.token);
  assert.equal(sweepEnter.body.error, undefined, JSON.stringify(sweepEnter.body));
  assert.equal(num(`SELECT count(*) FROM game.auth_ticket WHERE ticket_hash = decode('${'ab'.repeat(32)}', 'hex')`), 0);
  assert.equal(
    num(`SELECT count(*) FROM game.portal_attempt WHERE user_id = '${sqlId(who.userId)}' AND created_at < now() - interval '1 hour'`),
    0,
  );
  assert.equal(economyRows(who.userId), before, 'hourly sweep changed the economy');
  const replay = await call('tickets.earn', { amount: 20, reason: 'win', key: 'sweep-earn' }, redeemed.token);
  assert.equal(replay.body.error, undefined, JSON.stringify(replay.body));
  assert.equal(replay.body.balance, 20);
  assert.equal(ticketLedger(who.userId), 20);
  const usedAgain = await redeemPortalTicket(opened.ticket, 'sproto');
  assertRejected(usedAgain.status, usedAgain.token, usedAgain.body, 'used ticket after hourly sweep');

  psql(
    `INSERT INTO game.auth_ticket (ticket_hash, user_id, game_id, session_id, ranked, expires_at, created_at)
     VALUES (decode('${'cd'.repeat(32)}', 'hex'), '${sqlId(who.userId)}', 'sproto', '${sqlId(opened.sessionId)}', false, now() + interval '1 minute', now() - interval '2 hours')`,
  );
  compose(['restart', 'nakama']);
  await waitReady();
  assert.equal(num(`SELECT count(*) FROM game.auth_ticket WHERE ticket_hash = decode('${'cd'.repeat(32)}', 'hex')`), 0);
  assert.equal(economyRows(who.userId), before, 'boot sweep changed the economy');
  const afterBoot = await call('tickets.earn', { amount: 20, reason: 'win', key: 'sweep-earn' }, redeemed.token);
  assert.equal(afterBoot.body.error, undefined, JSON.stringify(afterBoot.body));
  assert.equal(afterBoot.body.balance, 20);
  assert.equal(ticketLedger(who.userId), 20);
  const usedAfterBoot = await redeemPortalTicket(opened.ticket, 'sproto');
  assertRejected(usedAfterBoot.status, usedAfterBoot.token, usedAfterBoot.body, 'used ticket after boot sweep');
  assert.equal(num(`SELECT count(*) FROM game.relic_claim WHERE user_id = '${sqlId(who.userId)}'`), 1);
}

export async function runRedeemFix(test: TestFn, pending: PendingFn): Promise<void> {
  if (!customAuthLanded()) {
    for (const name of REDEEM_FIX_CASES) pending('redeem-fix', name, PENDING_REASON);
    return;
  }
  await test('redeem-fix', 'ticket reuse sequential is exactly one session', () => reuse(false));
  await test('redeem-fix', 'ticket reuse concurrent is exactly one session', () => reuse(true));
  await test('redeem-fix', 'expired ticket over 60s server clock is rejected', expiredTicket);
  await test('redeem-fix', 'wrong-game ticket is burned and the right game is rejected', wrongGame);
  await test('redeem-fix', 'raw hub and hold ids are rejected', rawHubId);
  await test('redeem-fix', 'missing or empty ticket is rejected', missingTicket);
  await test('redeem-fix', 'http-key writes with no user are rejected', httpKeyWrites);
  await test('redeem-fix', 'redeemTicket strips #t= from the url', hashStripped);
  await test('redeem-fix', 'client bundles contain no http key', bundlesHaveNoHttpKey);
  await test('redeem-fix', 'rate_limited portal.enter mints no ticket', rateLimitedEnter);
  await test('redeem-fix', 'ticket sweep leaves credits and used tickets', sweepLeavesEconomy);
}
