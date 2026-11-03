// Globals from vendor/sproto-sim.js (Sproto Fighter's simulation bundle).
declare var SPROTO_SIM_VERSION: string;
declare var SprotoSim: {
  MAX_LOG_FRAMES: number;
  PLAYABLE_FIGHTERS: string[];
  /** Error code for a malformed log, or null. */
  checkLog(log: unknown, sim: string): string | null;
  createState(fighter: string, mode: string, opponent: string): { [key: string]: unknown };
  step(state: { [key: string]: unknown }, inputs: [number, number]): void;
  hashState(state: { [key: string]: unknown }): number;
  replayMatch(log: { v: 1; sim: string; fighters: [string, string]; frames: number; inputs: string }): { winner: 0 | 1 | 2 | null; frame: number; hash: number };
};
