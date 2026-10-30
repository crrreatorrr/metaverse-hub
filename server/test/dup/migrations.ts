/**
 * Migration ledger cases for the 0003 pb → peoples-bitcoin merge.
 *
 * Fixture rows are inserted with SQL. The migration itself always runs
 * inside Nakama's boot (`HubSchema.apply` in InitModule), never by
 * replaying statement text from here.
 *
 * The edited-applied-migration boot failure is deferred and not covered.
 * (e) finishes `nakama migrate up` once, then races two hub boots.
 * The cold-start race drops `game` first, so the advisory lock has to
 * cover creating the schema. An unapplied migration numbered below the
 * highest recorded id must refuse to boot, name both ids, and write nothing.
 *
 * Tables seeded with both `pb` and `peoples-bitcoin` for one user:
 * - game.game_session.game_id
 * - game.game_beaten.game_id (unique on user_id, game_id)
 * - game.tickets_balance.game_id (unique on user_id, game_id)
 * - game.tickets_ledger.game_id
 * - game.exchange_tx.game_id (distinct idem_key; unique key has no game_id)
 * - game.verse_earned.game_id (unique on user_id, game_id)
 * - game.event_rule.game_id (no user_id; unique on game_id, event_type)
 * - game.earn_window.bucket (`tickets:pb` / `tickets:peoples-bitcoin` and
 *   `verse:pb` / `verse:peoples-bitcoin`)
 *
 * game.relic_claim and game.idempotency have neither game_id nor bucket.
 * The collision user still gets a relic_claim row and one tickets.earn
 * idempotency row per original game. The catalog check fails if either
 * table grows a game_id or bucket column.
 */
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {
  audit,
  compose,
  num,
  psql,
  sleep,
  sqlId,
  waitReady,
} from './harness.ts';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const COMPOSE_FILE = path.join(ROOT, 'server/docker-compose.yml');
const SCHEMA_FILE = path.join(ROOT, 'server/modules/src/schema.ts');
const BOOTS = ['hub-boot-a', 'hub-boot-b'] as const;
const NAKAMA_DB = 'postgres:localdb@postgres:5432/nakama';

const GAME_ID_TABLES = [
  'game_session',
  'game_beaten',
  'tickets_balance',
  'tickets_ledger',
  'exchange_tx',
  'verse_earned',
  'event_rule',
] as const;

export type DupTest = (category: string, name: string, fn: () => Promise<void>) => Promise<void>;

interface Fixture {
  collision: string;
  pbOnly: string;
  canonOnly: string;
  collisionEvents: string[];
  receipts: [string, string];
  sessions: [string, string];
  collisionLedger: number;
}

let prepared: Promise<Fixture> | null = null;

function lines(sql: string, database?: string): string[] {
  const raw = database ? psql(sql, database) : psql(sql);
  if (!raw) return [];
  return raw.split('\n');
}

function ident(name: string): string {
  if (!/^[a-z_]+$/.test(name)) throw new Error(`bad sql name ${name}`);
  return name;
}

