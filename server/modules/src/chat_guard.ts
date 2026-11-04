// Plaza chat guard (Contract C14): RT before-hooks for channel join and message
// send. ES5 re-implementation of packages/hub-sdk/src/realtime/chatRules.ts; a
// unit test checks both against the same fixture table.
namespace HubChat {
  export var TEXT_MAX = 120;
  export var RAW_MAX_BYTES = 512;
  export var RATE_BURST = 5;
  export var REFILL_MS = 1500;
  export var GUEST_REFILL_MS = 3000;
  export var DUPLICATE_MS = 30000;
  var MUTE_CACHE_S = 30;
  var GUEST_CACHE_S = 600;

  var COLORS: { [k: string]: boolean } = {
    yellow: true, red: true, green: true, cyan: true, purple: true, white: true,
    flash1: true, flash2: true, flash3: true, glow1: true, glow2: true, glow3: true,
  };
  var EFFECTS: { [k: string]: boolean } = { wave: true, wave2: true, shake: true, scroll: true, slide: true };
  var STRIP = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤⁦-⁯﻿]/g;
  var SUFFIXES = ["", "s", "es", "er", "ers", "ing", "ed", "y", "z"];
  var LEET: { [k: string]: string } = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", "$": "s", "!": "i", "|": "l", "+": "t" };
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  export interface Content {
    text: string;
    color?: string;
    effect?: string;
  }

  function byteLength(text: string): number {
    var n = 0;
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff) {
        n += 4;
        i++;
      } else n += 3;
    }
    return n;
  }

  export function normalize(text: string): string {
    var out = text;
    var s = out as unknown as { normalize?: (form: string) => string };
    if (typeof s.normalize === "function") {
      try {
        out = s.normalize("NFC");
      } catch (_e) {
        out = text;
      }
    }
    return out.replace(/[\t\n\r\f\v]/g, " ").replace(STRIP, "").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
  }

  /** { ok, content } or { ok:false, code } with the same codes as validateChatContent in the SDK. */
  export function validate(raw: string): { ok: boolean; code?: string; content?: Content } {
    if (typeof raw !== "string" || byteLength(raw) > RAW_MAX_BYTES) return { ok: false, code: "chat_too_long" };
    var parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (_e) {
      return { ok: false, code: "chat_bad_json" };
    }
    if (!parsed || typeof parsed !== "object" || Object.prototype.toString.call(parsed) === "[object Array]") {
      return { ok: false, code: "chat_bad_json" };
    }
    var body = parsed as { [k: string]: unknown };
    if (typeof body.text !== "string") return { ok: false, code: "chat_bad_json" };
    var text = normalize(body.text);
    if (!text) return { ok: false, code: "chat_empty" };
    if (text.length > TEXT_MAX) return { ok: false, code: "chat_too_long" };
    var content: Content = { text: text };
    if (typeof body.color === "string" && COLORS[body.color]) content.color = body.color;
    if (typeof body.effect === "string" && EFFECTS[body.effect]) content.effect = body.effect;
    return { ok: true, content: content };
  }

  function rot13(word: string): string {
    return word.replace(/[a-z]/g, function (c) {
      return String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97);
    });
  }

  var hardSet: { [w: string]: boolean } | null = null;
  var maskSet: { [w: string]: boolean } | null = null;

  function sets(): { hard: { [w: string]: boolean }; mask: { [w: string]: boolean } } {
    if (!hardSet || !maskSet) {
      hardSet = {};
      maskSet = {};
      for (var i = 0; i < HubChatWords.HARD_ROT13.length; i++) hardSet[rot13(HubChatWords.HARD_ROT13[i])] = true;
      for (var j = 0; j < HubChatWords.MASK.length; j++) maskSet[HubChatWords.MASK[j]] = true;
    }
    return { hard: hardSet, mask: maskSet };
  }

  function fold(token: string): string {
    var lower = token.toLowerCase();
    var out = "";
    for (var i = 0; i < lower.length; i++) {
      var ch = lower.charAt(i);
      out += LEET[ch] !== undefined ? LEET[ch] : ch;
    }
    // Collapse runs of the same letter ("fuuuck" -> "fuck").
    return out.replace(/([a-z])\1{2,}/g, "$1").replace(/[^a-z]/g, "");
  }

  function hits(word: string, set: { [w: string]: boolean }): boolean {
    for (var i = 0; i < SUFFIXES.length; i++) {
      var sfx = SUFFIXES[i];
      if (sfx && word.length > sfx.length && word.slice(word.length - sfx.length) === sfx && set[word.slice(0, word.length - sfx.length)]) return true;
      if (!sfx && set[word]) return true;
    }
    // "fuuck" style doubles that survived the 3+ collapse.
    var single = word.replace(/([a-z])\1+/g, "$1");
    return single !== word && !!set[single];
  }

  /** Masks profanity; `hard` is true when a slur from the hard list appears (the caller rejects the line). */
  export function filter(text: string): { text: string; masked: boolean; hard: boolean } {
    var lists = sets();
    var masked = false;
    var hard = false;
    var out = text.replace(/[A-Za-z0-9@$!|+]+/g, function (token) {
      var word = fold(token);
      if (!word) return token;
      if (hits(word, lists.hard)) {
        hard = true;
        return token;
      }
      if (hits(word, lists.mask)) {
        masked = true;
        var stars = "";
        for (var i = 1; i < token.length; i++) stars += "*";
        return token.charAt(0) + stars;
      }
      return token;
    });
    // Spaced-out slurs ("n i g g e r"): runs of four or more single characters.
    if (!hard) {
      var runs = text.match(/(?:^|\s)(?:\S\s+){3,}\S(?=\s|$)/g) || [];
      for (var r = 0; r < runs.length && !hard; r++) {
        if (hits(fold(runs[r].replace(/\s+/g, "")), lists.hard)) hard = true;
      }
    }
    return { text: out, masked: masked, hard: hard };
  }

  /** Token bucket stored as "<tokens>:<lastMs>" (localcache values must be scalars, Contract C12). */
  export function takeToken(state: string | null, nowMs: number, refillMs: number): { allowed: boolean; state: string } {
    var tokens = RATE_BURST;
    var last = nowMs;
    if (state) {
      var parts = String(state).split(":");
      var pt = Number(parts[0]);
      var pl = Number(parts[1]);
      if (isFinite(pt) && isFinite(pl)) {
        tokens = Math.min(RATE_BURST, pt + Math.max(0, nowMs - pl) / refillMs);
      }
    }
    if (tokens < 1) return { allowed: false, state: String(tokens) + ":" + String(last) };
    return { allowed: true, state: String(tokens - 1) + ":" + String(last) };
  }

  function scopeOf(ctx: nkruntime.Context): string {
    return ctx.vars && ctx.vars.scope ? ctx.vars.scope : "";
  }

  function gameOf(ctx: nkruntime.Context): string {
    return ctx.vars && ctx.vars.game ? ctx.vars.game : "";
  }

  /** Guests are device-only accounts (no email). Cached 10 min as "1"/"0". */
  export function isGuest(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string): boolean {
    var key = "guest:" + userId;
    var cached = nk.localcacheGet(key);
    if (cached === "1" || cached === "0") return cached === "1";
    var guest = true;
    try {
      var account = nk.accountGetId(userId);
      guest = !(account && account.email);
    } catch (e) {
      logger.warn("chat guest lookup failed " + String(e));
    }
    nk.localcachePut(key, guest ? "1" : "0", GUEST_CACHE_S);
    return guest;
  }

  /** Mute end in epoch ms (0 = not muted). game.chat_mute, cached 30 s. */
  export function mutedUntil(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string): number {
    var key = "mute:" + userId;
    var cached = nk.localcacheGet(key);
    if (typeof cached === "string" && cached !== "" && isFinite(Number(cached))) return Number(cached);
    var until = 0;
    try {
      var rows = nk.sqlQuery(
        "SELECT COALESCE(floor(extract(epoch FROM max(until)) * 1000), 0)::bigint::text AS until FROM game.chat_mute WHERE user_id = $1::uuid AND until > now()",
        [userId],
      );
      if (rows && rows.length) until = Number(rows[0].until) || 0;
    } catch (e) {
      logger.warn("chat mute lookup failed " + String(e));
    }
    nk.localcachePut(key, String(until), MUTE_CACHE_S);
    return until;
  }

  function reportAuto(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, channelId: string, text: string): void {
    try {
      nk.sqlExec(
        "INSERT INTO game.chat_report (reporter, target, channel_id, message_id, text, reason) VALUES (NULL, $1::uuid, $2, '', $3, 'auto')",
        [userId, channelId.slice(0, 128), text.slice(0, 512)],
      );
    } catch (e) {
      logger.warn("chat auto report failed " + String(e));
    }
  }

  /**
   * Single place for an external moderation call later. Synchronous and local for
   * now; return a code to reject, or null.
   */
  export function onMessage(_nk: nkruntime.Nakama, _logger: nkruntime.Logger, _userId: string, _channelId: string, _content: Content): string | null {
    return null;
  }

  export function beforeJoin(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, envelope: nkruntime.Envelope): nkruntime.Envelope {
    var join = envelope.channelJoin;
    if (!join || !ctx.userId) throw new Error("room_not_allowed");
    var scope = scopeOf(ctx);
    var type = Number(join.type || 1);
    var target = typeof join.target === "string" ? join.target : "";
    if (type === 1) {
      if (!HubGames.roomAllowed(scope, gameOf(ctx), target)) throw new Error("room_not_allowed");
      return envelope;
    }
    if (scope !== "hub" && scope !== "") throw new Error("room_not_allowed");
    if (type === 2) {
      if (!UUID.test(target) || target === ctx.userId) throw new Error("room_not_allowed");
      // The target blocked the caller (friend state 3): no direct channel.
      try {
        var list = nk.friendsList(target, 1000, 3);
        var friends = (list && list.friends) || [];
        for (var i = 0; i < friends.length; i++) {
          if (friends[i].user && friends[i].user.userId === ctx.userId) throw new Error("chat_blocked");
        }
      } catch (e) {
        if (String(e).indexOf("chat_blocked") >= 0) throw e;
        logger.warn("chat block lookup failed " + String(e));
      }
      return envelope;
    }
    if (type === 3) return envelope; // Nakama enforces group membership.
    throw new Error("room_not_allowed");
  }

  export function beforeSend(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, envelope: nkruntime.Envelope): nkruntime.Envelope {
    var send = envelope.channelMessageSend;
    var userId = ctx.userId || "";
    if (!send || !UUID.test(userId)) throw new Error("chat_rejected");
    var checked = validate(typeof send.content === "string" ? send.content : "");
    if (!checked.ok || !checked.content) throw new Error(checked.code || "chat_rejected");
    var content = checked.content;
    var channelId = typeof send.channelId === "string" ? send.channelId : "";
    if (mutedUntil(nk, logger, userId) > Date.now()) throw new Error("chat_muted");
    var filtered = filter(content.text);
    if (filtered.hard) {
      reportAuto(nk, logger, userId, channelId, content.text);
      throw new Error("chat_rejected");
    }
    var now = Date.now();
    var refill = isGuest(nk, logger, userId) ? GUEST_REFILL_MS : REFILL_MS;
    var bucketKey = "chat:" + userId;
    var bucket = takeToken((nk.localcacheGet(bucketKey) as string | null) || null, now, refill);
    if (!bucket.allowed) {
      nk.localcachePut(bucketKey, bucket.state, 60);
      throw new Error("chat_rate_limited");
    }
    var dupKey = "chatlast:" + userId;
    var last = nk.localcacheGet(dupKey);
    var sig = nk.sha256Hash(content.text.toLowerCase());
    if (typeof last === "string" && last === sig) throw new Error("chat_duplicate");
    var verdict = onMessage(nk, logger, userId, channelId, content);
    if (verdict) throw new Error(verdict);
    nk.localcachePut(bucketKey, bucket.state, 60);
    nk.localcachePut(dupKey, sig, DUPLICATE_MS / 1000);
    content.text = filtered.text;
    send.content = JSON.stringify(content);
    return envelope;
  }

  export function beforeReadonly(_ctx: nkruntime.Context, _logger: nkruntime.Logger, _nk: nkruntime.Nakama, _envelope: nkruntime.Envelope): nkruntime.Envelope {
    throw new Error("chat_readonly");
  }
}
