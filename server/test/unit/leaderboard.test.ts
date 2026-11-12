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
  assert.equal(submit(fresh(), { boardId: 'nobu_trial_time', value: 41230, meta: { level: 9 } }).error, 'bad_variant');
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

// Layout 2 has separate rows/floors; Classic still accepts its original bounds.
for (const [variant, floor] of [['1', 15000], ['2', 15000], ['3', 12000], ['1v2', 25700], ['2v2', 26000], ['3v2', 20600], ['4', 24000], ['6', 30000], ['5', 21000]] as const) {
  assert.equal(submit(fresh(), { boardId: 'nobu_trial_time', value: floor, meta: { level: variant } }).accepted, true, variant);
  assert.equal(submitted.at(-1)![8], variant, 'SQL preserves the complete variant');
  const writes = submitted.length;
  assert.equal(submit(fresh(), { boardId: 'nobu_trial_time', value: floor - 1, meta: { level: variant } }).error, 'implausible_score', variant);
  assert.equal(submitted.length, writes, 'below-floor values never reach SQL');
}
for (const variant of ['4v2', '5v2', '6v2', 'toString', 'constructor', '__proto__']) {
  assert.equal(submit(fresh(), { boardId: 'nobu_trial_time', value: 100000, meta: { level: variant } }).error, 'bad_variant', variant);
}

// Chapter 2 floors/ceilings are inclusive; malformed inputs never reach SQL.
for (const [variant, floor] of [['4', 24000], ['6', 30000], ['5', 21000]] as const) {
  for (const level of [variant, Number(variant)]) {
    assert.equal(submit(fresh(), { boardId: 'nobu_trial_time', value: floor, meta: { level } }).accepted, true);
    assert.equal(submitted.at(-1)![8], variant, 'numeric/string level use the same full SQL variant');
  }
  assert.equal(submit(fresh(), { boardId: 'nobu_trial_time', value: 1_800_000, meta: { level: variant } }).accepted, true);
  for (const [value, code] of [[1_800_001, 'implausible_score'], [floor + .5, 'bad_score']] as const) {
    const writes = submitted.length;
    assert.equal(submit(fresh(), { boardId: 'nobu_trial_time', value, meta: { level: variant } }).error, code);
    assert.equal(submitted.length, writes, 'invalid boundary never reaches SQL');
  }
  assert.deepEqual(submit(fresh(), { boardId: 'nobu_trial_time', value: floor, meta: { level: variant, godMode: true } }), { accepted: false, reason: 'god_mode' });
}

