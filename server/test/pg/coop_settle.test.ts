// 0063_coop_settle_fingerprint on a real Postgres: game.settle_coop_clear labels receipts with the
// vendored Coop sim's content fingerprint. Clears settled under the 0041 label keep their Tickets,
// receipt and stored answer through the migration, and the rules that bound the payout do not move.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { addUser, count, freshPg, openGameSession, tickets } from './rig';

const pg = freshPg('coop_settle');
const { mod } = pg;

const GAME = 'sproto-coop-battle';
const CoopRewards = mod.global.CoopRewards as { FINGERPRINT: string; FINGERPRINT_0041: string; BOSSES: string[] };
const CoopProto = mod.global.CoopProto as { FINGERPRINT: string };
const NEW = CoopRewards.FINGERPRINT;
const OLD = CoopRewards.FINGERPRINT_0041;
const pin = JSON.parse(readFileSync(fileURLToPath(new URL('../../modules/vendor/coop-sim.pin.json', import.meta.url)), 'utf8')) as { contentSha256: string };
assert.equal(NEW, CoopProto.FINGERPRINT);
assert.equal(NEW, pin.contentSha256);
assert.notEqual(NEW, OLD);

interface Settled { ok?: boolean; paid?: boolean; tickets?: number; reason?: string; fingerprint?: string; balance?: number; error?: string }

function settle(user: string, sid: string, boss: string, match: string, enc: string, fingerprint: string, eligible = 1, reason = 'clear'): Settled {
  const row = pg.run(
    `SELECT game.settle_coop_clear($1::uuid, $2::uuid, $3::text, $4::text, $5::text, (now() AT TIME ZONE 'utc')::date,
       1200::bigint, 20000::bigint, $6::smallint, $7::text, 1, 1, $8::text, 'cpu_assisted'::text, $9::text)::text AS result`,
    [user, sid, match, enc, boss, eligible, reason, fingerprint, 'ab'.repeat(32)],
  )[0];
  return JSON.parse(String(row?.result)) as Settled;
}

const functionBody = () => String(pg.run("SELECT pg_get_functiondef(p.oid) AS src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'game' AND p.proname = 'settle_coop_clear'")[0]?.src);
const stored = (user: string, boss: string) => pg.run('SELECT fingerprint, tickets, response::text AS response FROM game.coop_receipt WHERE user_id = $1::uuid AND canonical_boss = $2', [user, boss])[0];
const boardLabel = (user: string, boss: string) => pg.run("SELECT meta->>'fingerprint' AS fp FROM game.ranked_score WHERE user_id = $1::uuid AND board_id = 'coop_stage_clear_ms_v1' AND variant = $2", [user, boss])[0]?.fp;

const [B1, B2, B3] = CoopRewards.BOSSES as [string, string, string];

// A fresh database (0041 then 0063) has one function and only the new label in it.
assert.equal(count(pg, "SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'game' AND p.proname = 'settle_coop_clear'"), 1);
assert.equal(functionBody().includes(OLD), false);
assert.equal(functionBody().split(NEW).length - 1, 5, 'the check and the four labels');

// Put the function back to its 0041 body, as a database is before this deploy, and settle there.
pg.run(`DO $old$ DECLARE src text; BEGIN
  src := pg_get_functiondef('game.settle_coop_clear(uuid,uuid,text,text,text,date,bigint,bigint,smallint,text,integer,integer,text,text,text)'::regprocedure);
  EXECUTE replace(src, '${NEW}', '${OLD}');
END $old$`);
const veteran = addUser(pg, 'coop_veteran');
const sid = openGameSession(pg, veteran, GAME);
const before = settle(veteran, sid, B1, 'room-old', 'enc-old', OLD);
assert.deepEqual([before.paid, before.tickets, before.fingerprint, before.balance], [true, 20, OLD, 20]);
const zeroBefore = settle(veteran, sid, B2, 'room-old-out', 'enc-old-out', OLD, 0, 'knocked_out');
assert.deepEqual([zeroBefore.paid, zeroBefore.tickets, zeroBefore.reason], [false, 0, 'knocked_out']);
assert.equal(tickets(pg, veteran, GAME), 20);
const receiptBefore = stored(veteran, B1);
const ledgerBefore = pg.run('SELECT event_id, delta, balance_after, reason, kind FROM game.tickets_ledger WHERE user_id = $1::uuid ORDER BY created_at, event_id', [veteran]);
const eligibilityBefore = pg.run('SELECT match_id, encounter_id, eligible, reason, fingerprint, response::text AS response FROM game.coop_eligibility WHERE user_id = $1::uuid ORDER BY match_id', [veteran]);

// Deploy: the runner applies 0063 (its row is not recorded yet in the pre-deploy state).
pg.run("DELETE FROM game.schema_migrations WHERE id >= '0063_coop_settle_fingerprint'");
const booted = pg.reload();
assert.deepEqual(booted.logger.lines.filter((line) => line.level === 'error'), []);
assert.equal(count(pg, "SELECT 1 FROM game.schema_migrations WHERE id = '0063_coop_settle_fingerprint'"), 1);
assert.equal(functionBody().includes(OLD), false);
assert.equal(functionBody().split(NEW).length - 1, 5);

