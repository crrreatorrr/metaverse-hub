import { HubSdkError } from './errors';
import { base64UrlToBytes } from './ticket';

/**
 * Local compose origin. Credentials are not embedded: the app passes `serverKey`
 * (dev builds inject the compose server key). The HTTP key is not a client credential.
 */
export const LOCAL_NAKAMA = {
  serverUrl: 'http://127.0.0.1:7350',
  serverKey: '',
  /** Kept so older callers still typecheck. Ignored. Never sent. */
  httpKey: '',
} as const;

export interface NakamaRpcOptions {
  token?: string;
  /**
   * Accepted and ignored. `createNakamaClient` does not send an HTTP key.
   * An injected test double may still observe the flag.
   */
  httpKey?: boolean;
  keepalive?: boolean;
}

export interface CustomAuthResult {
  token: string;
  refreshToken: string;
  userId: string;
}

export interface NakamaClient {
  authenticateDevice(deviceId: string, vars?: Record<string, string>): Promise<{ token: string; userId: string }>;
  /**
   * Optional so existing test doubles that only stub `rpc` still typecheck.
   * `createNakamaClient` always implements it.
   */
  authenticateCustom?(id: string, create?: boolean, vars?: Record<string, string>): Promise<CustomAuthResult>;
  rpc<T>(id: string, body: object, opts?: NakamaRpcOptions): Promise<T>;
}

export interface NakamaClientOptions {
  serverUrl: string;
  serverKey?: string;
  /** Accepted and ignored. The client never sends Nakama's HTTP key. */
  httpKey?: string;
  fetchImpl?: typeof fetch;
}

export interface ProfileResult {
  playerId: string;
  relics: string[];
  gameBeaten: string[];
  scope: string;
  verse?: number;
  verseEarned?: { gameId: string; lifetime: number }[];
  /** Remaining Tickets this game can still earn today. Present on a game session. */
  ticketsCapLeft?: number;
  /** Present on a game session minted by ticket custom-auth. */
  effects?: Record<string, number | boolean | string>;
  ranked?: boolean;
}

export interface PortalEnterResult {
  ticket: string;
  sessionId: string;
  expiresAt: number;
}

export interface RedeemResult {
  token: string;
  playerId: string;
  ranked: boolean;
  sid: string;
  relics: string[];
  effects: Record<string, number | boolean | string>;
  ticketsCapLeft: number;
  gameBeaten: string[];
}

export interface RecoveryCodeResult {
  code: string;
}

export interface RecoveryRedeemResult {
  restored: boolean;
  userId: string;
  token: string;
}

/** Session vars Nakama stores under `vrs` (scope, game, sid, ranked). */
export function sessionVarsFromToken(token: string): Record<string, string> {
  const part = token.split('.')[1];
  if (!part) return {};
  try {
    const json = JSON.parse(new TextDecoder().decode(base64UrlToBytes(part))) as { vrs?: unknown };
    if (!json.vrs || typeof json.vrs !== 'object' || Array.isArray(json.vrs)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(json.vrs)) {
      if (typeof value === 'string') out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function userIdFromToken(token: string): string {
  const part = token.split('.')[1];
  if (!part) throw new HubSdkError('bad_token', 'Session token is missing a payload');
  try {
    const json = JSON.parse(new TextDecoder().decode(base64UrlToBytes(part))) as { uid?: string };
    if (!json.uid) throw new HubSdkError('bad_token', 'Session token has no user id');
    return json.uid;
  } catch (error) {
    if (error instanceof HubSdkError) throw error;
    throw new HubSdkError('bad_token', 'Session token payload is not valid');
  }
}

export function createNakamaClient(options: NakamaClientOptions): NakamaClient {
  const serverUrl = options.serverUrl.replace(/\/$/, '');
  const serverKey = options.serverKey ?? LOCAL_NAKAMA.serverKey;
  const fetchImpl = options.fetchImpl ?? fetch;

  async function postAuth(path: string, body: object): Promise<CustomAuthResult> {
    const response = await fetchImpl(`${serverUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${serverKey}:`)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) throw new HubSdkError('auth_failed', text || `HTTP ${response.status}`);
    const parsed = JSON.parse(text) as { token?: string; refresh_token?: string; refreshToken?: string };
    if (!parsed.token) throw new HubSdkError('auth_failed', 'Auth did not return a token');
    return {
      token: parsed.token,
      refreshToken: parsed.refreshToken || parsed.refresh_token || '',
      userId: userIdFromToken(parsed.token),
    };
  }

  return {
    async authenticateDevice(deviceId, vars) {
      const auth = await postAuth(
        '/v2/account/authenticate/device?create=true',
        vars ? { id: deviceId, vars } : { id: deviceId },
      );
      return { token: auth.token, userId: auth.userId };
    },

    async authenticateCustom(id, create = false, vars) {
      const params = new URLSearchParams({ create: create ? 'true' : 'false' });
      // Nakama maps this route with body: "account", so the JSON body is the account itself.
      const body: { id: string; vars?: Record<string, string> } = vars ? { id, vars } : { id };
      const auth = await postAuth(`/v2/account/authenticate/custom?${params}`, body);
      if (!auth.refreshToken) throw new HubSdkError('auth_failed', 'Auth did not return a refresh token');
      return auth;
    },

    async rpc<T>(id: string, body: object, opts?: NakamaRpcOptions): Promise<T> {
      const params = new URLSearchParams({ unwrap: 'true' });
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (!opts?.token) throw new HubSdkError('unauthorized', 'Missing session');
      headers.Authorization = `Bearer ${opts.token}`;
      const response = await fetchImpl(`${serverUrl}/v2/rpc/${encodeURIComponent(id)}?${params}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        keepalive: opts?.keepalive,
      });
      const text = await response.text();
      if (!response.ok) throw new HubSdkError('rpc_failed', text || `HTTP ${response.status}`, response.status);
      const parsed = (text ? JSON.parse(text) : {}) as T & { error?: string; message?: string };
      if (parsed.error) throw new HubSdkError(parsed.error, parsed.message || parsed.error);
      return parsed;
    },
  };
}
