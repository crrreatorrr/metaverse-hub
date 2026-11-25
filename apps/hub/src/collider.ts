import type { BufferGeometry } from 'three';
import type { MeshBVH } from 'three-mesh-bvh';
export interface Collider {
  bvh: MeshBVH;
  geometry: BufferGeometry;
  /**
   * More solids, in a tree of their own (the plaza's buildings and entrance posts). The capsule
   * resolves contacts in the order a tree visits its triangles, so adding to `bvh` would change
   * how every existing contact settles; a second tree leaves those exactly as they were.
   */
  solids?: MeshBVH;
}
