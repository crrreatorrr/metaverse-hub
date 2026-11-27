// Globals from vendor/racer-sim.js (crrreatorrr/Sproto-Racer build/racer-sim.js, built there by
// scripts/build-server-sim.mjs). vendor/racer-sim.pin.json is the only version this module may run.
// The bundle holds the whole server side of an online race: the simulation and the match host
// that relays inputs. It does no work at load; the code is built on the first call (Contract C12).
// It never reads or writes Tickets, Relics or scores.

/** A player as the lobby lists it before the race, or a seat once the race is set up. */
interface RacerLobbyRow {
  slot?: number;
  seat?: number;
  name: string;
  car: string | null;
  driver: string | null;
  ready?: boolean;
  human?: boolean;
  connected?: boolean;
}

interface RacerSeat {
  id: number;
  human: boolean;
  /** The player id (here: the hub user id) the seat is kept for, or null for a seat the AI always had. */
  owner: string | null;
  connected: boolean;
  pending: boolean;
  name: string;
  car: string;
  driver: string;
}

interface RacerStanding {
  place: number;
  seat: number;
  car: string;
  driver: string;
  /** Finish time in microseconds, or null for a kart that did not finish. */
  finishUs: number | null;
  human: boolean;
  name: string;
}

interface RacerResults {
  tick: number;
  hash: string;
  standings: RacerStanding[];
}

/** Counters the host keeps. Everything a client sends that it drops is counted here. */
interface RacerHostStats {
  inputMessages: number;
  inputFrames: number;
  lateFrames: number;
  rejectedSeat: number;
  rejectedWindow: number;
  rejectedRate: number;
  rejectedMalformed: number;
  keyframesSent: number;
  keyframeBytes: number;
  batchesSent: number;
  heldTicks: number;
  keyframesDeferred: number;
  rejectedThrown: number;
}

interface RacerHostOptions {
  /** One message for one player. `data` is a Uint8Array (binary) or a string (JSON). */
  send(playerId: string, opCode: number, data: Uint8Array | string): void;
  /** One message for every joined player. Without it the host calls `send` once per player. */
  broadcast?(opCode: number, data: Uint8Array | string): void;
  onError?(err: unknown, playerId: string, opCode: number): void;
  courseId?: string;
  seed?: number;
  laps?: number;
  seatCount?: number;
  maxHumans?: number;
  minPlayers?: number;
  allowLateJoin?: boolean;
}

interface RacerMatchHost {
  join(playerId: string, meta?: { name?: string }): boolean;
  leave(playerId: string): boolean;
  /** Never throws. Malformed or over-rate input is dropped and counted in `stats`. */
  receive(playerId: string, opCode: number, data: Uint8Array | string): boolean;
  /** One 60 Hz step. Call exactly once per match loop. */
  tick(): void;
  /** Starts the race now with whoever is in the lobby. False when nobody is. */
  start(): boolean;
  lobby(): RacerLobbyRow[];
  stats: RacerHostStats;
  /** lobby, starting, race or finished. */
  phase: string;
  serverTick: number;
  raceTick: number;
  results: RacerResults | null;
  seats: RacerSeat[];
  playerCount: number;
  connectedHumans: number;
}

interface RacerNetInfo {
  netVersion: string;
  simVersion: string;
  tickRate: number;
  op: { [name: string]: number };
}

interface RacerSimApi {
  version(): string;
  netInfo(): RacerNetInfo;
  contentManifest(): { circuits: { id: string; name: string }[] };
  createMatchHost(options: RacerHostOptions): RacerMatchHost;
  createMatch(options: { courseId?: string; seed?: number }): { step(inputs: { [seat: number]: { [key: string]: unknown } }): unknown };
  stateHash(world: unknown): string;
}

declare var RACER_SIM_VERSION: string;
declare var RacerSim: RacerSimApi;
