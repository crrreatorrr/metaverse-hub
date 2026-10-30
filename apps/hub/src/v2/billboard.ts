import { part } from './core';
import type { LOD } from 'three';

/**
 * Roadside billboard for the HPOS10I Club (the Bar). Ken's one exception to
 * the zero-billboards rule, because bar signs are allowed. It stands past the
 * plaza rim in the gap between Green Hill and the Club, outside the Club's
 * picket fence, facing the Club approach path.
 */
const ANGLE = (40 * Math.PI) / 180;
const RADIUS = 117;
/** Look-at point on the Club path, 45 m out from the statue. */
const AIM = { x: Math.sin((72 * Math.PI) / 180) * 45, z: -Math.cos((72 * Math.PI) / 180) * 45 };
const X = Math.sin(ANGLE) * RADIUS;
const Z = -Math.cos(ANGLE) * RADIUS;

export const BAR_BILLBOARD = {
  x: X,
  z: Z,
  /** rotation.y so the print side (+Z) faces AIM. */
  yaw: Math.atan2(AIM.x - X, AIM.z - Z),
  /** GLB height (spotlight tops). part() scales to this, so the model stays 1:1. */
  h: 8.4286,
  /** Uniform size knob for the model and its collider. 1 = 7.2 m wide panel. */
  scale: 1,
} as const;

/** Local-space solid boxes (metres, +Z is the print side). Panel top at y 8.22 is standable. */
export const BAR_BILLBOARD_BOXES: readonly { x: number; y: number; z: number; sx: number; sy: number; sz: number; rotX: number }[] = [
  { x: 0, y: 5.405, z: -0.14, sx: 7.48, sy: 5.63, sz: 0.72, rotX: 0 },
  { x: -2.55, y: 1.295, z: -0.34, sx: 0.32, sy: 2.59, sz: 0.32, rotX: 0 },
  { x: 2.55, y: 1.295, z: -0.34, sx: 0.32, sy: 2.59, sz: 0.32, rotX: 0 },
  { x: -2.55, y: 1.77, z: -1.47, sx: 0.16, sy: 4.08, sz: 0.2, rotX: 0.587 },
  { x: 2.55, y: 1.77, z: -1.47, sx: 0.16, sy: 4.08, sz: 0.2, rotX: 0.587 },
];

export async function barBillboard(): Promise<LOD> {
  const lod = await part('P3-billboard', { h: BAR_BILLBOARD.h * BAR_BILLBOARD.scale, glow: 0.35 });
  lod.name = 'bar-billboard';
  lod.position.set(BAR_BILLBOARD.x, 0, BAR_BILLBOARD.z);
  lod.rotation.y = BAR_BILLBOARD.yaw;
  return lod;
}
