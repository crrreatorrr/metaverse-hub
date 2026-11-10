import { RELICS } from './core/relics';
import {
  AdditiveBlending,
  AnimationClip,
  AnimationMixer,
  Box3,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Group,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  RingGeometry,
  SkinnedMesh,
  SRGBColorSpace,
  Vector3,
  Vector4,
  type AnimationAction,
  Object3D,
} from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import {
  AVATAR_ASSET,
  AVATAR_BLEND,
  AVATAR_CLIPS,
  AVATAR_HEIGHT,
  CHARACTERS,
  DEFAULT_CHARACTER,
  SPRINT_SPEED,
  STAFFS,
  WALK_SPEED,
  characterHeight,
  characterYaw,
  fliesWhenMoving,
  holdsStaff,
  walksWithRun,
  staffScale,
  type CharacterConfig,
  type CharacterId,
  type StaffId,
} from './config';
import type { AvatarLook } from './look';
import { MOVEMENT } from './core/movement';
import { STAND_Y } from './physics';
import { createBootSupport } from './rig/boot-support';
import { createFlightTurn, type FlightTiming } from './rig/flight-turn';
import { applyGaitProfile } from './rig/gait-profile';
import { groundSpeedOf, locomotionFor } from './rig/locomotion';
import { loadGLTF } from './v2/core';

/** Airborne state for the jump clip. `vy` is vertical velocity (m/s, up positive). */
export interface AvatarAir {
  airborne: boolean;
  vy: number;
  /** Physical or interpolated flight timing for a complete aerial turn. */
  flight?: FlightTiming;
}

type Gait = 'idle' | 'walk' | 'run';
type Pose = Gait | 'air';

/**
 * Gait playback stays in this band even when a rig's stride is far from the controller speed. The Midget's
 * short legs need about 2.2x at the jog to keep his feet planted ("Quick feet").
 */
const TIME_SCALE_MIN = 0.5;
const TIME_SCALE_MAX = 2.5;
/** Part of the Sproto Duel `jump` clip used in the air (fractions of its length): arms-up launch to tuck. */
const AIR_WINDOW = [0.15, 0.85] as const;
/** Crossfades into and out of the jump clip (s). */
const AIR_BLEND = { takeoff: 0.08, land: 0.14 } as const;
/** Bank into turns: radians of roll per rad/s of yaw rate at sprint, capped. */
const BANK_GAIN = 0.045;
const BANK_MAX = 0.2;
/** A yaw step larger than this in one frame is a teleport or respawn, not a turn. */
const BANK_SNAP = 1.2;

export interface AvatarRig {
  readonly group: Group;
  /** Fetch the mesh. Call after the first-load byte snapshot. */
  load(): void;
  /** `air` drives the jump clip; leave it out for a rig that is always grounded. */
  update(dt: number, moving: boolean, sprint: boolean, air?: AvatarAir): void;
  /** Character, staff and Relic aura. Applies now, or when the mesh arrives. */
  setLook(look: AvatarLook): void;
}

const size = new Vector3();

function characterById(id: CharacterId): CharacterConfig {
  return CHARACTERS.find((entry) => entry.id === id) ?? CHARACTERS[0];
}
const point = new Vector3();
const bindVertex = new Vector4();
const skinned = new Vector4();
const weighted = new Vector4();
const bone = new Matrix4();

