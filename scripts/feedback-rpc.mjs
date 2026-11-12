// The feedback admin RPCs from a terminal: one device session, one admin login, then
// rpc(id, body) adds the admin token. Shared by feedback-admin.mjs and feedback-worker.mjs.
//
// HUB_URL (default the local Nakama), NAKAMA_SERVER_KEY (the public client key the hub page ships,
// not the HTTP key), FEEDBACK_ADMIN_USER / FEEDBACK_ADMIN_PASS (default 333 / 333).
//
// The login is kept in FEEDBACK_TOKEN_CACHE (default ~/.feedback-worker/login-<hash>.json, mode
// 600) until it expires. The server allows 10 logins per device per ten minutes, and an agent
// working a check calls the CLI once per note, so logging in on every call would lock it out.
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export function feedbackConfig(env = process.env) {
  return {
    base: (env.HUB_URL ?? 'http://127.0.0.1:7350').replace(/\/$/, ''),
    serverKey: env.NAKAMA_SERVER_KEY ?? 'defaultkey',
    user: env.FEEDBACK_ADMIN_USER ?? '333',
    pass: env.FEEDBACK_ADMIN_PASS ?? '333',
    device: env.FEEDBACK_DEVICE_ID ?? 'feedback-admin-cli-000000',
    cache: env.FEEDBACK_TOKEN_CACHE,
  };
}

function cachePath(config) {
  if (config.cache === '') return null; // FEEDBACK_TOKEN_CACHE= turns the cache off
  if (config.cache) return config.cache;
  const key = createHash('sha256').update(`${config.base}|${config.user}|${config.device}`).digest('hex').slice(0, 16);
  return join(homedir(), '.feedback-worker', `login-${key}.json`);
}

export class RpcError extends Error {
  constructor(path, code, message) {
    super(`${path} ${code}: ${message ?? ''}`);
    this.code = code;
  }
}

/** A client that logs in on first use and once more when the admin token expires. */
export function feedbackClient(config = feedbackConfig(), fetchImpl = fetch) {
  let bearer = '';
  let token = '';
  const file = cachePath(config);
  if (file) {
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      // The admin token is "<user>:<exp>.<mac>"; keep it while it has a minute left.
      const exp = Number(String(saved.token).split(':').pop().split('.')[0]);
      if (saved.bearer && saved.token && exp * 1000 > Date.now() + 60000) ({ bearer, token } = saved);
    } catch {
      // No saved login yet.
    }
  }

  async function post(path, body, auth) {
    const response = await fetchImpl(config.base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) throw new RpcError(path, `http_${response.status}`, text.slice(0, 200));
    const parsed = text ? JSON.parse(text) : {};
    if (parsed.error) throw new RpcError(path, parsed.error, parsed.message);
    return parsed;
  }

  async function login() {
    const basic = `Basic ${Buffer.from(`${config.serverKey}:`).toString('base64')}`;
    const device = await post('/v2/account/authenticate/device?create=true', { id: config.device }, basic);
    bearer = `Bearer ${device.token}`;
    token = (await post('/v2/rpc/feedback.admin.login?unwrap=true', { user: config.user, pass: config.pass }, bearer)).token;
    if (file) {
      try {
        // Temp file and rename: a CLI call running beside this one never reads half a file.
        mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
        const temp = `${file}.${process.pid}.tmp`;
        writeFileSync(temp, JSON.stringify({ bearer, token }), { mode: 0o600 });
        chmodSync(temp, 0o600);
        renameSync(temp, file);
      } catch {
        // A read-only home: log in each time instead.
      }
    }
  }

  async function rpc(id, body = {}) {
    if (!token) await login();
    try {
      return await post(`/v2/rpc/${id}?unwrap=true`, { ...body, token }, bearer);
    } catch (error) {
      // A 12-hour admin token or the device session ran out: log in again once.
      if (error instanceof RpcError && (error.code === 'unauthorized' || error.code === 'http_401')) {
        await login();
        return post(`/v2/rpc/${id}?unwrap=true`, { ...body, token }, bearer);
      }
      throw error;
    }
  }

  return { rpc, login };
}
