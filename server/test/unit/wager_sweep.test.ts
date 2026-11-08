// HUB-W-1-03: Fighter-duel wager escrow always has a refund path (plan R.3, R.9 step 5).
// - Boot: after HubSchema.apply, InitModule refunds every held wager
//   (game.sproto_wager_expire(interval '0')). Nakama is one node and no match
//   survives a restart, so nothing held at boot can still be live.
// - Periodic: hub shard loops call SprotoDuel.maybeSweepWagers, which runs
//   sproto_wager_expire(interval '1200 seconds') at most once per 5 minutes per node.
//   The age is MAX_PLAY (15 min) plus a 5 min margin, so loop lag cannot refund a live match
//   (the stake is held right before startedTick).
// - The lazy call in SprotoDuel.onMatched stays.
// The real refund SQL (idempotent, locked) runs against Postgres in server/test/dup/wagers.ts.
import assert from 'node:assert/strict';
import { loadModule, presence, type LoadedModule } from './harness';

const EXPIRE = /^SELECT game\.sproto_wager_expire\(/;

function expireCalls(mod: LoadedModule): { sql: string; args: unknown[] }[] {
  return mod.nk.sqlCalls.filter((c) => EXPIRE.test(c.sql));
}

interface Duel {
  maybeSweepWagers(nk: unknown, logger: unknown, nowMs: number): boolean;
  WAGER_SWEEP_EVERY_MS: number;
  WAGER_EXPIRE_AGE: string;
  MAX_PLAY_S: number;
  WAGER_EXPIRE_MARGIN_S: number;
}

const AGE = /interval '1200 seconds'/;

// Review fix: the sweep age is derived from MAX_PLAY plus a margin, never equal to it.
{
  const mod = loadModule();
  const Duel = mod.global.SprotoDuel as Duel;
  assert.equal(Duel.MAX_PLAY_S, 15 * 60, 'a duel runs at most 15 minutes');
  assert.ok(Duel.WAGER_EXPIRE_MARGIN_S >= 5 * 60, 'at least 5 minutes of margin for loop lag');
  assert.equal(Duel.WAGER_EXPIRE_AGE, String(Duel.MAX_PLAY_S + Duel.WAGER_EXPIRE_MARGIN_S) + ' seconds');
  assert.equal(Duel.WAGER_EXPIRE_AGE, '1200 seconds', '20 minutes');
}

// Boot: one full expiry after the schema is applied.
{
  const mod = loadModule({ sql: [[EXPIRE, [{ n: 2 }]]] });
  const calls = expireCalls(mod);
  assert.equal(calls.length, 1, 'InitModule expires held wagers once');
  assert.match(calls[0]!.sql, /sproto_wager_expire\(interval '0'\)/, 'boot refunds every held wager, whatever its age');
  const all = mod.nk.sqlCalls.map((c) => c.sql);
  const expireAt = all.findIndex((s) => EXPIRE.test(s));
  const lastSchema = all.reduce((at, s, i) => (/schema_migration|CREATE (TABLE|OR REPLACE FUNCTION|INDEX)/i.test(s) ? i : at), -1);
  assert.ok(lastSchema >= 0, 'HubSchema.apply ran');
  assert.ok(expireAt > lastSchema, 'the boot sweep runs after HubSchema.apply');
  assert.ok(mod.logger.lines.some((l) => l.level === 'info' && /wager/.test(l.message) && /2/.test(l.message)), 'the boot sweep logs the refund count');
  assert.ok(mod.registered.matches.has('hub'), 'InitModule finished');
}

// Boot: a failing sweep is logged and does not stop the runtime from starting.
{
  const mod = loadModule({ sql: [[EXPIRE, () => { throw new Error('db down'); }]] });
  assert.ok(mod.registered.rpcs.has('profile.get'), 'registrations still happen');
  assert.ok(mod.nk.matches.size >= 1, 'plaza shard 1 still starts');
  assert.ok(mod.logger.lines.some((l) => l.level === 'error' && /wager/.test(l.message)), 'the failure is logged');
}

// Periodic sweep: 20 minutes old, at most once per 5 minutes on this node.
{
  const mod = loadModule();
  const Duel = mod.global.SprotoDuel as Duel;
  assert.equal(Duel.WAGER_SWEEP_EVERY_MS, 5 * 60 * 1000);
  const boot = expireCalls(mod).length;
  const t0 = Date.now();
  assert.equal(Duel.maybeSweepWagers(mod.nk, mod.logger, t0), false, 'the boot sweep counts as the first window');
  assert.equal(expireCalls(mod).length, boot);
  assert.equal(Duel.maybeSweepWagers(mod.nk, mod.logger, t0 + 5 * 60 * 1000 + 1), true);
  const after = expireCalls(mod);
  assert.equal(after.length, boot + 1);
  assert.match(after.at(-1)!.sql, /sproto_wager_expire\(interval '1200 seconds'\)/);
  assert.equal(Duel.maybeSweepWagers(mod.nk, mod.logger, t0 + 5 * 60 * 1000 + 2), false, 'rate-limited');
  assert.equal(Duel.maybeSweepWagers(mod.nk, mod.logger, t0 + 9 * 60 * 1000), false, 'still inside the window');
  assert.equal(expireCalls(mod).length, boot + 1);
  assert.equal(Duel.maybeSweepWagers(mod.nk, mod.logger, t0 + 10 * 60 * 1000 + 2), true, 'next window');
  assert.equal(expireCalls(mod).length, boot + 2);
}

// Periodic sweep with no stamp (localcache cleared): stamps and waits one window.
{
  const mod = loadModule();
  const Duel = mod.global.SprotoDuel as Duel;
  mod.nk.localcache.clear();
  const boot = expireCalls(mod).length;
  const t0 = Date.now();
  assert.equal(Duel.maybeSweepWagers(mod.nk, mod.logger, t0), false);
  assert.equal(Duel.maybeSweepWagers(mod.nk, mod.logger, t0 + 5 * 60 * 1000 + 1), true);
  assert.equal(expireCalls(mod).length, boot + 1);
}

// The always-on plaza shard loop drives the sweep, and a sweep error does not stop the loop.
{
  const mod = loadModule();
  const shard = [...mod.nk.matches.values()].find((m) => m.module === 'hub');
  assert.ok(shard, 'plaza shard 1 exists');
  const m = mod.driver(shard!.matchId);
  const boot = expireCalls(mod).length;
  assert.equal(m.loop([]), true);
  assert.equal(expireCalls(mod).length, boot, 'inside the window the loop does not sweep');
  for (const key of [...mod.nk.localcache.keys()]) if (/wager/.test(key)) mod.nk.localcache.set(key, Date.now() - 6 * 60 * 1000);
  assert.equal(m.loop([]), true);
  assert.equal(expireCalls(mod).length, boot + 1, 'a stale stamp makes the shard loop sweep');
  assert.match(expireCalls(mod).at(-1)!.sql, AGE);
  assert.equal(m.loop([]), true);
  assert.equal(expireCalls(mod).length, boot + 1, 'one sweep per window');
  mod.nk.onSql(EXPIRE, () => { throw new Error('db down'); });
  for (const key of [...mod.nk.localcache.keys()]) if (/wager/.test(key)) mod.nk.localcache.set(key, Date.now() - 6 * 60 * 1000);
  assert.equal(m.loop([]), true, 'a failed sweep is caught; the shard keeps running');
  assert.ok(mod.logger.lines.some((l) => l.level === 'warn' && /wager/.test(l.message)));
}

// The lazy expiry on a new Fighter pair stays.
{
  const mod = loadModule();
  const sim = String(mod.global.SPROTO_SIM_VERSION ?? '');
  const boot = expireCalls(mod).length;
  const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const id = mod.matchmake([
    { presence: presence(A), properties: { game: 'sproto-fighter', wager: '1', sim } },
    { presence: presence(B), properties: { game: 'sproto-fighter', wager: '1', sim } },
  ]);
  assert.ok(id);
  assert.equal(expireCalls(mod).length, boot + 1);
  assert.match(expireCalls(mod).at(-1)!.sql, AGE);
}

console.log('wager sweep tests ok');
