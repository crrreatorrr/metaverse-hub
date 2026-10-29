import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FLOWS,
  TICKET_DAILY_CAP,
  TICKETS_PER_VERSE,
  VERSE_DAILY_CAP,
  repeatCount,
  type EarnFlow,
  type ExchangeFlow,
  type PurchaseFlow,
  type RelicFlow,
} from './cases.ts';
import { runGated } from './gated.ts';
import { runShop } from './shop.ts';
import {
  arm,
  assertConflict,
  assertSame,
  audit,
  call,
  canonical,
  disarm,
  dropFaultHooks,
  earn,
  earnLedgerCount,
  ensureNakama,
  exchangeCount,
  faulted,
  findingsList,
  installFaultHooks,
  killDuringSleep,
  login,
  mints,
  note,
  num,
  openGame,
  outboxSend,
  psql,
  relicClaims,
  serverDay,
  snapshotEconomy,
  sqlId,
  ticketBalance,
  verseBalance,
  waitReady,
  authenticate,
  guest,
  type GameLogin,
  type RpcBody,
  type RpcResult,
} from './harness.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

interface Outcome {
  category: string;
  name: string;
  status: 'pass' | 'fail' | 'pending';
  detail?: string;
}

const outcomes: Outcome[] = [];

function testBudget(name: string): number {
  if (name.includes('kill_between')) return 240_000;
  if (name.includes('x100')) return 150_000;
  if (name.includes('kill_')) return 120_000;
  return 60_000;
}

