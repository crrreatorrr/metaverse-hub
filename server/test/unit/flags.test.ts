// HUB-W-1-04: game.server_flags (migration 0042_server_flags) and Flags.on.
// Launch work merges dark behind these flags (plan R.12.2). 0062 turns hub_exchange on.
// - off: nobody. on: everybody (even with no user id).
// - allowlist: user ids in allowlist only.
// - percent: users whose stable bucket (FNV-1a of "<key>:<userId>", 0..99) is below
//   percent, plus allowlist members, so testers keep access while the rollout widens.
// - Unknown key, missing row or bad state: off. A failed read returns the caller's
//   onReadError (default false). Readers of `maint` pass { onReadError: true }.
// - Cohorts are independent per key: a nested rollout (wager inside pvp) gates on both flags.
// - One row read per key per FLAG_CACHE_MS on the node (localcache); errors are not cached.
// The SQL runs against Postgres in server/test/dup/migrations.ts.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadModule, plain, type LoadedModule } from './harness';

// 0042 also seeded relic_unhold. Nothing reads it: 0061_relic_unhold releases unconditionally.
const LAUNCH = ['shooter_pvp', 'shooter_pvp_wager', 'shooter_pvp_ranked', 'hub_exchange', 'verse_store', 'diagnostics_prompt', 'maint'];
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';

interface FlagsNs {
  on(nk: unknown, key: string, userId: string, logger?: unknown, opts?: { onReadError?: boolean }): boolean;
  _setClockForTest(now: (() => number) | null): void;
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

// Migration 0042 is registered once, with the table checks and every launch flag seeded off.
{
  const mod = loadModule();
  const HubSchema = mod.global.HubSchema as { all(): { id: string; statements: string[] }[] };
  const all = HubSchema.all();
  const ids = all.map((m) => m.id);
  assert.equal(ids.filter((id) => id === '0042_server_flags').length, 1, '0042_server_flags is registered once');
  const sql = all.find((m) => m.id === '0042_server_flags')!.statements.join('\n');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS game\.server_flags/);
  assert.match(sql, /key text PRIMARY KEY/);
  assert.match(sql, /state IN \('off', 'allowlist', 'percent', 'on'\)/);
  assert.match(sql, /allowlist uuid\[\] NOT NULL DEFAULT '\{\}'/);
  assert.match(sql, /percent integer NOT NULL DEFAULT 0/);
  assert.match(sql, /percent BETWEEN 0 AND 100/);
  assert.match(sql, /updated_at timestamptz NOT NULL DEFAULT now\(\)/);
  assert.match(sql, /ON CONFLICT \(key\) DO NOTHING/, 'a replay keeps flags the owner already changed');
  for (const key of [...LAUNCH, 'relic_unhold']) assert.match(sql, new RegExp(`\\('${key}', 'off'\\)`), `${key} seeded off`);
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
  let now = 1_000_000;
  Flags._setClockForTest(() => now);
  assert.equal(Flags.on(mod.nk, 'maint', U1), true);
  now += 1;
  assert.equal(Flags.on(mod.nk, 'maint', U2, mod.logger), true);
  assert.equal(Flags.on(mod.nk, 'verse_store', U1), false);
  assert.equal(reads(), 2, 'one read per key inside the window');
  now += Flags.FLAG_CACHE_MS + 1;
  assert.equal(Flags.on(mod.nk, 'maint', U1), true);
  assert.equal(reads(), 3, 'the row is read again after the window');
  Flags._setClockForTest(null);

  const broken = loadModule();
  let calls = 0;
  broken.nk.onSql('FROM game.server_flags', () => {
    calls += 1;
    throw new Error('db down');
  });
  const F = broken.global.Flags as FlagsNs;
  assert.equal(F.on(broken.nk, 'shooter_pvp', U1, broken.logger), false, 'read error is off by default');
  assert.equal(F.on(broken.nk, 'shooter_pvp', U1), false);
  assert.equal(calls, 2, 'errors are not cached');
  assert.ok(broken.logger.lines.some((l) => l.level === 'warn' && /flag/.test(l.message)));
  // Per-call safe default: maint readers treat a failed read as maintenance on.
  assert.equal(F.on(broken.nk, 'maint', U1, broken.logger, { onReadError: true }), true, 'onReadError: true on a failed read');
  assert.equal(F.on(broken.nk, 'maint', U1, broken.logger, { onReadError: false }), false);
  assert.equal(calls, 4);
}

// onReadError only applies to a failed read: a readable row (or a missing one) decides as usual.
{
  const { Flags, mod } = withFlags({ maint: { state: 'off' } });
  assert.equal(Flags.on(mod.nk, 'maint', U1, mod.logger, { onReadError: true }), false, 'a readable off row stays off');
  assert.equal(Flags.on(mod.nk, 'relic_unhold', U1, mod.logger, { onReadError: true }), false, 'a missing row stays off');
}

// Apart from the registered default-off seeds and 0062_hub_exchange_open (one migration statement,
// applied once), runtime code never writes game.server_flags.
{
  const mod = loadModule();
  const HubSchema = mod.global.HubSchema as { all(): { id: string; statements: string[] }[] };
  const duelSeeds = HubSchema.all().filter((migration) => migration.id === '0049_sproto_duel_wager_flag');
  assert.equal(duelSeeds.length, 1, 'Duel flag seed is registered once');
  assert.deepEqual(plain(duelSeeds[0].statements), [
    "INSERT INTO game.server_flags (key, state) VALUES ('sproto_duel_wager', 'off') ON CONFLICT (key) DO NOTHING",
  ], 'Duel wagers seed off without overriding an existing flag');
  const runtimeSource = mod.source
    .replace(/0042_server_flags[\s\S]*?ON CONFLICT \(key\) DO NOTHING/, '')
    .replace(/0049_sproto_duel_wager_flag[\s\S]*?ON CONFLICT \(key\) DO NOTHING/, '')
    .replace(/0062_hub_exchange_open[\s\S]*?ON CONFLICT \(key\) DO UPDATE SET state = 'on', updated_at = now\(\)/, '');
  const opens = HubSchema.all().filter((migration) => /server_flags/.test(migration.statements.join('\n')) && !/^004[29]_/.test(migration.id));
  assert.deepEqual(plain(opens.map((migration) => migration.id)), ['0062_hub_exchange_open'], 'only 0062 changes a flag after its seed');
  assert.ok(!/(INSERT INTO|UPDATE|DELETE FROM) game\.server_flags/.test(runtimeSource), 'no runtime writes to server_flags');
}

console.log('flags tests ok');
