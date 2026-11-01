// Injected-wallet (EIP-1193) calls for the exchange machine. Lazy chunk only: main.ts never
// imports this file, so viem stays out of the hub entry bundle.
import { encodeFunctionData, erc20Abi, getAddress, isAddress, parseAbi, stringToHex, type Hex } from 'viem';

interface Eip1193Provider {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

/** A voucher as the claim contract takes it: `(uint256 id, address recipient, uint256 amount, uint256 expiry)`. */
export interface ClaimVoucher {
  id: bigint;
  recipient: `0x${string}`;
  amount: bigint;
  expiry: bigint;
}

const cashoutAbi = parseAbi([
  'struct Voucher { uint256 id; address recipient; uint256 amount; uint256 expiry; }',
  'function claim(Voucher voucher, bytes signature)',
  'function claimBatch(Voucher[] vouchers, bytes[] signatures)',
]);

/** VerseCashout.MAX_BATCH. */
export const MAX_CLAIM_BATCH = 64;

/** Error from the wallet with its EIP-1193 code, when it has one. */
export class WalletError extends Error {
  readonly code: number | null;
  constructor(message: string, code: number | null = null) {
    super(message);
    this.name = 'WalletError';
    this.code = code;
  }
}

export function provider(): Eip1193Provider | null {
  const injected = (window as { ethereum?: unknown }).ethereum;
  if (!injected || typeof (injected as Eip1193Provider).request !== 'function') return null;
  return injected as Eip1193Provider;
}

function need(): Eip1193Provider {
  const p = provider();
  if (!p) throw new WalletError('No Ethereum wallet in this browser');
  return p;
}

async function call<T>(method: string, params?: readonly unknown[]): Promise<T> {
  try {
    return (await need().request({ method, params })) as T;
  } catch (error) {
    if (error instanceof WalletError) throw error;
    const e = error as { code?: unknown; message?: unknown };
    throw new WalletError(typeof e.message === 'string' ? e.message : 'Wallet request failed', typeof e.code === 'number' ? e.code : null);
  }
}

export function checksum(address: string): `0x${string}` {
  return getAddress(address);
}

export function validAddress(address: string | null | undefined): address is string {
  return typeof address === 'string' && isAddress(address, { strict: false });
}

export function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

function firstAccount(list: unknown): `0x${string}` | null {
  if (!Array.isArray(list) || typeof list[0] !== 'string' || !validAddress(list[0])) return null;
  return checksum(list[0]);
}

/** Accounts the wallet already shares with this site. Never opens a wallet prompt. */
export async function knownAccount(): Promise<`0x${string}` | null> {
  if (!provider()) return null;
  return firstAccount(await call<unknown>('eth_accounts'));
}

/** Asks the wallet to connect. Opens the wallet prompt if the site is not connected yet. */
export async function requestAccount(): Promise<`0x${string}`> {
  const account = firstAccount(await call<unknown>('eth_requestAccounts'));
  if (!account) throw new WalletError('The wallet did not share an account');
  return account;
}

export async function chainId(): Promise<number> {
  const hex = await call<string>('eth_chainId');
  return Number.parseInt(hex, 16);
}

/** Switches the wallet to `target` if it is on another chain. Throws if the wallet stays elsewhere. */
export async function ensureChain(target: number): Promise<void> {
  if ((await chainId()) === target) return;
  await call('wallet_switchEthereumChain', [{ chainId: `0x${target.toString(16)}` }]);
  if ((await chainId()) !== target) throw new WalletError(`Switch your wallet to ${chainName(target)}`);
}

/** EIP-191 personal_sign of the exact text. */
export async function signMessage(message: string, account: string): Promise<Hex> {
  const signature = await call<string>('personal_sign', [stringToHex(message), account]);
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]+$/.test(signature)) throw new WalletError('The wallet returned no signature');
  return signature as Hex;
}

export async function ethBalance(account: string): Promise<bigint> {
  return BigInt(await call<string>('eth_getBalance', [account, 'latest']));
}

/** `true` mined ok, `false` reverted, `null` not mined yet (or unknown to this node). */
export async function txSucceeded(hash: string): Promise<boolean | null> {
  const receipt = await call<{ status?: string } | null>('eth_getTransactionReceipt', [hash]);
  if (!receipt || typeof receipt.status !== 'string') return null;
  return receipt.status === '0x1';
}

async function send(from: string, to: string, data: Hex): Promise<Hex> {
  const hash = await call<string>('eth_sendTransaction', [{ from, to, data, value: '0x0' }]);
  if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new WalletError('The wallet returned no transaction');
  return hash as Hex;
}

/** ERC-20 `transfer(to, units)` on `token`, sent from `from`. */
export function sendTokenTransfer(from: string, token: string, to: string, units: bigint): Promise<Hex> {
  const data = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [checksum(to), units] });
  return send(from, checksum(token), data);
}

/** One transaction to the cashout contract: `claim` for one voucher, `claimBatch` for more. */
export function sendClaim(from: string, cashout: string, vouchers: readonly ClaimVoucher[], signatures: readonly Hex[]): Promise<Hex> {
  if (vouchers.length === 0 || vouchers.length > MAX_CLAIM_BATCH || vouchers.length !== signatures.length) {
    throw new WalletError('Claim batch is not valid');
  }
  const [voucher] = vouchers;
  const [signature] = signatures;
  const data = vouchers.length === 1 && voucher && signature
    ? encodeFunctionData({ abi: cashoutAbi, functionName: 'claim', args: [voucher, signature] })
    : encodeFunctionData({ abi: cashoutAbi, functionName: 'claimBatch', args: [vouchers, signatures] });
  return send(from, checksum(cashout), data);
}

/** Wallet events while the machine is open. Returns the unsubscribe. */
export function watchWallet(onChange: () => void): () => void {
  const p = provider();
  if (!p?.on) return () => {};
  const listener = () => onChange();
  p.on('accountsChanged', listener);
  p.on('chainChanged', listener);
  return () => {
    p.removeListener?.('accountsChanged', listener);
    p.removeListener?.('chainChanged', listener);
  };
}

export function chainName(id: number): string {
  if (id === 1) return 'Ethereum';
  if (id === 11155111) return 'Sepolia (test network)';
  return `chain ${id}`;
}

export function explorer(id: number): string | null {
  if (id === 1) return 'https://etherscan.io';
  if (id === 11155111) return 'https://sepolia.etherscan.io';
  return null;
}
