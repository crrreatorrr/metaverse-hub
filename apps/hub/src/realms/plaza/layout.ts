import { parseRealmArrival, parseReturnGame } from '../../travel';
import type { PortalPlacement } from '../../m3/types';
import { BOLLARD_RADIUS, CURB_RADIUS, PLAZA_YAW, PILLAR_HEIGHT, PILLAR_OFFSET, PILLAR_WIDTH, PORTAL_DISTANCE, PORTAL_STANDOFF, PORTALS, SPAWN_DISTANCE } from './config';
import type { PortalConfig } from '../../config';
import type { GameId } from '@metaverse/hub-sdk';
import { portalPosition, type Spawn, type BoxSpec } from '../../layout';

export function spawnFor(game: GameId | null): Spawn {
  if (!game) {
    const south = portalPosition(Math.PI, SPAWN_DISTANCE);
    return { x: south.x, z: south.z, yaw: 0 };
  }
  const portal = PORTALS.find((entry) => entry.id === game);
  if (!portal) return spawnFor(null);
  const pos = portalPosition(portal.angle, PORTAL_DISTANCE - PORTAL_STANDOFF);
  const outwardX = Math.sin(portal.angle);
  const outwardZ = -Math.cos(portal.angle);
  return { x: pos.x, z: pos.z, yaw: Math.atan2(outwardX, -outwardZ) };
}

export function pillarBoxes(): BoxSpec[] {
  const boxes: BoxSpec[] = [];
  for (const portal of PORTALS) {
    const at = portalPosition(portal.angle, PORTAL_DISTANCE);
    const rightX = Math.cos(portal.angle);
    const rightZ = Math.sin(portal.angle);
    for (const sign of [-1, 1]) {
      boxes.push({
        x: at.x + rightX * PILLAR_OFFSET * sign,
        y: PILLAR_HEIGHT / 2,
        z: at.z + rightZ * PILLAR_OFFSET * sign,
        sx: PILLAR_WIDTH,
        sy: PILLAR_HEIGHT,
        sz: PILLAR_WIDTH,
        rotY: -portal.angle,
      });
    }
  }
  return boxes;
}

export function curbBoxes(): BoxSpec[] {
  const count = 28;
  const boxes: BoxSpec[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    const at = portalPosition(angle, CURB_RADIUS);
    const arc = (Math.PI * 2 * CURB_RADIUS) / count;
    boxes.push({
      x: at.x,
      y: 0.5,
      z: at.z,
      sx: arc + 0.55,
      sy: 1,
      sz: 0.72,
      rotY: -angle,
    });
  }
  return boxes;
}

export function bollardPositions(): { x: number; z: number }[] {
  const count = 8;
  const posts: { x: number; z: number }[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2 + Math.PI / count;
    posts.push(portalPosition(angle, BOLLARD_RADIUS));
  }
  return posts;
}

export function portalById(id: GameId): PortalConfig | undefined {
  return PORTALS.find((portal) => portal.id === id);
}

export function defaultPortalPlacements(): PortalPlacement[] {
  return PORTALS.map((portal) => {
    const at = portalPosition(portal.angle, PORTAL_DISTANCE);
    return {
      gameId: portal.id,
      x: at.x,
      y: 0,
      z: at.z,
      rotationY: -portal.angle,
      color: portal.color,
      label: portal.label,
    };
  });
}


/**
 * Ground floor in the middle of the castle. `placeBuilding` puts the castle origin at
 * front 112 + reach 60 (its depth is capped) along the castle slot. Arrival is 6 m toward
 * the plaza, facing the gate like the old spot, so a returning player is clear of the 2.4 m
 * trigger and the camera is not inside the arch.
 */
const CASTLE_CENTER_DISTANCE = 172;
const CASTLE_X = Math.sin(PLAZA_YAW) * CASTLE_CENTER_DISTANCE;
const CASTLE_Z = -Math.cos(PLAZA_YAW) * CASTLE_CENTER_DISTANCE;
const ARRIVAL_STEP = 6;
export const SANDBOX_GATE = {
  x: CASTLE_X,
  z: CASTLE_Z,
  arrival: {
    x: Math.sin(PLAZA_YAW) * (CASTLE_CENTER_DISTANCE - ARRIVAL_STEP),
    z: -Math.cos(PLAZA_YAW) * (CASTLE_CENTER_DISTANCE - ARRIVAL_STEP),
    yaw: PLAZA_YAW,
  },
} as const;
export function spawnForArrival(hash: string): Spawn {
  const game = parseReturnGame(hash);
  if (game) return spawnFor(game);
  return parseRealmArrival(hash) === 'sandbox' ? SANDBOX_GATE.arrival : spawnFor(null);
}
