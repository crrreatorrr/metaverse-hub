// Authoritative six-seat Coop match. A banked boss clear settles inside
// CoopRewards: 20 Tickets once per account, per canonical boss, per UTC day.
// The wire field rewards stays 0. Clients cannot treat an opcode as a mint.
// Stage select, God Mode, demos, client snapshots, and client results are
// rejected. A server restart writes the sim's exportState checkpoint and tells
// clients hostTakeover is 0. See CoopProto for opcodes, the 20 Hz / 3-substep
// loop, and the 15 s grace.

namespace CoopMatch {
  /**
   * Live. The sim stays in this VM: Nakama's between-callback copy turns a Set
   * into an empty array and JSON-encodes the returned state, so packing the
   * world on every tick was the handler. Checkpoints still use exportState.
   * The vendored bundle is not modified.
   */
  export var ENABLED = true;

  export function open(ctx: nkruntime.Context): boolean {
    var env = ctx.env || null;
    if (env && env["COOP_AUTHORITATIVE"] === "1") return true;
    return ENABLED;
  }

  export interface AccountRec {
    userId: string;
    sessionId: string;
    generation: number;
    ready: boolean;
    /** -1 present, >=0 grace started at that tick, -2 released to CPU. */
    leftTick: number;
    devices: string[];
  }

  export interface State {
    phase: string;
    /** Nakama match id. The live sim is keyed by this, not carried in the copied state. */
    matchId: string;
    privateRoom: boolean;
    code: string;
    token: string;
    roster: string[];
    names: { [id: string]: string };
    seed: number;
    clockMs: number;
    createdTick: number;
    playTick: number;
    doneTick: number;
    lastCheckpointTick: number;
    endReason: string;
    broken: string;
    cleaned: boolean;
    session: CoopSession | null;
    accounts: { [id: string]: AccountRec };
    present: { [id: string]: nkruntime.Presence | null };
    inbox: { [frame: string]: { [accountId: string]: { [key: string]: unknown } } };
    lastFacts: CoopFacts | null;
    forceCheckpoint: boolean;
    samples: number[];
    sampleOver: number;
    snapBytes: number;
    snapCount: number;
    loopCount: number;
    /** Plain restart blob. Present only while the live sim is not in `session.state`. */
    simPacked: CoopExport | null;
    cold: boolean;
    /** Server-driven seed-3 six-seat fight. Empty in normal matches. */
    golden: string;
    goldenSeq: number;
    goldenPrimed: boolean;
    stateHash: string;
    /** Hub game-session id captured on the first join. A later socket does not replace it. */
    hubSid: { [id: string]: string };
    /** 1 after reconnect grace expires during the current encounter. */
    released: { [id: string]: number };
    /** neutralAlive frozen at disconnect so grace does not count as AFK. -1 means counting. */
    afkMark: { [id: string]: number };
    /** Encounter ids whose terminal decision already reached SQL. */
    paid: { [id: string]: number };
    /** Accounting day sealed at the first settle attempt. Retries do not recompute it. */
    payDay: { [id: string]: string };
    /** Set when a stage clear ends the encounter. Null on game over. Snapshotted so a retry cannot move the day, the score, or eligibility. */
    payFacts: {
      canonicalBossId: string;
      stageIndex: number;
      startTick: number;
      terminalTick: number;
      clearMs: number;
      god: number;
      practice: number;
      stageSelect: number;
      assistance: string;
      /** Account ids whose grace had already expired when the clear was sealed. */
      frozenReleased: { [id: string]: number };
      accounts: CoopRewards.PresenceRow[];
    } | null;
  }

  function fail(code: string, message: string): string {
    return HubRpc.fail(code, message);
  }

  function gate(ctx: nkruntime.Context): string | null {
    var vars = ctx.vars || null;
    if (!ctx.userId || !vars || vars["scope"] !== "game" || vars["game"] !== CoopProto.GAME_ID) return fail("wrong_scope", "Game session required");
    return null;
  }

  function ensureSim(nk: nkruntime.Nakama, logger: nkruntime.Logger): string | null {
    var mismatch = CoopProto.verifyRuntime(nk);
    if (!mismatch) return null;
    logger.error("sproto_coop pin " + mismatch);
    return fail("version_mismatch", "Simulation pin mismatch");
  }

  function bodyOf(payload: string): { [key: string]: unknown } | null {
    if (!payload) return {};
    if (payload.length > 4096) return null;
    try {
      var parsed = JSON.parse(payload) as unknown;
      if (!parsed || typeof parsed !== "object" || Object.prototype.toString.call(parsed) === "[object Array]") return null;
      return parsed as { [key: string]: unknown };
    } catch (e) {
      return null;
    }
  }

  function isObj(value: unknown): value is { [key: string]: unknown } {
    return typeof value === "object" && value !== null && Object.prototype.toString.call(value) !== "[object Array]";
  }

  function textOf(nk: nkruntime.Nakama, data: string | ArrayBuffer): string {
    return typeof data === "string" ? data : nk.binaryToString(data);
  }

