import { HubSdkError } from './errors';
import type { NakamaClient } from './nakama';

/** HPOS10I $BITCOIN on Ethereum. 1 Verse = 1 whole token, fixed. */
export const BITCOIN_TOKEN_ETH = '0x72e4f9F808C49A2a61dE9C5896298920Dc4EEEa9';

export type ExchangeChain = 'eth';

export interface ExchangeChainStatus {
  chain: ExchangeChain;
  chainId: number;
  tokenAddress: string;
  tokenDecimals: number | null;
  depositAddress: string | null;
  cashoutAddress: string | null;
  depositsOpen: boolean;
  cashoutOpen: boolean;
}

export interface LinkedWallet {
  address: string;
  /** Unix seconds. */
  linkedAt: number;
  /** Unix seconds. No new cash-out before this. */
  holdUntil: number;
}

export type VoucherStatus = 'issued' | 'signed' | 'claimed' | 'refunded';

export interface VoucherView {
  /** uint256 voucher id as a decimal string. */
  id: string;
  recipient: string;
  /** Whole Verse; the contract pays the same number of whole $BITCOIN. */
  amount: number;
  /** Unix seconds. Claimable while the block time is at or before this. */
  expiry: number;
  status: VoucherStatus;
  /** 65-byte r‖s‖v, present once signed. */
  signature: string | null;
  cashoutAddress: string;
  chainId: number;
  claimTx: string | null;
  createdAt: number;
}

export interface DepositView {
  tx: string;
  /** Token base units as a decimal string. */
  amount: string;
  verse: number | null;
  status: 'credited' | 'unmatched' | 'held';
  at: number;
}

export interface IntentView {
  intentId: string;
  itemId: string;
  versePrice: number;
  status: 'open' | 'paid' | 'expired';
  expiresAt: number;
}

export interface WalletStatus {
  verse: number;
  chain: ExchangeChainStatus;
  wallet: LinkedWallet | null;
  accountLimit: number;
  accountRoom: number;
  globalRoom: number;
  refUsdPerToken: number | null;
  vouchers: VoucherView[];
  deposits: DepositView[];
  intents: IntentView[];
}

export interface LinkNonce {
  nonce: string;
  /** Exact text the wallet must sign with personal_sign. */
  message: string;
  address: string;
  chainId: number;
}

export interface LinkResult {
  address: string;
  chain: ExchangeChain;
  linkedAt: string;
  changed: boolean;
}

export interface WithdrawResult {
  withdrawalId: string;
  amount: number;
  recipient: string;
  expiry: number;
  verse: number;
  accountRoom: number;
}

export interface IntentResult {
  intentId: string;
  itemId: string;
  versePrice: number;
  /** Token base units to send, as a decimal string. */
  tokenAmount: string;
  depositAddress: string;
  tokenAddress: string;
  chainId: number;
  expiresAt: number;
}

/** Hub-session wallet calls for the Bar exchange machine and store checkout. */
export interface WalletApi {
  status(): Promise<WalletStatus>;
  nonce(address: string, chain?: ExchangeChain): Promise<LinkNonce>;
  link(nonce: string, signature: string): Promise<LinkResult>;
  withdraw(amount: number, key: string, chain?: ExchangeChain): Promise<WithdrawResult>;
  intent(itemId: string, chain?: ExchangeChain): Promise<IntentResult>;
}

export function createWalletApi(client: NakamaClient, token: () => string): WalletApi {
  const call = <T>(id: string, body: object) => client.rpc<T>(id, body, { token: token() });
  return {
    status: () => call<WalletStatus>('wallet.status', {}),
    nonce: (address, chain = 'eth') => call<LinkNonce>('wallet.nonce', { address, chain }),
    link: (nonce, signature) => call<LinkResult>('wallet.link', { nonce, signature }),
    withdraw(amount, key, chain = 'eth') {
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        return Promise.reject(new HubSdkError('bad_amount', 'Cash-out amount must be a whole number of Verse'));
      }
      return call<WithdrawResult>('wallet.withdraw', { amount, key, chain });
    },
    intent: (itemId, chain = 'eth') => call<IntentResult>('store.intent', { itemId, chain }),
  };
}

/** Base units for `verse` whole tokens, e.g. 50 Verse with 8 decimals → 5000000000n. */
export function tokenUnits(verse: number, decimals: number): bigint {
  if (!Number.isSafeInteger(verse) || verse < 0) throw new HubSdkError('bad_amount', 'Verse must be a whole number');
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new HubSdkError('bad_decimals', 'Token decimals are not valid');
  return BigInt(verse) * 10n ** BigInt(decimals);
}
