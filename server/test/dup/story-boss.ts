/**
 * Story-boss Ticket grants (migration 0031_story_boss_tickets).
 * A listed boss pays 20 Tickets once per player per boss per UTC day through session.event.
 * The day is PostgreSQL now(). A client clock does not open a new day.
 * An event with no matching event_rule is a silent 0: no named error, no Ticket credit,
 * no ledger row. apply_event may store the session.event idempotency row for that
 * empty result; a replay returns it and still does not credit.
 * A relic is granted only when a relic rule matches. NULL Belt tickets add 0 and do not revoke.
 * audit.sql runs from the suite wrapper after every case.
 */
import assert from 'node:assert/strict';
import { repeatCount } from './cases.ts';
import {
  arm,
  call,
  canonical,
  disarm,
  dropFaultHooks,
  faulted,
  installFaultHooks,
  killDuringSleep,
  login,
  mints,
  num,
  openGame,
  outboxSend,
  psql,
  relicClaims,
  serverDay,
  sqlId,
  ticketBalance,
  type GameLogin,
  type RpcResult,
} from './harness.ts';

type TestFn = (category: string, name: string, fn: () => Promise<void>) => Promise<void>;

const PAY = 20;
const CLIENT_DAY = '2099-01-02';

interface BossSpec {
  game: 'sproto' | 'sproto-fighter';
  eventId: string;
  boss: string;
  other: string;
}

const BOSSES: BossSpec[] = [
  { game: 'sproto', eventId: 'sproto.boss_defeated', boss: 'sahil', other: 'broccoli' },
  { game: 'sproto-fighter', eventId: 'fighter.boss_defeated', boss: 'sproto3215', other: 'rivet' },
];

interface EventBody {
  error?: string;
  granted?: string;
  tickets?: number;
  granted_items?: string[];
  relic_granted?: boolean;
  sessionCapLeft?: number;
  dailyCapLeft?: number;
  capLeft?: number;
  message?: string;
}

function slug(value: string, label = 'slug'): string {
  if (!/^[a-z0-9_-]+$/.test(value)) throw new Error(`${label} is not a slug: ${value}`);
  return value;
}

function keyOf(value: string): string {
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(value)) throw new Error(`bad key ${value}`);
  return value;
}

function body(result: RpcResult): EventBody {
  return result.body as EventBody;
}

function storedKey(userId: string, key: string): number {
  return num(
    `SELECT count(*) FROM game.idempotency WHERE user_id = '${sqlId(userId)}' AND key = '${keyOf(key)}'`,
  );
}

function creditCount(userId: string, game: string): number {
  return num(
    `SELECT count(*) FROM game.tickets_ledger WHERE user_id = '${sqlId(userId)}' AND game_id = '${slug(game)}' AND delta > 0`,
  );
}

function creditSum(userId: string, game: string): number {
  return num(
    `SELECT COALESCE(sum(delta), 0) FROM game.tickets_ledger WHERE user_id = '${sqlId(userId)}' AND game_id = '${slug(game)}'`,
  );
}

function bossWindow(userId: string, game: string, boss: string): string {
  const bucket = `boss:${slug(game)}:${slug(boss)}`;
  return psql(
    `SELECT COALESCE(string_agg(amount::text || '|' || day::text, ',' ORDER BY day), 'none')
     FROM game.earn_window WHERE user_id = '${sqlId(userId)}' AND bucket = '${bucket}'`,
  );
}

interface Purse {
  balance: number;
  credits: number;
  sum: number;
  relics: string;
}

function purse(userId: string, game: string): Purse {
  return {
    balance: ticketBalance(userId, game),
    credits: creditCount(userId, game),
    sum: creditSum(userId, game),
    relics: psql(
      `SELECT COALESCE(string_agg(relic_id, ',' ORDER BY relic_id), '') FROM game.relic_claim WHERE user_id = '${sqlId(userId)}'`,
    ),
  };
}

function assertPurse(userId: string, game: string, before: Purse, label: string): void {
  const after = purse(userId, game);
  assert.equal(after.balance, before.balance, `${label} changed the balance (${before.balance} -> ${after.balance})`);
  assert.equal(after.credits, before.credits, `${label} wrote a ledger row (${before.credits} -> ${after.credits})`);
  assert.equal(after.sum, before.sum, `${label} ledger sum changed`);
  assert.equal(after.relics, before.relics, `${label} changed relic ownership (${before.relics} -> ${after.relics})`);
}

async function defeat(
  token: string,
  spec: Pick<BossSpec, 'eventId'>,
  boss: string,
  key: string,
  extra: Record<string, unknown> = {},
  fields: Record<string, unknown> = {},
): Promise<RpcResult> {
  return call('session.event', {
    eventId: spec.eventId,
    data: { boss, ...extra },
    key,
    ...fields,
  }, token);
}

