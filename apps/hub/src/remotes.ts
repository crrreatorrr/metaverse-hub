import FOLLOWERS from '../../../server/data/follower-pets.json';
import { createPetMotion, type PetCollision } from './core/pet-motion';
import { createPetFollower, EQUIPPABLE_PET_IDS, type PetFollower } from './v2/pets';
import type { RealmId } from './core/realm-id';
// Remote plaza avatars for up to 100 players.
//   near: the NEAR_MAX closest within NEAR_RADIUS get a full skinned rig (pooled),
//         a DOM name label and orbit gems;
//   far:  everyone else in the zone is one InstancedMesh impostor (1 draw call).
// Tiers are recomputed at 4 Hz with ±3 m hysteresis so avatars do not thrash.
import {
  CapsuleGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  MathUtils,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Camera,
  type Object3D,
  type Scene,
} from 'three';
import { isRelicId, type RelicId } from '@metaverse/hub-sdk';
import { createAvatarRig, type AvatarRig } from './avatar';
import { isCharacterId, isStaffId } from './config';
import { defaultLook } from './look';
import type { OrbitAvatar } from './m3/types';
import { STAND_Y } from './physics';
import { ANIMS, zoneOf, type Pose } from './net/protocol';
import type { RemotePlayer, RemoteWorld } from './net/remoteWorld';

// Tuned with ?bots=99 (headless): each skinned rig costs ~12 draws; 6 keeps the plaza near the 150-draw budget (~165).
export const NEAR_MAX = 6;
export const NEAR_RADIUS = 30;
const HYSTERESIS = 3;
const TIER_EVERY_MS = 250;
const FAR_CAPACITY = 100;
const LABEL_RADIUS = 25;
const PET_SPEEDS = new Map(FOLLOWERS.map(pet => [pet.id, pet.followSpeed]));

interface NearSlot {
  root: Group;
  rig: AvatarRig;
  pet: PetFollower;
  detailedPet: boolean;
  slot: number | null;
  version: number;
  label: HTMLDivElement;
  /** Rendered height last frame and the vertical speed it implies, for the jump clip. */
  lastY: number | null;
  vy: number;
}

export interface Remotes {
  /** Per frame. `localPos` is the local rig position. */
  update(dt: number, nowMs: number, camera: Camera, localPos: Vector3): void;
  /** World anchor (rig origin) of a remote player, or null when not rendered. */
  anchorOf(userId: string): Object3D | null;
  /** Last rendered position of a remote player (rig origin), or null. */
  positionOf(userId: string, out: Vector3): Vector3 | null;
  /** Players drawn this frame by tier. */
  readonly counts: { near: number; far: number };
  setPetsHidden(hidden: boolean): void;
  dispose(): void;
}

export interface RemotesOptions {
  realm?: RealmId;
  petCollision?: PetCollision;
  hud: HTMLElement;
  /** Near-tier avatars for the orbit-gem instancer. */
  setOrbitAvatars?: (avatars: OrbitAvatar[]) => void;
  viewport: () => { width: number; height: number };
}

function colorFor(key: string): Color {
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return new Color().setHSL((h % 360) / 360, 0.55, 0.55);
}

