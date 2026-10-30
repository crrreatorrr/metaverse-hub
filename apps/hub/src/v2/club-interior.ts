import {
  AdditiveBlending, Box3, EquirectangularReflectionMapping, Group, LOD, Mesh, MeshBasicMaterial, Object3D, SRGBColorSpace,
  TextureLoader, Vector3, type Material, type MeshStandardMaterial, type Texture,
} from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { WORLD_ROOT, animated, glow, loadGLTF } from './core';
import { INTERIOR_ORIGIN, makeLeaderboardTexture, type InteriorBuild } from './interior';
import { loadNeonSign } from './neon-sign';
import { CLUB_COLLIDERS, CLUB_MARKERS } from './club-interior-colliders';
import { createSprotelController, type SprotelClip, type SprotelController } from './sprotel-npc';

/**
 * HPOS10I Club interior (club-interior.glb + -lod1). One open room, 20 x 14 x 5.2 m.
 * Local origin = threshold centre at floor level, room interior is +Z (x from -15 to +5, z from 0 to 14).
 * The group is movable: by default it is mounted at INTERIOR_ORIGIN (y = -300) like the old procedural room,
 * so scene.ts keeps working. Pass `at`/`yaw` to put it behind a plaza building door instead.
 */
export const CLUB_NEON_SIGN_SCALE = 1.15;
const LOD1_DISTANCE = 16;
const ROOM_CENTRE = new Vector3(-5, 2.6, 7);

/**
 * Polish pass: the room is atlas-batched into ~19 primitives. Every emissive tube / LED / bulb / neon ring lives in
 * `club_neon`, all soft halo cards in `club_glow`, TV + EXIT + register screens in `club_screens`.
 */
const BLOOM = new Set(['club_neon', 'club_glow', 'club_screens', 'leaderboard_screen']);
/** Soft halo cards: additive, no depth write. */
const ADDITIVE = new Set(['club_glow']);
/** Rope lights + bulbs share the neon material; the hum animates it. */
const HUM = new Set(['club_neon']);
/** Sprotel barman (optional child). Same files as hub-world/sprotel/3d. */
const NPC_URL = 'v2/web/npc_sprotel_bitcoin.glb';
const ENV_URL = 'v2/web/club-env.jpg';

/** Interior lighting mood. scene.ts applies it while `inside` and restores the plaza values on exit. */
export interface ClubMood {
  /** Equirect captured inside the room (warm, dark). Also set as envMap on every club material. */
  environment: Texture | null;
  environmentIntensity: number;
  hemi: { sky: string; ground: string; intensity: number };
  /** The plaza sun should be off inside (the baked vertex light + 4 point lights carry the room). */
  sun: boolean;
}

export type ClubMarker = keyof typeof CLUB_MARKERS;

export interface ClubInteriorBuild extends InteriorBuild {
  /** EXIT door (back wall). `exit` from InteriorBuild points at the same object. */
  exitDoor: Object3D;
  /** Outside the front threshold; walking back out through the glass doors lands here. */
  entry: Object3D;
  /** Warp target just inside the threshold, facing into the room (hub yaw convention: yaw 0 walks -Z). */
  spawn: { x: number; y: number; z: number; yaw: number };
  /** Every marker as an Object3D under the group (world transform follows the group). */
  markers: Record<ClubMarker, Group>;
  /** Collider boxes already in WORLD space for the current mount. Merge into the walk BVH. */
  colliderBoxes: Box3[];
  /** Lighting to apply while inside (see ClubMood). */
  mood: ClubMood;
  /** Sprotel barman root (null when `npc: false` or the GLB failed to load). */
  npc: Object3D | null;
  /** Sprotel's store trigger / greet / talk / head-aim controller (null with no NPC). Tick it while inside. */
  sprotel: SprotelController | null;
}

export interface ClubMount {
  at?: Vector3;
  yaw?: number;
  /** Keep the box that closes the outside landing (true for the standalone y = -300 mount). */
  standalone?: boolean;
  /** Spawn Sprotel on barman_spot (default true). Pass a clip name to override the default `wipe_glass`. */
  npc?: boolean | { clip?: SprotelClip };
}

