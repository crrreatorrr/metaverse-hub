import { REALM_IDS, type RealmId } from './core/realm-id';
import { canonicalGameId, type GameId } from '@metaverse/hub-sdk';
import { type PortalConfig } from './config';
import { portalPosition } from './layout';

/** Seconds inside the ring before the hub opens the game. A shorter visit does not enter. */
export const PORTAL_ENTER_DWELL = 1;

export interface PortalDwell {
  id: GameId | null;
  /** Seconds spent continuously inside `id`. */
  elapsed: number;
  /** Stays set after a finished dwell until the player leaves that ring. */
  held: boolean;
}

export function initialDwell(): PortalDwell {
  return { id: null, elapsed: 0, held: false };
}

/**
 * One step of the portal dwell. `ready` is true on the single frame the wait finishes.
 * Leaving the ring clears it. The plaza resets the dwell while a text field is focused.
 */
export function stepPortalDwell(state: PortalDwell, id: GameId | null, dt: number): { state: PortalDwell; ready: boolean } {
  if (!id) return { state: initialDwell(), ready: false };
  if (state.held && state.id === id) return { state, ready: false };
  const elapsed = (state.id === id ? state.elapsed : 0) + Math.max(0, dt);
  const ready = elapsed >= PORTAL_ENTER_DWELL;
  return { state: { id, elapsed, held: ready }, ready };
}

export function parseReturnGame(hash: string): GameId | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return null;
  const from = new URLSearchParams(raw).get('from');
  if (!from) return null;
  return canonicalGameId(from);
}

/** Appends the mock ticket as `#t=` without dropping an existing query string. */
export function portalUrl(page: string, ticket: string): string {
  const absolute = page.startsWith('http://') || page.startsWith('https://');
  const url = new URL(page, 'http://hub.local');
  url.hash = `t=${ticket}`;
  if (absolute) return url.toString();
  return `${url.pathname}${url.search}${url.hash}`;
}

export function portalContaining(portals: readonly PortalConfig[], x: number, z: number): PortalConfig | null {
  for (const portal of portals) {
    const at = portalPosition(portal.angle, portal.distance);
    if (Math.hypot(x - at.x, z - at.z) <= portal.triggerRadius) return portal;
  }
  return null;
}

/** Realm crossings have their own hash; game returns always take precedence in the plaza. */
export function parseRealmArrival(hash: string): RealmId | null {
  const id = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash).get('realm');
  return REALM_IDS.find(realm => realm === id) ?? null;
}

/** A renewed sign-in returns to this exact page, preserving its query and arrival hash. */
export function loginReturnPath(location: { pathname: string; search: string; hash: string }): string {
  return `${location.pathname}${location.search}${location.hash}`;
}
