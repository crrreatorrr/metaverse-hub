import { AnimationClip, type KeyframeTrack } from 'three';

interface GaitProfile {
  duration: number;
  phase: number;
  lift: number[];
  groundSpeed: number;
}

function isProfile(value: unknown, duration: number): value is GaitProfile {
  if (typeof value !== 'object' || value === null) return false;
  const profile = value as Partial<GaitProfile>;
  return typeof profile.duration === 'number' && Math.abs(profile.duration - duration) < 1e-5 &&
    typeof profile.phase === 'number' && Math.abs(profile.phase) < 1 &&
    Array.isArray(profile.lift) && profile.lift.length >= 2 && profile.lift.every(Number.isFinite) &&
    typeof profile.groundSpeed === 'number' && Number.isFinite(profile.groundSpeed) && profile.groundSpeed > 0;
}

function wrap(time: number, duration: number): number {
  return ((time % duration) + duration) % duration;
}

function adjustTrack(track: KeyframeTrack, duration: number, { phase, lift }: GaitProfile): KeyframeTrack {
  const isHips = track.name === 'Hips.position';
  if (!isHips && phase === 0) return track;
  // Shift the existing key times with the cycle, so each rotation keeps its interpolation.
  // The pelvis needs extra samples for the baked clearance curve.
  const offset = phase * duration;
  const times = [0, Math.fround(duration), ...Array.from(track.times, (time) => Math.fround(wrap(time - offset, duration)))];
  if (isHips) {
    for (let i = 1; i < lift.length - 1; i += 1) times.push(Math.fround(i * duration / (lift.length - 1)));
  }
  times.sort((a, b) => a - b);
  const keys = times.filter((time, index) => index === 0 || time - times[index - 1]! > 1e-6);
  keys[keys.length - 1] = Math.fround(duration);
  const interpolant = track.InterpolantFactoryMethodLinear();
  const stride = track.getValueSize();
  const values = new Float32Array(keys.length * stride);
  keys.forEach((time, index) => {
    const t = index === keys.length - 1 ? 0 : time;
    const start = index * stride;
    values.set(interpolant.evaluate(wrap(t + offset, duration)), start);
    if (isHips) {
      const sample = t * (lift.length - 1) / duration;
      const i = Math.floor(sample);
      const lo = lift[i]!;
      const hi = lift[i + 1] ?? lo;
      values[start + 1] = values[start + 1]! + lo + (hi - lo) * (sample - i);
    }
  });
  const adjusted = track.clone();
  adjusted.times = Float32Array.from(keys);
  adjusted.values = values;
  return adjusted;
}

/**
 * Apply per-avatar calibration after retargeting, including any arm solve.
 * The scene extra carries a cycle offset and a sampled hip lift in the
 * target pelvis's local units. Every track follows the same cycle offset.
 */
export function applyGaitProfile(clip: AnimationClip, profiles: unknown): AnimationClip {
  if (clip.userData.contract !== 'hub-p4-gait-v1' || typeof profiles !== 'object' || profiles === null) return clip;
  const profile = (profiles as Record<string, unknown>)[clip.name];
  if (!isProfile(profile, clip.duration) || !clip.tracks.some((track) => track.name === 'Hips.position')) return clip;
  const tracks = clip.tracks.map((track) => adjustTrack(track, clip.duration, profile));
  const calibrated = new AnimationClip(clip.name, clip.duration, tracks, clip.blendMode);
  calibrated.userData = { ...clip.userData, ground_speed: profile.groundSpeed };
  return calibrated;
}
