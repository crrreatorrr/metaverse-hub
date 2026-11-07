// Globals from vendor/coop-sim.js (Sproto Coop Battle's C3 server bundle).
// The pin in vendor/coop-sim.pin.json is the only version this module may run.

interface CoopButton {
  l: number;
  r: number;
  u: number;
  d: number;
  a: number;
  j: number;
  s: number;
  p: number;
}

interface CoopPlayer {
  slot: number;
  ctrl: string;
  fid: number;
  weapon: number;
  name: string;
  lives: number;
  hp: number;
  powers: unknown[];
  dead: boolean;
  downT: number;
  st: string;
  in: CoopButton;
}

interface CoopSimState {
  t: number;
  mode: string;
  stageIdx: number;
  god: boolean;
  events: unknown[];
  players: CoopPlayer[];
}

interface CoopSeat {
  slot: number;
  accountId: string | null;
  generation: number;
  device: string;
  human: boolean;
}

interface CoopPresenceRow {
  slots: number[];
  presentAtStart: boolean;
  nonNeutral: number;
  neutralAlive: number;
  downTicks: number;
  seen: number;
}

interface CoopEncounter {
  canonicalBossId: string;
  stageIndex: number;
  startTick: number;
  accounts: { [id: string]: CoopPresenceRow };
}

interface CoopSession {
  mode: string;
  matchId: string;
  state: CoopSimState;
  seats: CoopSeat[];
  loops: number;
  seq: { [key: string]: number };
  limiters: { [key: string]: { tokens: number; last: number } };
  encounter: CoopEncounter | null;
  closedEncounter: CoopEncounter | null;
}

interface CoopManifest {
  bosses: { key: string; stage: string; pilot: string; machines: string[]; phases: unknown[] }[];
  fighters: { id: string; name: string }[];
}

interface CoopContent {
  gameId: string;
  stages: { index: number; canonicalBossId: string; length: number }[];
  fighters: { id: string; name: string }[];
  weapons: string[];
}

interface CoopFail {
  ok: false;
  reason: string;
}

interface CoopSnap {
  kind: string;
  protocol: number;
  gameId: string;
  matchId: string;
  tick: number;
  loop: number;
  hz: number;
  restart: number;
  state: { [key: string]: unknown };
}

interface CoopStepResult {
  ok: boolean;
  reason?: string;
  snapshot?: CoopSnap | null;
}

interface CoopSeatOk {
  ok: true;
  seat: CoopSeat;
  lives: number;
  hp: number;
  powers: unknown[];
}

interface CoopInputOk {
  ok: true;
  frame: number;
  seats: { slot: number; buttons: CoopButton }[];
}

interface CoopFacts {
  canonicalBossId: string | null;
  stageIndex?: number;
  startTick?: number;
  accounts: { [key: string]: unknown }[];
  tickets: number;
  scoreSubmitted?: number;
  [key: string]: unknown;
}

interface CoopTerminal {
  tick: number;
  mode: string;
  stageIndex: number;
  canonicalBossId: string | null;
  encounterCleared: number;
  victory: number;
  gameOver: number;
  tickets: number;
  scoreSubmitted: number;
  [key: string]: unknown;
}

interface CoopLifeFacts {
  lives: number[];
  hp: number[];
  powers: unknown[][];
  items: number[];
  dead: number[];
  downT: number[];
}

interface CoopLimits {
  simHz: number;
  loopHz: number;
  substeps: number;
  snapshotHz: number;
  snapshotMaxHz: number;
  maxSeats: number;
  maxFutureFrames: number;
  maxPayloadBytes: number;
  maxInputBytes: number;
  maxInputsPerSecond: number;
  inputBurst: number;
  reconnectGraceMs: number;
  encounterGraceTicks: number;
  afkAliveTicks: number;
  buttonMaskMax: number;
}

interface CoopProtocolApi {
  PROTOCOL_VERSION: number;
  GAME_ID: string;
  LIMITS: CoopLimits;
  contentManifest(manifest: CoopManifest): CoopContent;
  createMatch(opts: { mode?: string; seed?: number; matchId?: string; stage?: number }): { ok: true; session: CoopSession } | CoopFail;
  assignSeat(session: CoopSession, req: { slot: number; accountId: string; device: string; generation: number }): CoopSeatOk | CoopFail;
  releaseSeat(session: CoopSession, req: { slot: number; accountId: string; generation: number }): CoopSeatOk | CoopFail;
  acceptInput(session: CoopSession, msg: { [key: string]: unknown }, now: number): CoopInputOk | CoopFail;
  command(session: CoopSession, msg: { [key: string]: unknown }, now: number): { ok: boolean; reason?: string; [key: string]: unknown };
  stepLoop(session: CoopSession, frames: ({ [key: string]: unknown } | null)[], now: number): CoopStepResult;
  beginEncounter(session: CoopSession): { ok: true; canonicalBossId: string } | CoopFail;
  endEncounter(session: CoopSession): CoopFacts;
  participationFacts(session: CoopSession): CoopFacts;
  terminalFacts(session: CoopSession): CoopTerminal;
  snapshotEnvelope(session: CoopSession): CoopSnap;
  lifeFacts(state: CoopSimState): CoopLifeFacts;
  neutralButtons(): CoopButton;
  unpackMask(mask: number): CoopButton;
}

interface CoopExport {
  kind: string;
  version: number;
  state: { [key: string]: unknown };
}

declare var CoopProtocol: CoopProtocolApi;
declare var Sim: {
  STATE_VERSION: number;
  STATE_KIND: string;
  step(state: CoopSimState): void;
  exportState(state: CoopSimState): CoopExport;
  importState(data: CoopExport): CoopSimState;
  snapshot(state: CoopSimState): { [key: string]: unknown };
};
declare var SproAI: { think(state: CoopSimState, player: CoopPlayer): void };
declare var MANIFEST: CoopManifest;
