// Applies the Nakama module's schema ledger to a throwaway Postgres database, without
// Nakama. The compiled module runs in a VM context with a stub `nk` that captures the
// migration SQL, which is then executed for real.
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ADMIN_URL = process.env.EXCHANGE_TEST_DB ?? 'postgres://postgres@127.0.0.1:55432/postgres';

export function schemaSql(): string {
  execFileSync('npx', ['tsc', '-p', path.join(ROOT, 'server/modules/tsconfig.json')], { stdio: 'inherit' });
  const code = readFileSync(path.join(ROOT, 'server/modules/build/index.js'), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(code, context);
  let captured = '';
  const nk = {
    sha256Hash: (s: string) => createHash('sha256').update(s, 'utf8').digest('hex'),
    sqlExec: (sql: string) => {
      captured = sql;
      return { rowsAffected: 0 };
    },
  };
  const logger = { info() {}, warn() {}, error() {}, debug() {} };
  (context as { HubSchema: { apply(nk: unknown, logger: unknown): void } }).HubSchema.apply(nk, logger);
  if (!captured) throw new Error('schema produced no SQL');
  return captured;
}

export interface TestDb {
  url: string;
  pool: pg.Pool;
  drop(): Promise<void>;
}

export async function freshDb(sql: string): Promise<TestDb> {
  const name = 'exchange_test_' + randomBytes(4).toString('hex');
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const url = ADMIN_URL.replace(/\/[^/]*$/, '/' + name);
  const pool = new pg.Pool({ connectionString: url, max: 20 });
  await pool.query(sql);
  return {
    url,
    pool,
    async drop() {
      await pool.end();
      const c = new pg.Client({ connectionString: ADMIN_URL });
      await c.connect();
      await c.query(`DROP DATABASE ${name} WITH (FORCE)`);
      await c.end();
    },
  };
}