function assertPaid(result: RpcResult, label: string): void {
  const paid = body(result);
  assert.equal(paid.error, undefined, `${label} ${JSON.stringify(result.body)}`);
  assert.equal(paid.tickets, PAY, `${label} ${JSON.stringify(result.body)}`);
  assert.equal(paid.granted, undefined, `${label} granted ${paid.granted}`);
}

function assertUnpaid(result: RpcResult, label: string): void {
  const paid = body(result);
  assert.equal(paid.error, undefined, `${label} ${JSON.stringify(result.body)}`);
  assert.equal(paid.tickets, undefined, `${label} credited ${String(paid.tickets)}`);
  assert.equal(paid.granted, undefined, `${label} granted ${paid.granted}`);
}

/** A boss with no matching event_rule. No named error, no credit, no ledger row. */
async function assertSilentZero(
  session: GameLogin,
  spec: BossSpec,
  boss: string,
  key: string,
  extra: Record<string, unknown> = {},
  fields: Record<string, unknown> = {},
): Promise<void> {
  const before = purse(session.hub.userId, spec.game);
  const result = await defeat(session.gameToken, spec, boss, key, extra, fields);
  const paid = body(result);
  assert.equal(paid.error, undefined, `${boss} ${JSON.stringify(result.body)}`);
  assert.equal(paid.tickets, undefined, `${boss} credited ${String(paid.tickets)}`);
  assert.equal(paid.granted, undefined, `${boss} granted ${paid.granted}`);
  assertPurse(session.hub.userId, spec.game, before, boss);
  assert.equal(bossWindow(session.hub.userId, spec.game, boss), 'none', `${boss} opened a boss window`);
  assert.equal(
    num(`SELECT count(*) FROM game.idempotency WHERE user_id = '${sqlId(session.hub.userId)}' AND key = '${keyOf(key)}' AND rpc = 'tickets.earn'`),
    0,
    `${boss} stored a tickets.earn key`,
  );
  const replay = await defeat(session.gameToken, spec, boss, key, extra, fields);
  assert.equal(canonical(replay.body), canonical(result.body), `${boss} replay`);
  assert.equal(body(replay).tickets, undefined);
  assertPurse(session.hub.userId, spec.game, before, `${boss} replay`);
  assert.equal(mints(session.hub.userId, 'tinubu_crown'), before.relics.includes('tinubu_crown') ? 1 : 0);
}

function seedTickets(session: GameLogin, amount: number, windowAmount = amount): void {
  const id = sqlId(session.hub.userId);
  const sid = sqlId(session.sessionId);
  const game = gameOf(session);
  const key = keyOf(`seed-${game}-${amount}`);
  psql(
    `INSERT INTO game.tickets_balance (user_id, game_id, balance)
     VALUES ('${id}', '${game}', ${amount})
     ON CONFLICT (user_id, game_id) DO UPDATE SET balance = game.tickets_balance.balance + EXCLUDED.balance`,
  );
  psql(
    `INSERT INTO game.tickets_ledger (event_id, user_id, game_id, delta, balance_after, reason, ref_id, kind)
     VALUES (gen_random_uuid(), '${id}', '${game}', ${amount}, ${amount}, 'level_end', '${sid}', 'earn')`,
  );
  psql(
    `INSERT INTO game.idempotency (user_id, key, rpc, req_hash, response)
     VALUES ('${id}', '${key}', 'tickets.earn', decode('00', 'hex'), '{"balance":${amount},"capped":false}'::jsonb)`,
  );
  psql(
    `INSERT INTO game.earn_window (user_id, bucket, day, amount)
     VALUES ('${id}', 'tickets:${game}', (now() AT TIME ZONE 'utc')::date, ${windowAmount})
     ON CONFLICT (user_id, bucket, day) DO UPDATE SET amount = EXCLUDED.amount`,
  );
}

function gameOf(session: GameLogin): string {
  const game = psql(`SELECT game_id FROM game.game_session WHERE session_id = '${sqlId(session.sessionId)}'`);
  return slug(game, 'session game');
}

function plantRelic(userId: string, sessionId: string, relicId: string, game: string): void {
  const relic = slug(relicId, 'relic');
  const eventId = sqlId(crypto.randomUUID());
  psql(
    `INSERT INTO game.relic_claim (user_id, relic_id, session_id, event_id)
     VALUES ('${sqlId(userId)}', '${relic}', '${sqlId(sessionId)}', '${eventId}')`,
  );
  psql(
    `INSERT INTO game.item_ledger (event_id, user_id, op, item_id, source, ref_id)
     VALUES ('${eventId}', '${sqlId(userId)}', 'grant_relic', '${relic}', '${slug(game)}', '${sqlId(sessionId)}')`,
  );
}

