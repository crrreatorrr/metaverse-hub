/** Shared movement and camera values. Changing these changes every realm. */
export const MOVEMENT = Object.freeze({
  gravity: -28, jump: 6.4, terminal: -40, walk: 7.8, sprint: 16,
  cameraArm: 7.6, fov: 78, yawRate: 1.8, pitchRate: 1.15,
  mouseYaw: 0.0017, mousePitch: 0.0014, pitchMin: -0.42, pitchMax: 1.05,
  armMin: 1.25, armOffset: 0.28, capsuleRadius: 0.34, capsuleLength: 1.08,
  bodyReference: 1.75, bodyScale: 1.25,
  standHeight: 0.34 * 1.25 + 1.08 * 1.25,
  initialPitch: 0.28, lookDrop: 0.15,
});
