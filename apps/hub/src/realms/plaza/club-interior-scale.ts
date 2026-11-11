import { CLUB_COLLIDERS, type ClubBox } from './club-interior-colliders';

/** The room and its fixtures are 30% larger; Sprotel keeps his authored body dimensions. */
export const CLUB_INTERIOR_SCALE = 1.3;

type Point = readonly [number, number, number];

export function scaleClubPoint(point: Point, scale = CLUB_INTERIOR_SCALE): Point {
  return point.map(value => value * scale) as [number, number, number];
}

/** Scale room geometry; an NPC box moves with the room without growing with it. */
export function scaleClubBounds(box: Pick<ClubBox, 'min' | 'max' | 'npc'>, scale = CLUB_INTERIOR_SCALE): { min: Point; max: Point } {
  if (!box.npc) return { min: scaleClubPoint(box.min, scale), max: scaleClubPoint(box.max, scale) };
  const centre = box.min.map((value, axis) => (value + box.max[axis]) / 2);
  // The actor is anchored at floor level, rather than at the centre of its bounding box.
  centre[1] = box.min[1];
  const offset = centre.map(value => value * (scale - 1));
  return {
    min: box.min.map((value, axis) => value + offset[axis]) as [number, number, number],
    max: box.max.map((value, axis) => value + offset[axis]) as [number, number, number],
  };
}

/** Shared by the rendered room's collision metadata and the actual player/camera BVH. */
export const SCALED_CLUB_COLLIDERS: readonly ClubBox[] = CLUB_COLLIDERS.map(box => ({ ...box, ...scaleClubBounds(box) }));
