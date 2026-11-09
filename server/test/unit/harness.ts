// Offline harness for the Nakama JS module (Contract C11).
//
//   const mod = loadModule();                    // builds once per process, runs InitModule
//   mod.call('hub.join', { userId, vars: { scope: 'hub' } }, {})   // → parsed RPC answer
//   const m = mod.startMatch('hub', { shard: '1' });                // drive a registered match
//   m.join([presence], { scope: 'hub' }); m.loop([{ sender, opCode, data }]);
//
// The module runs in node:vm with only ES built-ins (like goja: no TextEncoder,
// fetch, setTimeout or console). `nk` is a scripted fake: SQL answers come from
// handlers you add with `mod.nk.onSql(pattern, answer)`; localcache throws on
// object values like the real one; storage keeps OCC versions.
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { vendorChunk } from '../../modules/append-vendor.mjs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
export const MODULE_DIR = resolve(here, '../../modules');

let built: string | null = null;

/** tsc + append-vendor into a temp outFile. Cached per process; HUB_MODULE_JS reuses a prebuilt file. */
export function buildModule(): string {
  if (built) return built;
  if (process.env.HUB_MODULE_JS) {
    built = resolve(process.env.HUB_MODULE_JS);
    return built;
  }
  const out = join(mkdtempSync(join(tmpdir(), 'hub-module-')), 'index.js');
  const tsc = resolve(MODULE_DIR, '../../node_modules/typescript/bin/tsc');
  execFileSync(process.execPath, [join(MODULE_DIR, 'embed-shop.mjs')], { stdio: 'pipe' });
  execFileSync(process.execPath, [tsc, '-p', join(MODULE_DIR, 'tsconfig.json'), '--outFile', out], { stdio: 'inherit' });
  for (const name of readdirSync(join(MODULE_DIR, 'vendor')).filter((n) => n.endsWith('.js')).sort()) {
    appendFileSync(out, vendorChunk(name, readFileSync(join(MODULE_DIR, 'vendor', name), 'utf8')));
  }
  built = out;
  return out;
}

// ---------------------------------------------------------------- lexical check

export interface RegistrationIssue { line: number; text: string; problem: string }

/**
 * Nakama finds hook registrations by parsing InitModule: every `initializer.register*`
 * call must sit lexically inside InitModule and each handler argument must name a
 * top-level function declaration. Offline stand-in for Nakama's own check.
 */
export function checkRegistrations(source: string): { issues: RegistrationIssue[]; calls: number } {
  const file = ts.createSourceFile('index.js', source, ts.ScriptTarget.ES5, true, ts.ScriptKind.JS);
  const topFunctions = new Set<string>();
  let init: ts.FunctionDeclaration | null = null;
  for (const stmt of file.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      topFunctions.add(stmt.name.text);
      if (stmt.name.text === 'InitModule') init = stmt;
    }
  }
  const issues: RegistrationIssue[] = [];
  let calls = 0;
  const lineOf = (node: ts.Node) => file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
  const insideInit = (node: ts.Node) => {
    for (let p: ts.Node | undefined = node.parent; p; p = p.parent) if (p === init) return true;
    return false;
  };
  const checkHandler = (call: ts.CallExpression, arg: ts.Expression, label: string) => {
    if (ts.isIdentifier(arg)) {
      if (!topFunctions.has(arg.text)) issues.push({ line: lineOf(call), text: call.getText(file).slice(0, 120), problem: `${label} ${arg.text} is not a top-level function` });
    } else {
      issues.push({ line: lineOf(call), text: call.getText(file).slice(0, 120), problem: `${label} is not an identifier` });
    }
  };
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      /^register/.test(node.expression.name.text) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'initializer'
    ) {
      calls += 1;
      const name = node.expression.name.text;
      if (!init || !insideInit(node)) {
        issues.push({ line: lineOf(node), text: node.getText(file).slice(0, 120), problem: 'registration outside InitModule' });
      }
      const args = node.arguments;
      if (name === 'registerMatch') {
        const obj = args[1];
        if (!obj || !ts.isObjectLiteralExpression(obj)) {
          issues.push({ line: lineOf(node), text: node.getText(file).slice(0, 120), problem: 'registerMatch handler is not an object literal' });
        } else {
          for (const prop of obj.properties) {
            if (ts.isPropertyAssignment(prop)) checkHandler(node, prop.initializer, `match handler ${prop.name.getText(file)}`);
            else issues.push({ line: lineOf(node), text: node.getText(file).slice(0, 120), problem: 'match handler property is not key: identifier' });
          }
        }
      } else if (name === 'registerRpc' || name === 'registerRtBefore' || name === 'registerRtAfter') {
        if (args[1]) checkHandler(node, args[1], name);
      } else if (args[0]) {
        checkHandler(node, args[0], name);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!init) issues.push({ line: 0, text: '', problem: 'no top-level InitModule' });
  return { issues, calls };
}

