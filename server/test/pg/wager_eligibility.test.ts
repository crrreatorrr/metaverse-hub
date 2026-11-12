// Fighter wager eligibility on a real Postgres. 0010 required CPU wins, counted as `fighter_win`
// rows in tickets_ledger. 0031 zeroed that reason and the Fighter client now reports
// `fighter.boss_defeated`, so nobody can earn a `fighter_win` row any more. 0032 already removed
// the count: any signed-in, non-guest pair may wager. These cases pin that, so players whose only
// Fighter Tickets come from story bosses are not locked out by the old rule coming back.
import assert from 'node:assert/strict';
import { addUser, count, freshPg, gameCtx, openGameSession, tickets } from './rig';

const pg = freshPg('wager_eligibility');
const { mod } = pg;
const GAME = 'sproto-fighter';

interface Hold { error?: string; status?: string; stake?: number; wagerId?: string; user?: string; needed?: number }
const hold = (match: string, a: string, b: string): Hold =>
  JSON.parse(String(pg.run('SELECT game.sproto_wager_hold($1, $2::uuid, $3::uuid, 10, 5, 200)::text AS r', [match, a, b])[0]?.r)) as Hold;

// The live function: one overload, six arguments, no CPU-win count.
const overloads = pg.run("SELECT pg_get_function_identity_arguments(p.oid) AS args, pg_get_functiondef(p.oid) AS src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'game' AND p.proname = 'sproto_wager_hold'");
assert.equal(overloads.length, 1);
assert.equal(overloads[0]?.args, 'p_match_id text, p_a uuid, p_b uuid, p_stake bigint, p_pair_limit integer, p_daily_cap bigint');
const src = String(overloads[0]?.src);
for (const gone of ['fighter_win', 'p_min_cpu_wins', 'not_eligible']) assert.equal(src.includes(gone), false, `${gone} is not part of the live rule`);
assert.ok(src.includes('wager_guest'));

function account(name: string): string {
  const id = addUser(pg, name);
  pg.run('UPDATE users SET email = $2 WHERE id = $1::uuid', [id, `${name}@example.test`]);
  return id;
}

// Two signed-in players who earned their Tickets the only way Fighter pays now: one story boss each.
const a = account('boss_winner_a');
const b = account('boss_winner_b');
for (const user of [a, b]) {
  const sid = openGameSession(pg, user, GAME);
  const paid = mod.call<{ tickets?: number }>('session.event', gameCtx(user, GAME, sid), { eventId: 'fighter.boss_defeated', data: { boss: 'rivet', world: 1, stage: 3 }, key: `rivet-${user}` });
  assert.equal(paid.tickets, 20);
  assert.equal(tickets(pg, user, GAME), 20);
  assert.equal(count(pg, "SELECT 1 FROM game.tickets_ledger WHERE user_id = $1::uuid AND reason = 'fighter_win'", [user]), 0, 'no fighter_win row exists for this account');
  // The old qualifying earn is refused, so the old rule could never be met.
  assert.equal(mod.call<{ error?: string }>('tickets.earn', gameCtx(user, GAME, sid), { amount: 20, reason: 'fighter_win', key: `fw-${user}` }).error, 'amount_over_rule');
}
const held = hold('match-boss-funded', a, b);
assert.deepEqual([held.error, held.status, held.stake], [undefined, 'held', 10]);
assert.deepEqual([tickets(pg, a, GAME), tickets(pg, b, GAME)], [10, 10]);
assert.deepEqual(hold('match-boss-funded', a, b).wagerId, held.wagerId, 'the same match holds once');
const settled = JSON.parse(String(pg.run("SELECT game.sproto_wager_settle('match-boss-funded', $1::uuid, 'ko')::text AS r", [a])[0]?.r)) as { status?: string; payout?: number };
assert.deepEqual([settled.status, settled.payout], ['settled', 20]);
assert.deepEqual([tickets(pg, a, GAME), tickets(pg, b, GAME)], [30, 10]);

// What still bounds a wager: guests, the stake itself, the pair limit.
const visitor = addUser(pg, 'guest_visitor');
assert.equal(hold('match-guest', a, visitor).error, 'wager_guest');
const broke = account('no_tickets');
const poor = hold('match-broke', a, broke);
assert.deepEqual([poor.error, poor.user], ['insufficient_tickets', broke]);
assert.equal(tickets(pg, a, GAME), 30, 'a refused hold takes nothing');
assert.equal(count(pg, 'SELECT 1 FROM game.sproto_wager'), 1);

pg.audit();
console.log('pg wager eligibility ok');
