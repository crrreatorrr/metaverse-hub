// Free 1v1 wire contract. The arena bundle is vendor/shooter-pvp-sim.js
// (sproto-shooter build/shooter-pvp-sim.js). The campaign verifier
// vendor/shooter-sim.js stays on fingerprint 3c657fb5 and is not this match.
// scripts/check-shooter-pvp-sim-version.mjs fails when the file hash, these
// constants, the live bundle, or shooter main disagree.
//
// Match name sproto_shooter_free. Game id sproto-shooter. Mode free. Stake 0.
// Two seats, 30 Hz, 90 s sim, 30 s ready, 10 s input stall. Protocol 2 /
// sim 2 (director v2: jitter buffer, lag compensation, split seed). The server
// picks the public spawn seed and a secret combat seed; only sha256 of the
// combat seed goes out before RESULT reveals it. Opcodes match
// docs/shooter-pvp-protocol.md in sproto-shooter:
//   1 HELLO  2 WELCOME  3 REJECT  4 READY  5 PHASE  6 INPUT
//   7 SNAPSHOT  8 RESULT  9 RESYNC  10 PING  11 PONG
// INPUT is 18 raw bytes. A client RESULT, or a hello/ready/resync body that
// names a winner, stake, or earn, is client_result and does not change the
// outcome. Practice is offline in the game client and is not this match.
// Guests with a sproto-shooter game session may play one seat. They are not
// given the other seat. There is no Ticket write.
//
// The pin is built from the sproto-shooter S2b branch until that stack merges;
// then re-vendor from the merged main SHA (scripts/revendor-shooter-pvp.mjs).

namespace ShooterProto {
  export var GAME_ID = "sproto-shooter";
  export var MATCH_NAME = "sproto_shooter_free";
  export var KIND = "sproto_shooter_free";
  export var MODE = "free";
  export var REPO = "crrreatorrr/sproto-shooter";
  export var COMMIT = "29b912ec0b8064c08701f6b2ce88bc2eee42c5c9";
  export var BUNDLE_SHA256 = "eee11404bc964ee09a36f969d27a23dc9f3786083d8cc0f415b8edad68f2111a";
  export var PROTOCOL = 2;
  export var SIM = 2;
  export var FINGERPRINT = "17d87c54";
  export var LOADOUT_HASH = "4cdfab55";
  export var CAMPAIGN_FINGERPRINT = "3c657fb5";

  export var OP_HELLO = 1;
  export var OP_WELCOME = 2;
  export var OP_REJECT = 3;
  export var OP_READY = 4;
  export var OP_PHASE = 5;
  export var OP_INPUT = 6;
  export var OP_SNAPSHOT = 7;
  export var OP_RESULT = 8;
  export var OP_RESYNC = 9;
  export var OP_PING = 10;
  export var OP_PONG = 11;

  export var TICK_RATE = 30;
  export var READY_MS = 30000;
  export var STALL_MS = 10000;
  export var MAX_MATCH_MS = 600000;
  /** Seconds a finished match stays open, so a seat that reconnects still gets WELCOME, the final snapshot and RESULT. */
  export var LINGER_S = 10;
  export var CODE_TTL_S = 600;
  export var CODE_LEN = 12;
  export var CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  export var FRAME_BYTES = 18;
  export var MAX_JSON = 2048;
  /**
   * Messages one sender may have handled per loop. One INPUT frame per message:
   * the director's own bucket allows 45 frames/s and 9 queued frames per tick,
   * so a burst after a TCP stall (a second of frames plus PINGs) fits, and the
   * director stays the limit that decides. The rest get REJECT rate.
   */
  export var MAX_MSGS_PER_SENDER = 56;
  export var BUDGET_MS = 10;
  export var SAMPLE_CAP = 240;
  export var LOOKUP_MAX = 8;
  export var LOOKUP_WINDOW_MS = 10000;
  export var CREATE_MAX = 5;
  export var CREATE_WINDOW_MS = 60000;
  export var SEATS = 2;

  export var GOLDEN_SEED = 7;
  export var GOLDEN_TICK = 65;
  export var GOLDEN_HASH = "6545ca0a";

  export var HOSTILE: { [key: string]: boolean } = {
    winner: true,
    result: true,
    settle: true,
    earn: true,
    earnTickets: true,
    stake: true,
    wager: true,
    tickets: true,
    god: true,
    godMode: true,
    debug: true,
    refund: true,
  };

  export var QUERY = "+properties.game:sproto-shooter +properties.mode:free +properties.protocol:" + PROTOCOL + " +properties.content:" + FINGERPRINT;

  /** Server-only storage of the replay record once RESULT is out (no wager yet: groundwork). */
  export var REPLAY_COLLECTION = "sproto_shooter_replay";

  /** The arena bundle, loaded on first use. Null when the wrapper is absent. */
  export function api(): ShooterPvpApi | null {
    if (typeof __sprotoShooterPvp !== "function") return null;
    var loaded = __sprotoShooterPvp();
    return loaded && typeof loaded.createHostedDirector === "function" ? loaded : null;
  }

