// HUB-W-1-04: game.server_flags (migration 0042_server_flags) and Flags.on.
// Launch work merges dark behind these flags (plan R.12.2). Nothing reads them yet.
// - off: nobody. on: everybody (even with no user id).
// - allowlist: user ids in allowlist only.
// - percent: users whose stable bucket (FNV-1a of "<key>:<userId>", 0..99) is below
//   percent, plus allowlist members, so testers keep access while the rollout widens.
// - Unknown key, missing row, bad state or a failed read: off (fail closed).
// - One row read per key per FLAG_CACHE_MS on the node (localcache); errors are not cached.
// The SQL runs against Postgres in server/test/dup/migrations.ts.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadModule, plain, type LoadedModule } from './harness';

const LAUNCH = ['shooter_pvp', 'shooter_pvp_wager', 'shooter_pvp_ranked', 'hub_exchange', 'verse_store', 'relic_unhold', 'diagnostics_prompt', 'maint'];
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';

interface FlagsNs {
  on(nk: unknown, key: string, userId: string, nowMs?: number, logger?: unknown): boolean;
  bucket(key: string, userId: string): number;
  LAUNCH_FLAGS: string[];
  FLAG_CACHE_MS: number;
}

interface Row { state: string; allowlist?: string[]; percent?: number }

function withFlags(rows: Record<string, Row>): { mod: LoadedModule; Flags: FlagsNs; reads: () => number } {
  const mod = loadModule();
  let n = 0;
  mod.nk.onSql('FROM game.server_flags', (args) => {
    n += 1;
    const row = rows[String(args[0])];
    if (!row) return [];
    return [{ result: JSON.stringify({ state: row.state, allowlist: row.allowlist ?? [], percent: row.percent ?? 0 }) }];
  });
  return { mod, Flags: mod.global.Flags as FlagsNs, reads: () => n };
}

// Migration: next free id after 0041 (0036 and 0038 stay unused), table checks, every launch flag seeded off.
{
  const mod = loadModule();
  const HubSchema = mod.global.HubSchema as { all(): { id: string; statements: string[] }[] };
  const all = HubSchema.all();
  const ids = all.map((m) => m.id);
  assert.equal(ids.at(-1), '0042_server_flags', 'server_flags is the newest migration');
  assert.ok(!ids.some((id) => /^003[68]_/.test(id)), '0036 and 0038 stay unregistered');
  const sql = all.find((m) => m.id === '0042_server_flags')!.statements.join('\n');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS game\.server_flags/);
  assert.match(sql, /key text PRIMARY KEY/);
  assert.match(sql, /state IN \('off', 'allowlist', 'percent', 'on'\)/);
  assert.match(sql, /allowlist uuid\[\] NOT NULL DEFAULT '\{\}'/);
  assert.match(sql, /percent integer NOT NULL DEFAULT 0/);
  assert.match(sql, /percent BETWEEN 0 AND 100/);
  assert.match(sql, /updated_at timestamptz NOT NULL DEFAULT now\(\)/);
  assert.match(sql, /ON CONFLICT \(key\) DO NOTHING/, 'a replay keeps flags the owner already changed');
  for (const key of LAUNCH) assert.match(sql, new RegExp(`\\('${key}', 'off'\\)`), `${key} seeded off`);
  assert.deepEqual(plain((mod.global.Flags as FlagsNs).LAUNCH_FLAGS), LAUNCH);
}

// off / on / missing row / unknown state.
{
  const { Flags, mod } = withFlags({ maint: { state: 'off' }, verse_store: { state: 'on' }, hub_exchange: { state: 'sideways' } });
  assert.equal(Flags.on(mod.nk, 'maint', U1), false);
  assert.equal(Flags.on(mod.nk, 'verse_store', U1), true);
  assert.equal(Flags.on(mod.nk, 'verse_store', ''), true, 'on needs no user');
  assert.equal(Flags.on(mod.nk, 'relic_unhold', U1), false, 'missing row is off');
  assert.equal(Flags.on(mod.nk, 'hub_exchange', U1), false, 'unknown state is off');
  assert.equal(Flags.on(mod.nk, 'Bad Key!', U1), false, 'malformed key is off');
  assert.equal(Flags.on(mod.nk, '', U1), false);
}

