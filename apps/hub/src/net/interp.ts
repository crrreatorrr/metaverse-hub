// Remote pose interpolation: render 150 ms in the past between the two samples
// that straddle that time. Yaw takes the short arc; a jump over 5 m snaps.
import { ANIMS, type Pose } from './protocol';

export const INTERP_DELAY_MS = 150;
export const SNAP_DISTANCE = 5;
const MAX_SAMPLES = 8;

interface Sample extends Pose { at: number }

export interface Interp {
  push(at: number, pose: Pose): void;
  /** Interpolated pose at `now - INTERP_DELAY_MS`, or null before the first sample. */
  sample(now: number, out: Pose): Pose | null;
  /** Milliseconds by which the render time has passed the newest snapshot. */
  poseHoldMs(now: number): number;
  /** Cadence for sparse centimetre steps. A new idle or a long gap ends the estimate. */
  slowGroundSpeed(now: number): number | undefined;
  latest(): Pose | null;
  clear(): void;
}

function isGroundMoving(anim: number): boolean {
  return ANIMS[anim] === 'walk' || ANIMS[anim] === 'run';
}

function shortArc(from: number, to: number, t: number): number {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return from + d * t;
}

export function createInterp(delayMs = INTERP_DELAY_MS): Interp {
  const samples: Sample[] = [];
  let groundStep: Sample | undefined;
  let groundCadence: { speed: number; expiresAt: number } | undefined;

  function resetGroundCadence(): void {
    groundStep = undefined;
    groundCadence = undefined;
  }

  return {
    push(at, pose) {
      const last = samples[samples.length - 1];
      if (last && Math.hypot(pose.x - last.x, pose.y - last.y, pose.z - last.z) > SNAP_DISTANCE) {
        samples.length = 0;
        resetGroundCadence();
      }
      const sample = { ...pose, at };
      if (!isGroundMoving(pose.anim)) resetGroundCadence();
      else if (!groundStep) groundStep = sample;
      else {
        // Yaw and vertical changes can arrive between quantized ground steps.
        const travel = Math.hypot(pose.x - groundStep.x, pose.z - groundStep.z);
        if (travel > 0) {
          const interval = at - groundStep.at;
          groundCadence = travel < 0.021 && interval >= delayMs && interval <= 600
            ? { speed: travel * 1000 / interval, expiresAt: at + interval + delayMs }
            : undefined;
          groundStep = sample;
        }
      }
      samples.push(sample);
      if (samples.length > MAX_SAMPLES) samples.shift();
    },
    sample(now, out) {
      if (!samples.length) return null;
      const t = now - delayMs;
      let a = samples[0]!;
      if (samples.length === 1 || t <= a.at) {
        Object.assign(out, { x: a.x, y: a.y, z: a.z, yaw: a.yaw, anim: a.anim });
        return out;
      }
      for (let i = 1; i < samples.length; i += 1) {
        const b = samples[i]!;
        if (t <= b.at) {
          const k = b.at > a.at ? (t - a.at) / (b.at - a.at) : 1;
          out.x = a.x + (b.x - a.x) * k;
          out.y = a.y + (b.y - a.y) * k;
          out.z = a.z + (b.z - a.z) * k;
          out.yaw = shortArc(a.yaw, b.yaw, k);
          out.anim = k < 0.5 ? a.anim : b.anim;
          return out;
        }
        a = b;
      }
      Object.assign(out, { x: a.x, y: a.y, z: a.z, yaw: a.yaw, anim: a.anim });
      return out;
    },
    poseHoldMs(now) {
      const last = samples[samples.length - 1];
      return last ? Math.max(0, now - delayMs - last.at) : 0;
    },
    slowGroundSpeed(now) {
      return groundCadence && now <= groundCadence.expiresAt ? groundCadence.speed : undefined;
    },
    latest() {
      const last = samples[samples.length - 1];
      return last ? { x: last.x, y: last.y, z: last.z, yaw: last.yaw, anim: last.anim } : null;
    },
    clear() {
      samples.length = 0;
      resetGroundCadence();
    },
  };
}
