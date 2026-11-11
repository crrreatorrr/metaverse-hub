// Authoritative Coop protocol constants and the 20 Hz step.
//
// The vendored bundle is build/coop-sim.js from crrreatorrr/Sproto-Coop-Battle.
// at the commit in vendor/coop-sim.pin.json. scripts/check-coop-sim-version.mjs
// fails when the file hash, this source, the live bundle, or Coop main disagree.
//
// C4 wire contract (authoritative banked matches only; practice stays on the
// old relay and is not this match):
//   match name sproto_coop
//   RPCs coop.version, coop.room_create, coop.room_join, coop.queue_cancel,
//        coop.resume, coop.metrics
//   opcodes:
//     1  HELLO     c->s {t, protocol, fingerprint, devices[], fighter?, weapon?}
//     2  WELCOME   s->c first seat grant
//     3  READY     c->s {t:"ready"}
//     4  START     s->c banked run began at stage 0
//     10 INPUT     c->s one sim frame, seats this account owns
//     11 SNAPSHOT  s->c render snapshot, restart:0, 10 Hz (every 2nd loop)
//     12 SEATS     s->c seat table
//     13 REJECT    s->c {reason} and that input is not applied
//     14 RESUME    s->c same account reclaimed its seats; full export is not a
//                  client-writable checkpoint (acceptClientState:0)
//     15 END       s->c match over; hostTakeover is always 0
//     16 RELEASE   c->s {device} gives that seat to server AI immediately
//     17 PING / 18 PONG
//     19 COMMAND   c->s god, stage, state, seed, earn, score, pause, snapshot,
//                  result: always rejected. Banked mode never applies them.
//   Loop is 20 Hz with exactly 3 sim substeps (60 Hz). Snapshots are 10 Hz.
//   15 Hz is only the contract ceiling (snapshotMaxHz), not a second rate.
//   Room codes are 12-character locators with a 600 s TTL, not credentials.
//   Quick queue is the matchmaker: properties.game, v = protocol, sim = fingerprint,
//   count 1..6. One account may hold several of k1, k2, gp0..gp3. Six seats
//   total, not six sockets. Reconnect keeps those seats for 15 s under server
//   AI, then the same account's new socket resumes them. A new socket bumps
//   the generation; the previous socket's input is rejected. Lives, hp, powers,
//   and item ids are not reset. There is no Ticket and no score write.

namespace CoopProto {
  export var GAME_ID = "sproto-coop-battle";
  export var MATCH_NAME = "sproto_coop";
  export var KIND = "sproto_coop";
  export var REPO = "crrreatorrr/Sproto-Coop-Battle.";
  export var COMMIT = "2b65bdb1552f9fdba4645a729ccdd60ad879e7c0";
  export var BUNDLE_SHA256 = "a9034b346fced4a1c963dc70133549d7444d61acdb6b844d873aa8a89c0f4cb5";
  export var PROTOCOL = 1;
  export var FINGERPRINT = "fb9f2679528b6810dfd3a42ce41bb6f2ed3ac8e75eb3741e2ad30ccd9a4b9a72";

  export var OP_HELLO = 1;
  export var OP_WELCOME = 2;
  export var OP_READY = 3;
  export var OP_START = 4;
  export var OP_INPUT = 10;
  export var OP_SNAPSHOT = 11;
  export var OP_SEATS = 12;
  export var OP_REJECT = 13;
  export var OP_RESUME = 14;
  export var OP_END = 15;
  export var OP_RELEASE = 16;
  export var OP_PING = 17;
  export var OP_PONG = 18;
  export var OP_COMMAND = 19;

  export var TICK_RATE = 20;
  export var SUBSTEPS = 3;
  export var RECONNECT_S = 15;
  export var CODE_TTL_S = 600;
  export var LOBBY_S = 30;
  export var QUICK_FILL_S = 15;
  export var MAX_PLAY_S = 45 * 60;
  export var LINGER_S = 2;
  export var CHECKPOINT_LOOPS = 100;
  export var MAX_MSGS_PER_TICK = 16;
  export var CODE_LEN = 12;
  export var CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  export var DEVICES = ["k1", "k2", "gp0", "gp1", "gp2", "gp3"];
  export var LOOKUP_MAX = 8;
  export var LOOKUP_WINDOW_MS = 10000;
  export var CREATE_MAX = 5;
  export var CREATE_WINDOW_MS = 60000;