// Rate limit: 1 per (user, board, variant) per 5 s.
{
  const who = fresh();
  assert.equal(submit(who, { boardId: 'nobu_trial_time', value: 20000, meta: { level: 1 } }).accepted, true);
  assert.equal(submit(who, { boardId: 'nobu_trial_time', value: 19000, meta: { level: 1 } }).error, 'rate_limited');
  assert.equal(submit(who, { boardId: 'nobu_trial_time', value: 19000, meta: { level: 2 } }).accepted, true, 'other level is its own window');
  assert.equal(submit(who, { boardId: 'nobu_trial_time', value: 30000, meta: { level: '1v2' } }).accepted, true, 'new layout has its own window');
  for (const [level, floor] of [[4, 24000], [6, 30000], [5, 21000]] as const) {
    assert.equal(submit(who, { boardId: 'nobu_trial_time', value: floor, meta: { level } }).accepted, true, 'Chapter 2 variant has its own window');
    assert.equal(submit(who, { boardId: 'nobu_trial_time', value: floor + 1, meta: { level: String(level) } }).error, 'rate_limited', 'number/string share one window');
  }
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
  const hp = submit(game('hpos10i', '1'), { boardId: 'hpos10i_act_time', value: 40.4, meta: { zone: 'z1_retro_rush_hills', act: 1 } });
  assert.equal(hp.value, 40, 'other boards round');
  assert.equal(submitted.at(-1)![8], '', 'no variant');
  const sql = mod.nk.sqlCalls.find((c) => c.sql.startsWith('WITH sess'))!.sql;
  // B4: only sproto still needs a ranked session; an unranked HPOS10I session posts its act time.
  assert.match(sql, /IN \('sproto'\) THEN 'unranked'/, 'hpos10i and nobu are not ranked-gated');
  assert.doesNotMatch(sql, /'hpos10i'[^)]*\) THEN 'unranked'/);
  const z1a1 = { zone: 'z1_retro_rush_hills', act: 1 };
  const hposUser = (tail: string, ranked = '0', email = true) => {
    const userId = `00000000-0000-4000-8000-0000000${tail}`;
    if (email) mod.nk.accounts.set(userId, { user: { userId, username: `u${tail}` }, email: `${tail}@example.test` });
    return { userId, vars: { scope: 'game', game: 'hpos10i', sid: SID, ranked } };
  };
  const unranked = submit(hposUser('0bbbb'), { boardId: 'hpos10i_act_time', value: 61.2, meta: z1a1 });
  assert.deepEqual(unranked, { accepted: true, posted: true, value: 61, order: 'asc' });
  assert.deepEqual(plain(submitted.at(-1)!.slice(2, 7)), [false, 'hpos10i', 'hpos10i_act_time', 'asc', 61]);
  // The SQL, not the client, picks the board half: unranked sessions write variant "open", which meta skips.
  assert.match(sql, /game_id FROM sess\) = 'hpos10i' AND NOT COALESCE\(\(SELECT ranked FROM sess\), false\) THEN 'open' ELSE \$9::text END AS variant/);
  assert.match(sql, /variant = \(SELECT variant FROM v\)/);
  const HubBoards = mod.global.HubBoards as { recomputeMeta(nk: unknown, l: unknown): unknown; HPOS_FLOOR_S: number; HPOS_CEIL_S: number };
  mod.nk.onSql('WITH scored AS', () => [{ result: '{"players":0,"updated":0}' }]);
  mod.nk.onSql('DELETE FROM game.ranked_score AS m', () => [{ result: '{"removed":0}' }]);
  HubBoards.recomputeMeta(mod.nk, mod.logger);
  for (const call of mod.nk.sqlCalls.filter((c) => c.sql.startsWith('WITH scored AS') || c.sql.startsWith('WITH removed AS'))) {
    assert.match(call.sql, /NOT \((s\.)?board_id = 'hpos10i_act_time' AND (s\.)?variant = 'open'\)/, 'open rows never feed meta');
  }
  // Bounds: nothing under the floor (the act at the physics speed cap) or over the ceiling reaches SQL.
  assert.deepEqual([HubBoards.HPOS_FLOOR_S, HubBoards.HPOS_CEIL_S], [23, 1800]);
  let tail = 0;
  const next = () => hposUser(`c${String(++tail).padStart(4, '0')}`);
  for (const value of [0, 1, 22.9, 1800.5, 99999]) {
    const writes = submitted.length;
    assert.equal(submit(next(), { boardId: 'hpos10i_act_time', value, meta: z1a1 }).error, 'implausible_score', String(value));
    assert.equal(submitted.length, writes, `${value} never reaches SQL`);
  }
  assert.equal(submit(hposUser('0dddd', '1'), { boardId: 'hpos10i_act_time', value: 0, meta: z1a1 }).error, 'implausible_score', 'ranked posts are bounded too');
  assert.equal(submit(next(), { boardId: 'hpos10i_act_time', value: 23, meta: z1a1 }).accepted, true, 'the floor itself is accepted');
  assert.equal(submit(next(), { boardId: 'hpos10i_act_time', value: 1800, meta: z1a1 }).accepted, true);
  // Only Zone 1 Act 1 is a board act.
  for (const meta of [{}, { zone: 'z1_retro_rush_hills', act: 2 }, { zone: 'z2_wizard_academy', act: 1 }, { zone: 'z1_retro_rush_hills', act: '1' }]) {
    assert.equal(submit(next(), { boardId: 'hpos10i_act_time', value: 60, meta }).error, 'bad_variant', JSON.stringify(meta));
  }
  // Guests (no email on the account) cannot post from an unranked session.
  const writes = submitted.length;
  assert.deepEqual(submit(hposUser('0eeee', '0', false), { boardId: 'hpos10i_act_time', value: 60, meta: z1a1 }), { accepted: false, reason: 'guest' });
  assert.equal(submitted.length, writes, 'a guest post never reaches SQL');
  assert.deepEqual(
    submit(hposUser('0aaaa'), { boardId: 'hpos10i_act_time', value: 50, meta: z1a1, godMode: true }),
    { accepted: false, reason: 'god_mode' },
    'god mode still posts nothing',
  );
}

