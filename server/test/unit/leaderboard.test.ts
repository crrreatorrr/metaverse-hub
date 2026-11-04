// HubBoards.submit / top per Contract C13 (SQL is scripted; the docker suite runs it for real).
import assert from 'node:assert/strict';
import { loadModule, plain } from './harness';

const U = '11111111-1111-4111-8111-111111111111';
const SID = '33333333-3333-4333-8333-333333333333';
const mod = loadModule();
const game = (g: string, ranked = '0') => ({ userId: U, vars: { scope: 'game', game: g, sid: SID, ranked } });

const submitted: unknown[][] = [];
mod.nk.onSql('INSERT INTO game.ranked_score (user_id, board_id, variant, value, meta, session_id, updated_at)', (args, sql) => {
  if (!sql.startsWith('WITH sess')) return [];
  submitted.push(args);
  const order = args[5];
  return [{ result: JSON.stringify({ reason: args[2] ? 'god_mode' : null, posted: true, value: args[6] }) }].map((r) => (order ? r : r));
});
let topArgs: unknown[] = [];
mod.nk.onSql('WITH ranked AS', (args) => {
  topArgs = args;
  return [{ result: JSON.stringify({ boardId: args[0], variant: args[3], order: args[1], rows: [], me: null }) }];
});

const submit = (ctx: object, body: object) => mod.call<Record<string, unknown>>('score.submit', ctx, body);
let n = 0;
const fresh = () => ({ userId: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, vars: { scope: 'game', game: 'nobu', sid: SID, ranked: '0' } });

// NOBU: unranked session posts integer ms per level.
{
  const ok = submit(fresh(), { boardId: 'nobu_trial_time', value: 41230, meta: { level: 2, deaths: 1 } });
  assert.deepEqual(ok, { accepted: true, posted: true, value: 41230, order: 'asc' });
  const args = submitted.at(-1)!;
  assert.deepEqual(plain(args.slice(2)), [false, 'nobu', 'nobu_trial_time', 'asc', 41230, '{"level":2,"deaths":1}', '2']);
  assert.equal(submit(fresh(), { boardId: 'nobu_trial_time', value: 41230, meta: { level: '3' } }).accepted, true);
  assert.equal(submit(fresh(), { boardId: 'nobu_trial_time', value: 41230.5, meta: { level: 1 } }).error, 'bad_score');
  assert.equal(submit(fresh(), { boardId: 'nobu_trial_time', value: 41230, meta: { level: 4 } }).error, 'bad_variant');
  assert.equal(submit(fresh(), { boardId: 'nobu_trial_time', value: 41230, meta: {} }).error, 'bad_variant');
  assert.equal(submit(fresh(), { boardId: 'nobu_trial_time', value: 14999, meta: { level: 1 } }).error, 'implausible_score');
  assert.equal(submit(fresh(), { boardId: 'nobu_trial_time', value: 12000, meta: { level: 3 } }).accepted, true);
  assert.equal(submit(fresh(), { boardId: 'nobu_trial_time', value: 1_800_001, meta: { level: 3 } }).error, 'implausible_score');
  assert.equal(submit(fresh(), { boardId: 'nobu_trial_time', value: 20000, meta: { level: 1, note: 'x'.repeat(600) } }).error, 'bad_json');
  // God mode reaches the SQL gate as true and posts nothing.
  assert.deepEqual(submit(fresh(), { boardId: 'nobu_trial_time', value: 20000, meta: { level: 1, godMode: true } }), { accepted: false, reason: 'god_mode' });
  assert.equal(submitted.at(-1)![2], true);
  assert.equal(JSON.parse(String(submitted.at(-1)![7])).godMode, undefined, 'god-mode flags are not stored');
}

// Rate limit: 1 per (user, board, variant) per 5 s.
{
  const who = fresh();
  assert.equal(submit(who, { boardId: 'nobu_trial_time', value: 20000, meta: { level: 1 } }).accepted, true);
  assert.equal(submit(who, { boardId: 'nobu_trial_time', value: 19000, meta: { level: 1 } }).error, 'rate_limited');
  assert.equal(submit(who, { boardId: 'nobu_trial_time', value: 19000, meta: { level: 2 } }).accepted, true, 'other level is its own window');
  const key = [...mod.nk.localcache.keys()].find((k) => k.startsWith(`score:${who.userId}:nobu_trial_time:1`))!;
  mod.nk.localcache.set(key, Date.now() - 6000);
  assert.equal(submit(who, { boardId: 'nobu_trial_time', value: 19000, meta: { level: 1 } }).accepted, true);
}

// Server boards, ranked gate (passed to SQL), scopes.
{
  assert.deepEqual(submit(game('sproto', '1'), { boardId: 'sproto_wins', value: 1 }), { accepted: false, reason: 'server_board' });
  assert.deepEqual(submit(game('sproto', '1'), { boardId: 'meta', value: 1 }), { accepted: false, reason: 'server_board' });
  assert.equal(submit({ userId: U, vars: { scope: 'hub' } }, { boardId: 'nobu_trial_time', value: 20000, meta: { level: 1 } }).error, 'not_game_session');
  assert.equal(submit(game('hpos10i'), { boardId: 'nope', value: 1 }).error, 'bad_board');
  const hp = submit(game('hpos10i', '1'), { boardId: 'hpos10i_act_time', value: 40.4, meta: { act: 1 } });
  assert.equal(hp.value, 40, 'other boards round');
  assert.equal(submitted.at(-1)![8], '', 'no variant');
  const sql = mod.nk.sqlCalls.find((c) => c.sql.startsWith('WITH sess'))!.sql;
  assert.match(sql, /IN \('hpos10i', 'sproto'\) THEN 'unranked'/, 'nobu is not ranked-gated');
}

// leaderboard.top: variant required for NOBU, limit clamped, any signed-in scope.
{
  const hub = { userId: U, vars: { scope: 'hub' } };
  const top = mod.call<Record<string, unknown>>('leaderboard.top', hub, { boardId: 'nobu_trial_time', variant: '3', limit: 500 });
  assert.equal(top.variant, '3');
  assert.deepEqual(plain(topArgs), ['nobu_trial_time', 'asc', U, '3', 50]);
  assert.equal(mod.call<Record<string, unknown>>('leaderboard.top', hub, { boardId: 'nobu_trial_time' }).error, 'bad_variant');
  mod.call('leaderboard.top', game('sproto'), { boardId: 'sproto_wins' });
  assert.deepEqual(plain(topArgs), ['sproto_wins', 'desc', U, '', 10]);
  assert.equal(mod.call<Record<string, unknown>>('leaderboard.top', { vars: { scope: 'hub' } }, { boardId: 'meta' }).error, 'unauthorized');
}

console.log('leaderboard tests ok');
