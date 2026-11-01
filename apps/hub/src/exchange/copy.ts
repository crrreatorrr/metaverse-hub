// Plain-language text for server error codes and wallet errors at the exchange machine.
import { HubSdkError } from '@metaverse/hub-sdk';
import { WalletError } from './eth';

const SERVER: Record<string, string> = {
  wallet_hold: 'Cash-out is on hold for 72 hours after a wallet is linked or replaced. This protects your Verse if someone else gets into your account.',
  account_limit: 'That is more than your cash-out room left today. It resets at 00:00 UTC.',
  global_limit: 'The machine has paid out all it can for now. More opens up every hour. Try a smaller amount or come back later.',
  insufficient_verse: 'You do not have that much Verse.',
  cashout_closed: 'Cash-out is closed right now. Try again later.',
  deposits_closed: 'Deposits are closed right now. Do not send tokens until they reopen.',
  no_wallet: 'Link a wallet on the Wallet tab first.',
  address_taken: 'That wallet is already linked to another account.',
  bad_signature: 'The wallet signature did not check out. Start linking again.',
  bad_nonce: 'That sign-in request expired. Start linking again.',
  rate_limited: 'Too many requests. Wait a minute and try again.',
  bad_amount: 'Enter a whole number of Verse.',
  bad_address: 'That wallet address is not valid.',
  bad_item: 'That item cannot be bought with HPOS10I $BITCOIN.',
  bad_chain: 'Only Ethereum is supported.',
  bad_key: 'That request could not be sent. Try again.',
  idempotency_mismatch: 'That request clashed with an earlier one. Try again.',
  chain_unavailable: 'The exchange cannot reach Ethereum right now. Try again later.',
  unauthorized: 'Your session ended. Reload the page.',
  rpc_failed: 'The exchange could not reach the server. Try again.',
};

/** Message for anything thrown by the wallet API or the injected wallet. */
export function explain(error: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (error instanceof HubSdkError) {
    const known = SERVER[error.code];
    if (known) return known;
    if (error.code.startsWith('missing_')) return 'The exchange is not set up yet. Try again later.';
    return fallback;
  }
  if (error instanceof WalletError) {
    if (error.code === 4001) return 'You cancelled the request in your wallet.';
    if (error.code === 4100) return 'Unlock your wallet and allow this site, then try again.';
    if (error.code === 4902) return 'Your wallet does not know this network. Add Ethereum to it and try again.';
    if (error.code === -32002) return 'Your wallet already has a request waiting. Open the wallet to answer it.';
    if (/insufficient funds/i.test(error.message)) return 'Your wallet does not have enough ETH to pay gas.';
    return error.message;
  }
  if (error instanceof TypeError) return 'The exchange could not reach the server. Try again.';
  return fallback;
}

/** True when a retry with the same idempotency key is safe and useful (network trouble, not a refusal). */
export function retryable(error: unknown): boolean {
  if (error instanceof HubSdkError) return error.code === 'rpc_failed' && (error.status === undefined || error.status >= 500);
  return error instanceof TypeError;
}