// ---------------------------------------------------------------- fake runtime

export interface LoggedLine { level: 'info' | 'warn' | 'error' | 'debug'; message: string }
export interface Presence { userId: string; sessionId: string; username: string; node: string }
export interface Broadcast { opCode: number; data: string; presences: Presence[] | null; sender: Presence | null; reliable: boolean }
export type SqlAnswer = Record<string, unknown>[] | ((args: unknown[], sql: string) => Record<string, unknown>[]);
export type SqlPattern = RegExp | string | ((sql: string) => boolean);

export interface FakeDispatcher {
  broadcasts: Broadcast[];
  kicks: Presence[][];
  labels: string[];
  broadcastMessage(opCode: number, data: unknown, presences?: Presence[] | null, sender?: Presence | null, reliable?: boolean): void;
  broadcastMessageDeferred(opCode: number, data: unknown, presences?: Presence[] | null, sender?: Presence | null, reliable?: boolean): void;
  matchKick(presences: Presence[]): void;
  matchLabelUpdate(label: string): void;
  /** Broadcasts with this opcode, JSON-parsed. */
  sent<T = unknown>(opCode: number): { body: T; to: Presence[] | null }[];
  clear(): void;
}

export function makeDispatcher(onLabel?: (label: string) => void): FakeDispatcher {
  const d: FakeDispatcher = {
    broadcasts: [],
    kicks: [],
    labels: [],
    broadcastMessage(opCode, data, presences, sender, reliable) {
      // Like Nakama: an empty list would reach the whole match, so treat it as a bug here;
      // a routed presence needs its user, session and node.
      if (Array.isArray(presences)) {
        if (presences.length === 0) throw new Error('broadcastMessage with an empty presence list reaches everyone');
        for (const p of presences) {
          if (!p || !p.userId || !p.sessionId || !p.node) throw new Error(`broadcastMessage presence without userId/sessionId/node: ${JSON.stringify(p)}`);
        }
      }
      let text: string;
      if (typeof data === 'string') text = data;
      else if (data instanceof ArrayBuffer || (data && typeof (data as ArrayBuffer).byteLength === 'number')) text = Buffer.from(data as ArrayBuffer).toString('utf8');
      else if (data === null || data === undefined) text = '';
      else throw new Error('broadcastMessage data must be a string or ArrayBuffer');
      d.broadcasts.push({ opCode, data: text, presences: presences ?? null, sender: sender ?? null, reliable: reliable !== false });
    },
    broadcastMessageDeferred(opCode, data, presences, sender, reliable) {
      d.broadcastMessage(opCode, data, presences, sender, reliable);
    },
    matchKick(presences) {
      d.kicks.push(presences);
    },
    matchLabelUpdate(label) {
      d.labels.push(label);
      onLabel?.(label);
    },
    sent<T>(opCode: number) {
      return d.broadcasts.filter((b) => b.opCode === opCode).map((b) => ({ body: (b.data ? JSON.parse(b.data) : null) as T, to: b.presences }));
    },
    clear() {
      d.broadcasts.length = 0;
      d.kicks.length = 0;
      d.labels.length = 0;
    },
  };
  return d;
}

