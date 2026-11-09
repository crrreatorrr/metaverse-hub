// H0: sproto-shooter and sproto-coop-battle are registered with no client earn or leaderboard.
// Coop Battle is a Bar cabinet game (no plaza portal). Shooter is the empty-slot plaza ring.
// Neither id can mint Tickets or scores from the client, and 0039 itself grants no Relic.
// Their Relics (Marina Anchor, Dragon Scale) come from 0045; see server/test/games/stage_relics.test.ts.
// vcoin stays on the session and ticket checks.
// server/test/unit/run.ts globs this file; it does not need its own runner entry.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModule, plain, presence, type Presence } from './harness';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const NOW = 1_700_000_000_000;
const KEPT = ['hpos10i', 'nobu', 'peoples-bitcoin', 'sproto', 'sproto-fighter', 'sproto-arcade', 'vcoin'];
const ADDED = ['sproto-shooter', 'sproto-coop-battle'];

const mod = loadModule();
mod.nk.onSql(/epoch FROM now\(\)/, () => [{ ms: String(NOW) }]);
mod.nk.onSql(/claim_portal_rate/, () => [{ result: JSON.stringify({ ok: true }) }]);
mod.nk.onSql(/open_portal/, () => [{ result: JSON.stringify({ exp: 1_700_000_060 }) }]);
mod.nk.onSql(/hub_gate/, () => [{ result: '[]' }]);

interface TicketRow {
  hash: string;
  userId: string;
  game: string;
  sessionId: string;
  ranked: boolean;
  used: boolean;
  expiresAt: number;
}
const tickets: TicketRow[] = [];

mod.nk.onSql((sql) => sql.includes('UPDATE game.auth_ticket SET used_at'), (args) => {
  const hash = String(args[0]);
  const row = tickets.find((ticket) => ticket.hash === hash && !ticket.used && ticket.expiresAt > NOW);
  if (!row) return [];
  row.used = true;
  return [{ user_id: row.userId, game: row.game, session_id: row.sessionId, ranked: row.ranked ? 't' : 'f' }];
});
mod.nk.onSql((sql) => sql.includes('UPDATE game.game_session SET ticket_redeemed_at'), () => [{ result: '1' }]);
mod.nk.onSql(/earn_tickets/, () => [{ result: JSON.stringify({ error: 'unknown_reason' }) }]);
mod.nk.onSql(/apply_event/, () => [{ result: JSON.stringify({}) }]);

function issue(game: string, opts: { userId?: string; expiresAt?: number } = {}): string {
  const secret = `ticket-${game}-${tickets.length}-${opts.userId ?? USER}`;
  const hash = createHash('sha256').update(secret, 'utf8').digest('hex');
  tickets.push({
    hash,
    userId: opts.userId ?? USER,
    game,
    sessionId: SID,
    ranked: false,
    used: false,
    expiresAt: opts.expiresAt ?? NOW + 60_000,
  });
  return secret;
}

function redeem(secret: string, game: string): { id: string; game: string; userId: string } {
  const HubRpc = mod.global.HubRpc as {
    beforeAuthenticateCustom: (
      ctx: unknown,
      logger: unknown,
      nk: unknown,
      data: { account: { id: string; vars: { game: string } } },
    ) => { account: { id: string; vars: { game: string; scope: string; sid: string } } };
  };
  const data = { account: { id: `t:${secret}`, vars: { game } } };
  const out = HubRpc.beforeAuthenticateCustom({}, mod.logger, mod.nk, data);
  const id = out.account.id;
  assert.ok(id.startsWith('hub:'), id);
  return { id, game: out.account.vars.game, userId: id.slice(4) };
}

function unauthenticated(fn: () => void): void {
  assert.throws(fn, (error: unknown) => {
    const message = error && typeof error === 'object' && 'message' in error ? String((error as { message: unknown }).message) : String(error);
    return message.includes('unauthenticated');
  });
}

const hub = { userId: USER, vars: { scope: 'hub' } };
const gameSession = (game: string) => ({ userId: USER, vars: { scope: 'game', game, sid: SID, ranked: '0' } });

