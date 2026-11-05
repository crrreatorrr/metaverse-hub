import type { BufferGeometry } from 'three';
import type { MeshBVH } from 'three-mesh-bvh';
export interface Collider { bvh: MeshBVH; geometry: BufferGeometry }