async function test(category: string, name: string, fn: () => Promise<void>): Promise<void> {
  const budget = testBudget(name);
  let failure: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${budget}ms`)), budget);
      }),
    ]);
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  } finally {
    if (timer) clearTimeout(timer);
  }
  try {
    audit();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    failure = failure ? `${failure}\n${detail}` : detail;
  }
  if (failure) {
    outcomes.push({ category, name, status: 'fail', detail: failure });
    console.error(`FAIL ${category} ${name}\n${failure}\n`);
    return;
  }
  outcomes.push({ category, name, status: 'pass' });
  console.log(`PASS ${category} ${name}`);
}

function relicBody(flow: RelicFlow, key: string, data: object = flow.data): object {
  return { eventId: flow.eventId, data, key };
}

function exchangeBody(flow: ExchangeFlow, key: string, extra: object = {}): object {
  return { tickets: flow.tickets, key, ...extra };
}

async function storm(name: string, body: object, token: string, times: number, parallel: boolean): Promise<RpcResult[]> {
  if (parallel) {
    return Promise.all(Array.from({ length: times }, () => call(name, body, token)));
  }
  const results: RpcResult[] = [];
  for (let i = 0; i < times; i += 1) results.push(await call(name, body, token));
  return results;
}

function relicFlows(): RelicFlow[] {
  return FLOWS.filter((flow): flow is RelicFlow => flow.kind === 'relic');
}

function exchangeFlows(): ExchangeFlow[] {
  return FLOWS.filter((flow): flow is ExchangeFlow => flow.kind === 'exchange');
}

function earnFlows(): EarnFlow[] {
  return FLOWS.filter((flow): flow is EarnFlow => flow.kind === 'earn');
}

function purchaseFlows(): PurchaseFlow[] {
  return FLOWS.filter((flow): flow is PurchaseFlow => flow.kind === 'purchase');
}

function grantFailure(flow: RelicFlow, body: RpcBody | undefined): string | null {
  if (body?.granted === flow.relicId && !body.error) return null;
  const detail = JSON.stringify(body);
  if (typeof flow.data.time === 'number') {
    return `blocked on event_rule subset-matching follow-up: ${flow.id} included time and was not granted (${detail})`;
  }
  return `expected ${flow.relicId}, got ${detail}`;
}

async function idempotency(): Promise<void> {
  for (const flow of relicFlows()) {
    await test('idempotency', `${flow.id} same key x${repeatCount('sequential')} sequential`, async () => {
      const session = await login(flow.game);
      const results = await storm('session.event', relicBody(flow, 'grant-seq'), session.gameToken, repeatCount('sequential'), false);
      assertSame(results);
      const why = grantFailure(flow, results[0]?.body);
      if (why) throw new Error(why);
      assert.equal(relicClaims(session.hub.userId, flow.relicId), 1);
      assert.equal(mints(session.hub.userId, flow.relicId), 1);
    });

    await test('idempotency', `${flow.id} same key x${repeatCount('concurrent')} concurrent first claim`, async () => {
      const session = await login(flow.game);
      const results = await storm('session.event', relicBody(flow, 'grant-race'), session.gameToken, repeatCount('concurrent'), true);
      assertSame(results);
      const why = grantFailure(flow, results[0]?.body);
      if (why) throw new Error(why);
      assert.equal(relicClaims(session.hub.userId, flow.relicId), 1);
      assert.equal(mints(session.hub.userId, flow.relicId), 1);
    });

    await test('idempotency', `${flow.id} same key different body is a conflict`, async () => {
      const session = await login(flow.game);
      const first = await call('session.event', relicBody(flow, 'grant-body'), session.gameToken);
      const why = grantFailure(flow, first.body);
      if (why) throw new Error(why);
      const mismatch = await call('session.event', relicBody(flow, 'grant-body', flow.mismatchData), session.gameToken);
      assertConflict(mismatch);
      const replay = await call('session.event', relicBody(flow, 'grant-body'), session.gameToken);
      assert.equal(canonical(replay.body), canonical(first.body));
      const freshMismatch = await call('session.event', relicBody(flow, 'grant-mismatch', flow.mismatchData), session.gameToken);
      assert.equal(freshMismatch.body.error, undefined, JSON.stringify(freshMismatch.body));
      assert.equal(freshMismatch.body.granted, undefined, JSON.stringify(freshMismatch.body));
      assert.equal(mints(session.hub.userId, flow.relicId), 1);
    });

    await test('idempotency', `${flow.id} new key cannot grant again`, async () => {
      const session = await login(flow.game);
      const first = await call('session.event', relicBody(flow, 'grant-once'), session.gameToken);
      const why = grantFailure(flow, first.body);
      if (why) throw new Error(why);
      const second = await call('session.event', relicBody(flow, 'grant-twice'), session.gameToken);
      assert.equal(second.body.error, undefined);
      assert.equal(second.body.granted, undefined);
      assert.equal(relicClaims(session.hub.userId, flow.relicId), 1);
      assert.equal(mints(session.hub.userId, flow.relicId), 1);
    });
  }

  for (const flow of exchangeFlows()) {
    const debit = flow.verse * TICKETS_PER_VERSE;
    const left = flow.earnAmount - debit;

    await test('idempotency', `${flow.id} same key x${repeatCount('sequential')} sequential`, async () => {
      const session = await login(flow.game);
      await earn(session.gameToken, flow.earnAmount, flow.earnReason, 'fund-seq');
      const results = await storm('tickets.exchange', exchangeBody(flow, 'ex-seq'), session.gameToken, repeatCount('sequential'), false);
      assertSame(results);
      assert.equal(results[0]?.body.error, undefined);
      assert.equal(results[0]?.body.verse, flow.verse);
      assert.equal(results[0]?.body.ticketsLeft, left);
      assert.equal(exchangeCount(session.hub.userId), 1);
      assert.equal(verseBalance(session.hub.userId), flow.verse);
      assert.equal(ticketBalance(session.hub.userId, flow.game), left);
    });

    await test('idempotency', `${flow.id} same key x${repeatCount('concurrent')} concurrent first exchange`, async () => {
      const session = await login(flow.game);
      await earn(session.gameToken, flow.earnAmount, flow.earnReason, 'fund-race');
      const results = await storm('tickets.exchange', exchangeBody(flow, 'ex-race'), session.gameToken, repeatCount('concurrent'), true);
      assertSame(results);
      assert.equal(results[0]?.body.receiptId !== undefined, true);
      assert.equal(exchangeCount(session.hub.userId), 1);
      assert.equal(verseBalance(session.hub.userId), flow.verse);
      assert.equal(ticketBalance(session.hub.userId, flow.game), left);
    });

    await test('idempotency', `${flow.id} same key different body is a conflict`, async () => {
      const session = await login(flow.game);
      await earn(session.gameToken, flow.earnAmount, flow.earnReason, 'fund-body');
      const first = await call('tickets.exchange', exchangeBody(flow, 'ex-body'), session.gameToken);
      assert.equal(first.body.error, undefined);
      const mismatch = await call('tickets.exchange', { tickets: flow.tickets + TICKETS_PER_VERSE, key: 'ex-body' }, session.gameToken);
      assertConflict(mismatch);
      const replay = await call('tickets.exchange', exchangeBody(flow, 'ex-body'), session.gameToken);
      assert.equal(canonical(replay.body), canonical(first.body));
      assert.equal(exchangeCount(session.hub.userId), 1);
      assert.equal(verseBalance(session.hub.userId), flow.verse);
    });

    await test('idempotency', `${flow.id} completed key does not debit again`, async () => {
      const session = await login(flow.game);
      await earn(session.gameToken, flow.earnAmount, flow.earnReason, 'fund-new');
      const first = await call('tickets.exchange', exchangeBody(flow, 'ex-1'), session.gameToken);
      assert.equal(first.body.verse, flow.verse);
      const second = await call('tickets.exchange', exchangeBody(flow, 'ex-2'), session.gameToken);
      assert.equal(second.body.error, undefined);
      assert.notEqual(second.body.receiptId, first.body.receiptId);
      assert.equal(verseBalance(session.hub.userId), flow.verse * 2);
      assert.equal(exchangeCount(session.hub.userId), 2);
      const replay = await call('tickets.exchange', exchangeBody(flow, 'ex-1'), session.gameToken);
      assert.equal(canonical(replay.body), canonical(first.body));
      assert.equal(exchangeCount(session.hub.userId), 2);
    });

    await test('idempotency', `${flow.id} earn same key does not credit twice`, async () => {
      const session = await login(flow.game);
      const body = { amount: flow.earnAmount, reason: flow.earnReason, key: 'earn-seq' };
      const results = await storm('tickets.earn', body, session.gameToken, repeatCount('sequential'), false);
      assertSame(results);
      assert.equal(results[0]?.body.balance, flow.earnAmount);
      assert.equal(results[0]?.body.capped, false);
      const burst = await storm('tickets.earn', body, session.gameToken, repeatCount('concurrent'), true);
      assertSame(burst);
      assert.equal(canonical(burst[0]?.body), canonical(results[0]?.body));
      assert.equal(ticketBalance(session.hub.userId, flow.game), flow.earnAmount);
      assert.equal(earnLedgerCount(session.hub.userId), 1);
    });
  }

  for (const flow of earnFlows()) {
    await test('idempotency', `${flow.id} same key x${repeatCount('sequential')} sequential`, async () => {
      const session = await login(flow.game);
      const body = { amount: flow.amount, reason: flow.reason, key: 'level-end' };
      const results = await storm('tickets.earn', body, session.gameToken, repeatCount('sequential'), false);
      assertSame(results);
      assert.equal(results[0]?.body.error, undefined);
      assert.equal(results[0]?.body.balance, flow.amount);
      assert.equal(ticketBalance(session.hub.userId, flow.game), flow.amount);
      assert.equal(earnLedgerCount(session.hub.userId), 1);
      assert.equal(mints(session.hub.userId, 'hpos10i_core'), 0);
    });

    await test('idempotency', `${flow.id} same key x${repeatCount('concurrent')} concurrent`, async () => {
      const session = await login(flow.game);
      const body = { amount: flow.amount, reason: flow.reason, key: 'level-end-race' };
      const results = await storm('tickets.earn', body, session.gameToken, repeatCount('concurrent'), true);
      assertSame(results);
      assert.equal(results[0]?.body.balance, flow.amount);
      assert.equal(earnLedgerCount(session.hub.userId), 1);
    });

    await test('idempotency', `${flow.id} relic key and earn key do not cross-dedupe`, async () => {
      const relic = relicFlows().find((item) => item.game === flow.game);
      if (!relic) throw new Error(`no relic flow for ${flow.game}`);
      const session = await login(flow.game);
      const granted = await call('session.event', relicBody(relic, 'relic-key'), session.gameToken);
      const why = grantFailure(relic, granted.body);
      if (why) throw new Error(why);
      const crossed = await call('tickets.earn', { amount: flow.amount, reason: flow.reason, key: 'relic-key' }, session.gameToken);
      assert.equal(crossed.body.error, 'idempotency_mismatch', JSON.stringify(crossed.body));
      assert.equal(ticketBalance(session.hub.userId, flow.game), 0);
      assert.equal(mints(session.hub.userId, relic.relicId), 1);
      const earned = await call('tickets.earn', { amount: flow.amount, reason: flow.reason, key: 'earn-key' }, session.gameToken);
      assert.equal(earned.body.error, undefined, JSON.stringify(earned.body));
      assert.equal(earned.body.balance, flow.amount);
      const replayGrant = await call('session.event', relicBody(relic, 'relic-key'), session.gameToken);
      assert.equal(replayGrant.body.granted, relic.relicId);
      assert.equal(ticketBalance(session.hub.userId, flow.game), flow.amount);
      assert.equal(earnLedgerCount(session.hub.userId), 1);
      assert.equal(mints(session.hub.userId, relic.relicId), 1);
      const replayEarn = await call('tickets.earn', { amount: flow.amount, reason: flow.reason, key: 'earn-key' }, session.gameToken);
      assert.equal(canonical(replayEarn.body), canonical(earned.body));
      assert.equal(earnLedgerCount(session.hub.userId), 1);
    });
  }

  for (const flow of purchaseFlows()) {
    await test('idempotency', `${flow.id} same key sequential and concurrent`, () => purchaseStorm(flow));
  }
}

async function races(): Promise<void> {
  for (const flow of relicFlows()) {
    await test('race', `${flow.id} two tabs claim the same win`, async () => {
      const trials = repeatCount('concurrent');
      for (let i = 0; i < trials; i += 1) {
        const session = await login(flow.game);
        const [a, b] = await Promise.all([
          call('session.event', relicBody(flow, `tab-a-${i}`), session.gameToken),
          call('session.event', relicBody(flow, `tab-b-${i}`), session.gameToken),
        ]);
        const granted = [a, b].filter((item) => item.body.granted === flow.relicId);
        assert.equal(granted.length, 1, JSON.stringify([a.body, b.body]));
        assert.equal(relicClaims(session.hub.userId, flow.relicId), 1);
        assert.equal(mints(session.hub.userId, flow.relicId), 1);
      }
    });

    await test('race', `${flow.id} two portal enters still mint once`, async () => {
      for (let i = 0; i < 5; i += 1) {
        const who = await guest();
        const [first, second] = await Promise.all([
          call('portal.enter', { game: flow.game, ranked: false }, who.token),
          call('portal.enter', { game: flow.game, ranked: false }, who.token),
        ]);
        const tokens: string[] = [];
        for (const entered of [first, second]) {
          if (!entered.body.ticket) continue;
          const redeemed = await call('session.redeem', { ticket: entered.body.ticket, gameId: flow.game });
          if (redeemed.body.token) tokens.push(redeemed.body.token);
        }
        assert.ok(tokens.length >= 1, JSON.stringify([first.body, second.body]));
        await Promise.all(tokens.map((token, index) => (
          call('session.event', relicBody(flow, `portal-${i}-${index}`), token)
        )));
        assert.equal(mints(who.userId, flow.relicId), 1);
        assert.equal(relicClaims(who.userId, flow.relicId), 1);
      }
    });
  }

  for (const flow of exchangeFlows()) {
    await test('race', `${flow.id} two tabs spend the same tickets`, async () => {
      const trials = repeatCount('concurrent');
      const cost = flow.verse * TICKETS_PER_VERSE;
      for (let i = 0; i < trials; i += 1) {
        const session = await login(flow.game);
        await earn(session.gameToken, cost, flow.earnReason, `fund-tab-${i}`);
        const [a, b] = await Promise.all([
          call('tickets.exchange', { tickets: cost, key: `tab-a-${i}` }, session.gameToken),
          call('tickets.exchange', { tickets: cost, key: `tab-b-${i}` }, session.gameToken),
        ]);
        const wins = [a, b].filter((item) => !item.body.error);
        assert.equal(wins.length, 1, JSON.stringify([a.body, b.body]));
        assert.equal(exchangeCount(session.hub.userId), 1);
        assert.equal(verseBalance(session.hub.userId), flow.verse);
        assert.equal(ticketBalance(session.hub.userId, flow.game), 0);
      }
    });
  }

  for (const flow of earnFlows()) {
    await test('race', `${flow.id} two callers one earn key`, async () => {
      const session = await login(flow.game);
      const body = { amount: flow.amount, reason: flow.reason, key: 'level-end-tabs' };
      const [a, b] = await Promise.all([
        call('tickets.earn', body, session.gameToken),
        call('tickets.earn', body, session.gameToken),
      ]);
      assert.equal(canonical(a.body), canonical(b.body));
      assert.equal(a.body.balance, flow.amount);
      assert.equal(ticketBalance(session.hub.userId, flow.game), flow.amount);
      assert.equal(earnLedgerCount(session.hub.userId), 1);
      assert.equal(mints(session.hub.userId, 'hpos10i_core'), 0);
    });
  }

  await test('race', 'one ticket redeems once', async () => {
    const who = await guest();
    const opened = await call('portal.enter', { game: 'sproto', ranked: false }, who.token);
    assert.ok(opened.body.ticket);
    const [a, b] = await Promise.all([
      call('session.redeem', { ticket: opened.body.ticket, gameId: 'sproto' }),
      call('session.redeem', { ticket: opened.body.ticket, gameId: 'sproto' }),
    ]);
    const wins = [a, b].filter((item) => item.body.token && !item.body.error);
    const used = [a, b].filter((item) => item.body.error === 'ticket_used');
    assert.equal(wins.length, 1, JSON.stringify([a.body, b.body]));
    assert.equal(used.length, 1);
  });
}

async function forged(): Promise<void> {
  const relic = relicFlows()[0];
  const exchange = exchangeFlows()[0];
  if (!relic || !exchange) throw new Error('M1 flows are missing');

  for (const item of relicFlows()) {
  await test('forged', `${item.id} replay after session close does not mint`, async () => {
    const session = await login(item.game);
    const first = await call('session.event', relicBody(item, 'close-key'), session.gameToken);
    const why = grantFailure(item, first.body);
    if (why) throw new Error(why);
    const closed = await call('session.close', {}, session.gameToken);
    assert.equal(closed.body.error, undefined);
    const replay = await call('session.event', relicBody(item, 'close-key'), session.gameToken);
    const stored = canonical(replay.body) === canonical(first.body);
    const rejected = replay.body.error === 'session_closed';
    assert.ok(stored || rejected, JSON.stringify(replay.body));
    const fresh = await call('session.event', relicBody(item, 'close-new'), session.gameToken);
    assert.equal(fresh.body.error, 'session_closed');
    assert.equal(mints(session.hub.userId, item.relicId), 1);
  });
  }

  await test('forged', `${relic.id} expired ticket cannot be redeemed`, async () => {
    const who = await guest();
    const opened = await call('portal.enter', { game: relic.game, ranked: false }, who.token);
    assert.ok(opened.body.ticket && opened.body.sessionId);
    psql(
      `UPDATE game.game_session SET ticket_exp = now() - interval '2 seconds' WHERE session_id = '${sqlId(opened.body.sessionId)}'`,
    );
    const redeemed = await call('session.redeem', { ticket: opened.body.ticket, gameId: relic.game });
    assert.equal(redeemed.body.error, 'ticket_expired');
    assert.equal(relicClaims(who.userId, relic.relicId), 0);
    assert.equal(mints(who.userId, relic.relicId), 0);
  });

  await test('forged', `${relic.id} replay after the session lease does not mint`, async () => {
    const session = await login(relic.game);
    const first = await call('session.event', relicBody(relic, 'lease-key'), session.gameToken);
    assert.equal(first.body.granted, relic.relicId);
    psql(
      `UPDATE game.game_session SET lease_until = now() - interval '2 seconds' WHERE session_id = '${sqlId(session.sessionId)}'`,
    );
    const replay = await call('session.event', relicBody(relic, 'lease-key'), session.gameToken);
    const stored = canonical(replay.body) === canonical(first.body);
    const rejected = replay.body.error === 'session_closed';
    assert.ok(stored || rejected, JSON.stringify(replay.body));
    const fresh = await call('session.event', relicBody(relic, 'lease-new'), session.gameToken);
    assert.equal(fresh.body.error, 'session_closed');
    assert.equal(mints(session.hub.userId, relic.relicId), 1);
  });

  await test('forged', `${relic.id} another user's token does not touch the victim`, async () => {
    const victim = await login(relic.game);
    const granted = await call('session.event', relicBody(relic, 'victim'), victim.gameToken);
    assert.equal(granted.body.granted, relic.relicId);
    const before = snapshotEconomy(victim.hub.userId, relic.game);
    const attacker = await login(relic.game);
    const stolen = await call('session.event', relicBody(relic, 'victim'), attacker.gameToken);
    assert.equal(stolen.body.granted, relic.relicId);
    assert.equal(snapshotEconomy(victim.hub.userId, relic.game), before);
    assert.equal(mints(attacker.hub.userId, relic.relicId), 1);
    const hub = await call('session.event', relicBody(relic, 'from-hub'), victim.hub.token);
    assert.equal(hub.body.error, 'not_game_session');
    assert.equal(snapshotEconomy(victim.hub.userId, relic.game), before);
  });

  await test('forged', `${relic.id} another game's ticket is rejected`, async () => {
    const who = await guest();
    const opened = await call('portal.enter', { game: relic.game, ranked: false }, who.token);
    assert.ok(opened.body.ticket);
    const other = relic.game === 'hpos10i' ? 'sproto' : 'hpos10i';
    const redeemed = await call('session.redeem', { ticket: opened.body.ticket, gameId: other });
    assert.equal(redeemed.body.error, 'ticket_game');
    const forged = `${opened.body.ticket.slice(0, -4)}abcd`;
    const badSig = await call('session.redeem', { ticket: forged, gameId: relic.game });
    assert.equal(badSig.body.error, 'ticket_invalid');
    assert.equal(mints(who.userId, relic.relicId), 0);
  });

  await test('forged', `${relic.id} unknown event and non-rule payload do not mint`, async () => {
    const session = await login(relic.game);
    const unknown = await call('session.event', {
      eventId: 'sproto.not_a_real_event',
      data: { boss: 'tinubu', relicId: relic.relicId },
      key: 'unknown',
    }, session.gameToken);
    assert.equal(unknown.body.granted, undefined);
    const wrong = await call('session.event', {
      eventId: relic.eventId,
      data: { boss: 'obama', zone: 'nope', questId: 'nope' },
      key: 'wrong-payload',
    }, session.gameToken);
    assert.equal(wrong.body.granted, undefined);
    const otherGame = await call('session.event', {
      eventId: 'nobu.boss_defeated',
      data: { boss: 'cone' },
      key: 'other-game',
    }, session.gameToken);
    assert.equal(otherGame.body.granted, undefined);
    assert.equal(mints(session.hub.userId, relic.relicId), 0);
    assert.equal(num(`SELECT count(*) FROM game.item_ledger WHERE user_id = '${sqlId(session.hub.userId)}'`), 0);
  });

  await test('forged', `${relic.id} client cannot name the item`, async () => {
    const session = await login(relic.game);
    const named = await call('session.event', {
      eventId: 'game_beaten',
      data: { relicId: 'hpos10i_core', itemId: relic.relicId, amount: 99 },
      key: 'named-other',
    }, session.gameToken);
    assert.equal(named.body.granted, undefined);
    assert.equal(mints(session.hub.userId, 'hpos10i_core'), 0);
    const extra = await call('session.event', {
      eventId: relic.eventId,
      data: { ...relic.data, relicId: 'hpos10i_core', itemId: 'genesis_shard', amount: 1000, seq: 1 },
      key: 'named-extra',
    }, session.gameToken);
    assert.equal(extra.body.granted, relic.relicId);
    assert.equal(mints(session.hub.userId, relic.relicId), 1);
    assert.equal(mints(session.hub.userId, 'hpos10i_core'), 0);
    assert.equal(mints(session.hub.userId, 'genesis_shard'), 0);
    const skipped = await call('session.event', {
      eventId: relic.eventId,
      data: { ...relic.data, seq: 5 },
      key: 'skipped-seq',
    }, session.gameToken);
    assert.equal(skipped.body.granted, undefined);
    const old = await call('session.event', {
      eventId: relic.eventId,
      data: { ...relic.data, seq: 0 },
      key: 'old-seq',
    }, session.gameToken);
    assert.equal(old.body.granted, undefined);
    assert.equal(mints(session.hub.userId, relic.relicId), 1);
  });

  await test('forged', `${exchange.id} client cannot name the verse amount`, async () => {
    const session = await login(exchange.game);
    await earn(session.gameToken, exchange.earnAmount, exchange.earnReason, 'fund-named');
    const before = snapshotEconomy(session.hub.userId, exchange.game);
    const named = await call('tickets.exchange', {
      tickets: exchange.tickets,
      verse: 500,
      amount: 500,
      balance: 500,
      key: 'named-verse',
    }, session.gameToken);
    assert.equal(named.body.error, undefined);
    assert.equal(named.body.verse, exchange.verse);
    assert.equal(verseBalance(session.hub.userId), exchange.verse);
    assert.notEqual(snapshotEconomy(session.hub.userId, exchange.game), before);
    const direct = await call('wallet.credit', { amount: 999, item: 'verse' }, session.gameToken);
    const relicRpc = await call('relic.grant', { relicId: 'tinubu_crown', amount: 1 }, session.gameToken);
    assert.ok(direct.status >= 400, JSON.stringify(direct));
    assert.ok(relicRpc.status >= 400, JSON.stringify(relicRpc));
    assert.equal(verseBalance(session.hub.userId), exchange.verse);
    const negative = await call('tickets.exchange', { tickets: -10, key: 'neg' }, session.gameToken);
    assert.equal(negative.body.error, 'bad_amount');
    const below = await call('tickets.exchange', { tickets: TICKETS_PER_VERSE - 1, key: 'below' }, session.gameToken);
    assert.equal(below.body.error, 'below_rate');
    assert.equal(verseBalance(session.hub.userId), exchange.verse);
  });

  await test('forged', 'anonymous http key cannot mint', async () => {
    const before = num(`SELECT count(*) FROM game.item_ledger WHERE op = 'grant_relic'`);
    const result = await call('session.event', relicBody(relic, 'anon'));
    assert.ok(result.status >= 400 || result.body.error, JSON.stringify(result.body));
    assert.equal(num(`SELECT count(*) FROM game.item_ledger WHERE op = 'grant_relic'`), before);
  });

  await test('forged', 'recovery does not grant the relic twice', async () => {
    const owner = await guest();
    const session = await openGame(owner.token, relic.game);
    const grant = await call('session.event', relicBody(relic, 'before-recovery'), session.gameToken);
    assert.equal(grant.body.granted, relic.relicId);
    const code = await call('recovery.create', {}, owner.token);
    assert.equal(code.body.error, undefined);
    assert.match(String(code.body.code ?? ''), /^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
    const deviceB = crypto.randomUUID();
    const other = await authenticate(deviceB);
    const restored = await call('recovery.redeem', { code: code.body.code, deviceId: deviceB }, other.token);
    assert.equal(restored.body.error, undefined);
    assert.equal(restored.body.userId, owner.userId);
    const back = await authenticate(deviceB);
    assert.equal(back.userId, owner.userId);
    const again = await openGame(back.token, relic.game);
    const second = await call('session.event', relicBody(relic, 'after-recovery'), again.gameToken);
    assert.equal(second.body.granted, undefined);
    assert.equal(mints(owner.userId, relic.relicId), 1);
  });
}