  export var BANNED_TYPES: { [key: string]: boolean } = {
    god: true, stage: true, state: true, seed: true, earn: true, score: true, pause: true, snapshot: true, result: true,
  };
  export var BANNED_KEYS = ["god", "stage", "state", "seed", "earn", "score", "pause", "snapshot", "result", "hp", "lives", "ctrl"];

  /** Null when the loaded bundle matches this pin. A string is the mismatch. */
  export function verifyRuntime(nk: nkruntime.Nakama): string | null {
    if (typeof CoopProtocol === "undefined" || !CoopProtocol || !CoopProtocol.createMatch) return "sim_missing";
    if (CoopProtocol.PROTOCOL_VERSION !== PROTOCOL) return "protocol_mismatch";
    if (CoopProtocol.GAME_ID !== GAME_ID) return "game_mismatch";
    var limits = CoopProtocol.LIMITS;
    if (!limits || limits.simHz !== 60 || limits.loopHz !== TICK_RATE || limits.substeps !== SUBSTEPS) return "loop_mismatch";
    if (limits.snapshotHz !== 10 || limits.snapshotMaxHz !== 15) return "snapshot_mismatch";
    if (limits.maxSeats !== 6 || limits.reconnectGraceMs !== RECONNECT_S * 1000) return "seat_mismatch";
    if (typeof Sim === "undefined" || !Sim || Sim.STATE_VERSION !== 1) return "state_mismatch";
    var content = "";
    try {
      content = JSON.stringify(CoopProtocol.contentManifest(MANIFEST));
    } catch (e) {
      return "manifest_mismatch";
    }
    if (nk.sha256Hash(content) !== FINGERPRINT) return "fingerprint_mismatch";
    return null;
  }

  export function versionsMatch(protocol: unknown, fingerprint: unknown): boolean {
    return Number(protocol) === PROTOCOL && String(fingerprint === undefined || fingerprint === null ? "" : fingerprint) === FINGERPRINT;
  }

  export function banned(msg: { [key: string]: unknown }): boolean {
    if (BANNED_TYPES[String(msg["t"] === undefined || msg["t"] === null ? "" : msg["t"])]) return true;
    for (var i = 0; i < BANNED_KEYS.length; i++) {
      if (msg[BANNED_KEYS[i]] !== undefined) return true;
    }
    return false;
  }