// Nothing already settled moved: balance, ledger, receipt (old label kept) and eligibility rows.
assert.equal(tickets(pg, veteran, GAME), 20);
assert.deepEqual(stored(veteran, B1), receiptBefore);
assert.equal(receiptBefore?.fingerprint, OLD);
assert.deepEqual(pg.run('SELECT event_id, delta, balance_after, reason, kind FROM game.tickets_ledger WHERE user_id = $1::uuid ORDER BY created_at, event_id', [veteran]), ledgerBefore);
assert.deepEqual(pg.run('SELECT match_id, encounter_id, eligible, reason, fingerprint, response::text AS response FROM game.coop_eligibility WHERE user_id = $1::uuid ORDER BY match_id', [veteran]), eligibilityBefore);
assert.equal(boardLabel(veteran, B1), OLD, 'the board row keeps the label of the run that set it');

// A retry of the old settlement returns the stored answer whichever label the caller sends, and pays nothing more.
assert.deepEqual(settle(veteran, sid, B1, 'room-old', 'enc-old', NEW), before);
assert.deepEqual(settle(veteran, sid, B1, 'room-old', 'enc-old', OLD), before);
assert.deepEqual(settle(veteran, sid, B2, 'room-old-out', 'enc-old-out', NEW), zeroBefore, 'a sealed zero stays sealed');
// The same boss on the same day in another match is still already_paid: the day rule ignores the label.
const sameDay = settle(veteran, sid, B1, 'room-new', 'enc-new', NEW);
assert.deepEqual([sameDay.paid, sameDay.tickets, sameDay.reason], [false, 0, 'already_paid']);
assert.equal(tickets(pg, veteran, GAME), 20);
assert.equal(count(pg, 'SELECT 1 FROM game.coop_receipt WHERE user_id = $1::uuid', [veteran]), 1);

// A new clear is paid the same 20 and carries the vendored label everywhere it is written.
const after = settle(veteran, sid, B3, 'room-new', 'enc-new-3', NEW);
assert.deepEqual([after.paid, after.tickets, after.fingerprint, after.balance], [true, 20, NEW, 40]);
assert.equal(stored(veteran, B3)?.fingerprint, NEW);
assert.equal(boardLabel(veteran, B3), NEW);
assert.equal(pg.run("SELECT fingerprint FROM game.coop_eligibility WHERE user_id = $1::uuid AND encounter_id = 'enc-new-3'", [veteran])[0]?.fingerprint, NEW);
// The next UTC day pays the old-label boss again, under the new label.
pg.run("UPDATE game.earn_window SET day = day - 1 WHERE user_id = $1::uuid", [veteran]);
pg.run("UPDATE game.coop_receipt SET day = day - 1 WHERE user_id = $1::uuid", [veteran]);
const nextDay = settle(veteran, sid, B1, 'room-day2', 'enc-day2', NEW);
assert.deepEqual([nextDay.paid, nextDay.tickets, nextDay.fingerprint], [true, 20, NEW]);
assert.equal(tickets(pg, veteran, GAME), 60);

// A caller still sending the 0041 label is refused: sealed, nothing paid, and it stays sealed.
const fresh = addUser(pg, 'coop_stale_caller');
const freshSid = openGameSession(pg, fresh, GAME);
const stale = settle(fresh, freshSid, B1, 'room-stale', 'enc-stale', OLD);
assert.deepEqual([stale.paid, stale.tickets, stale.reason], [false, 0, 'bad_version']);
assert.deepEqual(settle(fresh, freshSid, B1, 'room-stale', 'enc-stale', NEW), stale);
assert.equal(tickets(pg, fresh, GAME), 0);
assert.equal(count(pg, 'SELECT 1 FROM game.coop_receipt WHERE user_id = $1::uuid', [fresh]), 0);

// The module itself sends the vendored label: CoopRewards.settle pays through the real function.
const viaModule = (mod.global.CoopRewards as unknown as { settle(...args: unknown[]): Settled })
  .settle(mod.nk, fresh, freshSid, 'room-module', 'enc-module', B2, String(pg.run("SELECT to_char((now() AT TIME ZONE 'utc')::date, 'YYYY-MM-DD') AS day")[0]?.day), 1200, 20000, true, 'clear', 2, 'cpu_assisted', 'cd'.repeat(32));
assert.deepEqual([viaModule.paid, viaModule.tickets, viaModule.fingerprint], [true, 20, NEW]);
assert.equal(tickets(pg, fresh, GAME), 20);

// Applying 0063 again changes nothing.
pg.run("DELETE FROM game.schema_migrations WHERE id >= '0063_coop_settle_fingerprint'");
const bodyBefore = functionBody();
assert.deepEqual(pg.reload().logger.lines.filter((line) => line.level === 'error'), []);
assert.equal(functionBody(), bodyBefore);

pg.audit();
console.log('pg coop settle fingerprint ok');
