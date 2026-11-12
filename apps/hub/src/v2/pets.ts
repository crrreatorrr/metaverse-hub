import {
  AnimationMixer, Box3, LOD, LoopOnce, LoopRepeat, Matrix4, Mesh, MeshStandardMaterial, SphereGeometry, Vector3,
  type AnimationAction, type AnimationClip, type Material, type Object3D,
} from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { WORLD_ROOT, loadGLTF } from './core';
import { createPetMotion, PET_SCALE, type PetCollision } from '../core/pet-motion';
import { createBootSupport } from '../rig/boot-support';
import FOLLOWERS from '../../../../server/data/follower-pets.json';
import PETS_DATA from './pets.json';
import CLEARANCE from './pet-clearance.json';

/**
 * M6 hub pets (ken-games/pets/drop-for-tech, contract m6-pet-v1). One pet follows the local avatar.
 * Files: public/world/v2/pets/pet_<name>.glb (LOD0) + pet_<name>-lod1.glb (LOD1 beyond 12 m).
 * Metres, +Y up, +Z forward, origin on the ground; Sproto/Nobu 0.60 m, Pup 0.45 m, baked at scale 1.
 *
 * Equippable ids are exactly the server catalog ids in server/modules/src/pets.ts that have art in this
 * drop. pet_sproto_base / pet_nobu_base are the shared rigs (item_id null): shipped, not equippable.
 */
// Padded model-space bounds sampled across both GLBs at 60 Hz, as min XYZ then max XYZ.
const CLEARANCE_BOXES: Record<string, Record<string, readonly number[]>> = CLEARANCE;
type PetEntry = (typeof PETS_DATA.pets)[keyof typeof PETS_DATA.pets];
interface Pulse { node: string; material: string; min: number; max: number; hz: number }

export const DEFAULT_PET_ID = 'pet_pepe_bull';

export const PET_ASSET_IDS = Object.keys(PETS_DATA.pets) as (keyof typeof PETS_DATA.pets)[];
export type PetAssetId = (typeof PET_ASSET_IDS)[number];
/** Server catalog ids (HubPets.PETS) that this drop has a model for. */
export const EQUIPPABLE_PET_IDS: readonly string[] = FOLLOWERS.map(pet => pet.id);

const PET_DIR = `${WORLD_ROOT}v2/pets/`;
const LOD1_DISTANCE: number = PETS_DATA.contract.lod.switch_m;
const STOP_TO_IDLE = 0.18;
const IDLE_TO_SIT = 10;
const IDLE_TRICK_DELAY = PETS_DATA.contract.clips.idle_trick.delay_s;
const IDLE_TRICKS = ['idle_trick', 'idle_trick_2'] as const;
const FADE = 0.2;
const ONCE = new Set(['sit_enter', 'spawn_poof', 'emote_happy', ...IDLE_TRICKS]);
/**
 * Follow clips scale with the pet's real speed and displayed stride length, so legs slow down as the
 * follower settles instead of paddling at full rate. Run starts above
 * RUN_ENTER m/s and ends below RUN_EXIT, from the pet's own speed (it lags the avatar).
 */
const WALK_REF = 7.8 * PET_SCALE;
const RUN_REF = 16 * PET_SCALE;
const RUN_ENTER = 11;
const RUN_EXIT = 9;
const RATE_MIN = 0.45;
const RATE_MAX = 1.5;
const SPAWN_CLEARANCE_OFFSETS = [0.12, 0.24, 0.36, 0.48, 0.60];
// The baked clips are grounded individually. Leave room for blended joints.
const GROUND_CLEARANCE = 0.003;
const BULL_GROUND_CLEARANCE = 0.018;
const BULL_BLEND_LIFT = 0.032;
const SPAWN_CLEARANCE_STEPS = SPAWN_CLEARANCE_OFFSETS.flatMap(d => [[-d, 0], [d, 0], [0, -d], [0, d]]);

export function isPetAssetId(id: string): id is PetAssetId {
  return (PET_ASSET_IDS as string[]).includes(id);
}

/** One LOD level: its own scene clone + mixer. Only the visible level is advanced. */
interface Level {
  root: Object3D;
  mixer: AnimationMixer;
  clips: readonly AnimationClip[];
  actions: Map<string, AnimationAction>;
  mats: { mat: MeshStandardMaterial; pulse: Pulse }[];
  bootSupport?: ReturnType<typeof createBootSupport>;
  beam?: Object3D;
  beamScaleY?: number;
}

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
  return { root, mixer, clips, actions, mats, beam: root.getObjectByName('Laser_Beam') };
}

