import {
  AnimationMixer, LOD, LoopOnce, LoopRepeat, Mesh, MeshStandardMaterial, SphereGeometry,
  type AnimationAction, type AnimationClip, type Material, type Object3D, type Vector3,
} from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { WORLD_ROOT, loadGLTF } from './core';
import { createPetMotion, type PetCollision } from '../core/pet-motion';
import FOLLOWERS from '../../../../server/data/follower-pets.json';
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
export const EQUIPPABLE_PET_IDS: readonly string[] = FOLLOWERS.map(pet => pet.id);

const PET_DIR = `${WORLD_ROOT}v2/pets/`;
const LOD1_DISTANCE: number = PETS_DATA.contract.lod.switch_m;
const STOP_TO_IDLE = 0.5;
const IDLE_TO_SIT = 10;
const FADE = 0.2;
const ONCE = new Set(['sit_enter', 'spawn_poof', 'emote_happy']);
/**
 * Follow clips play at 1x at the avatar's jog (follow_walk) and dash (follow_run) and scale with the pet's
 * real speed, so legs slow down as the follower settles instead of paddling at full rate. Run starts above
 * RUN_ENTER m/s and ends below RUN_EXIT, from the pet's own speed (it lags the avatar).
 */
const WALK_REF = 7.8;
const RUN_REF = 16;
const RUN_ENTER = 11;
const RUN_EXIT = 9;
const RATE_MIN = 0.45;
const RATE_MAX = 1.5;

export function isPetAssetId(id: string): id is PetAssetId {
  return (PET_ASSET_IDS as string[]).includes(id);
}

/** One LOD level: its own scene clone + mixer. Only the visible level is advanced. */
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
  readonly active: string | null;
  /** Body clip currently playing (debug / tests). */
  readonly current: string;
  /** Equip a pet by id (null = none). Unknown ids are ignored with a warning. */
  setPet(id: string | null): Promise<void>;
  /** Per frame. `player` is the avatar rig position (capsule centre), `standY` its height above the ground. */
  update(dt: number, player: Vector3, standY: number, sprint: boolean): void;
  dispose(): void;
  /** Play a one-shot emote (emote_happy / emote_dance / spawn_poof). */
  emote(name: 'emote_happy' | 'emote_dance' | 'spawn_poof'): void;
}