  /** Null when the loaded arena bundle matches this pin. */
  export function verifyRuntime(): string | null {
    var sim = api();
    if (!sim) return "sim_missing";
    if (typeof sim.replayJSON !== "function" || typeof sim.createHostedDirector !== "function") return "entry_missing";
    if (typeof sim.combatCommitOf !== "function" || typeof sim.sha256Hex !== "function") return "entry_missing";
    if (sim.PVP_PROTOCOL_VERSION !== PROTOCOL) return "protocol_mismatch";
    if (sim.PVP_SIM_VERSION !== SIM) return "sim_mismatch";
    if (sim.CONTENT_FINGERPRINT !== FINGERPRINT) return "fingerprint_mismatch";
    if (sim.LOADOUT_HASH !== LOADOUT_HASH) return "loadout_mismatch";
    if (sim.SOURCE_COMMIT !== COMMIT) return "commit_mismatch";
    var economy = sim.ECONOMY;
    if (!economy || economy.mintsTickets !== false || economy.stakes !== false || economy.wagerMayCreateTickets !== false) return "economy_mismatch";
    if (economy.ticketsMintedByArtifact !== 0) return "economy_mismatch";
    var op = sim.OP;
    if (!op || op.HELLO !== OP_HELLO || op.WELCOME !== OP_WELCOME || op.REJECT !== OP_REJECT || op.READY !== OP_READY) return "opcode_mismatch";
    if (op.PHASE !== OP_PHASE || op.INPUT !== OP_INPUT || op.SNAPSHOT !== OP_SNAPSHOT || op.RESULT !== OP_RESULT || op.RESYNC !== OP_RESYNC) return "opcode_mismatch";
    if (op.PING !== OP_PING || op.PONG !== OP_PONG) return "opcode_mismatch";
    var limits = sim.INPUT_LIMITS;
    if (!limits || limits.frameBytes !== FRAME_BYTES || limits.maxFramesPerSecond !== 45 || limits.futureFrames !== 8) return "limits_mismatch";
    if (limits.maxFramesPerCursor !== 9 || limits.maxHelloPerSecond !== 2 || limits.maxReadyPerSecond !== 2) return "limits_mismatch";
    var rewind = sim.REWIND;
    if (!rewind || rewind.maxRttMs !== 1000 || rewind.maxBackStep !== 2) return "limits_mismatch";
    var replay = sim.REPLAY_LIMITS;
    if (!replay || replay.maxTicks !== 2700 || replay.maxBytes !== 524288) return "limits_mismatch";
    return null;
  }

  export function versionsMatch(protocol: unknown, sim: unknown, content: unknown): boolean {
    return Number(protocol) === PROTOCOL && Number(sim) === SIM && String(content === undefined || content === null ? "" : content) === FINGERPRINT;
  }

  export function hostile(body: { [key: string]: unknown } | null): boolean {
    if (!body) return false;
    for (var key in body) if (HOSTILE[key]) return true;
    return false;
  }

  /** Public spawn seed: 32 bits, server-chosen. Clients see it in WELCOME. */
  export function serverSeed(nk: nkruntime.Nakama): number {
    var hex = nk.sha256Hash(nk.uuidv4()).slice(0, 8);
    var n = parseInt(hex, 16);
    if (!n || n < 1 || n > 4294967295) return 1;
    return n >>> 0;
  }

  /**
   * Secret combat seed: 64 hex chars (256 bits) from Nakama's CSPRNG uuids
   * (two v4 uuids carry 244 random bits). Only the director and the server-only
   * replay record hold it; it is never logged, labelled, signalled or sent
   * before the director's RESULT reveals it.
   */
  export function combatSeed(nk: nkruntime.Nakama): string {
    return nk.sha256Hash(nk.uuidv4() + ":" + nk.uuidv4()).toLowerCase();
  }

  export function roomCode(): string {
    var out = "";
    for (var i = 0; i < CODE_LEN; i++) out += CODE_ALPHABET.charAt(Math.floor(Math.random() * CODE_ALPHABET.length) % CODE_ALPHABET.length);
    return out;
  }

  export function normalizeCode(input: unknown): string {
    var code = String(input === undefined || input === null ? "" : input).toUpperCase().replace(/[\s-]/g, "");
    if (code.length !== CODE_LEN) return "";
    for (var i = 0; i < code.length; i++) if (CODE_ALPHABET.indexOf(code.charAt(i)) < 0) return "";
    return code;
  }

  export function labelFor(): string {
    return JSON.stringify({
      kind: KIND,
      game: GAME_ID,
      mode: MODE,
      protocol: PROTOCOL,
      sim: SIM,
      content: FINGERPRINT,
      stake: 0,
    });
  }

  /** Nakama delivers match data as an ArrayBuffer. INPUT must stay raw bytes. */
  export function bytesOf(nk: nkruntime.Nakama, data: string | ArrayBuffer | null): Uint8Array {
    if (data === null || data === undefined) return new Uint8Array(0);
    if (typeof data === "string") {
      var text = new Uint8Array(data.length);
      for (var i = 0; i < data.length; i++) text[i] = data.charCodeAt(i) & 255;
      return text;
    }
    if (typeof (data as ArrayBuffer).byteLength === "number") return new Uint8Array(data as ArrayBuffer);
    var raw = nk.binaryToString(data as ArrayBuffer);
    var out = new Uint8Array(raw.length);
    for (var j = 0; j < raw.length; j++) out[j] = raw.charCodeAt(j) & 255;
    return out;
  }

  export function textOf(nk: nkruntime.Nakama, data: string | ArrayBuffer | null): string {
    if (data === null || data === undefined) return "";
    if (typeof data === "string") return data;
    return nk.binaryToString(data);
  }
}
