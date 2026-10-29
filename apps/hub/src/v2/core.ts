import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  InstancedMesh,
  LOD,
  Euler,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Raycaster,
  Vector3,
  type Material,
  type WebGLRenderer,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/** World files live under /world/ so they do not collide with the Nakama /v2 proxy. */
export const WORLD_ROOT = `${import.meta.env.BASE_URL}world/`;
export const LOD_DIST = 170;

export const animated: ((t: number, dt: number) => void)[] = [];

const bloomSet = new Set<Object3D>();
const glowListeners: ((obj: Object3D) => void)[] = [];

export function glow<T extends Object3D>(obj: T): T {
  bloomSet.add(obj);
  for (const listener of glowListeners) listener(obj);
  return obj;
}

/** Selective bloom registers every current and future glow object, mesh by mesh. */
export function mountGlow(listener: (obj: Object3D) => void): void {
  glowListeners.push(listener);
  for (const obj of bloomSet) listener(obj);
}

let loader: GLTFLoader | null = null;

export async function initLoaders(renderer: WebGLRenderer): Promise<void> {
  const ktx2 = new KTX2Loader().setTranscoderPath(`${WORLD_ROOT}basis/`).detectSupport(renderer);
  const decoder = MeshoptDecoder as { ready?: Promise<unknown> };
  if (decoder.ready) await decoder.ready;
  loader = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
}

const cache = new Map<string, Promise<import('three/addons/loaders/GLTFLoader.js').GLTF>>();

export function loadGLTF(url: string): Promise<import('three/addons/loaders/GLTFLoader.js').GLTF> {
  const existing = cache.get(url);
  if (existing) return existing;
  if (!loader) return Promise.reject(new Error('GLTF loaders are not initialised'));
  const pending = loader.loadAsync(url);
  cache.set(url, pending);
  return pending;
}

export function fixMaterials(root: Object3D, options: { glow?: number; metal?: number } = {}): void {
  const glowAmount = options.glow ?? 0.16;
  const metal = options.metal ?? 0.35;
  root.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh) return;
    mesh.frustumCulled = true;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of mats) {
      if (!material || !(material as MeshStandardMaterial).isMeshStandardMaterial) continue;
      const standard = material as MeshStandardMaterial;
      standard.metalness = Math.min(standard.metalness, metal);
      standard.roughness = Math.max(standard.roughness, 0.38);
      standard.envMapIntensity = 0.7;
      if (standard.map && glowAmount > 0) {
        standard.emissive = new Color('#ffffff');
        standard.emissiveMap = standard.map;
        standard.emissiveIntensity = glowAmount;
      }
    }
  });
}

export interface PartOptions {
  h: number;
  yaw?: number;
  glow?: number;
  metal?: number;
  dir?: string;
  /** lod1 until the player is close. Interior passes lod0. */
  level?: 'lod0' | 'lod1';
}

export interface InstanceTransform {
  p: [number, number, number];
  r?: number;
  s?: number;
}

function normalised(sceneObj: Object3D, h: number, yaw: number): Group {
  const inner = sceneObj.clone(true);
  inner.rotation.y = yaw;
  const wrap = new Group();
  wrap.add(inner);
  wrap.updateMatrixWorld(true);
  const box = new Box3().setFromObject(wrap);
  const size = box.getSize(new Vector3());
  inner.scale.setScalar(h / Math.max(size.y, 1e-4));
  wrap.updateMatrixWorld(true);
  box.setFromObject(wrap);
  const center = box.getCenter(new Vector3());
  inner.position.set(-center.x, -box.min.y, -center.z);
  return wrap;
}

async function attachLevel(lod: LOD, level: 'lod0' | 'lod1'): Promise<void> {
  const flags = (lod.userData.levels ??= {}) as { lod0?: boolean; lod1?: boolean };
  if (flags[level]) return;
  const opts = lod.userData.partOpts as PartOptions;
  const name = String(lod.userData.partName);
  const file = level === 'lod0' ? `${name}.glb` : `${name}-lod1.glb`;
  const gltf = await loadGLTF(`${WORLD_ROOT}v2/${opts.dir ?? 'web'}/${file}`);
  fixMaterials(gltf.scene, { glow: opts.glow, metal: opts.metal });
  const wrap = normalised(gltf.scene, opts.h, opts.yaw ?? 0);
  if (!lod.userData.size) lod.userData.size = new Box3().setFromObject(wrap).getSize(new Vector3());
  if (level === 'lod0') {
    for (const entry of lod.levels) {
      if (entry.distance === 0) entry.distance = LOD_DIST;
    }
    lod.addLevel(wrap, 0);
  } else if (flags.lod0) {
    lod.addLevel(wrap, LOD_DIST);
  } else {
    lod.addLevel(wrap, 0);
  }
  flags[level] = true;
}

