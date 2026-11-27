// Sproto Racer online races: the constants the hub and the game must agree on.
//
// The server side of a race is vendor/racer-sim.js (crrreatorrr/Sproto-Racer build/racer-sim.js):
// the simulation and the match host that relays inputs. games/racer_match.ts passes Nakama's
// calls through to it. The wire format is the game's (docs/online-netcode.md there); this file
// names only what the hub itself reads: the versions, the opcodes of the JSON messages it looks
// at, the label and the room code.
//
// The pin below is vendor/racer-sim.pin.json. A client whose simulation version differs is
// refused at HELLO, so the game build and this bundle ship together: re-vendor with
//   node scripts/revendor-racer.mjs <path to a Sproto-Racer checkout>
// server/test/games/racer_match.test.ts fails when the file, the pin and these constants disagree.
//
// Match name sproto_racer. Game id sproto-racer. 60 Hz. A race grants nothing: no Tickets, no
// Relic, no score, no storage row besides the room code. New rooms need the racer_online server
// flag (src/flags.ts); with no row in game.server_flags the flag is off.

namespace RacerProto {
  export var GAME_ID = "sproto-racer";
  export var MATCH_NAME = "sproto_racer";
  export var KIND = "sproto_racer";
  export var MODE = "race";
  export var REPO = "crrreatorrr/Sproto-Racer";
  export var COMMIT = "e1a7b638cd698bd187dad216141089f27cf4df6a";
  export var BUNDLE_SHA256 = "d9ad292291f7cbb7819ca72019876d93e40ec894b5a95077676e5581964e734e";
  export var SIM_VERSION = "c46cf07289e0d3ae";
  export var NET_VERSION = "3";
  export var FLAG = "racer_online";

  // The JSON messages the hub reads or sends itself. Every other opcode goes to the host untouched.
  export var OP_HELLO = 1;
  export var OP_RESULT = 7;
  export var OP_ERROR = 19;

  export var TICK_RATE = 60;
  /** Karts on the grid. The AI drives every seat no player holds. */
  export var SEATS = 6;
  /**
   * Players in one room. Six karts cost 1.3 ms a tick in goja on an Apple M5 Pro and twelve cost
   * 3.5 ms with single ticks over the 16.7 ms budget (Sproto-Racer docs/online-netcode.md), so
   * rooms stay at six until twelve is measured on the production host.
   */
  export var MAX_HUMANS = 6;
  export var MIN_HUMANS = 2;
  export var LAPS = 3;
  /** Rooms of this game alive at once on the node. A room is one 60 Hz VM. Each holds one of this many storage slots. */
  export var MAX_ROOMS = 12;
  /** A slot that was claimed this recently counts as taken even if its match cannot be seen yet. */
  export var SLOT_FRESH_MS = 10000;

  /** A lobby nobody is in closes after this long. */
  export var EMPTY_LOBBY_S = 30;
  /** A lobby that never starts closes after this long. */
  export var LOBBY_MAX_S = 900;
  /** A public lobby starts this long after its first player is in, ready or not. */
  export var PUBLIC_START_S = 45;
  /** A race every player has left ends after this long. A player who comes back sooner keeps the seat. */
  export var ABANDON_S = 30;
  /** A finished race stays open this long, so a player who reconnects still gets the result. */
  export var LINGER_S = 20;
  /** A join that was accepted but never arrived frees its place after this long. */
  export var JOINING_S = 10;
  /** A quick-race room keeps a place for each matched account this long. */
  export var ROSTER_HOLD_S = 15;
  /** A race still running after this long is closed: nobody is finishing it. A three-lap race takes about five minutes. */
  export var MAX_RACE_S = 900;

  export var CODE_LEN = 6;
  /** The game's ROOM_ALPHABET (src/net/protocol.js): no 0, 1, I, L or O. */
  export var CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  export var CODE_TTL_S = 900;
  export var MAX_ADMITTED = 16;
  export var MAX_JSON = 2048;
  export var NAME_MAX = 24;

  export var LOOKUP_MAX = 8;
  export var LOOKUP_WINDOW_MS = 10000;
  export var CREATE_MAX = 5;
  export var CREATE_WINDOW_MS = 60000;

  /** A tick slower than this is counted in the room's metrics. The whole budget is 16.7 ms. */
  export var BUDGET_MS = 8;
  export var SAMPLE_CAP = 600;

  /** The vendored bundle, or null when it is missing from this build. */
  export function api(): RacerSimApi | null {
    if (typeof RacerSim !== "object" || !RacerSim) return null;
    return typeof RacerSim.createMatchHost === "function" && typeof RacerSim.netInfo === "function" ? RacerSim : null;
  }