async function wallet(): Promise<void> {
  for (const exchange of exchangeFlows()) {
  await test('wallet', `${exchange.id} concurrent earns cannot pass the daily cap`, async () => {
    const session = await login(exchange.game);
    const width = repeatCount('concurrent');
    const results = await Promise.all(Array.from({ length: width }, (_, index) => (
      call('tickets.earn', { amount: TICKET_DAILY_CAP, reason: 'grind', key: `cap-${index}` }, session.gameToken)
    )));
    for (const result of results) {
      assert.equal(result.body.error, undefined, JSON.stringify(result.body));
      assert.equal(result.body.balance, TICKET_DAILY_CAP);
    }
    assert.equal(results.filter((item) => item.body.capped === false).length, 1);
    assert.equal(ticketBalance(session.hub.userId, exchange.game), TICKET_DAILY_CAP);
    assert.equal(earnLedgerCount(session.hub.userId), 1);
  });

  await test('wallet', `${exchange.id} concurrent exchanges cannot pass the verse cap`, async () => {
    const session = await login(exchange.game);
    await earn(session.gameToken, TICKET_DAILY_CAP, 'grind', 'fund-verse-cap');
    const width = Math.max(repeatCount('concurrent'), VERSE_DAILY_CAP / TICKETS_PER_VERSE + 1);
    const results = await Promise.all(Array.from({ length: width }, (_, index) => (
      call('tickets.exchange', { tickets: 100, key: `vcap-${index}` }, session.gameToken)
    )));
    const wins = results.filter((item) => !item.body.error);
    assert.equal(wins.length, VERSE_DAILY_CAP / 10, JSON.stringify(results.map((item) => item.body)));
    assert.equal(results.filter((item) => item.body.error === 'verse_cap').length, width - wins.length);
    assert.equal(verseBalance(session.hub.userId), VERSE_DAILY_CAP);
    assert.equal(ticketBalance(session.hub.userId, exchange.game), TICKET_DAILY_CAP - VERSE_DAILY_CAP * TICKETS_PER_VERSE);
    assert.equal(exchangeCount(session.hub.userId), wins.length);
  });

  await test('wallet', `${exchange.id} concurrent spends cannot go negative`, async () => {
    const session = await login(exchange.game);
    await earn(session.gameToken, 30, exchange.earnReason, 'fund-neg');
    const width = repeatCount('concurrent');
    const results = await Promise.all(Array.from({ length: width }, (_, index) => (
      call('tickets.exchange', { tickets: 30, key: `neg-${index}` }, session.gameToken)
    )));
    const wins = results.filter((item) => !item.body.error);
    assert.equal(wins.length, 1, JSON.stringify(results.map((item) => item.body)));
    assert.equal(wins[0]?.body.verse, 3);
    assert.equal(ticketBalance(session.hub.userId, exchange.game), 0);
    assert.equal(verseBalance(session.hub.userId), 3);
    assert.ok(ticketBalance(session.hub.userId, exchange.game) >= 0);
    assert.ok(verseBalance(session.hub.userId) >= 0);
  });

  await test('wallet', `${exchange.id} daily cap survives a new session and a client clock`, async () => {
    const session = await login(exchange.game);
    await earn(session.gameToken, TICKET_DAILY_CAP, 'grind', 'fill-day');
    const next = await openGame(session.hub.token, exchange.game);
    const again = await call('tickets.earn', {
      amount: 10,
      reason: 'win',
      key: 'after-session',
      now: 0,
      timestamp: '1999-01-01T00:00:00Z',
      day: '1999-01-01',
    }, next.gameToken);
    assert.equal(again.body.error, undefined, JSON.stringify(again.body));
    assert.equal(again.body.capped, true);
    assert.equal(again.body.balance, TICKET_DAILY_CAP);
    assert.equal(ticketBalance(session.hub.userId, exchange.game), TICKET_DAILY_CAP);
    const bucket = psql(
      `SELECT day::text FROM game.earn_window WHERE user_id = '${sqlId(session.hub.userId)}' AND bucket = 'tickets:${exchange.game}'`,
    );
    assert.equal(bucket, serverDay());
  });

  await test('wallet', `${exchange.id} server day ignores a client timestamp`, async () => {
    const session = await login(exchange.game);
    const stamped = await call('tickets.earn', {
      amount: 10,
      reason: 'win',
      key: 'stamped',
      now: 0,
      timestamp: '1999-01-01T00:00:00Z',
      day: '1999-01-01',
    }, session.gameToken);
    assert.equal(stamped.body.balance, 10);
    assert.equal(
      psql(`SELECT day::text FROM game.earn_window WHERE user_id = '${sqlId(session.hub.userId)}' AND bucket = 'tickets:${exchange.game}'`),
      serverDay(),
    );
    psql(
      `UPDATE game.earn_window SET day = day - 1 WHERE user_id = '${sqlId(session.hub.userId)}' AND bucket = 'tickets:${exchange.game}'`,
    );
    const today = await call('tickets.earn', {
      amount: 10,
      reason: 'win',
      key: 'server-today',
      day: '1999-01-01',
    }, session.gameToken);
    assert.equal(today.body.error, undefined, JSON.stringify(today.body));
    assert.equal(today.body.balance, 20);
    assert.equal(today.body.capped, false);
    assert.equal(
      psql(`SELECT day::text FROM game.earn_window WHERE user_id = '${sqlId(session.hub.userId)}' AND bucket = 'tickets:${exchange.game}' AND day = (now() AT TIME ZONE 'utc')::date`),
      serverDay(),
    );
  });
  }

  await test('wallet', 'caps use server time only', async () => {
    const schema = readFileSync(path.join(ROOT, 'server/modules/src/schema.ts'), 'utf8');
    for (const name of ['game.earn_tickets', 'game.exchange_tickets', 'game.redeem_ticket', 'game.apply_event']) {
      const body = functionBody(schema, name);
      assert.match(body, /now\(\)/, name);
      assert.doesNotMatch(body, /p_now|p_timestamp|p_day|client_time|p_data\s*->>\s*'(now|timestamp|day|time)'/, name);
    }
    const live = readFileSync(path.join(ROOT, 'packages/hub-sdk/src/live.ts'), 'utf8');
    assert.doesNotMatch(live, /timestamp|clientTime|Date\.now/);
    const mock = readFileSync(path.join(ROOT, 'packages/hub-sdk/src/createHubSdk.ts'), 'utf8');
    if (mock.includes('dayKey(resolved.now())')) {
      note(
        'packages/hub-sdk/src/createHubSdk.ts mock daily Ticket and Verse buckets use resolved.now(), which is the client clock. '
        + 'The live Nakama path (game.earn_tickets and game.exchange_tickets) uses PostgreSQL now() and ignores client timestamp fields.',
      );
    }
    note(
      'Daily Ticket and Verse caps use PostgreSQL now(). A seq field inside event data is not the session seq.',
    );
  });
}

