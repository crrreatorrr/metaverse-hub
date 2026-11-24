import type { BoxSpec } from '../../layout';
import { portalPosition } from '../../layout';
import type { PortalConfig } from '../../config';
import { PLAZA_SLOT, PLAZA_YAW } from './config';

/**
 * Solid footprints of the five plaza buildings and the entrance posts, as plain data so the
 * collider (and its tests) need no GLB.
 *
 * Each building is a group placed by `placeBuilding` in content.ts: at `radius` along its slot's
 * angle, scaled by `scale`, with local +Z toward the statue. A box is given in that local frame,
 * before the scale: centre (x, z), size (sx, sz), height h and its own yaw. The numbers were
 * measured from the loaded models at player height (0.4 to 3.2 m). Measure them again when a
 * model, a `part()` height or a slot's `front` / `sc` changes; in dev, content.ts warns when a
 * building lands somewhere else than `radius` says.
 */
export type BuildingKey = 'castle' | 'whitehouse' | 'hills' | 'club' | 'kennel';

interface LocalBox { x: number; z: number; sx: number; sz: number; h: number; yaw?: number }
interface LocalDrum { x: number; z: number; r: number; h: number }
interface BuildingSolids { slot: number; scale: number; radius: number; boxes: readonly LocalBox[]; drums?: readonly LocalDrum[] }

export const BUILDING_SOLIDS: Readonly<Record<BuildingKey, BuildingSolids>> = {
  // The mountain the castle stands on. Its towers start 18 m up, inside this footprint.
  castle: { slot: 0, scale: 1.45, radius: 172, boxes: [{ x: 0, z: 0, sx: 84.8, sz: 93, h: 30 }] },
  whitehouse: {
    slot: 1, scale: 1.3, radius: 161.68, boxes: [
      { x: 0, z: 0, sx: 49.8, sz: 28.9, h: 30 },
      { x: 0, z: 24, sx: 24.2, sz: 22.3, h: 27 },
      { x: -40.65, z: -2, sx: 33.25, sz: 24.7, h: 24 },
      { x: 40.65, z: -2, sx: 33.25, sz: 24.7, h: 24 },
    ],
  },
  hills: {
    slot: 2, scale: 1.25, radius: 144.09, boxes: [
      { x: 0, z: 0.07, sx: 40.9, sz: 47.2, h: 34 },
      { x: -26.91, z: -20.07, sx: 27.4, sz: 27.4, h: 48, yaw: 0.3 },
      { x: 25.91, z: -12.04, sx: 22.9, sz: 22.9, h: 40, yaw: -0.2 },
    ],
  },
  // The Bar. Its street door (local -17, 22) stands 5 m in front of the building's wall, and the
  // fence leaves the gap the banner does not cover (local x -3.3 to 1) on the way to it.
  club: {
    slot: 3, scale: 1.25, radius: 165.56, boxes: [
      { x: -17.4, z: 6.68, sx: 20.3, sz: 20.2, h: 27 },
      { x: 12, z: -0.48, sx: 13.3, sz: 10.6, h: 12, yaw: 0.6 },
      { x: 33.07, z: 1.66, sx: 15.25, sz: 9.7, h: 30, yaw: -0.35 },
      { x: -21.875, z: 38, sx: 37.15, sz: 0.4, h: 4 },
      { x: 21.35, z: 38, sx: 40.7, sz: 0.4, h: 4 },
      { x: 2, z: 41, sx: 0.8, sz: 0.8, h: 9, yaw: 0.15 },
    ],
  },
  kennel: {
    slot: 4, scale: 1.2, radius: 174,
    boxes: [{ x: 0, z: 0, sx: 44.05, sz: 48.5, h: 50 }],
    drums: [{ x: -24.51, z: 46.25, r: 6.95, h: 11.2 }],
  },
};

export function buildingAngle(key: BuildingKey): number {
  return BUILDING_SOLIDS[key].slot * PLAZA_SLOT + PLAZA_YAW;
}

/** A building-local point in the world, the way `placeBuilding` puts the group there. */
export function buildingPoint(key: BuildingKey, x: number, z: number): { x: number; z: number; yaw: number } {
  const b = BUILDING_SOLIDS[key];
  const angle = buildingAngle(key);
  const ux = Math.sin(angle);
  const uz = -Math.cos(angle);
  // rotation.y = atan2(-ux, -uz): local +Z points at the statue.
  const sin = -ux;
  const cos = -uz;
  return {
    x: ux * b.radius + (x * cos + z * sin) * b.scale,
    z: uz * b.radius + (-x * sin + z * cos) * b.scale,
    yaw: Math.atan2(sin, cos),
  };
}

export function buildingBoxes(skip: readonly BuildingKey[] = []): BoxSpec[] {
  const out: BoxSpec[] = [];
  for (const key of Object.keys(BUILDING_SOLIDS) as BuildingKey[]) {
    if (skip.includes(key)) continue;
    const b = BUILDING_SOLIDS[key];
    for (const box of b.boxes) {
      const at = buildingPoint(key, box.x, box.z);
      out.push({ x: at.x, y: (box.h * b.scale) / 2, z: at.z, sx: box.sx * b.scale, sy: box.h * b.scale, sz: box.sz * b.scale, rotY: at.yaw + (box.yaw ?? 0) });
    }
  }
  return out;
}

export function buildingDrums(skip: readonly BuildingKey[] = []): { x: number; z: number; radius: number; height: number }[] {
  const out: { x: number; z: number; radius: number; height: number }[] = [];
  for (const key of Object.keys(BUILDING_SOLIDS) as BuildingKey[]) {
    if (skip.includes(key)) continue;
    const b = BUILDING_SOLIDS[key];
    for (const drum of b.drums ?? []) {
      const at = buildingPoint(key, drum.x, drum.z);
      out.push({ x: at.x, z: at.z, radius: drum.r * b.scale, height: drum.h * b.scale });
    }
  }
  return out;
}

/** Half the clear width between an entrance's two posts (`buildPlazaEntrance`). */
export const ENTRANCE_POST_OFFSET = 3;
export const ENTRANCE_POST = { sx: 0.34, sy: 4.8, sz: 0.42 } as const;

/** The two posts of every walk-through entrance. The 2.4 m trigger sits between them. */
export function entrancePostBoxes(portals: readonly PortalConfig[]): BoxSpec[] {
  const out: BoxSpec[] = [];
  for (const portal of portals) {
    const at = portalPosition(portal.angle, portal.distance);
    const rightX = Math.cos(portal.angle);
    const rightZ = Math.sin(portal.angle);
    for (const side of [-1, 1]) {
      out.push({
        x: at.x + rightX * ENTRANCE_POST_OFFSET * side,
        y: ENTRANCE_POST.sy / 2,
        z: at.z + rightZ * ENTRANCE_POST_OFFSET * side,
        sx: ENTRANCE_POST.sx, sy: ENTRANCE_POST.sy, sz: ENTRANCE_POST.sz,
        rotY: -portal.angle,
      });
    }
  }
  return out;
}
