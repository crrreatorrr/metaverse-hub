// Postgres-only economy suite (`npm run test:pg`).
//
// The duplication suite (`npm run test:dup`) needs the whole Nakama stack. This one needs only a
// Postgres 16 you can reach with `psql`: it loads the built module in the offline harness
// (server/test/unit/harness.ts) and routes every nk.sqlQuery / nk.sqlExec to that database, so the
// real migrations, SQL functions and RPC handlers run together. It covers what the hub's own
// economy functions decide (caps, idempotency, races between two connections); it does not cover
// Nakama's auth, sockets or storage.
//
//   HUB_PG_HOST (127.0.0.1)  HUB_PG_PORT (5432)  HUB_PG_USER (postgres)  PGPASSWORD (if needed)
//
// Each test file gets its own throwaway database (hub_pg_<name>), dropped and recreated per run.
// Never point this at a database you care about.
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadModule, type LoadedModule } from '../unit/harness';

const HOST = process.env.HUB_PG_HOST ?? '127.0.0.1';
const PORT = process.env.HUB_PG_PORT ?? '5432';
const USER = process.env.HUB_PG_USER ?? 'postgres';
const PSQL = ['-h', HOST, '-p', PORT, '-U', USER, '-v', 'ON_ERROR_STOP=1', '-X', '-q'];

export type Row = Record<string, string | null>;

function literal(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') return literal(JSON.stringify(value));
  return `'${String(value as string).replace(/'/g, "''")}'`;
}

/** Inlines `$n` parameters as SQL literals (psql has no bind protocol on stdin). Test input only. */
export function bind(sql: string, args: readonly unknown[]): string {
  let out = sql;
  for (let i = args.length; i >= 1; i -= 1) out = out.split(`$${i}`).join(literal(args[i - 1]));
  return out;
}

function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let any = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
      } else cell += c;
    } else if (c === '"') { quoted = true; any = true; }
    else if (c === ',') { row.push(cell); cell = ''; any = true; }
    else if (c === '\n') {
      if (any || cell) { row.push(cell); rows.push(row); }
      row = []; cell = ''; any = false;
    } else { cell += c; any = true; }
  }
  if (any || cell) { row.push(cell); rows.push(row); }
  const head = rows.shift() ?? [];
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? null])));
}

function psql(db: string, sql: string): string {
  return execFileSync('psql', [...PSQL, '-d', db, '--csv', '-f', '-'], {
    input: sql,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 64 << 20,
  });
}

export interface Pg {
  readonly db: string;
  readonly mod: LoadedModule;
  /** One statement, rows as text cells. */
  run(sql: string, args?: readonly unknown[]): Row[];
  /** The same on its own connection, without blocking this process: for races. */
  runAsync(sql: string, args?: readonly unknown[]): Promise<Row[]>;
  /** A second module instance on the same database (a restarted Nakama). */
  reload(): LoadedModule;
  /** server/test/dup/audit.sql: throws with the audit's message when an invariant is broken. */
  audit(): void;
}

// Stand-ins for the Nakama tables the hub's SQL reads. Nakama's own migrations create the real ones.
const NAKAMA_STUBS = `
  CREATE TABLE users (id uuid PRIMARY KEY, username text UNIQUE, display_name text, email text,
    custom_id text, create_time timestamptz DEFAULT now(), update_time timestamptz DEFAULT now(),
    disable_time timestamptz DEFAULT '1970-01-01', metadata jsonb DEFAULT '{}');
  CREATE TABLE storage (collection text, key text, user_id uuid, value jsonb, version text, read int, write int,
    create_time timestamptz DEFAULT now(), update_time timestamptz DEFAULT now(), PRIMARY KEY (collection, key, user_id));
  CREATE TABLE user_device (id text PRIMARY KEY, user_id uuid);`;

const AUDIT_SQL = readFileSync(fileURLToPath(new URL('../dup/audit.sql', import.meta.url)), 'utf8');

