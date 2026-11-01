// Which wallet the exchange machine talks to. Browser extensions are found with EIP-6963
// (each announces itself, so MetaMask, Rabby, Phantom and Trust Wallet can all be installed
// side by side), with the legacy window.ethereum / window.phantom.ethereum as a fallback.
// WalletConnect covers phone wallets through a QR code and is loaded only when picked.
// Lazy chunk only, like ./eth.

export interface Eip1193Provider {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

export type WalletKind = 'injected' | 'walletconnect';

export interface WalletOption {
  /** EIP-6963 rdns, `legacy`, or `walletconnect`. */
  id: string;
  name: string;
  /** data:image/... from the wallet itself, or undefined. */
  icon?: string;
  kind: WalletKind;
  installed: boolean;
  installUrl?: string;
  note?: string;
}

interface Discovered {
  name: string;
  icon?: string;
  provider: Eip1193Provider;
}

/** The wallets the machine lists by name, in this order, installed or not. */
export const FEATURED = [
  { rdns: 'io.metamask', name: 'MetaMask', installUrl: 'https://metamask.io/download/' },
  { rdns: 'io.rabby', name: 'Rabby', installUrl: 'https://rabby.io/' },
  { rdns: 'app.phantom', name: 'Phantom', installUrl: 'https://phantom.com/download' },
  { rdns: 'com.trustwallet.app', name: 'Trust Wallet', installUrl: 'https://trustwallet.com/download' },
] as const;

const CHOICE_KEY = 'hub.exchange.wallet';
const WALLETCONNECT_PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? '';

const discovered = new Map<string, Discovered>();
const listeners = new Set<() => void>();
let active: { id: string; provider: Eip1193Provider } | null = null;

function emit(): void {
  for (const fn of listeners) fn();
}

export function onWalletsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function isProvider(value: unknown): value is Eip1193Provider {
  return Boolean(value) && typeof (value as Eip1193Provider).request === 'function';
}

function safeIcon(icon: unknown): string | undefined {
  return typeof icon === 'string' && /^data:image\/(svg\+xml|png|webp|jpeg|gif);/.test(icon) && icon.length < 100_000 ? icon : undefined;
}

interface AnnounceDetail {
  info?: { rdns?: unknown; name?: unknown; icon?: unknown };
  provider?: unknown;
}

window.addEventListener('eip6963:announceProvider', (event) => {
  const detail = (event as CustomEvent<AnnounceDetail>).detail;
  const rdns = detail?.info?.rdns;
  if (typeof rdns !== 'string' || !rdns || !isProvider(detail.provider)) return;
  const name = typeof detail.info?.name === 'string' && detail.info.name ? detail.info.name.slice(0, 40) : rdns;
  discovered.set(rdns, { name, icon: safeIcon(detail.info?.icon), provider: detail.provider });
  emit();
});
window.dispatchEvent(new Event('eip6963:requestProvider'));

/** Older extensions that don't announce through EIP-6963. */
function legacyFor(rdns: string): Eip1193Provider | null {
  const w = window as { ethereum?: Record<string, unknown>; phantom?: { ethereum?: unknown }; trustwallet?: unknown };
  const eth = w.ethereum;
  if (rdns === 'app.phantom' && isProvider(w.phantom?.ethereum)) return w.phantom.ethereum;
  if (rdns === 'com.trustwallet.app' && isProvider(w.trustwallet)) return w.trustwallet;
  if (!isProvider(eth)) return null;
  if (rdns === 'io.rabby' && eth.isRabby) return eth;
  if (rdns === 'app.phantom' && eth.isPhantom) return eth;
  if (rdns === 'com.trustwallet.app' && (eth.isTrust || eth.isTrustWallet)) return eth;
  // Rabby, Phantom and others also set isMetaMask, so MetaMask is only the one that sets nothing else.
  if (rdns === 'io.metamask' && eth.isMetaMask && !eth.isRabby && !eth.isPhantom && !eth.isTrust && !eth.isTrustWallet && !eth.isBraveWallet) return eth;
  return null;
}

function injected(id: string): Eip1193Provider | null {
  if (id === 'legacy') {
    const eth = (window as { ethereum?: unknown }).ethereum;
    return isProvider(eth) ? eth : null;
  }
  return discovered.get(id)?.provider ?? legacyFor(id);
}

export function walletConnectConfigured(): boolean {
  return WALLETCONNECT_PROJECT_ID.length > 0;
}

/** Every wallet to show, featured ones first, then any other extension that announced itself. */
export function walletOptions(): WalletOption[] {
  const out: WalletOption[] = [];
  const featured = new Set<string>(FEATURED.map((f) => f.rdns));
  for (const f of FEATURED) {
    const d = discovered.get(f.rdns);
    out.push({ id: f.rdns, name: f.name, icon: d?.icon, kind: 'injected', installed: Boolean(d || legacyFor(f.rdns)), installUrl: f.installUrl });
  }
  for (const [rdns, d] of discovered) {
    if (!featured.has(rdns)) out.push({ id: rdns, name: d.name, icon: d.icon, kind: 'injected', installed: true });
  }
  const anyFound = out.some((o) => o.installed);
  if (!anyFound && injected('legacy')) out.push({ id: 'legacy', name: 'Browser wallet', kind: 'injected', installed: true });
  out.push({
    id: 'walletconnect',
    name: 'WalletConnect',
    kind: 'walletconnect',
    installed: walletConnectConfigured(),
    note: walletConnectConfigured()
      ? 'Scan with a phone wallet: Trust Wallet, MetaMask, Rabby, Rainbow and others.'
      : 'WalletConnect is not set up on this server yet.',
  });
  return out;
}

export function activeProvider(): Eip1193Provider | null {
  return active?.provider ?? null;
}

export function activeWallet(): WalletOption | null {
  if (!active) return null;
  return walletOptions().find((o) => o.id === active!.id) ?? { id: active.id, name: 'Wallet', kind: 'injected', installed: true };
}

function remember(id: string | null): void {
  try {
    if (id) localStorage.setItem(CHOICE_KEY, id);
    else localStorage.removeItem(CHOICE_KEY);
  } catch {
    // Private mode: the choice just isn't remembered.
  }
}

/**
 * Selects a wallet. Extensions are selected instantly (the account prompt comes later, from
 * eth.requestAccount). WalletConnect shows a QR code through `onUri` and resolves once the
 * phone approves; `onUri` gets null when the code is no longer needed.
 */
export async function selectWallet(id: string, chainId: number, onUri: (uri: string | null) => void): Promise<void> {
  if (id === 'walletconnect') {
    if (!walletConnectConfigured()) throw new Error('WalletConnect is not set up on this server yet.');
    const wc = await import('./walletconnect');
    try {
      const provider = await wc.connect(WALLETCONNECT_PROJECT_ID, chainId, onUri);
      active = { id, provider };
    } finally {
      onUri(null);
    }
  } else {
    const provider = injected(id);
    if (!provider) throw new Error('That wallet is not installed in this browser.');
    active = { id, provider };
  }
  remember(id);
  emit();
}

/** Forgets the wallet choice. A WalletConnect session is closed on the phone too. */
export async function forgetWallet(): Promise<void> {
  const was = active;
  active = null;
  remember(null);
  emit();
  if (was?.id === 'walletconnect') {
    const wc = await import('./walletconnect');
    await wc.disconnect().catch(() => undefined);
  }
}

/** Re-selects the wallet chosen last time, without any prompt. */
export async function restoreWallet(chainId: number): Promise<void> {
  if (active) return;
  let id: string | null = null;
  try {
    id = localStorage.getItem(CHOICE_KEY);
  } catch {
    return;
  }
  if (!id) return;
  if (id === 'walletconnect') {
    if (!walletConnectConfigured()) return;
    const wc = await import('./walletconnect');
    const provider = await wc.resume(WALLETCONNECT_PROJECT_ID, chainId).catch(() => null);
    if (provider) active = { id, provider };
  } else {
    // Extensions announce a moment after the request; give them one tick.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const provider = injected(id);
    if (provider) active = { id, provider };
  }
  if (active) emit();
}