export function createPetFollower(parent: Object3D, collide?: PetCollision): PetFollower {
  const group = new LOD();
  group.name = 'hub-pet';
  group.visible = false;
  parent.add(group);
  let active: string | null = null;
  let levels: Level[] = [];
  let current = '';
  let idleAnimation = 'idle';
  let token = 0;

  let stillFor = 0;
  let idleFor = 0;
  let time = 0;
  const motion = createPetMotion(collide);
  const orbGeometry = new SphereGeometry((FOLLOWERS.find(pet => pet.id === 'pet_starter')?.size ?? 0.45) / 2, 8, 6);
  const orbMaterial = new MeshStandardMaterial({ color: '#94e9ff', emissive: '#225577' });
  const orb = new Mesh(orbGeometry, orbMaterial);
  orb.position.y = 0.28;

  function play(name: string, fade = FADE): void {
    if (name === current || !levels[0]?.actions.has(name)) return;
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
    else if (name === 'spawn_poof' || name === 'emote_happy') play(idleAnimation);
  }

  function clear(): void {
    for (const level of levels) {
      level.mixer.stopAllAction();
      level.mixer.uncacheRoot(level.root);
      for (const { mat } of level.mats) mat.dispose();
      level.mixer.removeEventListener('finished', onFinished as never);
    }
    group.clear();
    group.levels.length = 0;
    levels = [];
    current = '';
    motion.reset();
    stillFor = 0;
    idleFor = 0;
    group.visible = false;
  }

  return {
    group,
    get active() { return active; },
    get current() { return current; },
    async setPet(id) {
      const mine = ++token;
      const definition = FOLLOWERS.find(pet => pet.id === id);
      motion.setFollowSpeed(definition?.followSpeed ?? 8);
      idleAnimation = definition?.idleAnimation ?? 'idle';
      if (id === null) { clear(); active = null; return; }
      if (id === 'pet_starter') {
        clear(); active = id; group.addLevel(orb, 0); current = 'idle'; return;
      }
      if (!isPetAssetId(id)) { console.warn('[pets] unknown pet id', id); return; }
      const entry = PETS_DATA.pets[id] as PetEntry;
      const pulses = (entry.pulses ?? []) as Pulse[];
      const file = (path: string) => `${PET_DIR}${path.replace(/^glb\//, '')}`;
      const [near, far] = await Promise.all([loadGLTF(file(definition?.model ?? entry.file)), loadGLTF(file(entry.lod1))]);
      if (mine !== token) return;
      clear();
      levels = [makeLevel(near.scene, near.animations, id, pulses), makeLevel(far.scene, far.animations, id, pulses)];
      const height = id === 'pet_sproto_pup' ? PETS_DATA.contract.height_m.sproto_pup : PETS_DATA.contract.height_m.sproto;
      for (const level of levels) level.root.scale.setScalar((definition?.size ?? height) / height);
      group.addLevel(levels[0].root, 0);
      group.addLevel(levels[1].root, LOD1_DISTANCE);
      for (const level of levels) level.mixer.addEventListener('finished', onFinished as never);
      active = id;
      play(levels[0].actions.has('spawn_poof') ? 'spawn_poof' : idleAnimation, 0);
    },
    dispose() { ++token; clear(); active = null; parent.remove(group); orbGeometry.dispose(); orbMaterial.dispose(); },
    emote(name) { play(name, 0.1); },
    update(dt, player, standY, sprint) {
      if (!active) return;
      time += dt;
      const oldX = group.position.x;
      const oldZ = group.position.z;
      motion.update(dt, player, standY);
      group.position.copy(motion.position);
      group.visible = true;
      const speed = motion.speed;
      if (speed > 0.6) group.rotation.y = Math.atan2(group.position.x - oldX, group.position.z - oldZ);
      if (active === 'pet_starter') {
        orb.position.y = 0.28 + Math.sin(time * (speed > 0.6 ? 14 : 3)) * 0.04;
        current = speed > 0.6 ? 'follow_walk' : 'idle';
        return;
      }
      const busy = current === 'spawn_poof' || current === 'emote_happy';
      if (speed > 0.6) {
        stillFor = 0;
        idleFor = 0;
        const running = current === 'follow_run' ? speed > RUN_EXIT : speed > RUN_ENTER || (sprint && speed > RUN_EXIT);
        if (!busy) play(running ? 'follow_run' : 'follow_walk');
      } else {
        stillFor += dt;
        if (!busy && stillFor > STOP_TO_IDLE && (current === 'follow_walk' || current === 'follow_run' || current === '')) play(idleAnimation);
        if (current === 'idle') {
          idleFor += dt;
          if (idleFor > IDLE_TO_SIT && levels[0].actions.has('sit_enter')) play('sit_enter', 0.1);
        } else if (current !== 'sit' && current !== 'sit_enter') idleFor = 0;
      }
      const rate = current === 'follow_run' ? speed / RUN_REF : current === 'follow_walk' ? speed / WALK_REF : 1;
      const timeScale = current === 'follow_run' || current === 'follow_walk' ? Math.min(RATE_MAX, Math.max(RATE_MIN, rate)) : 1;
      for (const level of levels) {
        const action = level.actions.get(current);
        if (action) action.timeScale = timeScale;
        if (level.root.visible) level.mixer.update(dt);
        for (const { mat, pulse } of level.mats) {
          mat.emissiveIntensity = pulse.min + (pulse.max - pulse.min) * (0.5 + 0.5 * Math.sin(time * Math.PI * 2 * pulse.hz));
        }
      }
    },
  };
}
