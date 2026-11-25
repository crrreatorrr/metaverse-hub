// Authoritative plaza match: up to 100 players per shard at 10 Hz.
//
// Presence only: position (cm), yaw (0..255), animation index, name, owned
// Relics (orbit gems), cosmetic profile and the game a player is heading to.
// This handler never credits Tickets, Verse, Relics or items. Its only SQL is a
// batched relic read. Chat runs on Nakama channels (hub.<shard>), not here.
//
// Wire (JSON text; opcodes are this match's own):
//   1 POSE     c→s  [xCm, yCm, zCm, yaw8, anim]          ≤ 64 bytes, latest per tick wins
//   2 SNAPSHOT s→c  {t, you, shard, roster:[Entry], p:[[slot,x,y,z,yaw,anim]]}   joiner / rejoin
//   3 DELTA    s→c  {t, p:[[slot,x,y,z,yaw,anim]]}         changed slots in the recipient's zone
//   4 ROSTER   s→c  {add?:[Entry], del?:[slot], upd?:[Entry]}
//   5 PROFILE  c→s  {character, staff, pet, name?}         1 per 2 s → roster upd
//   6 EMOTE    c→s→zone {e} / {s, e}                       1 per s
//   7 TRAVEL   c→s  {game}                                  others see "→ NOBU" before the player leaves
// Entry = {s, u, n, c, st, pt, r, g, away}
namespace HubMatch {
  export var MODULE = "hub";
  export var TICK_RATE = 10;
  /**
   * Area of interest for OP_DELTA, in cm. Players share a grid cell of AOI_CELL; everyone in the
   * 3x3 cells around a receiver (at least AOI_CELL away in every direction, more than the client's
   * 30 m rig radius) arrives every tick. Farther players arrive every FAR_EVERY_TICKS (2 Hz).
   */
  export var AOI_CELL = 5000;
  export var FAR_EVERY_TICKS = 5;
  export var MAX_PLAYERS = 100;
  /** Placement stops sending new players above this; the rest is room for friends and reconnects. */
  export var SOFT_CAP = 90;
  export var REJOIN_GRACE_TICKS = 20 * 10;
  export var EMPTY_CLOSE_TICKS = 120 * 10;
  export var RELIC_REFRESH_TICKS = 100;
  export var PROFILE_EVERY_TICKS = 20;
  /** Longest display name a player can choose (apps/hub/src/look.ts cleanName). */
  export var DISPLAY_NAME_MAX = 12;
  export var EMOTE_EVERY_TICKS = 10;
  /** Consecutive rejected poses before the server accepts a snap (lag spike, respawn). */
  export var SNAP_AFTER_REJECTS = 10;

  export var OP_POSE = 1;
  export var OP_SNAPSHOT = 2;
  export var OP_DELTA = 3;
  export var OP_ROSTER = 4;
  export var OP_PROFILE = 5;
  export var OP_EMOTE = 6;
  export var OP_TRAVEL = 7;

  export var ANIMS = ["idle", "walk", "run", "jump", "wave", "dance", "cheer"];
  export var EMOTES: { [e: string]: boolean } = { wave: true, dance: true, cheer: true };
  /** Walk 7.8 m/s and sprint 1.8x, from the hub controller, with three ticks of slack (cm per tick). */
  export var MAX_H_STEP_CM = Math.ceil((7.8 * 1.8 * 3 * 100) / 10);
  export var MAX_V_STEP_CM = 300;
  export var SPAWN = [0, 178, 4200];

  var GAMES: { [id: string]: boolean } = { hpos10i: true, nobu: true, "peoples-bitcoin": true, sproto: true, "sproto-fighter": true, "sproto-arcade": true, "sproto-shooter": true, "sproto-coop-battle": true, "sproto-open-world": true };
  var RELIC_ORDER = ["hpos10i_core", "genesis_shard", "cones_tip", "tinubu_crown", "tidebreaker_belt", "breakwater_coin", "marina_anchor", "dragon_scale"];
  var ID = /^[a-z0-9_-]{1,32}$/;
  /**
   * Plaza characters a client may wear (apps/hub/src/config.ts CHARACTERS; hub_match.test.ts keeps
   * the two lists equal). Anything else keeps the player's current look.
   */
  export var CHARACTERS = ["wizard", "pepe", "pepe-general", "pepe-tux", "sahil", "obama", "midget", "broccoli", "agent", "tinubu", "soldier", "midget2", "flyer", "obama2", "bigobama", "sahil2", "hexsahil", "tinubu2", "megatinubu", "laser", "shooterbot", "monster", "beast", "cargolem", "mole", "dragon"];

