// Sproto Racer registration (games/sproto_racer.ts). Migration 0081 widens the session,
// ticket and play-lease checks. The game grants no Relic. A game session reads the Relics the
// account already owns, the same list as any other game. A portal ticket opens a game session,
// and that session reads and writes its cloud save (time-trial records, under the 16384 byte
// save limit), closes, claims a lease, counts in presence and sends feedback.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadModule, plain, presence, type Presence } from '../unit/harness';

const GAME = 'sproto-racer';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const NOW = 1_700_000_000_000;
const EARLIER = ['hpos10i', 'nobu', 'peoples-bitcoin', 'sproto', 'sproto-fighter', 'sproto-arcade', 'vcoin', 'sproto-shooter', 'sproto-coop-battle', 'sproto-open-world'];

const mod = loadModule();
mod.nk.onSql(/epoch FROM now\(\)/, () => [{ ms: String(NOW) }]);
mod.nk.onSql(/claim_portal_rate/, () => [{ result: JSON.stringify({ ok: true }) }]);
mod.nk.onSql(/open_portal/, () => [{ result: JSON.stringify({ exp: 1_700_000_060 }) }]);
mod.nk.onSql(/hub_gate/, () => [{ result: '[]' }]);
mod.nk.accounts.set(USER, { user: { userId: USER, username: 'alice' }, email: 'alice@example.test' });

const hub = { userId: USER, vars: { scope: 'hub' } };
const session = (game: string) => ({ userId: USER, vars: { scope: 'game', game, sid: SID, ranked: '0' } });

// Registration and migration 0081.
{
  const racer = mod.global.SprotoRacer as { GAME_ID: string; ENTRY: string };
  assert.equal(racer.GAME_ID, GAME);
  assert.equal(racer.ENTRY, 'ring');
  const listed = plain((mod.global.HubGames as { list(): string[] }).list());
  assert.equal(listed.filter((id) => id === GAME).length, 1);

  const all = plain((mod.global.HubSchema as { all(): { id: string; statements: string[] }[] }).all());
  const ids = all.map((row) => row.id);
  const at = ids.indexOf('0081_sproto_racer');
  assert.ok(at >= 0, 'migration 0081 registered');
  assert.equal(ids.filter((id) => id.startsWith('0081_')).length, 1);
  assert.ok(at > ids.indexOf('0080_feedback_run_live'), 'runs after 0080');
  assert.ok(at > ids.indexOf('0077_sproto_open_world'), 'runs after Open World');
  assert.ok(at > ids.indexOf('0074_play_lease'), 'runs after the lease table exists');
  const sql = all[at]!.statements.join('\n');
  for (const table of ['game_session', 'auth_ticket']) {
    const check = new RegExp(`${table} ADD CONSTRAINT \\w+ CHECK \\(game_id IN \\(([^)]*)\\)\\)`).exec(sql);
    assert.ok(check, `${table} check`);
    for (const id of [...EARLIER, GAME]) assert.ok(check[1]!.includes(`'${id}'`), `${table} keeps ${id}`);
  }
  const surface = /play_lease_surface CHECK \(surface IN \(([^)]*)\)\)/.exec(sql);
  assert.ok(surface, 'play_lease surface check');
  const claim = /IF p_surface NOT IN \(([^)]*)\)/.exec(sql);
  assert.ok(claim, 'claim_play_lease surface list');
  for (const list of [surface[1]!, claim[1]!]) {
    for (const id of ['hub', ...EARLIER, GAME]) assert.ok(list.includes(`'${id}'`), `lease surface ${id}`);
  }
  assert.equal(surface[1], claim[1], 'the check and the function accept the same surfaces');
  assert.doesNotMatch(sql, /game_beaten|event_rule|relic|tickets|ranked_score|leaderboard|verse/i);
}

// A portal ticket for this game opens a game session for the same account, once.
{
  const opened = mod.call<{ ticket?: string; error?: string }>('portal.enter', hub, { game: GAME, ranked: false });
  assert.ok(opened.ticket, JSON.stringify(opened));
  const insert = mod.nk.sqlCalls.filter((call) => call.kind === 'exec' && call.sql.includes('INSERT INTO game.auth_ticket')).at(-1);
  assert.equal(insert?.args[2], GAME);

  const secret = 'ticket-racer';
  let used = false;
  const hash = createHash('sha256').update(secret, 'utf8').digest('hex');
  mod.nk.onSql((sql) => sql.includes('UPDATE game.auth_ticket SET used_at'), (args) => {
    if (String(args[0]) !== hash || used) return [];
    used = true;
    return [{ user_id: USER, game: GAME, session_id: SID, ranked: 'f' }];
  });
  mod.nk.onSql((sql) => sql.includes('UPDATE game.game_session SET ticket_redeemed_at'), () => [{ result: '1' }]);
  const HubRpc = mod.global.HubRpc as {
    beforeAuthenticateCustom: (ctx: unknown, logger: unknown, nk: unknown, data: unknown) => { account: { id: string; vars: { game: string; scope: string; sid: string } } };
  };
  const redeem = (game: string) => HubRpc.beforeAuthenticateCustom({}, mod.logger, mod.nk, { account: { id: `t:${secret}`, vars: { game } } });
  const unauthenticated = (fn: () => void) => assert.throws(fn, (e: unknown) => String((e as { message?: unknown })?.message ?? e).includes('unauthenticated'));
  unauthenticated(() => redeem('sproto-open-world'));
  used = false;
  const out = redeem(GAME);
  assert.equal(out.account.id, `hub:${USER}`, 'the hub account carries over');
  assert.equal(out.account.vars.game, GAME);
  assert.equal(out.account.vars.scope, 'game');
  assert.equal(out.account.vars.sid, SID);
  unauthenticated(() => redeem(GAME));
}

