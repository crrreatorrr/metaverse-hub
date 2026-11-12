import { CLUB_COLLIDERS, type ClubBox } from './club-interior-colliders';

/** The room and its fixtures are 30% larger; Sprotel has his own scale (see SPROTEL_SCALE). */
export const CLUB_INTERIOR_SCALE = 1.3;
/** Sprotel is 20% larger than his authored body, independent of the room scale (feedback HUB-0001). */
export const SPROTEL_SCALE = 1.2;

type Point = readonly [number, number, number];

export function scaleClubPoint(point: Point, scale = CLUB_INTERIOR_SCALE): Point {
  return point.map(value => value * scale) as [number, number, number];
}

/** Scale room geometry; an NPC box moves with the room and grows by `npcScale` about its floor-level centre. */
export function scaleClubBounds(box: Pick<ClubBox, 'min' | 'max' | 'npc'>, scale = CLUB_INTERIOR_SCALE, npcScale = SPROTEL_SCALE): { min: Point; max: Point } {
  if (!box.npc) return { min: scaleClubPoint(box.min, scale), max: scaleClubPoint(box.max, scale) };
  const centre = box.min.map((value, axis) => (value + box.max[axis]) / 2);
  // The actor is anchored at floor level, rather than at the centre of its bounding box, so growing keeps his feet down.
  centre[1] = box.min[1];
  const at = (value: number, axis: number) => centre[axis] * scale + (value - centre[axis]) * npcScale;
  return {
    min: box.min.map(at) as [number, number, number],
    max: box.max.map(at) as [number, number, number],
  };
}

/** Shared by the rendered room's collision metadata and the actual player/camera BVH. */
export const SCALED_CLUB_COLLIDERS: readonly ClubBox[] = CLUB_COLLIDERS.map(box => ({ ...box, ...scaleClubBounds(box) }));