async function sameDayOnce(spec: BossSpec): Promise<void> {
  const session = await login(spec.game);
  const user = session.hub.userId;
  const first = await defeat(session.gameToken, spec, spec.boss, 'boss-once');
  assertPaid(first, spec.boss);
  assert.equal(ticketBalance(user, spec.game), PAY);
  assert.equal(creditCount(user, spec.game), 1);
  assert.equal(creditSum(user, spec.game), PAY);
  assert.equal(bossWindow(user, spec.game, spec.boss), `1|${serverDay()}`);
  const second = await defeat(session.gameToken, spec, spec.boss, 'boss-twice');
  assertUnpaid(second, `${spec.boss} second`);
  assert.equal(ticketBalance(user, spec.game), PAY);
  assert.equal(creditCount(user, spec.game), 1);
  assert.equal(creditSum(user, spec.game), PAY);
  assert.equal(bossWindow(user, spec.game, spec.boss), `1|${serverDay()}`);
  assert.equal(storedKey(user, 'boss-once'), 1);
  assert.equal(storedKey(user, 'boss-twice'), 1, 'a same-day no-op still remembers its own key');
}

async function otherBossPays(spec: BossSpec): Promise<void> {
  const session = await login(spec.game);
  const user = session.hub.userId;
  assertPaid(await defeat(session.gameToken, spec, spec.boss, 'boss-a'), spec.boss);
  assertPaid(await defeat(session.gameToken, spec, spec.other, 'boss-b'), spec.other);
  assert.equal(ticketBalance(user, spec.game), PAY * 2);
  assert.equal(creditCount(user, spec.game), 2);
  assert.equal(creditSum(user, spec.game), PAY * 2);
  assert.equal(bossWindow(user, spec.game, spec.boss), `1|${serverDay()}`);
  assert.equal(bossWindow(user, spec.game, spec.other), `1|${serverDay()}`);
}

async function nextServerDay(spec: BossSpec): Promise<void> {
  const session = await login(spec.game);
  const user = session.hub.userId;
  const stamped = await defeat(session.gameToken, spec, spec.boss, 'boss-today', {
    now: 0,
    timestamp: `${CLIENT_DAY}T00:00:00Z`,
    day: CLIENT_DAY,
  }, {
    now: 0,
    timestamp: `${CLIENT_DAY}T00:00:00Z`,
    day: CLIENT_DAY,
  });
  assertPaid(stamped, `${spec.boss} despite a client clock`);
  assert.equal(bossWindow(user, spec.game, spec.boss), `1|${serverDay()}`);
  assert.notEqual(serverDay(), CLIENT_DAY);
  const clientNext = await defeat(session.gameToken, spec, spec.boss, 'boss-client-day', {
    day: CLIENT_DAY,
    timestamp: `${CLIENT_DAY}T00:00:00Z`,
  }, { day: CLIENT_DAY, timestamp: `${CLIENT_DAY}T00:00:00Z` });
  assertUnpaid(clientNext, 'client clock');
  assert.equal(ticketBalance(user, spec.game), PAY);
  assert.equal(creditCount(user, spec.game), 1);
  assert.equal(
    num(`SELECT count(*) FROM game.earn_window WHERE user_id = '${sqlId(user)}' AND day = '${CLIENT_DAY}'`),
    0,
    'a client day opened an earn window',
  );
  const bucket = `boss:${spec.game}:${spec.boss}`;
  const moved = psql(
    `UPDATE game.earn_window SET day = day - 1
     WHERE user_id = '${sqlId(user)}' AND bucket = '${bucket}' AND day = (now() AT TIME ZONE 'utc')::date
     RETURNING bucket`,
  );
  assert.equal(moved, bucket, 'server day roll did not move the boss window');
  const again = await defeat(session.gameToken, spec, spec.boss, 'boss-server-tomorrow');
  assertPaid(again, `${spec.boss} next server day`);
  assert.equal(ticketBalance(user, spec.game), PAY * 2);
  assert.equal(creditCount(user, spec.game), 2);
  const yesterday = psql(`SELECT ((now() AT TIME ZONE 'utc')::date - 1)::text`);
  assert.equal(bossWindow(user, spec.game, spec.boss), `1|${yesterday},1|${serverDay()}`);
}

