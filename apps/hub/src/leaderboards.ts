// Live Bar screen provider: leaderboard.top for the game boards (NOBU one page
// per level, ms values) and verse.board rows for the Verse pages.
import type { NakamaClient } from '@metaverse/hub-sdk';
import {
  BOARD_META,
  HUB_BOARD_IDS,
  serverBoard,
  type HubBoardId,
  type LeaderboardPage,
  type LeaderboardProvider,
  type LeaderboardRow,
} from './m3/types';

interface TopRow { userId?: string; name?: string; value?: number; rank?: number }
interface VerseRow { name?: string; gameId?: string; lifetime?: number; userId?: string }

const VERSE_GAME: Partial<Record<HubBoardId, string>> = {
  verse_by_game_hpos10i: 'hpos10i',
  verse_by_game_nobu: 'nobu',
  'verse_by_game_peoples-bitcoin': 'peoples-bitcoin',
  verse_by_game_sproto: 'sproto',
};

function rank(rows: { playerId: string; name: string; score: number }[], order: 'asc' | 'desc'): LeaderboardRow[] {
  const sorted = [...rows].sort((a, b) => (order === 'asc' ? a.score - b.score : b.score - a.score));
  let last = NaN;
  let place = 0;
  return sorted.slice(0, 10).map((row, i) => {
    if (row.score !== last) place = i + 1;
    last = row.score;
    return { rank: place, ...row };
  });
}

export function createLiveLeaderboardProvider(client: NakamaClient, token: () => string): LeaderboardProvider {
  let verse: { at: number; rows: VerseRow[] } | null = null;

  async function verseRows(): Promise<VerseRow[]> {
    if (verse && Date.now() - verse.at < 30_000) return verse.rows;
    const body = await client.rpc<{ rows?: VerseRow[] }>('verse.board', {}, { token: token() });
    verse = { at: Date.now(), rows: body.rows ?? [] };
    return verse.rows;
  }

  return {
    boards: HUB_BOARD_IDS,
    async load(boardId) {
      const meta = BOARD_META[boardId];
      const base: Omit<LeaderboardPage, 'rows'> = { boardId, title: meta.title, order: meta.order, unit: meta.unit };
      const server = serverBoard(boardId);
      if (server) {
        const body: Record<string, unknown> = { boardId: server.board, limit: 10 };
        if (server.variant) body.variant = server.variant;
        const top = await client.rpc<{ rows?: TopRow[] }>('leaderboard.top', body, { token: token() });
        return {
          ...base,
          rows: (top.rows ?? []).map((r, i) => ({
            rank: typeof r.rank === 'number' ? r.rank : i + 1,
            playerId: r.userId ?? '',
            name: r.name || 'player',
            score: typeof r.value === 'number' ? r.value : Number(r.value ?? 0),
          })),
        };
      }
      const rows = await verseRows();
      const game = VERSE_GAME[boardId];
      const sums = new Map<string, { playerId: string; name: string; score: number }>();
      for (const row of rows) {
        if (!row.name || typeof row.lifetime !== 'number') continue;
        if (game && row.gameId !== game) continue;
        const key = row.userId ?? row.name;
        const prev = sums.get(key) ?? { playerId: key, name: row.name, score: 0 };
        prev.score += row.lifetime;
        sums.set(key, prev);
      }
      return { ...base, rows: rank([...sums.values()], meta.order) };
    },
  };
}
