import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const COMPOSE_FILE = path.join(ROOT, 'server/docker-compose.yml');
const BASE = process.env.NAKAMA_URL ?? 'http://127.0.0.1:7350';
const SERVER_KEY = 'defaultkey';
const HTTP_KEY = 'localhttpkey';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RpcBody {
  error?: string;
  message?: string;
  code?: string;
  token?: string;
  playerId?: string;
  granted?: string;
  ticket?: string;
  sessionId?: string;
  balance?: number;
  capped?: boolean;
  verse?: number;
  ticketsLeft?: number;
  receiptId?: string;
  userId?: string;
  restored?: boolean;
  scope?: string;
  relics?: string[];
  ok?: boolean;
}

export interface RpcResult {
  status: number;
  body: RpcBody;
}

export interface Guest {
  token: string;
  userId: string;
}

export interface GameLogin {
  hub: Guest;
  gameToken: string;
  sessionId: string;
}

const findings: string[] = [];

export function note(finding: string): void {
  findings.push(finding);
}

export function findingsList(): string[] {
  return [...findings];
}

export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}:${canonical(obj[key])}`).join(',')}}`;
}

export function sqlId(id: string): string {
  if (!UUID.test(id)) throw new Error(`refusing to interpolate "${id}"`);
  return id;
}

function composeArgs(args: string[]): string[] {
  return ['compose', '-f', COMPOSE_FILE, ...args];
}

export function compose(args: string[], timeoutMs = 180_000): string {
  return execFileSync('docker', composeArgs(args), {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: timeoutMs,
  });
}

export function psql(sql: string, database = 'nakama'): string {
  if (!/^[a-z_]+$/.test(database)) throw new Error(`bad database name ${database}`);
  return execFileSync(
    'docker',
    composeArgs([
      'exec', '-T', 'postgres',
      'psql', '-U', 'postgres', '-d', database,
      '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A',
      '-c', sql,
    ]),
    { cwd: ROOT, encoding: 'utf8', timeout: 30_000 },
  ).trim();
}

export function psqlFile(file: string): void {
  const sql = readFileSync(file, 'utf8');
  execFileSync(
    'docker',
    composeArgs([
      'exec', '-T', 'postgres',
      'psql', '-U', 'postgres', '-d', 'nakama',
      '-v', 'ON_ERROR_STOP=1', '-q',
      '-f', '-',
    ]),
    { cwd: ROOT, encoding: 'utf8', input: sql, timeout: 30_000 },
  );
}

export function audit(): void {
  const file = path.join(ROOT, 'server/test/dup/audit.sql');
  try {
    psqlFile(file);
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    const detail = `${err.stdout ?? ''}\n${err.stderr ?? ''}\n${err.message ?? ''}`.trim();
    throw new Error(detail);
  }
}

export function installFaultHooks(): void {
  psqlFile(path.join(ROOT, 'server/test/dup/fault-hooks.sql'));
}

export function dropFaultHooks(): void {
  psqlFile(path.join(ROOT, 'server/test/dup/fault-hooks-drop.sql'));
}

const POINT = /^[a-z0-9._]+$/;

export function arm(userId: string, point: string, mode: 'raise' | 'sleep'): void {
  if (!POINT.test(point)) throw new Error(`bad fault point ${point}`);
  psql(
    `INSERT INTO game.fault_arm (user_id, point, remaining, mode)
     VALUES ('${sqlId(userId)}', '${point}', 1, '${mode}')
     ON CONFLICT (user_id, point) DO UPDATE SET remaining = 1, mode = EXCLUDED.mode`,
  );
}

export function disarm(userId: string): void {
  psql(`DELETE FROM game.fault_arm WHERE user_id = '${sqlId(userId)}'`);
}

export function num(sql: string): number {
  const raw = psql(sql);
  if (!raw) return 0;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`not a number from SQL: ${raw}`);
  return value;
}

export function relicClaims(userId: string, relicId: string): number {
  return num(
    `SELECT count(*) FROM game.relic_claim WHERE user_id = '${sqlId(userId)}' AND relic_id = '${relicId}'`,
  );
}

export function mints(userId: string, relicId: string): number {
  return num(
    `SELECT count(*) FROM game.item_ledger WHERE user_id = '${sqlId(userId)}' AND item_id = '${relicId}' AND op = 'grant_relic'`,
  );
}

export function ticketBalance(userId: string, game: string): number {
  return num(
    `SELECT COALESCE((SELECT balance FROM game.tickets_balance WHERE user_id = '${sqlId(userId)}' AND game_id = '${game}'), 0)`,
  );
}

export function verseBalance(userId: string): number {
  return num(
    `SELECT COALESCE((SELECT balance FROM game.verse_wallet WHERE user_id = '${sqlId(userId)}'), 0)`,
  );
}

export function exchangeCount(userId: string): number {
  return num(`SELECT count(*) FROM game.exchange_tx WHERE user_id = '${sqlId(userId)}'`);
}