// Cloud save: this game's session writes and reads its time-trial records. Another game's save is separate.
{
  const empty = mod.call<{ data: unknown; updatedAt: number }>('save.get', session(GAME));
  assert.deepEqual(plain(empty), { data: null, updatedAt: 0 });
  const save = { v: 1, trials: { 'test-track-01': 412_000, 'crestline-ridge': 501_250 } };
  const put = mod.call<{ data?: unknown; updatedAt?: number; error?: string }>('save.put', session(GAME), { data: save });
  assert.equal(put.error, undefined, JSON.stringify(put));
  assert.equal(put.updatedAt, NOW);
  assert.ok(JSON.stringify(save).length < 16384, 'a time-trial record fits the save limit');
  const back = mod.call<{ data: unknown; updatedAt: number }>('save.get', session(GAME));
  assert.deepEqual(plain(back), { data: save, updatedAt: NOW });
  assert.ok(mod.nk.storage.get(`game_save/${GAME}/${USER}`));
  assert.deepEqual(plain(mod.call('save.get', session('sproto-open-world'))), { data: null, updatedAt: 0 });
  assert.equal(mod.call<{ error?: string }>('save.put', session(GAME), { data: [1, 2] }).error, 'bad_save');
  assert.equal(mod.call<{ error?: string }>('save.get', hub).error, 'not_game_session');
}

// session.close, the lease, presence and feedback know the id.
{
  assert.deepEqual(plain(mod.call('session.close', session(GAME))), { ok: true });
  mod.nk.onSql(/game\.claim_play_lease/, (args) => [{ result: JSON.stringify({ ok: true, leaseId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', surface: (args as unknown[])[1], previousLeaseId: null, superseded: false, heartbeatSeconds: 15, ttlSeconds: 45 }) }]);
  const lease = mod.call<{ surface?: string; error?: string }>('session.claim', session(GAME), {});
  assert.equal(lease.surface, GAME, JSON.stringify(lease));

  mod.nk.onSql('FROM game.game_session', () => [{ game_id: GAME, n: 2 }]);
  const counts = mod.call<{ counts: Record<string, number> }>('hub.presence', hub, {}).counts;
  assert.equal(counts[GAME], 2);

  mod.nk.onSql(/INSERT INTO game\.feedback_seq/, (args) => [{ public_id: `${String(args[1])}-0001` }]);
  assert.deepEqual(plain(mod.call('feedback.can', session(GAME))), { ok: true, game: GAME, username: 'alice' });
  assert.deepEqual(plain(mod.call('feedback.submit', session(GAME), { categories: ['broke'], note: 'stuck on the spiral' })), { ok: true, id: 'RACER-0001' });
}

// profile.get returns the account's Relics for this session, the same list as another game.
// An event does not grant one. No board and no wallet row.
{
  const owned = ['tinubu_crown', 'dragon_scale', 'future_relic'];
  mod.nk.onSql(/FROM game\.relic_claim/, () => [{ result: JSON.stringify(owned) }]);
  mod.nk.onSql(/verse_wallet/, () => [{ result: JSON.stringify({ balance: 0, earned: [] }) }]);
  const racer = mod.call<{ relics: string[]; error?: string }>('profile.get', session(GAME), {});
  const shooter = mod.call<{ relics: string[] }>('profile.get', session('sproto-shooter'), {});
  assert.equal(racer.error, undefined, JSON.stringify(racer));
  assert.deepEqual(plain(racer.relics), owned);
  assert.deepEqual(plain(shooter.relics), owned);
  mod.nk.onSql(/apply_event/, () => [{ result: JSON.stringify({ granted_items: [] }) }]);
  assert.equal(mod.call<{ granted?: string }>('session.event', session(GAME), { eventId: 'racer.placeholder_grant', key: 'r1', data: { placeholder: true } }).granted, undefined);
  assert.equal(mod.call<{ error?: string }>('score.submit', session(GAME), { boardId: 'shooter_story_clear_ms_v1', value: 10, meta: {} }).error, 'bad_board');
  const HubRpc = mod.global.HubRpc as { WALLET_GAMES: string[] };
  assert.equal(HubRpc.WALLET_GAMES.includes(GAME), false);
  mod.nk.onSql('FROM game.server_flags', (args) => (String(args[0]) === 'hub_exchange' ? [{ result: JSON.stringify({ state: 'on', allowlist: [], percent: 0 }) }] : []));
  assert.equal(mod.call<{ error?: string }>('verse.exchange', hub, { key: 'k', game: GAME, tickets: 10 }).error, 'bad_game');
}

// The plaza travel allowlist accepts the id.
{
  const m = mod.startMatch('hub', { shard: '7' });
  const who: Presence = presence(USER, 'player');
  assert.equal(m.joinAttempt(who, { vars: { scope: 'hub' } }).accept, true);
  m.join([who], { vars: { scope: 'hub' } });
  m.loop([{ sender: who, opCode: 7, data: { game: GAME } }]);
  const upd = m.dispatcher.sent<{ upd: { g: string }[] }>(4);
  assert.equal(upd.at(-1)?.body.upd[0]?.g, GAME);
}

console.log('sproto_racer tests ok');
