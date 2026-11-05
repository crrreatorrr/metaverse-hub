export interface Spawn {
  x: number;
  z: number;
  yaw: number;
}

export interface BoxSpec {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  rotY: number;
}

/** 0 is north (−Z). */
export function portalPosition(angle: number, distance: number): { x: number; z: number } {
  return {
    x: Math.sin(angle) * distance,
    z: -Math.cos(angle) * distance,
  };
}