async function sameKey(spec: BossSpec, parallel: boolean): Promise<void> {
  const session = await login(spec.game);
  const user = session.hub.userId;
  const times = repeatCount(parallel ? 'concurrent' : 'sequential');
  const payload = { eventId: spec.eventId, data: { boss: spec.boss }, key: parallel ? 'boss-race' : 'boss-seq' };
  const results: RpcResult[] = [];
  if (parallel) {
    results.push(...await Promise.all(Array.from({ length: times }, () => call('session.event', payload, session.gameToken))));
  } else {
    for (let i = 0; i < times; i += 1) results.push(await call('session.event', payload, session.gameToken));
  }
  const first = canonical(results[0]?.body);
  for (const result of results) {
    assert.equal(canonical(result.body), first, JSON.stringify(results.map((item) => item.body)));
  }
  assertPaid(results[0]!, spec.boss);
  assert.equal(ticketBalance(user, spec.game), PAY);
  assert.equal(creditCount(user, spec.game), 1);
  assert.equal(creditSum(user, spec.game), PAY);
  assert.equal(storedKey(user, String(payload.key)), 1);
}

async function twoTabs(spec: BossSpec): Promise<void> {
  const session = await login(spec.game);
  const user = session.hub.userId;
  const width = repeatCount('concurrent');
  const results = await Promise.all(Array.from({ length: width }, (_, index) => (
    defeat(session.gameToken, spec, spec.boss, `tab-${index}`)
  )));
  const paid = results.filter((result) => body(result).tickets === PAY && !body(result).error);
  const unpaid = results.filter((result) => body(result).error === undefined && body(result).tickets === undefined);
  assert.equal(paid.length, 1, JSON.stringify(results.map((result) => result.body)));
  assert.equal(unpaid.length, width - 1, JSON.stringify(results.map((result) => result.body)));
  assert.equal(ticketBalance(user, spec.game), PAY);
  assert.equal(creditCount(user, spec.game), 1);
  assert.equal(creditSum(user, spec.game), PAY);
  const next = await openGame(session.hub.token, spec.game);
  const again = await defeat(next.gameToken, spec, spec.boss, 'other-session');
  assertUnpaid(again, 'second session');
  assert.equal(ticketBalance(user, spec.game), PAY);
  assert.equal(creditCount(user, spec.game), 1);
  const closed = await defeat(session.gameToken, spec, spec.other, 'closed-session');
  assert.equal(body(closed).error, 'session_closed', JSON.stringify(closed.body));
  assert.equal(ticketBalance(user, spec.game), PAY);
  assert.equal(creditCount(user, spec.game), 1);
  assert.equal(storedKey(user, 'closed-session'), 0);
}

async function faultRaise(): Promise<void> {
  installFaultHooks();
  const spec = BOSSES[0]!;
  try {
    const session = await login(spec.game);
    const user = session.hub.userId;
    const payload = { eventId: spec.eventId, data: { boss: spec.boss }, key: 'boss-fault' };
    arm(user, 'earn.after_wallet', 'raise');
    const failed = await call('session.event', payload, session.gameToken);
    assert.equal(faulted(failed), true, JSON.stringify(failed));
    assert.equal(creditCount(user, spec.game), 0);
    assert.equal(ticketBalance(user, spec.game), 0);
    assert.equal(storedKey(user, 'boss-fault'), 0);
    disarm(user);
    const retry = await call('session.event', payload, session.gameToken);
    assertPaid(retry, 'retry after earn.after_wallet');
    assert.equal(creditCount(user, spec.game), 1);
    const replay = await call('session.event', payload, session.gameToken);
    assert.equal(canonical(replay.body), canonical(retry.body));
    assert.equal(creditCount(user, spec.game), 1);

    const committed = await login(spec.game);
    const committedPayload = { eventId: spec.eventId, data: { boss: spec.other }, key: 'boss-after-commit' };
    arm(committed.hub.userId, 'grant.after_commit', 'raise');
    const blown = await call('session.event', committedPayload, committed.gameToken);
    assert.equal(faulted(blown), true, JSON.stringify(blown));
    assert.equal(creditCount(committed.hub.userId, spec.game), 1, 'after_commit fault rolled the credit back');
    disarm(committed.hub.userId);
    const recovered = await call('session.event', committedPayload, committed.gameToken);
    assertPaid(recovered, 'retry after grant.after_commit');
    assert.equal(creditCount(committed.hub.userId, spec.game), 1);
  } finally {
    dropFaultHooks();
  }
}

async function lostResponse(): Promise<void> {
  const spec = BOSSES[0]!;
  const session = await login(spec.game);
  const payload = { eventId: spec.eventId, data: { boss: spec.boss }, key: 'boss-lost' };
  const replay = await outboxSend('session.event', payload, session.gameToken, { loseFirst: true });
  assertPaid(replay, 'lost response retry');
  assert.equal(creditCount(session.hub.userId, spec.game), 1);
  assert.equal(ticketBalance(session.hub.userId, spec.game), PAY);
  const again = await call('session.event', payload, session.gameToken);
  assert.equal(canonical(again.body), canonical(replay.body));
  assert.equal(creditCount(session.hub.userId, spec.game), 1);
}