// allowlist.
{
  const { Flags, mod } = withFlags({ shooter_pvp: { state: 'allowlist', allowlist: [U1.toUpperCase()] } });
  assert.equal(Flags.on(mod.nk, 'shooter_pvp', U1), true, 'allowlist match ignores uuid case');
  assert.equal(Flags.on(mod.nk, 'shooter_pvp', U2), false);
  assert.equal(Flags.on(mod.nk, 'shooter_pvp', ''), false);
}

// percent: stable buckets, about the right share, 0 and 100 exact, allowlist still in.
{
  const users = Array.from({ length: 4000 }, () => randomUUID());
  const { Flags, mod } = withFlags({
    shooter_pvp: { state: 'percent', percent: 25 },
    shooter_pvp_ranked: { state: 'percent', percent: 25 },
    hub_exchange: { state: 'percent', percent: 0, allowlist: [U1] },
    verse_store: { state: 'percent', percent: 100 },
  });
  for (const u of users.slice(0, 50)) {
    const b = Flags.bucket('shooter_pvp', u);
    assert.ok(Number.isInteger(b) && b >= 0 && b < 100, `bucket ${b}`);
    assert.equal(Flags.bucket('shooter_pvp', u), b, 'bucket is stable');
    assert.equal(Flags.on(mod.nk, 'shooter_pvp', u), b < 25);
  }
  const share = users.filter((u) => Flags.on(mod.nk, 'shooter_pvp', u)).length / users.length;
  assert.ok(share > 0.21 && share < 0.29, `25% flag admitted ${(share * 100).toFixed(1)}%`);
  const both = users.filter((u) => Flags.on(mod.nk, 'shooter_pvp', u) && Flags.on(mod.nk, 'shooter_pvp_ranked', u)).length / users.length;
  assert.ok(both < 0.12, `buckets are per key, not one cohort for every flag (${(both * 100).toFixed(1)}% in both)`);
  assert.equal(users.some((u) => Flags.on(mod.nk, 'hub_exchange', u)), false, '0% admits nobody');
  assert.equal(Flags.on(mod.nk, 'hub_exchange', U1), true, 'allowlist members stay in at any percent');
  assert.equal(users.every((u) => Flags.on(mod.nk, 'verse_store', u)), true, '100% admits everybody');
  assert.equal(Flags.on(mod.nk, 'verse_store', ''), false, 'percent needs a user id');
}

// Cache: one read per key per window; a failed read is off and is not cached.
{
  const { Flags, mod, reads } = withFlags({ maint: { state: 'on' }, verse_store: { state: 'off' } });
  assert.ok(Flags.FLAG_CACHE_MS > 0 && Flags.FLAG_CACHE_MS <= 10_000, 'short cache');
  const t0 = 1_000_000;
  assert.equal(Flags.on(mod.nk, 'maint', U1, t0), true);
  assert.equal(Flags.on(mod.nk, 'maint', U2, t0 + 1), true);
  assert.equal(Flags.on(mod.nk, 'verse_store', U1, t0 + 2), false);
  assert.equal(reads(), 2, 'one read per key inside the window');
  assert.equal(Flags.on(mod.nk, 'maint', U1, t0 + Flags.FLAG_CACHE_MS + 1), true);
  assert.equal(reads(), 3, 'the row is read again after the window');

  const broken = loadModule();
  let calls = 0;
  broken.nk.onSql('FROM game.server_flags', () => {
    calls += 1;
    throw new Error('db down');
  });
  const F = broken.global.Flags as FlagsNs;
  assert.equal(F.on(broken.nk, 'maint', U1, t0, broken.logger), false, 'read error fails closed');
  assert.equal(F.on(broken.nk, 'maint', U1, t0 + 1), false);
  assert.equal(calls, 2, 'errors are not cached');
  assert.ok(broken.logger.lines.some((l) => l.level === 'warn' && /flag/.test(l.message)));
}

// Flags are read-only here: nothing in the module writes game.server_flags.
{
  const mod = loadModule();
  assert.ok(!/(INSERT INTO|UPDATE|DELETE FROM) game\.server_flags/.test(mod.source.replace(/0042_server_flags[\s\S]*?ON CONFLICT \(key\) DO NOTHING/, '')), 'no runtime writes to server_flags');
}

console.log('flags tests ok');
