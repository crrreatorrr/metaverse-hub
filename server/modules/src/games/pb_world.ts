// The People's Bitcoin online worlds (Contract C1/C7: match `pb_world`).
// Each world is one authoritative match of up to 100 players running PB's
// shared sim from vendor/pb-sim.js (`PbSim`, built by peoples-bitcoin's
// `npm run build:sim`). This file is only the Nakama shell: it maps the
// match callbacks onto the pure host and gives the host its I/O (character
// storage with OCC, the online-status rows, HubEconomy, match signals).
// Opcodes and the protocol live in peoples-bitcoin src/net/protocol.ts.

namespace PbWorld {
  export var GAME_ID = "peoples-bitcoin";
  export var MATCH_NAME = "pb_world";
  export var TICK_RATE = 5;
  export var SYSTEM_USER = "00000000-0000-0000-0000-000000000000";
  export var CHARACTER = { collection: "pb_character", key: "main" };
  export var ONLINE = { collection: "pb_online", key: "status" };
  export var WORLD = { collection: "pb_world" };
  export var REGISTRY = { collection: "pb_registry" };
  /** An empty world that lost its registry row ends after this many loops (about 1 minute). */
  var ORPHAN_LOOPS = 300;
  /** Log loop timing this often (about 1 minute) while anyone is on. */
  var TIMING_LOOPS = 300;

  export interface State {
    worldNo: number;
    matchId: string;
    host: PbSimWorldHost | null;
    /** Live Nakama presences by user id, for targeted sends and kicks. */
    presences: { [userId: string]: nkruntime.Presence };
    env: { nk: nkruntime.Nakama; logger: nkruntime.Logger };
    emptyLoops: number;
    /** Loop timing since the last log: count, total and worst ms. */
    timing: { n: number; total: number; worst: number };
  }

  function worldKey(n: number): string {
    return "world-" + n;
  }

  function isVersionError(e: unknown): boolean {
    return String(e).toLowerCase().indexOf("version") >= 0;
  }

  /** The host's I/O over Nakama. Reads `state.env` so each callback's nk/logger is used. */
  function makeIO(state: State): PbSimIO {
    var nk = function () {
      return state.env.nk;
    };
    var who = function (w: PbSimWho): HubEconomy.Who {
      return { userId: w.userId, sid: w.sid, game: GAME_ID };
    };
    return {
      nowMs: function () {
        return Date.now();
      },
      loadCharacters: function (userIds) {
        var out: { [userId: string]: { data: unknown; version: string } | null } = {};
        for (var i = 0; i < userIds.length; i++) out[userIds[i]] = null;
        var keys = userIds.map(function (u) {
          return { collection: CHARACTER.collection, key: CHARACTER.key, userId: u };
        });
        var rows = keys.length ? nk().storageRead(keys) : [];
        for (var j = 0; j < rows.length; j++) {
          out[rows[j].userId] = { data: (rows[j].value as { save?: unknown }).save, version: rows[j].version };
        }
        return out;
      },
      saveCharacters: function (rows) {
        var writes: nkruntime.StorageWrite[] = rows.map(function (r) {
          return {
            collection: CHARACTER.collection,
            key: CHARACTER.key,
            userId: r.userId,
            value: { save: r.data },
            version: r.version === undefined ? "*" : r.version,
            permissionRead: 0,
            permissionWrite: 0,
          };
        });
        try {
          var acks = nk().storageWrite(writes);
          var versions: { [userId: string]: string } = {};
          for (var i = 0; i < acks.length; i++) versions[acks[i].userId] = acks[i].version;
          return { ok: true, versions: versions };
        } catch (e) {
          if (!isVersionError(e)) return { ok: false, error: String(e) };
          // One transaction failed on a version: find whose row moved on.
          var current = PbWorld.versions(nk(), rows.map(function (r) { return r.userId; }));
          var conflicts: string[] = [];
          for (var k = 0; k < rows.length; k++) {
            var had = rows[k].version === undefined ? null : rows[k].version;
            if ((current[rows[k].userId] || null) !== had) conflicts.push(rows[k].userId);
          }
          return { ok: false, conflicts: conflicts, error: "version_conflict" };
        }
      },
      loadWorld: function () {
        var rows = nk().storageRead([{ collection: WORLD.collection, key: worldKey(state.worldNo), userId: SYSTEM_USER }]);
        return rows.length ? rows[0].value : null;
      },
      saveWorld: function (data) {
        nk().storageWrite([
          {
            collection: WORLD.collection,
            key: worldKey(state.worldNo),
            userId: SYSTEM_USER,
            value: data as { [k: string]: unknown },
            permissionRead: 0,
            permissionWrite: 0,
          },
        ]);
      },
      earnTickets: function (w, amount, reason, key) {
        return HubEconomy.earn(nk(), who(w), amount, reason, key);
      },
      spendTickets: function (w, shopId, itemId, packs, key) {
        return HubEconomy.spend(nk(), who(w), shopId, itemId, packs, key);
      },
      sellItem: function (w, shopId, itemId, packs, key) {
        return HubEconomy.sell(nk(), who(w), shopId, itemId, packs, key);
      },
      ticketBalance: function (w) {
        return HubEconomy.balance(nk(), who(w));
      },
      readOnline: function (userIds) {
        var out: { [userId: string]: PbSimOnline | null } = {};
        for (var i = 0; i < userIds.length; i++) out[userIds[i]] = null;
        if (!userIds.length) return out;
        var rows = nk().storageRead(
          userIds.map(function (u) {
            return { collection: ONLINE.collection, key: ONLINE.key, userId: u };
          }),
        );
        for (var j = 0; j < rows.length; j++) out[rows[j].userId] = rows[j].value as unknown as PbSimOnline;
        return out;
      },
      writeOnline: function (userId, entry) {
        if (!entry) {
          nk().storageDelete([{ collection: ONLINE.collection, key: ONLINE.key, userId: userId }]);
          return;
        }
        nk().storageWrite([
          {
            collection: ONLINE.collection,
            key: ONLINE.key,
            userId: userId,
            value: entry as unknown as { [k: string]: unknown },
            permissionRead: 0,
            permissionWrite: 0,
          },
        ]);
      },
      signalWorld: function (matchId, data) {
        try {
          return nk().matchSignal(matchId, data);
        } catch (e) {
          return null;
        }
      },
      resolveUsername: function (name) {
        return resolveUsername(nk(), name);
      },
      log: function (level, msg) {
        var line = "[pb_world " + state.worldNo + "] " + msg;
        if (level === "error") state.env.logger.error(line);
        else if (level === "warn") state.env.logger.warn(line);
        else state.env.logger.info(line);
      },
    };
  }