export interface PetFollower {
  readonly group: LOD;
  readonly active: string | null;
  /** Body clip currently playing (debug / tests). */
  readonly current: string;
  /** Equip a pet by id (null = none). Unknown ids are ignored with a warning. */
  setPet(id: string | null): Promise<void>;
  /** Per frame. `player` is the avatar rig position (capsule centre), `standY` its height above the ground. */
  update(dt: number, player: Vector3, standY: number, sprint: boolean, spawnYaw?: number): void;
  dispose(): void;
  /** Play a one-shot emote (emote_happy / emote_dance / spawn_poof). */
  emote(name: 'emote_happy' | 'emote_dance' | 'spawn_poof'): void;
}

export function createPetFollower(parent: Object3D, collide?: PetCollision): PetFollower {
  const group = new LOD();
  group.name = 'hub-pet';
  group.scale.setScalar(PET_SCALE);
  group.visible = false;
  parent.add(group);
  let active: string | null = null;
  let levels: Level[] = [];
  let current = '';
  let idleAnimation = 'idle';
  let token = 0;

  let stillFor = 0;
  let idleFor = 0;
  let trickPlayed = false;
  let nextTrick = 0;
  let tricks: string[] = [];
  let poseFadeUntil = 0;
  let fadingPose = '';
  let visibleLevel: Level | undefined;
  let hasPose = false;
  const transform = new Matrix4();
  const bounds = new Box3();
  const beamOrigin = new Vector3();
  const beamDirection = new Vector3();
  let time = 0;
  const motion = createPetMotion(collide);
  const orbGeometry = new SphereGeometry((FOLLOWERS.find(pet => pet.id === 'pet_starter')?.size ?? 0.45) / 2, 8, 6);
  const orbMaterial = new MeshStandardMaterial({ color: '#94e9ff', emissive: '#225577' });
  const orb = new Mesh(orbGeometry, orbMaterial);
  orb.position.y = 0.28;

  function play(name: string, fade = FADE): void {
    if (name === current || !levels[0]?.actions.has(name)) return;
    const phase = visibleLevel?.actions.get(current)?.time;
    for (const level of levels) {
      const next = level.actions.get(name);
      if (!next) continue;
      const prev = level.actions.get(current);
      next.reset().play();
      if (prev && prev !== next) {
        if (phase !== undefined) prev.time = phase;
        prev.crossFadeTo(next, fade, false);
      }
    }
    fadingPose = fade > 0 ? current : '';
    poseFadeUntil = fadingPose ? time + fade : 0;
    current = name;
  }

  function syncVisibleLevel(): void {
    const nextLevel = levels.find(level => level.root.visible);
    if (nextLevel && visibleLevel && nextLevel !== visibleLevel) {
      const previous = visibleLevel.actions.get(current);
      const next = nextLevel.actions.get(current);
      if (previous && next && previous.time !== next.time) {
        next.time = previous.time;
        nextLevel.mixer.update(0);
      }
    }
    visibleLevel = nextLevel;
  }

  group.update = (camera) => {
    LOD.prototype.update.call(group, camera);
    // Three selects the level during rendering. Pose it before its first draw.
    syncVisibleLevel();
  };

  function onFinished(event: { action: AnimationAction }): void {
    const name = event.action.getClip().name;
    if (name !== current) return;
    if (name === 'sit_enter') play('sit', 0); // sit's first key = sit_enter's last key
    else if (name === 'spawn_poof' || name === 'emote_happy' || tricks.includes(name)) play(idleAnimation);
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
    trickPlayed = false;
    nextTrick = 0;
    tricks = [];
    poseFadeUntil = 0;
    fadingPose = '';
    visibleLevel = undefined;
    hasPose = false;
    group.visible = false;
  }

  function clearance(clip: string) {
    return active ? CLEARANCE_BOXES[active]?.[clip] : undefined;
  }

  function fits(clip: string): boolean {
    const extent = clearance(clip);
    if (!extent) return true;
    bounds.min.set(extent[0], extent[1], extent[2]).multiplyScalar(PET_SCALE);
    bounds.max.set(extent[3], extent[4], extent[5]).multiplyScalar(PET_SCALE);
    return !collide?.blocked?.(bounds, transform);
  }

  function clipBeam(beam: Object3D): void {
    if (!collide?.beamRange || beam.scale.y <= 0.001) return;
    beam.updateWorldMatrix(true, false);
    beamOrigin.setFromMatrixPosition(beam.matrixWorld);
    beamDirection.set(0, 1, 0).transformDirection(beam.matrixWorld);
    // The authored peak beam is two metres before the uniform display scale.
    const length = 2 * PET_SCALE * beam.scale.y;
    beam.scale.y *= collide.beamRange(beamOrigin, beamDirection, length) / length;
  }

  return {
    group,
    get active() { return active; },
    get current() { return current; },
    async setPet(id) {
      const mine = ++token;
      if (id === active) return;
      const definition = FOLLOWERS.find(pet => pet.id === id);
      if (id === null) { clear(); active = null; return; }
      if (id === 'pet_starter') {
        clear(); active = id; group.addLevel(orb, 0); current = 'idle';
        motion.setFollowSpeed(definition?.followSpeed ?? 8);
        return;
      }
      if (!isPetAssetId(id)) { console.warn('[pets] unknown pet id', id); return; }
      const entry = PETS_DATA.pets[id] as PetEntry;
      const pulses = (entry.pulses ?? []) as Pulse[];
      const file = (path: string) => `${PET_DIR}${path.replace(/^glb\//, '')}`;
      const [near, far] = await Promise.all([loadGLTF(file(definition?.model ?? entry.file)), loadGLTF(file(entry.lod1))]);
      if (mine !== token) return;
      clear();
      motion.setFollowSpeed(definition?.followSpeed ?? 8);
      idleAnimation = definition?.idleAnimation ?? 'idle';
      levels = [makeLevel(near.scene, near.animations, id, pulses), makeLevel(far.scene, far.animations, id, pulses)];
      tricks = IDLE_TRICKS.filter(name => levels.every(level => level.actions.has(name)));
      const height = id === 'pet_sproto_pup' ? PETS_DATA.contract.height_m.sproto_pup : PETS_DATA.contract.height_m.sproto;
      for (const level of levels) {
        level.root.scale.setScalar((definition?.size ?? height) / height);
        if (id === DEFAULT_PET_ID) level.root.position.y += BULL_GROUND_CLEARANCE;
        else if (CLEARANCE_BOXES[id] && id !== 'pet_mecha') level.root.position.y += GROUND_CLEARANCE;
      }
      group.addLevel(levels[0].root, 0);
      group.addLevel(levels[1].root, LOD1_DISTANCE);
      for (const level of levels) {
        level.mixer.addEventListener('finished', onFinished as never);
        if ((entry.rig === 'mixamo' && id !== 'pet_mecha') || id === 'pet_speed_sproto') {
          level.bootSupport = createBootSupport(level.root, level.root, group, true);
        }
      }
      active = id;
      play(levels[0].actions.has('spawn_poof') ? 'spawn_poof' : idleAnimation, 0);
      for (const level of levels) level.mixer.update(0);
    },
    dispose() { ++token; clear(); active = null; parent.remove(group); orbGeometry.dispose(); orbMaterial.dispose(); },
    emote(name) { if (fits(name)) play(name, 0.1); },
    update(dt, player, standY, sprint, spawnYaw) {
      if (!active) return;
      time += dt;
      if (motion.update(dt, player, standY, spawnYaw)) hasPose = false;
      let speed = motion.speed;
      const turn = Math.atan2(Math.sin(motion.facingYaw - group.rotation.y), Math.cos(motion.facingYaw - group.rotation.y));
      const maxTurn = 6 * Math.min(Math.max(dt, 0), 0.05);
      let yaw = group.rotation.y;
      if (!hasPose) yaw = motion.facingYaw;
      else if (speed > 0.6) yaw += Math.max(-maxTurn, Math.min(maxTurn, turn));
      transform.makeRotationY(yaw).setPosition(motion.position);
      let canMove = fits('base');
      if (!canMove && hasPose && yaw !== group.rotation.y) {
        // In a narrow passage the pet can keep its current angle until it clears the wall.
        yaw = group.rotation.y;
        transform.makeRotationY(yaw).setPosition(motion.position);
        canMove = fits('base');
      }
      if (!canMove && !hasPose) {
        const { x, y, z } = motion.position;
        for (const [dx, dz] of SPAWN_CLEARANCE_STEPS) {
          transform.setPosition(x + dx, y, z + dz);
          if (!fits('base')) continue;
          motion.position.set(x + dx, y, z + dz);
          speed = 0;
          canMove = true;
          break;
        }
      }
      if (canMove || !hasPose) {
        group.position.copy(motion.position);
        group.rotation.y = yaw;
        transform.setPosition(group.position);
        hasPose = true;
      } else {
        // Keep the visible pose when scenery blocks the next step.
        motion.holdAt(group.position);
        transform.makeRotationY(group.rotation.y).setPosition(group.position);
        speed = 0;
      }
      group.visible = true;
      if (active === 'pet_starter') {
        orb.position.y = 0.28 + Math.sin(time * (speed > 0.6 ? 14 : 3)) * 0.04;
        current = speed > 0.6 ? 'follow_walk' : 'idle';
        return;
      }
      let refreshBoth = false;
      if (!fits(current)) {
        refreshBoth = true;
        for (const level of levels) level.actions.get(current)?.stop();
        play(idleAnimation, 0);
      }
      if (time <= poseFadeUntil && !fits(fadingPose)) {
        refreshBoth = true;
        for (const level of levels) level.actions.get(fadingPose)?.stop();
        poseFadeUntil = 0;
      }
      const busy = current === 'spawn_poof' || current === 'emote_happy';
      if (speed > 0.6) {
        stillFor = 0;
        idleFor = 0;
        trickPlayed = false;
        const running = current === 'follow_run' ? speed > RUN_EXIT : speed > RUN_ENTER || (sprint && speed > RUN_EXIT);
        if (!busy) play(running ? 'follow_run' : 'follow_walk');
      } else {
        stillFor += dt;
        if (!busy && stillFor > STOP_TO_IDLE && (current === 'follow_walk' || current === 'follow_run' || current === '')) play(idleAnimation);
        if (current === idleAnimation) {
          idleFor += dt;
          if (!trickPlayed && stillFor >= IDLE_TRICK_DELAY && tricks.length > 0 && fits(tricks[nextTrick])) {
            trickPlayed = true;
            play(tricks[nextTrick], 0.12);
            nextTrick = (nextTrick + 1) % tricks.length;
          } else if (idleFor > IDLE_TO_SIT && levels[0].actions.has('sit_enter') && fits('sit_enter')) {
            play('sit_enter', 0.1);
          }
        } else if (current !== 'sit' && current !== 'sit_enter') idleFor = 0;
      }
      // The Bull and Mecha loops are authored to play at full cadence at normal plaza speeds.
      const pace = speed * (active === DEFAULT_PET_ID || active === 'pet_mecha' ? PET_SCALE : 1);
      const rate = current === 'follow_run' ? pace / RUN_REF : current === 'follow_walk' ? pace / WALK_REF : 1;
      const timeScale = current === 'follow_run' || current === 'follow_walk' ? Math.min(RATE_MAX, Math.max(RATE_MIN, rate)) : 1;
      // Advance both LODs through a fade, then carry the visible loop phase across LOD switches.
      const blending = time - dt < poseFadeUntil;
      const updateBoth = refreshBoth || ONCE.has(current) || blending;
      syncVisibleLevel();
      const groundBoots = (blending && (current === 'follow_walk' || fadingPose === 'follow_walk'))
        || (active === 'pet_speed_sproto' && current === 'follow_run');
      for (const level of levels) {
        const action = level.actions.get(current);
        if (action) action.timeScale = timeScale;
        if (level.root.visible || updateBoth) {
          // Restore the authored scale first. The mixer skips writing a
          // property when its keyed value stays constant across frames.
          if (level.beam && level.beamScaleY !== undefined) level.beam.scale.y = level.beamScaleY;
          level.mixer.update(dt);
          level.bootSupport?.(dt, groundBoots);
          if (active === DEFAULT_PET_ID) {
            const weight = action?.getEffectiveWeight() ?? 1;
            // A shallow arc keeps the hooves clear while changing gait.
            level.root.position.y = BULL_GROUND_CLEARANCE + BULL_BLEND_LIFT * 4 * weight * (1 - weight);
          }
          if (level.beam) {
            level.beamScaleY = level.beam.scale.y;
            clipBeam(level.beam);
          }
        }
        for (const { mat, pulse } of level.mats) {
          mat.emissiveIntensity = pulse.min + (pulse.max - pulse.min) * (0.5 + 0.5 * Math.sin(time * Math.PI * 2 * pulse.hz));
        }
      }
    },
  };
}
