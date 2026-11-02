import {
  AnimationMixer, LOD, LoopOnce, LoopRepeat, Vector3,
  type AnimationAction, type AnimationClip, type Material, type Mesh, type MeshStandardMaterial, type Object3D,
} from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { WORLD_ROOT, loadGLTF } from './core';
import PETS_DATA from './pets.json';

/**
 * M6 hub pets (ken-games/pets/drop-for-tech, contract m6-pet-v1). One pet follows the local avatar.
 * Files: public/world/v2/pets/pet_<name>.glb (LOD0) + pet_<name>-lod1.glb (LOD1 beyond 12 m).
 * Metres, +Y up, +Z forward, origin on the ground; Sproto/Nobu 0.60 m, Pup 0.45 m, baked at scale 1.
 *
 * Equippable ids are exactly the server catalog ids in server/modules/src/pets.ts that have art in this
 * drop. pet_sproto_base / pet_nobu_base are the shared rigs (item_id null): shipped, not equippable.
 */
type PetEntry = (typeof PETS_DATA.pets)[keyof typeof PETS_DATA.pets];
interface Pulse { node: string; material: string; min: number; max: number; hz: number }

export const PET_ASSET_IDS = Object.keys(PETS_DATA.pets) as (keyof typeof PETS_DATA.pets)[];
export type PetAssetId = (typeof PET_ASSET_IDS)[number];
/** Server catalog ids (HubPets.PETS) that this drop has a model for. */
export const EQUIPPABLE_PET_IDS = PET_ASSET_IDS.filter((id) => (PETS_DATA.pets[id] as PetEntry).item_id === id);

const PET_DIR = `${WORLD_ROOT}v2/pets/`;
const LOD1_DISTANCE: number = PETS_DATA.contract.lod.switch_m;
const FOLLOW_RIGHT: number = PETS_DATA.contract.follow.offset_avatar_local_m.right;
const FOLLOW_BACK: number = PETS_DATA.contract.follow.offset_avatar_local_m.back;
/** Spec section 3: gap above 8 m -> spawn_poof + snap. */
const SNAP_GAP = 8;
const STOP_TO_IDLE = 0.5;
const IDLE_TO_SIT = 10;
const FADE = 0.2;
const ONCE = new Set(['sit_enter', 'spawn_poof', 'emote_happy']);

export function isPetAssetId(id: string): id is PetAssetId {
  return (PET_ASSET_IDS as string[]).includes(id);
}

/** One LOD level: its own scene clone + mixer. Both levels play the same clip so a swap keeps the pose. */
interface Level { root: Object3D; mixer: AnimationMixer; clips: readonly AnimationClip[]; actions: Map<string, AnimationAction>; mats: { mat: MeshStandardMaterial; pulse: Pulse }[] }

function makeLevel(scene: Object3D, clips: readonly AnimationClip[], id: string, pulses: readonly Pulse[]): Level {
  const root = SkeletonUtils.clone(scene);
  const mats: Level['mats'] = [];
  root.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh) return;
    if ((mesh as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh) mesh.frustumCulled = false;
    const list = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((m: Material) => {
      const pulse = pulses.find((p) => p.material === m.name);
      if (!pulse) return m;
      const own = m.clone() as MeshStandardMaterial;
      mats.push({ mat: own, pulse });
      return own;
    });
    mesh.material = Array.isArray(mesh.material) ? list : list[0];
  });
  const mixer = new AnimationMixer(root);
  const actions = new Map<string, AnimationAction>();
  for (const clip of clips) {
    const action = mixer.clipAction(clip);
    if (ONCE.has(clip.name)) {
      action.setLoop(LoopOnce, 1);
      action.clampWhenFinished = true;
    } else action.setLoop(LoopRepeat, Infinity);
    actions.set(clip.name, action);
  }
  actions.get(`${id}_parts`)?.play(); // always on, only touches part nodes
  return { root, mixer, clips, actions, mats };
}

export interface PetFollower {
  readonly group: LOD;
  readonly active: PetAssetId | null;
  /** Body clip currently playing (debug / tests). */
  readonly current: string;
  /** Equip a pet by id (null = none). Unknown ids are ignored with a warning. */
  setPet(id: string | null): Promise<void>;
  /** Per frame. `player` is the avatar rig position (capsule centre), `standY` its height above the ground. */
  update(dt: number, player: Vector3, standY: number, sprint: boolean): void;
  /** Play a one-shot emote (emote_happy / emote_dance / spawn_poof). */
  emote(name: 'emote_happy' | 'emote_dance' | 'spawn_poof'): void;
}

