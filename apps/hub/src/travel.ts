import { isGameId, type GameId } from '@metaverse/hub-sdk';
import { PORTAL_DISTANCE, PORTAL_TRIGGER_RADIUS, PORTALS, type PortalConfig } from './config';
import { portalPosition } from './layout';

export function parseReturnGame(hash: string): GameId | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return null;
  const from = new URLSearchParams(raw).get('from');
  if (from && isGameId(from)) return from;
  return null;
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