export function createRemotes(scene: Scene, world: RemoteWorld, opts: RemotesOptions): Remotes {
  const root = new Group();
  root.name = 'remote-avatars';
  scene.add(root);

  // Far impostors: a capsule in the player's colour.
  const capsule = new CapsuleGeometry(0.32, 1.0, 3, 8);
  const farMat = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.6, emissive: '#1a1030', emissiveIntensity: 0.4 });
  const far = new InstancedMesh(capsule, farMat, FAR_CAPACITY);
  far.instanceMatrix.setUsage(DynamicDrawUsage);
  far.count = 0;
  far.frustumCulled = false;
  far.name = 'remote-far';
  root.add(far);

  // Two nearby followers get animated models; the rest share one instanced draw.
  const petGeometry = new SphereGeometry(0.24, 6, 4);
  const petMaterial = new MeshStandardMaterial({ color: '#a8dcff', roughness: 0.8 });
  const farPets = new InstancedMesh(petGeometry, petMaterial, FAR_CAPACITY);
  farPets.instanceMatrix.setUsage(DynamicDrawUsage);
  farPets.frustumCulled = false;
  farPets.count = 0;
  root.add(farPets);
  const petMotions = new Map<number, ReturnType<typeof createPetMotion>>();
  let petsHidden = false;

  const near: NearSlot[] = [];
  const nearBySlot = new Map<number, NearSlot>();
  const rendered = new Map<number, Pose>();
  const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0, anim: 0 };
  const m = new Matrix4();
  const q = new Quaternion();
  const s = new Vector3(1, 1, 1);
  const v = new Vector3();
  const head = new Vector3();
  const up = new Vector3(0, 1, 0);
  let lastTier = -Infinity;
  let wantedNear = new Set<number>();
  const counts = { near: 0, far: 0 };

  function makeNear(): NearSlot {
    const group = new Group();
    const rig = createAvatarRig();
    group.add(rig.group);
    group.visible = false;
    root.add(group);
    const label = document.createElement('div');
    label.className = 'remote-name';
    label.hidden = true;
    opts.hud.append(label);
    return { root: group, rig, pet: createPetFollower(root, opts.petCollision), detailedPet: near.length < 2, slot: null, version: -1, label, lastY: null, vy: 0 };
  }

  function lookFor(p: RemotePlayer) {
    const look = defaultLook();
    if (isCharacterId(p.character)) look.character = p.character;
    if (isStaffId(p.staff)) look.staff = p.staff;
    look.name = p.name;
    return look;
  }

  function assign(slotObj: NearSlot, p: RemotePlayer): void {
    slotObj.slot = p.slot;
    slotObj.version = p.version;
    void slotObj.pet.setPet(slotObj.detailedPet && EQUIPPABLE_PET_IDS.includes(p.pet) ? p.pet : null).catch(console.warn);
    slotObj.lastY = null;
    slotObj.vy = 0;
    slotObj.rig.setLook(lookFor(p));
    slotObj.rig.load();
    slotObj.label.textContent = p.name;
    nearBySlot.set(p.slot, slotObj);
  }

  function release(slotObj: NearSlot): void {
    if (slotObj.slot !== null) nearBySlot.delete(slotObj.slot);
    slotObj.slot = null;
    void slotObj.pet.setPet(null);
    slotObj.root.visible = false;
    slotObj.label.hidden = true;
  }

  function syncOrbit(): void {
    if (!opts.setOrbitAvatars) return;
    const list: OrbitAvatar[] = [];
    for (const n of near) {
      if (n.slot === null) continue;
      const p = world.players.get(n.slot);
      if (!p) continue;
      list.push({ id: `remote-${p.slot}`, anchor: n.root, relics: p.relics.filter((r): r is RelicId => isRelicId(r)) });
    }
    opts.setOrbitAvatars(list);
  }

  function retier(localPos: Vector3, localZone: string): void {
    const candidates: { slot: number; d: number }[] = [];
    for (const p of world.players.values()) {
      const at = rendered.get(p.slot);
      if (!at || p.away || zoneOf(at.y, opts.realm) !== localZone) continue;
      const d = Math.hypot(at.x - localPos.x, at.z - localPos.z);
      const limit = wantedNear.has(p.slot) ? NEAR_RADIUS + HYSTERESIS : NEAR_RADIUS;
      if (d <= limit) candidates.push({ slot: p.slot, d: wantedNear.has(p.slot) ? d - HYSTERESIS : d });
    }
    candidates.sort((a, b) => a.d - b.d);
    wantedNear = new Set(candidates.slice(0, NEAR_MAX).map((c) => c.slot));
    let changed = false;
    for (const n of near) {
      if (n.slot !== null && !wantedNear.has(n.slot)) {
        release(n);
        changed = true;
      }
    }
    for (const slot of wantedNear) {
      if (nearBySlot.has(slot)) continue;
      const p = world.players.get(slot);
      if (!p) continue;
      let free = near.find((n) => n.slot === null);
      if (!free && near.length < NEAR_MAX) {
        free = makeNear();
        near.push(free);
      }
      if (!free) break;
      assign(free, p);
      changed = true;
    }
    if (changed) syncOrbit();
  }

  const unsubscribe = world.onRoster(() => {
    for (const n of near) {
      if (n.slot === null) continue;
      const p = world.players.get(n.slot);
      if (!p || p.away) {
        release(n);
        continue;
      }
      if (p.version !== n.version) {
        n.version = p.version;
        void n.pet.setPet(n.detailedPet && EQUIPPABLE_PET_IDS.includes(p.pet) ? p.pet : null).catch(console.warn);
        n.rig.setLook(lookFor(p));
        n.label.textContent = p.name;
      }
    }
    for (const slot of [...rendered.keys()]) if (!world.players.has(slot)) { rendered.delete(slot); petMotions.delete(slot); }
    syncOrbit();
  });

  return {
    counts,
    setPetsHidden(hidden) { petsHidden = hidden; },
    update(dt, nowMs, camera, localPos) {
      const localZone = zoneOf(localPos.y, opts.realm);
      for (const p of world.players.values()) {
        const got = p.away ? null : p.interp.sample(nowMs, pose);
        if (!got) {
          rendered.delete(p.slot);
          continue;
        }
        const r = rendered.get(p.slot) ?? { x: 0, y: 0, z: 0, yaw: 0, anim: 0 };
        r.x = got.x;
        r.y = got.y;
        r.z = got.z;
        r.yaw = got.yaw;
        r.anim = got.anim;
        rendered.set(p.slot, r);
      }
      if (nowMs - lastTier >= TIER_EVERY_MS) {
        lastTier = nowMs;
        retier(localPos, localZone);
      }

      let petCount = 0;
      let farCount = 0;
      let nearCount = 0;
      const { width, height } = opts.viewport();
      for (const [slot, r] of rendered) {
        if (zoneOf(r.y, opts.realm) !== localZone) continue;
        const p = world.players.get(slot);
        const n = nearBySlot.get(slot);
        if (!petsHidden && p && EQUIPPABLE_PET_IDS.includes(p.pet)) {
          v.set(r.x, r.y, r.z);
          if (n?.detailedPet) n.pet.update(dt, v, STAND_Y, r.anim === 2);
          else {
            let motion = petMotions.get(slot);
            if (!motion) { motion = createPetMotion(opts.petCollision); petMotions.set(slot, motion); }
            motion.setFollowSpeed(PET_SPEEDS.get(p.pet) ?? 8);
            motion.update(dt, v, STAND_Y);
            v.copy(motion.position).y += 0.28 + Math.sin(nowMs * (motion.speed > 0.6 ? 0.014 : 0.003) + slot) * 0.04;
            q.identity();
            m.compose(v, q, s);
            farPets.setMatrixAt(petCount++, m);
          }
        } else if (n) n.pet.group.visible = false;
        if (n) {
          nearCount += 1;
          n.root.visible = true;
          n.root.position.set(r.x, r.y, r.z);
          n.rig.group.rotation.y = -r.yaw;
          const anim = ANIMS[r.anim] ?? 'idle';
          // Vertical speed from the interpolated height; a snap (respawn, warp) reads as standing still.
          const rise = n.lastY === null || dt <= 0 || Math.abs(r.y - n.lastY) > 2 ? 0 : (r.y - n.lastY) / dt;
          n.lastY = r.y;
          n.vy = MathUtils.damp(n.vy, rise, 12, dt);
          n.rig.update(dt, anim === 'walk' || anim === 'run', anim === 'run', { airborne: anim === 'jump', vy: n.vy });
          const dist = camera.position.distanceTo(n.root.position);
          head.set(r.x, r.y - STAND_Y + 2.15, r.z).project(camera);
          if (dist > LABEL_RADIUS || head.z > 1 || Math.abs(head.x) > 1.1 || Math.abs(head.y) > 1.1) {
            n.label.hidden = true;
          } else {
            n.label.hidden = false;
            const scale = Math.min(1.1, Math.max(0.6, 8 / Math.max(dist, 0.1)));
            n.label.style.transform = `translate(${((head.x * 0.5 + 0.5) * width).toFixed(1)}px, ${((-head.y * 0.5 + 0.5) * height).toFixed(1)}px) translate(-50%, -100%) scale(${scale.toFixed(3)})`;
          }
          continue;
        }
        if (farCount >= FAR_CAPACITY) continue;
        q.setFromAxisAngle(up, -r.yaw);
        v.set(r.x, r.y - STAND_Y + 0.82, r.z);
        m.compose(v, q, s);
        far.setMatrixAt(farCount, m);
        far.setColorAt(farCount, colorFor(p?.character || p?.userId || String(slot)));
        farCount += 1;
      }
      for (const n of near) {
        if (n.slot === null) continue;
        const r = rendered.get(n.slot);
        if (!r || zoneOf(r.y, opts.realm) !== localZone) {
          n.root.visible = false;
          n.pet.group.visible = false;
          n.label.hidden = true;
        }
      }
      farPets.count = petCount;
      farPets.instanceMatrix.needsUpdate = true;
      far.count = farCount;
      far.instanceMatrix.needsUpdate = true;
      if (far.instanceColor) far.instanceColor.needsUpdate = true;
      counts.near = nearCount;
      counts.far = farCount;
    },
    anchorOf(userId) {
      const p = world.byUser(userId);
      if (!p) return null;
      return nearBySlot.get(p.slot)?.root ?? null;
    },
    positionOf(userId, out) {
      const p = world.byUser(userId);
      const r = p ? rendered.get(p.slot) : undefined;
      return r ? out.set(r.x, r.y, r.z) : null;
    },
    dispose() {
      unsubscribe();
      scene.remove(root);
      for (const n of near) n.pet.dispose();
      petGeometry.dispose();
      petMaterial.dispose();
      capsule.dispose();
      farMat.dispose();
      for (const n of near) n.label.remove();
    },
  };
}