export async function part(name: string, opts: PartOptions): Promise<LOD> {
  const lod = new LOD();
  lod.name = name;
  lod.userData.partName = name;
  lod.userData.partOpts = opts;
  await attachLevel(lod, opts.level ?? 'lod1');
  return lod;
}

export async function upgradeToLod0(root: Object3D): Promise<void> {
  const jobs: Promise<void>[] = [];
  root.traverse((obj) => {
    if (obj.userData.partName) jobs.push(attachLevel(obj as LOD, 'lod0'));
  });
  await Promise.all(jobs);
}

export async function instanced(
  name: string,
  transforms: readonly InstanceTransform[],
  opts: PartOptions & { useLod1?: boolean },
): Promise<Group> {
  const useLod1 = opts.level === 'lod0' ? false : opts.useLod1 !== false;
  const gltf = await loadGLTF(`${WORLD_ROOT}v2/${opts.dir ?? 'web'}/${name}${useLod1 ? '-lod1' : ''}.glb`);
  fixMaterials(gltf.scene, { glow: opts.glow, metal: opts.metal });
  const norm = normalised(gltf.scene, opts.h, opts.yaw ?? 0);
  norm.updateMatrixWorld(true);
  const group = new Group();
  group.name = `${name}-instances`;
  norm.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh) return;
    const instancedMesh = new InstancedMesh(mesh.geometry, mesh.material as Material, transforms.length);
    transforms.forEach((transform, index) => {
      const matrix = new Matrix4().compose(
        new Vector3(...transform.p),
        new Quaternion().setFromEuler(new Euler(0, transform.r ?? 0, 0)),
        new Vector3().setScalar(transform.s ?? 1),
      );
      instancedMesh.setMatrixAt(index, matrix.multiply(mesh.matrixWorld));
    });
    instancedMesh.computeBoundingSphere();
    group.add(instancedMesh);
  });
  return group;
}

export function neonMat(color: string, intensity = 3): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: '#000000',
    emissive: color,
    emissiveIntensity: intensity,
    roughness: 0.4,
  });
}

const raycaster = new Raycaster();

export function groundY(target: Object3D, x: number, z: number, fallback = 0): number {
  target.updateMatrixWorld(true);
  const meshes: Mesh[] = [];
  target.traverse((obj) => {
    const mesh = obj as Mesh;
    if (mesh.isMesh) meshes.push(mesh);
  });
  raycaster.set(new Vector3(x, 1000, z), new Vector3(0, -1, 0));
  const hits = raycaster.intersectObjects(meshes, false);
  const hit = hits[0];
  return hit ? hit.point.y : fallback;
}

export function bakeInstanceColors(source: InstancedMesh): Mesh {
  const geos: BufferGeometry[] = [];
  const matrix = new Matrix4();
  const color = new Color();
  for (let i = 0; i < source.count; i += 1) {
    const geometry = source.geometry.clone();
    source.getMatrixAt(i, matrix);
    geometry.applyMatrix4(matrix);
    if (source.instanceColor) source.getColorAt(i, color);
    else color.set(1, 1, 1);
    const count = geometry.attributes.position?.count ?? 0;
    const colors = new Float32Array(count * 3);
    for (let k = 0; k < count; k += 1) colors.set([color.r, color.g, color.b], k * 3);
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    geos.push(geometry);
  }
  const material = source.material as MeshStandardMaterial;
  material.vertexColors = true;
  material.needsUpdate = true;
  const merged = mergeGeometries(geos);
  if (!merged) throw new Error(`Failed to bake instance colors for ${source.name}`);
  const mesh = new Mesh(merged, material);
  mesh.name = source.name;
  mesh.position.copy(source.position);
  mesh.quaternion.copy(source.quaternion);
  mesh.scale.copy(source.scale);
  return mesh;
}
