import { BoxGeometry, BufferGeometry, CylinderGeometry } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Collider } from './collider';
import { CLUB_COLLIDERS } from './club-interior-colliders';
import { BELT_PLINTH_BOX } from './arcade-layout';
import { BAR_BILLBOARD, BAR_BILLBOARD_BOXES } from './billboard-layout';

function positionsOnly(source: BufferGeometry): BufferGeometry {
  const geo = source.index ? source.toNonIndexed() : source.clone();
  const out = new BufferGeometry();
  const position = geo.getAttribute('position');
  if (!position) throw new Error('Collider geometry is missing positions');
  out.setAttribute('position', position);
  return out;
}

function addBox(
  parts: BufferGeometry[],
  sx: number,
  sy: number,
  sz: number,
  x: number,
  y: number,
  z: number,
): void {
  const geo = new BoxGeometry(sx, sy, sz);
  geo.translate(x, y, z);
  parts.push(positionsOnly(geo));
}

/**
 * Walkable collider for Sproto Plaza. The legacy `buildCollider` stays in
 * place for the capsule sim; this one matches the 220 m plaza and the Bar.
 */
export function buildPlazaCollider(): Collider {
  const parts: BufferGeometry[] = [];
  const ground = new CylinderGeometry(400, 400, 8, 24);
  ground.translate(0, -4, 0);
  parts.push(positionsOnly(ground));

  const tiers: readonly (readonly [number, number, number])[] = [[25, 25, 1.3], [21.5, 21.5, 1.3], [18, 18, 1.3]];
  let y = 0;
  for (const [rt, rb, h] of tiers) {
    const drum = new CylinderGeometry(rt, rb, h, 12);
    drum.translate(0, y + h / 2, 0);
    parts.push(positionsOnly(drum));
    y += h;
  }

  // HPOS10I Club interior (club-interior.glb), mounted standalone at y = -300 like before.
  // Keep in sync with buildClubInterior(): same boxes, same mount. The neon sign box sits inside the back bar, so it is skipped here.
  const floorY = -300;
  for (const box of [...CLUB_COLLIDERS, BELT_PLINTH_BOX]) {
    addBox(
      parts,
      box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2],
      (box.min[0] + box.max[0]) / 2, floorY + (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2,
    );
  }

  for (const box of BAR_BILLBOARD_BOXES) {
    const geo = new BoxGeometry(box.sx, box.sy, box.sz);
    geo.rotateX(box.rotX);
    geo.translate(box.x, box.y, box.z);
    geo.scale(BAR_BILLBOARD.scale, BAR_BILLBOARD.scale, BAR_BILLBOARD.scale);
    geo.rotateY(BAR_BILLBOARD.yaw);
    geo.translate(BAR_BILLBOARD.x, 0, BAR_BILLBOARD.z);
    parts.push(positionsOnly(geo));
  }

  const segments = 18;
  const radius = 320;
  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    const arc = (Math.PI * 2 * radius) / segments;
    const geo = new BoxGeometry(arc + 2, 14, 6);
    geo.rotateY(-angle);
    geo.translate(Math.sin(angle) * radius, 7, -Math.cos(angle) * radius);
    parts.push(positionsOnly(geo));
  }

  const geometry = mergeGeometries(parts, false);
  if (!geometry) throw new Error('Failed to merge the plaza collider');
  return { bvh: new MeshBVH(geometry), geometry };
}