  function parseJson(raw: string): { [key: string]: unknown } | null {
    try {
      var parsed = JSON.parse(raw) as unknown;
      return isObj(parsed) ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  function parseStringList(raw: unknown): string[] {
    if (typeof raw !== "string" || !raw) return [];
    try {
      var parsed = JSON.parse(raw) as unknown;
      if (Object.prototype.toString.call(parsed) !== "[object Array]") return [];
      var list = parsed as unknown[];
      var out: string[] = [];
      for (var i = 0; i < list.length; i++) {
        var id = String(list[i] || "");
        if (id) out.push(id);
      }
      return out;
    } catch (e) {
      return [];
    }
  }

  function parseNameMap(raw: unknown): { [id: string]: string } {
    var out: { [id: string]: string } = {};
    if (typeof raw !== "string" || !raw) return out;
    try {
      var parsed = JSON.parse(raw) as unknown;
      if (!isObj(parsed)) return out;
      for (var id in parsed) out[id] = String(parsed[id] || "").slice(0, 16);
    } catch (e) {
      return out;
    }
    return out;
  }

  function blankState(): State {
    return {
      phase: "lobby",
      matchId: "",
      privateRoom: false,
      code: "",
      token: "",
      roster: [],
      names: {},
      seed: 1,
      clockMs: Date.now(),
      createdTick: 0,
      playTick: 0,
      doneTick: 0,
      lastCheckpointTick: 0,
      endReason: "",
      broken: "",
      cleaned: false,
      session: null,
      accounts: {},
      present: {},
      inbox: {},
      lastFacts: null,
      forceCheckpoint: false,
      samples: [],
      sampleOver: 0,
      snapBytes: 0,
      snapCount: 0,
      loopCount: 0,
      simPacked: null,
      cold: false,
      golden: "",
      goldenSeq: 1,
      goldenPrimed: false,
      stateHash: "",
      hubSid: {},
      released: {},
      afkMark: {},
      paid: {},
      payDay: {},
      payFacts: null,
    };
  }

  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /** Restored checkpoints from before rewards omit these maps. They are plain objects, never a Set. */
  function maps(state: State): void {
    if (!state.hubSid) state.hubSid = {};
    if (!state.released) state.released = {};
    if (!state.afkMark) state.afkMark = {};
    if (!state.paid) state.paid = {};
    if (!state.payDay) state.payDay = {};
  }

  function rememberSid(state: State, userId: string, ctx: nkruntime.Context): void {
    maps(state);
    var vars = ctx.vars || null;
    if (!userId || !vars) return;
    var sid = vars["sid"] || "";
    if (!sid || state.hubSid[userId]) return;
    state.hubSid[userId] = sid;
  }

  function markAfk(state: State, account: AccountRec): void {
    maps(state);
    var session = state.session;
    var row = session && session.encounter ? session.encounter.accounts[account.userId] : null;
    state.afkMark[account.userId] = row ? row.neutralAlive : 0;
  }

  function clampGrace(state: State): void {
    maps(state);
    var session = state.session;
    if (!session || !session.encounter) return;
    for (var id in state.accounts) {
      var account = state.accounts[id];
      if (account.leftTick < 0) continue;
      var mark = state.afkMark[id];
      if (typeof mark !== "number" || mark < 0) continue;
      var row = session.encounter.accounts[id];
      if (row && row.neutralAlive > mark) row.neutralAlive = mark;
    }
  }

  function encounterKey(boss: string, start: number): string {
    return boss + ":" + String(start);
  }

  function copyPresence(facts: CoopFacts): CoopRewards.PresenceRow[] {
    var out: CoopRewards.PresenceRow[] = [];
    var accounts = facts.accounts || [];
    for (var i = 0; i < accounts.length; i++) {
      var row = accounts[i];
      var slots = row["slots"];
      var n = 0;
      if (Object.prototype.toString.call(slots) === "[object Array]") n = (slots as unknown[]).length;
      else if (typeof slots === "number") n = slots;
      out.push({
        accountId: String(row["accountId"] || ""),
        slots: n,
        presentAtStart: Number(row["presentAtStart"] || 0),
        nonNeutral: Number(row["nonNeutral"] || 0),
        neutralAlive: Number(row["neutralAlive"] || 0),
        downTicks: Number(row["downTicks"] || 0),
      });
    }
    return out;
  }

  function armPay(state: State, facts: CoopFacts, session: CoopSession): void {
    maps(state);
    var boss = String(facts.canonicalBossId || "");
    if (!boss || !CoopRewards.allowedBoss(boss)) return;
    var start = typeof facts.startTick === "number" ? facts.startTick : 0;
    var tick = session.state.t;
    var frames = tick - start;
    if (frames < 0) frames = 0;
    var clearMs = Math.round(frames * 1000 / 60);
    if (clearMs > 2700000) clearMs = 2700000;
    var human = 0;
    for (var i = 0; i < session.seats.length; i++) if (session.seats[i].human) human++;
    var encStage = typeof facts.stageIndex === "number" ? facts.stageIndex : session.state.stageIdx;
    var frozen: { [id: string]: number } = {};
    for (var id in state.released) if (state.released[id] === 1) frozen[id] = 1;
    state.payFacts = {
      canonicalBossId: boss,
      stageIndex: encStage,
      startTick: start,
      terminalTick: tick,
      clearMs: clearMs,
      god: session.state.god === true ? 1 : 0,
      practice: session.mode !== "banked" ? 1 : 0,
      stageSelect: session.state.stageIdx !== encStage ? 1 : 0,
      assistance: human >= 6 ? "all_human" : "cpu_assisted",
      frozenReleased: frozen,
      accounts: copyPresence(facts),
    };
  }

  function applyPay(ctx: nkruntime.Context, nk: nkruntime.Nakama, logger: nkruntime.Logger, state: State): void {
    maps(state);
    var facts = state.payFacts;
    var session = state.session;
    if (!facts || !session) return;
    var key = encounterKey(facts.canonicalBossId, facts.startTick);
    if (state.paid[key]) return;
    var mode = session.state.mode;
    if (mode !== "clear" && mode !== "victory" && state.payDay[key]) {
      state.paid[key] = 1;
      return;
    }
    if (!state.payDay[key]) {
      var day = CoopRewards.serverDay(nk);
      if (!day) return;
      state.payDay[key] = day;
    }
    var pending = false;
    for (var i = 0; i < facts.accounts.length; i++) {
      var row = facts.accounts[i];
      if (!row.accountId || !UUID.test(row.accountId)) continue;
      var sid = state.hubSid[row.accountId] || "";
      if (!UUID.test(sid)) {
        pending = true;
        logger.info("coop skip no session " + row.accountId);
        continue;
      }
      var frozen = facts.frozenReleased || {};
      var released = frozen[row.accountId] === 1;
      var decision = CoopRewards.decide(row, {
        practice: facts.practice === 1,
        god: facts.god === 1,
        stageSelect: facts.stageSelect === 1,
        released: released,
        knownBoss: true,
      }, CoopProtocol.LIMITS.afkAliveTicks);
      var reqHash = nk.sha256Hash("coop.settle\n" + row.accountId + "\n" + session.matchId + "\n" + key + "\n" + facts.canonicalBossId + "\n" + state.payDay[key]);
      var result = CoopRewards.settle(
        nk,
        row.accountId,
        sid,
        session.matchId || "",
        key,
        facts.canonicalBossId,
        state.payDay[key],
        facts.terminalTick,
        facts.clearMs,
        decision.eligible,
        decision.reason,
        row.slots,
        facts.assistance,
        reqHash,
      );
      if (result.error === "empty_result") return;
      logger.info("coop settle " + facts.canonicalBossId + " paid " + String(result.paid) + " tickets " + String(result.tickets) + " reason " + String(result.reason || result.error || "") + " user " + row.accountId);
      if (result.paid === true) HubFault.apply(ctx, nk, row.accountId, "coop.after_commit");
    }
    if (!pending) state.paid[key] = 1;
  }

  function labelFor(state: State): string {
    return JSON.stringify({
      game: CoopProto.GAME_ID,
      kind: CoopProto.KIND,
      protocol: CoopProto.PROTOCOL,
      fingerprint: CoopProto.FINGERPRINT,
      open: false,
      mode: "banked",
      rewards: 0,
      hostTakeover: 0,
      private: state.privateRoom ? 1 : 0,
      phase: state.phase,
    });
  }

  function relabel(d: nkruntime.MatchDispatcher, state: State): void {
    d.matchLabelUpdate(labelFor(state));
  }

  function send(d: nkruntime.MatchDispatcher, presence: nkruntime.Presence | null, op: number, body: { [key: string]: unknown }): void {
    if (!presence) return;
    d.broadcastMessage(op, JSON.stringify(body), [presence], null, true);
  }

  function recipients(state: State): nkruntime.Presence[] {
    var to: nkruntime.Presence[] = [];
    for (var id in state.present) {
      var presence = state.present[id];
      if (presence) to.push(presence);
    }
    return to;
  }

  function sendAll(d: nkruntime.MatchDispatcher, state: State, op: number, body: { [key: string]: unknown }): void {
    var to = recipients(state);
    if (to.length) d.broadcastMessage(op, JSON.stringify(body), to, null, true);
  }

  function sendRaw(d: nkruntime.MatchDispatcher, state: State, op: number, raw: string): void {
    var to = recipients(state);
    if (to.length) d.broadcastMessage(op, raw, to, null, true);
  }

  function scopeOk(ctx: nkruntime.Context): boolean {
    var vars = ctx.vars || null;
    return !!ctx.userId && !!vars && vars["scope"] === "game" && vars["game"] === CoopProto.GAME_ID;
  }

  function rosterAllows(state: State, userId: string): boolean {
    if (state.accounts[userId]) return true;
    if (state.privateRoom) return true;
    for (var i = 0; i < state.roster.length; i++) if (state.roster[i] === userId) return true;
    return false;
  }

  function seatView(state: State): { [key: string]: unknown }[] {
    var session = state.session;
    var out: { [key: string]: unknown }[] = [];
    if (!session) return out;
    for (var i = 0; i < session.seats.length; i++) {
      var seat = session.seats[i];
      var player = session.state.players[i];
      out.push({
        slot: seat.slot,
        accountId: seat.human && seat.accountId ? seat.accountId : "",
        device: seat.human ? seat.device : "",
        generation: seat.human ? seat.generation : 0,
        human: seat.human ? 1 : 0,
        ctrl: player.ctrl,
        lives: player.lives,
        hp: player.hp,
        fighter: player.fid,
        weapon: player.weapon,
        name: player.name,
      });
    }
    return out;
  }

  function broadcastSeats(d: nkruntime.MatchDispatcher, state: State): void {
    if (!state.session) return;
    sendAll(d, state, CoopProto.OP_SEATS, { t: "seats", tick: state.session.state.t, seats: seatView(state), rewards: 0, hostTakeover: 0 });
  }

  function reject(d: nkruntime.MatchDispatcher, presence: nkruntime.Presence, reason: string): void {
    send(d, presence, CoopProto.OP_REJECT, { t: "reject", reason: reason, rewards: 0, hostTakeover: 0 });
  }

  function countHuman(state: State): number {
    var session = state.session;
    if (!session) return 0;
    var n = 0;
    for (var i = 0; i < session.seats.length; i++) if (session.seats[i].human) n++;
    return n;
  }

  function countGrace(state: State): number {
    var n = 0;
    for (var id in state.accounts) {
      var account = state.accounts[id];
      if (account.leftTick >= 0 && account.devices.length) n++;
    }
    return n;
  }

  function seatFor(state: State, accountId: string, device: string): number {
    var session = state.session;
    if (!session) return -1;
    for (var i = 0; i < session.seats.length; i++) {
      var seat = session.seats[i];
      if (seat.human && seat.accountId === accountId && seat.device === device) return i;
    }
    return -1;
  }

  function freeSlot(state: State): number {
    var session = state.session;
    if (!session) return -1;
    for (var i = 0; i < session.seats.length; i++) if (!session.seats[i].human) return i;
    return -1;
  }

  function releaseAccount(state: State, account: AccountRec): void {
    var session = state.session;
    if (!session) return;
    var devices = account.devices.slice();
    for (var i = 0; i < devices.length; i++) {
      var slot = seatFor(state, account.userId, devices[i]);
      if (slot < 0) continue;
      CoopProtocol.releaseSeat(session, { slot: slot, accountId: account.userId, generation: account.generation });
    }
    account.devices = [];
  }

  function parkCpu(state: State, account: AccountRec): void {
    var session = state.session;
    if (!session) return;
    for (var i = 0; i < session.seats.length; i++) {
      var seat = session.seats[i];
      if (seat.human && seat.accountId === account.userId) session.state.players[i].ctrl = "cpu";
    }
  }

  function holdsDevice(account: AccountRec, device: string): boolean {
    return account.devices.indexOf(device) >= 0;
  }

  function copyStrings(list: string[]): string[] {
    var out: string[] = [];
    for (var i = 0; i < list.length; i++) out.push(list[i]);
    return out;
  }

  /** Seats are the source of truth. A devices array that was copied apart from them is rebuilt. */
  function syncDevices(state: State, account: AccountRec): void {
    var session = state.session;
    if (!session) return;
    var devices: string[] = [];
    for (var i = 0; i < session.seats.length; i++) {
      var seat = session.seats[i];
      if (seat.human && seat.accountId === account.userId && seat.device) devices.push(seat.device);
    }
    if (devices.length) account.devices = devices;
  }

  function parseDevices(raw: unknown): string[] | null {
    if (raw === undefined) return [];
    if (Object.prototype.toString.call(raw) !== "[object Array]") return null;
    var list = raw as unknown[];
    if (list.length > CoopProto.DEVICES.length) return null;
    var out: string[] = [];
    var seen: { [device: string]: boolean } = {};
    for (var i = 0; i < list.length; i++) {
      var device = String(list[i] || "");
      if (CoopProto.DEVICES.indexOf(device) < 0 || seen[device]) return null;
      seen[device] = true;
      out.push(device);
    }
    return out;
  }

  function generationBehind(state: State, account: AccountRec): boolean {
    var session = state.session;
    if (!session) return false;
    for (var i = 0; i < session.seats.length; i++) {
      var seat = session.seats[i];
      if (seat.human && seat.accountId === account.userId && seat.generation !== account.generation) return true;
    }
    return false;
  }

  function reattach(state: State, account: AccountRec): void {
    var session = state.session;
    if (!session) return;
    for (var i = 0; i < session.seats.length; i++) {
      var seat = session.seats[i];
      if (!seat.human || seat.accountId !== account.userId || !seat.device) continue;
      CoopProtocol.assignSeat(session, { slot: seat.slot, accountId: account.userId, device: seat.device, generation: account.generation });
    }
  }

  function kick(d: nkruntime.MatchDispatcher, state: State, userId: string): void {
    var old = state.present[userId];
    if (old) d.matchKick([old]);
  }

  function viewBody(state: State, account: AccountRec, kind: string): { [key: string]: unknown } {
    var session = state.session!;
    var snap = CoopProtocol.snapshotEnvelope(session);
    var full: CoopExport | null = null;
    if (kind === "resume") {
      try {
        full = Sim.exportState(session.state);
      } catch (e) {
        full = null;
      }
    }
    return {
      t: kind,
      protocol: CoopProto.PROTOCOL,
      fingerprint: CoopProto.FINGERPRINT,
      matchId: session.matchId,
      generation: account.generation,
      nextSeq: 1,
      tick: session.state.t,
      phase: state.phase,
      seats: seatView(state),
      yours: copyStrings(account.devices),
      snapshot: snap,
      full: full,
      rewards: 0,
      hostTakeover: 0,
      acceptClientState: 0,
      snapshotHz: 10,
      loopHz: CoopProto.TICK_RATE,
      substeps: CoopProto.SUBSTEPS,
      mode: "banked",
    };
  }

  function onHello(d: nkruntime.MatchDispatcher, logger: nkruntime.Logger, state: State, presence: nkruntime.Presence, msg: { [key: string]: unknown }): void {
    var session = state.session;
    if (!session || state.phase === "done") {
      reject(d, presence, "match_ended");
      return;
    }
    if (!CoopProto.versionsMatch(msg["protocol"], msg["fingerprint"])) {
      reject(d, presence, "version_mismatch");
      return;
    }
    if (CoopProto.banned(msg)) {
      reject(d, presence, "rejected");
      return;
    }
    var devices = parseDevices(msg["devices"]);
    if (!devices) {
      reject(d, presence, "device");
      return;
    }
    if (state.phase === "playing" && (msg["fighter"] !== undefined || msg["weapon"] !== undefined)) {
      reject(d, presence, "rejected");
      return;
    }
    var fighterIdx = -1;
    var weaponIdx = -1;
    if (msg["fighter"] !== undefined) {
      fighterIdx = CoopProto.fighterIndex(String(msg["fighter"]));
      if (fighterIdx < 0) {
        reject(d, presence, "fighter");
        return;
      }
    }
    if (msg["weapon"] !== undefined) {
      weaponIdx = CoopProto.weaponIndex(String(msg["weapon"]));
      if (weaponIdx < 0) {
        reject(d, presence, "weapon");
        return;
      }
    }
    var account = state.accounts[presence.userId];
    var reclaimed = false;
    if (!account) {
      if (!rosterAllows(state, presence.userId)) {
        reject(d, presence, "not_in_roster");
        return;
      }
      account = { userId: presence.userId, sessionId: presence.sessionId, generation: 1, ready: false, leftTick: -1, devices: [] };
      state.accounts[presence.userId] = account;
    } else if (account.sessionId !== presence.sessionId || generationBehind(state, account)) {
      reclaimed = account.devices.length > 0;
      if (account.sessionId !== presence.sessionId) {
        kick(d, state, presence.userId);
        account.sessionId = presence.sessionId;
        account.generation += 1;
        if (account.generation > 4294967295) account.generation = 1;
      }
      account.leftTick = -1;
      state.afkMark[presence.userId] = -1;
      reattach(state, account);
    }
    var before = JSON.stringify(CoopProtocol.lifeFacts(session.state));
    var need = 0;
    for (var n = 0; n < devices.length; n++) if (!holdsDevice(account, devices[n])) need++;
    if (need > 6 - countHuman(state)) {
      reject(d, presence, "match_full");
      return;
    }
    for (var i = 0; i < devices.length; i++) {
      if (holdsDevice(account, devices[i])) continue;
      var slot = freeSlot(state);
      if (slot < 0) {
        reject(d, presence, "match_full");
        return;
      }
      var assigned = CoopProtocol.assignSeat(session, { slot: slot, accountId: presence.userId, device: devices[i], generation: account.generation });
      if (!assigned.ok) {
        reject(d, presence, assigned.reason);
        return;
      }
      account.devices.push(devices[i]);
      var player = session.state.players[slot];
      if (fighterIdx >= 0) player.fid = fighterIdx;
      if (weaponIdx >= 0) player.weapon = weaponIdx;
      player.name = (state.names[presence.userId] || presence.username || "P" + String(slot + 1)).slice(0, 16);
    }
    if (JSON.stringify(CoopProtocol.lifeFacts(session.state)) !== before) state.broken = "life-reset";
    state.present[presence.userId] = presence;
    state.accounts[presence.userId] = account;
    var kind = reclaimed || account.generation > 1 ? "resume" : "welcome";
    send(d, presence, kind === "resume" ? CoopProto.OP_RESUME : CoopProto.OP_WELCOME, viewBody(state, account, kind));
    broadcastSeats(d, state);
  }

  function onReady(d: nkruntime.MatchDispatcher, state: State, presence: nkruntime.Presence): void {
    var account = state.accounts[presence.userId];
    if (!account || account.sessionId !== presence.sessionId) {
      reject(d, presence, "hello_required");
      return;
    }
    syncDevices(state, account);
    state.accounts[presence.userId] = account;
    if (!account.devices.length) {
      reject(d, presence, "seat");
      return;
    }
    if (state.phase !== "lobby") {
      reject(d, presence, "phase");
      return;
    }
    account.ready = true;
    state.accounts[presence.userId] = account;
    broadcastSeats(d, state);
  }

  function onRelease(d: nkruntime.MatchDispatcher, state: State, presence: nkruntime.Presence, msg: { [key: string]: unknown }): void {
    var session = state.session;
    var account = state.accounts[presence.userId];
    if (!session || !account || account.sessionId !== presence.sessionId) {
      reject(d, presence, "stale-socket");
      return;
    }
    var device = String(msg["device"] || "");
    if (CoopProto.DEVICES.indexOf(device) < 0) {
      reject(d, presence, "device");
      return;
    }
    var slot = seatFor(state, account.userId, device);
    if (slot < 0) {
      reject(d, presence, "seat");
      return;
    }
    var released = CoopProtocol.releaseSeat(session, { slot: slot, accountId: account.userId, generation: account.generation });
    if (!released.ok) {
      reject(d, presence, released.reason);
      return;
    }
    var left: string[] = [];
    for (var i = 0; i < account.devices.length; i++) if (account.devices[i] !== device) left.push(account.devices[i]);
    account.devices = left;
    if (!account.devices.length) account.ready = false;
    broadcastSeats(d, state);
  }

  function onInput(d: nkruntime.MatchDispatcher, state: State, presence: nkruntime.Presence, msg: { [key: string]: unknown }, rawLen: number): void {
    var session = state.session;
    if (rawLen > CoopProtocol.LIMITS.maxInputBytes) {
      reject(d, presence, "oversized");
      return;
    }
    if (!session || CoopProto.banned(msg) || msg["t"] !== "input") {
      reject(d, presence, "rejected");
      return;
    }
    var account = state.accounts[presence.userId];
    if (!account || account.sessionId !== presence.sessionId) {
      reject(d, presence, "stale-socket");
      return;
    }
    if (state.phase !== "playing") {
      reject(d, presence, "phase");
      return;
    }
    var frame = msg["frame"];
    if (typeof frame !== "number" || !Number.isFinite(frame) || Math.floor(frame) !== frame) {
      reject(d, presence, typeof frame === "number" && !Number.isFinite(frame) ? "nan" : "frame");
      return;
    }
    var tick = session.state.t;
    if (frame <= tick) {
      reject(d, presence, "stale");
      return;
    }
    if (frame > tick + 3) {
      reject(d, presence, "future");
      return;
    }
    msg["accountId"] = account.userId;
    msg["generation"] = account.generation;
    putInbox(state, String(frame), account.userId, msg);
  }

  /** Nakama's restored inbox ignores in-place writes. Replace the object. */
  function putInbox(state: State, frame: string, accountId: string, msg: { [key: string]: unknown }): void {
    var prev = state.inbox || {};
    var inbox: State["inbox"] = {};
    for (var key in prev) if (key !== frame) inbox[key] = prev[key];
    var bucket: { [accountId: string]: { [key: string]: unknown } } = {};
    var old = prev[frame];
    if (old) for (var id in old) bucket[id] = old[id];
    bucket[accountId] = msg;
    inbox[frame] = bucket;
    state.inbox = inbox;
  }

  function onCommand(d: nkruntime.MatchDispatcher, presence: nkruntime.Presence): void {
    reject(d, presence, "rejected");
  }

  function ingest(d: nkruntime.MatchDispatcher, logger: nkruntime.Logger, nk: nkruntime.Nakama, state: State, messages: nkruntime.MatchMessage[], tick: number): void {
    var counts: { [id: string]: number } = {};
    for (var i = 0; i < messages.length; i++) {
      var message = messages[i];
      var presence = message.sender;
      if (!presence || !presence.userId) continue;
      counts[presence.userId] = (counts[presence.userId] || 0) + 1;
      if (counts[presence.userId] > CoopProto.MAX_MSGS_PER_TICK) {
        reject(d, presence, "rate");
        continue;
      }
      var raw = textOf(nk, message.data);
      var op = message.opCode;
      if (raw.length > 2048 || (op === CoopProto.OP_INPUT && raw.length > CoopProtocol.LIMITS.maxInputBytes)) {
        reject(d, presence, "oversized");
        continue;
      }
      if (op === CoopProto.OP_PING) {
        var ping = parseJson(raw) || {};
        send(d, presence, CoopProto.OP_PONG, { t: "pong", c: ping["c"], s: tick, rewards: 0 });
        continue;
      }
      if (op === CoopProto.OP_COMMAND) {
        onCommand(d, presence);
        continue;
      }
      var msg = parseJson(raw);
      if (!msg) {
        reject(d, presence, "schema");
        continue;
      }
      if (op === CoopProto.OP_HELLO) onHello(d, logger, state, presence, msg);
      else if (op === CoopProto.OP_READY) onReady(d, state, presence);
      else if (op === CoopProto.OP_RELEASE) onRelease(d, state, presence, msg);
      else if (op === CoopProto.OP_INPUT) onInput(d, state, presence, msg, raw.length);
      else if (CoopProto.banned(msg)) onCommand(d, presence);
    }
  }

  function tryStart(d: nkruntime.MatchDispatcher, logger: nkruntime.Logger, state: State, tick: number): void {
    if (state.phase !== "lobby" || !state.session) return;
    if (tick - state.createdTick >= CoopProto.LOBBY_S * CoopProto.TICK_RATE) {
      state.endReason = "room_expired";
      state.phase = "ending";
      return;
    }
    var seated = 0;
    var waiting = false;
    var ids = Object.keys(state.accounts);
    for (var n = 0; n < ids.length; n++) {
      var account = state.accounts[ids[n]];
      syncDevices(state, account);
      if (!account.devices.length) continue;
      seated++;
      if (!account.ready || !state.present[ids[n]]) waiting = true;
    }
    if (!seated || waiting) return;
    if (!state.privateRoom && state.roster.length) {
      var joined = 0;
      for (var i = 0; i < state.roster.length; i++) {
        var member = state.accounts[state.roster[i]];
        if (member && member.devices.length && state.present[state.roster[i]]) joined++;
      }
      if (joined < state.roster.length && tick - state.createdTick < CoopProto.QUICK_FILL_S * CoopProto.TICK_RATE) return;
    }
    var begun = CoopProtocol.beginEncounter(state.session);
    if (!begun.ok) {
      state.broken = begun.reason;
      return;
    }
    state.phase = "playing";
    state.playTick = tick;
    state.forceCheckpoint = true;
    sendAll(d, state, CoopProto.OP_START, {
      t: "start",
      protocol: CoopProto.PROTOCOL,
      fingerprint: CoopProto.FINGERPRINT,
      matchId: state.session.matchId,
      tick: state.session.state.t,
      seed: state.seed,
      stageIndex: 0,
      seats: seatView(state),
      snapshot: CoopProtocol.snapshotEnvelope(state.session),
      rewards: 0,
      hostTakeover: 0,
      mode: "banked",
    });
    relabel(d, state);
  }

  function settle(state: State, beforeStage: number, beforeMode: string): void {
    var session = state.session;
    if (!session) return;
    maps(state);
    var term = CoopProtocol.terminalFacts(session);
    var stageChanged = term.stageIndex !== beforeStage;
    var cleared = term.encounterCleared === 1 || term.gameOver === 1 || term.victory === 1 || term.mode === "clear" || stageChanged || (beforeMode === "play" && term.mode !== "play");
    var wasClear = beforeMode === "play" && (term.mode === "clear" || term.encounterCleared === 1);
    if (session.encounter && cleared) {
      if (wasClear) clampGrace(state);
      var ended = CoopProtocol.endEncounter(session);
      state.lastFacts = ended;
      if (wasClear) armPay(state, ended, session);
    }
    term = CoopProtocol.terminalFacts(session);
    if (!session.encounter && term.mode === "play" && term.gameOver !== 1 && term.victory !== 1) {
      CoopProtocol.beginEncounter(session);
      state.released = {};
      state.afkMark = {};
    }
  }

  function takeGroups(state: State): { [key: string]: unknown }[][] {
    var session = state.session!;
    var tick = session.state.t;
    var prev = state.inbox || {};
    var groups: { [key: string]: unknown }[][] = [[], [], []];
    var keep: State["inbox"] = {};
    for (var frame in prev) {
      var n = Number(frame);
      if (n === tick + 1 || n === tick + 2 || n === tick + 3) {
        var index = n - tick - 1;
        var bucket = prev[frame];
        for (var accountId in bucket) groups[index].push(bucket[accountId]);
      } else if (n > tick) keep[frame] = prev[frame];
    }
    state.inbox = keep;
    return groups;
  }

  function advanceClock(state: State): number {
    var wall = Date.now();
    var next = state.clockMs + 50;
    if (wall > next) next = wall;
    state.clockMs = next;
    return next;
  }

  function accountRows(state: State): { [key: string]: unknown }[] {
    var out: { [key: string]: unknown }[] = [];
    for (var id in state.accounts) {
      var account = state.accounts[id];
      out.push({ userId: account.userId, generation: account.generation, devices: copyStrings(account.devices), ready: account.ready });
    }
    return out;
  }

  function saveCheckpoint(nk: nkruntime.Nakama, logger: nkruntime.Logger, state: State, matchId: string, resumable: boolean, phase: string): void {
    var session = state.session;
    if (!session || !matchId) return;
    var exported: CoopExport;
    try {
      exported = Sim.exportState(session.state);
    } catch (e) {
      logger.warn("sproto_coop checkpoint " + String(e));
      return;
    }
    var value: { [key: string]: unknown } = {
      kind: "sproto-coop-battle-checkpoint",
      version: 1,
      matchId: matchId,
      protocol: CoopProto.PROTOCOL,
      fingerprint: CoopProto.FINGERPRINT,
      resumable: resumable,
      phase: phase,
      seed: state.seed,
      clockMs: state.clockMs,
      privateRoom: state.privateRoom,
      roster: copyStrings(state.roster),
      names: state.names,
      accounts: accountRows(state),
      seats: JSON.parse(JSON.stringify(session.seats)),
      seq: JSON.parse(JSON.stringify(session.seq)),
      limiters: JSON.parse(JSON.stringify(session.limiters)),
      loops: session.loops,
      encounter: session.encounter ? JSON.parse(JSON.stringify(session.encounter)) : null,
      closedEncounter: session.closedEncounter ? JSON.parse(JSON.stringify(session.closedEncounter)) : null,
      exported: exported,
      rewards: 0,
      hubSid: state.hubSid,
      released: state.released,
      afkMark: state.afkMark,
      paid: state.paid,
      payDay: state.payDay,
      payFacts: state.payFacts,
      stateHash: state.stateHash,
      endReason: state.endReason,
      simTick: session.state.t,
      savedAt: Date.now(),
    };
    if (JSON.stringify(value).length > 200000) {
      logger.warn("sproto_coop checkpoint oversized " + matchId);
      return;
    }
    try {
      CoopMm.writeCheckpoint(nk, matchId, value);
    } catch (e) {
      logger.warn("sproto_coop checkpoint write " + String(e));
    }
  }

  function finish(nk: nkruntime.Nakama, logger: nkruntime.Logger, d: nkruntime.MatchDispatcher, state: State, tick: number, reason: string, matchId: string): void {
    if (state.phase === "done") return;
    var resumable = reason === "server_shutdown";
    var storedPhase = state.phase === "playing" || state.phase === "lobby" ? state.phase : "playing";
    if (state.session && state.session.encounter) {
      try {
        state.lastFacts = CoopProtocol.endEncounter(state.session);
      } catch (e) {
        logger.warn("sproto_coop encounter " + String(e));
      }
    }
    state.endReason = reason;
    state.phase = "done";
    state.doneTick = tick;
    var terminal: { [key: string]: unknown } = { tickets: 0, scoreSubmitted: 0 };
    if (state.session) {
      var facts = CoopProtocol.terminalFacts(state.session);
      terminal = {
        tick: facts.tick,
        mode: facts.mode,
        stageIndex: facts.stageIndex,
        canonicalBossId: facts.canonicalBossId,
        encounterCleared: facts.encounterCleared,
        victory: facts.victory,
        gameOver: facts.gameOver,
        tickets: facts.tickets,
        scoreSubmitted: facts.scoreSubmitted,
      };
    }
    state.stateHash = hashOf(nk, state);
    saveCheckpoint(nk, logger, state, matchId, resumable, resumable ? storedPhase : "done");
    sendAll(d, state, CoopProto.OP_END, {
      t: "end",
      reason: reason,
      rewards: 0,
      scoreSubmitted: 0,
      hostTakeover: 0,
      resume: resumable ? "server" : "",
      checkpoint: 1,
      acceptClientState: 0,
      terminal: terminal,
      facts: state.lastFacts,
      matchId: matchId,
      stateHash: state.stateHash,
      tick: state.session && state.session.state ? state.session.state.t : 0,
    });
    relabel(d, state);
  }

  function cleanup(nk: nkruntime.Nakama, state: State, matchId: string): void {
    if (state.cleaned) return;
    state.cleaned = true;
    if (state.code) CoopMm.releaseCode(nk, state.code);
    if (state.token) CoopMm.forgetGroup(nk, state.token);
    for (var id in state.accounts) CoopMm.clearLive(nk, id, matchId);
  }

  function asExport(value: unknown): CoopExport | null {
    if (!isObj(value)) return null;
    if (value["kind"] !== Sim.STATE_KIND || value["version"] !== 1 || !isObj(value["state"])) return null;
    return { kind: String(value["kind"]), version: 1, state: value["state"] as { [key: string]: unknown } };
  }

  function restoreAccounts(raw: unknown, playing: boolean): { [id: string]: AccountRec } {
    var out: { [id: string]: AccountRec } = {};
    if (Object.prototype.toString.call(raw) !== "[object Array]") return out;
    var list = raw as unknown[];
    for (var i = 0; i < list.length; i++) {
      if (!isObj(list[i])) continue;
      var row = list[i] as { [key: string]: unknown };
      var userId = String(row["userId"] || "");
      if (!userId) continue;
      var devices: string[] = [];
      if (Object.prototype.toString.call(row["devices"]) === "[object Array]") {
        var listed = row["devices"] as unknown[];
        for (var d = 0; d < listed.length; d++) {
          var name = String(listed[d] || "");
          if (CoopProto.DEVICES.indexOf(name) >= 0) devices.push(name);
        }
      }
      var generation = Number(row["generation"]);
      if (!generation || generation < 1) generation = 1;
      out[userId] = {
        userId: userId,
        sessionId: "",
        generation: generation,
        ready: row["ready"] === true,
        leftTick: playing && devices.length ? 0 : -1,
        devices: devices,
      };
    }
    return out;
  }

  function memberOf(raw: unknown, userId: string): boolean {
    if (Object.prototype.toString.call(raw) !== "[object Array]") return false;
    var list = raw as unknown[];
    for (var i = 0; i < list.length; i++) {
      if (isObj(list[i]) && String((list[i] as { [key: string]: unknown })["userId"] || "") === userId) return true;
    }
    return false;
  }

  var GOLDEN_ACCOUNT = "00000000-0000-4000-8000-000000000000";

  interface GoldenActor { x: number; y: number; dead?: boolean; st?: string; hp?: number; face?: number; w?: number; slot?: number; ctrl?: string; powers?: unknown[] }
  interface GoldenSim {
    t: number;
    players: GoldenActor[];
    enemies?: GoldenActor[];
    items?: { x: number; y: number; kind: string; taken?: boolean }[];
    projs?: { x: number; y: number; enemy?: boolean }[];
    boss?: GoldenActor | null;
  }

  /** Same mask the seed-3 Node driver uses, so Nakama and Node step the same fight. */
  function goldenMask(sim: GoldenSim, slot: number, tick: number): number {
    var p = sim.players[slot];
    if (!p || p.ctrl === "cpu" || p.st === "dead" || p.st === "down") return 0;
    var foe: { x: number; y: number } | null = null;
    var best = 1e9;
    var enemies = sim.enemies || [];
    for (var e = 0; e < enemies.length; e++) {
      var enemy = enemies[e];
      if (enemy.dead || enemy.st === "lying") continue;
      var dist = Math.abs(enemy.x - p.x) + Math.abs(enemy.y - p.y) * 2;
      if (dist < best) { best = dist; foe = enemy; }
    }
    var boss = sim.boss;
    if (boss && (boss.hp || 0) > 0 && boss.st !== "enter" && boss.st !== "dead") {
      var bossDist = Math.abs(boss.x - p.x) * 0.7 + 30;
      if (!foe || bossDist < best) foe = { x: boss.x - (boss.face || 1) * ((boss.w || 0) * 0.45), y: boss.y };
    }
    var ufo: { x: number; y: number } | null = null;
    var power: { x: number; y: number } | null = null;
    var items = sim.items || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].taken) continue;
      if (!ufo && items[i].kind === "ufo") ufo = items[i];
      if (!power && items[i].kind === "power") power = items[i];
    }
    var goal: { x: number; y: number } | null = null;
    var chasingFoe = !ufo && !(power && (p.powers ? p.powers.length : 0) < 3 && p.slot === tick % 6);
    if (ufo && slot === 0) goal = ufo;
    else if (power && (p.powers ? p.powers.length : 0) < 3 && p.slot === tick % 6) goal = power;
    else if (foe) goal = foe;
    var l = 0, r = 0, u = 0, d = 0, a = 0, j = 0, special = 0;
    if (!goal) r = 1;
    else {
      var dx = goal.x - p.x;
      var dy = goal.y - p.y;
      if (dx > 18) r = 1; else if (dx < -18) l = 1;
      if (dy > 6) d = 1; else if (dy < -6) u = 1;
      var near = Math.abs(dx) < (chasingFoe && goal === foe ? 54 : 16) && Math.abs(dy) < 16;
      if (near && goal === foe && tick % 8 === slot % 8) a = 1;
    }
    if ((p.powers ? p.powers.length : 0) > 0 && tick % 240 === slot * 3) special = 1;
    if (tick % 5 === 0) {
      var projs = sim.projs || [];
      for (var q = 0; q < projs.length; q++) {
        if (projs[q].enemy && Math.abs(projs[q].y - p.y) < 12 && Math.abs(projs[q].x - p.x) < 40) { j = 1; break; }
      }
    }
    return l | (r << 1) | (u << 2) | (d << 3) | (a << 4) | (j << 5) | (special << 7);
  }

  function queueGolden(state: State): void {
    if (state.golden !== "human-seed3" || !state.goldenPrimed || !state.session) return;
    var session = state.session;
    var base = session.state.t;
    var account = state.accounts[GOLDEN_ACCOUNT];
    if (!account) return;
    for (var offset = 0; offset < 3; offset++) {
      var seats: { [key: string]: unknown }[] = [];
      for (var slot = 0; slot < CoopProto.DEVICES.length; slot++) {
        seats.push({
          slot: slot,
          device: CoopProto.DEVICES[slot],
          mask: goldenMask(session.state as unknown as GoldenSim, slot, base + offset),
        });
      }
      putInbox(state, String(base + 1 + offset), GOLDEN_ACCOUNT, {
        t: "input",
        accountId: GOLDEN_ACCOUNT,
        generation: account.generation,
        seq: state.goldenSeq,
        frame: base + 1 + offset,
        seats: seats,
      });
      state.goldenSeq++;
    }
  }

  function adopt(stored: CoopSession, sim: CoopSimState): CoopSession {
    var next = {} as CoopSession & { [key: string]: unknown };
    var source = stored as CoopSession & { [key: string]: unknown };
    for (var key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key) && key !== "state") next[key] = source[key];
    }
    next.state = sim;
    return next;
  }

  /** Live sims for this VM. A per-tick export made the copied state carry the world. */
  var liveSessions: { [matchId: string]: CoopSession } = {};

  export function liveSession(matchId: string): CoopSession | null {
    return matchId && liveSessions[matchId] ? liveSessions[matchId] : null;
  }

  function liveSim(session: CoopSession | null): session is CoopSession {
    return !!(session && session.state && session.state.players && session.state.players.length === 6);
  }

  function thaw(state: State): void {
    var held = state.matchId ? liveSessions[state.matchId] : null;
    if (liveSim(held)) {
      state.session = held;
      state.cold = false;
      return;
    }
    if (!state.cold || !state.simPacked || !state.session) return;
    // A resumed or restarted match has only the packed checkpoint. Import once.
    state.session = adopt(state.session, Sim.importState(state.simPacked));
    state.cold = false;
    if (state.matchId) liveSessions[state.matchId] = state.session;
  }

  /** Drop the live sim (Sets, target refs) before Nakama copies the match state. */
  function freeze(state: State): void {
    var session = state.session;
    if (!session || !session.state || state.cold) return;
    if (!session.state.players || session.state.players.length !== 6) return;
    var events = session.state.events;
    if (events && events.length) events.length = 0;
    var packed: CoopExport;
    try {
      packed = Sim.exportState(session.state);
    } catch (e) {
      return;
    }
    state.simPacked = packed;
    var packedState = packed.state as { t?: number; mode?: string; stageIdx?: number; god?: boolean };
    state.session = adopt(session, {
      t: typeof packedState.t === "number" ? packedState.t : 0,
      mode: typeof packedState.mode === "string" ? packedState.mode : "play",
      stageIdx: typeof packedState.stageIdx === "number" ? packedState.stageIdx : 0,
      god: packedState.god === true,
      events: [],
      players: [],
    });
    state.cold = true;
  }

  function ret(state: State): { state: State } {
    var session = state.session;
    if (state.cleaned) {
      if (state.matchId) delete liveSessions[state.matchId];
    } else if (liveSim(session) && state.matchId) {
      liveSessions[state.matchId] = session;
    }
    if (liveSim(session)) {
      state.session = adopt(session, {
        t: session.state.t,
        mode: session.state.mode,
        stageIdx: session.state.stageIdx,
        god: session.state.god === true,
        events: [],
        players: [],
      });
      state.simPacked = null;
      state.cold = true;
      return { state: state };
    }
    freeze(state);
    return { state: state };
  }

  function copyRow(value: { [key: string]: unknown }): { [key: string]: unknown } {
    var out: { [key: string]: unknown } = {};
    for (var key in value) out[key] = value[key];
    return out;
  }

  export function attach(): void {
    HubGames.attach(CoopProto.GAME_ID, { matchmaker: CoopMm.onMatched });
  }

  export var handler: nkruntime.MatchHandler<State> = {
    matchInit: function (ctx, logger, nk, params) {
      if (!open(ctx)) throw new Error("capacity_dark");
      var mismatch = CoopProto.verifyRuntime(nk);
      if (mismatch) {
        logger.error("sproto_coop pin " + mismatch);
        throw new Error("version_mismatch");
      }
      var state = blankState();
      state.matchId = ctx.matchId || "";
      var resumeId = String(params["resume"] || "");
      var seed = CoopProto.serverSeed();
      if (!resumeId && String(params["seedSource"] || "") === "server") {
        var given = Number(params["seed"]);
        if (given > 0 && given < 4294967296 && Math.floor(given) === given) seed = given >>> 0;
      }
      state.seed = seed;
      state.privateRoom = String(params["private"] || "") === "1";
      state.code = String(params["code"] || "");
      state.token = String(params["token"] || "");
      state.roster = parseStringList(params["roster"]);
      state.names = parseNameMap(params["names"]);
      var created = CoopProtocol.createMatch({ mode: "banked", seed: seed === 0 ? 1 : seed, matchId: ctx.matchId || "" });
      if (!created.ok) throw new Error("sim_fault");
      state.session = created.session;
      if (resumeId) {
        var row = CoopMm.readCheckpoint(nk, resumeId);
        if (!row || row.value["resumable"] !== true) throw new Error("checkpoint_invalid");
        if (String(row.value["fingerprint"] || "") !== CoopProto.FINGERPRINT || Number(row.value["protocol"]) !== CoopProto.PROTOCOL) throw new Error("version_mismatch");
        var exported = asExport(row.value["exported"]);
        var seats = row.value["seats"];
        if (!exported || Object.prototype.toString.call(seats) !== "[object Array]" || (seats as unknown[]).length !== 6) throw new Error("checkpoint_invalid");
        state.session.state = Sim.importState(exported);
        state.session.seats = seats as CoopSeat[];
        state.session.seq = isObj(row.value["seq"]) ? row.value["seq"] as { [key: string]: number } : {};
        state.session.limiters = isObj(row.value["limiters"]) ? row.value["limiters"] as { [key: string]: { tokens: number; last: number } } : {};
        state.session.loops = Number(row.value["loops"]) || 0;
        state.session.encounter = isObj(row.value["encounter"]) ? row.value["encounter"] as unknown as CoopEncounter : null;
        state.session.closedEncounter = isObj(row.value["closedEncounter"]) ? row.value["closedEncounter"] as unknown as CoopEncounter : null;
        state.seed = Number(row.value["seed"]) || state.seed;
        state.clockMs = Number(row.value["clockMs"]) || state.clockMs;
        state.privateRoom = row.value["privateRoom"] === true;
        state.roster = parseStringList(JSON.stringify(row.value["roster"] || []));
        state.names = isObj(row.value["names"]) ? row.value["names"] as { [id: string]: string } : {};
        var playing = String(row.value["phase"] || "playing") === "playing";
        state.phase = playing ? "playing" : "lobby";
        state.accounts = restoreAccounts(row.value["accounts"], playing);
        state.hubSid = isObj(row.value["hubSid"]) ? row.value["hubSid"] as { [id: string]: string } : {};
        state.released = isObj(row.value["released"]) ? row.value["released"] as { [id: string]: number } : {};
        state.afkMark = isObj(row.value["afkMark"]) ? row.value["afkMark"] as { [id: string]: number } : {};
        state.paid = isObj(row.value["paid"]) ? row.value["paid"] as { [id: string]: number } : {};
        state.payDay = isObj(row.value["payDay"]) ? row.value["payDay"] as { [id: string]: string } : {};
        state.payFacts = isObj(row.value["payFacts"]) ? row.value["payFacts"] as State["payFacts"] : null;
        if (playing) {
          for (var id in state.accounts) parkCpu(state, state.accounts[id]);
          if (!state.session.encounter && state.session.state.mode === "play") CoopProtocol.beginEncounter(state.session);
        }
        for (var accountId in state.accounts) CoopMm.setLive(nk, accountId, ctx.matchId || "");
      }
      if (!resumeId && String(params["golden"] || "") === "human-seed3") {
        state.golden = "human-seed3";
        var goldenAccount: AccountRec = { userId: GOLDEN_ACCOUNT, sessionId: "golden", generation: 1, ready: true, leftTick: -1, devices: [] };
        state.accounts[GOLDEN_ACCOUNT] = goldenAccount;
        state.names[GOLDEN_ACCOUNT] = "ada";
        for (var g = 0; g < CoopProto.DEVICES.length; g++) {
          var device = CoopProto.DEVICES[g];
          var assigned = CoopProtocol.assignSeat(state.session, { slot: g, accountId: GOLDEN_ACCOUNT, device: device, generation: 1 });
          if (!assigned.ok) throw new Error("sim_fault");
          goldenAccount.devices.push(device);
          state.session.state.players[g].name = "ada";
        }
        state.accounts[GOLDEN_ACCOUNT] = goldenAccount;
        var begunGolden = CoopProtocol.beginEncounter(state.session);
        if (!begunGolden.ok) throw new Error("sim_fault");
        state.phase = "playing";
        state.playTick = 0;
        state.forceCheckpoint = true;
      }
      logger.info("sproto_coop init " + (ctx.matchId || "") + (resumeId ? " resume" : ""));
      return { state: ret(state).state, tickRate: CoopProto.TICK_RATE, label: labelFor(state) };
    },

    matchJoinAttempt: function (ctx, _logger, nk, _d, _tick, state, presence, metadata) {
      thaw(state);
      if (presence && presence.userId) rememberSid(state, presence.userId, ctx);
      if (!open(ctx)) return { state: ret(state).state, accept: false, rejectMessage: "capacity_dark" };
      if (state.phase === "done" || state.broken) return { state: ret(state).state, accept: false, rejectMessage: "match_ended" };
      if (!scopeOk(ctx)) return { state: ret(state).state, accept: false, rejectMessage: "wrong_scope" };
      if (metadata) {
        var protocol = metadata["protocol"] !== undefined ? metadata["protocol"] : metadata["v"];
        var fingerprint = metadata["fingerprint"] !== undefined ? metadata["fingerprint"] : metadata["sim"];
        if (fingerprint !== undefined && !CoopProto.versionsMatch(protocol, fingerprint)) return { state: ret(state).state, accept: false, rejectMessage: "version_mismatch" };
        if (fingerprint === undefined && protocol !== undefined && Number(protocol) !== CoopProto.PROTOCOL) return { state: ret(state).state, accept: false, rejectMessage: "version_mismatch" };
      }
      var live = CoopMm.liveMatch(nk, presence.userId);
      if (live && live !== (ctx.matchId || "")) return { state: ret(state).state, accept: false, rejectMessage: "already_in_match" };
      if (!rosterAllows(state, presence.userId)) return { state: ret(state).state, accept: false, rejectMessage: "not_in_roster" };
      if (!state.accounts[presence.userId] && countHuman(state) >= 6) return { state: ret(state).state, accept: false, rejectMessage: "match_full" };
      return { state: ret(state).state, accept: true };
    },

    matchJoin: function (_ctx, _logger, nk, d, _tick, state, presences) {
      thaw(state);
      for (var i = 0; i < presences.length; i++) {
        var presence = presences[i];
        var account = state.accounts[presence.userId];
        if (account && account.sessionId && account.sessionId !== presence.sessionId) {
          kick(d, state, presence.userId);
          account.sessionId = presence.sessionId;
          account.generation += 1;
          if (account.generation > 4294967295) account.generation = 1;
        }
        state.present[presence.userId] = presence;
        if (!state.names[presence.userId]) state.names[presence.userId] = String(presence.username || "").slice(0, 16);
        CoopMm.setLive(nk, presence.userId, _ctx.matchId || "");
      }
      return ret(state);
    },

    matchLeave: function (_ctx, _logger, _nk, d, tick, state, presences) {
      thaw(state);
      maps(state);
      for (var i = 0; i < presences.length; i++) {
        var presence = presences[i];
        var account = state.accounts[presence.userId];
        var current = state.present[presence.userId];
        if (!current || current.sessionId !== presence.sessionId) continue;
        state.present[presence.userId] = null;
        if (!account || !account.devices.length) continue;
        if (state.phase === "lobby") {
          releaseAccount(state, account);
          account.ready = false;
          account.leftTick = -1;
        } else if (state.phase === "playing") {
          account.leftTick = tick;
          parkCpu(state, account);
          markAfk(state, account);
        }
      }
      broadcastSeats(d, state);
      return ret(state);
    },

    matchLoop: function (ctx, logger, nk, d, tick, state, messages) {
      var started = Date.now();
      thaw(state);
      maps(state);
      var matchId = ctx.matchId || "";
      if (state.broken && state.phase !== "done") finish(nk, logger, d, state, tick, "sim_fault", matchId);
      if (state.phase === "ending") finish(nk, logger, d, state, tick, state.endReason || "room_expired", matchId);
      if (state.phase === "done") {
        if (tick - state.doneTick > CoopProto.LINGER_S * CoopProto.TICK_RATE) {
          cleanup(nk, state, matchId);
          freeze(state);
          return null;
        }
        return ret(state);
      }
      ingest(d, logger, nk, state, messages, tick);
      if (state.broken && state.phase !== "done") finish(nk, logger, d, state, tick, "sim_fault", matchId);
      if (state.phase === "done") return ret(state);
      if (state.phase === "lobby") tryStart(d, logger, state, tick);
      if (state.phase === "ending") finish(nk, logger, d, state, tick, state.endReason || "room_expired", matchId);
      if (state.phase !== "playing" || !state.session) return ret(state);
      var stepped = false;
      var released = false;
      for (var id in state.accounts) {
        var account = state.accounts[id];
        if (account.leftTick >= 0 && account.devices.length && tick - account.leftTick >= CoopProto.RECONNECT_S * CoopProto.TICK_RATE) {
          releaseAccount(state, account);
          account.leftTick = -2;
          account.ready = false;
          state.released[account.userId] = 1;
          CoopMm.clearLive(nk, account.userId, matchId);
          released = true;
        }
      }
      if (released) broadcastSeats(d, state);
      if (countHuman(state) === 0 && countGrace(state) === 0) {
        finish(nk, logger, d, state, tick, "abandoned", matchId);
        return ret(state);
      }
      if (tick - state.playTick >= CoopProto.MAX_PLAY_S * CoopProto.TICK_RATE) {
        finish(nk, logger, d, state, tick, "max_play", matchId);
        return ret(state);
      }
      if (state.golden === "human-seed3") {
        if (!state.goldenPrimed) state.goldenPrimed = true;
        else queueGolden(state);
      }
      var beforeStage = state.session.state.stageIdx;
      var beforeMode = state.session.state.mode;
      var now = advanceClock(state);
      try {
        var advanced = CoopProto.advance(state.session, takeGroups(state), now);
        if (!advanced.ok) {
          logger.error("sproto_coop step " + advanced.reason);
          finish(nk, logger, d, state, tick, "sim_fault", matchId);
          return ret(state);
        }
        for (var r = 0; r < advanced.rejected.length; r++) {
          var who = state.present[advanced.rejected[r].accountId];
          if (who) reject(d, who, advanced.rejected[r].reason);
        }
        clampGrace(state);
        settle(state, beforeStage, beforeMode);
        try {
          applyPay(ctx, nk, logger, state);
        } catch (payErr) {
          var payMessage = String(payErr);
          if (payMessage.indexOf("fault_injected") < 0) logger.error("sproto_coop settle " + payMessage);
          else logger.warn("sproto_coop fault after commit");
        }
        if (advanced.snapshot) {
          var raw = JSON.stringify(advanced.snapshot);
          state.snapBytes += raw.length;
          state.snapCount++;
          sendRaw(d, state, CoopProto.OP_SNAPSHOT, raw);
        }
        stepped = true;
      } catch (e) {
        logger.error("sproto_coop step " + String(e));
        finish(nk, logger, d, state, tick, "sim_fault", matchId);
        return ret(state);
      }
      if (state.session.state.mode === "gameover") finish(nk, logger, d, state, tick, "gameover", matchId);
      else if (state.session.state.mode === "victory") finish(nk, logger, d, state, tick, "victory", matchId);
      else if (state.forceCheckpoint || tick - state.lastCheckpointTick >= CoopProto.CHECKPOINT_LOOPS) {
        saveCheckpoint(nk, logger, state, matchId, true, "playing");
        state.forceCheckpoint = false;
        state.lastCheckpointTick = tick;
      }
      if (stepped) {
        var dt = Date.now() - started;
        state.samples.push(dt);
        if (state.samples.length > 512) state.samples.shift();
        if (dt >= 25) state.sampleOver++;
        state.loopCount++;
      }
      return ret(state);
    },

    matchTerminate: function (ctx, logger, nk, d, tick, state, _grace) {
      thaw(state);
      var matchId = ctx.matchId || "";
      if (state.phase !== "done") finish(nk, logger, d, state, tick, "server_shutdown", matchId);
      else saveCheckpoint(nk, logger, state, matchId, false, "done");
      cleanup(nk, state, matchId);
      return ret(state);
    },

    matchSignal: function (_ctx, _logger, nk, _d, _tick, state, data) {
      thaw(state);
      if (data === "reset-metrics") {
        state.samples = [];
        state.sampleOver = 0;
        state.snapBytes = 0;
        state.snapCount = 0;
        state.loopCount = 0;
        return { state: ret(state).state, data: "{\"ok\":true}" };
      }
      if (data === "hash" || data === "metrics") {
        var body = data === "hash" ? JSON.stringify({ stateHash: state.stateHash, tick: state.session ? state.session.state.t : 0, phase: state.phase, mode: state.session ? state.session.state.mode : "", endReason: state.endReason, rewards: 0 }) : JSON.stringify(metricsOf(state));
        return { state: ret(state).state, data: body };
      }
      return { state: ret(state).state, data: data };
    },
  };

  function hashOf(nk: nkruntime.Nakama, state: State): string {
    var packed = state.simPacked;
    if (!state.cold && state.session && state.session.state && state.session.state.players.length === 6) {
      try {
        var events = state.session.state.events;
        if (events && events.length) events.length = 0;
        packed = Sim.exportState(state.session.state);
      } catch (e) {
        packed = state.simPacked;
      }
    }
    if (!packed) return "";
    return nk.sha256Hash(JSON.stringify(packed));
  }

  function percentile(samples: number[], p: number): number {
    if (!samples.length) return 0;
    var copy = samples.slice();
    copy.sort(function (a, b) { return a - b; });
    var idx = Math.ceil((p / 100) * copy.length) - 1;
    if (idx < 0) idx = 0;
    if (idx >= copy.length) idx = copy.length - 1;
    return copy[idx];
  }

  function metricsOf(state: State): { [key: string]: unknown } {
    return {
      n: state.samples.length,
      p50: percentile(state.samples, 50),
      p95: percentile(state.samples, 95),
      max: state.samples.length ? percentile(state.samples, 100) : 0,
      over25: state.sampleOver,
      snapBytes: state.snapBytes,
      snapCount: state.snapCount,
      loops: state.loopCount,
      tick: state.session ? state.session.state.t : 0,
      mode: state.session ? state.session.state.mode : "",
      seats: countHuman(state),
      phase: state.phase,
      endReason: state.endReason,
      stateHash: state.stateHash,
      rewards: 0,
      hostTakeover: 0,
    };
  }

  export function rpcVersion(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, _payload: string): string {
    var denied = gate(ctx);
    if (denied) return denied;
    var sim = ensureSim(nk, logger);
    if (sim) return sim;
    return JSON.stringify({
      protocol: CoopProto.PROTOCOL,
      fingerprint: CoopProto.FINGERPRINT,
      bundleSha256: CoopProto.BUNDLE_SHA256,
      commit: CoopProto.COMMIT,
      repo: CoopProto.REPO,
      loopHz: CoopProto.TICK_RATE,
      substeps: CoopProto.SUBSTEPS,
      simHz: 60,
      snapshotHz: 10,
      snapshotMaxHz: 15,
      reconnectS: CoopProto.RECONNECT_S,
      codeTtlS: CoopProto.CODE_TTL_S,
      rewards: 0,
      hostTakeover: 0,
      match: CoopProto.MATCH_NAME,
      enabled: open(ctx),
      opcodes: {
        hello: CoopProto.OP_HELLO,
        welcome: CoopProto.OP_WELCOME,
        ready: CoopProto.OP_READY,
        start: CoopProto.OP_START,
        input: CoopProto.OP_INPUT,
        snapshot: CoopProto.OP_SNAPSHOT,
        seats: CoopProto.OP_SEATS,
        reject: CoopProto.OP_REJECT,
        resume: CoopProto.OP_RESUME,
        end: CoopProto.OP_END,
        release: CoopProto.OP_RELEASE,
        ping: CoopProto.OP_PING,
        pong: CoopProto.OP_PONG,
        command: CoopProto.OP_COMMAND,
      },
    });
  }

  export function rpcRoomCreate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var denied = gate(ctx);
    if (denied) return denied;
    var sim = ensureSim(nk, logger);
    if (sim) return sim;
    if (!open(ctx)) return fail("capacity_dark", "Authoritative coop is dark");
    var req = bodyOf(payload);
    if (!req) return fail("bad_json", "Bad request");
    if (req["seed"] !== undefined || req["state"] !== undefined || req["stage"] !== undefined || req["god"] !== undefined) return fail("rejected", "The server chooses the run");
    if (req["v"] !== undefined && Number(req["v"]) !== CoopProto.PROTOCOL) return fail("version_mismatch", "Version mismatch");
    if (req["sim"] !== undefined && String(req["sim"]) !== CoopProto.FINGERPRINT) return fail("version_mismatch", "Version mismatch");
    if (!CoopMm.rateAllow(nk, ctx.userId || "", "create")) return fail("rate_limited", "Too many rooms");
    if (CoopMm.liveMatch(nk, ctx.userId || "")) return fail("already_in_match", "Already in a match");
    var code = "";
    for (var attempt = 0; attempt < 5 && !code; attempt++) {
      var candidate = CoopProto.roomCode();
      if (CoopMm.reserveCode(nk, candidate)) code = candidate;
    }
    if (!code) return fail("room_code_busy", "Could not allocate a room code");
    var seed = CoopProto.serverSeed();
    var names: { [id: string]: string } = {};
    names[ctx.userId || ""] = String(ctx.username || "").slice(0, 16);
    var matchId = "";
    try {
      matchId = nk.matchCreate(CoopProto.MATCH_NAME, {
        private: "1",
        code: code,
        names: JSON.stringify(names),
        seed: String(seed),
        seedSource: "server",
      });
    } catch (e) {
      CoopMm.releaseCode(nk, code);
      var message = String(e);
      logger.error("sproto_coop room " + message);
      if (message.indexOf("version_mismatch") >= 0) return fail("version_mismatch", "Simulation pin mismatch");
      return fail("room_failed", "Could not create the room");
    }
    CoopMm.bindCode(nk, code, matchId, Date.now() + CoopProto.CODE_TTL_S * 1000);
    CoopMm.setLive(nk, ctx.userId || "", matchId);
    logger.info("sproto_coop room " + matchId);
    return JSON.stringify({
      matchId: matchId,
      code: code,
      protocol: CoopProto.PROTOCOL,
      fingerprint: CoopProto.FINGERPRINT,
      rewards: 0,
      hostTakeover: 0,
      ttlS: CoopProto.CODE_TTL_S,
    });
  }

  export function rpcRoomJoin(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var denied = gate(ctx);
    if (denied) return denied;
    if (!open(ctx)) return fail("capacity_dark", "Authoritative coop is dark");
    var req = bodyOf(payload);
    if (!req) return fail("bad_json", "Bad request");
    if (req["v"] !== undefined && Number(req["v"]) !== CoopProto.PROTOCOL) return fail("version_mismatch", "Version mismatch");
    if (req["sim"] !== undefined && String(req["sim"]) !== CoopProto.FINGERPRINT) return fail("version_mismatch", "Version mismatch");
    if (!CoopMm.rateAllow(nk, ctx.userId || "", "lookup")) return fail("rate_limited", "Too many lookups");
    var code = CoopProto.normalizeCode(req["code"]);
    if (!code) return fail("room_not_found", "Room not found");
    var matchId = CoopMm.lookupCode(nk, code);
    if (!matchId) return fail("room_not_found", "Room not found");
    return JSON.stringify({ matchId: matchId, rewards: 0, hostTakeover: 0, protocol: CoopProto.PROTOCOL, fingerprint: CoopProto.FINGERPRINT });
  }

  export function rpcQueueCancel(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, _payload: string): string {
    var denied = gate(ctx);
    if (denied) return denied;
    CoopMm.cancelQueue(nk, ctx.userId || "");
    return JSON.stringify({ ok: true, queued: false });
  }

  export function rpcResume(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var denied = gate(ctx);
    if (denied) return denied;
    var sim = ensureSim(nk, logger);
    if (sim) return sim;
    if (!open(ctx)) return fail("capacity_dark", "Authoritative coop is dark");
    var req = bodyOf(payload);
    if (!req) return fail("bad_json", "Bad request");
    if (req["state"] !== undefined || req["seed"] !== undefined || req["god"] !== undefined || req["stage"] !== undefined) return fail("rejected", "The server resumes from its checkpoint");
    var matchId = String(req["matchId"] || "");
    if (!matchId || matchId.length > 128) return fail("checkpoint_missing", "No checkpoint");
    var row = CoopMm.readCheckpoint(nk, matchId);
    if (!row) return fail("checkpoint_missing", "No checkpoint");
    if (row.value["resumable"] !== true) return fail("match_finished", "That run cannot resume");
    if (!memberOf(row.value["accounts"], ctx.userId || "")) return fail("not_in_roster", "Not a member of that run");
    var existing = String(row.value["resumedMatchId"] || "");
    if (existing && existing !== "creating" && nk.matchGet(existing)) {
      return JSON.stringify({ matchId: existing, rewards: 0, hostTakeover: 0, protocol: CoopProto.PROTOCOL, fingerprint: CoopProto.FINGERPRINT });
    }
    if (existing === "creating") return fail("resume_busy", "Resume already in progress");
    try {
      var pending = copyRow(row.value);
      pending["resumedMatchId"] = "creating";
      CoopMm.writeCheckpoint(nk, matchId, pending, row.version);
    } catch (e) {
      return fail("resume_busy", "Resume already in progress");
    }
    var created = "";
    try {
      created = nk.matchCreate(CoopProto.MATCH_NAME, { resume: matchId, seedSource: "server" });
    } catch (e) {
      var message = String(e);
      logger.error("sproto_coop resume " + message);
      var again = CoopMm.readCheckpoint(nk, matchId);
      if (again && String(again.value["resumedMatchId"] || "") === "creating") {
        var rollback = copyRow(again.value);
        rollback["resumedMatchId"] = "";
        try {
          CoopMm.writeCheckpoint(nk, matchId, rollback, again.version);
        } catch (e2) {
          /* the next resume reports busy until the marker expires by a retry */
        }
      }
      if (message.indexOf("version_mismatch") >= 0) return fail("version_mismatch", "Simulation pin mismatch");
      return fail("checkpoint_invalid", "Checkpoint could not resume");
    }
    var saved = CoopMm.readCheckpoint(nk, matchId);
    if (saved) {
      var finalValue = copyRow(saved.value);
      finalValue["resumedMatchId"] = created;
      try {
        CoopMm.writeCheckpoint(nk, matchId, finalValue, saved.version);
      } catch (e3) {
        /* the new match is already running */
      }
    }
    return JSON.stringify({ matchId: created, rewards: 0, hostTakeover: 0, protocol: CoopProto.PROTOCOL, fingerprint: CoopProto.FINGERPRINT });
  }

  /** Fault-inject only. Starts the seed-3 six-seat fight the offline test drives. */
  export function rpcGolden(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var denied = gate(ctx);
    if (denied) return denied;
    var env = ctx.env || null;
    if (!env || env["HUB_FAULT_INJECT"] !== "1") return fail("not_found", "Not available");
    if (!open(ctx)) return fail("capacity_dark", "Authoritative coop is dark");
    var sim = ensureSim(nk, logger);
    if (sim) return sim;
    var req = bodyOf(payload);
    if (!req || req["id"] !== "human-seed3") return fail("bad_json", "Unknown golden");
    var matchId = nk.matchCreate(CoopProto.MATCH_NAME, { private: "1", seed: "3", seedSource: "server", golden: "human-seed3" });
    return JSON.stringify({ matchId: matchId, rewards: 0, hostTakeover: 0, protocol: CoopProto.PROTOCOL, fingerprint: CoopProto.FINGERPRINT });
  }

  export function rpcMetrics(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var denied = gate(ctx);
    if (denied) return denied;
    if (!open(ctx)) return fail("capacity_dark", "Authoritative coop is dark");
    var req = bodyOf(payload);
    if (!req) return fail("bad_json", "Bad request");
    var id = String(req["matchId"] || "");
    if (!id) return fail("match_missing", "No match");
    if (!nk.matchGet(id)) {
      var saved = CoopMm.readCheckpoint(nk, id);
      if (!saved || !saved.value["stateHash"]) return fail("match_missing", "No match");
      return JSON.stringify({
        phase: "done",
        endReason: String(saved.value["endReason"] || ""),
        tick: Number(saved.value["simTick"] || 0),
        mode: "",
        stateHash: String(saved.value["stateHash"]),
        rewards: 0,
        hostTakeover: 0,
        n: 0,
        p50: 0,
        p95: 0,
        max: 0,
        over25: 0,
      });
    }
    var raw = nk.matchSignal(id, req["reset"] === true ? "reset-metrics" : "metrics");
    return raw || "{}";
  }
}