export function earnLedgerCount(userId: string): number {
  return num(
    `SELECT count(*) FROM game.tickets_ledger WHERE user_id = '${sqlId(userId)}' AND delta > 0`,
  );
}

export function serverDay(): string {
  return psql(`SELECT (now() AT TIME ZONE 'utc')::date`);
}

function authHeader(): string {
  return `Basic ${Buffer.from(`${SERVER_KEY}:`).toString('base64')}`;
}

function userIdFrom(token: string): string {
  const part = token.split('.')[1];
  if (!part) throw new Error('token has no payload');
  const json = JSON.parse(Buffer.from(part, 'base64url').toString()) as { uid?: string };
  if (!json.uid) throw new Error('token payload missing uid');
  return json.uid;
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function call(
  name: string,
  body: object,
  token?: string,
  opts?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<RpcResult> {
  const params = new URLSearchParams({ unwrap: 'true' });
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  else params.set('http_key', HTTP_KEY);
  const timeout = opts?.signal ?? AbortSignal.timeout(opts?.timeoutMs ?? 20_000);
  const response = await fetch(`${BASE}/v2/rpc/${encodeURIComponent(name)}?${params}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: timeout,
  });
  const text = await response.text();
  let parsed: RpcBody = {};
  if (text) {
    try {
      parsed = JSON.parse(text) as RpcBody;
    } catch {
      parsed = { message: text };
    }
  }
  return { status: response.status, body: parsed };
}

export function faulted(result: RpcResult): boolean {
  const blob = `${result.body.error ?? ''} ${result.body.message ?? ''}`;
  return result.status >= 500 || result.status === 0 || blob.includes('fault_injected');
}

export function assertConflict(result: RpcResult): void {
  const code = result.body.error;
  if (result.status === 409 || code === 'idempotency_mismatch') return;
  throw new Error(`expected idempotency conflict, got ${result.status} ${JSON.stringify(result.body)}`);
}

export function assertSame(results: RpcResult[]): void {
  if (!results.length) throw new Error('no responses');
  const status = results[0]?.status;
  const body = canonical(results[0]?.body);
  for (const result of results) {
    if (result.status !== status || canonical(result.body) !== body) {
      throw new Error(`response diverged:\n${body}\n${canonical(result.body)}`);
    }
  }
}

/**
 * Test stand-in for the client outbox. The live SDK does not retry; this
 * queue resubmits the same RPC body and idempotency key after a dropped
 * response or a 5xx.
 */
export async function outboxSend(
  name: string,
  body: object,
  token: string,
  opts?: { loseFirst?: boolean },
): Promise<RpcResult> {
  let lost = false;
  let last = 'no attempt';
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const result = await call(name, body, token);
      if (opts?.loseFirst && !lost && result.status < 400 && !result.body.error) {
        lost = true;
        continue;
      }
      if (result.status >= 500) throw new Error(`HTTP ${result.status} ${JSON.stringify(result.body)}`);
      return result;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
      await sleep(40 * (attempt + 1));
    }
  }
  throw new Error(`outbox gave up: ${last}`);
}

export async function authenticate(deviceId: string): Promise<Guest> {
  const response = await fetch(`${BASE}/v2/account/authenticate/device?create=true`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: deviceId }),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`auth ${response.status} ${text}`);
  const body = JSON.parse(text) as { token?: string };
  if (!body.token) throw new Error(text);
  return { token: body.token, userId: userIdFrom(body.token) };
}

export async function guest(): Promise<Guest> {
  return authenticate(crypto.randomUUID());
}

export interface CustomAuthResult {
  status: number;
  token?: string;
  body: string;
}

/** True once #25 registers the custom-auth before-hook. #22 still redeems with session.redeem. */
export function customAuthLanded(): boolean {
  const source = readFileSync(path.join(ROOT, 'server/modules/src/main.ts'), 'utf8');
  return source.includes('registerBeforeAuthenticateCustom');
}

/**
 * Game handoff. Nakama maps this route with `body: "account"`, so the JSON
 * body is `{ id, vars }` and `create` stays on the query string.
 */
export async function authenticateCustom(id: string | undefined, game?: string): Promise<CustomAuthResult> {
  const account: { id?: string; vars?: { game: string } } = {};
  if (id !== undefined) account.id = id;
  if (game) account.vars = { game };
  const response = await fetch(`${BASE}/v2/account/authenticate/custom?create=false`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify(account),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.text();
  let token: string | undefined;
  if (body) {
    try {
      const parsed = JSON.parse(body) as { token?: string };
      if (parsed.token) token = parsed.token;
    } catch {
      token = undefined;
    }
  }
  return { status: response.status, token, body };
}

export async function redeemPortalTicket(ticket: string, game: string): Promise<CustomAuthResult> {
  return authenticateCustom(`t:${ticket}`, game);
}

export async function openGame(hubToken: string, game: string): Promise<GameLogin> {
  const opened = await call('portal.enter', { game, ranked: false }, hubToken);
  if (opened.body.error || !opened.body.ticket || !opened.body.sessionId) {
    throw new Error(`portal.enter ${opened.status} ${JSON.stringify(opened.body)}`);
  }
  if (customAuthLanded()) {
    const redeemed = await redeemPortalTicket(opened.body.ticket, game);
    if (!redeemed.token) {
      throw new Error(`redeem ${redeemed.status} ${redeemed.body}`);
    }
    const userId = userIdFrom(hubToken);
    return { hub: { token: hubToken, userId }, gameToken: redeemed.token, sessionId: opened.body.sessionId };
  }
  const redeemed = await call('session.redeem', { ticket: opened.body.ticket, gameId: game });
  if (redeemed.body.error || !redeemed.body.token) {
    throw new Error(`session.redeem ${redeemed.status} ${JSON.stringify(redeemed.body)}`);
  }
  const userId = userIdFrom(hubToken);
  return { hub: { token: hubToken, userId }, gameToken: redeemed.body.token, sessionId: opened.body.sessionId };
}

export async function login(game: string): Promise<GameLogin> {
  const who = await guest();
  return openGame(who.token, game);
}

export async function waitReady(): Promise<void> {
  const deadline = Date.now() + 120_000;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const result = await call('healthcheck', {}, undefined, { timeoutMs: 3_000 });
      if (result.status < 400 && !result.body.error) return;
      last = `${result.status} ${JSON.stringify(result.body)}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(500);
  }
  throw new Error(`Nakama did not become ready: ${last}`);
}

export async function ensureNakama(): Promise<void> {
  try {
    const result = await call('healthcheck', {}, undefined, { timeoutMs: 2_000 });
    if (result.status < 400 && !result.body.error) return;
  } catch {
    // The process was killed. Start it again below.
  }
  compose(['up', '-d', '--no-build', '--wait', '--wait-timeout', '90', 'nakama']);
  await waitReady();
}

function faultName(userId: string, point: string): string {
  if (!/^[a-z0-9._]+$/.test(point)) throw new Error(`bad fault point ${point}`);
  return `hf:${sqlId(userId)}:${point}`;
}

/** Cancel a sleep left behind by a killed Nakama. Postgres can finish pg_sleep after the client dies. */
export function terminateFaultSleeps(except?: string): void {
  const filter = except ? ` AND application_name <> '${except}'` : '';
  psql(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name LIKE 'hf:%'${filter}`);
}

/**
 * Kill the Nakama process while this user's fault sleep is in progress.
 * Returns the effect count observed during that sleep, before the signal.
 * The postgres backend is terminated too: a dead client does not cancel pg_sleep,
 * so the statement can still commit after the process is gone.
 */
export async function killDuringSleep(
  inflight: Promise<RpcResult>,
  userId: string,
  point: string,
  effect: () => number,
): Promise<number> {
  const name = faultName(userId, point);
  terminateFaultSleeps(name);
  const deadline = Date.now() + 15_000;
  let during = -1;
  let pid = '';
  try {
    while (Date.now() < deadline) {
      pid = psql(
        `SELECT COALESCE((SELECT pid::text FROM pg_stat_activity WHERE application_name = '${name}' AND wait_event = 'PgSleep' LIMIT 1), '')`,
      );
      if (pid) {
        during = effect();
        break;
      }
      await sleep(50);
    }
    if (!pid || during < 0) {
      const finished = await inflight.catch((error: unknown) => error);
      throw new Error(`fault sleep ${point} never started (${String(finished)})`);
    }
    psql(`SELECT pg_terminate_backend(${pid})`);
    const id = execFileSync('docker', composeArgs(['ps', '-q', 'nakama']), {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
    execFileSync('docker', ['kill', id], { cwd: ROOT, encoding: 'utf8' });
    await Promise.race([inflight.catch(() => undefined), sleep(8_000)]);
  } finally {
    terminateFaultSleeps();
    await ensureNakama();
  }
  return during;
}

export async function earn(token: string, amount: number, reason: string, key: string): Promise<RpcResult> {
  const result = await call('tickets.earn', { amount, reason, key }, token);
  if (result.body.error || result.status >= 400) {
    throw new Error(`tickets.earn ${result.status} ${JSON.stringify(result.body)}`);
  }
  return result;
}

export function snapshotEconomy(userId: string, game: string): string {
  return [
    `claims=${num(`SELECT count(*) FROM game.relic_claim WHERE user_id = '${sqlId(userId)}'`)}`,
    `mints=${num(`SELECT count(*) FROM game.item_ledger WHERE user_id = '${sqlId(userId)}' AND op = 'grant_relic'`)}`,
    `tickets=${ticketBalance(userId, game)}`,
    `verse=${verseBalance(userId)}`,
    `exchanges=${exchangeCount(userId)}`,
  ].join(' ');
}
