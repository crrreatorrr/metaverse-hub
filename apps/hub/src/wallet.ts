import { TICKETS_PER_VERSE, VERSE_DAILY_CAP, type GameId } from '@metaverse/hub-sdk';

/**
 * Hub Wallet (plan item B1): Tickets per game and the exchange to Verse, from the plaza.
 * Pure helpers shared by the menu and the tests. The server (verse.exchange, tickets.balances)
 * decides every amount; this only works out what to offer and keeps retry keys.
 */

/** The eight games with a Ticket wallet, in menu order. Matches `HubRpc.WALLET_GAMES` on the server. */
export const WALLET_GAMES: readonly { id: GameId; label: string }[] = [
  { id: 'hpos10i', label: 'HPOS10I' },
  { id: 'nobu', label: 'NOBU: Saviour Dog' },
  { id: 'peoples-bitcoin', label: "The People's Bitcoin" },
  { id: 'sproto', label: 'Sproto Duel' },
  { id: 'sproto-fighter', label: 'Sproto Fighter' },
  { id: 'sproto-arcade', label: 'Sproto Arcade' },
  { id: 'sproto-shooter', label: 'Sproto Shooter' },
  { id: 'sproto-coop-battle', label: 'Sproto Coop Battle' },
];

export interface WalletRow {
  game: GameId;
  label: string;
  /** Tickets held in this game's wallet. */
  balance: number;
  /** Verse this game can still give today (UTC). */
  verseCapLeft: number;
}

export interface WalletState {
  rows: WalletRow[];
  verse: number;
  /** False while the server's `hub_exchange` flag is off for this account: balances show, exchange waits. */
  exchangeEnabled: boolean;
}

/** `tickets.balances` answer. Unknown games are dropped; a missing game reads as an empty wallet. */
export interface BalancesAnswer {
  wallets?: { game?: string; balance?: number; verseCapLeft?: number }[];
  verse?: number;
  exchangeEnabled?: boolean;
}

function whole(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

export function walletFromAnswer(answer: BalancesAnswer): WalletState {
  const byGame = new Map((answer.wallets ?? []).map((wallet) => [wallet.game, wallet]));
  return {
    rows: WALLET_GAMES.map(({ id, label }) => {
      const wallet = byGame.get(id);
      return {
        game: id,
        label,
        balance: whole(wallet?.balance, 0),
        verseCapLeft: Math.min(VERSE_DAILY_CAP, whole(wallet?.verseCapLeft, VERSE_DAILY_CAP)),
      };
    }),
    verse: whole(answer.verse, 0),
    // Only an explicit true opens the buttons: an older server or a missing field keeps them closed.
    exchangeEnabled: answer.exchangeEnabled === true,
  };
}

export interface ExchangeOffer {
  /** Tickets to send: the largest multiple of 10 within the balance and today's cap. 0 means no offer. */
  tickets: number;
  verse: number;
  /** Why there is no offer. */
  blocked: 'none' | 'need_tickets' | 'cap';
}

export function exchangeOffer(balance: number, verseCapLeft: number): ExchangeOffer {
  const affordable = Math.floor(Math.max(0, balance) / TICKETS_PER_VERSE);
  const room = Math.max(0, Math.floor(verseCapLeft));
  const verse = Math.min(affordable, room);
  if (verse > 0) return { tickets: verse * TICKETS_PER_VERSE, verse, blocked: 'none' };
  return { tickets: 0, verse: 0, blocked: affordable > 0 ? 'cap' : 'need_tickets' };
}

export function offerLabel(offer: ExchangeOffer): string {
  if (offer.blocked === 'cap') return 'Daily cap reached';
  if (offer.blocked === 'need_tickets') return `Need ${TICKETS_PER_VERSE} Tickets`;
  return `Exchange ${offer.tickets} for ${offer.verse} Verse`;
}

export const WALLET_RATE_LINE = `${TICKETS_PER_VERSE} Tickets = 1 Verse · up to ${VERSE_DAILY_CAP} Verse from each game per day`;
export const WALLET_CLOSED_TEXT = 'Exchanging Tickets in the plaza is not open yet. Your Tickets are safe in each game.';
export const WALLET_CLOSED_LABEL = 'Not open yet';
export const WALLET_OFFLINE_TEXT = 'The wallet needs the hub server. Offline: playing solo.';

/** verse.exchange answer on success. */
export interface ExchangeAnswer {
  verse: number;
  gained?: number;
  ticketsLeft: number;
  verseCapLeft: number;
}

/** Apply a finished exchange to the shown state. */
export function applyExchange(state: WalletState, game: GameId, answer: ExchangeAnswer): WalletState {
  return {
    exchangeEnabled: state.exchangeEnabled,
    verse: whole(answer.verse, state.verse),
    rows: state.rows.map((row) => row.game === game
      ? { ...row, balance: whole(answer.ticketsLeft, row.balance), verseCapLeft: whole(answer.verseCapLeft, row.verseCapLeft) }
      : row),
  };
}

/** Sentence for a refused exchange. `code` is the server's error code. */
export function exchangeErrorText(code: string): string {
  switch (code) {
    case 'exchange_off': return WALLET_CLOSED_TEXT;
    case 'verse_cap': return "That would pass today's Verse cap for this game.";
    case 'insufficient_tickets': return 'Not enough Tickets in that wallet.';
    case 'below_rate': return `It takes ${TICKETS_PER_VERSE} Tickets to make 1 Verse.`;
    case 'rate_limited': return 'Too many requests. Try again in a moment.';
    default: return 'The exchange did not go through. Nothing was taken.';
  }
}

/**
 * Idempotency keys for exchanges. A request keeps its key until the server answers it (success or a
 * refusal), so a retry after a dropped connection replays the same request instead of exchanging twice.
 */
export function createExchangeKeys(newKey: () => string): {
  keyFor(game: GameId, tickets: number): string;
  settle(game: GameId, tickets: number): void;
} {
  const pending = new Map<string, string>();
  const slot = (game: GameId, tickets: number) => `${game}:${tickets}`;
  return {
    keyFor(game, tickets) {
      const at = slot(game, tickets);
      let key = pending.get(at);
      if (!key) {
        key = newKey();
        pending.set(at, key);
      }
      return key;
    },
    settle(game, tickets) {
      pending.delete(slot(game, tickets));
    },
  };
}
