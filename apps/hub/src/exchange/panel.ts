// Exchange machine overlay: Wallet, Buy Verse, Cash out, History, and the store "Pay with
// $BITCOIN" step. Loaded only through the dynamic import in ./machine, together with ./eth
// and viem. Plain DOM; every render rebuilds the cabinet from `state`.
import './exchange.css';
import {
  BITCOIN_TOKEN_ETH,
  createWalletApi,
  tokenUnits,
  userIdFromToken,
  type DepositView,
  type IntentResult,
  type VoucherView,
  type WalletApi,
  type WalletStatus,
} from '@metaverse/hub-sdk';
import { formatUnits, type Hex } from 'viem';
import { explain, retryable } from './copy';
import qrcode from 'qrcode-generator';
import * as eth from './eth';
import type { ExchangeSession } from './machine';
import * as wallets from './wallets';

export type PanelMode = { kind: 'machine' } | { kind: 'pay'; itemId: string };

export interface PanelHandle {
  show(mode: PanelMode): void;
  destroy(): void;
}

export interface PanelOptions {
  session: () => Promise<ExchangeSession>;
  close: () => void;
  mode: PanelMode;
}

type Tab = 'wallet' | 'buy' | 'cashout' | 'history' | 'pay';

const POLL_MS = 10_000;
/** A voucher this close to expiry is not put in a claim; the transaction may land after it. */
const EXPIRY_MARGIN_S = 300;
/** A sent transaction that no node knows about after this long is treated as dropped. */
const DROPPED_MS = 2 * 60 * 60 * 1000;
const TOKEN = 'HPOS10I $BITCOIN';
const ITEM_NAMES: Record<string, string> = { pet_hopium_sproto: 'Hopium', pet_coom_sproto: 'COOM' };

interface SentDeposit { tx: string; verse: number; at: number; chainId: number }
interface SentClaim { tx: string; at: number }
interface SentLog { deposits: SentDeposit[]; claims: Record<string, SentClaim> }

type Child = Node | string | null | undefined | false;
type Attr = string | number | boolean | undefined | ((event: Event) => void);

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, Attr> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key === 'class') node.className = String(value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) if (child !== null && child !== undefined && child !== false) node.append(child);
  return node;
}

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function display(address: string): string {
  return eth.validAddress(address) ? eth.checksum(address) : address;
}