  export function serverSeed(): number {
    var seed = Math.floor(Math.random() * 4294967295) >>> 0;
    return seed === 0 ? 1 : seed;
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

  export function fighterIndex(id: string): number {
    var content = CoopProtocol.contentManifest(MANIFEST);
    for (var i = 0; i < content.fighters.length; i++) if (content.fighters[i].id === id) return i;
    return -1;
  }

  export function weaponIndex(id: string): number {
    var weapons = CoopProtocol.contentManifest(MANIFEST).weapons;
    for (var i = 0; i < weapons.length; i++) if (weapons[i] === id) return i;
    return -1;
  }

  function drain(session: CoopSession): void {
    var events = session.state.events;
    if (events && events.length) events.length = 0;
  }

  /**
   * Same presence rules as CoopProtocol.notePresence, which the bundle does not
   * export. stepLoop still runs the real one; this runs only when several
   * accounts share one substep (stepLoop accepts a single account per substep).
   */
  function notePresence(session: CoopSession): void {
    var enc = session.encounter;
    if (!enc) return;
    var age = session.state.t - enc.startTick;
    var limits = CoopProtocol.LIMITS;
    for (var i = 0; i < session.seats.length; i++) {
      var seat = session.seats[i];
      if (!seat.human || !seat.accountId) continue;
      var row = enc.accounts[seat.accountId];
      if (!row) {
        row = { slots: [], presentAtStart: age <= 1, nonNeutral: 0, neutralAlive: 0, downTicks: 0, seen: 0 };
        enc.accounts[seat.accountId] = row;
      }
      if (row.slots.indexOf(seat.slot) < 0) row.slots.push(seat.slot);
      var player = session.state.players[seat.slot];
      row.seen++;
      if (player.st === "down" || player.st === "dead") row.downTicks++;
      else {
        var inp = player.in;
        var neutral = !(inp.l || inp.r || inp.u || inp.d || inp.a || inp.j || inp.s || inp.p);
        if (!neutral) row.nonNeutral++;
        else if (age > limits.encounterGraceTicks) row.neutralAlive++;
      }
    }
  }

  function applyHumans(session: CoopSession, applied: { slot: number; buttons: CoopButton }[][]): void {
    for (var step = 0; step < SUBSTEPS; step++) {
      var rows = applied[step];
      for (var p = 0; p < session.state.players.length; p++) {
        if (session.state.players[p].ctrl === "cpu") continue;
        session.state.players[p].in = CoopProtocol.neutralButtons();
      }
      for (var r = 0; r < rows.length; r++) {
        session.state.players[rows[r].slot].in = rows[r].buttons;
      }
      notePresence(session);
      Sim.step(session.state);
    }
    session.loops++;
    drain(session);
  }

  export interface AdvanceResult {
    ok: boolean;
    reason: string;
    snapshot: CoopSnap | null;
    rejected: { accountId: string; reason: string }[];
  }

  /**
   * Three sim substeps. One account per substep goes through CoopProtocol.stepLoop
   * so presence tracking stays the bundle's. Two accounts on the same substep
   * are applied together, then Sim.step runs once; a rejected message becomes
   * neutral instead of freezing the other seats.
   */
  export function advance(session: CoopSession, groups: { [key: string]: unknown }[][], now: number): AdvanceResult {
    var rejected: { accountId: string; reason: string }[] = [];
    var multi = false;
    var triple: ({ [key: string]: unknown } | null)[] = [null, null, null];
    for (var i = 0; i < SUBSTEPS; i++) {
      var group = groups[i] || [];
      if (group.length > 1) multi = true;
      if (group.length === 1) triple[i] = group[0];
    }
    if (!multi) {
      var stepped = CoopProtocol.stepLoop(session, triple, now);
      if (!stepped.ok) {
        for (var j = 0; j < SUBSTEPS; j++) {
          var msg = triple[j];
          if (msg) rejected.push({ accountId: String(msg["accountId"] || ""), reason: String(stepped.reason || "rejected") });
        }
        var neutral = CoopProtocol.stepLoop(session, [null, null, null], now);
        drain(session);
        if (!neutral.ok) return { ok: false, reason: String(neutral.reason || "sim"), snapshot: null, rejected: rejected };
        return { ok: true, reason: "", snapshot: neutral.snapshot || null, rejected: rejected };
      }
      drain(session);
      return { ok: true, reason: "", snapshot: stepped.snapshot || null, rejected: rejected };
    }
    var decoded: { slot: number; buttons: CoopButton }[][] = [[], [], []];
    for (var s = 0; s < SUBSTEPS; s++) {
      var bucket = groups[s] || [];
      for (var m = 0; m < bucket.length; m++) {
        var applied = CoopProtocol.acceptInput(session, bucket[m], now + s);
        if (!applied.ok) {
          rejected.push({ accountId: String(bucket[m]["accountId"] || ""), reason: applied.reason });
          continue;
        }
        for (var seat = 0; seat < applied.seats.length; seat++) decoded[s].push(applied.seats[seat]);
      }
    }
    applyHumans(session, decoded);
    var due = session.loops % 2 === 0;
    return { ok: true, reason: "", snapshot: due ? CoopProtocol.snapshotEnvelope(session) : null, rejected: rejected };
  }
}