function scoreMeta(userId: string): { act?: number; zone?: string } {
  const raw = psql(
    `SELECT meta::text FROM game.score_best WHERE user_id = '${sqlId(userId)}' AND board_id = 'hpos10i_act_time'`,
  );
  return JSON.parse(raw) as { act?: number; zone?: string };
}

async function hposExtras(): Promise<void> {
  const zone = 'z1_retro_rush_hills';
  const relic = relicFlows().find((item) => item.game === 'hpos10i');
  if (!relic) throw new Error('HPOS10I relic flow is missing');

  await test('wallet', 'hpos10i exchange steps of 10, 500, non-multiple, over 500, over balance', async () => {
    const small = await login('hpos10i');
    await earn(small.gameToken, 40, 'level_end', 'fund-10');
    const ten = await call('tickets.exchange', { tickets: 10, verse: 500, key: 'step-10' }, small.gameToken);
    assert.equal(ten.body.error, undefined, JSON.stringify(ten.body));
    assert.equal(ten.body.verse, 1);
    assert.equal(ten.body.ticketsLeft, 30);
    const odd = await call('tickets.exchange', { tickets: 25, key: 'step-25' }, small.gameToken);
    assert.equal(odd.body.error, undefined, JSON.stringify(odd.body));
    assert.equal(odd.body.verse, 3);
    assert.equal(odd.body.ticketsLeft, 10);
    assert.equal(verseBalance(small.hub.userId), 3);
    assert.equal(mints(small.hub.userId, 'hpos10i_core'), 0);

    const broke = await login('hpos10i');
    await earn(broke.gameToken, 20, 'level_end', 'fund-broke');
    const overBalance = await call('tickets.exchange', { tickets: 30, key: 'over-balance' }, broke.gameToken);
    assert.equal(overBalance.body.error, 'insufficient_tickets', JSON.stringify(overBalance.body));
    assert.equal(ticketBalance(broke.hub.userId, 'hpos10i'), 20);
    assert.equal(verseBalance(broke.hub.userId), 0);
    assert.equal(exchangeCount(broke.hub.userId), 0);

    const funded = await login('hpos10i');
    await earn(funded.gameToken, TICKET_DAILY_CAP, 'level_end', 'fund-500');
    const fiveHundred = await call('tickets.exchange', { tickets: 500, key: 'step-500' }, funded.gameToken);
    assert.equal(fiveHundred.body.error, undefined, JSON.stringify(fiveHundred.body));
    assert.equal(fiveHundred.body.verse, VERSE_DAILY_CAP);
    assert.equal(fiveHundred.body.ticketsLeft, TICKET_DAILY_CAP - 500);
    const overCap = await call('tickets.exchange', { tickets: 510, key: 'step-510' }, funded.gameToken);
    assert.equal(overCap.body.error, 'verse_cap', JSON.stringify(overCap.body));
    assert.equal(verseBalance(funded.hub.userId), VERSE_DAILY_CAP);
    assert.equal(ticketBalance(funded.hub.userId, 'hpos10i'), TICKET_DAILY_CAP - 500);
    assert.equal(mints(funded.hub.userId, 'hpos10i_core'), 0);
  });

  await test('score', 'hpos10i_act_time replay keeps the lowest and grants nothing', async () => {
    const session = await login('hpos10i');
    const meta = { zone, act: 1 };
    const first = await call('score.submit', { boardId: 'hpos10i_act_time', value: 40.125, meta }, session.gameToken);
    assert.equal(first.body.error, undefined, JSON.stringify(first.body));
    assert.equal(first.body.accepted, true);
    assert.equal(first.body.value, 40);
    const worse = await call('score.submit', { boardId: 'hpos10i_act_time', value: 55.5, meta: { zone, act: 2 } }, session.gameToken);
    assert.equal(worse.body.error, undefined, JSON.stringify(worse.body));
    assert.equal(worse.body.value, 40);
    assert.deepEqual(scoreMeta(session.hub.userId), { act: 1, zone });
    const better = await call('score.submit', { boardId: 'hpos10i_act_time', value: 30.2, meta }, session.gameToken);
    assert.equal(better.body.value, 30);
    assert.deepEqual(scoreMeta(session.hub.userId), { act: 1, zone });
    const replay = await call('score.submit', { boardId: 'hpos10i_act_time', value: 30.2, meta }, session.gameToken);
    assert.equal(replay.body.value, 30);
    assert.deepEqual(scoreMeta(session.hub.userId), { act: 1, zone });
    assert.equal(
      num(`SELECT value FROM game.score_best WHERE user_id = '${sqlId(session.hub.userId)}' AND board_id = 'hpos10i_act_time'`),
      30,
    );
    assert.equal(mints(session.hub.userId, 'hpos10i_core'), 0);
    assert.equal(ticketBalance(session.hub.userId, 'hpos10i'), 0);
    assert.equal(verseBalance(session.hub.userId), 0);
    const granted = await call('session.event', relicBody(relic, 'after-score'), session.gameToken);
    const why = grantFailure(relic, granted.body);
    if (why) throw new Error(why);
    assert.equal(
      num(`SELECT value FROM game.score_best WHERE user_id = '${sqlId(session.hub.userId)}' AND board_id = 'hpos10i_act_time'`),
      30,
    );
  });
}