  /** Null when the loaded bundle is the pinned one. Building the bundle's code is the cost of the first call in a VM. */
  export function verifyRuntime(): string | null {
    var sim = api();
    if (!sim) return "sim_missing";
    if (typeof RACER_SIM_VERSION !== "string" || RACER_SIM_VERSION !== SIM_VERSION) return "sim_mismatch";
    var info: RacerNetInfo;
    try {
      info = sim.netInfo();
    } catch (e) {
      return "sim_broken";
    }
    if (!info || info.simVersion !== SIM_VERSION) return "sim_mismatch";
    if (info.netVersion !== NET_VERSION) return "protocol_mismatch";
    if (info.tickRate !== TICK_RATE) return "tick_mismatch";
    var op = info.op;
    if (!op || op["HELLO"] !== OP_HELLO || op["RESULT"] !== OP_RESULT || op["ERROR"] !== OP_ERROR) return "opcode_mismatch";
    return null;
  }

  var courses: string[] | null = null;

  /** Circuit ids the bundle can race, in the game's order. */
  export function courseIds(): string[] {
    if (courses) return courses;
    var out: string[] = [];
    var sim = api();
    if (sim) {
      var listed = sim.contentManifest().circuits || [];
      for (var i = 0; i < listed.length; i++) if (listed[i] && typeof listed[i].id === "string") out.push(listed[i].id);
    }
    courses = out;
    return out;
  }

  export function knownCourse(id: unknown): boolean {
    if (typeof id !== "string" || !id) return false;
    var ids = courseIds();
    for (var i = 0; i < ids.length; i++) if (ids[i] === id) return true;
    return false;
  }

  /** 32 bits from Nakama's CSPRNG uuids. Clients see the seed in START; nothing is hidden in it. */
  export function serverSeed(nk: nkruntime.Nakama): number {
    var n = parseInt(nk.sha256Hash(nk.uuidv4()).slice(0, 8), 16);
    if (!n || n < 1 || n > 4294967295) return 1;
    return n >>> 0;
  }

  /** A circuit picked by the server when nobody asked for one. */
  export function randomCourse(nk: nkruntime.Nakama): string {
    var ids = courseIds();
    if (!ids.length) return "";
    return ids[serverSeed(nk) % ids.length];
  }

  /** Six characters of the game's alphabet out of Nakama's CSPRNG uuids. Bytes that would bias the pick are skipped. */
  export function roomCode(nk: nkruntime.Nakama): string {
    var out = "";
    var limit = 256 - (256 % CODE_ALPHABET.length);
    for (var round = 0; round < 4 && out.length < CODE_LEN; round++) {
      var hex = nk.sha256Hash(nk.uuidv4() + ":" + nk.uuidv4());
      for (var i = 0; i + 2 <= hex.length && out.length < CODE_LEN; i += 2) {
        var byte = parseInt(hex.substr(i, 2), 16);
        if (byte < limit) out += CODE_ALPHABET.charAt(byte % CODE_ALPHABET.length);
      }
    }
    return out.length === CODE_LEN ? out : "";
  }

  export function normalizeCode(input: unknown): string {
    var code = String(input === undefined || input === null ? "" : input).toUpperCase().replace(/[\s-]/g, "");
    if (code.length !== CODE_LEN) return "";
    for (var i = 0; i < code.length; i++) if (CODE_ALPHABET.indexOf(code.charAt(i)) < 0) return "";
    return code;
  }

  /** Players a room takes: what was asked for, between two and six. Six when nothing usable was asked. */
  export function clampHumans(raw: unknown): number {
    var n = Math.floor(Number(raw));
    if (raw === undefined || raw === null || raw === "" || n !== n) return MAX_HUMANS;
    if (n < MIN_HUMANS) return MIN_HUMANS;
    return n > MAX_HUMANS ? MAX_HUMANS : n;
  }

  /**
   * The label the game's quick match searches (src/net/protocol.js makeMatchLabel): open must be
   * a JSON boolean for `+label.open:T`. A private room is never open and never shows its code.
   */
  export function labelFor(room: { privateRoom: boolean; open: boolean; courseId: string; players: number; maxHumans: number }): string {
    return JSON.stringify({
      kind: KIND,
      game: GAME_ID,
      open: room.open && !room.privateRoom,
      private: room.privateRoom,
      version: NET_VERSION,
      simVersion: SIM_VERSION,
      courseId: room.courseId,
      mode: MODE,
      players: room.players,
      maxSeats: room.maxHumans,
    });
  }

  /** Nakama hands match data over as an ArrayBuffer. Anything else is passed on as empty, which the host drops. */
  export function bytesOf(data: string | ArrayBuffer | null): Uint8Array {
    if (data === null || data === undefined || typeof data !== "object") return new Uint8Array(0);
    if (Object.prototype.toString.call(data) !== "[object ArrayBuffer]") return new Uint8Array(0);
    return new Uint8Array(data as ArrayBuffer);
  }

  /**
   * What broadcastMessage accepts: a string as it is, or a fresh ArrayBuffer holding exactly the
   * view's bytes. Nakama 3.41 rejects a Uint8Array, and it keeps the buffer it is given until the
   * socket writes it, so a buffer the host reuses must be copied.
   */
  export function payloadOf(data: Uint8Array | string): string | ArrayBuffer {
    if (typeof data === "string") return data;
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  }
}