/** `+label.kind:hub +label.open:T +label.players:<90` against a JSON label (subset of Bleve). */
export function labelMatches(label: string, query: string | null | undefined): boolean {
  if (!query || !query.trim() || query.trim() === '*') return true;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(label) as Record<string, unknown>;
  } catch {
    return false;
  }
  for (const term of query.trim().split(/\s+/)) {
    const m = /^([+-]?)label\.([A-Za-z0-9_]+):(.*)$/.exec(term);
    if (!m) continue;
    const [, sign, key, value] = m as unknown as [string, string, string, string];
    const actual = parsed[key];
    let ok: boolean;
    if (/^[<>]=?/.test(value)) {
      const n = Number(value.replace(/^[<>]=?/, ''));
      const a = Number(actual);
      ok = value.startsWith('<=') ? a <= n : value.startsWith('>=') ? a >= n : value.startsWith('<') ? a < n : a > n;
    } else if (value === 'T' || value === 'F') {
      ok = actual === (value === 'T');
    } else {
      ok = String(actual) === value;
    }
    if (sign === '+' && !ok) return false;
    if (sign === '-' && ok) return false;
  }
  return true;
}

interface Registered {
  rpcs: Map<string, (ctx: unknown, logger: unknown, nk: unknown, payload: string) => string>;
  matches: Map<string, Record<string, (...args: unknown[]) => unknown>>;
  rtBefore: Map<string, (ctx: unknown, logger: unknown, nk: unknown, env: unknown) => unknown>;
  matchmakerMatched: ((ctx: unknown, logger: unknown, nk: unknown, matches: unknown[]) => unknown) | null;
  other: Map<string, unknown>;
}

export interface FakeMatch {
  matchId: string;
  module: string;
  state: unknown;
  label: string;
  tickRate: number;
  tick: number;
  presences: Map<string, Presence>;
  dispatcher: FakeDispatcher;
  ended: boolean;
  createdAt: number;
}

export interface CtxInput {
  userId?: string;
  username?: string;
  sessionId?: string;
  vars?: Record<string, string> | null;
  env?: Record<string, string>;
  matchId?: string;
}

export interface MatchDriver {
  readonly match: FakeMatch;
  readonly dispatcher: FakeDispatcher;
  readonly state: unknown;
  joinAttempt(presence: Presence, ctx?: CtxInput, metadata?: Record<string, string>): { accept: boolean; rejectMessage?: string };
  /** joinAttempt + join; returns the joinAttempt verdict. */
  join(presences: Presence[], ctx?: CtxInput, metadata?: Record<string, string>): { accept: boolean; rejectMessage?: string }[];
  leave(presences: Presence[]): void;
  loop(messages?: { sender: Presence; opCode: number; data: string | object | Uint8Array }[]): boolean;
  /** Run `count` empty loop ticks. */
  ticks(count: number): boolean;
  signal(data: string): string | undefined;
  /**
   * matchTerminate, then (like Nakama during shutdown_grace_sec) keep calling matchLoop up to
   * `graceLoops` times until it returns null.
   */
  terminate(graceSeconds?: number, graceLoops?: number): void;
}

export interface FakeNakama {
  sqlCalls: { sql: string; args: unknown[]; kind: 'query' | 'exec' }[];
  onSql(pattern: SqlPattern, answer: SqlAnswer): void;
  localcache: Map<string, string | number | boolean>;
  storage: Map<string, { value: Record<string, unknown>; version: string; permissionRead: number; permissionWrite: number }>;
  accounts: Map<string, Record<string, unknown>>;
  notifications: { userId: string; subject: string; content: unknown; code: number }[];
  friends: Map<string, { friends: { user: { userId: string; username: string }; state: number }[] }>;
  matches: Map<string, FakeMatch>;
  signals: { matchId: string; data: string }[];
  /** Real Nakama lists a new match only ~1 s after matchCreate; set > 0 to emulate it. */
  listLagMs: number;
  [method: string]: unknown;
}

export interface LoadedModule {
  global: Record<string, unknown>;
  /** Present when loadModule({ clock }) was used: the module's Date.now(). Each loop adds 1000/tickRate ms. */
  clock: { now: number } | null;
  nk: FakeNakama;
  logger: { lines: LoggedLine[]; info(m: string): void; warn(m: string): void; error(m: string): void; debug(m: string): void };
  initializer: Record<string, (...args: unknown[]) => void>;
  registered: Registered;
  ctx(input?: CtxInput): Record<string, unknown>;
  makeDispatcher: typeof makeDispatcher;
  /** Calls a registered RPC: returns the parsed JSON answer (or the raw string when it is not JSON). */
  call<T = Record<string, unknown>>(rpcId: string, ctx: CtxInput, body?: unknown): T;
  /** Runs a registered RT before-hook; returns the (possibly rewritten) envelope or throws. */
  rtBefore(id: string, ctx: CtxInput, envelope: Record<string, unknown>): Record<string, unknown>;
  /** Runs the registered matchmaker hook. */
  matchmake(matches: { presence: Presence; properties: Record<string, string | number> }[]): string | undefined;
  /** Creates a match of a registered module (through nk.matchCreate) and returns a driver. */
  startMatch(module: string, params?: Record<string, string>): MatchDriver;
  driver(matchId: string): MatchDriver;
  source: string;
}

