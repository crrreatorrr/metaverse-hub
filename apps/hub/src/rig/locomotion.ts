// Gait clips for the characters on the wizard's skeleton. The wizard ships P4's `jog` and `dash`; the Sproto
// Duel cast only has a short `run`, which at plaza speeds (7.8 and 16 m/s) plays far too slowly and the feet
// skate. Those rigs get the wizard's clips, retargeted. Every gait clip, on any skeleton, is tagged with the
// ground speed it was animated for, so the avatar can scale playback to keep the planted foot still. Other
// skeletons (the Mixamo shooter cast, the beast, the dragon) keep their own clips and are only measured.
import type { AnimationClip, Object3D } from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { lowestToe, measureGroundSpeed, retargetClip } from './gait';

/** P4 gait clips the donor rig (the wizard) carries. */
export const P4_CLIPS = ['jog', 'dash'] as const;
/** Bones a rig must share with the wizard to take its clips: the retarget matches bones by name. */
const WIZARD_SKELETON = ['Hips', 'Spine', 'Head', 'LeftArm', 'RightArm', 'LeftUpLeg', 'RightUpLeg', 'LeftToeBase', 'RightToeBase'];
/** Clips that move the feet, measured for `ground_speed`. */
const GAIT_CLIPS = new Set(['jog', 'dash', 'run', 'walk', 'walk_slow']);

export interface RigSource {
  scene: Object3D;
  animations: AnimationClip[];
}

/** `clip.userData.ground_speed`: metres per second in the GLB's own units, before the avatar fit. */
export function groundSpeedOf(clip: AnimationClip): number {
  const speed = Number((clip.userData as { ground_speed?: unknown }).ground_speed);
  return Number.isFinite(speed) && speed > 0 ? speed : 0;
}

/** True when `root` has the wizard's bone names, so the retarget and the foot measurement apply. */
export function onWizardSkeleton(root: Object3D): boolean {
  const names = new Set<string>();
  root.traverse((obj) => {
    if ((obj as { isBone?: boolean }).isBone) names.add(obj.name);
  });
  return WIZARD_SKELETON.every((name) => names.has(name));
}

/**
 * The rig's clips plus any P4 clips it lacks, retargeted from `donor`. Gait clips carry `ground_speed`.
 * Source clips are tagged in place (the tag is a pure function of the clip, so sharing is safe).
 * A rig on another skeleton comes back with its own clips, measured but not retargeted.
 */
export function buildLocomotion(rig: RigSource, donor: RigSource | null): AnimationClip[] {
  if (!onWizardSkeleton(rig.scene)) {
    tagGroundSpeed(rig.scene, rig.animations);
    return rig.animations;
  }
  const clips = [...rig.animations];
  let floors: { source: number; target: number } | undefined;
  if (donor && donor !== rig && onWizardSkeleton(donor.scene)) {
    for (const name of P4_CLIPS) {
      if (clips.some((clip) => clip.name === name)) continue;
      const source = donor.animations.find((clip) => clip.name === name);
      if (!source) continue;
      // Clones: the bake poses both skeletons, and the originals are shared through the GLTF cache.
      clips.push(retargetClip(SkeletonUtils.clone(donor.scene), source, SkeletonUtils.clone(rig.scene), floors ??= idleFloors(rig, donor)));
    }
  }
  tagGroundSpeed(rig.scene, clips);
  return clips;
}

/** Tags each gait clip with the planted-foot speed it was animated for. Clips with no clear foot contact stay untagged. */
function tagGroundSpeed(scene: Object3D, clips: readonly AnimationClip[]): void {
  const probe = SkeletonUtils.clone(scene);
  for (const clip of clips) {
    if (!GAIT_CLIPS.has(clip.name) || groundSpeedOf(clip) > 0) continue;
    const speed = measureGroundSpeed(probe, clip);
    if (speed > 0) clip.userData = { ...clip.userData, ground_speed: speed };
  }
}

/**
 * Where each rig's toes rest in its own idle, so retargeted gaits stand at the same height as the idle they
 * crossfade with. Undefined (rest pose) when either rig has no idle.
 */
function idleFloors(rig: RigSource, donor: RigSource): { source: number; target: number } | undefined {
  const rigIdle = rig.animations.find((clip) => clip.name === 'idle');
  const donorIdle = donor.animations.find((clip) => clip.name === 'idle');
  if (!rigIdle || !donorIdle) return undefined;
  const source = lowestToe(SkeletonUtils.clone(donor.scene), donorIdle);
  const target = lowestToe(SkeletonUtils.clone(rig.scene), rigIdle);
  return source === null || target === null ? undefined : { source, target };
}

const cache = new Map<string, Promise<AnimationClip[]>>();

/**
 * Cached `buildLocomotion` per character asset, so the local avatar and every remote copy share one bake.
 * A donor that fails to load leaves the rig on its own clips.
 */
export function locomotionFor(
  asset: string,
  rig: RigSource,
  loadDonor: () => Promise<RigSource>,
): Promise<AnimationClip[]> {
  const existing = cache.get(asset);
  if (existing) return existing;
  if (!onWizardSkeleton(rig.scene)) {
    const own = Promise.resolve(buildLocomotion(rig, null));
    cache.set(asset, own);
    return own;
  }
  const needsDonor = P4_CLIPS.some((name) => !rig.animations.some((clip) => clip.name === name));
  const donor = needsDonor
    ? loadDonor().catch((error: unknown) => {
        console.warn(`[hub] ${asset}: gait donor failed to load, keeping the rig's own clips`, error);
        return null;
      })
    : Promise.resolve(null);
  const pending = donor.then((loaded) => buildLocomotion(rig, loaded));
  cache.set(asset, pending);
  return pending;
}