async function killBeforeCommit(): Promise<void> {
  installFaultHooks();
  const spec = BOSSES[0]!;
  const session = await login(spec.game);
  const user = session.hub.userId;
  const payload = { eventId: spec.eventId, data: { boss: spec.other }, key: 'boss-kill' };
  try {
    arm(user, 'earn.after_wallet', 'sleep');
    const inflight = call('session.event', payload, session.gameToken, { timeoutMs: 60_000 });
    const during = await killDuringSleep(inflight, user, 'earn.after_wallet', () => creditCount(user, spec.game));
    assert.equal(during, 0, 'the credit was visible before commit');
    assert.equal(creditCount(user, spec.game), 0);
    assert.equal(ticketBalance(user, spec.game), 0);
    assert.equal(storedKey(user, 'boss-kill'), 0);
  } finally {
    disarm(user);
    dropFaultHooks();
  }
  const retry = await call('session.event', payload, session.gameToken);
  assertPaid(retry, 'retry after kill_before_commit');
  assert.equal(creditCount(user, spec.game), 1);
  assert.equal(ticketBalance(user, spec.game), PAY);
  const replay = await call('session.event', payload, session.gameToken);
  assert.equal(canonical(replay.body), canonical(retry.body));
  assert.equal(creditCount(user, spec.game), 1);
}

const OVER_RULE: { game: 'sproto' | 'sproto-fighter'; reason: string }[] = [
  { game: 'sproto', reason: 'srv_pvp_win' },
  { game: 'sproto-fighter', reason: 'fighter_win' },
  { game: 'sproto', reason: 'duel_win' },
  { game: 'sproto', reason: 'win' },
];

async function leftoverEarn(reason: string, game: 'sproto' | 'sproto-fighter'): Promise<void> {
  const session = await login(game);
  const user = session.hub.userId;
  const before = purse(user, game);
  for (const amount of [1, PAY]) {
    const key = `leftover-${reason}-${amount}`;
    const result = await call('tickets.earn', { amount, reason, key }, session.gameToken);
    assertPurse(user, game, before, `${reason} ${amount}`);
    assert.equal(storedKey(user, key), 0, `${reason} stored a key`);
    assert.equal(body(result).error, reason === 'srv_pvp_win' ? 'server_reason' : 'amount_over_rule', `${reason} ${amount} ${JSON.stringify(result.body)}`);
    assert.equal(body(result).tickets, undefined);
    const replay = await call('tickets.earn', { amount, reason, key }, session.gameToken);
    assert.equal(body(replay).error, reason === 'srv_pvp_win' ? 'server_reason' : 'amount_over_rule', JSON.stringify(replay.body));
    assert.equal(storedKey(user, key), 0);
    assertPurse(user, game, before, `${reason} replay`);
  }
  if (reason === 'srv_pvp_win') {
    const credits = creditCount(user, game);
    const raw = psql(
      `SELECT game.earn_tickets('${sqlId(user)}'::uuid, '${sqlId(session.sessionId)}'::uuid, '${game}', 20, 'srv_pvp_win', 'sql-srv-over', '${'ab'.repeat(32)}')::text`,
    );
    assert.match(raw, /amount_over_rule/, raw);
    assert.equal(creditCount(user, game), credits);
    assert.equal(storedKey(user, 'sql-srv-over'), 0);
  }
}

async function unknownBoss(spec: BossSpec): Promise<void> {
  const session = await login(spec.game);
  await assertSilentZero(session, spec, 'not_a_boss', 'unknown-boss');
  await assertSilentZero(session, spec, 'not_a_boss', 'unknown-named', {
    amount: 1000,
    tickets: 1000,
    itemId: 'tinubu_crown',
    relicId: 'tinubu_crown',
  });
  const before = purse(session.hub.userId, spec.game);
  const nameless = await call('session.event', {
    eventId: spec.eventId,
    data: { amount: 1000, itemId: 'tinubu_crown', relicId: 'tinubu_crown', tickets: PAY },
    key: 'client-amount-only',
  }, session.gameToken);
  assert.equal(body(nameless).error, undefined, JSON.stringify(nameless.body));
  assert.equal(body(nameless).tickets, undefined);
  assert.equal(body(nameless).granted, undefined);
  assertPurse(session.hub.userId, spec.game, before, 'client amount without a boss');
  assert.equal(
    num(`SELECT count(*) FROM game.idempotency WHERE user_id = '${sqlId(session.hub.userId)}' AND key = 'client-amount-only' AND rpc = 'tickets.earn'`),
    0,
  );
  const replay = await call('session.event', {
    eventId: spec.eventId,
    data: { amount: 1000, itemId: 'tinubu_crown', relicId: 'tinubu_crown', tickets: PAY },
    key: 'client-amount-only',
  }, session.gameToken);
  assert.equal(canonical(replay.body), canonical(nameless.body));
  assert.equal(body(replay).tickets, undefined);
  assert.equal(body(replay).granted, undefined);
  assertPurse(session.hub.userId, spec.game, before, 'client amount replay');
  assert.equal(mints(session.hub.userId, 'tinubu_crown'), 0);
  assert.equal(relicClaims(session.hub.userId, 'tidebreaker_belt'), 0);
}