/** PB exchange uses the hub rules: 10:1, daily Verse cap, server balance. Client price and clamp fields are ignored. */
function pbGameId(): string {
  const rpcs = readFileSync(path.join(ROOT, 'server/modules/src/rpcs.ts'), 'utf8');
  return rpcs.includes('peoples-bitcoin') ? 'peoples-bitcoin' : 'pb';
}

async function pbExchange(): Promise<void> {
  await test('wallet', 'pb exchange follows hub rules without a client clamp', async () => {
    const game = pbGameId();
    const small = await login(game);
    await earn(small.gameToken, 40, 'shop', 'pb-fund-40');
    const odd = await call('tickets.exchange', {
      tickets: 25,
      verse: 500,
      price: 1,
      cost: 1,
      balance: 999999,
      amount: 999999,
      key: 'pb-step-25',
    }, small.gameToken);
    assert.equal(odd.body.error, undefined, JSON.stringify(odd.body));
    assert.equal(odd.body.verse, 2);
    assert.equal(odd.body.ticketsLeft, 20);
    assert.equal(verseBalance(small.hub.userId), 2);
    assert.equal(ticketBalance(small.hub.userId, game), 20);
    const ten = await call('tickets.exchange', {
      tickets: 10,
      balance: 999999,
      key: 'pb-step-10',
    }, small.gameToken);
    assert.equal(ten.body.error, undefined, JSON.stringify(ten.body));
    assert.equal(ten.body.verse, 3);
    assert.equal(ten.body.ticketsLeft, 10);
    const over = await call('tickets.exchange', {
      tickets: 30,
      balance: 999999,
      key: 'pb-over-balance',
    }, small.gameToken);
    assert.equal(over.body.error, 'insufficient_tickets', JSON.stringify(over.body));
    assert.equal(ticketBalance(small.hub.userId, game), 10);
    assert.equal(verseBalance(small.hub.userId), 3);
    assert.equal(exchangeCount(small.hub.userId), 2);

    const funded = await login(game);
    let dayToken = funded.gameToken;
    await earn(dayToken, 200, 'shop', 'pb-fund-day-0');
    for (let i = 1; i < TICKET_DAILY_CAP / 200; i += 1) {
      const next = await openGame(funded.hub.token, game);
      dayToken = next.gameToken;
      await earn(dayToken, 200, 'shop', `pb-fund-day-${i}`);
    }
    assert.equal(ticketBalance(funded.hub.userId, game), TICKET_DAILY_CAP);
    assert.equal(
      psql(`SELECT day::text FROM game.earn_window WHERE user_id = '${sqlId(funded.hub.userId)}' AND bucket = 'tickets:${game}'`),
      serverDay(),
    );
    const fiveHundred = await call('tickets.exchange', {
      tickets: 500,
      price: 1,
      balance: 999999,
      key: 'pb-step-500',
    }, dayToken);
    assert.equal(fiveHundred.body.error, undefined, JSON.stringify(fiveHundred.body));
    assert.equal(fiveHundred.body.verse, VERSE_DAILY_CAP);
    assert.equal(fiveHundred.body.ticketsLeft, TICKET_DAILY_CAP - 500);
    const past = await call('tickets.exchange', { tickets: TICKETS_PER_VERSE, key: 'pb-past-verse' }, dayToken);
    assert.equal(past.body.error, 'verse_cap', JSON.stringify(past.body));
    assert.equal(verseBalance(funded.hub.userId), VERSE_DAILY_CAP);
    assert.equal(ticketBalance(funded.hub.userId, game), TICKET_DAILY_CAP - 500);
    assert.equal(mints(funded.hub.userId, 'genesis_shard'), 0);
    const later = await openGame(funded.hub.token, game);
    const cappedEarn = await call('tickets.earn', {
      amount: 10,
      reason: 'shop',
      key: 'pb-past-daily',
      balance: 999999,
      day: '1999-01-01',
    }, later.gameToken);
    if (cappedEarn.body.error) {
      assert.equal(cappedEarn.body.error, 'daily_ticket_cap', JSON.stringify(cappedEarn.body));
    } else {
      assert.equal(cappedEarn.body.capped, true, JSON.stringify(cappedEarn.body));
    }
    assert.equal(ticketBalance(funded.hub.userId, game), TICKET_DAILY_CAP - 500);
  });
}