// leaderboard.top: variant required for NOBU, limit clamped, any signed-in scope.
{
  const hub = { userId: U, vars: { scope: 'hub' } };
  const top = mod.call<Record<string, unknown>>('leaderboard.top', hub, { boardId: 'nobu_trial_time', variant: '3', limit: 500 });
  assert.equal(top.variant, '3');
  assert.deepEqual(plain(topArgs), ['nobu_trial_time', 'asc', U, '3', 50]);
  for (const variant of ['1v2', '2v2', '3v2', '4', '6', '5', 4, 6, 5]) {
    assert.equal(mod.call<Record<string, unknown>>('leaderboard.top', hub, { boardId: 'nobu_trial_time', variant }).variant, String(variant));
    assert.deepEqual(plain(topArgs), ['nobu_trial_time', 'asc', U, String(variant), 10]);
  }
  for (const variant of ['4v2', '5v2', '6v2', 'toString', 'constructor', '__proto__']) {
    assert.equal(mod.call<Record<string, unknown>>('leaderboard.top', hub, { boardId: 'nobu_trial_time', variant }).error, 'bad_variant', variant);
  }
  assert.equal(mod.call<Record<string, unknown>>('leaderboard.top', hub, { boardId: 'nobu_trial_time' }).error, 'bad_variant');
  mod.call('leaderboard.top', game('sproto'), { boardId: 'sproto_wins' });
  assert.deepEqual(plain(topArgs), ['sproto_wins', 'desc', U, '', 10]);
  assert.equal(mod.call<Record<string, unknown>>('leaderboard.top', { vars: { scope: 'hub' } }, { boardId: 'meta' }).error, 'unauthorized');
  // E5: the Coop clear board is read per boss; anything else is bad_variant. Clients still cannot post it.
  const coopBosses = plain((mod.global.CoopRewards as { BOSSES: string[] }).BOSSES);
  assert.equal(coopBosses.length, 12);
  for (const boss of coopBosses) {
    assert.equal(mod.call<Record<string, unknown>>('leaderboard.top', hub, { boardId: 'coop_stage_clear_ms_v1', variant: boss }).variant, boss);
    assert.deepEqual(plain(topArgs), ['coop_stage_clear_ms_v1', 'asc', U, boss, 10]);
  }
  for (const variant of [undefined, '', '1', '01-marina', 'toString', '__proto__', 7, '01-marina-bront ']) {
    assert.equal(mod.call<Record<string, unknown>>('leaderboard.top', hub, { boardId: 'coop_stage_clear_ms_v1', variant }).error, 'bad_variant', String(variant));
  }
  assert.equal(submit(game('sproto-coop-battle'), { boardId: 'coop_stage_clear_ms_v1', value: 1000, meta: {} }).error, 'bad_board');
  // HPOS10I: "" is the ranked standings, "open" the hub-session rows.
  mod.call('leaderboard.top', hub, { boardId: 'hpos10i_act_time', variant: 'open' });
  assert.deepEqual(plain(topArgs), ['hpos10i_act_time', 'asc', U, 'open', 10]);
  mod.call('leaderboard.top', hub, { boardId: 'hpos10i_act_time' });
  assert.deepEqual(plain(topArgs), ['hpos10i_act_time', 'asc', U, '', 10]);
  assert.equal(mod.call<Record<string, unknown>>('leaderboard.top', hub, { boardId: 'hpos10i_act_time', variant: 'ranked' }).error, 'bad_variant');
  mod.call('leaderboard.top', hub, { boardId: 'meta' });
  assert.deepEqual(plain(topArgs), ['meta', 'desc', U, '', 10]);
}

console.log('leaderboard tests ok');
