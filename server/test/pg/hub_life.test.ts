// E3 and E4 on a real Postgres: who counts as "playing", and who is a champion, in what order.
import assert from 'node:assert/strict';
import { addUser, freshPg, hubCtx, openGameSession, type Pg } from './rig';

const pg = freshPg('hub_life');
const { mod } = pg;
const viewer = addUser(pg, 'viewer');
const fresh = () => { mod.nk.localcache.clear(); };

interface Presence { counts: Record<string, number> }
interface Champions { champions: { order: number; userId: string; name: string }[] }
const presence = () => { fresh(); return mod.call<Presence>('hub.presence', hubCtx(viewer), {}).counts; };

// Presence: open, redeemed, recent sessions; one per account; closed, stale and unredeemed do not count.
{
  assert.ok(Object.values(presence()).every((n) => n === 0));
  const a = addUser(pg, 'in_nobu_a');
  const b = addUser(pg, 'in_nobu_b');
  const c = addUser(pg, 'in_coop');
  openGameSession(pg, a, 'nobu');
  openGameSession(pg, b, 'nobu');
  openGameSession(pg, c, 'sproto-coop-battle');
  let now = presence();
  assert.deepEqual([now.nobu, now['sproto-coop-battle'], now.sproto], [2, 1, 0]);

  // Entering another game closes the earlier session: the account moves, it is not counted twice.
  openGameSession(pg, a, 'sproto');
  now = presence();
  assert.deepEqual([now.nobu, now.sproto], [1, 1]);

  // Redeemed more than 30 minutes ago, never redeemed, lease over, or closed: not counted.
  const stale = addUser(pg, 'stale');
  const staleSid = openGameSession(pg, stale, 'hpos10i');
  pg.run("UPDATE game.game_session SET ticket_redeemed_at = now() - interval '31 minutes' WHERE session_id = $1::uuid", [staleSid]);
  const unredeemed = addUser(pg, 'unredeemed');
  const unSid = openGameSession(pg, unredeemed, 'hpos10i');
  pg.run('UPDATE game.game_session SET ticket_redeemed_at = NULL WHERE session_id = $1::uuid', [unSid]);
  const expired = addUser(pg, 'expired');
  const exSid = openGameSession(pg, expired, 'hpos10i');
  pg.run("UPDATE game.game_session SET lease_until = now() - interval '1 second' WHERE session_id = $1::uuid", [exSid]);
  assert.equal(presence().hpos10i, 0);
  pg.run("UPDATE game.game_session SET state = 'closed' WHERE user_id = $1::uuid", [c]);
  assert.equal(presence()['sproto-coop-battle'], 0);
}

// Champions: all four Four Lights Relics, ordered by the fourth claim; the later four never qualify.
function claim(db: Pg, user: string, relic: string, at: string): void {
  db.run(
    `WITH ev AS (SELECT gen_random_uuid() AS id)
     , c AS (INSERT INTO game.relic_claim (user_id, relic_id, session_id, event_id, claimed_at)
             SELECT $1::uuid, $2, gen_random_uuid(), id, $3::timestamptz FROM ev)
     INSERT INTO game.item_ledger (event_id, user_id, op, item_id, source, ref_id)
     SELECT id, $1::uuid, 'grant_relic', $2, 'test', gen_random_uuid() FROM ev`,
    [user, relic, at],
  );
}
{
  const FOUR = ['hpos10i_core', 'genesis_shard', 'cones_tip', 'tinubu_crown'];
  const champions = () => { fresh(); return mod.call<Champions>('hub.champions', hubCtx(viewer), {}).champions; };
  assert.deepEqual(champions(), []);
  const early = addUser(pg, 'early_bird');
  const late = addUser(pg, 'late_finisher');
  const three = addUser(pg, 'three_lights');
  const others = addUser(pg, 'other_relics');
  // early collected three first but finished last; late finished first.
  FOUR.slice(0, 3).forEach((relic, i) => claim(pg, early, relic, `2026-01-0${i + 1}T00:00:00Z`));
  FOUR.forEach((relic, i) => claim(pg, late, relic, `2026-02-0${i + 1}T00:00:00Z`));
  claim(pg, early, 'tinubu_crown', '2026-03-01T00:00:00Z');
  FOUR.slice(0, 3).forEach((relic, i) => claim(pg, three, relic, `2026-01-1${i}T00:00:00Z`));
  ['tidebreaker_belt', 'breakwater_coin', 'marina_anchor', 'dragon_scale'].forEach((relic, i) => claim(pg, others, relic, `2026-01-2${i}T00:00:00Z`));
  const list = champions();
  assert.deepEqual(list.map((row) => [row.order, row.name]), [[1, 'late_finisher'], [2, 'early_bird']]);
  assert.equal(list[0]!.userId, late);
  // After B3 an account whose pending Shard was promoted completes the four: it appears within one reload.
  claim(pg, three, 'tinubu_crown', '2026-04-01T00:00:00Z');
  assert.deepEqual(champions().map((row) => row.name), ['late_finisher', 'early_bird', 'three_lights']);
  // Capped at 50.
  for (let i = 0; i < 52; i += 1) {
    const user = addUser(pg, `crowd_${String(i).padStart(2, '0')}`);
    FOUR.forEach((relic) => claim(pg, user, relic, '2026-05-01T00:00:00Z'));
  }
  const capped = champions();
  assert.equal(capped.length, 50);
  assert.deepEqual(capped.slice(0, 3).map((row) => row.name), ['late_finisher', 'early_bird', 'three_lights']);
  assert.deepEqual(capped.map((row) => row.order), Array.from({ length: 50 }, (_, i) => i + 1));
}
pg.audit();
console.log('pg hub life ok');
