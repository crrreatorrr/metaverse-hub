// Gait tools for the humanoid avatars. Pure three.js (no DOM), so the unit test runs them on the shipped GLBs.
//
// - `retargetClip` moves a clip between rigs that share bone names but not bone axes or proportions (the
//   wizard and the Sproto Duel boss rigs). Each bone keeps the source's world-space rotation away from its
//   own rest pose, and the hips travel scales with hip height.
// - `measureGroundSpeed` finds how fast a planted foot slides backwards in an in-place loop. That is the
//   ground speed the clip was animated for, so `actual / measured` is the time scale that keeps feet planted.
import {
  AnimationClip,
  AnimationMixer,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack,
  type KeyframeTrack,
  type Object3D,
} from 'three';

/** Bones the retarget drives. The hips also carry translation. */
const HIPS = 'Hips';
/** Contact points for the planted-foot measurement, toe first (the toe stays down longest in a run). */
export const FOOT_BONES = ['LeftToeBase', 'RightToeBase'] as const;

/** Bake rate for retargeted clips. The P4 gait clips are short loops, so 60 fps stays small. */
const BAKE_FPS = 60;

interface RestBone {
  name: string;
  source: Object3D;
  target: Object3D;
  sourceRest: Quaternion;
  targetRest: Quaternion;
}

const q = new Quaternion();
const hipsWorld = new Vector3();
const parentWorld = new Quaternion();
const v = new Vector3();

function worldQuat(obj: Object3D, out: Quaternion): Quaternion {
  return obj.getWorldQuaternion(out);
}

/** Bones of `root` keyed by name. */
function bonesByName(root: Object3D): Map<string, Object3D> {
  const found = new Map<string, Object3D>();
  root.traverse((obj) => {
    if ((obj as { isBone?: boolean }).isBone && !found.has(obj.name)) found.set(obj.name, obj);
  });
  return found;
}

/** Depth-first order, so a parent's world pose is set before its children read it. */
function inHierarchyOrder(root: Object3D, names: ReadonlySet<string>): string[] {
  const order: string[] = [];
  root.traverse((obj) => {
    if ((obj as { isBone?: boolean }).isBone && names.has(obj.name) && !order.includes(obj.name)) order.push(obj.name);
  });
  return order;
}

/**
 * Bake `clip` (authored on `sourceRoot`) onto `targetRoot`. Both roots must be in their rest pose and must
 * not be shared with anything on screen: the source is posed while baking. Pass clones.
 *
 * The result loops like the source and keeps its `userData`, minus `speed_mps`, which belongs to the source's
 * proportions; measure the target with `measureGroundSpeed`.
 */