export function presence(userId: string, username = userId, sessionId = `s-${userId}`): Presence {
  return { userId, sessionId, username, node: 'nakama' };
}

export interface LoadOptions {
  /** Skip calling InitModule. */
  noInit?: boolean;
  env?: Record<string, string>;
  /** SQL handlers installed before InitModule runs. */
  sql?: [SqlPattern, SqlAnswer][];
  /** Fake wall clock (ms) for the module's Date.now(); every match loop advances it by one tick. */
  clock?: number;
  /** Copy match state through JSON between callbacks, as Nakama hands plain state back. */
  jsonState?: boolean;
}

export function loadModule(opts: LoadOptions = {}): LoadedModule {
  const file = buildModule();
  const source = readFileSync(file, 'utf8');
  const context = vm.createContext({});
  const clock = typeof opts.clock === 'number' ? { now: opts.clock } : null;
  if (clock) {
    (context as Record<string, unknown>).__hubFakeNow = () => clock.now;
    vm.runInContext('Date.now = function () { return __hubFakeNow(); };', context);
  }
  vm.runInContext(source, context, { filename: 'index.js' });
  const global = context as Record<string, unknown>;

  const logger = {
    lines: [] as LoggedLine[],
    info(m: string) { logger.lines.push({ level: 'info', message: m }); },
    warn(m: string) { logger.lines.push({ level: 'warn', message: m }); },
    error(m: string) { logger.lines.push({ level: 'error', message: m }); },
    debug(m: string) { logger.lines.push({ level: 'debug', message: m }); },
  };

  const registered: Registered = { rpcs: new Map(), matches: new Map(), rtBefore: new Map(), matchmakerMatched: null, other: new Map() };
  const initializer: Record<string, (...args: unknown[]) => void> = new Proxy({}, {
    get(_t, prop: string) {
      return (...args: unknown[]) => {
        if (prop === 'registerRpc') {
          if (registered.rpcs.has(args[0] as string)) throw new Error(`duplicate rpc ${String(args[0])}`);
          registered.rpcs.set(args[0] as string, args[1] as never);
        } else if (prop === 'registerMatch') {
          if (registered.matches.has(args[0] as string)) throw new Error(`duplicate match ${String(args[0])}`);
          registered.matches.set(args[0] as string, args[1] as never);
        } else if (prop === 'registerRtBefore') {
          registered.rtBefore.set(args[0] as string, args[1] as never);
        } else if (prop === 'registerMatchmakerMatched') {
          if (registered.matchmakerMatched) throw new Error('only one matchmaker hook');
          registered.matchmakerMatched = args[0] as never;
        } else {
          registered.other.set(prop, args[0]);
        }
      };
    },
  }) as Record<string, (...args: unknown[]) => void>;

  const handlers: { pattern: SqlPattern; answer: SqlAnswer }[] = [];
  const matchesTest = (pattern: SqlPattern, sql: string) =>
    typeof pattern === 'string' ? sql.includes(pattern) : pattern instanceof RegExp ? pattern.test(sql) : pattern(sql);
  const answer = (sql: string, args: unknown[]) => {
    for (let i = handlers.length - 1; i >= 0; i -= 1) {
      const h = handlers[i]!;
      if (matchesTest(h.pattern, sql)) return typeof h.answer === 'function' ? h.answer(args, sql) : h.answer;
    }
    return [];
  };

  const env = { TICKET_HMAC_KEY: 'test-ticket-key', RECOVERY_PEPPER: 'test-pepper', AUDIT_KEY: 'test-audit', ...(opts.env ?? {}) };
  const makeCtx = (input: CtxInput = {}): Record<string, unknown> => ({
    userId: input.userId,
    username: input.username ?? input.userId,
    sessionId: input.sessionId,
    vars: input.vars === undefined ? null : input.vars,
    env: input.env ?? env,
    matchId: input.matchId,
    node: 'nakama',
    executionMode: 'rpc',
  });

  const fakeMatches = new Map<string, FakeMatch>();
  let storageVersion = 0;
  const nk: FakeNakama = {
    sqlCalls: [],
    onSql(pattern, ans) {
      handlers.push({ pattern, answer: ans });
    },
    localcache: new Map(),
    storage: new Map(),
    accounts: new Map(),
    notifications: [],
    friends: new Map(),
    matches: fakeMatches,
    signals: [],
    listLagMs: 0,
    sqlQuery(sql: string, args: unknown[]) {
      nk.sqlCalls.push({ sql, args, kind: 'query' });
      return answer(sql, args);
    },
    sqlExec(sql: string, args: unknown[]) {
      nk.sqlCalls.push({ sql, args, kind: 'exec' });
      const rows = answer(sql, args);
      return { rowsAffected: rows.length };
    },
    uuidv4: () => randomUUID(),
    sha256Hash: (input: string) => createHash('sha256').update(input, 'utf8').digest('hex'),
    accountGetId(userId: string) {
      return nk.accounts.get(userId) ?? { user: { userId, username: `user_${userId.slice(0, 6)}` } };
    },
    usersGetId(ids: string[]) {
      return ids.map((id) => {
        const a = nk.accounts.get(id) as { user?: { username?: string } } | undefined;
        return { userId: id, username: a?.user?.username ?? `user_${id.slice(0, 6)}` };
      });
    },
    usersGetUsername(names: string[]) {
      return names.map((n) => ({ userId: `id-${n}`, username: n }));
    },
    accountUpdateId() {},
    linkEmail() {},
    linkCustom() {},
    linkDevice() {},
    unlinkDevice() {},
    authenticateTokenGenerate(userId: string) {
      return { token: `token-${userId}`, exp: 0 };
    },
    localcacheGet(key: string) {
      return nk.localcache.has(key) ? nk.localcache.get(key) : null;
    },
    localcachePut(key: string, value: unknown) {
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        throw new Error('TypeError: expects value to be string, numeric or boolean');
      }
      nk.localcache.set(key, value);
    },
    localcacheDelete(key: string) {
      nk.localcache.delete(key);
    },
    binaryToString(data: ArrayBuffer) {
      return Buffer.from(data).toString('utf8');
    },
    stringToBinary(text: string) {
      const buf = Buffer.from(text, 'utf8');
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
    notificationSend(userId: string, subject: string, content: unknown, code: number) {
      nk.notifications.push({ userId, subject, content, code });
    },
    friendsList(userId: string, _limit?: number, state?: number | null) {
      const list = nk.friends.get(userId) ?? { friends: [] };
      return { friends: list.friends.filter((f) => state === undefined || state === null || f.state === state) };
    },
    storageRead(keys: { collection: string; key: string; userId: string }[]) {
      const out: unknown[] = [];
      for (const k of keys) {
        const row = nk.storage.get(`${k.collection}/${k.key}/${k.userId}`);
        if (row) out.push({ collection: k.collection, key: k.key, userId: k.userId, value: JSON.parse(JSON.stringify(row.value)), version: row.version, permissionRead: row.permissionRead, permissionWrite: row.permissionWrite, createTime: 0, updateTime: 0 });
      }
      return out;
    },
    storageWrite(objects: { collection: string; key: string; userId: string; value: Record<string, unknown>; version?: string; permissionRead?: number; permissionWrite?: number }[]) {
      // All-or-nothing, like Nakama's multi-object write.
      for (const o of objects) {
        const id = `${o.collection}/${o.key}/${o.userId}`;
        const row = nk.storage.get(id);
        if (o.version === '*' && row) throw new Error('Storage write rejected - version check failed.');
        if (o.version && o.version !== '*' && (!row || row.version !== o.version)) throw new Error('Storage write rejected - version check failed.');
      }
      return objects.map((o) => {
        storageVersion += 1;
        const version = `v${storageVersion}`;
        nk.storage.set(`${o.collection}/${o.key}/${o.userId}`, {
          value: JSON.parse(JSON.stringify(o.value)),
          version,
          permissionRead: o.permissionRead ?? 1,
          permissionWrite: o.permissionWrite ?? 1,
        });
        return { collection: o.collection, key: o.key, userId: o.userId, version };
      });
    },
    storageList(userId: string | null, collection: string, limit?: number, _cursor?: string) {
      const objects: unknown[] = [];
      for (const [id, row] of nk.storage) {
        const [c, k, u] = id.split('/') as [string, string, string];
        if (c !== collection || (userId && u !== userId)) continue;
        objects.push({ collection: c, key: k, userId: u, value: JSON.parse(JSON.stringify(row.value)), version: row.version, permissionRead: row.permissionRead, permissionWrite: row.permissionWrite, createTime: 0, updateTime: 0 });
        if (limit && objects.length >= limit) break;
      }
      return { objects, cursor: '' };
    },
    storageDelete(objects: { collection: string; key: string; userId: string }[]) {
      for (const o of objects) nk.storage.delete(`${o.collection}/${o.key}/${o.userId}`);
    },
    matchCreate(module: string, params: Record<string, unknown>) {
      const h = registered.matches.get(module);
      if (!h) throw new Error(`no match module ${module}`);
      const matchId = `${randomUUID()}.nakama`;
      const init = h.matchInit!(makeCtx({ matchId }), logger, nk, params ?? {}) as { state: unknown; tickRate: number; label: string };
      const match: FakeMatch = {
        matchId,
        module,
        state: init.state,
        label: init.label ?? '',
        tickRate: init.tickRate,
        tick: 0,
        presences: new Map(),
        dispatcher: makeDispatcher((label) => {
          match.label = label;
        }),
        ended: false,
        createdAt: Date.now(),
      };
      fakeMatches.set(matchId, match);
      return matchId;
    },
    matchGet(id: string) {
      const m = fakeMatches.get(id);
      if (!m || m.ended) return null;
      return { matchId: m.matchId, authoritative: true, label: m.label, size: m.presences.size, tickRate: m.tickRate, handlerName: m.module };
    },
    matchList(limit: number, _authoritative?: boolean | null, label?: string | null, minSize?: number | null, maxSize?: number | null, query?: string | null) {
      const out: unknown[] = [];
      for (const m of fakeMatches.values()) {
        if (m.ended) continue;
        if (nk.listLagMs > 0 && Date.now() - m.createdAt < nk.listLagMs) continue;
        if (label !== null && label !== undefined && label !== '' && m.label !== label) continue;
        if (minSize !== null && minSize !== undefined && m.presences.size < minSize) continue;
        if (maxSize !== null && maxSize !== undefined && m.presences.size > maxSize) continue;
        if (!labelMatches(m.label, query)) continue;
        out.push({ matchId: m.matchId, authoritative: true, label: m.label, size: m.presences.size, tickRate: m.tickRate, handlerName: m.module });
        if (out.length >= limit) break;
      }
      return out;
    },
    matchSignal(id: string, data: string) {
      nk.signals.push({ matchId: id, data });
      const m = fakeMatches.get(id);
      if (!m || m.ended) throw new Error('match not found');
      return driverFor(m).signal(data) ?? '';
    },
  } as FakeNakama;

  for (const [pattern, ans] of opts.sql ?? []) nk.onSql(pattern, ans);

  function driverFor(match: FakeMatch): MatchDriver {
    const h = registered.matches.get(match.module)!;
    const d = match.dispatcher;
    const step = (name: string, ...rest: unknown[]) => {
      const res = h[name]!(makeCtx({ matchId: match.matchId }), logger, nk, d, match.tick, match.state, ...rest) as { state: unknown } | null;
      if (res === null || res === undefined) {
        match.ended = true;
        return null;
      }
      match.state = opts.jsonState ? JSON.parse(JSON.stringify(res.state)) : res.state;
      return res;
    };
    return {
      match,
      dispatcher: d,
      get state() { return match.state; },
      joinAttempt(p, ctx, metadata) {
        const res = h.matchJoinAttempt!(makeCtx({ userId: p.userId, sessionId: p.sessionId, username: p.username, matchId: match.matchId, ...(ctx ?? {}) }), logger, nk, d, match.tick, match.state, p, metadata ?? {}) as { state: unknown; accept: boolean; rejectMessage?: string } | null;
        if (!res) return { accept: false, rejectMessage: 'match_ended' };
        match.state = opts.jsonState ? JSON.parse(JSON.stringify(res.state)) : res.state;
        return { accept: res.accept, rejectMessage: res.rejectMessage };
      },
      join(presences, ctx, metadata) {
        const verdicts = presences.map((p) => this.joinAttempt(p, ctx, metadata));
        const accepted = presences.filter((_p, i) => verdicts[i]!.accept);
        if (accepted.length) {
          for (const p of accepted) match.presences.set(p.sessionId, p);
          step('matchJoin', accepted);
        }
        return verdicts;
      },
      leave(presences) {
        for (const p of presences) match.presences.delete(p.sessionId);
        step('matchLeave', presences);
      },
      loop(messages = []) {
        match.tick += 1;
        if (clock) clock.now += 1000 / (match.tickRate || 1);
        const wire = messages.map((m) => ({
          sender: m.sender,
          opCode: m.opCode,
          // Raw bytes stay raw (binary INPUT); a string or object goes through utf8 like a JSON frame.
          data: m.data instanceof Uint8Array
            ? m.data.buffer.slice(m.data.byteOffset, m.data.byteOffset + m.data.byteLength)
            : (nk.stringToBinary as (t: string) => ArrayBuffer)(typeof m.data === 'string' ? m.data : JSON.stringify(m.data)),
          reliable: true,
          receiveTimeMs: 0,
        }));
        return step('matchLoop', wire) !== null;
      },
      ticks(count) {
        for (let i = 0; i < count; i += 1) if (!this.loop([])) return false;
        return true;
      },
      signal(data) {
        const res = h.matchSignal!(makeCtx({ matchId: match.matchId }), logger, nk, d, match.tick, match.state, data) as { state: unknown; data?: string } | null;
        if (!res) {
          match.ended = true;
          return undefined;
        }
        match.state = opts.jsonState ? JSON.parse(JSON.stringify(res.state)) : res.state;
        return res.data;
      },
      terminate(grace = 0, graceLoops = 0) {
        step('matchTerminate', grace);
        for (let i = 0; i < graceLoops && !match.ended; i += 1) this.loop([]);
        match.ended = true;
      },
    };
  }

  const loaded: LoadedModule = {
    global,
    clock,
    nk,
    logger,
    initializer,
    registered,
    ctx: makeCtx,
    makeDispatcher,
    source,
    call<T>(rpcId: string, ctx: CtxInput, body?: unknown): T {
      const fn = registered.rpcs.get(rpcId);
      if (!fn) throw new Error(`no rpc ${rpcId}`);
      const raw = fn(makeCtx(ctx), logger, nk, body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body));
      try {
        return JSON.parse(raw) as T;
      } catch {
        return raw as unknown as T;
      }
    },
    rtBefore(id, ctx, envelope) {
      const fn = registered.rtBefore.get(id);
      if (!fn) throw new Error(`no rt before hook ${id}`);
      return fn(makeCtx(ctx), logger, nk, envelope) as Record<string, unknown>;
    },
    matchmake(matches) {
      if (!registered.matchmakerMatched) throw new Error('no matchmaker hook');
      return registered.matchmakerMatched(makeCtx({}), logger, nk, matches) as string | undefined;
    },
    startMatch(module, params) {
      const id = (nk.matchCreate as (m: string, p: Record<string, string>) => string)(module, params ?? {});
      return driverFor(fakeMatches.get(id)!);
    },
    driver(matchId) {
      const m = fakeMatches.get(matchId);
      if (!m) throw new Error(`no match ${matchId}`);
      return driverFor(m);
    },
  };

  if (!opts.noInit) {
    const init = global.InitModule as (ctx: unknown, logger: unknown, nk: unknown, initializer: unknown) => void;
    if (typeof init !== 'function') throw new Error('InitModule is not a top-level function');
    init(makeCtx({}), logger, nk, initializer);
  }
  return loaded;
}

/** Copy a value out of the vm realm (arrays/objects from the module fail deepStrictEqual's prototype check). */
export function plain<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}