/** NOBU payloads from the stated client contract (PR #1, e4b5446). The repo was not readable from this environment. */
async function nobuRows(): Promise<void> {
  await test('score', 'nobu_trial_time replay keeps the lowest and grants nothing', async () => {
    const session = await login('nobu');
    const meta = { level: 1 };
    const first = await call('score.submit', { boardId: 'nobu_trial_time', value: 40.125, meta }, session.gameToken);
    assert.equal(first.body.error, undefined, JSON.stringify(first.body));
    assert.equal(first.body.accepted, true);
    assert.equal(first.body.value, 40);
    const worse = await call('score.submit', { boardId: 'nobu_trial_time', value: 55.5, meta: { level: 2 } }, session.gameToken);
    assert.equal(worse.body.value, 40);
    assert.equal(scoreMetaFor(session.hub.userId, 'nobu_trial_time').level, 1);
    const better = await call('score.submit', { boardId: 'nobu_trial_time', value: 30.2, meta }, session.gameToken);
    assert.equal(better.body.value, 30);
    const replay = await call('score.submit', { boardId: 'nobu_trial_time', value: 30.2, meta }, session.gameToken);
    assert.equal(replay.body.value, 30);
    assert.equal(
      num(`SELECT value FROM game.score_best WHERE user_id = '${sqlId(session.hub.userId)}' AND board_id = 'nobu_trial_time'`),
      30,
    );
    assert.equal(mints(session.hub.userId, 'cones_tip'), 0);
    assert.equal(ticketBalance(session.hub.userId, 'nobu'), 0);
    assert.equal(verseBalance(session.hub.userId), 0);
  });

  await test('wallet', 'exchange response has ticketsLeft and not ticketsDebited', async () => {
    const session = await login('nobu');
    await earn(session.gameToken, 20, 'level_end', 'nobu-ex-fund');
    const traded = await call('tickets.exchange', { tickets: 10, key: 'nobu-ex-trade' }, session.gameToken);
    assert.equal(traded.body.error, undefined, JSON.stringify(traded.body));
    const body = traded.body as Record<string, unknown>;
    assert.equal(body.ticketsLeft, 10);
    assert.equal(body.verse, 1);
    assert.equal(typeof body.receiptId, 'string');
    assert.equal(body.ticketsDebited, undefined);
    assert.equal(body.verseCredited, undefined);
    assert.equal(verseBalance(session.hub.userId), 1);
    assert.equal(ticketBalance(session.hub.userId, 'nobu'), 10);
  });
}

function scoreMetaFor(userId: string, boardId: string): { level?: number; zone?: string; act?: number } {
  if (!/^[a-z0-9_]+$/.test(boardId)) throw new Error(`bad board ${boardId}`);
  const raw = psql(
    `SELECT meta::text FROM game.score_best WHERE user_id = '${sqlId(userId)}' AND board_id = '${boardId}'`,
  );
  return JSON.parse(raw) as { level?: number; zone?: string; act?: number };
}

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`FUNCTION ${name}`);
  if (start < 0) throw new Error(`missing ${name}`);
  const open = source.indexOf('$fn$', start);
  const end = source.indexOf('$fn$', open + 4);
  if (open < 0 || end < 0) throw new Error(`unterminated ${name}`);
  return source.slice(open, end);
}

interface FaultSpec {
  id: string;
  point: string;
  kind: 'raise' | 'sleep' | 'lose';
  expectation: 'rolled_back' | 'committed';
  rpc: 'session.event' | 'tickets.exchange' | 'tickets.earn' | 'store.buy';
  repeats: number;
}

