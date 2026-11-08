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