// Migration 0039 keeps every current id, including vcoin, and does not mint. Later Relic rules are 0045.
{
  const HubSchema = mod.global.HubSchema as { all(): { id: string; statements: string[] }[] };
  const all = plain(HubSchema.all());
  const ids = all.map((row) => row.id);
  assert.ok(ids.includes('0037_hub_life_medal'));
  assert.equal(ids.some((id) => id.startsWith('0036_')), false);
  assert.equal(ids.some((id) => id.startsWith('0038_')), false);
  const migration = all.find((row) => row.id === '0039_sproto_shooter_coop');
  assert.ok(migration, 'migration 0039 registered');
  assert.ok(ids.indexOf('0039_sproto_shooter_coop') > ids.indexOf('0037_hub_life_medal'));
  const sql = migration.statements.join('\n');
  for (const id of [...KEPT, ...ADDED]) {
    assert.match(sql, new RegExp(`'${id}'`));
  }
  assert.match(sql, /game_session_game CHECK \(game_id IN \([^)]*'vcoin'[^)]*'sproto-shooter'[^)]*'sproto-coop-battle'\)\)/);
  assert.match(sql, /auth_ticket_game CHECK \(game_id IN \([^)]*'vcoin'[^)]*'sproto-coop-battle'\)\)/);
  assert.equal(sql.includes('game_beaten'), false);
  assert.equal(sql.includes('event_rule'), false);
  assert.equal(sql.includes('relic'), false);
  assert.equal(sql.includes('tickets'), false);
  assert.equal(sql.includes('ranked_score'), false);
  const shooter = mod.global.SprotoShooter as { GAME_ID: string; ENTRY: string };
  const coop = mod.global.SprotoCoopBattle as { GAME_ID: string; ENTRY: string };
  assert.equal(shooter.GAME_ID, 'sproto-shooter');
  assert.equal(shooter.ENTRY, 'ring');
  assert.equal(coop.GAME_ID, 'sproto-coop-battle');
  assert.equal(coop.ENTRY, 'cabinet');
  const listed = plain((mod.global.HubGames as { list(): string[] }).list());
  assert.ok(listed.includes('sproto-shooter'));
  assert.ok(listed.includes('sproto-coop-battle'));
  assert.equal(listed.filter((id) => id === 'sproto-shooter').length, 1);
  assert.equal(listed.filter((id) => id === 'sproto-coop-battle').length, 1);
}

// Cabinet vs ring in the URL contract. Shooter uses the empty slot. Coop is a cabinet choice.
{
  const games = readFileSync(join(repoRoot, 'apps/hub/src/games.ts'), 'utf8');
  assert.match(games, /id: 'sproto-shooter',\s*slug: 'sproto-shooter',\s*env: 'VITE_GAME_URL_SPROTO_SHOOTER',\s*entry: 'ring'/);
  assert.match(games, /id: 'sproto-coop-battle',\s*slug: 'sproto-coop-battle',\s*env: 'VITE_GAME_URL_SPROTO_COOP_BATTLE',\s*entry: 'cabinet'/);
  assert.match(games, /id: 'sproto-fighter',\s*slug: 'sproto-fighter',\s*env: 'VITE_GAME_URL_SPROTO_FIGHTER',\s*entry: 'cabinet'/);
  assert.match(games, /id: 'sproto-arcade',\s*slug: 'sproto-arcade',\s*env: 'VITE_GAME_URL_SPROTO_ARCADE',\s*entry: 'cabinet'/);
  const plaza = readFileSync(join(repoRoot, 'apps/hub/src/realms/plaza/config.ts'), 'utf8');
  // The Range ring plus the green gate behind the statue head.
  assert.equal(plaza.split("id: 'sproto-shooter'").length - 1, 2);
  assert.match(plaza, /id: 'sproto-shooter', label: 'Sproto Shooter', place: 'Behind the statue', angle: 0, color: '#39ff6a'/);
  assert.equal(plaza.split("id: 'sproto-coop-battle'").length - 1, 1);
  assert.match(plaza, /id: 'sproto-shooter', label: 'Sproto Shooter', place: 'The Range', angle: 3 \* PLAZA_SLOT \+ PLAZA_YAW/);
  assert.match(plaza, /id: 'sproto-coop-battle', label: 'Sproto Coop Battle'/);
  assert.match(plaza, /id: 'sproto-arcade'/);
  assert.match(plaza, /id: 'sproto-fighter'/);
  assert.equal(plaza.includes("id: 'sproto-coop-battle'"), true);
  const menu = plaza.slice(plaza.indexOf('export const ARCADE_GAMES'));
  assert.match(menu, /ARCADE_STORY_GAME[\s\S]*ARCADE_GAME[\s\S]*ARCADE_COOP_GAME/);
}

