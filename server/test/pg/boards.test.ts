// B4 and E5 on a real Postgres: an unranked HPOS10I session posts its act time, sproto still needs
// a ranked session, god mode posts nothing, and the Coop clear board reads per boss.
import assert from 'node:assert/strict';
import { addUser, count, freshPg, gameCtx, hubCtx, openGameSession, withEmail } from './rig';

const pg = freshPg('boards');
const { mod } = pg;

interface Submit { accepted?: boolean; posted?: boolean; value?: number; reason?: string; error?: string }
interface Top { rows: { userId: string; name: string; value: number; rank: number }[]; me: { value: number; rank: number } | null; variant: string; error?: string }

const scoreOf = (user: string, board: string, variant = '') =>
  pg.run('SELECT value FROM game.ranked_score WHERE user_id = $1::uuid AND board_id = $2 AND variant = $3', [user, board, variant])[0]?.value ?? null;

// HPOS10I: a normal (unranked) hub-entered session posts to the "open" half of the board. It is
// bounded, refuses guests, and never touches the ranked rows or meta.
{
  const z1a1 = { zone: 'z1_retro_rush_hills', act: 1 };
  const user = withEmail(pg, addUser(pg, 'hpos_runner'));
  const sid = openGameSession(pg, user, 'hpos10i');
  const ctx = gameCtx(user, 'hpos10i', sid);
  const post = (value: number, extra: object = {}) => {
    mod.nk.localcache.forEach((_v, key) => { if (String(key).startsWith('score:')) mod.nk.localcache.delete(key); });
    return mod.call<Submit>('score.submit', ctx, { boardId: 'hpos10i_act_time', value, meta: z1a1, ...extra });
  };
  // The QA case: 0 (or anything under the floor) is refused and writes nothing.
  for (const value of [0, 1, 22.9, 1800.1]) assert.equal(post(value).error, 'implausible_score', String(value));
  assert.equal(count(pg, "SELECT 1 FROM game.ranked_score WHERE board_id = 'hpos10i_act_time'"), 0);
  const first = post(61.4);
  assert.deepEqual([first.accepted, first.posted, first.value], [true, true, 61], JSON.stringify(first));
  assert.equal(scoreOf(user, 'hpos10i_act_time', 'open'), '61', 'an unranked session writes the open variant');
  assert.equal(scoreOf(user, 'hpos10i_act_time', ''), null, 'and never the ranked row');
  assert.equal(post(80).accepted, true);
  assert.equal(scoreOf(user, 'hpos10i_act_time', 'open'), '61', 'a slower time does not replace the best');
  const god = post(30, { godMode: true });
  assert.deepEqual([god.accepted, god.reason], [false, 'god_mode']);
  assert.equal(scoreOf(user, 'hpos10i_act_time', 'open'), '61', 'god mode posts nothing');
  // Another act, or no act, is not a board act.
  mod.nk.localcache.clear();
  assert.equal(mod.call<Submit>('score.submit', ctx, { boardId: 'hpos10i_act_time', value: 60, meta: { zone: 'z1_retro_rush_hills', act: 2 } }).error, 'bad_variant');
  assert.equal(mod.call<Submit>('score.submit', ctx, { boardId: 'hpos10i_act_time', value: 60 }).error, 'bad_variant');

  // A guest (no email) cannot post from an unranked session.
  const guest = addUser(pg, 'hpos_guest');
  const guestSid = openGameSession(pg, guest, 'hpos10i');
  const refused = mod.call<Submit>('score.submit', gameCtx(guest, 'hpos10i', guestSid), { boardId: 'hpos10i_act_time', value: 60, meta: z1a1 });
  assert.deepEqual([refused.accepted, refused.reason], [false, 'guest']);
  assert.equal(count(pg, 'SELECT 1 FROM game.ranked_score WHERE user_id = $1::uuid', [guest]), 0);

  // A ranked session (the session row says so) writes the ranked row; the two halves stay apart.
  const ranked = withEmail(pg, addUser(pg, 'hpos_ranked'));
  const rankedSid = openGameSession(pg, ranked, 'hpos10i');
  pg.run('UPDATE game.game_session SET ranked = true WHERE session_id = $1::uuid', [rankedSid]);
  const rankedCtx = { userId: ranked, vars: { scope: 'game', game: 'hpos10i', sid: rankedSid, ranked: '1' } };
  assert.equal(mod.call<Submit>('score.submit', rankedCtx, { boardId: 'hpos10i_act_time', value: 70, meta: z1a1 }).posted, true);
  assert.equal(scoreOf(ranked, 'hpos10i_act_time', ''), '70');
  assert.equal(scoreOf(ranked, 'hpos10i_act_time', 'open'), null);
  // A token that claims ranked while the session row is unranked still lands on the open half.
  const liar = withEmail(pg, addUser(pg, 'hpos_liar'));
  const liarSid = openGameSession(pg, liar, 'hpos10i');
  mod.call<Submit>('score.submit', { userId: liar, vars: { scope: 'game', game: 'hpos10i', sid: liarSid, ranked: '1' } }, { boardId: 'hpos10i_act_time', value: 24, meta: z1a1 });
  assert.equal(scoreOf(liar, 'hpos10i_act_time', ''), null, 'the session row decides, not the token');
  assert.equal(scoreOf(liar, 'hpos10i_act_time', 'open'), '24');

  // Reads: the ranked standings and the open board are separate lists.
  const open = mod.call<Top>('leaderboard.top', hubCtx(user), { boardId: 'hpos10i_act_time', variant: 'open' });
  assert.deepEqual(open.rows.map((row) => [row.userId, row.value, row.rank]), [[liar, 24, 1], [user, 61, 2]]);
  assert.equal(open.me?.value, 61);
  const standings = mod.call<Top>('leaderboard.top', hubCtx(user), { boardId: 'hpos10i_act_time' });
  assert.deepEqual(standings.rows.map((row) => row.userId), [ranked], 'open posts are not in the ranked standings');

  // meta: only the ranked row counts. The fastest open time earns nothing.
  (mod.global.HubBoards as { recomputeMeta(nk: unknown, l: unknown): unknown }).recomputeMeta(mod.nk, mod.logger);
  assert.deepEqual(pg.run("SELECT user_id FROM game.ranked_score WHERE board_id = 'meta'").map((row) => row.user_id), [ranked]);

  // The board is HPOS10I's: another game's session cannot post to it. A closed session cannot post.
  const other = withEmail(pg, addUser(pg, 'nobu_player'));
  const nobuSid = openGameSession(pg, other, 'nobu');
  assert.equal(mod.call<Submit>('score.submit', gameCtx(other, 'nobu', nobuSid), { boardId: 'hpos10i_act_time', value: 60, meta: z1a1 }).error, 'bad_board');
  pg.run("UPDATE game.game_session SET state = 'closed' WHERE session_id = $1::uuid", [sid]);
  assert.equal(post(30).error, 'session_closed');
  assert.equal(scoreOf(user, 'hpos10i_act_time', 'open'), '61');
  pg.run("DELETE FROM game.ranked_score WHERE board_id = 'meta'");
}