export function createAvatarRig(): AvatarRig {
  const group = new Group();
  group.name = 'player-avatar';
  let mixer: AnimationMixer | null = null;
  let actions: (Record<Gait, AnimationAction> & { air: AnimationAction | null }) | null = null;
  const flightTurn = createFlightTurn();
  let hasBackflip = false;
  let bootSupport: ReturnType<typeof createBootSupport> = null;
  let pose: Pose = 'idle';
  let bank = 0;
  let lastYaw: number | null = null;
  let started = false;
  let look: AvatarLook | null = null;
  let auraClock = 0;
  /** Character whose mesh is on screen or loading. */
  let shown: CharacterId | null = null;
  let loadToken = 0;
  let model: Object3D | null = null;
  /** Where the staff mounts on the current model. */
  let socket: Object3D | null = null;
  /** Staff the look asks for, the loaded prop, and the copy on the socket. */
  let staffWanted: StaffId = 'none';
  let staffLoaded: { id: StaffId; scene: Object3D; animations: AnimationClip[] } | null = null;
  let staffToken = 0;
  let staffObject: Object3D | null = null;
  let staffMixer: AnimationMixer | null = null;
  // Lean pivots at the feet, so banking into a turn does not swing the legs sideways.
  const lean = new Group();
  lean.name = 'avatar-lean';
  lean.position.y = -STAND_Y;
  group.add(lean);
  const body = new Group();
  body.name = 'avatar-body';
  // `lean` sits on the floor, STAND_Y below the rig origin (the capsule top); the fit puts the feet at −STAND_Y.
  body.position.y = STAND_Y;
  lean.add(body);
  const aura = createAura();
  group.add(aura.group);

  function load(): void {
    if (started) return;
    started = true;
    show(look?.character ?? DEFAULT_CHARACTER);
  }

  /** Swap the mesh. The old one stays until the new one is ready, so the player never vanishes. */
  function show(id: CharacterId): void {
    if (id === shown) return;
    shown = id;
    const token = ++loadToken;
    const character = characterById(id);
    const url = `${import.meta.env.BASE_URL}${character.asset}`;
    const donorUrl = `${import.meta.env.BASE_URL}${AVATAR_ASSET}`;
    void loadGLTF(url)
      .then(async (gltf) => {
        if (token !== loadToken) return;
        const prepared = SkeletonUtils.clone(gltf.scene) as Group;
        // Duel-skeleton rigs without P4's jog / dash get the wizard's, retargeted, so their feet stay planted.
        // Flyers keep their own airborne `run` for both gaits instead.
        const sourceClips = fliesWhenMoving(character)
          ? gltf.animations
          : await locomotionFor(character.asset, gltf, () => loadGLTF(donorUrl));
        if (token !== loadToken) return;
        // The Wizard also supplies the donor gaits. Fit its own playback
        // here so the source clips stay available for retargeting.
        const profile = gltf.scene.userData.native_locomotion_v1;
        const clips = profile ? sourceClips.map((clip) => applyGaitProfile(clip, profile)) : sourceClips;
        const next = fitModel(prepared, characterHeight(character), characterYaw(character));
        // Before the mixer runs, so the socket is placed against the rest pose.
        const nextSocket = staffSocket(next, staffScale(character));
        const nextMixer = new AnimationMixer(next);
        const claimed = new WeakSet<AnimationClip>();
        const nextActions = {
          idle: playClip(nextMixer, clips, 'idle', claimed),
          walk: playClip(nextMixer, walksWithRun(character) ? clips.filter((clip) => clip.name !== 'walk') : clips, 'walk', claimed),
          run: playClip(nextMixer, clips, 'run', claimed),
          air: airClip(nextMixer, clips),
        };
        unmountStaff();
        if (model) disposeModel(model);
        model = next;
        socket = nextSocket;
        mixer = nextMixer;
        actions = nextActions;
        hasBackflip = character.id === 'flyer';
        flightTurn.reset();
        body.add(next);
        lean.position.y = -STAND_Y;
        bootSupport = createBootSupport(next, lean, group);
        retime();
        if (pose === 'air' && !actions.air) pose = 'idle';
        poseAction(pose).play();
        mountStaff();
      })
      .catch((error: unknown) => {
        console.error(`[hub] ${character.label} avatar failed to load`, error);
        if (token !== loadToken) return;
        if (id !== DEFAULT_CHARACTER) {
          shown = null;
          show(DEFAULT_CHARACTER);
        }
      });
  }

  function poseAction(which: Pose): AnimationAction {
    if (!actions) throw new Error('avatar actions are not ready');
    return which === 'air' ? (actions.air ?? actions.idle) : actions[which];
  }

  /**
   * Gait playback rate from the ground speed each clip was animated for and the fit scale,
   * so the planted foot moves with the floor. Clips with no measured stride keep the rate `playClip` set.
   */
  function retime(): void {
    if (!actions || !model) return;
    const scale = model.scale.y;
    for (const gait of ['walk', 'run'] as const) {
      const action = actions[gait];
      const ground = groundSpeedOf(action.getClip()) * scale;
      if (!(ground > 0)) continue;
      const actual = gait === 'run' ? SPRINT_SPEED : WALK_SPEED;
      action.timeScale = MathUtils.clamp(actual / ground, TIME_SCALE_MIN, TIME_SCALE_MAX);
    }
  }

  function blendTime(from: Pose, to: Pose): number {
    if (to === 'air') return AIR_BLEND.takeoff;
    if (from === 'air') return AIR_BLEND.land;
    if (from === 'idle') return AVATAR_BLEND.idleToMove;
    if (to === 'idle') return AVATAR_BLEND.moveToIdle;
    return to === 'run' ? AVATAR_BLEND.jogToDash : AVATAR_BLEND.dashToJog;
  }

  function update(dt: number, moving: boolean, sprint: boolean, air?: AvatarAir): void {
    if (!mixer || !actions) return;
    const flight = air?.flight ?? { dt, airborne: air?.airborne ?? false };
    const recover = hasBackflip && pose === 'air' && !flight.airborne && flightTurn.needsRecovery;
    const flightPhase = hasBackflip ? flightTurn.update(flight, air?.vy ?? 0) : null;
    const gait: Gait = !moving ? 'idle' : sprint ? 'run' : 'walk';
    const airborne = hasBackflip && flightTurn.launched ? flight.airborne : air?.airborne;
    const next: Pose = airborne && actions.air ? 'air' : gait;
    if (next !== pose) {
      const from = poseAction(pose);
      const to = poseAction(next);
      if (from !== to) {
        to.reset();
        // jog ↔ dash: keep the step phase (both clips put the left foot down at t = 0)
        if ((pose === 'walk' || pose === 'run') && (next === 'walk' || next === 'run')) {
          to.time = (from.time / from.getClip().duration) * to.getClip().duration;
        }
        to.setEffectiveWeight(1).play();
        from.crossFadeTo(to, blendTime(pose, next), false);
      }
      pose = next;
    }
    if (recover && actions.air) {
      // A coarse remote update can jump straight from mid-turn to contact.
      // The landing blend should start with the feet facing the floor.
      actions.air.time = AIR_WINDOW[1] * actions.air.getClip().duration;
    } else if (pose === 'air' && actions.air) {
      // Most jump clips scrub by vertical velocity. Flying Midget's full turn
      // needs continuous progress even when a remote's reported speed steps.
      const clip = actions.air.getClip();
      const phase = flightPhase ?? MathUtils.clamp((MOVEMENT.jump - (air?.vy ?? 0)) / (2 * MOVEMENT.jump), 0, 1);
      actions.air.time = (AIR_WINDOW[0] + phase * (AIR_WINDOW[1] - AIR_WINDOW[0])) * clip.duration;
    }
    mixer.update(dt);
    bootSupport?.(dt, !(air?.flight?.airborne ?? air?.airborne));
  }

  /** Roll into turns while moving, from the yaw the owner set on `group` this frame. */
  function bankInto(dt: number, moving: boolean, sprint: boolean): void {
    const yaw = group.rotation.y;
    let step = lastYaw === null ? 0 : yaw - lastYaw;
    lastYaw = yaw;
    step = Math.atan2(Math.sin(step), Math.cos(step));
    if (Math.abs(step) > BANK_SNAP) step = 0;
    const rate = dt > 0 ? step / dt : 0;
    const speed = moving ? (sprint ? 1 : 0.55) : 0;
    const target = MathUtils.clamp(rate * BANK_GAIN * speed, -BANK_MAX, BANK_MAX);
    bank = MathUtils.damp(bank, target, 8, dt);
    lean.rotation.z = bank;
  }

  function setStaff(id: StaffId): void {
    if (id === staffWanted) return;
    staffWanted = id;
    unmountStaff();
    const staff = STAFFS.find((entry) => entry.id === id);
    if (!staff?.asset) return;
    if (staffLoaded?.id === id) {
      mountStaff();
      return;
    }
    const token = ++staffToken;
    void loadGLTF(`${import.meta.env.BASE_URL}${staff.asset}`)
      .then((gltf) => {
        if (token !== staffToken) return;
        staffLoaded = { id, scene: gltf.scene, animations: gltf.animations };
        mountStaff();
      })
      .catch((error: unknown) => {
        console.error(`[hub] ${staff.label} failed to load`, error);
      });
  }

  function mountStaff(): void {
    unmountStaff();
    if (!socket || !staffLoaded || staffLoaded.id !== staffWanted) return;
    if (shown && !holdsStaff(characterById(shown))) return;
    const prop = staffLoaded.scene.clone(true);
    prop.traverse((obj) => {
      const mesh = obj as Mesh;
      if (mesh.isMesh) mesh.frustumCulled = false;
    });
    socket.add(prop);
    staffObject = prop;
    const idle = staffLoaded.animations.find((clip) => clip.name.endsWith('_idle')) ?? staffLoaded.animations[0];
    if (idle) {
      staffMixer = new AnimationMixer(prop);
      staffMixer.clipAction(idle).play();
    }
  }

  function unmountStaff(): void {
    staffMixer?.stopAllAction();
    staffMixer = null;
    staffObject?.removeFromParent();
    staffObject = null;
  }

  function setLook(next: AvatarLook): void {
    look = next;
    setStaff(next.staff);
    if (started) show(next.character);
    const socket = RELICS.find((entry) => entry.id === next.aura);
    aura.group.visible = Boolean(socket);
    if (socket) aura.setColor(socket.color);
  }

  function tick(dt: number, moving: boolean, sprint: boolean, air?: AvatarAir): void {
    if (aura.group.visible) {
      auraClock += dt;
      aura.ring.rotation.z += dt * 0.9;
      const pulse = 0.5 + 0.5 * Math.sin(auraClock * 2.6);
      aura.ringMat.opacity = 0.55 + pulse * 0.35;
      aura.columnMat.opacity = 0.22 + pulse * 0.16;
    }
    bankInto(dt, moving && !air?.airborne, sprint);
    update(dt, moving, sprint, air);
    staffMixer?.update(dt);
    if (staffObject && socket?.userData.upright && model) holdUpright(socket, model);
  }

  return { group, load, update: tick, setLook };
}