  export interface Player {
    slot: number;
    userId: string;
    presence: nkruntime.Presence;
    /** The name other players see: the display name from OP_PROFILE, or the account name. */
    name: string;
    /** The cleaned account name, shown when no display name is set. Older states lack it. */
    account?: string;
    x: number;
    y: number;
    z: number;
    yaw: number;
    anim: number;
    relics: string[];
    game: string;
    character: string;
    staff: string;
    pet: string;
    away: boolean;
    awayTick: number;
    placed: boolean;
    dirty: boolean;
    /** Moved since the last far (2 Hz) delta; older states lack it. */
    farDirty?: boolean;
    /** AOI bookkeeping: current cell and the tick it was entered; cell and tick of the last near row. */
    cellKey?: string;
    cellTick?: number;
    nearTick?: number;
    nearCx?: number;
    nearCz?: number;
    rejects: number;
    lastProfileTick: number;
    lastEmoteTick: number;
  }

  export interface State {
    shard: number;
    realm: HubRealms.Realm;
    slots: (Player | null)[];
    byUser: { [userId: string]: number };
    present: number;
    emptyTicks: number;
    label: string;
    /** Slots whose pet a "pet" signal changed since the last loop; sent as roster upd. Older states lack it. */
    petUpd?: { [slot: string]: boolean };
  }

  function errorText(value: unknown): string {
    if (typeof value === "string") return value;
    if (value && typeof value === "object" && "message" in value) return String((value as { message: unknown }).message);
    return String(value);
  }