function grantSpecs(): FaultSpec[] {
  const times = repeatCount('fault');
  const kills = repeatCount('kill');
  return [
    { id: 'before_transaction', point: 'grant.before_rpc', kind: 'raise', expectation: 'rolled_back', rpc: 'session.event', repeats: times },
    { id: 'after_claim', point: 'grant.after_claim', kind: 'raise', expectation: 'rolled_back', rpc: 'session.event', repeats: times },
    { id: 'after_mint', point: 'grant.after_mint', kind: 'raise', expectation: 'rolled_back', rpc: 'session.event', repeats: times },
    { id: 'after_commit_before_response', point: 'grant.after_commit', kind: 'raise', expectation: 'committed', rpc: 'session.event', repeats: times },
    { id: 'response_lost', point: '', kind: 'lose', expectation: 'committed', rpc: 'session.event', repeats: times },
    { id: 'kill_before_commit', point: 'grant.after_mint', kind: 'sleep', expectation: 'rolled_back', rpc: 'session.event', repeats: kills },
    { id: 'kill_after_commit', point: 'grant.after_commit', kind: 'sleep', expectation: 'committed', rpc: 'session.event', repeats: kills },
  ];
}

function exchangeSpecs(): FaultSpec[] {
  const times = repeatCount('fault');
  const kills = repeatCount('kill');
  return [
    { id: 'before_transaction', point: 'exchange.before_rpc', kind: 'raise', expectation: 'rolled_back', rpc: 'tickets.exchange', repeats: times },
    { id: 'after_debit', point: 'exchange.after_debit', kind: 'raise', expectation: 'rolled_back', rpc: 'tickets.exchange', repeats: times },
    { id: 'after_wallet', point: 'exchange.after_wallet', kind: 'raise', expectation: 'rolled_back', rpc: 'tickets.exchange', repeats: times },
    { id: 'after_commit_before_response', point: 'exchange.after_commit', kind: 'raise', expectation: 'committed', rpc: 'tickets.exchange', repeats: times },
    { id: 'response_lost', point: '', kind: 'lose', expectation: 'committed', rpc: 'tickets.exchange', repeats: times },
    { id: 'kill_before_commit', point: 'exchange.after_wallet', kind: 'sleep', expectation: 'rolled_back', rpc: 'tickets.exchange', repeats: kills },
    { id: 'kill_after_commit', point: 'exchange.after_commit', kind: 'sleep', expectation: 'committed', rpc: 'tickets.exchange', repeats: kills },
  ];
}

function earnSpecs(): FaultSpec[] {
  const times = repeatCount('fault');
  return [
    { id: 'earn_before_transaction', point: 'earn.before_rpc', kind: 'raise', expectation: 'rolled_back', rpc: 'tickets.earn', repeats: times },
    { id: 'earn_after_wallet', point: 'earn.after_wallet', kind: 'raise', expectation: 'rolled_back', rpc: 'tickets.earn', repeats: times },
    { id: 'earn_after_commit_before_response', point: 'earn.after_commit', kind: 'raise', expectation: 'committed', rpc: 'tickets.earn', repeats: times },
    { id: 'earn_response_lost', point: '', kind: 'lose', expectation: 'committed', rpc: 'tickets.earn', repeats: times },
  ];
}

async function faults(): Promise<void> {
  installFaultHooks();
  const relic = relicFlows()[0];
  if (relic) {
    await test('fault', `${relic.id} unarmed hook still grants once`, async () => {
      const session = await login(relic.game);
      const result = await call('session.event', relicBody(relic, 'unarmed'), session.gameToken);
      assert.equal(result.body.granted, relic.relicId);
      assert.equal(mints(session.hub.userId, relic.relicId), 1);
    });
  }
  for (const flow of relicFlows()) {
    for (const spec of grantSpecs()) {
      await test('fault', `${flow.id} ${spec.id} x${spec.repeats}`, async () => {
        await repeatFault(spec, async (index) => {
          const session = await login(flow.game);
          const key = `g-${spec.id}-${index}`;
          const body = relicBody(flow, key);
          const effect = () => mints(session.hub.userId, flow.relicId);
          await fire(spec, session, body, effect, (result) => {
            assert.equal(result.body.granted, flow.relicId);
          });
        });
      });
    }
  }
  for (const flow of exchangeFlows()) {
    for (const spec of exchangeSpecs()) {
      await test('fault', `${flow.id} ${spec.id} x${spec.repeats}`, async () => {
        await repeatFault(spec, async (index) => {
          const session = await login(flow.game);
          await earn(session.gameToken, flow.earnAmount, flow.earnReason, `fund-${spec.id}-${index}`);
          const key = `x-${spec.id}-${index}`;
          const body = exchangeBody(flow, key);
          const effect = () => exchangeCount(session.hub.userId);
          await fire(spec, session, body, effect, (result) => {
            assert.equal(result.body.verse, flow.verse);
            assert.ok(result.body.receiptId);
          });
        });
      });
    }
    for (const spec of earnSpecs()) {
      await test('fault', `${flow.id} ${spec.id} x${spec.repeats}`, async () => {
        await repeatFault(spec, async (index) => {
          const session = await login(flow.game);
          const key = `e-${spec.id}-${index}`;
          const body = { amount: flow.earnAmount, reason: flow.earnReason, key };
          const effect = () => earnLedgerCount(session.hub.userId);
          await fire(spec, session, body, effect, (result) => {
            assert.equal(result.body.balance, flow.earnAmount);
            assert.equal(result.body.capped, false);
          });
        });
      });
    }
  }
  for (const flow of purchaseFlows()) {
    await test('fault', `${flow.id} fault points`, () => purchaseFaults(flow));
  }
}

async function repeatFault(spec: FaultSpec, once: (index: number) => Promise<void>): Promise<void> {
  for (let index = 0; index < spec.repeats; index += 1) {
    try {
      await once(index);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`iteration ${index + 1}/${spec.repeats}: ${message}`);
    }
    if ((index + 1) % 25 === 0) console.log(`  ${spec.rpc} ${spec.id} ${index + 1}/${spec.repeats}`);
  }
}

async function fire(
  spec: FaultSpec,
  session: GameLogin,
  body: object,
  effect: () => number,
  expectOk: (result: RpcResult) => void,
): Promise<void> {
  try {
    if (spec.kind === 'lose') {
      const first = await call(spec.rpc, body, session.gameToken);
      assert.equal(first.body.error, undefined, JSON.stringify(first.body));
      assert.equal(first.status < 400, true, JSON.stringify(first));
      expectOk(first);
      assert.equal(effect(), 1);
      const replay = await outboxSend(spec.rpc, body, session.gameToken);
      assert.equal(canonical(replay.body), canonical(first.body));
      assert.equal(effect(), 1);
      return;
    }
    arm(session.hub.userId, spec.point, spec.kind === 'sleep' ? 'sleep' : 'raise');
    if (spec.kind === 'sleep') {
      const inflight = call(spec.rpc, body, session.gameToken, { timeoutMs: 60_000 });
      const during = await killDuringSleep(inflight, session.hub.userId, spec.point, effect);
      const after = effect();
      if (spec.expectation === 'rolled_back') {
        assert.equal(during, 0, `${spec.point} was visible while the transaction was still open`);
        assert.equal(after, 0, `${spec.point} survived a kill before commit`);
      } else {
        assert.equal(during, 1, `${spec.point} was not committed before the response`);
        assert.equal(after, 1, `${spec.point} was lost when the process died after commit`);
      }
    } else {
      const result = await call(spec.rpc, body, session.gameToken);
      if (!faulted(result)) {
        throw new Error(`fault ${spec.point} did not fire: ${result.status} ${JSON.stringify(result.body)}`);
      }
      if (spec.expectation === 'rolled_back') assert.equal(effect(), 0, spec.point);
      else assert.equal(effect(), 1, spec.point);
    }
  } finally {
    disarm(session.hub.userId);
    if (spec.kind === 'sleep') await ensureNakama();
  }
  const replay = await outboxSend(spec.rpc, body, session.gameToken);
  assert.equal(replay.body.error, undefined, JSON.stringify(replay.body));
  expectOk(replay);
  assert.equal(effect(), 1);
  const again = await call(spec.rpc, body, session.gameToken);
  assert.equal(canonical(again.body), canonical(replay.body));
  assert.equal(effect(), 1);
}

