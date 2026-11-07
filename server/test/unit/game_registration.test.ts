// Dark registration for sproto-shooter and sproto-coop-battle.
// Tickets redeem once. The ids cannot mint Tickets, Relics, or scores.
import assert from 'node:assert/strict';
import { loadModule, presence } from './harness';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const DARK = ['sproto-shooter', 'sproto-coop-battle'] as const;
const KNOWN = [
  'hpos10i',
  'nobu',
  'peoples-bitcoin',
  'sproto',
  'sproto-fighter',
  'sproto-arcade',
  'vcoin',
  'sproto-shooter',
  'sproto-coop-battle',
];

const mod = loadModule();

interface TicketRow {
  userId: string;
  game: string;
  sessionId: string;
  ranked: boolean;
  exp: number;
  used: boolean;
}

const tickets = new Map<string, TicketRow>();

mod.nk.onSql(
  (sql) => sql.includes('claim_portal_rate'),
  () => [{ result: '{}' }],
);
mod.nk.onSql(
  (sql) => sql.includes(' AS ms'),
  () => [{ ms: String(Date.now()) }],
);
mod.nk.onSql(
  (sql) => sql.includes('game.open_portal'),
  (args) => [{ result: JSON.stringify({ ok: true, exp: Math.floor(Date.now() / 1000) + 60, sessionId: args[1] }) }],
);
mod.nk.onSql(
  (sql) => sql.includes('INSERT INTO game.auth_ticket'),
  (args) => {
    tickets.set(String(args[0]), {
      userId: String(args[1]),
      game: String(args[2]),
      sessionId: String(args[3]),
      ranked: args[4] === true,
      exp: Number(args[5]),
      used: false,
    });
    return [];
  },
);
mod.nk.onSql(
  (sql) => sql.includes('UPDATE game.auth_ticket SET used_at'),
  (args) => {
    const row = tickets.get(String(args[0]));
    if (!row || row.used || row.exp <= Date.now() / 1000) return [];
    row.used = true;
    return [{ user_id: row.userId, game: row.game, session_id: row.sessionId, ranked: row.ranked }];
  },
);
mod.nk.onSql(
  (sql) => sql.includes('game.earn_tickets'),
  () => [{ result: JSON.stringify({ error: 'unknown_reason' }) }],
);
mod.nk.onSql(
  (sql) => sql.includes('game.apply_event'),
  () => [{ result: JSON.stringify({ granted_items: [] }) }],
);
mod.nk.onSql(
  (sql) => sql.includes('WITH sess AS'),
  () => [{ result: JSON.stringify({ reason: 'bad_board', posted: false }) }],
);

const HubGames = mod.global.HubGames as { list(): string[] };
const listed = HubGames.list();
for (const id of DARK) assert.ok(listed.includes(id), id);
assert.ok(listed.includes('sproto-fighter'));
assert.ok(listed.includes('sproto-arcade'));
assert.equal(listed.includes('vcoin'), false, 'vcoin stays a session gate, not a game module');

const HubSchema = mod.global.HubSchema as { all(): { id: string; statements: string[] }[] };
const all = HubSchema.all();
assert.equal(all.some((entry) => entry.id.startsWith('0036_') || entry.id.startsWith('0038_')), false);
const migration = all.find((entry) => entry.id === '0039_dark_game_ids');
assert.ok(migration, 'migration 0039 registered');
assert.ok(all.findIndex((entry) => entry.id === '0037_hub_life_medal') < all.indexOf(migration), '0039 follows 0037');
const sql = migration.statements.join('\n');
assert.doesNotMatch(sql, /event_rule|relic_id|tickets_ledger|INSERT INTO/i);
assert.doesNotMatch(sql, /game_beaten/);
for (const table of ['game_session', 'auth_ticket']) {
  const line = migration.statements.find((statement) => statement.includes(`${table} ADD CONSTRAINT`));
  assert.ok(line, table);
  for (const id of KNOWN) assert.match(line, new RegExp(`'${id}'`));
}

{
  const denied = mod.call<{ error?: string }>('portal.enter', { userId: USER_A, vars: { scope: 'hub' } }, { game: 'not-a-game', ranked: false });
  assert.equal(denied.error, 'bad_game');
}

function enter(userId: string, game: string): { ticket: string; sessionId: string } {
  const opened = mod.call<{ error?: string; ticket?: string; sessionId?: string }>(
    'portal.enter',
    { userId, vars: { scope: 'hub' } },
    { game, ranked: false },
  );
  assert.equal(opened.error, undefined, JSON.stringify(opened));
  assert.equal(typeof opened.ticket, 'string');
  assert.equal(typeof opened.sessionId, 'string');
  return { ticket: opened.ticket as string, sessionId: opened.sessionId as string };
}

