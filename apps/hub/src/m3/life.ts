import type { ChampionEntry, GameId, PortalPresence } from './types';

/**
 * Answers of hub.presence and hub.champions turned into what the gate boards and the Hall of
 * Champions paint (plan items E3, E4). Pure: junk from the wire is dropped or clamped.
 */
export function presenceRows(counts: Record<string, unknown>, gates: readonly GameId[]): PortalPresence[] {
  return gates.map((gameId) => {
    const raw = counts[gameId];
    const count = typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
    return { gameId, count, names: [], top: [] };
  });
}

export function championRows(rows: readonly { order?: unknown; userId?: unknown; name?: unknown }[]): ChampionEntry[] {
  const out: ChampionEntry[] = [];
  for (const row of rows) {
    if (typeof row.userId !== 'string' || !row.userId) continue;
    const name = typeof row.name === 'string' && row.name ? row.name.slice(0, 24) : row.userId.slice(0, 8);
    out.push({ order: out.length + 1, playerId: row.userId, name });
    if (out.length === 50) break;
  }
  return out;
}