  /**
   * Friend/ignore lookup by name for the PB sim. The username it returns is shown to
   * the player and stored in their friend list, so it is cleaned (HubMatch.cleanName).
   */
  export function resolveUsername(nk: nkruntime.Nakama, name: string): { userId: string; username: string } | null {
    var users = nk.usersGetUsername([name]);
    if (!users || !users.length) return null;
    return { userId: users[0].userId, username: HubMatch.cleanName(users[0].username) || "player" };
  }

  /** Current character versions (null when absent). */
  export function versions(nk: nkruntime.Nakama, userIds: string[]): { [userId: string]: string | null } {
    var out: { [userId: string]: string | null } = {};
    var rows = nk.storageRead(
      userIds.map(function (u) {
        return { collection: CHARACTER.collection, key: CHARACTER.key, userId: u };
      }),
    );
    for (var i = 0; i < rows.length; i++) out[rows[i].userId] = rows[i].version;
    return out;
  }

  function text(data: string | ArrayBuffer, nk: nkruntime.Nakama): string {
    return typeof data === "string" ? data : nk.binaryToString(data);
  }

  function bare(p: nkruntime.Presence): PbSimPresence {
    return { userId: p.userId, sessionId: p.sessionId, username: p.username };
  }

  /** Sends what the host produced, then kicks, then updates the label. */
  function dispatch(state: State, d: nkruntime.MatchDispatcher, result: PbSimLoopResult): void {
    for (var i = 0; i < result.messages.length; i++) {
      var m = result.messages[i];
      if (m.to === null) {
        d.broadcastMessage(m.op, m.data, null, null, true);
        continue;
      }
      var targets: nkruntime.Presence[] = [];
      for (var j = 0; j < m.to.length; j++) {
        var p = state.presences[m.to[j]];
        if (p) targets.push(p);
      }
      if (targets.length) d.broadcastMessage(m.op, m.data, targets, null, true);
    }
    if (result.kick.length) {
      var gone: nkruntime.Presence[] = [];
      for (var k = 0; k < result.kick.length; k++) {
        var q = state.presences[result.kick[k]];
        if (q) {
          gone.push(q);
          delete state.presences[result.kick[k]];
        }
      }
      if (gone.length) d.matchKick(gone);
    }
    if (result.label) d.matchLabelUpdate(result.label);
  }

  function hostOf(state: State, nk: nkruntime.Nakama, logger: nkruntime.Logger): PbSimWorldHost {
    state.env = { nk: nk, logger: logger };
    if (!state.host) {
      // Built on first use: each match VM evaluates the whole module (Contract C12).
      var seed = 0;
      for (var i = 0; i < state.matchId.length; i++) seed = (seed * 31 + state.matchId.charCodeAt(i)) >>> 0;
      state.host = PbSim.createWorldHost({ worldNo: state.worldNo, matchId: state.matchId, seed: seed, io: makeIO(state) });
    }
    return state.host;
  }

  /** Is this match still the registered one for its world number? */
  function registered(nk: nkruntime.Nakama, state: State): boolean {
    var rows = nk.storageRead([{ collection: REGISTRY.collection, key: worldKey(state.worldNo), userId: SYSTEM_USER }]);
    return rows.length > 0 && (rows[0].value as { matchId?: string }).matchId === state.matchId;
  }

