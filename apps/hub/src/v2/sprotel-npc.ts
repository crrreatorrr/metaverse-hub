import {
  AnimationMixer, Euler, LoopOnce, MathUtils, Quaternion, Vector3,
  type AnimationAction, type AnimationClip, type Object3D,
} from 'three';
import meta from './sprotel.meta.json';

/**
 * Sprotel Bitcoin, the Club barman / Verse store NPC (hub-world/sprotel/drop-for-tech, final v4).
 * Store trigger, greet on approach, talk while the store is open, additive head-aim at the nearest player.
 *
 * Numbers come from npc_sprotel_bitcoin.meta.json (the source of truth). The GLB's own `interact` extra
 * still says 2.7 m; meta says 2.5 m, so the GLB extra is deliberately ignored here.
 * His clips (idle, greet, talk, wipe_glass) are native to his skeleton and are played directly. Hub avatar
 * clips are NOT shared; if that is ever needed, go through SkeletonUtils.retargetClip, never copy tracks.
 */
const EXTRAS = meta['npc_sprotel_bitcoin.glb'].extras;
export const SPROTEL_INTERACT_RADIUS: number = EXTRAS.interact.radius;
export const SPROTEL_PROMPT: string = EXTRAS.interact.prompt;
const LOOK = EXTRAS.lookAt;
const YAW_LIMIT = MathUtils.degToRad(LOOK.yawLimitDeg);
const PITCH_UP = MathUtils.degToRad(LOOK.pitchUpDeg);
const PITCH_DOWN = MathUtils.degToRad(LOOK.pitchDownDeg);
const W_NECK = LOOK.weights[LOOK.bones.indexOf('neck')] ?? 0.35;
const W_HEAD = LOOK.weights[LOOK.bones.indexOf('Head')] ?? 0.65;
/** Player eye height above the rig origin used as the look target. */
const EYE_HEIGHT = 1.6;
const FADE = 0.3;

export type SprotelClip = 'idle' | 'greet' | 'talk' | 'wipe_glass';

export interface SprotelController {
  readonly root: Object3D;
  readonly mixer: AnimationMixer;
  readonly interactRadius: number;
  readonly prompt: string;
  /** True while the given player is inside the interact trigger (horizontal distance, metres). */
  readonly playerNear: boolean;
  /** Call once per frame while the Club is visible: ticks the mixer, then applies the head-aim. */
  update(dt: number, player: Vector3 | null, storeOpen: boolean): void;
}

export function createSprotelController(root: Object3D, clips: readonly AnimationClip[], restClip: SprotelClip = 'wipe_glass'): SprotelController {
  const mixer = new AnimationMixer(root);
  const find = (name: SprotelClip): AnimationAction | null => {
    const clip = clips.find((c) => c.name === name);
    return clip ? mixer.clipAction(clip) : null;
  };
  const idle = find('idle');
  const rest = find(restClip) ?? idle;
  const talk = find('talk');
  const greet = find('greet');
  if (greet) {
    greet.setLoop(LoopOnce, 1);
    greet.clampWhenFinished = false;
  }
  const loops = [idle, rest, talk].filter((a): a is AnimationAction => a !== null);
  let current: AnimationAction | null = rest;
  current?.play();

  function fade(to: AnimationAction | null): void {
    if (!to || to === current) return;
    for (const a of loops) if (a !== to) a.fadeOut(FADE);
    to.reset().fadeIn(FADE).play();
    current = to;
  }

  const head = root.getObjectByName('Head') ?? null;
  const neck = root.getObjectByName('neck') ?? null;
  const q = new Quaternion();
  const e = new Euler(0, 0, 0, 'YXZ');
  const v = new Vector3();
  let near = false;

  return {
    root,
    mixer,
    interactRadius: SPROTEL_INTERACT_RADIUS,
    prompt: SPROTEL_PROMPT,
    get playerNear() { return near; },
    update(dt, player, storeOpen) {
      mixer.update(dt);
      let inside = false;
      if (player) {
        root.updateWorldMatrix(true, false);
        root.worldToLocal(v.copy(player));
        inside = Math.hypot(v.x, v.z) < SPROTEL_INTERACT_RADIUS;
      }
      if (inside && !near && greet && !storeOpen) greet.reset().play();
      near = inside;
      if (storeOpen) fade(talk);
      else fade(near ? idle : rest);

      // Head-aim: additive on top of the clip pose, after the mixer. Limits and weights from meta.lookAt.
      if (player && near && head?.parent && neck) {
        head.parent.updateWorldMatrix(true, false);
        const local = head.parent.worldToLocal(v.set(player.x, player.y + EYE_HEIGHT, player.z)).sub(head.position);
        const yaw = MathUtils.clamp(Math.atan2(local.x, local.z), -YAW_LIMIT, YAW_LIMIT);
        const pitch = MathUtils.clamp(-Math.atan2(local.y, Math.hypot(local.x, local.z)), -PITCH_UP, PITCH_DOWN);
        e.set(pitch * W_HEAD, yaw * W_HEAD, 0);
        head.quaternion.multiply(q.setFromEuler(e));
        e.set(pitch * W_NECK, yaw * W_NECK, 0);
        neck.quaternion.multiply(q.setFromEuler(e));
      }
    },
  };
}
