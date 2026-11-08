// Globals from vendor/shooter-sim.js (sproto-shooter build/shooter-sim.js).
// The pin in vendor/shooter-sim.pin.json is the only version this module may run.
// The bundle never mints Tickets. H2-S applies the 20-Ticket rule after verifyRun.

interface ShooterEconomy {
  mintsTickets: boolean;
  ticketsMintedByArtifact: number;
  payoutAuthority: string;
  wagerTransfersUncapped: boolean;
  wagerMayCreateTickets: boolean;
}

interface ShooterLimits {
  maxSegmentFrames: number;
  maxSegments: number;
  maxTotalFrames: number;
  maxSegmentText: number;
  maxTotalText: number;
  maxActionsPerSegment: number;
  maxCpuMs: number;
  maxStepMeters: number;
  maxIdLength: number;
}

interface ShooterSimApi {
  PROTOCOL_VERSION: number;
  LIMITS: ShooterLimits;
  ECONOMY: ShooterEconomy;
  SOURCE_COMMIT: string;
  buildIssuance(input: { [key: string]: unknown }): { [key: string]: unknown };
  verifyRun(log: { [key: string]: unknown }, ctx: { [key: string]: unknown }): { [key: string]: unknown };
  verifyRunJSON(text: string): string;
  contentFingerprintOf(): string;
  bossById(id: string): { [key: string]: unknown } | null;
  pureClone<T>(value: T): T;
}

declare const SprotoShooterSim: ShooterSimApi;

/** Defined by append-vendor around shooter-sim.js. Absent when the bundle was evaluated at load. */
declare function __loadSprotoShooterSim(): void;
declare function __sprotoShooterSim(): ShooterSimApi | null;

// Free-arena bundle (vendor/shooter-pvp-sim.js). Separate from the campaign verifier.

interface ShooterPvpEconomy {
  mintsTickets: boolean;
  ticketsMintedByArtifact: number;
  payoutAuthority: string;
  stakes: boolean;
  wagerMayCreateTickets: boolean;
}

interface ShooterPvpLimits {
  maxInputsPerSecond: number;
  maxInputsPerTick: number;
  futureFrames: number;
  pastFrames: number;
  frameBytes: number;
  maxFrame: number;
  maxIdLength: number;
}

interface ShooterPvpOps {
  HELLO: number;
  WELCOME: number;
  REJECT: number;
  READY: number;
  PHASE: number;
  INPUT: number;
  SNAPSHOT: number;
  RESULT: number;
  RESYNC: number;
}

interface ShooterPvpResult {
  outcome: string;
  winner: number | null;
  reason: string;
  tick: number;
  stateHash: string | null;
  ticketsMinted: number;
  stakes: boolean;
}

interface ShooterPvpHandle {
  ok: boolean;
  reason?: string;
  seat?: number;
  messages: { op: number; body: { [key: string]: unknown } }[];
}

interface ShooterPvpDirector {
  readonly phase: string;
  readonly result: ShooterPvpResult | null;
  readonly sim: { tick: number; phase: string } | null;
  seatOf(accountId: string): number;
  occupied(): number;
  joinAttempt(userId: string): { accept: boolean; reason?: string };
  handle(sender: { userId: string; sessionId: string }, op: number, data: string | Uint8Array, now: number): ShooterPvpHandle;
  advance(now: number): {
    snapshots: { [key: string]: unknown }[];
    result: ShooterPvpResult | null;
    phaseMessage: { [key: string]: unknown } | null;
  };
  disconnect(userId: string, sessionId: string): void;
}

interface ShooterPvpApi {
  PVP_PROTOCOL_VERSION: number;
  PVP_SIM_VERSION: number;
  CONTENT_FINGERPRINT: string;
  LOADOUT_HASH: string;
  SOURCE_COMMIT: string;
  ECONOMY: ShooterPvpEconomy;
  INPUT_LIMITS: ShooterPvpLimits;
  OP: ShooterPvpOps;
  createDirector(options?: { seed?: number; matchId?: string }): ShooterPvpDirector;
  replayJSON(text: string): string;
  encodeInput(wish: { [key: string]: unknown }): Uint8Array;
  decodeInput(buf: Uint8Array): { [key: string]: unknown };
}

declare const SprotoShooterPvp: ShooterPvpApi;