async function otherUser(): Promise<void> {
  const spec = BOSSES[0]!;
  const victim = await login(spec.game);
  const before = purse(victim.hub.userId, spec.game);
  const attacker = await login(spec.game);
  await assertSilentZero(attacker, spec, 'not_a_boss', 'as-attacker', {
    userId: victim.hub.userId,
    sessionId: victim.sessionId,
    amount: PAY,
    itemId: 'tinubu_crown',
  }, {
    userId: victim.hub.userId,
    sessionId: victim.sessionId,
  });
  assertPurse(victim.hub.userId, spec.game, before, 'attacker token');
  const hub = await call('session.event', {
    eventId: spec.eventId,
    data: { boss: spec.boss, sessionId: victim.sessionId },
    key: 'hub-session',
    sessionId: attacker.sessionId,
  }, victim.hub.token);
  assert.equal(body(hub).error, 'not_game_session', JSON.stringify(hub.body));
  assertPurse(victim.hub.userId, spec.game, before, 'hub token');
  assert.equal(storedKey(victim.hub.userId, 'hub-session'), 0);
  assert.equal(creditCount(attacker.hub.userId, spec.game), 0);
  const anonBefore = num('SELECT count(*) FROM game.tickets_ledger');
  const anonKeys = num('SELECT count(*) FROM game.idempotency');
  const anon = await call('session.event', {
    eventId: spec.eventId,
    data: { boss: spec.boss, amount: PAY },
    key: 'anon-boss',
  });
  assert.ok(anon.status >= 400 || Boolean(anon.body.error), JSON.stringify(anon.body));
  assert.equal(num('SELECT count(*) FROM game.tickets_ledger'), anonBefore);
  assert.equal(num('SELECT count(*) FROM game.idempotency'), anonKeys);
}

async function clientAmountDoesNotOverride(): Promise<void> {
  const spec = BOSSES[0]!;
  const session = await login(spec.game);
  const result = await call('session.event', {
    eventId: spec.eventId,
    data: {
      boss: spec.boss,
      amount: 1000,
      tickets: 1000,
      itemId: 'tinubu_crown',
      relicId: 'tinubu_crown',
    },
    key: 'client-amount',
  }, session.gameToken);
  assertPaid(result, 'allowlisted boss with a client amount');
  assert.equal(body(result).granted, undefined);
  assert.deepEqual(body(result).granted_items ?? [], []);
  assert.equal(ticketBalance(session.hub.userId, spec.game), PAY);
  assert.equal(creditSum(session.hub.userId, spec.game), PAY);
  assert.equal(mints(session.hub.userId, 'tinubu_crown'), 0);
  assert.equal(relicClaims(session.hub.userId, 'tinubu_crown'), 0);
}

async function tinubuOnce(): Promise<void> {
  const session = await login('sproto');
  const user = session.hub.userId;
  const payload = {
    eventId: 'sproto.boss_defeated',
    data: { boss: 'tinubu', elapsed: 12 },
    key: 'tinubu-once',
  };
  const first = await call('session.event', payload, session.gameToken);
  assert.equal(body(first).error, undefined, JSON.stringify(first.body));
  assert.equal(body(first).granted, 'tinubu_crown', JSON.stringify(first.body));
  assert.equal(body(first).tickets, PAY, JSON.stringify(first.body));
  assert.equal(relicClaims(user, 'tinubu_crown'), 1);
  assert.equal(mints(user, 'tinubu_crown'), 1);
  assert.equal(ticketBalance(user, 'sproto'), PAY);
  assert.equal(creditCount(user, 'sproto'), 1);
  const replay = await call('session.event', payload, session.gameToken);
  assert.equal(canonical(replay.body), canonical(first.body));
  assert.equal(relicClaims(user, 'tinubu_crown'), 1);
  assert.equal(mints(user, 'tinubu_crown'), 1);
  assert.equal(creditCount(user, 'sproto'), 1);
  const again = await call('session.event', {
    eventId: 'sproto.boss_defeated',
    data: { boss: 'tinubu', elapsed: 4 },
    key: 'tinubu-next',
  }, session.gameToken);
  assert.equal(body(again).error, undefined, JSON.stringify(again.body));
  assert.equal(body(again).granted, undefined, JSON.stringify(again.body));
  assert.equal(body(again).tickets, undefined, JSON.stringify(again.body));
  assert.equal(relicClaims(user, 'tinubu_crown'), 1);
  assert.equal(mints(user, 'tinubu_crown'), 1);
  assert.equal(ticketBalance(user, 'sproto'), PAY);
  assert.equal(creditCount(user, 'sproto'), 1);
}