/** True when `psql` can reach the server. The runner skips the suite with a clear line when not. */
export function pgAvailable(): boolean {
  try {
    execFileSync('psql', [...PSQL, '-d', 'postgres', '-c', 'SELECT 1'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** Fresh database `hub_pg_<name>` with every migration applied by the real runner. */
export function freshPg(name: string, env?: Record<string, string>): Pg {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error('bad database name');
  const db = `hub_pg_${name}`;
  execFileSync('psql', [...PSQL, '-d', 'postgres', '-c', `DROP DATABASE IF EXISTS ${db}`], { stdio: 'pipe' });
  execFileSync('psql', [...PSQL, '-d', 'postgres', '-c', `CREATE DATABASE ${db}`], { stdio: 'pipe' });
  psql(db, NAKAMA_STUBS);
  const run = (sql: string, args: readonly unknown[] = []): Row[] => parseCsv(psql(db, bind(sql, args)));
  const load = (): LoadedModule => loadModule({ env, sql: [[() => true, (args, sql) => run(sql, args)]] });
  const mod = load();
  const errors = mod.logger.lines.filter((line) => line.level === 'error');
  if (errors.length) throw new Error(`module boot logged errors: ${errors.map((e) => e.message).join('; ').slice(0, 800)}`);
  return {
    db,
    mod,
    run,
    runAsync(sql, args = []) {
      return new Promise((resolve, reject) => {
        const child = spawn('psql', [...PSQL, '-d', db, '--csv', '-f', '-']);
        let out = '';
        let err = '';
        child.stdout.on('data', (d: Buffer) => { out += d.toString('utf8'); });
        child.stderr.on('data', (d: Buffer) => { err += d.toString('utf8'); });
        child.on('close', (code) => (code === 0 ? resolve(parseCsv(out)) : reject(new Error(err))));
        child.stdin.end(bind(sql, args));
      });
    },
    reload: load,
    audit() {
      psql(db, AUDIT_SQL);
    },
  };
}

// ---------------------------------------------------------------- fixtures

let counter = 0;
/** Deterministic test uuid: `kind` picks the 4th group so ids read apart in failures. */
export function uuid(kind = 0): string {
  counter += 1;
  return `00000000-0000-4000-8${String(kind).padStart(3, '0')}-${String(counter).padStart(12, '0')}`;
}

export function addUser(pg: Pg, username: string): string {
  const id = uuid(1);
  pg.run('INSERT INTO users (id, username) VALUES ($1::uuid, $2)', [id, username]);
  return id;
}

/**
 * Tickets as a finished earn would leave them: balance, one earn ledger row and its tickets.earn
 * idempotency row, so server/test/dup/audit.sql still balances. Skips the session and daily earn caps.
 */
export function seedTickets(pg: Pg, userId: string, game: string, amount: number): void {
  const key = `seed-${uuid(2)}`;
  pg.run(
    `WITH bal AS (
       INSERT INTO game.tickets_balance (user_id, game_id, balance) VALUES ($1::uuid, $2, $3)
       ON CONFLICT (user_id, game_id) DO UPDATE SET balance = game.tickets_balance.balance + EXCLUDED.balance
       RETURNING balance
     ), led AS (
       INSERT INTO game.tickets_ledger (event_id, user_id, game_id, delta, balance_after, reason, ref_id, kind)
       SELECT gen_random_uuid(), $1::uuid, $2, $3, balance, 'seed', NULL, 'earn' FROM bal
     )
     INSERT INTO game.idempotency (user_id, key, rpc, req_hash, response)
     VALUES ($1::uuid, $4, 'tickets.earn', decode('00', 'hex'), '{}'::jsonb)`,
    [userId, game, amount, key],
  );
}

/** An open, redeemed game session row (what portal.enter + ticket redeem leave). Closes any earlier one. */
export function openGameSession(pg: Pg, userId: string, game: string): string {
  const sid = uuid(3);
  pg.run("UPDATE game.game_session SET state = 'closed' WHERE user_id = $1::uuid AND state = 'open'", [userId]);
  pg.run(
    `INSERT INTO game.game_session (session_id, user_id, game_id, ranked, effects, ticket_jti, state, lease_until, ticket_exp, ticket_redeemed_at)
     VALUES ($1::uuid, $2::uuid, $3, false, '{}'::jsonb, gen_random_uuid(), 'open', now() + interval '6 hours', now() + interval '60 seconds', now())`,
    [sid, userId, game],
  );
  return sid;
}

/** Set a launch flag row the way the owner would in SQL, and drop this module's 5 s flag cache. */
export function setFlag(pg: Pg, key: string, state: 'on' | 'off', mod: LoadedModule = pg.mod): void {
  pg.run("UPDATE game.server_flags SET state = $2, updated_at = now() WHERE key = $1", [key, state]);
  for (const cached of [...mod.nk.localcache.keys()]) if (String(cached).startsWith('flag:')) mod.nk.localcache.delete(cached);
}

/** Give the account an email in the harness's fake Nakama accounts: HubChat.isGuest then says "not a guest". */
export function withEmail(pg: Pg, userId: string, mod: LoadedModule = pg.mod): string {
  mod.nk.accounts.set(userId, { user: { userId, username: `acct_${userId.slice(-6)}` }, email: `${userId.slice(-6)}@example.test` });
  return userId;
}

export const hubCtx = (userId: string) => ({ userId, vars: { scope: 'hub' } });
export const gameCtx = (userId: string, game: string, sid: string) => ({ userId, vars: { scope: 'game', game, sid, ranked: '0' } });

export function tickets(pg: Pg, userId: string, game: string): number {
  return Number(pg.run('SELECT COALESCE((SELECT balance FROM game.tickets_balance WHERE user_id = $1::uuid AND game_id = $2), 0) AS n', [userId, game])[0]?.n ?? 0);
}

export function verse(pg: Pg, userId: string): number {
  return Number(pg.run('SELECT COALESCE((SELECT balance FROM game.verse_wallet WHERE user_id = $1::uuid), 0) AS n', [userId])[0]?.n ?? 0);
}

export function count(pg: Pg, sql: string, args: readonly unknown[] = []): number {
  return Number(pg.run(`SELECT count(*) AS n FROM (${sql}) q`, args)[0]?.n ?? 0);
}
