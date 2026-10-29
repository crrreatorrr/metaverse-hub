/**
 * Duplication cases. M1 runs the rows in `M1_FLOWS`.
 *
 * M2: append one relic and one exchange per game to `M2_FLOWS`.
 *   hpos10i relic  eventId `hpos10i.level_complete` data `{zone:'z1_retro_rush_hills', act:1}` relicId `hpos10i_core`
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

export interface PurchaseFlow {
  kind: 'purchase';
  id: string;
  defId: string;
  priceVerse: number;
}

export type DupFlow = RelicFlow | ExchangeFlow | PurchaseFlow;

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
    earnAmount: 40,
    earnReason: 'win',
    tickets: 20,
    verse: 2,
  },
];

export const M2_FLOWS: DupFlow[] = [];

export const M7_FLOWS: DupFlow[] = [];

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
