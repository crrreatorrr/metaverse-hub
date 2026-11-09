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
  env:
    | 'VITE_GAME_URL_HPOS10I'
    | 'VITE_GAME_URL_NOBU'
    | 'VITE_GAME_URL_PEOPLES_BITCOIN'
    | 'VITE_GAME_URL_SPROTO_DUEL'
    | 'VITE_GAME_URL_SPROTO_FIGHTER'
    | 'VITE_GAME_URL_SPROTO_ARCADE'
    | 'VITE_GAME_URL_SPROTO_SHOOTER'
    | 'VITE_GAME_URL_SPROTO_COOP_BATTLE';
  /**
   * `ring` is a plaza portal. `cabinet` is a Bar arcade-machine choice and has no ring.
   * Registering the URL does not add a ring or a menu row.
   */
  entry: 'ring' | 'cabinet';
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
    entry: 'ring',
    current: 'https://crrreatorrr.github.io/HPOS10I/',
  },
  {
    id: 'nobu',
    slug: 'nobu',
    env: 'VITE_GAME_URL_NOBU',
    entry: 'ring',
  },
  {
    id: 'peoples-bitcoin',
    slug: 'peoples-bitcoin',
    env: 'VITE_GAME_URL_PEOPLES_BITCOIN',
    entry: 'ring',
  },
  {
    id: 'sproto',
    slug: 'sproto-duel',
    env: 'VITE_GAME_URL_SPROTO_DUEL',
    entry: 'ring',
  },
  {
    // Entered from the Bar's arcade cabinet, not a plaza ring. Id and slug are the same.
    id: 'sproto-fighter',
    slug: 'sproto-fighter',
    env: 'VITE_GAME_URL_SPROTO_FIGHTER',
    entry: 'cabinet',
  },
  {
    // The Bar cabinet's second game. Static classic-script build; the page is the repo root.
    id: 'sproto-arcade',
    slug: 'sproto-arcade',
    env: 'VITE_GAME_URL_SPROTO_ARCADE',
    entry: 'cabinet',
  },
  {
    // Fifth plaza ring, on the empty artist slot in front of the Bar. No Relic and no Ticket earn.
    id: 'sproto-shooter',
    slug: 'sproto-shooter',
    env: 'VITE_GAME_URL_SPROTO_SHOOTER',
    entry: 'ring',
  },
  {
    // Bar cabinet choice, alongside Sproto Fighter and Sproto Arcade. No plaza portal.
    // No Relic and no Ticket earn.
    id: 'sproto-coop-battle',
    slug: 'sproto-coop-battle',
    env: 'VITE_GAME_URL_SPROTO_COOP_BATTLE',
    entry: 'cabinet',
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

/**
 * Page override. An own property, including `''`, wins. Shooter and Coop Battle are not listed in
 * the shell's override map, so a missing key reads their `VITE_GAME_URL_*` variable. Empty means
 * Coming soon. Other games stay on the map the shell passes.
 */
function pageOverride(id: GameId, ctx: GameUrlContext): string | undefined {
  if (ctx.overrides && Object.prototype.hasOwnProperty.call(ctx.overrides, id)) return ctx.overrides[id];
  const env = import.meta.env;
  if (!env) return undefined;
  const value = id === 'sproto-shooter'
    ? import.meta.env.VITE_GAME_URL_SPROTO_SHOOTER
    : id === 'sproto-coop-battle'
      ? import.meta.env.VITE_GAME_URL_SPROTO_COOP_BATTLE
      : undefined;
  return typeof value === 'string' ? value : undefined;
}

/** Hub page for this game, or null when the portal should say Coming soon. */
export function gameUrl(id: GameId, ctx: GameUrlContext): string | null {
  const entry = gameById(id);
  if (!entry) return null;
  const override = pageOverride(id, ctx);
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