function prepare(root: Object3D, lit: MeshStandardMaterial[], env: Texture | null): void {
  root.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh) return;
    const name = mesh.name || mesh.parent?.name || '';
    const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as Material[];
    for (const mat of mats) {
      if (mat.transparent) mat.depthWrite = false;
      if (ADDITIVE.has(name)) mat.blending = AdditiveBlending;
      const std = mat as MeshStandardMaterial;
      // Club-local reflections (steel bar top, gloss floor, bottles) instead of the plaza sky PMREM.
      if (env && std.isMeshStandardMaterial) { std.envMap = env; std.envMapIntensity = 1; std.needsUpdate = true; }
      if (HUM.has(name) && !lit.includes(std)) lit.push(std);
    }
    if (BLOOM.has(name)) glow(mesh);
  });
}

async function loadEnv(): Promise<Texture | null> {
  try {
    const tex = await new TextureLoader().loadAsync(`${WORLD_ROOT}${ENV_URL}`);
    tex.mapping = EquirectangularReflectionMapping;
    tex.colorSpace = SRGBColorSpace;
    return tex;
  } catch (error) {
    console.warn('[club] club-env.jpg missing, using scene environment', error);
    return null;
  }
}

async function loadNpc(): Promise<import('three/addons/loaders/GLTFLoader.js').GLTF | null> {
  try {
    return await loadGLTF(`${WORLD_ROOT}${NPC_URL}`);
  } catch (error) {
    console.warn('[club] Sprotel NPC skipped', error);
    return null;
  }
}

/** Club-local box -> world box for a mount (yaw is a multiple of 90 degrees in practice, but any yaw works). */
export function clubBoxToWorld(min: readonly number[], max: readonly number[], at: Vector3, yaw: number): Box3 {
  const box = new Box3(new Vector3(min[0], min[1], min[2]), new Vector3(max[0], max[1], max[2]));
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const out = new Box3();
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    out.expandByPoint(new Vector3(at.x + x * c + z * s, at.y + y, at.z - x * s + z * c));
  }
  return out;
}

