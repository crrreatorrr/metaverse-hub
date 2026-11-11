import type { GameId } from '@metaverse/hub-sdk';
import { gameInfo } from '../game-list';

/**
 * Return summary (plan item D4). Before the plaza hands the tab to a game it stores what the
 * account had; on a `#from=<game>` arrival it compares that with the fresh profile.
 */
export const TRIP_KEY = 'hub:trip';
/** A stored trip older than this is ignored (the tab sat on the game page for a day). */
export const TRIP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface TripSnapshot {
  game: GameId;
  relics: string[];
  verse: number;
  at: number;
}

export function encodeTrip(snapshot: TripSnapshot): string {
  return JSON.stringify(snapshot);
}

export function parseTrip(stored: string | null, now: number): TripSnapshot | null {
  if (!stored) return null;
  try {
    const raw = JSON.parse(stored) as Partial<TripSnapshot> | null;
    if (!raw || typeof raw !== 'object') return null;
    const game = typeof raw.game === 'string' ? gameInfo(raw.game as GameId)?.id : undefined;
    if (!game || !Array.isArray(raw.relics) || typeof raw.verse !== 'number' || typeof raw.at !== 'number') return null;
    if (!Number.isFinite(raw.verse) || now - raw.at > TRIP_MAX_AGE_MS || raw.at > now + 60_000) return null;
    return { game, relics: raw.relics.filter((id): id is string => typeof id === 'string'), verse: raw.verse, at: raw.at };
  } catch {
    return null;
  }
}

export interface TripSummary {
  game: GameId;
  label: string;
  /** Relics the account holds now and did not when it left. */
  newRelics: string[];
  /** Verse gained while away (never negative). */
  verseGained: number;
  /** Nothing changed: show the nearest goal instead. */
  quiet: boolean;
  /** "Defeat Cone for Cone's Tip", when this game's Relic is still missing. */
  goal: string | null;
}

export function tripSummary(
  before: TripSnapshot,
  after: { relics: readonly string[]; verse: number },
  relicOf: (game: GameId) => string | undefined,
): TripSummary {
  const had = new Set(before.relics);
  const newRelics = after.relics.filter((id) => !had.has(id));
  const verseGained = Math.max(0, Math.floor(after.verse - before.verse));
  const info = gameInfo(before.game);
  const relic = relicOf(before.game);
  const ownsRelic = relic !== undefined && after.relics.includes(relic);
  return {
    game: before.game,
    label: info?.label ?? before.game,
    newRelics,
    verseGained,
    quiet: newRelics.length === 0 && verseGained === 0,
    goal: ownsRelic ? null : info?.goal ?? null,
  };
}

/** Lines for the card, most important first. `tickets` is this game's wallet, when known. */
export function tripLines(summary: TripSummary, relicName: (id: string) => string, tickets: number | null): string[] {
  const lines: string[] = [];
  for (const id of summary.newRelics) lines.push(`New Relic: ${relicName(id)}. It lights a socket on the statue.`);
  if (summary.verseGained > 0) lines.push(`+${summary.verseGained} Verse`);
  if (tickets !== null && tickets > 0) lines.push(`${tickets.toLocaleString('en-US')} ${summary.label} Tickets in your wallet. Exchange them in Menu → Wallet.`);
  if (summary.quiet && summary.goal) lines.push(`Next: ${summary.goal}.`);
  if (lines.length === 0) lines.push('Nothing new this trip.');
  return lines;
}