async function capPath(kind: 'session_ticket_cap' | 'daily_ticket_cap'): Promise<void> {
  const session = await login('sproto');
  const user = session.hub.userId;
  if (kind === 'session_ticket_cap') seedTickets(session, 200, 200);
  else seedTickets(session, 180, 990);
  const beforeCredits = creditCount(user, 'sproto');
  const beforeBalance = ticketBalance(user, 'sproto');
  const result = await call('session.event', {
    eventId: 'sproto.boss_defeated',
    data: { boss: 'tinubu', elapsed: 12, amount: 1000, relicId: 'hpos10i_core' },
    key: `cap-${kind}`,
  }, session.gameToken);
  const paid = body(result);
  assert.equal(paid.error, kind, JSON.stringify(result.body));
  assert.equal(paid.relic_granted, true, JSON.stringify(result.body));
  assert.equal(paid.granted, undefined, JSON.stringify(result.body));
  assert.equal(paid.tickets, undefined, JSON.stringify(result.body));
  if (kind === 'session_ticket_cap') assert.equal(paid.sessionCapLeft, 0, JSON.stringify(result.body));
  else assert.equal(paid.dailyCapLeft, 10, JSON.stringify(result.body));
  assert.equal(relicClaims(user, 'tinubu_crown'), 1);
  assert.equal(mints(user, 'tinubu_crown'), 1);
  assert.equal(ticketBalance(user, 'sproto'), beforeBalance);
  assert.equal(creditCount(user, 'sproto'), beforeCredits);
  assert.equal(creditSum(user, 'sproto'), beforeBalance);
  const replay = await call('session.event', {
    eventId: 'sproto.boss_defeated',
    data: { boss: 'tinubu', elapsed: 12, amount: 1000, relicId: 'hpos10i_core' },
    key: `cap-${kind}`,
  }, session.gameToken);
  assert.equal(body(replay).error, kind, JSON.stringify(replay.body));
  assert.equal(relicClaims(user, 'tinubu_crown'), 1);
  assert.equal(mints(user, 'tinubu_crown'), 1);
  const stored = storedKey(user, `cap-${kind}`);
  if (stored === 1) assert.equal(canonical(replay.body), canonical(result.body));
  else {
    assert.equal(stored, 0, 'cap reject stored something other than the first response');
    assert.equal(body(replay).relic_granted, false, JSON.stringify(replay.body));
  }
  assert.equal(ticketBalance(user, 'sproto'), beforeBalance);
  assert.equal(creditCount(user, 'sproto'), beforeCredits);
  const fresh = await call('session.event', {
    eventId: 'sproto.boss_defeated',
    data: { boss: 'tinubu', elapsed: 4 },
    key: `cap-${kind}-fresh`,
  }, session.gameToken);
  assert.equal(body(fresh).error, kind, JSON.stringify(fresh.body));
  assert.equal(body(fresh).relic_granted, false, JSON.stringify(fresh.body));
  assert.equal(relicClaims(user, 'tinubu_crown'), 1);
  assert.equal(mints(user, 'tinubu_crown'), 1);
  assert.equal(creditCount(user, 'sproto'), beforeCredits);
}