// Nakama resolves these names from InitModule. They stay top-level functions.
function sprotoCoopInit(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, params: { [key: string]: unknown }) {
  return CoopMatch.handler.matchInit(ctx, logger, nk, params);
}
function sprotoCoopJoinAttempt(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, d: nkruntime.MatchDispatcher, tick: number, state: CoopMatch.State, presence: nkruntime.Presence, metadata: { [key: string]: unknown }) {
  return CoopMatch.handler.matchJoinAttempt(ctx, logger, nk, d, tick, state, presence, metadata);
}
function sprotoCoopJoin(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, d: nkruntime.MatchDispatcher, tick: number, state: CoopMatch.State, presences: nkruntime.Presence[]) {
  return CoopMatch.handler.matchJoin(ctx, logger, nk, d, tick, state, presences);
}
function sprotoCoopLeave(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, d: nkruntime.MatchDispatcher, tick: number, state: CoopMatch.State, presences: nkruntime.Presence[]) {
  return CoopMatch.handler.matchLeave(ctx, logger, nk, d, tick, state, presences);
}
function sprotoCoopLoop(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, d: nkruntime.MatchDispatcher, tick: number, state: CoopMatch.State, messages: nkruntime.MatchMessage[]) {
  return CoopMatch.handler.matchLoop(ctx, logger, nk, d, tick, state, messages);
}
function sprotoCoopTerminate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, d: nkruntime.MatchDispatcher, tick: number, state: CoopMatch.State, grace: number) {
  return CoopMatch.handler.matchTerminate(ctx, logger, nk, d, tick, state, grace);
}
function sprotoCoopSignal(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, d: nkruntime.MatchDispatcher, tick: number, state: CoopMatch.State, data: string) {
  return CoopMatch.handler.matchSignal(ctx, logger, nk, d, tick, state, data);
}
function rpcCoopVersion(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return CoopMatch.rpcVersion(ctx, logger, nk, payload);
}
function rpcCoopRoomCreate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return CoopMatch.rpcRoomCreate(ctx, logger, nk, payload);
}
function rpcCoopRoomJoin(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return CoopMatch.rpcRoomJoin(ctx, logger, nk, payload);
}
function rpcCoopQueueCancel(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return CoopMatch.rpcQueueCancel(ctx, logger, nk, payload);
}
function rpcCoopResume(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return CoopMatch.rpcResume(ctx, logger, nk, payload);
}
function rpcCoopMetrics(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return CoopMatch.rpcMetrics(ctx, logger, nk, payload);
}
function rpcCoopGolden(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return CoopMatch.rpcGolden(ctx, logger, nk, payload);
}
