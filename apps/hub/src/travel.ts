import { canonicalGameId, type GameId } from '@metaverse/hub-sdk';
import { PORTAL_DISTANCE, PORTAL_TRIGGER_RADIUS, PORTALS, type PortalConfig } from './config';
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

export function portalContaining(x: number, z: number): PortalConfig | null {
  for (const portal of PORTALS) {
    const at = portalPosition(portal.angle, PORTAL_DISTANCE);
    if (Math.hypot(x - at.x, z - at.z) <= PORTAL_TRIGGER_RADIUS) return portal;
  }
  return null;
}
