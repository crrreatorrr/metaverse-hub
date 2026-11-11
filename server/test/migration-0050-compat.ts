// GitHub Actions throwaway PostgreSQL/Nakama only. Never production recovery.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { compose, psql, psqlFile, waitReady, audit } from './dup/harness.ts';
import { fileChecksum } from './dup/migrations.ts';
import { loadModule } from './unit/harness.ts';

const PB = '0050_pb_campaign_pistol_price', QUEUE = '0050_shooter_verification_queue';
const row = (id: string) => psql(`SELECT checksum||':'||applied_at::text FROM game.schema_migrations WHERE id='${id}'`);
const ledger = () => psql('SELECT id||\':\'||checksum||\':\'||applied_at::text FROM game.schema_migrations ORDER BY id');
const economy = () => psql(`SELECT md5(COALESCE((SELECT string_agg(to_jsonb(t)::text,'' ORDER BY seq) FROM game.tickets_ledger t),''))||':'||md5(COALESCE((SELECT string_agg(to_jsonb(t)::text,'' ORDER BY user_id,game_id) FROM game.tickets_balance t),''))`);
const price = () => psql("SELECT price||':'||sell_price FROM game.shop_price WHERE game='peoples-bitcoin' AND shop_id='shop_terminal' AND item_id='gun_campaign_pistol'");
const directory = mkdtempSync(join(tmpdir(), 'hub-0050-compat-'));
function query(extra = false): string {
  const m = loadModule({ noInit: true });
  const schema = m.global.HubSchema as { register(v: unknown): void; apply(nk: unknown, logger: unknown): void };
  if (extra) schema.register({ id: '0051_compat_guard_fixture', statements: ['SELECT 1'] });
  schema.apply(m.nk, m.logger);
  return m.nk.sqlCalls.find((call) => call.kind === 'exec' && call.sql.includes('DO $hub_lock$'))!.sql;
}
function execute(sql: string): void {
  const file = join(directory, 'query.sql'); writeFileSync(file, sql); psqlFile(file);
}
async function reboot(): Promise<void> { compose(['restart', 'nakama']); await waitReady(); }

try {
  await waitReady();
  const beforeEconomy = economy();
  for (const id of [PB, QUEUE]) assert.equal(psql(`SELECT checksum FROM game.schema_migrations WHERE id='${id}'`), fileChecksum(id));
  assert.equal(price(), '2:1');
  const complete = ledger(); await reboot(); assert.equal(ledger(), complete);
  console.log('PASS fresh real Nakama boot applies both identities and repeat boot preserves history');

  // PB-only history: remove only the new unused queue and its ledger row.
  const pbBefore = row(PB);
  compose(['stop', 'nakama']);
  psql(`DROP TABLE game.shooter_verification_job,game.shooter_verification_batch,game.shooter_verification_run; DELETE FROM game.schema_migrations WHERE id='${QUEUE}'`);
  compose(['start', 'nakama']); await waitReady();
  assert.equal(row(PB), pbBefore); assert.equal(price(), '2:1');
  assert.equal(psql(`SELECT checksum FROM game.schema_migrations WHERE id='${QUEUE}'`), fileChecksum(QUEUE));
  console.log('PASS PB-only history gains queue without changing PB checksum or applied timestamp');

  // Queue-only history: the independent pending PB update must execute once.
  const queueBefore = row(QUEUE);
  compose(['stop', 'nakama']);
  psql(`DELETE FROM game.schema_migrations WHERE id='${PB}'; UPDATE game.shop_price SET price=99,sell_price=1 WHERE game='peoples-bitcoin' AND shop_id='shop_terminal' AND item_id='gun_campaign_pistol'`);
  compose(['start', 'nakama']); await waitReady();
  assert.equal(row(QUEUE), queueBefore); assert.equal(price(), '2:1');
  assert.equal(psql(`SELECT checksum FROM game.schema_migrations WHERE id='${PB}'`), fileChecksum(PB));
  const restored = ledger(); await reboot(); assert.equal(ledger(), restored);
  assert.equal(economy(), beforeEconomy); audit();
  console.log('PASS queue-only history gains PB update once, preserves queue history and economy');

  // Execute the actual generated locked runner SQL against real PostgreSQL.
  // Each refusal aborts its whole transaction, retaining the original history.
  for (const id of [PB, QUEUE]) {
    assert.throws(() => execute(`BEGIN; UPDATE game.schema_migrations SET checksum=repeat('0',64) WHERE id='${id}'; ${query()} ROLLBACK;`), /checksum mismatch/);
    assert.equal(ledger(), restored);
  }
  const checksum = createHash('sha256').update('SELECT 1').digest('hex');
  assert.throws(() => execute(`BEGIN; DELETE FROM game.schema_migrations WHERE id='${PB}'; INSERT INTO game.schema_migrations(id,checksum) VALUES('0051_compat_guard_fixture','${checksum}'); ${query(true)} ROLLBACK;`), /older than the highest recorded/);
  assert.equal(ledger(), restored);
  console.log('PASS checksum mismatch and missing sibling below later history still fail closed atomically');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
