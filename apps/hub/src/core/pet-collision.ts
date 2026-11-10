import { Box3, DoubleSide, Line3, Ray, Vector3 } from 'three';
import { INTERSECTED, NOT_INTERSECTED, type MeshBVH } from 'three-mesh-bvh';
import type { PetCollision } from './pet-motion';

/** Small capsule against the realm's existing BVH, with reusable shapecast callbacks. */
export function createPetCollision(bvh: MeshBVH): PetCollision {
  const segment = new Line3();
  const bounds = new Box3();
  const surface = new Vector3();
  const point = new Vector3();
  const radius = 0.25;
  const callbacks: Parameters<MeshBVH['shapecast']>[0] = {
    intersectsBounds: box => box.intersectsBox(bounds) ? INTERSECTED : NOT_INTERSECTED,
    intersectsTriangle: tri => {
      const distance = tri.closestPointToSegment(segment, surface, point);
      if (distance < radius && distance > 1e-8) {
        point.sub(surface).multiplyScalar((radius - distance) / distance);
        segment.start.add(point);
        segment.end.add(point);
      }
      return false;
    },
  };
  const ray = new Ray();
  const resolve: PetCollision = position => {
    segment.start.set(position.x, position.y + radius + 0.01, position.z);
    segment.end.copy(segment.start).y += 0.15;
    bounds.makeEmpty().expandByPoint(segment.start).expandByPoint(segment.end).expandByScalar(radius);
    bvh.shapecast(callbacks);
    position.set(segment.start.x, segment.start.y - radius - 0.01, segment.start.z);
  };
  resolve.blocked = (box, transform) => bvh.intersectsBox(box, transform);
  resolve.beamRange = (origin, direction, range) => {
    ray.set(origin, direction);
    const hit = bvh.raycastFirst(ray, DoubleSide, 0, range);
    return hit ? Math.max(0, hit.distance - 0.005) : range;
  };
  return resolve;
}
