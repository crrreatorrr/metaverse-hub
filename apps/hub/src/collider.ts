import { BoxGeometry, BufferGeometry, CylinderGeometry, Matrix4, Quaternion, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MONUMENT_RADIUS, PEDESTAL_HEIGHT } from './config';
import { bollardPositions, curbBoxes, pillarBoxes, type BoxSpec } from './layout';

export interface Collider {
  bvh: MeshBVH;
  geometry: BufferGeometry;
}

function positionsOnly(source: BufferGeometry): BufferGeometry {
  const geo = source.index ? source.toNonIndexed() : source.clone();
  const out = new BufferGeometry();
  out.setAttribute('position', geo.getAttribute('position'));
  return out;
}

function boxGeometry(spec: BoxSpec): BufferGeometry {
  const geo = new BoxGeometry(spec.sx, spec.sy, spec.sz);
  const matrix = new Matrix4().compose(
    new Vector3(spec.x, spec.y, spec.z),
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), spec.rotY),
    new Vector3(1, 1, 1),
  );
  geo.applyMatrix4(matrix);
  return positionsOnly(geo);
}

export function buildCollider(): Collider {
  const parts: BufferGeometry[] = [];

  const ground = new CylinderGeometry(33, 33, 2, 12);
  ground.translate(0, -1, 0);
  parts.push(positionsOnly(ground));

  const pedestal = new CylinderGeometry(MONUMENT_RADIUS, MONUMENT_RADIUS, PEDESTAL_HEIGHT, 8);
  pedestal.translate(0, PEDESTAL_HEIGHT / 2, 0);
  parts.push(positionsOnly(pedestal));

  // Inner core stops the camera from flying through the sealed portal.
  // The player cannot reach it; the pedestal wall is wider.
  const core = new CylinderGeometry(1.55, 1.55, 4.4, 8);
  core.translate(0, PEDESTAL_HEIGHT + 2.2, 0);
  parts.push(positionsOnly(core));

  for (const spec of [...pillarBoxes(), ...curbBoxes()]) parts.push(boxGeometry(spec));

  for (const post of bollardPositions()) {
    const bollard = new CylinderGeometry(0.2, 0.24, 1.15, 6);
    bollard.translate(post.x, 0.575, post.z);
    parts.push(positionsOnly(bollard));
  }

  const geometry = mergeGeometries(parts, false);
  if (!geometry) throw new Error('Failed to merge the plaza collider');
  const bvh = new MeshBVH(geometry);
  return { bvh, geometry };
}
