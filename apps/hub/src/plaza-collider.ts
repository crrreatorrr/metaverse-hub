import { BoxGeometry, BufferGeometry, CylinderGeometry } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Collider } from './collider';

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

  const floorY = -300;
  addBox(parts, 20, 1, 13, 0, floorY - 0.5, 0);
  addBox(parts, 20, 5.2, 0.5, 0, floorY + 2.6, -6.75);
  addBox(parts, 0.5, 5.2, 13, -10.25, floorY + 2.6, 0);
  addBox(parts, 0.5, 5.2, 13, 10.25, floorY + 2.6, 0);
  addBox(parts, 2.7, 5.2, 0.5, -8.65, floorY + 2.6, 6.75);
  addBox(parts, 14.7, 5.2, 0.5, 2.65, floorY + 2.6, 6.75);

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
