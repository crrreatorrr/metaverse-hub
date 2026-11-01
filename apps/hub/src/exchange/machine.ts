// Bar exchange machine shell: open/close state, Esc, walk-away, and the lazy panel load.
// This file is in the main hub chunk, so it must stay tiny and must not import wallet or
// Ethereum code. The overlay itself (./panel, ./eth, viem, the wallet API) loads with a
// dynamic import the first time the machine opens. Design: docs/crypto-exchange-design.md.
import type { NakamaClient } from '@metaverse/hub-sdk';
import type { PanelHandle, PanelMode } from './panel';

/** Hint and E key work within this many metres of the cabinet front. */
export const EXCHANGE_REACH = 1.6;
/** Opened at the cabinet, the overlay closes once the player is this far away. */
const EXCHANGE_LEAVE = 2.6;

export interface ExchangeSession {
  client: NakamaClient;
  /** Read on every call: the hub token changes after account recovery. */
  token: () => string;
}

export interface ExchangeHost {
  /** Element the overlay is appended to. */
  root: HTMLElement;
  /** Resolves with the Nakama session, rejects when Nakama is offline. */
  session: () => Promise<ExchangeSession>;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (message: string) => void;
}

export interface ExchangeMachine {
  readonly isOpen: boolean;
  /** Open at the cabinet (E). */
  open(): void;
  close(): void;
  /** Every frame: the player's distance to the cabinet front, `Infinity` outside the Bar. */
  tick(distance: number): void;
}

let panelModule: Promise<typeof import('./panel')> | null = null;

function loadPanel(): Promise<typeof import('./panel')> {
  if (!panelModule) {
    panelModule = import('./panel').catch((error: unknown) => {
      panelModule = null;
      throw error;
    });
  }
  return panelModule;
}

let active: ((mode: PanelMode) => void) | null = null;

export function installExchangeMachine(host: ExchangeHost): ExchangeMachine {
  const overlay = document.createElement('div');
  overlay.id = 'exchange';
  overlay.className = 'exchange';
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Exchange machine');
  host.root.append(overlay);

  let open = false;
  let atCabinet = false;
  let generation = 0;
  let handle: PanelHandle | null = null;

  const onKey = (event: KeyboardEvent) => {
    if (event.code !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };

  function show(mode: PanelMode): void {
    if (open) {
      handle?.show(mode);
      return;
    }
    open = true;
    atCabinet = mode.kind === 'machine';
    if (document.pointerLockElement) document.exitPointerLock();
    overlay.hidden = false;
    window.addEventListener('keydown', onKey, true);
    host.onOpen?.();
    const ticket = ++generation;
    loadPanel().then((panel) => {
      if (!open || ticket !== generation) return;
      handle = panel.mountPanel(overlay, { session: host.session, close, mode });
    }).catch((error: unknown) => {
      if (ticket !== generation) return;
      close();
      host.onError?.('The exchange machine failed to load. Check your connection and try again.');
      console.error(error);
    });
  }

  function close(): void {
    if (!open) return;
    open = false;
    generation += 1;
    handle?.destroy();
    handle = null;
    overlay.replaceChildren();
    overlay.hidden = true;
    window.removeEventListener('keydown', onKey, true);
    host.onClose?.();
  }

  active = show;
  return {
    get isOpen() { return open; },
    open: () => show({ kind: 'machine' }),
    close,
    tick(distance) {
      if (open && atCabinet && distance > EXCHANGE_LEAVE) close();
    },
  };
}

/**
 * Store checkout hook ("Pay with $BITCOIN"). Creates a purchase intent for `itemId` and shows
 * the "send exactly N HPOS10I $BITCOIN" step in the exchange overlay, using the same send flow
 * as Buy Verse. The hub has no store UI yet; the Verse store counter should call this.
 */
export function openPayWithBitcoin(itemId: string): void {
  if (!active) throw new Error('The exchange machine is not installed');
  active({ kind: 'pay', itemId });
}
