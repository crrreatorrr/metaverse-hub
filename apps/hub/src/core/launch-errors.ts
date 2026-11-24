/**
 * Player-facing copy for a failed launch (plan item A2). Pure: no DOM, no SDK import, so the
 * node tests can load it. Errors are matched by shape (`code`, `status`, `name`) instead of by class.
 */

/** A launch that takes longer than this is treated as a failure, so the wipe never hangs. */
export const LAUNCH_TIMEOUT_MS = 10_000;
/** After a failed first session the plaza tries again this often while the tab is visible. */
export const SESSION_RETRY_MS = 15_000;

export const SERVER_SILENT_TEXT = 'The hub server is not answering. Try again in a moment.';
export const GATE_LOCKED_TEXT = 'That door is locked.';
export const OFFLINE_STATUS_TEXT = 'Offline: playing solo';

export class LaunchTimeoutError extends Error {
  readonly code = 'timeout';
  constructor() {
    super('The launch timed out');
    this.name = 'LaunchTimeoutError';
  }
}

function field(error: unknown, key: string): unknown {
  return typeof error === 'object' && error !== null ? (error as Record<string, unknown>)[key] : undefined;
}

/** True when the request never got a real answer: network failure, timeout, or an HTTP 5xx. */
export function serverSilent(error: unknown): boolean {
  if (error instanceof LaunchTimeoutError) return true;
  const code = field(error, 'code');
  const status = field(error, 'status');
  if (code === 'timeout' || code === 'network') return true;
  if (typeof status === 'number' && status >= 500) return true;
  // fetch() rejects with a TypeError when the server cannot be reached.
  if (error instanceof TypeError) return true;
  const message = field(error, 'message');
  if (typeof message === 'string' && /^HTTP 5\d\d\b/.test(message)) return true;
  // A proxy answered with HTML: the SDK's JSON parse fails with a SyntaxError.
  return error instanceof SyntaxError;
}

/** The sentence shown in the hint bar when `portal.enter` (or the session before it) fails. */
export function launchErrorText(error: unknown, label: string): string {
  if (serverSilent(error)) return SERVER_SILENT_TEXT;
  const code = field(error, 'code');
  const message = field(error, 'message');
  if (code === 'rate_limited' && typeof message === 'string' && message) return message;
  if (code === 'GATE_LOCKED' || message === 'GATE_LOCKED') return GATE_LOCKED_TEXT;
  return `Could not open ${label}.`;
}

/**
 * The sentence shown in the Account panel when `recovery.redeem` fails. The server answers some
 * refusals with the bare code as its message, which is not for players.
 */
export function restoreErrorText(error: unknown): string {
  if (serverSilent(error)) return SERVER_SILENT_TEXT;
  const code = field(error, 'code');
  if (code === 'recovery_invalid') return 'That code is not valid. Check it and try again.';
  if (code === 'recovery_same_account') return 'That code is for the guest you are already on.';
  if (code === 'rate_limited') return 'Too many tries. Wait a minute and try again.';
  const message = field(error, 'message');
  // A real sentence from the server is kept; a bare code (no space) is not.
  if (typeof message === 'string' && message.includes(' ')) return message;
  return 'Could not restore that code.';
}

/** Rejects with `LaunchTimeoutError` when `promise` has not settled after `ms`. */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number = LAUNCH_TIMEOUT_MS,
  timers: { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void } = {
    set: (fn, delay) => setTimeout(fn, delay),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const handle = timers.set(() => reject(new LaunchTimeoutError()), ms);
    promise.then(
      (value) => { timers.clear(handle); resolve(value); },
      (error: unknown) => { timers.clear(handle); reject(error instanceof Error ? error : new Error(String(error))); },
    );
  });
}