// Portal tickets open for the new ids and for vcoin. Unknown ids still fail.
{
  assert.equal((mod.call('portal.enter', hub, { game: 'nope' }) as { error?: string }).error, 'bad_game');
  assert.equal((mod.call('portal.enter', hub, { game: 'sproto-duel' }) as { error?: string }).error, 'bad_game');
  for (const game of [...ADDED, 'vcoin', 'sproto']) {
    const opened = mod.call('portal.enter', hub, { game, ranked: false }) as { ticket?: string; error?: string };
    assert.ok(opened.ticket, `${game} ${JSON.stringify(opened)}`);
    const insert = mod.nk.sqlCalls.filter((call) => call.kind === 'exec' && call.sql.includes('INSERT INTO game.auth_ticket')).at(-1);
    assert.equal(insert?.args[2], game);
  }
}

// Redeem once. Wrong game, wrong account, expiry, and replay do not open a session.
{
  for (const game of ADDED) {
    const secret = issue(game);
    const first = redeem(secret, game);
    assert.equal(first.userId, USER);
    assert.equal(first.game, game);
    unauthenticated(() => redeem(secret, game));

    const foreign = issue(game);
    unauthenticated(() => redeem(foreign, 'sproto'));
    unauthenticated(() => redeem(foreign, game));

    const expired = issue(game, { expiresAt: NOW - 1000 });
    unauthenticated(() => redeem(expired, game));
    assert.equal(tickets.find((row) => row.hash === createHash('sha256').update(expired).digest('hex'))?.used, false);

    const owned = issue(game, { userId: OTHER });
    const asOwner = redeem(owned, game);
    assert.equal(asOwner.userId, OTHER);
    assert.notEqual(asOwner.id, `hub:${USER}`);
  }
}

// No earn and no score board for the new ids. Another game's boss event grants nothing here.
{
  for (const game of ADDED) {
    const earned = mod.call('tickets.earn', gameSession(game), { key: 'k1', amount: 20, reason: 'boss' }) as { error?: string; balance?: number };
    assert.equal(earned.error, 'unknown_reason');
    assert.equal(earned.balance, undefined);
    const event = mod.call('session.event', gameSession(game), { eventId: 'sproto.boss_defeated', key: 'k2', data: { boss: 'sahil' } }) as { granted?: string; tickets?: number };
    assert.equal(event.granted, undefined);
    assert.equal(event.tickets, undefined);
    const score = mod.call('score.submit', gameSession(game), { boardId: 'shooter_story_clear_ms_v1', value: 10, meta: {} }) as { error?: string };
    assert.equal(score.error, 'bad_board');
    const coopBoard = mod.call('score.submit', gameSession(game), { boardId: 'coop_stage_clear_ms_v1', value: 10, meta: {} }) as { error?: string };
    assert.equal(coopBoard.error, 'bad_board');
  }
}

// Travel allowlist accepts the new ids and still rejects an unknown one.
{
  const m = mod.startMatch('hub', { shard: '9' });
  const who: Presence = presence(USER, 'player');
  assert.equal(m.joinAttempt(who, { vars: { scope: 'hub' } }).accept, true);
  m.join([who], { vars: { scope: 'hub' } });
  m.loop([{ sender: who, opCode: 7, data: { game: 'sproto-coop-battle' } }]);
  let upd = m.dispatcher.sent<{ upd: { g: string }[] }>(4);
  assert.equal(upd.at(-1)?.body.upd[0]?.g, 'sproto-coop-battle');
  m.dispatcher.clear();
  m.loop([{ sender: who, opCode: 7, data: { game: 'not-a-game' } }]);
  assert.equal(m.dispatcher.sent(4).length, 0);
  const state = m.state as { slots: ({ game: string } | null)[] };
  assert.equal(state.slots.find((slot) => slot)?.game, 'sproto-coop-battle');
  m.loop([{ sender: who, opCode: 7, data: { game: 'sproto-shooter' } }]);
  upd = m.dispatcher.sent<{ upd: { g: string }[] }>(4);
  assert.equal(upd.at(-1)?.body.upd[0]?.g, 'sproto-shooter');
}

console.log('game registration ok');
