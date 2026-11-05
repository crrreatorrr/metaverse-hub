import { part } from '../../v2/core';
import type { LOD } from 'three';
import { BAR_BILLBOARD } from './billboard-layout';
export { BAR_BILLBOARD, BAR_BILLBOARD_BOXES } from './billboard-layout';

export async function barBillboard(): Promise<LOD> {
  const lod = await part('P3-billboard', { h: BAR_BILLBOARD.h * BAR_BILLBOARD.scale, glow: 0.35 });
  lod.name = 'bar-billboard';
  lod.position.set(BAR_BILLBOARD.x, 0, BAR_BILLBOARD.z);
  lod.rotation.y = BAR_BILLBOARD.yaw;
  return lod;
}
