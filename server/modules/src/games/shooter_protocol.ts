// Free 1v1 wire contract. The arena bundle is vendor/shooter-pvp-sim.js
// (sproto-shooter build/shooter-pvp-sim.js). The campaign verifier
// vendor/shooter-sim.js stays on fingerprint 3c657fb5 and is not this match.
// scripts/check-shooter-pvp-sim-version.mjs fails when the file hash, these
// constants, the live bundle, or shooter main disagree.
//
// Match name sproto_shooter_free. Game id sproto-shooter. Mode free. Stake 0.
// Two seats, 30 Hz, 90 s sim, 30 s ready, 10 s input stall. Server seed and
// loadout. Opcodes match docs/shooter-pvp-protocol.md in sproto-shooter:
//   1 HELLO  2 WELCOME  3 REJECT  4 READY  5 PHASE
//   6 INPUT  7 SNAPSHOT  8 RESULT  9 RESYNC
// INPUT is 16 raw bytes. A client RESULT, or a hello/ready/resync body that
// names a winner, stake, or earn, is client_result and does not change the
// outcome. Practice is offline in the game client and is not this match.
// Guests with a sproto-shooter game session may play one seat. They are not
// given the other seat. There is no Ticket write.

namespace ShooterProto {
  export var GAME_ID = "sproto-shooter";
  export var MATCH_NAME = "sproto_shooter_free";
  export var KIND = "sproto_shooter_free";
  export var MODE = "free";
  export var REPO = "crrreatorrr/sproto-shooter";
  export var COMMIT = "5ccaf82a04c8e4233b257b71194ad82d8fd5f022";
  export var BUNDLE_SHA256 = "fccd3b17d0dc089d2134007a0f1cd37ef9c68296cdeacb5b040be3ac4f1d3f85";
  export var PROTOCOL = 1;
  export var SIM = 1;
  export var FINGERPRINT = "f5949631";
  export var LOADOUT_HASH = "9eb7cd63";
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

  export var TICK_RATE = 30;
  export var READY_MS = 30000;
  export var STALL_MS = 10000;
  export var MAX_MATCH_MS = 600000;
  export var LINGER_S = 2;
  export var CODE_TTL_S = 600;
  export var CODE_LEN = 12;
  export var CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  export var FRAME_BYTES = 16;
  export var MAX_JSON = 2048;
  export var MAX_MSGS = 32;
  export var BUDGET_MS = 10;
  export var SAMPLE_CAP = 240;
  export var LOOKUP_MAX = 8;
  export var LOOKUP_WINDOW_MS = 10000;
  export var CREATE_MAX = 5;
  export var CREATE_WINDOW_MS = 60000;
  export var SEATS = 2;

  export var GOLDEN_SEED = 7;
  export var GOLDEN_TICK = 61;
  export var GOLDEN_HASH = "ce272de1";

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

  export var QUERY = "+properties.game:sproto-shooter +properties.mode:free +properties.protocol:1";

  /** The arena bundle, loaded on first use. Null when the wrapper is absent. */
  export function api(): ShooterPvpApi | null {
    if (typeof __sprotoShooterPvp !== "function") return null;
    var loaded = __sprotoShooterPvp();
    return loaded && typeof loaded.createDirector === "function" ? loaded : null;
  }

  /** Null when the loaded arena bundle matches this pin. */
  export function verifyRuntime(): string | null {
    var sim = api();
    if (!sim) return "sim_missing";
    if (typeof sim.replayJSON !== "function") return "entry_missing";
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
    var limits = sim.INPUT_LIMITS;
    if (!limits || limits.frameBytes !== FRAME_BYTES || limits.maxInputsPerSecond !== 60 || limits.futureFrames !== 4) return "limits_mismatch";
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

  export function serverSeed(nk: nkruntime.Nakama): number {
    var hex = nk.sha256Hash(nk.uuidv4()).slice(0, 8);
    var n = parseInt(hex, 16);
    if (!n || n < 1 || n > 4294967295) return 1;
    return n >>> 0;
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