export async function buildClubInterior(parent: Object3D, mount: ClubMount = {}): Promise<ClubInteriorBuild> {
  const at = mount.at ?? INTERIOR_ORIGIN;
  const yaw = mount.yaw ?? 0;
  const standalone = mount.standalone ?? true;
  const wantNpc = mount.npc ?? true;
  const [near, far, sign, env, npcGltf] = await Promise.all([
    loadGLTF(`${WORLD_ROOT}v2/web/club-interior.glb`),
    loadGLTF(`${WORLD_ROOT}v2/web/club-interior-lod1.glb`),
    loadNeonSign(CLUB_NEON_SIGN_SCALE),
    loadEnv(),
    wantNpc ? loadNpc() : Promise.resolve(null),
  ]);

  const g = new Group();
  g.name = 'club-interior';
  g.position.copy(at);
  g.rotation.y = yaw;

  const lit: MeshStandardMaterial[] = [];
  const lod = new LOD();
  lod.name = 'club-interior-lod';
  const leaderboard = makeLeaderboardTexture();
  leaderboard.flipY = false; // glTF UV convention
  const screenMat = new MeshBasicMaterial({ map: leaderboard, toneMapped: false });
  screenMat.name = 'leaderboard_screen';
  for (const [gltf, distance] of [[near, 0], [far, LOD1_DISTANCE]] as const) {
    const root = gltf.scene.clone(true);
    const screen = root.getObjectByName('leaderboard_screen') as Mesh | undefined;
    if (screen?.isMesh) screen.material = screenMat;
    // Only LOD0 carries the KHR_lights_punctual lights we keep (3-4 real-time lights total).
    if (distance > 0) root.getObjectByName('lights')?.removeFromParent();
    prepare(root, lit, env);
    root.position.set(-ROOM_CENTRE.x, -ROOM_CENTRE.y, -ROOM_CENTRE.z);
    const level = new Group();
    level.add(root);
    lod.addLevel(level, distance);
  }
  // LOD distance is measured from the room centre, so anywhere inside (max ~12.5 m) stays on LOD0.
  lod.position.copy(ROOM_CENTRE);
  g.add(lod);

  // Neon sign slot (wall plane at the panel bottom edge; neon-sign.ts origin is the panel centre).
  const slot = CLUB_MARKERS.neon_sign_slot;
  sign.position.set(slot.pos[0], 0, slot.pos[2]);
  sign.rotation.y = slot.yaw;
  const col = sign.userData.collider as Box3 | undefined;
  sign.position.y = slot.pos[1] - (col ? col.min.y : -0.75 * CLUB_NEON_SIGN_SCALE);
  g.add(sign);

  sign.traverse((obj) => {
    const m = (obj as Mesh).material as MeshStandardMaterial | undefined;
    if (env && m?.isMeshStandardMaterial) { m.envMap = env; m.needsUpdate = true; }
  });

  const markers = {} as Record<ClubMarker, Group>;
  for (const [key, m] of Object.entries(CLUB_MARKERS) as [ClubMarker, (typeof CLUB_MARKERS)[ClubMarker]][]) {
    const o = new Group();
    o.name = `marker_${key}`;
    o.position.set(m.pos[0], m.pos[1], m.pos[2]);
    o.rotation.y = m.yaw;
    g.add(o);
    markers[key] = o;
  }
  // Store UI floats over the bar top in front of the barman (barman faces the stools, local -Z).
  const storeAnchor = new Object3D();
  storeAnchor.name = 'store_ui_anchor';
  const b = CLUB_MARKERS.barman_spot.pos;
  storeAnchor.position.set(b[0], 1.9, b[2] - 0.9);
  g.add(storeAnchor);

  // Sprotel behind the bar on barman_spot, facing the stools. Skinned: clone with SkeletonUtils so the
  // cached GLTF scene stays reusable. His capsule-ish box is already in CLUB_COLLIDERS (`sprotel_npc`, npc: true).
  let npc: Object3D | null = null;
  let sprotel: SprotelController | null = null;
  if (npcGltf) {
    npc = SkeletonUtils.clone(npcGltf.scene);
    npc.name = 'sprotel_npc';
    const spot = CLUB_MARKERS.barman_spot;
    npc.position.set(spot.pos[0], spot.pos[1], spot.pos[2]);
    npc.rotation.y = spot.yaw;
    npc.traverse((obj) => {
      const m = (obj as Mesh).material as MeshStandardMaterial | undefined;
      if (env && m?.isMeshStandardMaterial) { m.envMap = env; m.needsUpdate = true; }
      if ((obj as Mesh).isMesh) obj.frustumCulled = false; // skinned bounds don't follow the clip
    });
    g.add(npc);
    // Resting clip when nobody is near (default wipe_glass). Clips are native to his skeleton: played directly.
    const restClip: SprotelClip = (typeof wantNpc === 'object' && wantNpc.clip) || 'wipe_glass';
    sprotel = createSprotelController(npc, npcGltf.animations, restClip);
    npc.userData.mixer = sprotel.mixer;
    npc.userData.clips = npcGltf.animations;
  }

  const colliderBoxes = CLUB_COLLIDERS.filter((c) => (standalone || !c.standalone) && (npc !== null || !c.npc)).map((c) => clubBoxToWorld(c.min, c.max, at, yaw));
  if (col) {
    sign.updateMatrix();
    g.updateMatrix();
    colliderBoxes.push(col.clone().applyMatrix4(sign.matrix).applyMatrix4(g.matrix));
  }

  const t = CLUB_MARKERS.threshold_turn.pos;
  const ts = new Vector3(t[0], t[1], t[2]).applyAxisAngle(new Vector3(0, 1, 0), yaw).add(at);
  // Hub yaw: 0 walks -Z. Facing into the room (+Z local) is yaw = PI (minus the mount yaw).
  const spawn = { x: ts.x, y: ts.y, z: ts.z, yaw: Math.PI - yaw };

  // Warm rope-light hum, very subtle.
  const base = lit.map((m) => m.emissiveIntensity);
  animated.push((time) => {
    const k = 1 + 0.015 * Math.sin(time * 2.1);
    lit.forEach((m, i) => { m.emissiveIntensity = base[i] * k; });
  });

  g.visible = false;
  parent.add(g);
  return {
    group: g, exit: markers.exit_door, exitDoor: markers.exit_door, entry: markers.door_front,
    leaderboard, storeAnchor, spawn, markers, colliderBoxes, npc, sprotel,
    mood: {
      environment: env, environmentIntensity: 1.0,
      hemi: { sky: '#ffd2a8', ground: '#2a1810', intensity: 2.4 },
      sun: false,
    },
  };
}
