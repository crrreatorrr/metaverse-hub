import { BoxGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBVH } from 'three-mesh-bvh';
import type { Collider } from '../../collider';

export function buildSandboxCollider(): Collider {
  const parts = [new BoxGeometry(280, 2, 280).translate(0, -1, 0)];
  for (const sign of [-1, 1]) {
    parts.push(new BoxGeometry(1, 8, 280).translate(sign * 139.5, 4, 0));
    parts.push(new BoxGeometry(280, 8, 1).translate(0, 4, sign * 139.5));
  }
  const geometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!geometry) throw new Error('Sandbox collider could not be built');
  return { geometry, bvh: new MeshBVH(geometry) };
}