  export var handler: nkruntime.MatchHandler<State> = {
    matchInit: function (ctx, logger, nk, params) {
      var n = Number(params.world);
      var worldNo = isFinite(n) && n >= 1 ? Math.floor(n) : 1;
      var state: State = {
        worldNo: worldNo,
        matchId: ctx.matchId || "",
        host: null,
        presences: {},
        env: { nk: nk, logger: logger },
        emptyLoops: 0,
        timing: { n: 0, total: 0, worst: 0 },
      };
      var host = hostOf(state, nk, logger);
      return { state: state, tickRate: TICK_RATE, label: host.label() };
    },
    matchJoinAttempt: function (ctx, logger, nk, _d, _tick, state, presence) {
      var host = hostOf(state, nk, logger);
      var verdict = host.joinAttempt(bare(presence), ctx.vars || null);
      return verdict.accept ? { state: state, accept: true } : { state: state, accept: false, rejectMessage: verdict.reason || "rejected" };
    },
    matchJoin: function (_ctx, logger, nk, _d, _tick, state, presences) {
      var host = hostOf(state, nk, logger);
      for (var i = 0; i < presences.length; i++) state.presences[presences[i].userId] = presences[i];
      // WELCOME and the first snapshot go out with the next loop (at most 200 ms).
      host.join(presences.map(bare));
      return { state: state };
    },
    matchLeave: function (_ctx, logger, nk, _d, _tick, state, presences) {
      var host = hostOf(state, nk, logger);
      for (var i = 0; i < presences.length; i++) {
        var p = state.presences[presences[i].userId];
        if (p && p.sessionId === presences[i].sessionId) delete state.presences[presences[i].userId];
      }
      host.leave(presences.map(bare));
      return { state: state };
    },
    matchLoop: function (_ctx, logger, nk, d, _tick, state, messages) {
      var host = hostOf(state, nk, logger);
      var started = Date.now();
      for (var i = 0; i < messages.length; i++) {
        var m = messages[i];
        host.message(bare(m.sender), m.opCode, text(m.data, nk));
      }
      dispatch(state, d, host.loop());
      var ms = Date.now() - started;
      var t = state.timing;
      t.n += 1;
      t.total += ms;
      if (ms > t.worst) t.worst = ms;
      if (t.n >= TIMING_LOOPS) {
        // Every third loop runs the 600 ms sim tick; the worst loop is a sim tick.
        if (host.size() > 0) {
          logger.info("[pb_world " + state.worldNo + "] " + host.size() + " players, loop avg " + (t.total / t.n).toFixed(1) + " ms, worst " + t.worst + " ms");
        }
        state.timing = { n: 0, total: 0, worst: 0 };
      }
      if (host.size() === 0) {
        state.emptyLoops += 1;
        // An extra world created by a placement race closes once empty and unregistered.
        if (state.emptyLoops % ORPHAN_LOOPS === 0 && !registered(nk, state)) {
          logger.info("[pb_world " + state.worldNo + "] orphan " + state.matchId + " closing");
          return null;
        }
      } else state.emptyLoops = 0;
      return { state: state };
    },
    matchTerminate: function (_ctx, logger, nk, d, _tick, state) {
      var host = hostOf(state, nk, logger);
      dispatch(state, d, host.shutdown());
      return { state: state };
    },
    matchSignal: function (_ctx, logger, nk, _d, _tick, state, data) {
      var host = hostOf(state, nk, logger);
      // A delivered PM or a kick goes out with the next loop.
      return { state: state, data: host.signal(data) };
    },
  };
}

// Nakama resolves handlers by top-level function name (Contract C5).
function pbWorldInit(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, params: { [key: string]: unknown }) {
  return PbWorld.handler.matchInit(ctx, logger, nk, params);
}
function pbWorldJoinAttempt(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: PbWorld.State, presence: nkruntime.Presence, metadata: { [key: string]: unknown }) {
  return PbWorld.handler.matchJoinAttempt(ctx, logger, nk, dispatcher, tick, state, presence, metadata);
}
function pbWorldJoin(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: PbWorld.State, presences: nkruntime.Presence[]) {
  return PbWorld.handler.matchJoin(ctx, logger, nk, dispatcher, tick, state, presences);
}
function pbWorldLeave(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: PbWorld.State, presences: nkruntime.Presence[]) {
  return PbWorld.handler.matchLeave(ctx, logger, nk, dispatcher, tick, state, presences);
}
function pbWorldLoop(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: PbWorld.State, messages: nkruntime.MatchMessage[]) {
  return PbWorld.handler.matchLoop(ctx, logger, nk, dispatcher, tick, state, messages);
}
function pbWorldTerminate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: PbWorld.State, graceSeconds: number) {
  return PbWorld.handler.matchTerminate(ctx, logger, nk, dispatcher, tick, state, graceSeconds);
}
function pbWorldSignal(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: PbWorld.State, data: string) {
  return PbWorld.handler.matchSignal(ctx, logger, nk, dispatcher, tick, state, data);
}
