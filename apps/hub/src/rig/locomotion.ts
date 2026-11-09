// Gait clips for every pickable character. The wizard ships P4's `jog` and `dash`; the Sproto Duel boss
// rigs only have a short `run`, which at plaza speeds (7.8 and 16 m/s) plays far too slowly and the feet
// skate. Rigs without P4 clips get the wizard's, retargeted, and every gait clip is tagged with the ground
// speed it was animated for, so the avatar can scale playback to keep the planted foot still.
import type { AnimationClip, Object3D } from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { measureGroundSpeed, retargetClip } from './gait';

/** P4 gait clips the donor rig (the wizard) carries. */
export const P4_CLIPS = ['jog', 'dash'] as const;
/** Clips that move the feet, measured for `ground_speed`. */
const GAIT_CLIPS = new Set(['jog', 'dash', 'run']);

export interface RigSource {
  scene: Object3D;
  animations: AnimationClip[];
}

/** `clip.userData.ground_speed`: metres per second in the GLB's own units, before the avatar fit. */
export function groundSpeedOf(clip: AnimationClip): number {
  const speed = Number((clip.userData as { ground_speed?: unknown }).ground_speed);
  return Number.isFinite(speed) && speed > 0 ? speed : 0;
}

/**
 * The rig's clips plus any P4 clips it lacks, retargeted from `donor`. Gait clips carry `ground_speed`.
 * Source clips are tagged in place (the tag is a pure function of the clip, so sharing is safe).
 */
export function buildLocomotion(rig: RigSource, donor: RigSource | null): AnimationClip[] {
  const clips = [...rig.animations];
  if (donor && donor !== rig) {
    for (const name of P4_CLIPS) {
      if (clips.some((clip) => clip.name === name)) continue;
      const source = donor.animations.find((clip) => clip.name === name);
      if (!source) continue;
      // Clones: the bake poses both skeletons, and the originals are shared through the GLTF cache.
      clips.push(retargetClip(SkeletonUtils.clone(donor.scene), source, SkeletonUtils.clone(rig.scene)));
    }
  }
  const probe = SkeletonUtils.clone(rig.scene);
  for (const clip of clips) {
    if (!GAIT_CLIPS.has(clip.name) || groundSpeedOf(clip) > 0) continue;
    const speed = measureGroundSpeed(probe, clip);
    if (speed > 0) clip.userData = { ...clip.userData, ground_speed: speed };
  }
  return clips;
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