const holdHand = new Quaternion();
const holdBody = new Quaternion();

/** Generated sockets follow the fist but stay upright and facing the body's front. */
function holdUpright(socket: Object3D, model: Object3D): void {
  const hand = socket.parent;
  if (!hand) return;
  hand.getWorldQuaternion(holdHand);
  model.getWorldQuaternion(holdBody);
  socket.quaternion.copy(holdHand.invert()).multiply(holdBody);
}

const handAt = new Vector3();
const forearmAt = new Vector3();
const socketWorld = new Matrix4();
const handInverse = new Matrix4();
const socketQuat = new Quaternion();
const socketScale = new Vector3();

/**
 * The wizard rig ships `socket_staff` under RightHand. The boss rigs share the
 * skeleton names but not bone axes, so their socket is built the same way the
 * wizard's was authored: at the right fist in the rest pose, staff upright
 * (+Y) and facing the character's front (+Z).
 */
function staffSocket(model: Object3D, scale: number): Object3D | null {
  const authored = model.getObjectByName('socket_staff');
  if (authored) return authored;
  const hand = model.getObjectByName('RightHand')
    ?? model.getObjectByName('mixamorigRightHand')
    ?? model.getObjectByName('R_Hand');
  const forearm = hand?.parent;
  if (!hand || !forearm) return null;
  model.updateMatrixWorld(true);
  hand.getWorldPosition(handAt);
  forearm.getWorldPosition(forearmAt);
  const reach = handAt.distanceTo(forearmAt);
  // Fist centre: a little past the wrist, along the forearm.
  if (reach > 1e-4) handAt.addScaledVector(forearmAt.sub(handAt).multiplyScalar(-1 / reach), reach * 0.3);
  model.getWorldQuaternion(socketQuat);
  // Source rigs are in metres, so one staff metre is the fit scale (as on the authored wizard socket).
  socketScale.setScalar(model.scale.y * scale);
  socketWorld.compose(handAt, socketQuat, socketScale);
  handInverse.copy(hand.matrixWorld).invert();
  const socket = new Object3D();
  socket.name = 'socket_staff';
  // The mocap turns each rig's wrist differently; `holdUpright` keeps this one vertical.
  socket.userData.upright = true;
  socketWorld.premultiply(handInverse);
  socketWorld.decompose(socket.position, socket.quaternion, socket.scale);
  hand.add(socket);
  return socket;
}

