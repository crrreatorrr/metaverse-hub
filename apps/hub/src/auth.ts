import { HubSdkError, LOCAL_NAKAMA, createNakamaClient, getOrCreateDeviceId, userIdFromToken } from '@metaverse/hub-sdk';

/**
 * Username and password accounts on Nakama's email auth. The username logs in; the
 * email is a backup address that nobody verifies yet. Sign-up turns this device's
 * guest into the account (Relics and Verse stay), then logs in by username.
 */

export interface SignedIn {
  kind: 'account';
  token: string;
  userId: string;
  username: string;
}

export interface Guest {
  kind: 'guest';
}

export type HubEntry = SignedIn | Guest;

export const USERNAME_RULE = /^[a-z0-9_-]{3,20}$/;
export const EMAIL_RULE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PASSWORD_MIN = 8;

const STORE_KEY = 'hub:account';
const GUEST_KEY = 'hub:guest';
const REFRESH_MARGIN_S = 300;

interface Stored {
  token: string;
  refreshToken: string;
  username: string;
}

interface NakamaSession {
  token?: string;
  refresh_token?: string;
}

export class AuthError extends Error {
  constructor(
    readonly field: 'username' | 'email' | 'password' | 'form',
    message: string,
  ) {
    super(message);
  }
}

const OFFLINE = "Can't reach the hub server. Try again, or continue as a guest.";

function basicAuth(): string {
  return `Basic ${btoa(`${LOCAL_NAKAMA.serverKey}:`)}`;
}

function readStored(): Stored | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<Stored>;
    if (!value.token || !value.refreshToken || !value.username) return null;
    return { token: value.token, refreshToken: value.refreshToken, username: value.username };
  } catch {
    return null;
  }
}

function writeStored(value: Stored): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(value));
  } catch {
    // Private mode: the account still works for this page load.
  }
}

function tokenExp(token: string): number {
  try {
    const part = token.split('.')[1] ?? '';
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
    return typeof json.exp === 'number' ? json.exp : 0;
  } catch {
    return 0;
  }
}

async function nakamaPost(path: string, body: object, authorization: string): Promise<NakamaSession> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { Authorization: authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthError('form', OFFLINE);
  }
  const text = await response.text();
  if (response.ok) return (text ? JSON.parse(text) : {}) as NakamaSession;
  let message = '';
  try {
    message = String((JSON.parse(text) as { message?: string }).message ?? '');
  } catch {
    message = '';
  }
  if (response.status >= 500 && !message) throw new AuthError('form', OFFLINE);
  throw nakamaError(response.status, message);
}

function nakamaError(status: number, message: string): AuthError {
  if (/username is already in use/i.test(message)) return new AuthError('username', 'That username is taken.');
  if (/email is already in use/i.test(message)) return new AuthError('email', 'That email already has an account.');
  if (/password must be/i.test(message)) return new AuthError('password', `Use at least ${PASSWORD_MIN} characters.`);
  if (status === 401 || status === 404 || /invalid credentials|not found/i.test(message)) {
    return new AuthError('form', 'Wrong username or password.');
  }
  if (status >= 500) return new AuthError('form', OFFLINE);
  return new AuthError('form', message || 'Something went wrong. Try again.');
}

function signedIn(session: NakamaSession, username: string): SignedIn {
  if (!session.token || !session.refresh_token) throw new AuthError('form', 'The server did not return a session.');
  writeStored({ token: session.token, refreshToken: session.refresh_token, username });
  forgetGuest();
  return { kind: 'account', token: session.token, userId: userIdFromToken(session.token), username };
}

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export async function logIn(rawUsername: string, password: string): Promise<SignedIn> {
  const username = normalizeUsername(rawUsername);
  const query = new URLSearchParams({ create: 'false', username });
  const session = await nakamaPost(`/v2/account/authenticate/email?${query}`, { email: '', password }, basicAuth());
  return signedIn(session, username);
}

export async function signUp(rawUsername: string, password: string, rawEmail: string): Promise<SignedIn> {
  const username = normalizeUsername(rawUsername);
  const email = rawEmail.trim().toLowerCase();
  const client = createNakamaClient({ serverUrl: '', serverKey: LOCAL_NAKAMA.serverKey, httpKey: LOCAL_NAKAMA.httpKey });

  let guestToken: string;
  try {
    guestToken = (await client.authenticateDevice(getOrCreateDeviceId())).token;
  } catch {
    throw new AuthError('form', OFFLINE);
  }

  let claimed = false;
  try {
    await client.rpc('account.claim', { username, email, password }, { token: guestToken });
    claimed = true;
  } catch (error) {
    if (!(error instanceof HubSdkError)) throw new AuthError('form', OFFLINE);
    const { code, message } = error;
    if (code === 'username_taken') throw new AuthError('username', 'That username is taken.');
    if (code === 'email_taken') throw new AuthError('email', 'That email already has an account.');
    if (code === 'bad_username') throw new AuthError('username', message);
    if (code === 'bad_email') throw new AuthError('email', message);
    if (code === 'bad_password') throw new AuthError('password', message);
    if (code === 'rpc_failed' && (error.status ?? 500) >= 500) throw new AuthError('form', OFFLINE);
    if (code !== 'account_claimed') throw new AuthError('form', 'Could not create the account. Try again.');
  }

  if (!claimed) {
    // This device's guest already has a password, so make a fresh account.
    const query = new URLSearchParams({ create: 'true', username });
    const session = await nakamaPost(`/v2/account/authenticate/email?${query}`, { email, password }, basicAuth());
    return signedIn(session, username);
  }
  return logIn(username, password);
}

/** A remembered account, refreshed if its token is close to expiry. Null means show the form. */
export async function resume(): Promise<SignedIn | null> {
  const stored = readStored();
  if (!stored) return null;
  const now = Date.now() / 1000;
  if (tokenExp(stored.token) - now > REFRESH_MARGIN_S) {
    return { kind: 'account', token: stored.token, userId: userIdFromToken(stored.token), username: stored.username };
  }
  if (tokenExp(stored.refreshToken) <= now) {
    forgetAccount();
    return null;
  }
  try {
    const session = await nakamaPost('/v2/account/session/refresh', { token: stored.refreshToken }, basicAuth());
    return signedIn(session, stored.username);
  } catch (error) {
    if (error instanceof AuthError && error.message === OFFLINE) throw error;
    forgetAccount();
    return null;
  }
}

export function rememberedUsername(): string {
  return readStored()?.username ?? '';
}

export function forgetAccount(): void {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    // Nothing stored.
  }
}

/** Guest is remembered for this tab only, so a game round trip does not ask again. */
export function chooseGuest(): Guest {
  try {
    sessionStorage.setItem(GUEST_KEY, '1');
  } catch {
    // Still a guest for this page load.
  }
  return { kind: 'guest' };
}

export function guestThisTab(): boolean {
  try {
    return sessionStorage.getItem(GUEST_KEY) === '1';
  } catch {
    return false;
  }
}

function forgetGuest(): void {
  try {
    sessionStorage.removeItem(GUEST_KEY);
  } catch {
    // Nothing stored.
  }
}

export function signOut(): void {
  forgetAccount();
  forgetGuest();
}
