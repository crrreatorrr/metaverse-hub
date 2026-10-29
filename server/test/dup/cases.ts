/**
 * Duplication cases. M1 runs the rows in `M1_FLOWS`.
 *
 * M2: append one relic and one exchange per game to `M2_FLOWS`.
 *   hpos10i relic  eventId `hpos10i.level_complete` data `{zone:'z1_retro_rush_hills', act:1, time}` relicId `hpos10i_core`
 *   pb relic       eventId `pb.quest_complete` data `{questId:'quest_tutorial'}` relicId `genesis_shard`
 *   nobu relic     eventId `nobu.boss_defeated` data `{boss:'cone'}` relicId `cones_tip`
 *   Each exchange uses that game id. The suite already drives `tickets.earn` and `tickets.exchange`.
 *
 * M7: append a purchase to `M7_FLOWS`. The suite calls `store.buy` with `{ defId, key }`.
 *   Keep `priceVerse` within the 50 Verse daily cap (fund via earn + exchange).
 *   Add `HubFault.apply` in that RPC at `purchase.before_rpc` and `purchase.after_commit`.
 *   The wallet trigger already checks `purchase.after_wallet`. The audit picks up
 *   `game.purchase_tx` and `game.cosmetic_owned` as soon as those tables exist.
 */

export const TICKETS_PER_VERSE = 10;
export const VERSE_DAILY_CAP = 50;
/** Per-game tickets the server will credit in one UTC day. Mirrors `game.earn_tickets`. */
export const TICKET_DAILY_CAP = 1000;

export interface RelicFlow {
  kind: 'relic';
  id: string;
  game: 'hpos10i' | 'nobu' | 'pb' | 'sproto';
  eventId: string;
  data: Record<string, unknown>;
  /** Same key, different body. Must still be a valid-looking object. */
  mismatchData: Record<string, unknown>;
  relicId: string;
}

export interface ExchangeFlow {
  kind: 'exchange';
  id: string;
  game: 'hpos10i' | 'nobu' | 'pb' | 'sproto';
  /** Funded with `tickets.earn` before the exchange. Under the daily earn cap. */
  earnAmount: number;
  earnReason: string;
  /** Sent to `tickets.exchange`. The server debits `verse * 10`. */
  tickets: number;
  verse: number;
}

export interface EarnFlow {
  kind: 'earn';
  id: string;
  game: 'hpos10i' | 'nobu' | 'pb' | 'sproto';
  /** What the game passes to `earnTickets`. HPOS10I sends the act's ticket count. */
  amount: number;
  reason: string;
}

export interface PurchaseFlow {
  kind: 'purchase';
  id: string;
  defId: string;
  priceVerse: number;
}

/**
 * PB shop. `tickets.spend` and `tickets.sell` take
 * `{game:'peoples-bitcoin', shop_id, item_id, packs, key}`.
 * `game.shop_price` is keyed by `(game, shop_id, item_id)` and seeded from
 * `pb_shop_prices.csv` (ticket_price, sell_price, pack_size). No test inserts prices.
 */
export interface ShopFlow {
  kind: 'shop';
  id: string;
  game: 'peoples-bitcoin';
  rpc: 'tickets.spend';
}

export type DupFlow = RelicFlow | ExchangeFlow | EarnFlow | PurchaseFlow | ShopFlow;

export const M1_FLOWS: DupFlow[] = [
  {
    kind: 'relic',
    id: 'sproto.tinubu_crown',
    game: 'sproto',
    eventId: 'sproto.boss_defeated',
    data: { boss: 'tinubu', elapsed: 12 },
    mismatchData: { boss: 'tinubu', elapsed: 99 },
    relicId: 'tinubu_crown',
  },
  {
    kind: 'exchange',
    id: 'sproto.tickets_to_verse',
    game: 'sproto',
    // One sproto `win`. event_rule max_amount is 20, so a second exchange is funded by another earn.
    earnAmount: 20,
    earnReason: 'win',
    tickets: 20,
    verse: 2,
  },
];

/**
 * HPOS10I payloads from the game client (HPOS10I PR #2, 229178a):
 * reportEvent('hpos10i.level_complete', {zone, act, time}, relicKey)
 * earnTickets(actTickets, 'level_end', earnKey) with a different key
 * exchange(tickets, key) in steps of 10, at most 500 tickets.
 * `time` is seconds rounded to the millisecond. It is an extra field on top of
 * the event_rule match {zone, act}.
 */
export const M2_FLOWS: DupFlow[] = [
  {
    kind: 'relic',
    id: 'hpos10i.hpos10i_core',
    game: 'hpos10i',
    eventId: 'hpos10i.level_complete',
    data: { zone: 'z1_retro_rush_hills', act: 1, time: 40.125 },
    mismatchData: { zone: 'z1_retro_rush_hills', act: 2, time: 40.125 },
    relicId: 'hpos10i_core',
  },
  {
    kind: 'exchange',
    id: 'hpos10i.tickets_to_verse',
    game: 'hpos10i',
    earnAmount: 20,
    earnReason: 'level_end',
    tickets: 10,
    verse: 1,
  },
  {
    kind: 'earn',
    id: 'hpos10i.level_end',
    game: 'hpos10i',
    amount: 20,
    reason: 'level_end',
  },
  {
    kind: 'relic',
    id: 'nobu.cones_tip',
    game: 'nobu',
    eventId: 'nobu.boss_defeated',
    data: { boss: 'cone' },
    mismatchData: { boss: 'not_cone' },
    relicId: 'cones_tip',
  },
  {
    kind: 'exchange',
    id: 'nobu.tickets_to_verse',
    game: 'nobu',
    earnAmount: 20,
    earnReason: 'level_end',
    tickets: 10,
    verse: 1,
  },
  {
    kind: 'earn',
    id: 'nobu.level_end',
    game: 'nobu',
    amount: 20,
    reason: 'level_end',
  },
];

export const M7_FLOWS: DupFlow[] = [];

/** Not part of `FLOWS`: shop cases stay gated until `tickets.spend` lands. */
export const M2_SHOP: ShopFlow[] = [
  {
    kind: 'shop',
    id: 'pb.tickets_spend',
    game: 'peoples-bitcoin',
    rpc: 'tickets.spend',
  },
];

export const FLOWS: DupFlow[] = [...M1_FLOWS, ...M2_FLOWS, ...M7_FLOWS];

export function repeatCount(kind: 'sequential' | 'concurrent' | 'fault' | 'kill'): number {
  const fallback = { sequential: 100, concurrent: 20, fault: 100, kill: 2 }[kind];
  const raw = process.env.DUP_REPEATS;
  if (!raw || kind === 'kill') {
    if (kind === 'kill' && process.env.DUP_KILL_REPEATS) {
      const n = Number(process.env.DUP_KILL_REPEATS);
      if (Number.isFinite(n) && n >= 0) return Math.floor(n);
    }
    return fallback;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