/** Frees this copy's skeleton. Geometry, materials and textures stay in the GLTF cache. */
function disposeModel(root: Object3D): void {
  root.removeFromParent();
  root.traverse((obj) => {
    const mesh = obj as SkinnedMesh;
    if (mesh.isSkinnedMesh) mesh.skeleton.dispose();
  });
}

/** Spinning floor ring plus a soft column. Two draw calls, shown only with a Relic aura. */
function createAura(): {
  group: Group;
  ring: Mesh;
  ringMat: MeshBasicMaterial;
  columnMat: MeshBasicMaterial;
  setColor: (color: string) => void;
} {
  const group = new Group();
  group.name = 'relic-aura';
  group.visible = false;
  const ringMat = new MeshBasicMaterial({
    map: ringTexture(),
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    toneMapped: false,
  });
  const ring = new Mesh(new RingGeometry(0.55, 1.05, 48, 1), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -STAND_Y + 0.05;
  ring.renderOrder = 2;
  const columnMat = new MeshBasicMaterial({
    map: columnTexture(),
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    toneMapped: false,
  });
  const columnHeight = AVATAR_HEIGHT * 1.1;
  const column = new Mesh(new CylinderGeometry(0.62, 0.78, columnHeight, 32, 1, true), columnMat);
  column.position.y = -STAND_Y + columnHeight / 2;
  column.renderOrder = 2;
  group.add(ring, column);
  return {
    group,
    ring,
    ringMat,
    columnMat,
    setColor(color: string) {
      ringMat.color.set(color);
      columnMat.color.set(color);
    },
  };
}

function ringTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const c = 128;
    const fade = ctx.createRadialGradient(c, c, 60, c, c, 128);
    fade.addColorStop(0, 'rgba(255,255,255,0)');
    fade.addColorStop(0.55, 'rgba(255,255,255,0.9)');
    fade.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, 256, 256);
    // Rune ticks so the spin reads.
    ctx.fillStyle = 'rgba(255,255,255,1)';
    for (let i = 0; i < 12; i += 1) {
      const a = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(c + Math.cos(a) * 100, c + Math.sin(a) * 100, i % 3 === 0 ? 5 : 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function columnTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const fade = ctx.createLinearGradient(0, 0, 0, 128);
    fade.addColorStop(0, 'rgba(255,255,255,0)');
    fade.addColorStop(1, 'rgba(255,255,255,0.7)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, 4, 128);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/**
 * Resolve idle / walk / run. The wizard carries P4's `jog` and `dash`, and the Sproto Duel rigs get them retargeted.
 * The jade dragon has a hover `idle`, a cruise `walk` and a fast `run`; `fly` is the fallback for older rigs. The
 * Sproto Shooter cast hides its `walk` here (`walksWithRun`), so both gaits play `run`.
 */
const GAIT_CLIP_NAMES: Record<keyof typeof AVATAR_CLIPS, readonly string[]> = {
  idle: ['idle', 'fly'],
  walk: ['jog', 'walk', 'run', 'fly'],
  run: ['dash', 'run', 'walk', 'fly'],
};

function claimClip(clip: AnimationClip, gait: string, claimed: WeakSet<AnimationClip>): AnimationClip {
  if (!claimed.has(clip)) {
    claimed.add(clip);
    return clip;
  }
  const copy = clip.clone();
  copy.name = gait;
  return copy;
}

/**
 * One frame of a locomotion clip, held. Used when a rig has a walk and no idle
 * (Blue Monster, Sproto Beast) so standing still is a planted pose, not a T-pose.
 */
function holdPose(source: AnimationClip): AnimationClip {
  const tracks = source.tracks.map((track) => {
    const size = track.getValueSize();
    const values = new Float32Array(size * 2);
    for (let i = 0; i < size; i += 1) {
      const sample = track.values[i] ?? 0;
      values[i] = sample;
      values[size + i] = sample;
    }
    const Track = track.constructor as new (name: string, times: Float32Array, values: Float32Array) => AnimationClip['tracks'][number];
    return new Track(track.name, new Float32Array([0, 1]), values);
  });
  return new AnimationClip('idle', 1, tracks);
}

function requiredClip(
  clips: readonly AnimationClip[],
  gait: keyof typeof AVATAR_CLIPS,
  claimed: WeakSet<AnimationClip>,
): AnimationClip {
  const found = GAIT_CLIP_NAMES[gait]
    .map((name) => clips.find((clip) => clip.name === name))
    .find((clip): clip is AnimationClip => Boolean(clip));
  if (found) return claimClip(found, gait, claimed);
  if (gait === 'idle') {
    const move = clips.find((clip) => clip.name === 'walk' || clip.name === 'run' || clip.name === 'jog');
    if (move) return holdPose(move);
  }
  throw new Error(`Avatar is missing the ${GAIT_CLIP_NAMES[gait][0]} clip (${gait})`);
}

/** Gait actions. Clips with a measured stride get their walk / run rate from `retime` once the fit is known. */
function playClip(
  mixer: AnimationMixer,
  clips: readonly AnimationClip[],
  gait: keyof typeof AVATAR_CLIPS,
  claimed: WeakSet<AnimationClip>,
): AnimationAction {
  const clip = requiredClip(clips, gait, claimed);
  const action = mixer.clipAction(clip);
  // Gait clips carry their authored ground speed; scale playback to the controller speed.
  const authored = Number((clip.userData as { speed_mps?: number }).speed_mps);
  const actual = gait === 'run' ? SPRINT_SPEED : gait === 'walk' ? WALK_SPEED : 0;
  action.timeScale = authored > 0 && actual > 0 ? actual / authored : AVATAR_CLIPS[gait].timeScale;
  // The dragon's idle is its fly clip (the clones used for walking are renamed). Keep the hover calm.
  if (clip.name === 'fly' && !(authored > 0)) action.timeScale = 0.45;
  return action;
}

/** The jump clip, held still: `update` scrubs it by vertical velocity. Null when the rig has none. */
function airClip(mixer: AnimationMixer, clips: readonly AnimationClip[]): AnimationAction | null {
  const clip = clips.find((entry) => entry.name === 'jump');
  if (!clip) return null;
  const action = mixer.clipAction(clip);
  action.timeScale = 0;
  return action;
}

/**
 * Height-fit a clone. Props held in the hands (staff, phone, vape) stay in the mesh and are left out of the bounds.
 * A creature much longer than it is tall (the dragon, the mole) is scaled down so its longest side stays near the
 * plaza height instead of stretching across a doorway.
 */
function fitModel(model: Group, height: number, yaw: number): Object3D {
  model.rotation.y = yaw;
  model.updateMatrixWorld(true);
  const body = bodySpan(model);
  if (body.height < 0.2 || body.height > 20) {
    throw new Error(`Avatar body height is implausible (${body.height.toFixed(3)} m)`);
  }
  let scale = height / body.height;
  const long = Math.max(body.maxX - body.minX, body.maxZ - body.minZ);
  // A creature much longer than the plaza body (dragon, mole) would otherwise span a doorway.
  if (long * scale > height * 1.65) scale = (height * 1.65) / long;
  model.scale.setScalar(scale);
  model.updateMatrixWorld(true);
  const fitted = bodySpan(model);
  // Feet on the ground, body over the capsule. A mesh whose origin sits at one end would otherwise orbit it.
  model.position.set(-(fitted.minX + fitted.maxX) / 2, -STAND_Y - fitted.minY, -(fitted.minZ + fitted.maxZ) / 2);
  model.traverse((obj) => {
    const mesh = obj as Mesh;
    if (mesh.isMesh) mesh.frustumCulled = false;
  });
  return model;
}

/** Staffs and props are skinned to the hands and can reach above the head. */
const STAFF_BONES = new Set([
  'LeftHand', 'RightHand',
  'mixamorigLeftHand', 'mixamorigRightHand',
  'L_Hand', 'R_Hand',
]);

/**
 * Vertical span of the skinned body. Hand-weighted vertices are the baked
 * staff, so they do not set the fit. Raw positions are a quantized bind pose
 * and only land on the body after the joints run.
 */
function bodySpan(root: Object3D): { minY: number; height: number; minX: number; maxX: number; minZ: number; maxZ: number } {
  root.updateMatrixWorld(true);
  let minY = Infinity;
  let maxY = -Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let found = false;
  root.traverse((obj) => {
    const mesh = obj as SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const position = mesh.geometry.getAttribute('position');
    const skinIndex = mesh.geometry.getAttribute('skinIndex');
    const skinWeight = mesh.geometry.getAttribute('skinWeight');
    if (!position || !skinIndex || !skinWeight) return;
    mesh.skeleton.update();
    const bones = mesh.skeleton.boneMatrices;
    const names = mesh.skeleton.bones.map((entry) => entry.name);
    if (!bones) return;
    for (let i = 0; i < position.count; i += 1) {
      let strongest = 0;
      let boneIndex = 0;
      for (let k = 0; k < skinWeight.itemSize; k += 1) {
        const weight = skinWeight.getComponent(i, k);
        if (weight > strongest) {
          strongest = weight;
          boneIndex = skinIndex.getComponent(i, k);
        }
      }
      if (STAFF_BONES.has(names[boneIndex] ?? '')) continue;
      bindVertex.set(position.getX(i), position.getY(i), position.getZ(i), 1);
      bindVertex.applyMatrix4(mesh.bindMatrix);
      skinned.set(0, 0, 0, 0);
      for (let k = 0; k < skinWeight.itemSize; k += 1) {
        const weight = skinWeight.getComponent(i, k);
        if (weight === 0) continue;
        bone.fromArray(bones, skinIndex.getComponent(i, k) * 16);
        weighted.copy(bindVertex).applyMatrix4(bone);
        skinned.addScaledVector(weighted, weight);
      }
      skinned.applyMatrix4(mesh.bindMatrixInverse);
      point.set(skinned.x, skinned.y, skinned.z).applyMatrix4(mesh.matrixWorld);
      if (point.x < minX) minX = point.x;
      if (point.x > maxX) maxX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.y > maxY) maxY = point.y;
      if (point.z < minZ) minZ = point.z;
      if (point.z > maxZ) maxZ = point.z;
      found = true;
    }
  });
  if (!found) {
    const box = new Box3().setFromObject(root);
    return { minY: box.min.y, height: box.getSize(size).y, minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z };
  }
  return { minY, height: maxY - minY, minX, maxX, minZ, maxZ };
}
