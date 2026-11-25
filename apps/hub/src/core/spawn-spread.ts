/** Number of distinct spots `spawnSpread` gives. */
export const SPAWN_SPOTS = 64;
const INNER = 1.2;
/** Farthest a spot is from the spawn point. */
export const SPAWN_SPREAD_MAX = 4;

/**
 * Where arrival number `n` stands, as an offset from the realm's spawn point, so players who
 * arrive together do not stand inside each other. The 64 spots fill a ring 1.2 to 4 m out
 * (a sunflower spiral), each at least 0.75 m from every other.
 */
export function spawnSpread(n: number): { x: number; z: number } {
  const i = ((Math.floor(n) % SPAWN_SPOTS) + SPAWN_SPOTS) % SPAWN_SPOTS;
  const angle = i * 2.399963229728653;
  const radius = Math.sqrt(INNER * INNER + (i * (SPAWN_SPREAD_MAX * SPAWN_SPREAD_MAX - INNER * INNER)) / (SPAWN_SPOTS - 1));
  return { x: Math.sin(angle) * radius, z: Math.cos(angle) * radius };
}
