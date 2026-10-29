import type { LiveOutbox } from './outbox';
import type { NakamaClient } from './nakama';
import { HubSdkError } from './errors';
import { browserKeyValue, memoryKeyValue, type KeyValue } from './storage';

export interface HubSdkEnv {
  /** Page the game returns to. `exit` appends `#from=<game>`. */
  hubUrl?: string;
  /**
   * Nakama HTTP origin. Empty string means same-origin (the Vite dev server proxies `/v2`).
   * Set this to use the live server. Omit it, and the SDK keeps the in-memory mock used by unit tests.
   */
  serverUrl?: string;
  serverKey?: string;
  httpKey?: string;
  /** Injected Nakama client. When set, the SDK uses the live path. */
  client?: NakamaClient;
  /** Pending earn, event, and exchange calls. The browser default is IndexedDB. */
  outbox?: LiveOutbox;
  /** Keep the in-memory mock even if a server URL or client is set. */
  useMock?: boolean;
  local?: KeyValue;
  session?: KeyValue;
  now?: () => number;
  readHash?: () => string;
  writeHash?: (hash: string) => void;
  assign?: (url: string) => void;
  releasePointer?: () => void;
  clearBeforeUnload?: () => void;
}

export interface ResolvedEnv {
  hubUrl: string;
  local: KeyValue;
  session: KeyValue;
  now: () => number;
  readHash: () => string;
  writeHash: (hash: string) => void;
  assign: (url: string) => void;
  releasePointer: () => void;
  clearBeforeUnload: () => void;
}

function defaultEnv(): Required<
  Pick<
    HubSdkEnv,
    'hubUrl' | 'local' | 'session' | 'now' | 'readHash' | 'writeHash' | 'assign' | 'releasePointer' | 'clearBeforeUnload'
  >
> {
  if (typeof window === 'undefined') {
    throw new HubSdkError('no_window', 'createHubSdk() needs a browser, or pass an env for tests');
  }
  return {
    hubUrl: '/hub/',
    local: browserKeyValue('local'),
    session: browserKeyValue('session'),
    now: () => Date.now(),
    readHash: () => window.location.hash,
    writeHash: (hash) => {
      const next = `${window.location.pathname}${window.location.search}${hash}`;
      window.history.replaceState(null, '', next);
    },
    assign: (url) => {
      window.location.assign(url);
    },
    releasePointer: () => {
      if (document.pointerLockElement) document.exitPointerLock();
    },
    clearBeforeUnload: () => {
      window.onbeforeunload = null;
    },
  };
}

export function resolveHubEnv(env: HubSdkEnv): ResolvedEnv {
  const browser = typeof window !== 'undefined' ? defaultEnv() : null;
  return {
    hubUrl: env.hubUrl ?? browser?.hubUrl ?? '/hub/',
    local: env.local ?? browser?.local ?? memoryKeyValue(),
    session: env.session ?? browser?.session ?? memoryKeyValue(),
    now: env.now ?? browser?.now ?? (() => Date.now()),
    readHash: env.readHash ?? browser?.readHash ?? (() => ''),
    writeHash: env.writeHash ?? browser?.writeHash ?? (() => undefined),
    assign: env.assign ?? browser?.assign ?? (() => undefined),
    releasePointer: env.releasePointer ?? browser?.releasePointer ?? (() => undefined),
    clearBeforeUnload: env.clearBeforeUnload ?? browser?.clearBeforeUnload ?? (() => undefined),
  };
}