export function fileChecksum(migrationId: string): string {
  const source = ts.createSourceFile(
    SCHEMA_FILE,
    readFileSync(SCHEMA_FILE, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let statements: string[] | null = null;
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === 'MIGRATIONS'
      && node.initializer
      && ts.isArrayLiteralExpression(node.initializer)
    ) {
      for (const element of node.initializer.elements) {
        if (!ts.isObjectLiteralExpression(element)) continue;
        let id = '';
        let statementNode: ts.ArrayLiteralExpression | null = null;
        for (const prop of element.properties) {
          if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
          if (prop.name.text === 'id' && ts.isStringLiteral(prop.initializer)) id = prop.initializer.text;
          if (prop.name.text === 'statements' && ts.isArrayLiteralExpression(prop.initializer)) {
            statementNode = prop.initializer;
          }
        }
        if (id !== migrationId || !statementNode) continue;
        statements = statementNode.elements.map((entry) => {
          if (ts.isStringLiteral(entry) || ts.isNoSubstitutionTemplateLiteral(entry)) return entry.text;
          throw new Error(`${migrationId} statement is not a plain string (${ts.SyntaxKind[entry.kind]})`);
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!statements) throw new Error(`migration ${migrationId} not found in schema.ts`);
  return createHash('sha256').update(statements.join('\n'), 'utf8').digest('hex');
}

function migrationSnapshot(): string {
  return psql(
    `SELECT id || '|' || checksum || '|' || to_char(applied_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US')
     FROM game.schema_migrations ORDER BY id`,
  );
}

function economySnapshot(): string {
  return psql(
    `SELECT (SELECT count(*) FROM game.tickets_ledger)::text
          || '|' || (SELECT count(*) FROM game.tickets_balance)::text
          || '|' || (SELECT COALESCE(sum(balance), 0) FROM game.tickets_balance)::text
          || '|' || (SELECT COALESCE(sum(delta), 0) FROM game.tickets_ledger)::text
          || '|' || (SELECT count(*) FROM game.verse_ledger)::text
          || '|' || (SELECT COALESCE(sum(balance), 0) FROM game.verse_wallet)::text`,
  );
}

function bootNakama(): void {
  try {
    compose(
      ['up', '-d', '--no-build', '--force-recreate', '--wait', '--wait-timeout', '150', 'nakama'],
      360_000,
    );
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    const logs = spawnSync('docker', ['compose', '-f', COMPOSE_FILE, 'logs', '--no-color', '--tail', '120', 'nakama'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    throw new Error(
      `nakama boot failed\n${err.stdout ?? ''}\n${err.stderr ?? ''}\n${err.message ?? ''}\n${logs.stdout ?? ''}\n${logs.stderr ?? ''}`,
    );
  }
}

async function bootAndReady(): Promise<void> {
  bootNakama();
  await waitReady();
}

function assertCatalogCoversSeed(): void {
  const found = lines(
    `SELECT c.relname || '.' || a.attname
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_attribute a ON a.attrelid = c.oid
     WHERE n.nspname = 'game' AND c.relkind = 'r'
       AND a.attname IN ('game_id', 'bucket') AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY 1`,
  );
  const expected = [
    ...GAME_ID_TABLES.map((table) => `${table}.game_id`),
    'earn_window.bucket',
  ].sort();
  assert.deepEqual([...found].sort(), expected, `game_id/bucket columns changed:\n${found.join('\n')}`);
  for (const table of ['relic_claim', 'idempotency']) {
    const cols = lines(
      `SELECT a.attname
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid
       WHERE n.nspname = 'game' AND c.relname = '${ident(table)}'
         AND a.attnum > 0 AND NOT a.attisdropped AND a.attname IN ('game_id', 'bucket')`,
    );
    assert.deepEqual(cols, [], `${table} now has ${cols.join(', ')}; seed both game ids there`);
  }
}

function uuid(): string {
  return sqlId(crypto.randomUUID());
}

function seed(fix: Fixture): void {
  const [pbSession, canonSession] = fix.sessions;
  const [pbReceipt, canonReceipt] = fix.receipts;
  const [pbEarn, pbSpend, canonEarn, canonSpend] = fix.collisionEvents;
  const grant = uuid();
  const pbOnlyEvent = uuid();
  const canonOnlyEvent = uuid();
  const pbJti = uuid();
  const canonJti = uuid();
  const pbOnlySession = uuid();
  const pbOnlyJti = uuid();
  const canonOnlySession = uuid();
  const canonOnlyJti = uuid();
  const hash = "decode('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff', 'hex')";
  psql(`
    ALTER TABLE game.game_session DROP CONSTRAINT IF EXISTS game_session_game;
    ALTER TABLE game.game_beaten DROP CONSTRAINT IF EXISTS game_beaten_game;

    INSERT INTO game.game_session (
      session_id, user_id, game_id, ranked, effects, ticket_jti, state, lease_until, ticket_exp, ticket_redeemed_at
    ) VALUES
      ('${pbSession}', '${fix.collision}', 'pb', false, '{}', '${pbJti}', 'closed', now(), now(), now()),
      ('${canonSession}', '${fix.collision}', 'peoples-bitcoin', false, '{}', '${canonJti}', 'closed', now(), now(), now()),
      ('${pbOnlySession}', '${fix.pbOnly}', 'pb', false, '{}', '${pbOnlyJti}', 'closed', now(), now(), now()),
      ('${canonOnlySession}', '${fix.canonOnly}', 'peoples-bitcoin', false, '{}', '${canonOnlyJti}', 'closed', now(), now(), now());

    INSERT INTO game.game_beaten (user_id, game_id, relic_id, beaten_at) VALUES
      ('${fix.collision}', 'peoples-bitcoin', 'genesis_shard', timestamptz '2020-06-01 00:00:00+00'),
      ('${fix.collision}', 'pb', 'from-pb', timestamptz '2020-01-01 00:00:00+00');

    INSERT INTO game.tickets_balance (user_id, game_id, balance) VALUES
      ('${fix.collision}', 'pb', 30),
      ('${fix.collision}', 'peoples-bitcoin', 50),
      ('${fix.pbOnly}', 'pb', 15),
      ('${fix.canonOnly}', 'peoples-bitcoin', 7);

    INSERT INTO game.tickets_ledger (event_id, user_id, game_id, delta, balance_after, reason, ref_id) VALUES
      ('${pbEarn}', '${fix.collision}', 'pb', 40, 40, 'seed', NULL),
      ('${pbSpend}', '${fix.collision}', 'pb', -10, 30, 'exchange', '${pbReceipt}'),
      ('${canonEarn}', '${fix.collision}', 'peoples-bitcoin', 60, 60, 'seed', NULL),
      ('${canonSpend}', '${fix.collision}', 'peoples-bitcoin', -10, 50, 'exchange', '${canonReceipt}'),
      ('${pbOnlyEvent}', '${fix.pbOnly}', 'pb', 15, 15, 'seed', NULL),
      ('${canonOnlyEvent}', '${fix.canonOnly}', 'peoples-bitcoin', 7, 7, 'seed', NULL);

    INSERT INTO game.exchange_tx (receipt_id, user_id, game_id, tickets, verse, rate, idem_key) VALUES
      ('${pbReceipt}', '${fix.collision}', 'pb', 10, 1, '10:1', 'ex-pb'),
      ('${canonReceipt}', '${fix.collision}', 'peoples-bitcoin', 10, 1, '10:1', 'ex-peoples-bitcoin');

    INSERT INTO game.verse_wallet (user_id, balance) VALUES ('${fix.collision}', 2);
    INSERT INTO game.verse_ledger (event_id, user_id, delta, balance_after, source, ref_id) VALUES
      ('${uuid()}', '${fix.collision}', 1, 1, 'pb', '${pbReceipt}'),
      ('${uuid()}', '${fix.collision}', 1, 2, 'peoples-bitcoin', '${canonReceipt}');

    INSERT INTO game.verse_earned (user_id, game_id, lifetime) VALUES
      ('${fix.collision}', 'pb', 1),
      ('${fix.collision}', 'peoples-bitcoin', 1);

    INSERT INTO game.earn_window (user_id, bucket, day, amount) VALUES
      ('${fix.collision}', 'tickets:pb', DATE '2020-01-15', 40),
      ('${fix.collision}', 'tickets:peoples-bitcoin', DATE '2020-01-15', 60),
      ('${fix.collision}', 'verse:pb', DATE '2020-01-15', 1),
      ('${fix.collision}', 'verse:peoples-bitcoin', DATE '2020-01-15', 1),
      ('${fix.pbOnly}', 'tickets:pb', DATE '2020-01-15', 15),
      ('${fix.canonOnly}', 'tickets:peoples-bitcoin', DATE '2020-01-15', 7);

    INSERT INTO game.event_rule (game_id, event_type, relic_id, tickets, session_limit, day_limit, match) VALUES
      ('pb', 'game_beaten', 'from-pb', 999, NULL, NULL, '{}'),
      ('pb', 'pb.quest_complete', 'from-pb', 999, NULL, NULL, '{}'),
      ('pb', 'pb.legacy_only', 'from-pb', 7, NULL, NULL, '{}');

    INSERT INTO game.idempotency (user_id, key, rpc, req_hash, response) VALUES
      ('${fix.collision}', 'earn:pb', 'tickets.earn', ${hash}, '{}'),
      ('${fix.collision}', 'earn:peoples-bitcoin', 'tickets.earn', ${hash}, '{}'),
      ('${fix.pbOnly}', 'earn:pb-only', 'tickets.earn', ${hash}, '{}'),
      ('${fix.canonOnly}', 'earn:peoples-bitcoin-only', 'tickets.earn', ${hash}, '{}');

    INSERT INTO game.relic_claim (user_id, relic_id, session_id, event_id) VALUES
      ('${fix.collision}', 'genesis_shard', '${canonSession}', '${grant}');
    INSERT INTO game.item_ledger (event_id, user_id, op, item_id, source, ref_id) VALUES
      ('${grant}', '${fix.collision}', 'grant_relic', 'genesis_shard', 'peoples-bitcoin', '${canonSession}');
  `);
}

function assertBothGameIds(fix: Fixture): void {
  for (const table of GAME_ID_TABLES) {
    if (table === 'event_rule') {
      assert.ok(num(`SELECT count(*) FROM game.event_rule WHERE game_id = 'pb'`) >= 1, 'event_rule missing pb');
      assert.ok(num(`SELECT count(*) FROM game.event_rule WHERE game_id = 'peoples-bitcoin'`) >= 1, 'event_rule missing peoples-bitcoin');
      continue;
    }
    const pb = num(`SELECT count(*) FROM game.${ident(table)} WHERE user_id = '${fix.collision}' AND game_id = 'pb'`);
    const canon = num(`SELECT count(*) FROM game.${ident(table)} WHERE user_id = '${fix.collision}' AND game_id = 'peoples-bitcoin'`);
    assert.ok(pb >= 1 && canon >= 1, `${table} collision rows pb=${pb} peoples-bitcoin=${canon}`);
  }
  for (const bucket of ['tickets:pb', 'tickets:peoples-bitcoin', 'verse:pb', 'verse:peoples-bitcoin']) {
    const n = num(
      `SELECT count(*) FROM game.earn_window WHERE user_id = '${fix.collision}' AND bucket = '${bucket}'`,
    );
    assert.equal(n, 1, `earn_window ${bucket}`);
  }
  assert.equal(num(`SELECT count(*) FROM game.idempotency WHERE user_id = '${fix.collision}' AND key IN ('earn:pb', 'earn:peoples-bitcoin')`), 2);
  assert.equal(num(`SELECT count(*) FROM game.relic_claim WHERE user_id = '${fix.collision}'`), 1);
}

async function prepare(): Promise<Fixture> {
  if (!prepared) prepared = doPrepare();
  return prepared;
}

async function doPrepare(): Promise<Fixture> {
  const fix: Fixture = {
    collision: uuid(),
    pbOnly: uuid(),
    canonOnly: uuid(),
    collisionEvents: [uuid(), uuid(), uuid(), uuid()],
    receipts: [uuid(), uuid()],
    sessions: [uuid(), uuid()],
    collisionLedger: 0,
  };
  compose(['stop', 'nakama'], 180_000);
  assertCatalogCoversSeed();
  seed(fix);
  assertBothGameIds(fix);
  fix.collisionLedger = num(`SELECT count(*) FROM game.tickets_ledger WHERE user_id = '${fix.collision}'`);
  assert.equal(fix.collisionLedger, 4);
  const removed = num(
    `WITH deleted AS (
       DELETE FROM game.schema_migrations WHERE id = '0003_merge_pb_into_peoples_bitcoin' RETURNING 1
     ) SELECT count(*) FROM deleted`,
  );
  assert.equal(removed, 1, '0003 was not recorded, so this boot would not be a replay of that migration');
  await bootAndReady();
  return fix;
}

function mismatches(): string[] {
  return lines(
    `SELECT user_id::text || ' ' || game_id || ' balance=' || balance::text || ' ledger=' || ledger_sum::text
     FROM (
       SELECT b.user_id, b.game_id, b.balance,
              COALESCE((SELECT sum(l.delta) FROM game.tickets_ledger l
                         WHERE l.user_id = b.user_id AND l.game_id = b.game_id), 0) AS ledger_sum
       FROM game.tickets_balance b
       UNION
       SELECT l.user_id, l.game_id,
              COALESCE((SELECT b.balance FROM game.tickets_balance b
                         WHERE b.user_id = l.user_id AND b.game_id = l.game_id), -1),
              COALESCE(sum(l.delta), 0)
       FROM game.tickets_ledger l
       GROUP BY l.user_id, l.game_id
     ) s
     WHERE balance <> ledger_sum`,
  );
}

function pbLeftovers(): string[] {
  const cols = lines(
    `SELECT c.relname || '.' || a.attname
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_attribute a ON a.attrelid = c.oid
     WHERE n.nspname = 'game' AND c.relkind = 'r'
       AND a.attname IN ('game_id', 'bucket') AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY 1`,
  );
  const hits: string[] = [];
  for (const col of cols) {
    const [table, column] = col.split('.');
    if (!table || !column) throw new Error(`bad catalog row ${col}`);
    ident(table);
    ident(column);
    const where = column === 'game_id'
      ? `game_id = 'pb'`
      : `bucket = 'pb' OR bucket IN ('tickets:pb', 'verse:pb')`;
    const n = num(`SELECT count(*) FROM game.${table} WHERE ${where}`);
    if (n > 0) hits.push(`${table}.${column} ${n}`);
  }
  return hits;
}

function dockerLogs(name: string): string {
  const result = spawnSync('docker', ['logs', '--tail', '160', name], { encoding: 'utf8' });
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
}

function runNakamaMigrate(): void {
  try {
    execFileSync('docker', [
      'compose', '-f', COMPOSE_FILE, 'run', '-T', '--rm', '--no-deps', '--pull', 'never',
      '--entrypoint', '/nakama/nakama',
      'nakama', 'migrate', 'up', '--database.address', NAKAMA_DB,
    ], { cwd: ROOT, encoding: 'utf8', timeout: 180_000 });
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    throw new Error(`nakama migrate up failed\n${err.stdout ?? ''}\n${err.stderr ?? ''}\n${err.message ?? ''}`);
  }
}

/** Full hub boot from the compose service: `nakama migrate up`, then the runtime. */
async function composeRun(name: string): Promise<void> {
  await execFileAsync('docker', [
    'compose', '-f', COMPOSE_FILE, 'run', '-d', '-T', '--no-deps', '--pull', 'never',
    '--name', name, 'nakama',
  ], { cwd: ROOT, timeout: 120_000 });
}

function rmBoots(): void {
  execFileSync('docker', ['rm', '-f', ...BOOTS], { encoding: 'utf8' });
}

async function waitBoot(name: string): Promise<string> {
  const deadline = Date.now() + 150_000;
  let last = 'not started';
  while (Date.now() < deadline) {
    const inspected = spawnSync('docker', ['inspect', '-f', '{{.State.Status}} {{.State.ExitCode}}', name], { encoding: 'utf8' });
    if (inspected.status !== 0) {
      last = `${inspected.stdout ?? ''} ${inspected.stderr ?? ''}`.trim();
      await sleep(500);
      continue;
    }
    last = inspected.stdout.trim();
    if (last.startsWith('exited') || last.startsWith('dead')) break;
    const health = spawnSync('docker', ['exec', name, '/nakama/nakama', 'healthcheck'], { encoding: 'utf8', timeout: 10_000 });
    if (health.status === 0) return 'ok';
    last = `${last} ${health.stderr ?? health.stdout ?? ''}`.trim();
    await sleep(1000);
  }
  return `${last}\n${dockerLogs(name)}`;
}

function freshDatabase(): void {
  compose(['stop', 'nakama'], 180_000);
  psql('DROP DATABASE IF EXISTS nakama WITH (FORCE)', 'postgres');
  psql('CREATE DATABASE nakama', 'postgres');
}

function assertNakamaMigratedWithoutGameSchema(): void {
  assert.equal(
    psql(`SELECT COALESCE(to_regnamespace('game')::text, '')`),
    '',
    'game schema exists before the hub boots',
  );
  assert.equal(
    psql(`SELECT COALESCE(to_regclass('game.schema_migrations')::text, '')`),
    '',
    'schema_migrations exists before the hub boots',
  );
  assert.equal(
    psql(`SELECT COALESCE(to_regclass('public.users')::text, '')`),
    'users',
    'nakama migrate did not create public.users',
  );
}

function assertSchemaCreatedOnce(): void {
  assert.equal(num(`SELECT count(*) FROM pg_namespace WHERE nspname = 'game'`), 1, 'game schema created once');
  assert.equal(
    num(
      `SELECT count(*) FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'game' AND c.relname = 'schema_migrations' AND c.relkind = 'r'`,
    ),
    1,
    'schema_migrations created once',
  );
}

function dropGameSchema(): void {
  compose(['stop', 'nakama'], 180_000);
  psql(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'nakama' AND pid <> pg_backend_pid()`);
  psql('DROP SCHEMA IF EXISTS game CASCADE');
}

interface LedgerRow {
  checksum: string;
  appliedAt: string;
}

function ledgerById(): Map<string, LedgerRow> {
  const map = new Map<string, LedgerRow>();
  const raw = migrationSnapshot();
  if (!raw) return map;
  for (const line of raw.split('\n')) {
    const [id, checksum, appliedAt] = line.split('|');
    if (!id || !checksum || !appliedAt) throw new Error(`bad schema_migrations row ${line}`);
    map.set(id, { checksum, appliedAt });
  }
  return map;
}

function deleteLedgerRow(id: string): void {
  if (!/^[0-9]{4}_[a-z0-9_]+$/.test(id)) throw new Error(`bad migration id ${id}`);
  const removed = num(
    `WITH deleted AS (DELETE FROM game.schema_migrations WHERE id = '${id}' RETURNING 1) SELECT count(*) FROM deleted`,
  );
  assert.equal(removed, 1, `${id} was not recorded`);
}

function insertLedgerRow(id: string, row: LedgerRow): void {
  if (!/^[0-9]{4}_[a-z0-9_]+$/.test(id)) throw new Error(`bad migration id ${id}`);
  if (!/^[0-9a-f]{64}$/.test(row.checksum)) throw new Error(`bad checksum for ${id}`);
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/.test(row.appliedAt)) {
    throw new Error(`bad applied_at for ${id}: ${row.appliedAt}`);
  }
  psql(
    `INSERT INTO game.schema_migrations (id, checksum, applied_at) VALUES ('${id}', '${row.checksum}', timestamptz '${row.appliedAt}+00')`,
  );
}

function serviceLogs(service: string): string {
  const result = spawnSync(
    'docker',
    ['compose', '-f', COMPOSE_FILE, 'logs', '--no-color', '--tail', '250', service],
    { cwd: ROOT, encoding: 'utf8' },
  );
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
}

function bootExpectingRefusal(): { ok: boolean; logs: string } {
  let ok = true;
  let errorText = '';
  try {
    bootNakama();
  } catch (error) {
    ok = false;
    errorText = error instanceof Error ? error.message : String(error);
  }
  return { ok, logs: `${errorText}\n${serviceLogs('nakama')}`.trim() };
}

async function restoreMainNakama(failure: unknown): Promise<unknown> {
  try {
    rmBoots();
    await bootAndReady();
    return failure;
  } catch (error) {
    const extra = error instanceof Error ? error.message : String(error);
    const prior = failure instanceof Error ? failure.message : failure ? String(failure) : '';
    return new Error(`${prior}\ncleanup: ${extra}`.trim());
  }
}

async function raceHubBoots(): Promise<void> {
  rmBoots();
  await Promise.all(BOOTS.map((name) => composeRun(name)));
  const results = await Promise.all(BOOTS.map(async (name) => `${name}: ${await waitBoot(name)}`));
  const unhealthy = results.filter((line) => !line.endsWith(': ok'));
  if (unhealthy.length) {
    let table = '';
    try {
      table = psql(`SELECT id || '=' || count(*)::text FROM game.schema_migrations GROUP BY id ORDER BY id`);
    } catch (error) {
      table = error instanceof Error ? error.message : String(error);
    }
    const logs = BOOTS.map((name) => `--- ${name} ---\n${dockerLogs(name)}`).join('\n');
    throw new Error(
      `concurrent boot did not become healthy\n${results.join('\n\n')}\nschema_migrations:\n${table}\n${logs}`,
    );
  }
  for (const name of BOOTS) {
    const logs = dockerLogs(name);
    if (!logs.includes('game schema ready')) {
      throw new Error(`${name} did not finish the migration runner\n${logs}`);
    }
  }
  const counts = psql(`SELECT id || '=' || count(*)::text FROM game.schema_migrations GROUP BY id ORDER BY id`);
  const expected = [
    '0001_schema_migrations=1',
    '0002_baseline=1',
    '0003_merge_pb_into_peoples_bitcoin=1',
  ].join('\n');
  if (counts !== expected) {
    throw new Error(
      `applied migrations:\n${counts}\nexpected:\n${expected}\n--- hub-boot-a ---\n${dockerLogs('hub-boot-a')}\n--- hub-boot-b ---\n${dockerLogs('hub-boot-b')}`,
    );
  }
  assert.equal(num('SELECT count(*) FROM game.schema_migrations'), 3);
  assert.equal(num('SELECT count(*) FROM game.tickets_ledger'), 0);
  assert.equal(num('SELECT count(*) FROM game.tickets_balance'), 0);
  assert.equal(num('SELECT COALESCE(sum(balance), 0) FROM game.verse_wallet'), 0);
  assert.equal(num('SELECT count(*) FROM game.verse_ledger'), 0);
  assert.equal(num('SELECT count(*) FROM game.event_rule'), 8);
  assert.equal(
    psql(`SELECT checksum FROM game.schema_migrations WHERE id = '0002_baseline'`),
    fileChecksum('0002_baseline'),
  );
}

export async function runMigrations(test: DupTest): Promise<void> {
  await test('migration', '0002 checksum matches schema.ts', async () => {
    const stored = psql(`SELECT checksum FROM game.schema_migrations WHERE id = '0002_baseline'`);
    const file = fileChecksum('0002_baseline');
    console.log(`migration 0002 stored sha256=${stored}`);
    console.log(`migration 0002 file sha256=${file}`);
    writeFileSync('/tmp/migration-0002-checksum.txt', `stored=${stored}\nfile=${file}\n`);
    assert.equal(stored, file, 'schema_migrations.checksum for 0002_baseline differs from schema.ts');
    assert.match(stored, /^[0-9a-f]{64}$/);
  });

  await test('migration', '(a) ledger sums equal balances after 0003', async () => {
    const fix = await prepare();
    const bad = mismatches();
    assert.deepEqual(bad, [], `SUM(tickets_ledger.delta) <> tickets_balance.balance\n${bad.join('\n')}`);
    const balance = num(
      `SELECT balance FROM game.tickets_balance WHERE user_id = '${fix.collision}' AND game_id = 'peoples-bitcoin'`,
    );
    const ledger = num(
      `SELECT COALESCE(sum(delta), 0) FROM game.tickets_ledger WHERE user_id = '${fix.collision}' AND game_id = 'peoples-bitcoin'`,
    );
    assert.equal(ledger, balance, 'SUM(tickets_ledger.delta) <> tickets_balance.balance for peoples-bitcoin');
    assert.equal(balance, 80);
    assert.equal(num(
      `SELECT balance FROM game.tickets_balance WHERE user_id = '${fix.pbOnly}' AND game_id = 'peoples-bitcoin'`,
    ), 15);
    assert.equal(num(
      `SELECT COALESCE(sum(delta), 0) FROM game.verse_ledger WHERE user_id = '${fix.collision}'`,
    ), num(`SELECT balance FROM game.verse_wallet WHERE user_id = '${fix.collision}'`));
    audit();
  });

  await test('migration', '(b) collision keeps peoples-bitcoin and drops pb', async () => {
    const fix = await prepare();
    console.log(
      'migration tables covered: game_session, game_beaten, tickets_balance, tickets_ledger, exchange_tx, verse_earned, event_rule, earn_window; relic_claim has no game_id (one claim for the collision user); idempotency has no game_id (earn:pb and earn:peoples-bitcoin)',
    );
    const leftovers = pbLeftovers();
    assert.deepEqual(leftovers, [], `pb rows remain\n${leftovers.join('\n')}`);
    assert.equal(num(`SELECT count(*) FROM game.tickets_balance WHERE user_id = '${fix.collision}'`), 1);
    assert.equal(num(
      `SELECT balance FROM game.tickets_balance WHERE user_id = '${fix.collision}' AND game_id = 'peoples-bitcoin'`,
    ), 80);
    const ledger = psql(
      `SELECT count(*)::text || ' ' || count(DISTINCT event_id)::text || ' ' || count(*) FILTER (WHERE game_id = 'peoples-bitcoin')::text || ' ' || COALESCE(sum(delta), 0)::text
       FROM game.tickets_ledger WHERE user_id = '${fix.collision}'`,
    );
    assert.equal(ledger, `4 4 4 80`);
    assert.equal(num(`SELECT count(*) FROM game.tickets_ledger WHERE user_id = '${fix.collision}'`), fix.collisionLedger);
    const present = num(
      `SELECT count(*) FROM game.tickets_ledger WHERE event_id IN (${fix.collisionEvents.map((id) => `'${id}'`).join(', ')})`,
    );
    assert.equal(present, fix.collisionEvents.length);
    assert.equal(psql(
      `SELECT amount::text FROM game.earn_window WHERE user_id = '${fix.collision}' AND bucket = 'tickets:peoples-bitcoin' AND day = DATE '2020-01-15'`,
    ), '100');
    assert.equal(psql(
      `SELECT amount::text FROM game.earn_window WHERE user_id = '${fix.collision}' AND bucket = 'verse:peoples-bitcoin' AND day = DATE '2020-01-15'`,
    ), '2');
    assert.equal(num(`SELECT count(*) FROM game.earn_window WHERE user_id = '${fix.collision}'`), 2);
    assert.equal(psql(
      `SELECT relic_id || ' ' || to_char(beaten_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
       FROM game.game_beaten WHERE user_id = '${fix.collision}' AND game_id = 'peoples-bitcoin'`,
    ), 'genesis_shard 2020-01-01');
    assert.equal(num(`SELECT count(*) FROM game.game_beaten WHERE user_id = '${fix.collision}'`), 1);
    assert.equal(num(
      `SELECT lifetime FROM game.verse_earned WHERE user_id = '${fix.collision}' AND game_id = 'peoples-bitcoin'`,
    ), 2);
    assert.equal(num(`SELECT count(*) FROM game.verse_earned WHERE user_id = '${fix.collision}'`), 1);
    assert.equal(psql(
      `SELECT COALESCE(tickets::text, 'null') || ' ' || relic_id
       FROM game.event_rule WHERE game_id = 'peoples-bitcoin' AND event_type = 'game_beaten'`,
    ), 'null genesis_shard');
    assert.equal(psql(
      `SELECT tickets::text || ' ' || relic_id
       FROM game.event_rule WHERE game_id = 'peoples-bitcoin' AND event_type = 'pb.legacy_only'`,
    ), '7 from-pb');
    assert.equal(psql(
      `SELECT count(*) FILTER (WHERE game_id = 'peoples-bitcoin')::text || ' ' || count(*)::text
       FROM game.exchange_tx WHERE user_id = '${fix.collision}'`,
    ), '2 2');
    assert.equal(num(
      `SELECT count(*) FROM game.exchange_tx WHERE receipt_id IN ('${fix.receipts[0]}', '${fix.receipts[1]}') AND game_id = 'peoples-bitcoin'`,
    ), 2);
    assert.equal(psql(
      `SELECT count(*) FILTER (WHERE game_id = 'peoples-bitcoin')::text || ' ' || count(*)::text
       FROM game.game_session WHERE user_id = '${fix.collision}'`,
    ), '2 2');
    assert.equal(num(
      `SELECT count(*) FROM game.game_session WHERE session_id IN ('${fix.sessions[0]}', '${fix.sessions[1]}')`,
    ), 2);
    assert.equal(num(`SELECT count(*) FROM game.idempotency WHERE user_id = '${fix.collision}'`), 2);
    assert.equal(num(`SELECT count(*) FROM game.relic_claim WHERE user_id = '${fix.collision}'`), 1);
    assert.equal(num(`SELECT count(*) FROM game.item_ledger WHERE user_id = '${fix.collision}' AND op = 'grant_relic'`), 1);
    console.log(
      `verse_ledger.source pb remaining=${num(`SELECT count(*) FROM game.verse_ledger WHERE source = 'pb'`)}`,
    );
  });

  await test('migration', '(c) second boot applies nothing', async () => {
    await prepare();
    const beforeMigrations = migrationSnapshot();
    const beforeEconomy = economySnapshot();
    await bootAndReady();
    assert.equal(migrationSnapshot(), beforeMigrations, 'schema_migrations changed on the second boot');
    assert.equal(economySnapshot(), beforeEconomy, 'balances or ledger counts changed on the second boot');
  });

  await test('migration', '(e) concurrent boots apply each migration once', async () => {
    let failure: unknown = null;
    try {
      rmBoots();
      freshDatabase();
      prepared = null;
      runNakamaMigrate();
      assertNakamaMigratedWithoutGameSchema();
      await raceHubBoots();
    } catch (error) {
      failure = error;
    } finally {
      failure = await restoreMainNakama(failure);
    }
    if (failure) throw failure;
  });

  await test('migration', 'cold start locks before the game schema exists', async () => {
    let failure: unknown = null;
    try {
      prepared = null;
      dropGameSchema();
      assertNakamaMigratedWithoutGameSchema();
      await raceHubBoots();
      assertSchemaCreatedOnce();
    } catch (error) {
      failure = error;
    } finally {
      failure = await restoreMainNakama(failure);
    }
    if (failure) throw failure;
  });

  await test('migration', 'unapplied migration below the highest recorded one refuses to boot', async () => {
    const lower = '0002_baseline';
    const higher = '0003_merge_pb_into_peoples_bitcoin';
    let failure: unknown = null;
    let saved: LedgerRow | null = null;
    try {
      compose(['stop', 'nakama'], 180_000);
      const before = ledgerById();
      const row = before.get(lower);
      if (!row) throw new Error(`${lower} is not recorded`);
      if (!before.has(higher)) throw new Error(`${higher} is not recorded`);
      saved = row;
      deleteLedgerRow(lower);
      const sabotaged = migrationSnapshot();
      const economy = economySnapshot();
      const boot = bootExpectingRefusal();
      assert.equal(boot.ok, false, `out-of-order migration booted\n${boot.logs}`);
      assert.match(boot.logs, /unapplied schema migration/);
      assert.match(boot.logs, /older than the highest recorded migration/);
      assert.match(boot.logs, new RegExp(lower));
      assert.match(boot.logs, new RegExp(higher));
      assert.equal(migrationSnapshot(), sabotaged, 'schema_migrations changed on a refused boot');
      assert.equal(economySnapshot(), economy, 'balances or ledger counts changed on a refused boot');
      assert.equal(num(`SELECT count(*) FROM game.schema_migrations WHERE id = '${lower}'`), 0);
      assert.equal(num(`SELECT count(*) FROM game.schema_migrations WHERE id = '${higher}'`), 1);
    } catch (error) {
      failure = error;
    } finally {
      try {
        compose(['stop', 'nakama'], 180_000);
        if (saved && num(`SELECT count(*) FROM game.schema_migrations WHERE id = '${lower}'`) === 0) {
          insertLedgerRow(lower, saved);
        }
      } catch (error) {
        const extra = error instanceof Error ? error.message : String(error);
        const prior = failure instanceof Error ? failure.message : failure ? String(failure) : '';
        failure = new Error(`${prior}\nrestore ledger: ${extra}`.trim());
      }
      failure = await restoreMainNakama(failure);
    }
    if (failure) throw failure;
  });

  await test('migration', 'in-order unapplied migration still applies', async () => {
    const next = '0003_merge_pb_into_peoples_bitcoin';
    let failure: unknown = null;
    try {
      compose(['stop', 'nakama'], 180_000);
      const before = ledgerById();
      const first = before.get('0001_schema_migrations');
      const second = before.get('0002_baseline');
      if (!first || !second || !before.has(next)) throw new Error(`ledger not ready\n${migrationSnapshot()}`);
      const economy = economySnapshot();
      deleteLedgerRow(next);
      await bootAndReady();
      const after = ledgerById();
      assert.deepEqual(after.get('0001_schema_migrations'), first, '0001 changed while 0003 applied');
      assert.deepEqual(after.get('0002_baseline'), second, '0002 changed while 0003 applied');
      assert.equal(after.get(next)?.checksum, fileChecksum(next), '0003 checksum');
      assert.equal(after.size, 3);
      assert.equal(economySnapshot(), economy, 'balances or ledger counts changed when 0003 applied in order');
    } catch (error) {
      failure = error;
    } finally {
      failure = await restoreMainNakama(failure);
    }
    if (failure) throw failure;
  });
}