function when(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function whole(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,15}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

function signatureHex(signature: string): Hex {
  return (signature.startsWith('0x') ? signature : `0x${signature}`) as Hex;
}

export function mountPanel(root: HTMLElement, options: PanelOptions): PanelHandle {
  const state = {
    phase: 'connecting' as 'connecting' | 'offline' | 'ready',
    tab: 'wallet' as Tab,
    status: null as WalletStatus | null,
    /** The last status poll failed; the screen shows older numbers. */
    stale: false,
    account: null as `0x${string}` | null,
    chain: null as number | null,
    gas: null as bigint | null,
    busy: '',
    notice: null as { kind: 'ok' | 'error' | 'info'; text: string } | null,
    intentItem: '',
    intent: null as IntentResult | null,
    buyAmount: '',
    cashAmount: '',
    pendingWithdraw: null as { amount: number; key: string } | null,
    /** WalletConnect pairing link while the QR code is on screen. */
    wcUri: null as string | null,
  };
  /** Bumped when a WalletConnect pairing is cancelled, so its late result is ignored. */
  let pairing = 0;
  let api: WalletApi | null = null;
  let sentKey = 'hub.exchange.sent';
  let sent: SentLog = { deposits: [], claims: {} };
  let dead = false;
  let poll = 0;
  let refreshing: Promise<void> | null = null;
  let queued: PanelMode | null = options.mode.kind === 'pay' ? options.mode : null;
  const unwatch = eth.watchWallet(() => {
    void readWallet().then(render);
  });

  const cabinet = h('div', { class: 'exchange-cabinet' });
  root.replaceChildren(cabinet);
  render();

  options.session().then((session) => {
    if (dead) return;
    api = createWalletApi(session.client, session.token);
    try {
      sentKey = `hub.exchange.sent:${userIdFromToken(session.token())}`;
    } catch {
      // Keep the shared key; the log is only a local reminder of sent transactions.
    }
    sent = loadSent();
    void refresh();
    poll = window.setInterval(() => {
      if (!refreshing) void refresh();
    }, POLL_MS);
  }).catch(() => {
    if (dead) return;
    state.phase = 'offline';
    render();
  });

  // ---- data -------------------------------------------------------------------------------

  function loadSent(): SentLog {
    try {
      const parsed = JSON.parse(localStorage.getItem(sentKey) ?? '') as Partial<SentLog>;
      return { deposits: Array.isArray(parsed.deposits) ? parsed.deposits : [], claims: parsed.claims ?? {} };
    } catch {
      return { deposits: [], claims: {} };
    }
  }

  function saveSent(): void {
    try {
      localStorage.setItem(sentKey, JSON.stringify(sent));
    } catch {
      // Storage full or blocked. The log is a convenience only.
    }
  }

  /** Fresh status. If a refresh is already running, another one follows it so callers see their own change. */
  function refresh(): Promise<void> {
    if (refreshing) return refreshing.then(() => refreshing ?? refresh());
    refreshing = (async () => {
      if (!api) return;
      try {
        state.status = await api.status();
        state.phase = 'ready';
        state.stale = false;
      } catch (error) {
        if (state.phase !== 'ready') state.phase = 'offline';
        else state.stale = true;
        console.warn('[exchange] status failed', error);
      }
      await readWallet();
      await settleSent();
      if (queued && state.phase === 'ready') {
        const mode = queued;
        queued = null;
        if (mode.kind === 'pay') startPay(mode.itemId);
      }
    })().finally(() => {
      refreshing = null;
      render();
    });
    return refreshing;
  }

  async function readWallet(): Promise<void> {
    if (!eth.provider() && state.status) {
      await wallets.restoreWallet(state.status.chain.chainId).catch((error) => console.warn('[exchange] wallet restore failed', error));
    }
    if (!eth.provider()) {
      state.account = null;
      state.chain = null;
      state.gas = null;
      return;
    }
    try {
      state.account = await eth.knownAccount();
      state.chain = await eth.chainId();
      state.gas = state.account && state.chain === state.status?.chain.chainId ? await eth.ethBalance(state.account) : null;
    } catch (error) {
      console.warn('[exchange] wallet read failed', error);
    }
  }

  /** Drops local records the server has caught up with, and reverted or dropped transactions. */
  async function settleSent(): Promise<void> {
    const status = state.status;
    if (!status) return;
    const now = Date.now();
    const known = new Set(status.deposits.map((deposit) => deposit.tx.toLowerCase()));
    const keep: SentDeposit[] = [];
    for (const deposit of sent.deposits) {
      if (known.has(deposit.tx.toLowerCase()) || now - deposit.at > 24 * 60 * 60 * 1000) continue;
      const ok = eth.provider() && state.chain === deposit.chainId ? await eth.txSucceeded(deposit.tx).catch(() => null) : null;
      if (ok === false) {
        state.notice = { kind: 'error', text: 'A token transfer failed on Ethereum. Nothing was sent; you can try again.' };
        continue;
      }
      if (ok === null && now - deposit.at > DROPPED_MS) continue;
      keep.push(deposit);
    }
    sent.deposits = keep;
    const signed = new Set(status.vouchers.filter((voucher) => voucher.status === 'signed').map((voucher) => voucher.id));
    for (const [id, claim] of Object.entries(sent.claims)) {
      if (!signed.has(id)) {
        delete sent.claims[id];
        continue;
      }
      const ok = eth.provider() && state.chain === status.chain.chainId ? await eth.txSucceeded(claim.tx).catch(() => null) : null;
      if (ok === false || (ok === null && now - claim.at > DROPPED_MS)) {
        delete sent.claims[id];
        if (ok === false) state.notice = { kind: 'error', text: 'A claim transaction failed on Ethereum. Your vouchers are still there; claim again.' };
      }
    }
    saveSent();
  }

  async function act(label: string, run: () => Promise<void>): Promise<void> {
    if (state.busy || dead) return;
    state.busy = label;
    state.notice = null;
    render();
    try {
      await run();
    } catch (error) {
      if (dead) return;
      state.notice = { kind: 'error', text: explain(error) };
      console.warn(`[exchange] ${label} failed`, error);
    } finally {
      state.busy = '';
      if (!dead) render();
    }
  }

  // ---- actions ----------------------------------------------------------------------------

  const connect = () => act('connect', async () => {
    state.account = await eth.requestAccount();
    await refresh();
  });

  /** Picks a wallet from the list, then asks it for an account. */
  const choose = (option: wallets.WalletOption) => {
    if (option.kind === 'injected') {
      return act('connect', async () => {
        await wallets.selectWallet(option.id, state.status?.chain.chainId ?? 1, () => {});
        state.account = await eth.requestAccount();
        await refresh();
      });
    }
    return act('pair', async () => {
      const ticket = ++pairing;
      await wallets.selectWallet(option.id, state.status?.chain.chainId ?? 1, (uri) => {
        if (ticket !== pairing || dead) return;
        state.wcUri = uri;
        render();
      });
      if (ticket !== pairing) return;
      state.account = await eth.requestAccount();
      await refresh();
    });
  };

  const cancelPairing = () => {
    pairing++;
    state.wcUri = null;
    state.busy = '';
    void wallets.forgetWallet().then(() => readWallet()).then(render);
    render();
  };

  const changeWallet = () => act('forget', async () => {
    await wallets.forgetWallet();
    state.account = null;
    state.chain = null;
    state.gas = null;
  });

  const switchChain = (target: number) => act('switch', async () => {
    await eth.ensureChain(target);
    await refresh();
  });

  const link = () => act('link', async () => {
    if (!api) return;
    const account = await eth.requestAccount();
    state.account = account;
    const pending = await api.nonce(account);
    const signature = await eth.signMessage(pending.message, account);
    const linked = await api.link(pending.nonce, signature);
    state.notice = {
      kind: 'ok',
      text: `Wallet ${short(display(linked.address))} is linked. Cash-out opens after the 72-hour hold.`,
    };
    await refresh();
  });

  /** One ERC-20 transfer from the linked wallet. Shared by Buy Verse and Pay with $BITCOIN. */
  async function sendTokens(target: { to: string; token: string; chainId: number; units: bigint; verse: number }): Promise<void> {
    const linked = state.status?.wallet;
    if (!linked) throw new eth.WalletError('Link a wallet on the Wallet tab first.');
    const account = await eth.requestAccount();
    state.account = account;
    if (!eth.sameAddress(account, linked.address)) {
      throw new eth.WalletError(
        `Your wallet is on ${short(account)}. Switch it to your linked wallet ${short(display(linked.address))}. Tokens from any other wallet are not credited.`,
      );
    }
    await eth.ensureChain(target.chainId);
    state.chain = target.chainId;
    const tx = await eth.sendTokenTransfer(account, target.token, target.to, target.units);
    sent.deposits.unshift({ tx, verse: target.verse, at: Date.now(), chainId: target.chainId });
    saveSent();
    state.notice = {
      kind: 'ok',
      text: `Sent ${target.verse.toLocaleString('en-US')} ${TOKEN}. Verse is credited once the transfer is final on Ethereum, usually about 15 minutes.`,
    };
    await refresh();
  }

  const buy = () => act('buy', async () => {
    const status = state.status;
    const verse = whole(state.buyAmount);
    if (!status || !status.chain.depositAddress || status.chain.tokenDecimals === null) return;
    if (!verse) throw new eth.WalletError('Enter a whole number of Verse.');
    await sendTokens({
      to: status.chain.depositAddress,
      token: status.chain.tokenAddress,
      chainId: status.chain.chainId,
      units: tokenUnits(verse, status.chain.tokenDecimals),
      verse,
    });
    state.buyAmount = '';
  });

  const pay = () => act('pay', async () => {
    const intent = state.intent;
    if (!intent) return;
    await sendTokens({
      to: intent.depositAddress,
      token: intent.tokenAddress,
      chainId: intent.chainId,
      units: BigInt(intent.tokenAmount),
      verse: intent.versePrice,
    });
  });

  const withdraw = () => act('withdraw', async () => {
    if (!api || !state.status) return;
    const amount = whole(state.cashAmount);
    if (!amount) throw new eth.WalletError('Enter a whole number of Verse.');
    if (amount > cashMax(state.status)) throw new eth.WalletError(`You can cash out at most ${cashMax(state.status).toLocaleString('en-US')} Verse right now.`);
    // Reuse the idempotency key when retrying the same amount after a network error.
    const key = state.pendingWithdraw?.amount === amount ? state.pendingWithdraw.key : crypto.randomUUID();
    state.pendingWithdraw = { amount, key };
    try {
      const result = await api.withdraw(amount, key);
      state.pendingWithdraw = null;
      state.cashAmount = '';
      state.notice = {
        kind: 'ok',
        text: `Voucher for ${result.amount.toLocaleString('en-US')} ${TOKEN} requested. It can be claimed once it is signed, usually within a few minutes.`,
      };
    } catch (error) {
      if (!retryable(error)) state.pendingWithdraw = null;
      throw error;
    }
    await refresh();
  });

  const claim = () => act('claim', async () => {
    const status = state.status;
    if (!status) return;
    const account = await eth.requestAccount();
    state.account = account;
    const batch = claimBatch(status, account);
    if (batch.vouchers.length === 0 || !batch.cashout) {
      throw new eth.WalletError(`No vouchers here pay ${short(account)}. The contract only pays a voucher's recipient.`);
    }
    await eth.ensureChain(status.chain.chainId);
    state.chain = status.chain.chainId;
    state.gas = await eth.ethBalance(account);
    if (state.gas === 0n) throw new eth.WalletError('Your wallet has no ETH to pay gas. Add a little ETH on Ethereum, then claim.');
    const vouchers = batch.vouchers.map((voucher) => ({
      id: BigInt(voucher.id),
      recipient: eth.checksum(voucher.recipient),
      amount: BigInt(voucher.amount),
      expiry: BigInt(voucher.expiry),
    }));
    const signatures = batch.vouchers.map((voucher) => signatureHex(voucher.signature ?? ''));
    const tx = await eth.sendClaim(account, batch.cashout, vouchers, signatures);
    for (const voucher of batch.vouchers) sent.claims[voucher.id] = { tx, at: Date.now() };
    saveSent();
    state.notice = {
      kind: 'ok',
      text: `Claim sent for ${batch.total.toLocaleString('en-US')} ${TOKEN}. The vouchers show as claimed once the transaction is final.`,
    };
    await refresh();
  });

  function startPay(itemId: string): void {
    state.tab = 'pay';
    state.intentItem = itemId;
    state.intent = null;
    void act('intent', async () => {
      if (!api) return;
      state.intent = await api.intent(itemId);
    });
  }

  function copy(text: string): void {
    void navigator.clipboard?.writeText(text).then(() => {
      state.notice = { kind: 'info', text: 'Copied.' };
      render();
    }, () => {});
  }

  // ---- rules ------------------------------------------------------------------------------

  function cashMax(status: WalletStatus): number {
    return Math.max(0, Math.min(status.verse, status.accountRoom, status.globalRoom));
  }

  function now(): number {
    return Date.now() / 1000;
  }

  function claimable(status: WalletStatus): VoucherView[] {
    return status.vouchers.filter((voucher) =>
      voucher.status === 'signed'
      && Boolean(voucher.signature)
      && voucher.expiry > now() + EXPIRY_MARGIN_S
      && voucher.chainId === status.chain.chainId
      && eth.validAddress(voucher.cashoutAddress)
      && eth.validAddress(voucher.recipient)
      && !sent.claims[voucher.id]);
  }

  /** One transaction's worth: the account's vouchers for one cashout contract, at most 64. */
  function claimBatch(status: WalletStatus, account: string): { vouchers: VoucherView[]; cashout: string | null; total: number; left: number } {
    const mine = claimable(status).filter((voucher) => eth.sameAddress(voucher.recipient, account));
    const groups = new Map<string, VoucherView[]>();
    for (const voucher of mine) {
      const key = voucher.cashoutAddress.toLowerCase();
      groups.set(key, [...(groups.get(key) ?? []), voucher]);
    }
    const current = status.chain.cashoutAddress?.toLowerCase() ?? '';
    const order = [...groups.keys()].sort((a, b) => Number(b === current) - Number(a === current));
    const first = order[0];
    const group = first ? (groups.get(first) ?? []) : [];
    group.sort((a, b) => a.expiry - b.expiry);
    const vouchers = group.slice(0, eth.MAX_CLAIM_BATCH);
    return {
      vouchers,
      cashout: vouchers[0]?.cashoutAddress ?? null,
      total: vouchers.reduce((sum, voucher) => sum + voucher.amount, 0),
      left: mine.length - vouchers.length,
    };
  }

  function tokenMismatch(status: WalletStatus, token: string): string | null {
    if (status.chain.chainId === 1 && !eth.sameAddress(token, BITCOIN_TOKEN_ETH)) {
      return `The token address from the server is not ${TOKEN}. Do not send anything; tell the team.`;
    }
    return null;
  }

  function holdActive(status: WalletStatus): boolean {
    return Boolean(status.wallet && status.wallet.holdUntil > now());
  }

  function buyBlock(status: WalletStatus): string | null {
    if (!status.chain.depositsOpen) return 'Deposits are closed right now. Do not send tokens until they reopen.';
    if (!status.wallet) return 'Link a wallet on the Wallet tab first. Deposits are matched by the wallet they come from.';
    if (!status.chain.depositAddress) return 'The deposit address is not set up yet.';
    if (status.chain.tokenDecimals === null) return 'Token details are not ready yet. Try again shortly.';
    if (!eth.provider()) return 'Choose a wallet on the Wallet tab first.';
    return tokenMismatch(status, status.chain.tokenAddress);
  }

  function cashBlock(status: WalletStatus): string | null {
    if (!status.wallet) return 'Link a wallet on the Wallet tab first.';
    if (holdActive(status) && status.wallet) return `Cash-out opens ${when(status.wallet.holdUntil)}, 72 hours after the wallet was linked.`;
    if (!status.chain.cashoutOpen) return 'Cash-out is closed right now. Try again later.';
    if (!status.chain.cashoutAddress) return 'Cash-out is not set up yet.';
    if (status.verse <= 0) return 'You have no Verse to cash out.';
    if (status.accountRoom <= 0) return 'You have used today\'s cash-out room. It resets at 00:00 UTC.';
    if (status.globalRoom <= 0) return 'The machine has paid out all it can for now. More opens up every hour.';
    return null;
  }

  // ---- view -------------------------------------------------------------------------------

  function render(): void {
    if (dead) return;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusKey = active && cabinet.contains(active) ? active.dataset.key : undefined;
    const selection = active instanceof HTMLInputElement ? [active.selectionStart, active.selectionEnd] as const : null;
    const scroll = cabinet.querySelector('.exchange-screen')?.scrollTop ?? 0;

    const head = h('header', { class: 'exchange-head' },
      h('h2', { class: 'exchange-marquee' }, 'EXCHANGE'),
      h('button', { type: 'button', class: 'exchange-close', 'data-key': 'close', onclick: () => options.close() }, 'Close · Esc'),
    );
    const screen = h('div', { class: 'exchange-screen' });
    if (state.phase === 'connecting') {
      cabinet.replaceChildren(head, screen);
      screen.append(h('p', { class: 'exchange-center' }, 'Connecting…'));
    } else if (state.phase === 'offline' || !state.status) {
      cabinet.replaceChildren(head, screen);
      screen.append(h('p', { class: 'exchange-center exchange-offline' }, 'Exchange offline'));
    } else {
      const status = state.status;
      const tabs: [Tab, string][] = [['wallet', 'Wallet'], ['buy', 'Buy Verse'], ['cashout', 'Cash out'], ['history', 'History']];
      if (state.intentItem) tabs.push(['pay', 'Checkout']);
      const nav = h('nav', { class: 'exchange-tabs' }, ...tabs.map(([id, label]) => h('button', {
        type: 'button',
        class: state.tab === id ? 'on' : undefined,
        'data-key': `tab-${id}`,
        onclick: () => {
          state.tab = id;
          state.notice = null;
          render();
        },
      }, label)));
      const rate = h('p', { class: 'exchange-rate' }, `1 Verse = 1 ${TOKEN} · ${eth.chainName(status.chain.chainId)} · Verse ${status.verse.toLocaleString('en-US')}`);
      cabinet.replaceChildren(head, rate, nav, screen);
      if (state.notice) screen.append(h('p', { class: `exchange-notice ${state.notice.kind}`, role: 'status' }, state.notice.text));
      if (state.stale) screen.append(h('p', { class: 'exchange-notice error' }, 'Lost contact with the exchange. These numbers may be out of date; retrying…'));
      if (state.busy) screen.append(h('p', { class: 'exchange-notice info' }, busyText(state.busy)));
      const body = state.tab === 'wallet' ? walletTab(status)
        : state.tab === 'buy' ? buyTab(status)
          : state.tab === 'cashout' ? cashTab(status)
            : state.tab === 'history' ? historyTab(status)
              : payTab(status);
      screen.append(body);
    }

    screen.scrollTop = scroll;
    if (focusKey) {
      const next = cabinet.querySelector<HTMLElement>(`[data-key="${focusKey}"]`);
      next?.focus();
      if (next instanceof HTMLInputElement && selection) next.setSelectionRange(selection[0], selection[1]);
    }
  }

  function busyText(label: string): string {
    switch (label) {
      case 'connect': return 'Waiting for your wallet…';
      case 'pair': return 'Scan the code with your phone wallet, then approve the connection there.';
      case 'forget': return 'Disconnecting…';
      case 'switch': return 'Waiting for your wallet to switch network…';
      case 'link': return 'Sign the message in your wallet. Signing is free and sends nothing.';
      case 'buy':
      case 'pay': return 'Confirm the transfer in your wallet…';
      case 'withdraw': return 'Requesting a voucher…';
      case 'claim': return 'Confirm the claim in your wallet…';
      case 'intent': return 'Preparing checkout…';
      default: return 'Working…';
    }
  }

  function button(label: string, key: string, onclick: () => void, extra: { primary?: boolean; disabled?: boolean } = {}): HTMLButtonElement {
    return h('button', {
      type: 'button',
      class: extra.primary === false ? 'exchange-button ghost' : 'exchange-button',
      'data-key': key,
      disabled: Boolean(state.busy) || extra.disabled,
      onclick,
    }, label);
  }

  function addressRow(label: string, address: string | null, chainId: number): HTMLElement {
    const base = eth.explorer(chainId);
    const shown = address ? display(address) : 'Not set';
    return h('div', { class: 'exchange-field' },
      h('span', { class: 'exchange-label' }, label),
      h('span', { class: 'exchange-mono' }, base && address ? h('a', { href: `${base}/address/${shown}`, target: '_blank', rel: 'noopener' }, shown) : shown),
      address && h('button', { type: 'button', class: 'exchange-copy', 'data-key': `copy-${label}`, onclick: () => copy(shown) }, 'Copy'),
    );
  }

  function txLink(tx: string | null, chainId: number): Child {
    if (!tx) return null;
    const base = eth.explorer(chainId);
    return base ? h('a', { href: `${base}/tx/${tx}`, target: '_blank', rel: 'noopener', class: 'exchange-mono' }, short(tx)) : h('span', { class: 'exchange-mono' }, short(tx));
  }

  function warn(text: string): HTMLElement {
    return h('p', { class: 'exchange-warn' }, text);
  }

  function fine(text: string): HTMLElement {
    return h('p', { class: 'exchange-fine' }, text);
  }

  function noWalletApp(): HTMLElement {
    return h('div', { class: 'exchange-row' },
      warn('Choose a wallet first.'),
      h('button', { type: 'button', class: 'exchange-button ghost', 'data-key': 'to-wallet', onclick: () => { state.tab = 'wallet'; render(); } }, 'Choose a wallet'),
    );
  }

  function walletPicker(): HTMLElement {
    const box = h('div', { class: 'exchange-wallets' });
    if (state.wcUri) {
      const qr = qrcode(0, 'M');
      qr.addData(state.wcUri);
      qr.make();
      const img = h('img', { class: 'exchange-qr', alt: 'WalletConnect QR code', src: qr.createDataURL(6, 2) });
      box.append(
        h('p', {}, 'Scan with your phone wallet (Trust Wallet, MetaMask, Rabby, Rainbow…) using its WalletConnect scanner.'),
        img,
        h('div', { class: 'exchange-row' },
          h('button', { type: 'button', class: 'exchange-copy', 'data-key': 'copy-wc', onclick: () => copy(state.wcUri ?? '') }, 'Copy link'),
          h('button', { type: 'button', class: 'exchange-button ghost', 'data-key': 'cancel-wc', onclick: cancelPairing }, 'Cancel'),
        ),
      );
      return box;
    }
    box.append(h('p', {}, 'Choose your wallet:'));
    const list = h('div', { class: 'exchange-wallet-list' });
    for (const option of wallets.walletOptions()) {
      const icon = option.icon ? h('img', { class: 'exchange-wallet-icon', src: option.icon, alt: '' }) : h('span', { class: 'exchange-wallet-icon' }, option.name.slice(0, 1));
      const label = h('span', { class: 'exchange-wallet-name' }, option.name, option.note ? h('span', { class: 'exchange-fine' }, option.note) : null);
      if (option.installed) {
        list.append(h('button', {
          type: 'button',
          class: 'exchange-wallet',
          'data-key': `wallet-${option.id}`,
          disabled: Boolean(state.busy),
          onclick: () => void choose(option),
        }, icon, label, h('span', { class: 'exchange-wallet-go' }, option.kind === 'walletconnect' ? 'Scan QR' : 'Connect')));
      } else if (option.installUrl) {
        list.append(h('a', { class: 'exchange-wallet off', href: option.installUrl, target: '_blank', rel: 'noopener' },
          icon, label, h('span', { class: 'exchange-wallet-go' }, 'Install')));
      } else {
        list.append(h('div', { class: 'exchange-wallet off' }, icon, label));
      }
    }
    box.append(list, fine('Phantom and Trust Wallet work here through their browser extensions. Phone wallets connect with WalletConnect.'));
    return box;
  }

  function chainCheck(status: WalletStatus): HTMLElement | null {
    if (state.chain === null || state.chain === status.chain.chainId) return null;
    return h('div', { class: 'exchange-row' },
      warn(`Your wallet is on ${eth.chainName(state.chain)}. The exchange runs on ${eth.chainName(status.chain.chainId)}.`),
      button(`Switch to ${eth.chainName(status.chain.chainId)}`, 'switch', () => void switchChain(status.chain.chainId)),
    );
  }

  function walletTab(status: WalletStatus): HTMLElement {
    const linked = status.wallet;
    const box = h('section', { class: 'exchange-tab' }, h('h3', {}, 'Linked wallet'));
    if (linked) {
      box.append(addressRow('Ethereum', linked.address, status.chain.chainId));
      box.append(fine(`Linked ${when(linked.linkedAt)}.`));
      if (holdActive(status)) {
        box.append(warn(`Cash-out opens ${when(linked.holdUntil)}. New cash-outs wait 72 hours after a wallet is linked or replaced, so a stolen account cannot redirect your Verse.`));
      }
    } else {
      box.append(h('p', {}, 'No wallet linked yet. Link one to buy Verse with HPOS10I $BITCOIN and to cash out.'));
    }
    box.append(h('h3', {}, 'Your wallet'));
    if (!eth.provider()) {
      box.append(walletPicker());
      return box;
    }
    const chosen = wallets.activeWallet();
    if (!state.account) {
      box.append(
        h('p', {}, `${chosen?.name ?? 'Wallet'} is not connected.`),
        h('div', { class: 'exchange-row' },
          button('Connect wallet', 'connect', () => void connect()),
          button('Use a different wallet', 'change', () => void changeWallet(), { primary: false }),
        ),
      );
      return box;
    }
    box.append(
      addressRow('Connected', state.account, status.chain.chainId),
      fine(`${chosen?.name ?? 'Wallet'} · Network: ${state.chain === null ? 'unknown' : eth.chainName(state.chain)}`),
      button('Use a different wallet', 'change', () => void changeWallet(), { primary: false }),
    );
    box.append(chainCheck(status) ?? '');
    if (linked && eth.sameAddress(linked.address, state.account)) {
      box.append(h('p', { class: 'exchange-ok' }, 'This wallet is linked to your account.'));
      return box;
    }
    box.append(
      button(linked ? 'Replace linked wallet with this one' : 'Link this wallet', 'link', () => void link()),
      fine('Your wallet will ask you to sign a message. Signing is free and sends nothing.'),
    );
    if (linked) {
      box.append(warn(`Replacing unlinks ${short(display(linked.address))} and starts a new 72-hour hold on cash-out. Vouchers already issued stay payable to the old wallet.`));
    }
    return box;
  }

  function sendWarnings(status: WalletStatus, token: string): HTMLElement {
    const from = status.wallet ? short(display(status.wallet.address)) : 'your linked wallet';
    return h('div', { class: 'exchange-warn' },
      h('strong', {}, 'Before you send'),
      h('ul', {},
        h('li', {}, `Send from your linked wallet (${from}) only. Transfers from any other wallet are not credited.`),
        h('li', {}, `Send only ${TOKEN} (contract ${short(display(token))}). Any other token is lost.`),
        h('li', {}, `Send only on ${eth.chainName(status.chain.chainId)}. Other networks are not watched.`),
        h('li', {}, 'There are no refunds.'),
      ),
    );
  }

  function amountForm(key: 'buyAmount' | 'cashAmount', label: string, submit: () => void, submitText: (n: number | null) => string, max: number | null): HTMLElement {
    const go = button(submitText(whole(state[key])), `${key}-go`, submit);
    const initial = whole(state[key]);
    go.disabled = Boolean(state.busy) || !initial || (max !== null && initial > max);
    const input = h('input', {
      type: 'text',
      inputmode: 'numeric',
      autocomplete: 'off',
      spellcheck: 'false',
      placeholder: '0',
      value: state[key],
      'data-key': key,
      'aria-label': label,
    });
    input.addEventListener('input', () => {
      state[key] = input.value.replace(/[^\d]/g, '');
      if (input.value !== state[key]) input.value = state[key];
      const n = whole(state[key]);
      go.textContent = submitText(n);
      go.disabled = Boolean(state.busy) || !n || (max !== null && n > max);
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !go.disabled) submit();
    });
    const row = h('div', { class: 'exchange-form' }, h('label', {}, label, input));
    if (max !== null) {
      row.append(button('Max', `${key}-max`, () => {
        state[key] = String(max);
        render();
      }, { primary: false, disabled: max <= 0 }));
    }
    row.append(go);
    return row;
  }

  function depositList(status: WalletStatus, credited: boolean): HTMLElement {
    const decimals = status.chain.tokenDecimals;
    const rows: HTMLElement[] = [];
    if (!credited) {
      for (const deposit of sent.deposits) {
        rows.push(h('li', {}, h('span', {}, `${deposit.verse.toLocaleString('en-US')} ${TOKEN}`), h('span', { class: 'exchange-dim' }, 'Sent, waiting for Ethereum to finalise'), txLink(deposit.tx, deposit.chainId)));
      }
    }
    for (const deposit of status.deposits.filter((d) => (d.status === 'credited') === credited)) {
      rows.push(h('li', {},
        h('span', {}, tokenText(deposit, decimals)),
        h('span', { class: deposit.status === 'credited' ? 'exchange-ok' : 'exchange-dim' }, depositLabel(deposit)),
        txLink(deposit.tx, status.chain.chainId),
      ));
    }
    return rows.length ? h('ul', { class: 'exchange-list' }, ...rows) : fine('None.');
  }

  function tokenText(deposit: DepositView, decimals: number | null): string {
    const tokens = decimals === null ? deposit.amount : formatUnits(BigInt(deposit.amount), decimals);
    return `${tokens} ${TOKEN}${deposit.verse !== null ? ` → ${deposit.verse.toLocaleString('en-US')} Verse` : ''}`;
  }

  function depositLabel(deposit: DepositView): string {
    if (deposit.status === 'credited') return `Credited ${when(deposit.at)}`;
    if (deposit.status === 'held') return 'Received; credited when deposits reopen';
    return 'Received from a wallet that is not linked';
  }

  function buyTab(status: WalletStatus): HTMLElement {
    const box = h('section', { class: 'exchange-tab' },
      h('p', { class: 'exchange-big' }, `1 Verse = 1 ${TOKEN}`),
      addressRow('Token contract', status.chain.tokenAddress, status.chain.chainId),
      addressRow('Deposit address', status.chain.depositAddress, status.chain.chainId),
      sendWarnings(status, status.chain.tokenAddress),
    );
    const block = buyBlock(status);
    if (block) box.append(warn(block));
    else {
      box.append(chainCheck(status) ?? '');
      box.append(amountForm('buyAmount', 'Verse to buy', () => void buy(), (n) => (n ? `Send ${n.toLocaleString('en-US')} ${TOKEN}` : 'Enter an amount'), null));
      box.append(fine('You pay the gas. Verse is credited once the transfer is final on Ethereum, usually about 15 minutes.'));
    }
    box.append(h('h3', {}, 'Pending deposits'), depositList(status, false), h('h3', {}, 'Credited deposits'), depositList(status, true));
    return box;
  }

  function voucherLabel(voucher: VoucherView): string {
    if (voucher.status === 'issued') return 'Waiting for signature';
    if (voucher.status === 'claimed') return 'Claimed';
    if (voucher.status === 'refunded') return 'Refunded to Verse';
    if (sent.claims[voucher.id]) return 'Claim sent';
    if (voucher.expiry <= now()) return 'Expired; the Verse comes back once confirmed';
    if (voucher.expiry <= now() + EXPIRY_MARGIN_S) return 'Expiring; too late to claim';
    return `Ready to claim · expires ${when(voucher.expiry)}`;
  }

  function voucherRow(voucher: VoucherView): HTMLElement {
    const claimTx = voucher.claimTx ?? sent.claims[voucher.id]?.tx ?? null;
    return h('li', {},
      h('span', {}, `${voucher.amount.toLocaleString('en-US')} ${TOKEN}`),
      h('span', { class: voucher.status === 'signed' && !sent.claims[voucher.id] ? 'exchange-ok' : 'exchange-dim' }, voucherLabel(voucher)),
      claimTx ? txLink(claimTx, voucher.chainId) : h('span', { class: 'exchange-dim exchange-mono' }, `to ${short(display(voucher.recipient))}`),
    );
  }

  function claimSection(status: WalletStatus): HTMLElement | null {
    const ready = claimable(status);
    if (ready.length === 0) return null;
    const box = h('div', { class: 'exchange-claim' });
    if (!eth.provider()) {
      box.append(noWalletApp());
      return box;
    }
    if (!state.account) {
      box.append(h('p', {}, 'Connect your wallet to claim.'), button('Connect wallet', 'connect', () => void connect()));
      return box;
    }
    const batch = claimBatch(status, state.account);
    if (batch.vouchers.length === 0) {
      const recipient = ready[0]?.recipient ?? '';
      box.append(warn(`These vouchers pay ${short(display(recipient))}. Switch your wallet to that account to claim; the contract only pays a voucher's recipient.`));
      return box;
    }
    const wrongChain = chainCheck(status);
    if (wrongChain) {
      box.append(wrongChain);
      return box;
    }
    if (state.gas === null) {
      box.append(fine('Checking this wallet has ETH for gas…'));
      return box;
    }
    if (state.gas === 0n) {
      box.append(warn('This wallet has no ETH to pay gas. Add a little ETH on Ethereum to it, then claim.'));
      return box;
    }
    box.append(button(
      `Claim all · ${plural(batch.vouchers.length, 'voucher')} · ${batch.total.toLocaleString('en-US')} ${TOKEN}`,
      'claim',
      () => void claim(),
    ));
    box.append(fine('One transaction claims them all. You pay the gas.'));
    if (batch.left > 0) box.append(fine(`${plural(batch.left, 'more voucher')} after this one. Press Claim all again once this one is sent.`));
    return box;
  }

  function cashTab(status: WalletStatus): HTMLElement {
    const max = cashMax(status);
    const box = h('section', { class: 'exchange-tab' },
      h('div', { class: 'exchange-stats' },
        stat('Verse balance', status.verse.toLocaleString('en-US')),
        stat('Your room today', `${status.accountRoom.toLocaleString('en-US')} of ${status.accountLimit.toLocaleString('en-US')}`),
        stat('Machine room now', status.globalRoom.toLocaleString('en-US')),
      ),
      fine('Your daily room resets at 00:00 UTC. The machine\'s room opens a little more every hour.'),
    );
    const block = cashBlock(status);
    if (block) box.append(warn(block));
    else {
      box.append(amountForm('cashAmount', 'Verse to cash out', () => void withdraw(), (n) => (n ? `Request ${n.toLocaleString('en-US')} ${TOKEN}` : 'Enter an amount'), max));
      if (status.wallet) {
        box.append(fine(`Each request becomes a voucher that pays your linked wallet ${short(display(status.wallet.address))}. Claim within 30 days; after that the Verse comes back.`));
      }
    }
    const open = status.vouchers.filter((voucher) => voucher.status === 'issued' || voucher.status === 'signed');
    box.append(h('h3', {}, 'Vouchers'));
    box.append(open.length ? h('ul', { class: 'exchange-list' }, ...open.map(voucherRow)) : fine('No vouchers waiting.'));
    box.append(claimSection(status) ?? '');
    return box;
  }

  function stat(label: string, value: string): HTMLElement {
    return h('div', { class: 'exchange-stat' }, h('span', { class: 'exchange-label' }, label), h('strong', {}, value));
  }

  function historyTab(status: WalletStatus): HTMLElement {
    const decimals = status.chain.tokenDecimals;
    const deposits = status.deposits.map((deposit) => h('li', {},
      h('span', {}, tokenText(deposit, decimals)),
      h('span', { class: 'exchange-dim' }, depositLabel(deposit)),
      txLink(deposit.tx, status.chain.chainId),
    ));
    const vouchers = status.vouchers.map((voucher) => h('li', {},
      h('span', {}, `${when(voucher.createdAt)} · ${voucher.amount.toLocaleString('en-US')} ${TOKEN}`),
      h('span', { class: 'exchange-dim' }, voucherLabel(voucher)),
      txLink(voucher.claimTx, voucher.chainId),
    ));
    const intents = status.intents.map((intent) => h('li', {},
      h('span', {}, `${ITEM_NAMES[intent.itemId] ?? intent.itemId} · ${intent.versePrice.toLocaleString('en-US')} Verse`),
      h('span', { class: 'exchange-dim' }, intent.status === 'open' ? `Waiting for payment until ${when(intent.expiresAt)}` : intent.status === 'paid' ? 'Paid' : 'Expired'),
    ));
    const list = (rows: HTMLElement[]) => (rows.length ? h('ul', { class: 'exchange-list' }, ...rows) : fine('None yet.'));
    return h('section', { class: 'exchange-tab' },
      h('h3', {}, 'Deposits'), list(deposits),
      h('h3', {}, 'Cash-outs and claims'), list(vouchers),
      h('h3', {}, 'Checkouts'), list(intents),
    );
  }

  function payTab(status: WalletStatus): HTMLElement {
    const box = h('section', { class: 'exchange-tab' });
    const intent = state.intent;
    const name = ITEM_NAMES[state.intentItem] ?? state.intentItem;
    box.append(h('h3', {}, `Pay for ${name} with ${TOKEN}`));
    if (!intent) {
      if (!state.busy) box.append(button('Try again', 'intent', () => startPay(state.intentItem)));
      return box;
    }
    const decimals = status.chain.tokenDecimals;
    const tokens = decimals === null ? intent.versePrice.toLocaleString('en-US') : formatUnits(BigInt(intent.tokenAmount), decimals);
    box.append(
      h('p', { class: 'exchange-big' }, `Send exactly ${tokens} ${TOKEN}`),
      h('div', { class: 'exchange-field' }, h('span', { class: 'exchange-label' }, 'Price'), h('span', {}, `${intent.versePrice.toLocaleString('en-US')} Verse`)),
      addressRow('Token contract', intent.tokenAddress, intent.chainId),
      addressRow('Deposit address', intent.depositAddress, intent.chainId),
      h('div', { class: 'exchange-field' }, h('span', { class: 'exchange-label' }, 'Pay before'), h('span', {}, when(intent.expiresAt))),
      sendWarnings(status, intent.tokenAddress),
      fine('The item is yours once the transfer is final on Ethereum. If the payment comes late or you already own the item, the tokens stay in your account as Verse.'),
    );
    const block = !status.wallet ? 'Link a wallet on the Wallet tab first.'
      : !status.chain.depositsOpen ? 'Deposits are closed right now. Do not send tokens until they reopen.'
        : intent.expiresAt <= now() ? 'This checkout expired. Start again from the store.'
          : !eth.provider() ? 'Choose a wallet on the Wallet tab first.'
            : tokenMismatch(status, intent.tokenAddress);
    if (block) box.append(warn(block));
    else box.append(button(`Send ${tokens} ${TOKEN}`, 'pay', () => void pay()));
    return box;
  }

  return {
    show(mode) {
      if (mode.kind !== 'pay') return;
      if (state.phase === 'ready') startPay(mode.itemId);
      else queued = mode;
    },
    destroy() {
      dead = true;
      window.clearInterval(poll);
      unwatch();
      root.replaceChildren();
    },
  };
}
