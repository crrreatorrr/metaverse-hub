import type { GameId } from '@metaverse/hub-sdk';

/**
 * One map from portal to page.
 *
 * Order, first match wins:
 * 1. `VITE_GAME_URL_*` when that variable is set. Empty means the portal is unset.
 * 2. Production `https://play.<domain>/<slug>/` when the apex domain is known.
 * 3. A confirmed current URL, if this repo has one. Not a guess.
 * 4. Dev `/play/<slug>/`.
 * 5. Unset. The plaza shows "Coming soon" and does not navigate.
 *
 * Sproto Duel's public slug is `sproto-duel`. Nakama's game id stays `sproto`.
 * The dev server rewrites `/play/sproto-duel/` onto the in-repo mock at
 * `/play/sproto/`, which already redeems `#t=` and returns to `/hub/#from=sproto`.
 */
export interface GameUrlEntry {
  id: GameId;
  /** Path segment under `/play/` and on `play.<domain>`. */
  slug: string;
  env: 'VITE_GAME_URL_HPOS10I' | 'VITE_GAME_URL_NOBU' | 'VITE_GAME_URL_PEOPLES_BITCOIN' | 'VITE_GAME_URL_SPROTO_DUEL';
  /**
   * Page confirmed from that game's own repo. Omitted when none was found.
   * HPOS10I: README "Play" section and the repo GitHub Pages site.
   */
  current?: string;
}

export const GAME_URLS: readonly GameUrlEntry[] = [
  {
    id: 'hpos10i',
    slug: 'hpos10i',
    env: 'VITE_GAME_URL_HPOS10I',
    current: 'https://crrreatorrr.github.io/HPOS10I/',
  },
  {
    id: 'nobu',
    slug: 'nobu',
    env: 'VITE_GAME_URL_NOBU',
  },
  {
    id: 'peoples-bitcoin',
    slug: 'peoples-bitcoin',
    env: 'VITE_GAME_URL_PEOPLES_BITCOIN',
  },
  {
    id: 'sproto',
    slug: 'sproto-duel',
    env: 'VITE_GAME_URL_SPROTO_DUEL',
  },
];

export interface GameUrlContext {
  /** Vite dev server. Production builds pass false. */
  dev: boolean;
  /** Apex hostname, no scheme. Production uses `https://play.<domain>/<slug>/`. */
  playDomain?: string;
  /** Per-game override. A string, including `''`, replaces the default. */
  overrides?: Partial<Record<GameId, string | undefined>>;
}

export function gameById(id: GameId): GameUrlEntry | undefined {
  return GAME_URLS.find((game) => game.id === id);
}

/** `https://play.<domain>` or null when `domain` is not an apex hostname. */
export function playOrigin(domain: string | undefined): string | null {
  if (!domain) return null;
  let host = domain.trim().toLowerCase();
  host = host.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
  if (host.startsWith('www.')) host = host.slice(4);
  if (!/^[a-z0-9.-]+$/.test(host)) return null;
  if (!host.includes('.') || host.startsWith('.') || host.endsWith('.') || host.includes('..')) return null;
  return `https://play.${host}`;
}

/** Hub page for this game, or null when the portal should say Coming soon. */
export function gameUrl(id: GameId, ctx: GameUrlContext): string | null {
  const entry = gameById(id);
  if (!entry) return null;
  const override = ctx.overrides?.[id];
  if (typeof override === 'string') return acceptPage(override);
  if (!ctx.dev) {
    const origin = playOrigin(ctx.playDomain);
    if (origin) return `${origin}/${entry.slug}/`;
    if (entry.current) return entry.current;
    return null;
  }
  if (entry.current) return entry.current;
  return `/play/${entry.slug}/`;
}

function acceptPage(value: string): string | null {
  const page = value.trim();
  if (!page) return null;
  if (page.startsWith('/') && !page.startsWith('//')) return page;
  try {
    const url = new URL(page);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return page;
  } catch {
    return null;
  }
}
