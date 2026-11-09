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

// Free-arena bundle (vendor/shooter-pvp-sim.js), protocol 2 / sim 2. Separate
// from the campaign verifier. Director v2: every output is { op, body, to }.

interface ShooterPvpEconomy {
  mintsTickets: boolean;
  ticketsMintedByArtifact: number;
  payoutAuthority: string;
  stakes: boolean;
  wagerMayCreateTickets: boolean;
}

interface ShooterPvpLimits {
  maxFramesPerSecond: number;
  maxFramesPerCursor: number;
  futureFrames: number;
  holdTicks: number;
  catchUpTicks: number;
  maxPingsPerSecond: number;
  maxHelloPerSecond: number;
  maxReadyPerSecond: number;
  frameBytes: number;
  maxFrame: number;
  maxIdLength: number;
  maxNameLength: number;
  maxLeadInTicks: number;
}

interface ShooterPvpRewind {
  maxTicks: number;
  historyTicks: number;
  maxBack: number;
  fracSteps: number;
  interpMs: number;
  interpMinMs: number;
  interpMaxMs: number;
  extraTicks: number;
  rttWindow: number;
  maxRttMs: number;
  pongMemory: number;
  maxBackStep: number;
}

interface ShooterPvpReplayLimits {
  maxTicks: number;
  maxBytes: number;
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
  PING: number;
  PONG: number;
}

/** The director's RESULT body. combatSeed is revealed here and nowhere earlier. */
interface ShooterPvpResult {
  outcome: string;
  winner: number | null;
  reason: string;
  tick: number;
  stateHash: string | null;
  stateSha256: string | null;
  spawnSeed: number;
  combatSeed: string;
  combatCommit: string;
  ticketsMinted: number;
  stakes: boolean;
}

/** A presence a message is for: one seat's user and session. */
interface ShooterPvpTo {
  userId: string;
  sessionId: string;
}

/** `to` null: the whole match. Otherwise only that user's session. */
interface ShooterPvpMessage {
  op: number;
  body: { [key: string]: unknown };
  to: ShooterPvpTo | null;
}

interface ShooterPvpHandle {
  ok: boolean;
  reason?: string;
  seat?: number;
  late?: boolean;
  messages: ShooterPvpMessage[];
}

interface ShooterPvpAdvance {
  messages: ShooterPvpMessage[];
  result: ShooterPvpResult | null;
}

interface ShooterPvpSeatStats {
  accountId: string;
  connected: boolean;
  lastSeq: number;
  ackFrame: number;
  buffer: number;
  applied: number;
  held: number;
  neutral: number;
  late: number;
  rttMs: number | null;
  interpMs: number;
  rewindCap: number;
  clamped: number;
  viewClamped: number;
}

/** replayJSON v2 input: director.replayRecord(). Holds the combat seed: server-only. */
interface ShooterPvpReplayRecord {
  v: number;
  spawnSeed: number;
  combatSeed: string;
  combatCommit: string;
  matchId: string;
  accounts: (string | null)[];
  bundleSha256: string | null;
  sourceCommit: string | null;
  protocol: number;
  sim: number;
  content: string;
  used: string[];
  expect: { tick: number; stateHash: string; stateSha256: string; outcome: string | null; winner: number | null; reason: string | null } | null;
  result: ShooterPvpResult | null;
  ticketsMinted: number;
}

/** replayJSON v2 verdict: what may be settled from the record. */
interface ShooterPvpVerdict {
  replay: boolean;
  result: boolean | null;
  outcome: string | null;
  winner: number | null;
  reason: string | null;
  provable: boolean;
  accounts: (string | null)[] | null;
  bundleSha256: string | null;
  evidence: { trailingNonInput: number[]; stallTicks: number; consistent: boolean } | null;
  /** settle | settle_director | review | refund | refuse */
  policy: string;
}

/** replayJSON's parsed answer. A refusal has ok false and a reason. */
interface ShooterPvpReceipt {
  ok: boolean;
  reason?: string;
  verified?: boolean;
  mismatch?: string[];
  verdict?: ShooterPvpVerdict;
  outcome: string | null;
  winner: number | null;
  tick?: number;
  stateHash?: string;
  stateSha256?: string;
  ticketsMinted: number;
}

interface ShooterPvpSender {
  userId: string;
  sessionId: string;
  /** The display name the director puts in WELCOME `names`. The hub cleans it first. */
  username?: string;
}

interface ShooterPvpDirector {
  readonly phase: string;
  readonly result: ShooterPvpResult | null;
  readonly sim: { tick: number; phase: string; players: { yaw: number }[] } | null;
  readonly liveStart: number;
  readonly leadInTicks: number;
  readonly spawnSeed: number;
  readonly combatCommit: string;
  /** True when no combat seed was given. A hosted match must be false. */
  readonly combatSeedDerived: boolean;
  seatOf(accountId: string): number;
  occupied(): number;
  joinAttempt(userId: string): { accept: boolean; reason?: string };
  handle(sender: ShooterPvpSender, op: number, data: string | Uint8Array | ArrayBuffer | { [key: string]: unknown }, now: number): ShooterPvpHandle;
  advance(now: number): ShooterPvpAdvance;
  disconnect(userId: string, sessionId: string): void;
  exportState(): { [key: string]: unknown };
  importState(state: string | { [key: string]: unknown }): void;
  replayRecord(): ShooterPvpReplayRecord;
  seatStats(index: number): ShooterPvpSeatStats | null;
}

interface ShooterPvpHostedOptions {
  spawnSeed: number;
  /** 32..128 lowercase hex chars from a CSPRNG. */
  combatSeed: string;
  matchId: string;
  /** Seat 0, seat 1. Anyone else is not_invited. */
  accounts?: [string, string];
  build?: { bundleSha256?: string; sourceCommit?: string };
  /** Wagers only: lobby RTT baseline + margin, caps the RTT the rewind uses. */
  rttCeilingMs?: number;
  leadInTicks?: number;
}

interface ShooterPvpApi {
  PVP_PROTOCOL_VERSION: number;
  PVP_SIM_VERSION: number;
  CONTENT_FINGERPRINT: string;
  LOADOUT_HASH: string;
  LEAD_IN_TICKS: number;
  SOURCE_COMMIT: string;
  ECONOMY: ShooterPvpEconomy;
  INPUT_LIMITS: ShooterPvpLimits;
  REWIND: ShooterPvpRewind;
  REPLAY_LIMITS: ShooterPvpReplayLimits;
  OP: ShooterPvpOps;
  /** Practice and tests only: derives a predictable combat seed without one. */
  createDirector(options?: { seed?: number; spawnSeed?: number; combatSeed?: string; matchId?: string }): ShooterPvpDirector;
  /** The host constructor. Throws without a valid spawnSeed, combatSeed and matchId. */
  createHostedDirector(options: ShooterPvpHostedOptions): ShooterPvpDirector;
  restoreDirector(state: string | { [key: string]: unknown }): ShooterPvpDirector;
  combatCommitOf(combatSeed: string): string;
  rewindCapFor(rttMs: number | null, interpMs?: number): number;
  sha256Hex(text: string): string;
  /** v1 `{ seed, inputs }` or a v2 replay record, as JSON text (size-capped) or the object itself. */
  replayJSON(input: string | ShooterPvpReplayRecord | { [key: string]: unknown }): string;
  encodeInput(wish: { [key: string]: unknown }): Uint8Array;
  decodeInput(buf: Uint8Array): { [key: string]: unknown };
}

/** Defined by append-vendor around shooter-pvp-sim.js. Loads the arena on first use. */
declare function __sprotoShooterPvp(): ShooterPvpApi | null;