export function createPetFollower(parent: Object3D): PetFollower {
  const group = new LOD();
  group.name = 'hub-pet';
  group.visible = false;
  parent.add(group);
  let active: PetAssetId | null = null;
  let levels: Level[] = [];
  let current = '';
  let token = 0;
  let placed = false;
  let stillFor = 0;
  let idleFor = 0;
  let time = 0;
  const heading = new Vector3(0, 0, -1);
  const lastPlayer = new Vector3();
  const target = new Vector3();
  const velocity = new Vector3();
  const tmp = new Vector3();

  function play(name: string, fade = FADE): void {
    if (name === current) return;
    for (const level of levels) {
      const next = level.actions.get(name);
      if (!next) continue;
      const prev = level.actions.get(current);
      next.reset().play();
      if (prev && prev !== next) prev.crossFadeTo(next, fade, false);
    }
    current = name;
  }

  function onFinished(event: { action: AnimationAction }): void {
    const name = event.action.getClip().name;
    if (name !== current) return;
    if (name === 'sit_enter') play('sit', 0); // sit's first key = sit_enter's last key
    else if (name === 'spawn_poof' || name === 'emote_happy') play('idle');
  }

  function clear(): void {
    for (const level of levels) {
      level.mixer.stopAllAction();
      level.mixer.removeEventListener('finished', onFinished as never);
    }
    group.clear();
    group.levels.length = 0;
    levels = [];
    current = '';
    placed = false;
    group.visible = false;
  }

  return {
    group,
    get active() { return active; },
    get current() { return current; },
    async setPet(id) {
      const mine = ++token;
      if (id === null) { clear(); active = null; return; }
      if (!isPetAssetId(id)) { console.warn('[pets] unknown pet id', id); return; }
      const entry = PETS_DATA.pets[id] as PetEntry;
      const pulses = (entry.pulses ?? []) as Pulse[];
      const file = (path: string) => `${PET_DIR}${path.replace(/^glb\//, '')}`;
      const [near, far] = await Promise.all([loadGLTF(file(entry.file)), loadGLTF(file(entry.lod1))]);
      if (mine !== token) return;
      clear();
      levels = [makeLevel(near.scene, near.animations, id, pulses), makeLevel(far.scene, far.animations, id, pulses)];
      group.addLevel(levels[0].root, 0);
      group.addLevel(levels[1].root, LOD1_DISTANCE);
      for (const level of levels) level.mixer.addEventListener('finished', onFinished as never);
      active = id;
      play('spawn_poof', 0);
    },
    emote(name) { play(name, 0.1); },
    update(dt, player, standY, sprint) {
      if (!active || levels.length === 0) return;
      time += dt;
      const groundY = player.y - standY;
      tmp.subVectors(player, lastPlayer).setY(0);
      const moved = tmp.length();
      lastPlayer.copy(player);
      if (moved > 1e-4 && moved < 2) heading.copy(tmp).normalize();
      // Spring target: avatar-local 0.6 m right and 0.9 m back (right of heading h is (-h.z, 0, h.x)).
      target.set(
        player.x - heading.x * FOLLOW_BACK - heading.z * FOLLOW_RIGHT,
        groundY,
        player.z - heading.z * FOLLOW_BACK + heading.x * FOLLOW_RIGHT,
      );
      const gap = Math.hypot(target.x - group.position.x, target.z - group.position.z);
      if (!placed || gap > SNAP_GAP || Math.abs(group.position.y - groundY) > 4) {
        group.position.copy(target);
        group.rotation.y = Math.atan2(heading.x, heading.z);
        velocity.set(0, 0, 0);
        group.visible = true;
        if (placed) play('spawn_poof', 0);
        placed = true;
      } else {
        // Critically damped spring toward the target.
        const k = 80; // steady lag 2v/sqrt(k): ~1.7 m at jog 7.8, ~3.6 m at dash 16 (snap gap is 8 m)
        const c = 2 * Math.sqrt(k);
        tmp.subVectors(target, group.position);
        velocity.addScaledVector(tmp, k * dt).addScaledVector(velocity, -c * dt);
        group.position.addScaledVector(velocity, dt);
        group.position.y = groundY;
      }
      const speed = Math.hypot(velocity.x, velocity.z);
      const busy = current === 'spawn_poof' || current === 'emote_happy';
      if (speed > 0.6) {
        stillFor = 0;
        idleFor = 0;
        group.rotation.y = Math.atan2(velocity.x, velocity.z); // +Z forward
        if (!busy) play(sprint && moved > 0 ? 'follow_run' : 'follow_walk');
      } else {
        stillFor += dt;
        if (!busy && stillFor > STOP_TO_IDLE && (current === 'follow_walk' || current === 'follow_run' || current === '')) play('idle');
        if (current === 'idle') {
          idleFor += dt;
          if (idleFor > IDLE_TO_SIT) play('sit_enter', 0.1);
        } else if (current !== 'sit' && current !== 'sit_enter') idleFor = 0;
      }
      for (const level of levels) {
        level.mixer.update(dt);
        for (const { mat, pulse } of level.mats) {
          mat.emissiveIntensity = pulse.min + (pulse.max - pulse.min) * (0.5 + 0.5 * Math.sin(time * Math.PI * 2 * pulse.hz));
        }
      }
    },
  };
}
