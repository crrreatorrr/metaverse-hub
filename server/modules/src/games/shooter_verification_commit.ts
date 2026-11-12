// PR11 checkpoint envelope/schema checks only: no replay in Nakama. Worker
// authentication and exact artifact execution remain separate trust boundaries.
namespace ShooterVerificationCommit {
  type Value = null | boolean | number | string | Value[] | { [key: string]: Value };
  type ObjectValue = { [key: string]: Value };
  function object(v: Value): ObjectValue {
    if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error("checkpoint_schema");
    return v;
  }
  function array(v: Value): Value[] { if (!Array.isArray(v)) throw new Error("checkpoint_schema"); return v; }
  function number(v: Value): number {
    if (typeof v !== "number" || !isFinite(v) || Math.floor(v) !== v || v < 0 || v > 9007199254740991) throw new Error("checkpoint_schema");
    return v;
  }
  function text(v: Value): string { if (typeof v !== "string") throw new Error("checkpoint_schema"); return v; }
  function exact(v: ObjectValue, fields: string[]): void {
    if (Object.keys(v).length !== fields.length || fields.some(function(k) { return !Object.prototype.hasOwnProperty.call(v,k); })) throw new Error("checkpoint_schema");
  }
  function stable(v: Value): string {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
    return "{" + Object.keys(v).sort().map(function(k) { return JSON.stringify(k) + ":" + stable(v[k]); }).join(",") + "}";
  }
  function hash(v: ObjectValue): void {
    var body: ObjectValue = {}; Object.keys(v).forEach(function(k) { if (k !== "privateHash") body[k] = v[k]; });
    if (v.privateHash !== fnv(stable(body))) throw new Error("checkpoint_hash");
  }
  function fnv(encoded: string): string {
    // Resolve the native multiply and immutable length once for large checkpoints.
    var h = 0x811c9dc5, multiply = Math.imul, length = encoded.length;
    for (var i = 0; i < length; i++) h = multiply(h ^ encoded.charCodeAt(i), 0x01000193);
    return ("00000000" + (h >>> 0).toString(16)).slice(-8);
  }
  function quantized(v: Value): Value {
    if (typeof v === "number") return Math.round(v * 1000000);
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(quantized);
    var out: ObjectValue = {}; Object.keys(v).forEach(function(k) { if (k !== "events") out[k] = quantized(v[k]); }); return out;
  }
  function vector(v: Value): void {
    var p = object(v);
    ["x", "y", "z"].forEach(function(k) { if (typeof p[k] !== "number" || !isFinite(p[k] as number)) throw new Error("checkpoint_state"); });
  }
  function state(v: Value, issuance: ObjectValue): void {
    var s = object(v); var level = object(s.level);
    if (s.version !== 1 || s.mode !== "campaign" || s.seed !== issuance.seed || level.id !== issuance.levelId
      || typeof level.section !== "string" || typeof level.checkpoint !== "string"
      || typeof s.time !== "number" || !isFinite(s.time) || s.time < 0) throw new Error("checkpoint_state");
    number(s.tick); var next = number(s.nextId); var local = number(s.localPlayerId);
    var rng = object(s.rng); exact(rng, ["a", "b", "c", "d"]);
    Object.keys(rng).forEach(function(k) { var n = rng[k]; if (typeof n !== "number" || Math.floor(n) !== n || n < -2147483648 || n > 4294967295) throw new Error("checkpoint_state"); });
    var players = object(s.players); if (!players[String(local)]) throw new Error("checkpoint_state");
    var ids: { [key: string]: boolean } = {};
    function entity(e: Value): void { var p = object(e); var id = number(p.id); if (id >= next || ids[String(id)]) throw new Error("checkpoint_state"); ids[String(id)] = true; }
    Object.keys(players).forEach(function(k) {
      var p = object(players[k]); if (String(p.id) !== k || p.kind !== "player" || typeof p.dead !== "boolean") throw new Error("checkpoint_state");
      ["pos", "prevPos", "vel"].forEach(function(f) { vector(p[f]); }); entity(p);
    });
    ["enemies", "allies", "projectiles", "pickups", "hazards"].forEach(function(k) { array(s[k]).forEach(entity); });
  }
  function replaySafe(s: ObjectValue): void {
    var tuning = object(s.tuning);
    if (tuning.godMode || tuning.infiniteAmmo || tuning.freezeEnemies || tuning.unlockAllRecipes
      || tuning.enemyHpMult !== 1 || tuning.enemyDmgMult !== 1 || s.testMode || s.bossFight) throw new Error("checkpoint_state");
    var player = object(object(s.players)[String(s.localPlayerId)]);
    function gun(v: Value): void {
      if (!v) return; var g = object(v);
      if (["start", "world", "boss", "drop"].indexOf(text(g.source)) < 0) throw new Error("checkpoint_inventory");
    }
    array(player.guns).forEach(gun);
    array(s.pickups).forEach(function(v) { gun(object(v).gun); });
  }
  function bounded(v: Value, depth: number, budget: { nodes: number }, stringLimit = 2097152): void {
    if (++budget.nodes > 1000000 || depth > 64) throw new Error("checkpoint_bounds");
    if (typeof v === "number" && !isFinite(v)) throw new Error("checkpoint_bounds");
    if (typeof v === "string" && v.length > stringLimit) throw new Error("checkpoint_bounds");
    if (v !== null && typeof v === "object") {
      var keys = Object.keys(v); if (keys.length > 100000) throw new Error("checkpoint_bounds");
      keys.forEach(function(k) {
        if (k.length > stringLimit || k === "__proto__" || k === "constructor" || k === "prototype") throw new Error("checkpoint_bounds");
        bounded((v as ObjectValue)[k], depth + 1, budget, stringLimit);
      });
    }
  }
  export function valid(nk: nkruntime.Nakama, raw: unknown): boolean {
    try {
      var body = object(raw as Value); var result = object(body.result); var cp = result.privateCheckpoint;
      if (cp === null) return true; // A bound operational/invalid verdict is handled transactionally.
      var c = object(cp); bounded(c, 0, { nodes: 0 });
      if (nk.stringToBinary(JSON.stringify(c)).byteLength > 16777216) return false;
      exact(c, ["v", "issuance", "snapshot", "accounting", "pending", "firstTerminal", "privateHash"]);
      if (c.v !== 2) return false; hash(c);
      var issuance = object(c.issuance); var snap = object(c.snapshot);
      exact(snap, ["v", "manifest", "binding", "state", "campaignCheckpoints", "parts", "counters", "privateHash"]);
      bounded(snap, 0, { nodes: 0 }, 16384);
      if (snap.v !== 1) return false; hash(snap); state(snap.state, issuance); replaySafe(object(snap.state));
      var manifest = object(body.manifest); var inner = object(snap.manifest);
      exact(inner, ["artifact", "sourceCommit", "sha256", "contentFingerprint", "protocol"]);
      Object.keys(inner).forEach(function(k) { if (inner[k] !== manifest[k]) throw new Error("checkpoint_manifest"); });
      var binding = object(snap.binding); exact(binding, ["runId", "accountId", "sessionId", "day"]);
      Object.keys(binding).forEach(function(k) { if (binding[k] !== issuance[k]) throw new Error("checkpoint_binding"); });
      var checkpoints = array(snap.campaignCheckpoints); if (checkpoints.length > 64) return false;
      var seen: { [key: string]: boolean } = {};
      checkpoints.forEach(function(v) {
        var entry = object(v); exact(entry, ["id", "state"]); var id = text(entry.id);
        if (seen[id]) throw new Error("checkpoint_state"); seen[id] = true;
        state(entry.state, issuance); var old = object(entry.state);
        if (number(old.tick) > number(object(snap.state).tick) || old.localPlayerId !== object(snap.state).localPlayerId
          || object(old.level).checkpoint !== id || "campaignCheckpoints" in old || "privateCheckpoint" in old) throw new Error("checkpoint_state");
      });
      if (!seen.start || !seen[text(object(object(snap.state).level).checkpoint)]) return false;
      var parts = object(snap.parts); var allowed = array(issuance.parts);
      Object.keys(parts).forEach(function(k) {
        if (allowed.indexOf(k) < 0) throw new Error("checkpoint_parts");
        var p = object(parts[k]); exact(p, ["type", "spawned", "dead", "fled", "sourceKind", "sourceId"]);
        if (p.type !== k || typeof p.spawned !== "boolean" || typeof p.dead !== "boolean" || typeof p.fled !== "boolean"
          || !(p.sourceKind === null || typeof p.sourceKind === "string") || !(p.sourceId === null || number(p.sourceId) >= 0)) throw new Error("checkpoint_parts");
      });
      var accounting = object(c.accounting);
      exact(accounting, ["acceptedFrames", "verifiedFrames", "simFrames", "framesTextBytes", "verifiedFramesTextBytes", "actions", "verifiedActions", "batches", "verifiedBatches"]);
      Object.keys(accounting).forEach(function(k) { number(accounting[k]); });
      var counters = object(snap.counters); exact(counters, ["frames", "segments"]);
      if (counters.frames !== accounting.verifiedFrames || counters.segments !== accounting.verifiedBatches
        || object(snap.state).tick !== accounting.simFrames) return false;
      var pub = object(result.publicResult);
      var fields: { [key: string]: string } = { acceptedInputTick: "acceptedFrames", verifiedInputTick: "verifiedFrames", simulationTick: "simFrames", acceptedBatches: "batches", verifiedBatches: "verifiedBatches", framesTextBytes: "framesTextBytes", verifiedFramesTextBytes: "verifiedFramesTextBytes", actions: "actions", verifiedActions: "verifiedActions" };
      Object.keys(fields).forEach(function(k) { if (pub[k] !== accounting[fields[k]]) throw new Error("checkpoint_accounting"); });
      var current = object(snap.state); var local = number(current.localPlayerId); var player = object(object(current.players)[String(local)]);
      var expectedParts = allowed.map(function(k) { var key = text(k); return parts[key] === undefined ? { type: key, spawned: false, dead: false, fled: false, sourceKind: null, sourceId: null } : object(parts[key]); });
      var outcome = "incomplete", reason = "boss_alive", eligible = false;
      if (player.dead === true) { outcome = "fail"; reason = "player_down"; }
      else if (expectedParts.some(function(p) { return p.fled === true; })) { outcome = "fail"; reason = "boss_fled"; }
      else if (expectedParts.every(function(p) { return p.dead === true; })) {
        eligible = expectedParts.every(function(p) { return (p.sourceKind === "gun" || p.sourceKind === "splash") && p.sourceId === local; });
        outcome = eligible ? "clear" : "assisted"; reason = eligible ? "boss_clear" : "assisted";
      }
      if (c.firstTerminal === null) return outcome === "incomplete" && pub.terminal === null && pub.eligible === false && pub.ranked === false && accounting.simFrames === accounting.verifiedFrames;
      var terminal = object(c.firstTerminal);
      exact(terminal, ["outcome", "reason", "eligible", "ranked", "canonicalCount", "parts", "stateHash", "simTick", "inputFrame"]);
      if (terminal.outcome !== outcome || terminal.reason !== reason || terminal.eligible !== eligible
        || terminal.ranked !== (outcome === "clear") || terminal.canonicalCount !== (outcome === "clear" || outcome === "assisted" ? 1 : 0)
        || terminal.stateHash !== fnv(stable(quantized(current))) || terminal.simTick !== accounting.simFrames
        || terminal.inputFrame !== terminal.simTick || stable(terminal.parts) !== stable(expectedParts)) return false;
      var projected: ObjectValue = {}; Object.keys(terminal).forEach(function(k) { if (k !== "parts") projected[k] = terminal[k]; });
      return stable(projected) === stable(pub.terminal) && pub.eligible === terminal.eligible && pub.ranked === terminal.ranked;
    } catch (_e) { return false; }
  }
}