async function nullBeltTickets(): Promise<void> {
  const rule = psql(
    `SELECT COALESCE(tickets::text, 'null') FROM game.event_rule
     WHERE game_id = 'sproto-fighter' AND event_type = 'fighter.story_level_complete' AND relic_id = 'tidebreaker_belt'`,
  );
  assert.equal(rule, 'null', `Belt tickets column is ${rule}`);
  const session = await login('sproto-fighter');
  const user = session.hub.userId;
  seedTickets(session, 40, 40);
  assert.equal(ticketBalance(user, 'sproto-fighter'), 40);
  const granted = await call('session.event', {
    eventId: 'fighter.story_level_complete',
    data: { world: 1, stage: 'yacht', amount: 1000, itemId: 'tidebreaker_belt' },
    key: 'belt-once',
  }, session.gameToken);
  assert.equal(body(granted).error, undefined, JSON.stringify(granted.body));
  assert.equal(body(granted).granted, 'tidebreaker_belt', JSON.stringify(granted.body));
  assert.equal(body(granted).tickets, undefined, JSON.stringify(granted.body));
  assert.equal(ticketBalance(user, 'sproto-fighter'), 40, 'NULL Belt tickets changed the balance');
  assert.equal(creditCount(user, 'sproto-fighter'), 1, 'NULL Belt tickets wrote a ledger row');
  assert.equal(creditSum(user, 'sproto-fighter'), 40);
  assert.equal(relicClaims(user, 'tidebreaker_belt'), 1);
  assert.equal(mints(user, 'tidebreaker_belt'), 1);
  const replay = await call('session.event', {
    eventId: 'fighter.story_level_complete',
    data: { world: 1, stage: 'yacht' },
    key: 'belt-replay',
  }, session.gameToken);
  assert.equal(body(replay).granted, undefined, JSON.stringify(replay.body));
  assert.equal(body(replay).tickets, undefined);
  assert.equal(relicClaims(user, 'tidebreaker_belt'), 1);
  assert.equal(mints(user, 'tidebreaker_belt'), 1);
  assert.equal(ticketBalance(user, 'sproto-fighter'), 40);

  const sproto = await openGame(session.hub.token, 'sproto');
  plantRelic(user, sproto.sessionId, 'tinubu_crown', 'sproto');
  assert.equal(relicClaims(user, 'tinubu_crown'), 1);
  const spec = BOSSES[0]!;
  const before = purse(user, 'sproto');
  const silent = await defeat(sproto.gameToken, spec, 'not_a_boss', 'belt-still-held');
  assert.equal(body(silent).error, undefined, JSON.stringify(silent.body));
  assert.equal(body(silent).tickets, undefined, JSON.stringify(silent.body));
  assert.equal(body(silent).granted, undefined, JSON.stringify(silent.body));
  assertPurse(user, 'sproto', before, 'silent boss after a live Belt and Crown');
  assert.equal(relicClaims(user, 'tidebreaker_belt'), 1, 'a silent boss event revoked the Belt');
  assert.equal(mints(user, 'tidebreaker_belt'), 1);
  assert.equal(relicClaims(user, 'tinubu_crown'), 1, 'a silent boss event revoked the Crown');
  assert.equal(mints(user, 'tinubu_crown'), 1);
  assert.equal(ticketBalance(user, 'sproto-fighter'), 40);
  assert.equal(ticketBalance(user, 'sproto'), 0);
  assert.equal(creditCount(user, 'sproto-fighter'), 1);
  assert.equal(creditCount(user, 'sproto'), 0);
}

export async function runStoryBoss(test: TestFn): Promise<void> {
  // Rejects and NULL-ticket grants do not write a ticket credit. They run before the
  // pay cases so a later audit failure is not blamed on an earlier boss credit.
  for (const item of OVER_RULE) {
    await test('story-boss', `${item.game} ${item.reason} earn returns amount_over_rule and writes nothing`, () => leftoverEarn(item.reason, item.game));
  }
  for (const spec of BOSSES) {
    await test('story-boss', `${spec.game} unknown boss is a silent 0 and a client amount or item writes nothing`, () => unknownBoss(spec));
  }
  await test('story-boss', 'another user token or session writes nothing', otherUser);
  await test('story-boss', 'NULL Belt tickets add 0 and a live Belt or Crown stays owned', nullBeltTickets);
  await test('story-boss', 'tinubu_crown still grants on session_ticket_cap exactly once', () => capPath('session_ticket_cap'));
  await test('story-boss', 'tinubu_crown still grants on daily_ticket_cap exactly once', () => capPath('daily_ticket_cap'));
  for (const spec of BOSSES) {
    await test('story-boss', `${spec.game} same boss twice on one UTC day pays 20 once`, () => sameDayOnce(spec));
    await test('story-boss', `${spec.game} a different boss on the same day pays 20`, () => otherBossPays(spec));
    await test('story-boss', `${spec.game} same boss pays again on the next server UTC day and a client clock does not`, () => nextServerDay(spec));
    await test('story-boss', `${spec.game} same key x${repeatCount('sequential')} sequential pays once`, () => sameKey(spec, false));
    await test('story-boss', `${spec.game} same key x${repeatCount('concurrent')} concurrent pays once`, () => sameKey(spec, true));
    await test('story-boss', `${spec.game} two tabs and a second session pay once`, () => twoTabs(spec));
  }
  await test('story-boss', 'client amount on an allowlisted boss pays 20 and does not grant a named relic', clientAmountDoesNotOverride);
  await test('story-boss', 'tinubu_crown grants once with 20 Tickets and a replay does not grant it again', tinubuOnce);
  await test('story-boss', 'retried payout after earn.after_wallet and grant.after_commit pays once', faultRaise);
  await test('story-boss', 'lost payout response pays once', lostResponse);
  await test('story-boss', 'kill_before_commit payout pays once on retry', killBeforeCommit);
}