// sproto_wins is a server board, and an unranked sproto session is still told `unranked` by the SQL gate.
{
  const user = addUser(pg, 'duelist');
  const sid = openGameSession(pg, user, 'sproto');
  const out = mod.call<Submit>('score.submit', gameCtx(user, 'sproto', sid), { boardId: 'sproto_wins', value: 1 });
  assert.deepEqual([out.accepted, out.reason], [false, 'server_board']);
  const gate = pg.run(
    `WITH sess AS (SELECT ranked, game_id FROM game.game_session WHERE session_id = $1::uuid)
     SELECT (NOT COALESCE((SELECT ranked FROM sess), false) AND (SELECT game_id FROM sess) IN ('sproto')) AS unranked`,
    [sid],
  )[0]!.unranked;
  assert.equal(gate, 't');
  assert.equal(count(pg, "SELECT 1 FROM game.ranked_score WHERE board_id = 'sproto_wins'"), 0);
}

// Coop clears are stored one row per boss (the settle function writes them); the top RPC reads a boss.
{
  const fast = addUser(pg, 'coop_fast');
  const slow = addUser(pg, 'coop_slow');
  const put = (user: string, boss: string, ms: number) => pg.run(
    `INSERT INTO game.ranked_score (user_id, board_id, variant, value, meta, session_id, updated_at)
     VALUES ($1::uuid, 'coop_stage_clear_ms_v1', $2, $3, '{}'::jsonb, NULL, now())`,
    [user, boss, ms],
  );
  put(fast, '01-marina-bront', 91_000);
  put(slow, '01-marina-bront', 140_500);
  put(slow, '02-last-light-vela', 77_000);
  const marina = mod.call<Top>('leaderboard.top', hubCtx(slow), { boardId: 'coop_stage_clear_ms_v1', variant: '01-marina-bront' });
  assert.deepEqual(marina.rows.map((row) => [row.name, row.value, row.rank]), [['coop_fast', 91000, 1], ['coop_slow', 140500, 2]]);
  assert.equal(marina.me?.rank, 2);
  const vela = mod.call<Top>('leaderboard.top', hubCtx(fast), { boardId: 'coop_stage_clear_ms_v1', variant: '02-last-light-vela' });
  assert.deepEqual(vela.rows.map((row) => row.name), ['coop_slow']);
  assert.equal(vela.me, null);
  assert.equal(mod.call<Top>('leaderboard.top', hubCtx(fast), { boardId: 'coop_stage_clear_ms_v1' }).error, 'bad_variant');
  assert.equal(mod.call<Top>('leaderboard.top', hubCtx(fast), { boardId: 'coop_stage_clear_ms_v1', variant: "x' OR '1'='1" }).error, 'bad_variant');
  // A client cannot post a Coop clear.
  const sid = openGameSession(pg, fast, 'sproto-coop-battle');
  assert.equal(mod.call<Submit>('score.submit', gameCtx(fast, 'sproto-coop-battle', sid), { boardId: 'coop_stage_clear_ms_v1', value: 1 }).error, 'bad_board');
}

// Boards credit nothing.
assert.equal(count(pg, 'SELECT 1 FROM game.tickets_ledger') + count(pg, 'SELECT 1 FROM game.verse_ledger'), 0);
pg.audit();
console.log('pg boards ok');