interface Redeemed {
  account: { id: string; vars: { game: string; scope: string; sid: string } };
}

const redeem = mod.registered.other.get('registerBeforeAuthenticateCustom') as (
  ctx: unknown,
  logger: unknown,
  nk: unknown,
  data: { account: { id: string; vars: { game: string } }; create: boolean },
) => Redeemed;
assert.equal(typeof redeem, 'function');

function burn(ticket: string, game: string): Redeemed {
  return redeem(mod.ctx({}), mod.logger, mod.nk, {
    account: { id: `t:${ticket}`, vars: { game } },
    create: true,
  });
}

function expectUnauthenticated(run: () => void): void {
  try {
    run();
  } catch (error) {
    const message = error && typeof error === 'object' && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error);
    assert.match(message, /unauthenticated/);
    return;
  }
  assert.fail('redeem succeeded');
}

for (const game of DARK) {
  const opened = enter(USER_A, game);
  const first = burn(opened.ticket, game);
  assert.equal(first.account.id, `hub:${USER_A}`);
  assert.notEqual(first.account.id, `hub:${USER_B}`);
  assert.equal(first.account.vars.scope, 'game');
  assert.equal(first.account.vars.game, game);
  assert.equal(first.account.vars.sid, opened.sessionId);
  expectUnauthenticated(() => burn(opened.ticket, game));

  const other = enter(USER_A, game);
  expectUnauthenticated(() => burn(other.ticket, game === 'sproto-shooter' ? 'sproto-coop-battle' : 'sproto'));
  expectUnauthenticated(() => burn(other.ticket, game));

  const stale = enter(USER_A, game);
  const row = [...tickets.values()].find((item) => item.sessionId === stale.sessionId);
  assert.ok(row);
  row.exp = Math.floor(Date.now() / 1000) - 5;
  expectUnauthenticated(() => burn(stale.ticket, game));

  const session = { userId: USER_A, vars: { scope: 'game', game, sid: opened.sessionId, ranked: '0' } };
  const earned = mod.call<{ error?: string; balance?: number }>('tickets.earn', session, { amount: 20, reason: 'boss', key: `${game}:earn` });
  assert.equal(earned.error, 'unknown_reason');
  assert.equal(earned.balance, undefined);
  const event = mod.call<{ error?: string; granted?: string; granted_items?: string[] }>(
    'session.event',
    session,
    { eventId: 'sproto.boss_defeated', data: { boss: 'tinubu' }, key: `${game}:event` },
  );
  assert.equal(event.error, undefined);
  assert.equal(event.granted, undefined);
  assert.deepEqual(event.granted_items, []);
  const serverBoard = mod.call<{ error?: string; accepted?: boolean; reason?: string }>(
    'score.submit',
    session,
    { boardId: 'sproto_wins', value: 1, meta: {} },
  );
  assert.equal(serverBoard.accepted, false);
  assert.equal(serverBoard.reason, 'server_board');
  const level = game === 'sproto-shooter' ? '1' : '2';
  const score = mod.call<{ error?: string; accepted?: boolean }>('score.submit', session, {
    boardId: 'nobu_trial_time',
    value: level === '1' ? 20000 : 26000,
    meta: { level },
  });
  assert.equal(score.error, 'bad_board', JSON.stringify(score));
  assert.notEqual(score.accepted, true);
}

{
  const vcoin = mod.call<{ error?: string; ticket?: string }>(
    'portal.enter',
    { userId: USER_A, vars: { scope: 'hub' } },
    { game: 'vcoin', ranked: false },
  );
  assert.notEqual(vcoin.error, 'bad_game');
  assert.equal(typeof vcoin.ticket, 'string');
}

{
  const m = mod.startMatch('hub', { shard: '9' });
  const who = presence(USER_A, 'ada');
  m.join([who], { vars: { scope: 'hub' } });
  const gamesOf = () => JSON.parse(m.signal('status') ?? '{}') as { games: Record<string, number> };
  m.loop([{ sender: who, opCode: 7, data: { game: 'sproto-shooter' } }]);
  assert.equal(gamesOf().games['sproto-shooter'], 1);
  m.loop([{ sender: who, opCode: 7, data: { game: 'sproto-coop-battle' } }]);
  assert.equal(gamesOf().games['sproto-coop-battle'], 1);
  assert.equal(gamesOf().games['sproto-shooter'], undefined);
  m.loop([{ sender: who, opCode: 7, data: { game: 'not-a-game' } }]);
  assert.equal(gamesOf().games['sproto-coop-battle'], 1);
}

console.log('game registration tests ok');
