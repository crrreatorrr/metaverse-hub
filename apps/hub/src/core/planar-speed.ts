// Use net movement over a short window so opposite collision corrections
// cancel before they reach the animation mixer.
const SPEED_WINDOW = 0.25;

interface PositionSample {
  time: number;
  x: number;
  z: number;
}

export function createPlanarSpeed(x: number, z: number) {
  const samples: PositionSample[] = [{ time: 0, x, z }];
  let time = 0;
  let previousHeading: number | undefined;
  return {
    reset(x: number, z: number): void {
      time = 0;
      previousHeading = undefined;
      samples.splice(0, samples.length, { time, x, z });
    },
    sample(dt: number, x: number, z: number, heading?: number, requestedSpeed = 0): number | undefined {
      if (dt <= 0) return undefined;
      if (heading !== undefined && previousHeading !== undefined && Math.cos(heading - previousHeading) < 0) {
        const last = samples[samples.length - 1]!;
        const progress = (x - last.x) * Math.sin(heading) - (z - last.z) * Math.cos(heading);
        // Clear the window only if the body follows the new input. A
        // blocked capsule can still move a little while resolving contact.
        if (requestedSpeed > 0 && progress >= requestedSpeed * dt * 0.5) {
          samples.splice(0, samples.length - 1);
        }
      }
      previousHeading = heading;
      time += dt;
      samples.push({ time, x, z });
      const start = Math.max(samples[0]!.time, time - SPEED_WINDOW);
      while (samples[1]!.time <= start) samples.shift();
      const a = samples[0]!;
      const b = samples[1]!;
      const blend = (start - a.time) / (b.time - a.time);
      return Math.hypot(x - (a.x + (b.x - a.x) * blend), z - (a.z + (b.z - a.z) * blend)) / (time - start);
    },
  };
}