async function purchaseStorm(flow: PurchaseFlow): Promise<void> {
  const session = await fundPurchase(flow);
  const body = { defId: flow.defId, key: 'buy-seq' };
  const first = await call('store.buy', body, session.gameToken);
  if (first.status === 404) {
    throw new Error('store.buy is not registered. Add the RPC before enabling this M7 case.');
  }
  assert.equal(first.body.error, undefined, JSON.stringify(first.body));
  const results = await storm('store.buy', body, session.gameToken, repeatCount('sequential'), false);
  assertSame([first, ...results]);
  const burst = await storm('store.buy', body, session.gameToken, repeatCount('concurrent'), true);
  assertSame(burst);
  assert.equal(canonical(burst[0]?.body), canonical(first.body));
  assertPurchaseOnce(session.hub.userId, flow);
}

async function purchaseFaults(flow: PurchaseFlow): Promise<void> {
  const specs: FaultSpec[] = [
    { id: 'before_transaction', point: 'purchase.before_rpc', kind: 'raise', expectation: 'rolled_back', rpc: 'store.buy', repeats: repeatCount('fault') },
    { id: 'after_wallet', point: 'purchase.after_wallet', kind: 'raise', expectation: 'rolled_back', rpc: 'store.buy', repeats: repeatCount('fault') },
    { id: 'after_commit_before_response', point: 'purchase.after_commit', kind: 'raise', expectation: 'committed', rpc: 'store.buy', repeats: repeatCount('fault') },
    { id: 'response_lost', point: '', kind: 'lose', expectation: 'committed', rpc: 'store.buy', repeats: repeatCount('fault') },
  ];
  for (const spec of specs) {
    await repeatFault(spec, async (index) => {
      const session = await fundPurchase(flow);
      const body = { defId: flow.defId, key: `buy-${spec.id}-${index}` };
      const effect = () => num(
        `SELECT count(*) FROM game.purchase_tx WHERE user_id = '${sqlId(session.hub.userId)}' AND idem_key = 'buy-${spec.id}-${index}'`,
      );
      await fire(spec, session, body, effect, () => undefined);
    });
  }
}

async function fundPurchase(flow: PurchaseFlow): Promise<GameLogin> {
  if (flow.priceVerse > VERSE_DAILY_CAP) {
    throw new Error(`${flow.id} priceVerse ${flow.priceVerse} exceeds the daily cap of ${VERSE_DAILY_CAP}`);
  }
  const session = await login('sproto');
  const tickets = flow.priceVerse * TICKETS_PER_VERSE;
  await earn(session.gameToken, tickets, 'fund', `fund-buy-${flow.defId}`);
  const traded = await call('tickets.exchange', { tickets, key: `fund-buy-ex-${flow.defId}` }, session.gameToken);
  if (traded.body.error) throw new Error(JSON.stringify(traded.body));
  return session;
}

function assertPurchaseOnce(userId: string, flow: PurchaseFlow): void {
  if (!/^[a-z0-9_]+$/.test(flow.defId)) throw new Error(`defId must be a slug: ${flow.defId}`);
  assert.equal(num(`SELECT count(*) FROM game.cosmetic_owned WHERE user_id = '${sqlId(userId)}' AND def_id = '${flow.defId}'`), 1);
  assert.equal(num(`SELECT count(*) FROM game.purchase_tx WHERE user_id = '${sqlId(userId)}'`), 1);
}

function pending(category: string, name: string, reason: string): void {
  outcomes.push({ category, name, status: 'pending', detail: reason });
  console.log(`PENDING ${category} ${name} — ${reason}`);
}

function report(): number {
  const categories = ['idempotency', 'race', 'forged', 'wallet', 'fault', 'outbox', 'seq', 'session-cap', 'mock-clock', 'score'];
  console.log('\nDuplication suite');
  let failed = 0;
  for (const category of categories) {
    const rows = outcomes.filter((item) => item.category === category);
    const pass = rows.filter((item) => item.status === 'pass').length;
    const fail = rows.filter((item) => item.status === 'fail').length;
    const waiting = rows.filter((item) => item.status === 'pending').length;
    failed += fail;
    console.log(`${category}: ${pass} pass, ${fail} fail, ${waiting} pending`);
  }
  const notes = findingsList();
  if (notes.length) {
    console.log('\nFindings');
    for (const finding of notes) console.log(`- ${finding}`);
  }
  if (failed) {
    console.log('\nFailures');
    for (const item of outcomes.filter((row) => row.status === 'fail')) {
      console.log(`- ${item.category} ${item.name}: ${item.detail?.split('\n')[0]}`);
    }
  }
  return failed;
}

async function rejectWholeEarn(amount: number, seeded: number): Promise<void> {
  const session = await login('sproto');
  if (seeded > 0) {
    const seededEarn = await earn(session.gameToken, seeded, 'grind', `seed-${amount}`);
    assert.equal(seededEarn.body.balance, seeded, JSON.stringify(seededEarn.body));
  }
  const before = ticketBalance(session.hub.userId, 'sproto');
  const ledger = earnLedgerCount(session.hub.userId);
  const dayBefore = num(
    `SELECT COALESCE((SELECT amount FROM game.earn_window WHERE user_id = '${sqlId(session.hub.userId)}' AND bucket = 'tickets:sproto'), 0)`,
  );
  const result = await call('tickets.earn', { amount, reason: 'grind', key: `over-${amount}-after-${seeded}` }, session.gameToken);
  assert.equal(
    result.body.error,
    'session_ticket_cap',
    `earn ${amount} after ${seeded} must be rejected whole, got ${JSON.stringify(result.body)}`,
  );
  assert.equal(ticketBalance(session.hub.userId, 'sproto'), before, 'a rejected earn must not move the wallet');
  assert.equal(earnLedgerCount(session.hub.userId), ledger, 'a rejected earn must not write a ledger row');
  assert.equal(num(
    `SELECT COALESCE((SELECT amount FROM game.earn_window WHERE user_id = '${sqlId(session.hub.userId)}' AND bucket = 'tickets:sproto'), 0)`,
  ), dayBefore, 'a rejected earn must not consume the daily cap');
}

async function sessionCapRegression(): Promise<void> {
  await test('session-cap', 'earn of 1000 on a fresh session is rejected whole', () => rejectWholeEarn(1000, 0));
  await test('session-cap', 'earn of 5000 on a fresh session is rejected whole', () => rejectWholeEarn(5000, 0));
  await test('session-cap', 'earn of 1000 after a partial session is rejected whole', () => rejectWholeEarn(1000, 50));
  await test('session-cap', 'earn of 5000 after a partial session is rejected whole', () => rejectWholeEarn(5000, 50));
  await test('session-cap', 'repeated earns stop at 200 and the crossing earn is rejected whole', async () => {
    const cap = num('SELECT game.session_ticket_cap()');
    assert.equal(cap, 200);
    const session = await login('sproto');
    const first = await earn(session.gameToken, 100, 'grind', 'cap-a');
    const second = await earn(session.gameToken, 100, 'grind', 'cap-b');
    assert.equal(first.body.balance, 100);
    assert.equal(second.body.balance, 200);
    const third = await call('tickets.earn', { amount: 100, reason: 'grind', key: 'cap-c' }, session.gameToken);
    assert.equal(third.body.error, 'session_ticket_cap', JSON.stringify(third.body));
    assert.equal(ticketBalance(session.hub.userId, 'sproto'), 200);
    assert.equal(earnLedgerCount(session.hub.userId), 2);
    const replay = await call('tickets.earn', { amount: 100, reason: 'grind', key: 'cap-c' }, session.gameToken);
    assert.equal(replay.body.error, 'session_ticket_cap', JSON.stringify(replay.body));
    assert.equal(ticketBalance(session.hub.userId, 'sproto'), 200);
    assert.equal(earnLedgerCount(session.hub.userId), 2);
  });
}

export async function main(): Promise<void> {
  await waitReady();
  let failed = 0;
  try {
    await sessionCapRegression();
    await idempotency();
    await races();
    await forged();
    await wallet();
    await hposExtras();
    await pbExchange();
    await nobuRows();
    try {
      await faults();
    } finally {
      dropFaultHooks();
      await ensureNakama();
    }
    await runGated({ test, pending });
    await runShop({ test, pending });
  } finally {
    failed = report();
  }
  if (failed) process.exitCode = 1;
}