  /**
   * Display-safe copy of a username for every name the server sends to clients
   * (plaza shards, Duel arena, Fighter duel, Coop, boards, PB friends). Keeps only
   * A-Z a-z 0-9, space, _ - and ., up to `max` characters (24 by default), and
   * returns "" when nothing is left so each caller keeps its own fallback.
   * Accounts are never renamed (owner decision, plan R.6 #1): unsafe legacy names
   * are cleaned wherever they are shown.
   */
  export function cleanName(raw: unknown, max?: number): string {
    var text = typeof raw === "string" ? raw : raw === null || raw === undefined ? "" : String(raw);
    var limit = typeof max === "number" && max > 0 ? max : 24;
    var out = "";
    for (var i = 0; i < text.length && out.length < limit; i++) {
      var code = text.charCodeAt(i);
      var ok = (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 32 || code === 95 || code === 45 || code === 46;
      if (ok) out += text.charAt(i);
    }
    return out;
  }

  /** cleanName with the plaza fallback "player". */
  export function sanitizeName(raw: string): string {
    return cleanName(raw) || "player";
  }

  /** Copy of a parsed name map with every value cleaned (cleanName); non-object input gives {}. */
  export function cleanNameMap(raw: unknown, max?: number): { [userId: string]: string } {
    var out: { [userId: string]: string } = {};
    if (!raw || typeof raw !== "object" || Object.prototype.toString.call(raw) === "[object Array]") return out;
    var src = raw as { [key: string]: unknown };
    for (var id in src) if (Object.prototype.hasOwnProperty.call(src, id)) out[id] = cleanName(src[id], max);
    return out;
  }

  /** plaza above y -50 m, the club interior below -250 m (its root is at -300 m). */
  export function zoneOf(yCm: number, realm?: HubRealms.Realm): string {
    return HubRealms.zoneOf(realm || HubRealms.REALMS.plaza, yCm);
  }

  function inBounds(x: number, y: number, z: number, realm?: HubRealms.Realm): boolean {
    return HubRealms.inBounds(realm || HubRealms.REALMS.plaza, x, y, z);
  }

  function isInt(v: unknown): boolean {
    return typeof v === "number" && isFinite(v) && Math.floor(v) === v;
  }

  function messageText(nk: nkruntime.Nakama, data: string | ArrayBuffer | null | undefined): string {
    if (typeof data === "string") return data;
    if (data && typeof (data as ArrayBuffer).byteLength === "number") {
      try {
        return nk.binaryToString(data as ArrayBuffer);
      } catch (_e) {
        return "";
      }
    }
    return "";
  }

  function parseJson(raw: string, max: number): unknown {
    if (!raw || raw.length > max) return null;
    try {
      return JSON.parse(raw);
    } catch (_e) {
      return null;
    }
  }

  export function entryOf(p: Player): { [k: string]: unknown } {
    return { s: p.slot, u: p.userId, n: p.name, c: p.character, st: p.staff, pt: p.pet, r: p.relics, g: p.game, away: p.away };
  }

  function rowOf(p: Player): number[] {
    return [p.slot, p.x, p.y, p.z, p.yaw, p.anim];
  }

  function labelOf(state: State): string {
    return JSON.stringify({ game: "hub", kind: state.realm.kind, shard: state.shard, players: state.present, max: MAX_PLAYERS, open: state.present < SOFT_CAP });
  }

  function recount(state: State): void {
    var n = 0;
    for (var i = 0; i < state.slots.length; i++) {
      var p = state.slots[i];
      if (p && !p.away) n++;
    }
    state.present = n;
  }

  function updateLabel(dispatcher: nkruntime.MatchDispatcher, state: State): void {
    var next = labelOf(state);
    if (next === state.label) return;
    state.label = next;
    dispatcher.matchLabelUpdate(next);
  }

  function presences(state: State, zone: string | null, except: string | null): nkruntime.Presence[] {
    var out: nkruntime.Presence[] = [];
    for (var i = 0; i < state.slots.length; i++) {
      var p = state.slots[i];
      if (!p || p.away || p.userId === except) continue;
      if (zone !== null && zoneOf(p.y, state.realm) !== zone) continue;
      out.push(p.presence);
    }
    return out;
  }

  function send(dispatcher: nkruntime.MatchDispatcher, op: number, body: unknown, to: nkruntime.Presence[] | null): void {
    if (to && !to.length) return;
    dispatcher.broadcastMessage(op, JSON.stringify(body), to, null, true);
  }

  function freeSlot(state: State): number {
    for (var i = 0; i < state.slots.length; i++) if (!state.slots[i]) return i;
    return -1;
  }

  function scopeOf(ctx: nkruntime.Context): string {
    return ctx.vars && ctx.vars.scope ? ctx.vars.scope : "";
  }

  /** One batched relic read for many players. */
  export function lookupRelics(nk: nkruntime.Nakama, logger: nkruntime.Logger, userIds: string[]): { [userId: string]: string[] } {
    var out: { [userId: string]: string[] } = {};
    if (!userIds.length) return out;
    try {
      var rows = nk.sqlQuery(
        "SELECT user_id::text AS user_id, json_agg(relic_id)::text AS relics FROM game.relic_claim WHERE user_id = ANY($1::uuid[]) AND relic_id IN ('hpos10i_core', 'genesis_shard', 'cones_tip', 'tinubu_crown', 'tidebreaker_belt', 'breakwater_coin', 'marina_anchor', 'dragon_scale') GROUP BY user_id",
        [userIds],
      );
      for (var i = 0; i < (rows || []).length; i++) {
        var raw = rows[i].relics;
        var list = (typeof raw === "string" ? JSON.parse(raw) : raw) as unknown[];
        var have: { [id: string]: boolean } = {};
        for (var j = 0; list && j < list.length; j++) if (typeof list[j] === "string") have[list[j] as string] = true;
        var ordered: string[] = [];
        for (var k = 0; k < RELIC_ORDER.length; k++) if (have[RELIC_ORDER[k]]) ordered.push(RELIC_ORDER[k]);
        out[String(rows[i].user_id)] = ordered;
      }
    } catch (e) {
      logger.warn("hub relic read failed " + errorText(e));
    }
    return out;
  }

  function lookupNames(nk: nkruntime.Nakama, logger: nkruntime.Logger, list: nkruntime.Presence[]): { [userId: string]: string } {
    var out: { [userId: string]: string } = {};
    var ids: string[] = [];
    for (var i = 0; i < list.length; i++) {
      out[list[i].userId] = sanitizeName(list[i].username || "");
      ids.push(list[i].userId);
    }
    try {
      var users = nk.usersGetId(ids);
      for (var j = 0; j < (users || []).length; j++) if (users[j].username) out[users[j].userId] = sanitizeName(users[j].username);
    } catch (e) {
      logger.warn("hub name read failed " + errorText(e));
    }
    return out;
  }

  function sameList(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  /** Validates a POSE body; returns true when it moved the player. */
  export function applyPose(p: Player, raw: string, realm?: HubRealms.Realm): boolean {
    if (!raw || raw.length > 64) return false;
    var data = parseJson(raw, 64);
    if (!data || Object.prototype.toString.call(data) !== "[object Array]") return false;
    var a = data as unknown[];
    if (a.length !== 5 || !isInt(a[0]) || !isInt(a[1]) || !isInt(a[2]) || !isInt(a[3]) || !isInt(a[4])) return false;
    var x = a[0] as number, y = a[1] as number, z = a[2] as number, yaw = a[3] as number, anim = a[4] as number;
    if (!inBounds(x, y, z, realm) || yaw < 0 || yaw > 255 || anim < 0 || anim >= ANIMS.length) return false;
    if (p.placed && zoneOf(y, realm) === zoneOf(p.y, realm)) {
      var dx = x - p.x, dz = z - p.z, dy = y - p.y;
      if (dx * dx + dz * dz > MAX_H_STEP_CM * MAX_H_STEP_CM || dy > MAX_V_STEP_CM || dy < -MAX_V_STEP_CM) {
        p.rejects++;
        if (p.rejects < SNAP_AFTER_REJECTS) return false;
      }
    }
    p.rejects = 0;
    if (p.placed && p.x === x && p.y === y && p.z === z && p.yaw === yaw && p.anim === anim) return false;
    p.x = x;
    p.y = y;
    p.z = z;
    p.yaw = yaw;
    p.anim = anim;
    p.placed = true;
    p.dirty = true;
    return true;
  }

  function ownsStaff(p: Player, staff: string): boolean {
    if (staff === "shooter") return p.relics.indexOf("dragon_scale") >= 0;
    if (staff === "fighter") return p.relics.indexOf("tinubu_crown") >= 0;
    return true;
  }

  /**
   * Character and staff from the client. The pet is not read here: it comes from storage at join
   * (HubPets.activePets) and from loadout.set_hub's "pet" signal, so the 10 Hz loop does no DB or
   * storage I/O for OP_PROFILE.
   */
  function applyProfile(p: Player, raw: string, tick: number): boolean {
    if (tick - p.lastProfileTick < PROFILE_EVERY_TICKS) return false;
    var data = parseJson(raw, 256) as { [k: string]: unknown } | null;
    if (!data || typeof data !== "object") return false;
    var changed = false;
    var c = typeof data.character === "string" && CHARACTERS.indexOf(data.character) >= 0 ? data.character : p.character;
    var st = typeof data.staff === "string" && ID.test(data.staff) && ownsStaff(p, data.staff) ? data.staff : p.staff;
    if (c !== p.character || st !== p.staff) changed = true;
    p.character = c;
    p.staff = st;
    if (typeof data.name === "string") {
      var account = p.account || p.name;
      p.account = account;
      var name = displayName(data.name) || account;
      if (name !== p.name) changed = true;
      p.name = name;
    }
    p.lastProfileTick = tick;
    return changed;
  }

  /**
   * The display name a player chose in Edit avatar, as the plaza shows it to others: cleanName's
   * characters without the dot, single spaces, at most 12 (the menu's own limit). A name the chat
   * filter would mask or refuse gives "", and the caller keeps the account name. It lives in the
   * match state only; the client sends it again with every OP_PROFILE.
   */
  export function displayName(raw: string): string {
    var name = cleanName(raw.replace(/\./g, "").replace(/\s+/g, " ").replace(/^ +/, ""), DISPLAY_NAME_MAX).replace(/ +$/, "");
    if (!name) return "";
    var verdict = HubChat.filter(name);
    return verdict.hard || verdict.masked ? "" : name;
  }

  export function matchInit(_ctx: nkruntime.Context, logger: nkruntime.Logger, _nk: nkruntime.Nakama, params: { [key: string]: unknown }): { state: State; tickRate: number; label: string } {
    var realm = HubRealms.get(params && typeof params.realm === "string" ? params.realm : "plaza");
    if (!realm) throw new Error("bad_realm");
    var shard = Math.max(1, Math.floor(Number(params && params.shard) || 1));
    var slots: (Player | null)[] = [];
    for (var i = 0; i < MAX_PLAYERS; i++) slots.push(null);
    var state: State = { realm: realm, shard: shard, slots: slots, byUser: {}, present: 0, emptyTicks: 0, label: "", petUpd: {} };
    state.label = labelOf(state);
    logger.info("hub shard " + String(shard) + " up, tick " + String(TICK_RATE) + " max " + String(MAX_PLAYERS));
    return { state: state, tickRate: TICK_RATE, label: state.label };
  }

  export function matchJoinAttempt(ctx: nkruntime.Context, _logger: nkruntime.Logger, _nk: nkruntime.Nakama, _dispatcher: nkruntime.MatchDispatcher, _tick: number, state: State, presence: nkruntime.Presence, _metadata: { [key: string]: unknown }): { state: State; accept: boolean; rejectMessage?: string } {
    if (!presence || !presence.userId) return { state: state, accept: false, rejectMessage: "unauthorized" };
    var scope = scopeOf(ctx);
    if (scope !== "hub" && scope !== "") return { state: state, accept: false, rejectMessage: "wrong_scope" };
    // Same user again (reconnect within grace, or a newer tab): take over the slot.
    if (state.byUser[presence.userId] !== undefined) return { state: state, accept: true };
    if (freeSlot(state) < 0) return { state: state, accept: false, rejectMessage: "full" };
    return { state: state, accept: true };
  }

  export function matchJoin(_ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: State, joined: nkruntime.Presence[]): { state: State } {
    var fresh: nkruntime.Presence[] = [];
    var returning: Player[] = [];
    for (var i = 0; i < joined.length; i++) {
      var pr = joined[i];
      if (!pr || !pr.userId) continue;
      var existing = state.byUser[pr.userId];
      if (existing !== undefined && state.slots[existing]) {
        var p = state.slots[existing] as Player;
        if (!p.away && p.presence.sessionId !== pr.sessionId) dispatcher.matchKick([p.presence]);
        p.presence = pr;
        p.away = false;
        returning.push(p);
      } else {
        fresh.push(pr);
      }
    }
    var names = lookupNames(nk, logger, fresh);
    var relicIds: string[] = [];
    for (var r = 0; r < fresh.length; r++) relicIds.push(fresh[r].userId);
    var relics = lookupRelics(nk, logger, relicIds);
    // A portal trip shorter than the rejoin grace comes back to the same slot. Read that player's
    // Relics again: the trip may have earned one, and the staggered refresh in the loop would
    // leave the old list in the roster for up to 40 s. A failed read keeps what the slot has.
    if (returning.length) {
      var backIds: string[] = [];
      for (var rb = 0; rb < returning.length; rb++) backIds.push(returning[rb].userId);
      var backRelics = lookupRelics(nk, logger, backIds);
      for (var rc = 0; rc < returning.length; rc++) {
        var now = backRelics[returning[rc].userId];
        if (now && !sameList(returning[rc].relics, now)) returning[rc].relics = now;
      }
    }
    var pets: { [userId: string]: string } = {};
    try {
      pets = HubPets.activePets(nk, relicIds, relics);
    } catch (e) {
      logger.warn("hub pet read failed " + errorText(e));
    }
    var added: Player[] = [];
    for (var j = 0; j < fresh.length; j++) {
      var slot = freeSlot(state);
      if (slot < 0) {
        dispatcher.matchKick([fresh[j]]);
        continue;
      }
      var np: Player = {
        slot: slot,
        userId: fresh[j].userId,
        presence: fresh[j],
        name: names[fresh[j].userId] || "player",
        account: names[fresh[j].userId] || "player",
        x: state.realm.spawn[0],
        y: state.realm.spawn[1],
        z: state.realm.spawn[2],
        yaw: 0,
        anim: 0,
        relics: relics[fresh[j].userId] || [],
        game: "",
        character: "",
        staff: "",
        pet: pets[fresh[j].userId] || "",
        away: false,
        awayTick: 0,
        placed: false,
        dirty: false,
        rejects: 0,
        lastProfileTick: -PROFILE_EVERY_TICKS,
        lastEmoteTick: -EMOTE_EVERY_TICKS,
      };
      state.slots[slot] = np;
      state.byUser[np.userId] = slot;
      added.push(np);
    }
    recount(state);
    state.emptyTicks = 0;
    var newcomers: { [userId: string]: boolean } = {};
    var addEntries: { [k: string]: unknown }[] = [];
    var updEntries: { [k: string]: unknown }[] = [];
    for (var a = 0; a < added.length; a++) {
      newcomers[added[a].userId] = true;
      addEntries.push(entryOf(added[a]));
    }
    for (var b = 0; b < returning.length; b++) {
      newcomers[returning[b].userId] = true;
      updEntries.push(entryOf(returning[b]));
    }
    var others: nkruntime.Presence[] = [];
    var all = presences(state, null, null);
    for (var o = 0; o < all.length; o++) if (!newcomers[all[o].userId]) others.push(all[o]);
    if (addEntries.length || updEntries.length) {
      var roster: { [k: string]: unknown } = {};
      if (addEntries.length) roster.add = addEntries;
      if (updEntries.length) roster.upd = updEntries;
      send(dispatcher, OP_ROSTER, roster, others);
    }
    var snapshotTargets = added.concat(returning);
    if (snapshotTargets.length) {
      var entries: { [k: string]: unknown }[] = [];
      var rows: number[][] = [];
      for (var s = 0; s < state.slots.length; s++) {
        var sp = state.slots[s];
        if (!sp) continue;
        entries.push(entryOf(sp));
        rows.push(rowOf(sp));
      }
      for (var t = 0; t < snapshotTargets.length; t++) {
        send(dispatcher, OP_SNAPSHOT, { t: tick, you: snapshotTargets[t].slot, shard: state.shard, roster: entries, p: rows }, [snapshotTargets[t].presence]);
      }
    }
    updateLabel(dispatcher, state);
    return { state: state };
  }

  export function matchLeave(_ctx: nkruntime.Context, _logger: nkruntime.Logger, _nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: State, left: nkruntime.Presence[]): { state: State } {
    var upd: { [k: string]: unknown }[] = [];
    for (var i = 0; i < left.length; i++) {
      var slot = left[i] ? state.byUser[left[i].userId] : undefined;
      if (slot === undefined) continue;
      var p = state.slots[slot];
      // A kicked older session leaving after its replacement joined: ignore.
      if (!p || p.away || p.presence.sessionId !== left[i].sessionId) continue;
      p.away = true;
      p.awayTick = tick;
      upd.push(entryOf(p));
    }
    recount(state);
    if (upd.length) send(dispatcher, OP_ROSTER, { upd: upd }, presences(state, null, null));
    updateLabel(dispatcher, state);
    return { state: state };
  }

  export function matchLoop(_ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: State, messages: nkruntime.MatchMessage[]): { state: State } | null {
    var latest: { [slot: string]: string } = {};
    var rosterUpd: { [slot: string]: boolean } = {};
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      if (!m || !m.sender) continue;
      var slot = state.byUser[m.sender.userId];
      if (slot === undefined) continue;
      var p = state.slots[slot];
      if (!p || p.away || p.presence.sessionId !== m.sender.sessionId) continue;
      if (m.opCode === OP_POSE) {
        latest[String(slot)] = messageText(nk, m.data);
      } else if (m.opCode === OP_PROFILE) {
        if (applyProfile(p, messageText(nk, m.data), tick)) rosterUpd[String(slot)] = true;
      } else if (m.opCode === OP_EMOTE) {
        if (tick - p.lastEmoteTick < EMOTE_EVERY_TICKS) continue;
        var emote = parseJson(messageText(nk, m.data), 64) as { e?: unknown } | null;
        if (!emote || typeof emote.e !== "string" || !EMOTES[emote.e]) continue;
        p.lastEmoteTick = tick;
        send(dispatcher, OP_EMOTE, { s: p.slot, e: emote.e }, presences(state, zoneOf(p.y, state.realm), null));
      } else if (m.opCode === OP_TRAVEL) {
        var travel = parseJson(messageText(nk, m.data), 64) as { game?: unknown } | null;
        if (!travel || typeof travel.game !== "string") continue;
        var game = travel.game === "" || GAMES[travel.game] ? travel.game : p.game;
        if (game !== p.game) {
          p.game = game;
          rosterUpd[String(slot)] = true;
        }
      }
    }
    if (state.petUpd) {
      var petSlots = Object.keys(state.petUpd);
      for (var ps = 0; ps < petSlots.length; ps++) rosterUpd[petSlots[ps]] = true;
      state.petUpd = {};
    }
    var poseSlots = Object.keys(latest);
    for (var j = 0; j < poseSlots.length; j++) {
      var pp = state.slots[Number(poseSlots[j])];
      if (pp) applyPose(pp, latest[poseSlots[j]], state.realm);
    }

    // Grace expiry: away players past REJOIN_GRACE_TICKS leave the roster.
    var del: number[] = [];
    for (var k = 0; k < state.slots.length; k++) {
      var ap = state.slots[k];
      if (ap && ap.away && tick - ap.awayTick >= REJOIN_GRACE_TICKS) {
        del.push(ap.slot);
        delete state.byUser[ap.userId];
        state.slots[k] = null;
      }
    }

    // Staggered relic refresh: a quarter of the slots every RELIC_REFRESH_TICKS.
    if (tick > 0 && tick % RELIC_REFRESH_TICKS === 0) {
      var quarter = Math.floor(tick / RELIC_REFRESH_TICKS) % 4;
      var ids: string[] = [];
      for (var q = 0; q < state.slots.length; q++) {
        var qp = state.slots[q];
        if (qp && !qp.away && qp.slot % 4 === quarter) ids.push(qp.userId);
      }
      if (ids.length) {
        var fresh = lookupRelics(nk, logger, ids);
        for (var f = 0; f < ids.length; f++) {
          var fp = state.slots[state.byUser[ids[f]]];
          var next = fresh[ids[f]] || [];
          if (fp && !sameList(fp.relics, next)) {
            fp.relics = next;
            if (!ownsStaff(fp, fp.staff)) fp.staff = "sproto";
            rosterUpd[String(fp.slot)] = true;
          }
        }
      }
    }

    var upd: { [k: string]: unknown }[] = [];
    var updSlots = Object.keys(rosterUpd);
    for (var u = 0; u < updSlots.length; u++) {
      var upp = state.slots[Number(updSlots[u])];
      if (upp) upd.push(entryOf(upp));
    }
    if (upd.length || del.length) {
      var roster: { [k: string]: unknown } = {};
      if (upd.length) roster.upd = upd;
      if (del.length) roster.del = del;
      send(dispatcher, OP_ROSTER, roster, presences(state, null, null));
    }

    // Deltas, per zone and grid cell (AOI): one broadcast per occupied receiver cell with the rows that
    // moved this tick in its 3x3 neighbourhood, plus, on a far tick, every other row that moved
    // since the last far tick. The message shape is unchanged ({t, p}).
    var farTick = tick % FAR_EVERY_TICKS === 0;
    var cells: { [key: string]: { zone: string; cx: number; cz: number; near: number[][]; to: nkruntime.Presence[]; newest: number } } = {};
    var farRows: { [zone: string]: { cx: number; cz: number; row: number[]; nearTick: number }[] } = {};
    var cellOf = function (pl: Player): string {
      return zoneOf(pl.y, state.realm) + "|" + String(Math.floor(pl.x / AOI_CELL)) + "|" + String(Math.floor(pl.z / AOI_CELL));
    };
    var cellAt = function (key: string, pl: Player) {
      var c = cells[key];
      if (!c) c = cells[key] = { zone: zoneOf(pl.y, state.realm), cx: Math.floor(pl.x / AOI_CELL), cz: Math.floor(pl.z / AOI_CELL), near: [], to: [], newest: -1 };
      return c;
    };
    for (var d = 0; d < state.slots.length; d++) {
      var dp = state.slots[d];
      if (!dp) continue;
      if (dp.away) {
        dp.dirty = false;
        continue;
      }
      var key = cellOf(dp);
      var own = cellAt(key, dp);
      own.to.push(dp.presence);
      if (dp.cellKey !== key) {
        dp.cellKey = key;
        dp.cellTick = tick;
      }
      if ((dp.cellTick as number) > own.newest) own.newest = dp.cellTick as number;
      if (dp.dirty) {
        dp.dirty = false;
        dp.farDirty = true;
        dp.nearTick = tick;
        dp.nearCx = own.cx;
        dp.nearCz = own.cz;
        own.near.push(rowOf(dp));
      }
      if (farTick && dp.farDirty) {
        dp.farDirty = false;
        (farRows[own.zone] = farRows[own.zone] || []).push({ cx: dp.nearCx as number, cz: dp.nearCz as number, row: rowOf(dp), nearTick: dp.nearTick as number });
      }
    }
    var keys = Object.keys(cells);
    for (var z = 0; z < keys.length; z++) {
      var rc = cells[keys[z]];
      var rows: number[][] = [];
      var seen: { [slot: string]: boolean } = {};
      for (var ox = -1; ox <= 1; ox++) {
        for (var oz = -1; oz <= 1; oz++) {
          var nc = cells[rc.zone + "|" + String(rc.cx + ox) + "|" + String(rc.cz + oz)];
          if (!nc) continue;
          for (var r = 0; r < nc.near.length; r++) {
            rows.push(nc.near[r]);
            seen[String(nc.near[r][0])] = true;
          }
        }
      }
      // A far row skips a cell only when that cell neighboured the mover's last near row and nobody
      // in it arrived after that row went out; a receiver that walked in later still gets it.
      var far = farRows[rc.zone] || [];
      for (var f2 = 0; f2 < far.length; f2++) {
        var fr = far[f2];
        if (Math.abs(fr.cx - rc.cx) <= 1 && Math.abs(fr.cz - rc.cz) <= 1 && rc.newest <= fr.nearTick) continue;
        if (!seen[String(fr.row[0])]) rows.push(fr.row);
      }
      if (rows.length) send(dispatcher, OP_DELTA, { t: tick, p: rows }, rc.to);
    }

    try {
      HubBoards.maybeRecomputeMeta(nk, logger, Date.now());
    } catch (e) {
      logger.warn("hub meta rollup failed " + errorText(e));
    }
    try {
      SprotoDuel.maybeSweepWagers(nk, logger, Date.now());
    } catch (e) {
      logger.warn("sproto wager sweep failed " + errorText(e));
    }

    recount(state);
    updateLabel(dispatcher, state);
    var occupied = 0;
    for (var c = 0; c < state.slots.length; c++) if (state.slots[c]) occupied++;
    if (occupied === 0) {
      state.emptyTicks++;
      if ((!state.realm.alwaysOn || state.shard !== 1) && state.emptyTicks >= EMPTY_CLOSE_TICKS) {
        logger.info("hub shard " + String(state.shard) + " closed (empty)");
        return null;
      }
    } else {
      state.emptyTicks = 0;
    }
    return { state: state };
  }

  export function matchTerminate(_ctx: nkruntime.Context, _logger: nkruntime.Logger, _nk: nkruntime.Nakama, _dispatcher: nkruntime.MatchDispatcher, _tick: number, state: State, _graceSeconds: number): { state: State } {
    return { state: state };
  }

  /**
   * "status" → {shard, players, games:{game: n}} (counts of roster `g`).
   * {"op":"pet","u":userId,"pet":id} from loadout.set_hub (ownership already checked there) → the
   * player's pet, sent as a roster upd on the next loop.
   */
  export function matchSignal(_ctx: nkruntime.Context, _logger: nkruntime.Logger, _nk: nkruntime.Nakama, _dispatcher: nkruntime.MatchDispatcher, _tick: number, state: State, data: string): { state: State; data: string } {
    if (data !== "status") {
      var sig = parseJson(data, 256) as { op?: unknown; u?: unknown; pet?: unknown } | null;
      if (sig && sig.op === "pet" && typeof sig.u === "string" && typeof sig.pet === "string" && (sig.pet === "" || ID.test(sig.pet))) {
        var slot = state.byUser[sig.u];
        var pp = slot === undefined ? null : state.slots[slot];
        if (pp && pp.pet !== sig.pet) {
          pp.pet = sig.pet;
          (state.petUpd = state.petUpd || {})[String(slot)] = true;
        }
        return { state: state, data: "ok" };
      }
      return { state: state, data: "" };
    }
    var games: { [g: string]: number } = {};
    for (var i = 0; i < state.slots.length; i++) {
      var p = state.slots[i];
      if (p && !p.away && p.game) games[p.game] = (games[p.game] || 0) + 1;
    }
    return { state: state, data: JSON.stringify({ shard: state.shard, players: state.present, games: games }) };
  }

  export var handler = {
    matchInit: matchInit,
    matchJoinAttempt: matchJoinAttempt,
    matchJoin: matchJoin,
    matchLeave: matchLeave,
    matchLoop: matchLoop,
    matchTerminate: matchTerminate,
    matchSignal: matchSignal,
  };
}