export function retargetClip(sourceRoot: Object3D, clip: AnimationClip, targetRoot: Object3D): AnimationClip {
  sourceRoot.updateMatrixWorld(true);
  targetRoot.updateMatrixWorld(true);
  const sourceBones = bonesByName(sourceRoot);
  const targetBones = bonesByName(targetRoot);
  const animated = new Set<string>();
  for (const track of clip.tracks) {
    const name = track.name.slice(0, track.name.lastIndexOf('.'));
    if (sourceBones.has(name) && targetBones.has(name)) animated.add(name);
  }
  const order = inHierarchyOrder(targetRoot, animated);
  const bones: RestBone[] = order.map((name) => {
    const source = sourceBones.get(name)!;
    const target = targetBones.get(name)!;
    return {
      name,
      source,
      target,
      sourceRest: worldQuat(source, new Quaternion()),
      targetRest: worldQuat(target, new Quaternion()),
    };
  });

  const sourceHips = sourceBones.get(HIPS);
  const targetHips = targetBones.get(HIPS);
  const sourceHipsRest = sourceHips ? sourceHips.getWorldPosition(new Vector3()) : null;
  const targetHipsRest = targetHips ? targetHips.getWorldPosition(new Vector3()) : null;
  // Hips height above the lowest foot in the rest pose: the leg length the hips travel scales with.
  const sourceLeg = hipHeight(sourceRoot, sourceBones);
  const legRatio = sourceLeg > 1e-6 ? hipHeight(targetRoot, targetBones) / sourceLeg : 1;
  // Floor contact: the target's lowest toe follows the source's, scaled to its legs. Different rest poses put
  // the same rotations at different leg extensions, so without this the feet sink into the floor.
  const sourceToes = FOOT_BONES.map((name) => sourceBones.get(name)).filter((bone): bone is Object3D => Boolean(bone));
  const targetToes = FOOT_BONES.map((name) => targetBones.get(name)).filter((bone): bone is Object3D => Boolean(bone));
  const sourceFloor = lowestY(sourceToes);
  const targetFloor = lowestY(targetToes);
  const hipsTranslated = clip.tracks.some((track) => track.name === `${HIPS}.position`);

  const frames = Math.max(2, Math.round(clip.duration * BAKE_FPS) + 1);
  const times = new Float32Array(frames);
  const rotations = new Map<string, Float32Array>(bones.map((bone) => [bone.name, new Float32Array(frames * 4)]));
  const hipsPositions = hipsTranslated && targetHips ? new Float32Array(frames * 3) : null;

  // Target world rotations for this frame, filled parent-first. Bones the clip does not drive keep their
  // local rest rotation under a moving parent.
  const targetWorld = new Map<string, Quaternion>([...targetBones.keys()].map((name) => [name, new Quaternion()]));
  const solveOrder = inHierarchyOrder(targetRoot, new Set(targetBones.keys()));
  const byName = new Map(bones.map((bone) => [bone.name, bone]));
  const delta = new Quaternion();
  const restInverse = new Quaternion();
  const mixer = new AnimationMixer(sourceRoot);
  const action = mixer.clipAction(clip);
  action.play();

  for (let frame = 0; frame < frames; frame += 1) {
    const t = frame === frames - 1 ? clip.duration : (frame / (frames - 1)) * clip.duration;
    times[frame] = t;
    mixer.setTime(t);
    sourceRoot.updateMatrixWorld(true);
    for (const name of solveOrder) {
      const target = targetBones.get(name)!;
      // Parent world: a solved bone this frame, or the static (non-bone) parent.
      const parent = target.parent;
      const solvedParent = parent && targetBones.get(parent.name) === parent ? targetWorld.get(parent.name) : undefined;
      if (solvedParent) parentWorld.copy(solvedParent);
      else if (parent) parent.getWorldQuaternion(parentWorld);
      else parentWorld.identity();
      const world = targetWorld.get(name)!;
      const bone = byName.get(name);
      if (!bone) {
        world.copy(parentWorld).multiply(target.quaternion);
        continue;
      }
      // World-space change from rest on the source, applied to the target's rest.
      worldQuat(bone.source, delta).multiply(restInverse.copy(bone.sourceRest).invert());
      world.copy(delta).multiply(bone.targetRest);
      q.copy(parentWorld).invert().multiply(world);
      const out = rotations.get(bone.name)!;
      // Keep neighbouring keys in the same hemisphere so the slerp takes the short way.
      if (frame > 0) {
        const o = (frame - 1) * 4;
        const dot = out[o]! * q.x + out[o + 1]! * q.y + out[o + 2]! * q.z + out[o + 3]! * q.w;
        if (dot < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      }
      q.toArray(out, frame * 4);
    }
    if (hipsPositions && sourceHips && targetHips && sourceHipsRest && targetHipsRest) {
      // World offset of the source hips, scaled to the target's legs.
      sourceHips.getWorldPosition(hipsWorld).sub(sourceHipsRest).multiplyScalar(legRatio).add(targetHipsRest);
      if (sourceToes.length > 0 && targetToes.length > 0) {
        // Pose the target and lift or drop the hips until the lowest toe sits where the source's does.
        for (const bone of bones) bone.target.quaternion.fromArray(rotations.get(bone.name)!, frame * 4);
        placeInParent(targetHips, hipsWorld);
        targetRoot.updateMatrixWorld(true);
        const want = targetFloor + (lowestY(sourceToes) - sourceFloor) * legRatio;
        hipsWorld.y += want - lowestY(targetToes);
      }
      placeInParent(targetHips, hipsWorld).toArray(hipsPositions, frame * 3);
    }
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(sourceRoot);

  const tracks: KeyframeTrack[] = bones.map(
    (bone) => new QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, rotations.get(bone.name)!),
  );
  if (hipsPositions) tracks.push(new VectorKeyframeTrack(`${HIPS}.position`, times, hipsPositions));
  const baked = new AnimationClip(clip.name, clip.duration, tracks);
  const { speed_mps: _authored, ...rest } = (clip.userData ?? {}) as Record<string, unknown>;
  baked.userData = { ...rest, retargeted: true };
  return baked;
}

/** Lowest world Y among `bones` (matrices must be current). */
function lowestY(bones: readonly Object3D[]): number {
  let low = Infinity;
  for (const bone of bones) low = Math.min(low, bone.getWorldPosition(v).y);
  return low;
}

/** Sets `obj.position` so its world position is `world`. Returns the local position. */
function placeInParent(obj: Object3D, world: Vector3): Vector3 {
  obj.position.copy(world);
  if (obj.parent) obj.parent.worldToLocal(obj.position);
  return obj.position;
}

/** Hips height above the lower foot, in world units of the rest pose. */
function hipHeight(root: Object3D, bones: Map<string, Object3D>): number {
  root.updateMatrixWorld(true);
  const hips = bones.get(HIPS);
  if (!hips) return 0;
  const hipsY = hips.getWorldPosition(v).y;
  let footY = Infinity;
  for (const name of FOOT_BONES) {
    const foot = bones.get(name);
    if (foot) footY = Math.min(footY, foot.getWorldPosition(v).y);
  }
  return Number.isFinite(footY) ? hipsY - footY : 0;
}

/**
 * Ground speed an in-place loop was animated for, in `root`'s world units per second along its +Z forward.
 * A foot counts as planted while it sits within `contact` of its lowest point; the median backward speed of
 * planted feet is the answer. Returns 0 when the clip has no clear contact (idle, jump).
 *
 * `root` is posed while measuring: pass a clone that is not on screen.
 */
export function measureGroundSpeed(root: Object3D, clip: AnimationClip, samples = 240): number {
  const bones = bonesByName(root);
  const feet = FOOT_BONES.map((name) => bones.get(name)).filter((bone): bone is Object3D => Boolean(bone));
  if (feet.length === 0 || clip.duration <= 0) return 0;
  const mixer = new AnimationMixer(root);
  mixer.clipAction(clip).play();
  const ys: number[][] = feet.map(() => []);
  const zs: number[][] = feet.map(() => []);
  for (let i = 0; i <= samples; i += 1) {
    mixer.setTime((clip.duration * i) / samples);
    root.updateMatrixWorld(true);
    feet.forEach((foot, k) => {
      foot.getWorldPosition(v);
      ys[k]!.push(v.y);
      zs[k]!.push(v.z);
    });
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(root);
  // Contact band: a few percent of the hips height, so it works for the Midget and the tall rigs alike.
  const contact = Math.max(1e-4, hipHeight(root, bones) * 0.03);
  const dt = clip.duration / samples;
  const speeds: number[] = [];
  feet.forEach((_, k) => {
    const y = ys[k]!;
    const z = zs[k]!;
    const low = Math.min(...y);
    for (let i = 0; i < samples; i += 1) {
      if (y[i]! < low + contact && y[i + 1]! < low + contact) speeds.push(-(z[i + 1]! - z[i]!) / dt);
    }
  });
  if (speeds.length < samples * 0.1) return 0;
  speeds.sort((a, b) => a - b);
  const median = speeds[Math.floor(speeds.length / 2)]!;
  return median > 0 ? median : 0;
}
