// B4 and E5 on a real Postgres: an unranked HPOS10I session posts its act time, sproto still needs
// a ranked session, god mode posts nothing, and the Coop clear board reads per boss.
import assert from 'node:assert/strict';
import { addUser, count, freshPg, gameCtx, hubCtx, openGameSession } from './rig';

const pg = freshPg('boards');
const { mod } = pg;

interface Submit { accepted?: boolean; posted?: boolean; value?: number; reason?: string; error?: string }
interface Top { rows: { userId: string; name: string; value: number; rank: number }[]; me: { value: number; rank: number } | null; variant: string; error?: string }

const scoreOf = (user: string, board: string, variant = '') =>
  pg.run('SELECT value FROM game.ranked_score WHERE user_id = $1::uuid AND board_id = $2 AND variant = $3', [user, board, variant])[0]?.value ?? null;

// HPOS10I: a normal (unranked) hub-entered session posts; the best (lowest) time is kept.
{
  const user = addUser(pg, 'hpos_runner');
  const sid = openGameSession(pg, user, 'hpos10i');
  const ctx = gameCtx(user, 'hpos10i', sid);
  const first = mod.call<Submit>('score.submit', ctx, { boardId: 'hpos10i_act_time', value: 61.4, meta: { zone: 'z1_retro_rush_hills', act: 1 } });
  assert.deepEqual([first.accepted, first.posted, first.value], [true, true, 61], JSON.stringify(first));
  assert.equal(scoreOf(user, 'hpos10i_act_time'), '61');
  mod.nk.localcache.clear();
  const slower = mod.call<Submit>('score.submit', ctx, { boardId: 'hpos10i_act_time', value: 80 });
  assert.equal(slower.accepted, true);
  assert.equal(scoreOf(user, 'hpos10i_act_time'), '61', 'a slower time does not replace the best');
  mod.nk.localcache.clear();
  const god = mod.call<Submit>('score.submit', ctx, { boardId: 'hpos10i_act_time', value: 5, godMode: true });
  assert.deepEqual([god.accepted, god.reason], [false, 'god_mode']);
  assert.equal(scoreOf(user, 'hpos10i_act_time'), '61', 'god mode posts nothing');
  // The board is HPOS10I's: another game's session cannot post to it.
  const other = addUser(pg, 'nobu_player');
  const nobuSid = openGameSession(pg, other, 'nobu');
  assert.equal(mod.call<Submit>('score.submit', gameCtx(other, 'nobu', nobuSid), { boardId: 'hpos10i_act_time', value: 1 }).error, 'bad_board');
  // A closed session cannot post.
  pg.run("UPDATE game.game_session SET state = 'closed' WHERE session_id = $1::uuid", [sid]);
  mod.nk.localcache.clear();
  assert.equal(mod.call<Submit>('score.submit', ctx, { boardId: 'hpos10i_act_time', value: 30 }).error, 'session_closed');
  assert.equal(scoreOf(user, 'hpos10i_act_time'), '61');

  const top = mod.call<Top>('leaderboard.top', hubCtx(user), { boardId: 'hpos10i_act_time' });
  assert.equal(top.rows.length, 1);
  assert.deepEqual([top.rows[0]!.userId, top.rows[0]!.value, top.rows[0]!.rank], [user, 61, 1]);
  assert.equal(top.me?.value, 61);
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
