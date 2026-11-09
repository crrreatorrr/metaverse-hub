var SprotoShooterPvp = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/sim/pvp/export.js
  var export_exports = {};
  __export(export_exports, {
    CONTENT_FINGERPRINT: () => CONTENT_FINGERPRINT,
    ECONOMY: () => ECONOMY,
    INPUT_LIMITS: () => INPUT_LIMITS,
    LOADOUT_HASH: () => LOADOUT_HASH,
    OP: () => OP,
    PVP_PROTOCOL_VERSION: () => PVP_PROTOCOL_VERSION,
    PVP_SIM_VERSION: () => PVP_SIM_VERSION,
    SOURCE_COMMIT: () => SOURCE_COMMIT,
    createDirector: () => createDirector,
    decodeInput: () => decodeInput,
    encodeInput: () => encodeInput,
    replayJSON: () => replayJSON
  });

  // src/data/tuning.js
  var TUNING = {
    arenaRadius: 45,
    spawnRadius: 43,
    spawnPointCount: 16,
    weaponBoxes: [{ x: -28, z: 0 }, { x: 28, z: 0 }],
    boxRadius: 1,
    boxInteractRadius: 3,
    eyeHeight: 1.6,
    slideEye: 0.9,
    downedEye: 0.6,
    playerRadius: 0.4,
    playerHeight: 1.8,
    walkSpeed: 6.5,
    sprintSpeed: 9.5,
    groundAccel: 60,
    friction: 10,
    airAccel: 18,
    gravity: 22,
    jumpVel: 8,
    doubleJumpVel: 7,
    coyote: 0.1,
    jumpBuffer: 0.1,
    slideMinSpeed: 5,
    slideBoost: 13,
    slideTime: 0.75,
    slideCd: 0.4,
    dashSpeed: 24,
    dashTime: 0.15,
    dashCd: 2,
    dashInvuln: 0.12,
    fovBase: 90,
    fovSprint: 6,
    fovAds: 70,
    fovScope: 12,
    // god mode keeps you at or above these while it's on
    godTickets: 99999,
    godResources: 9999,
    maxHp: 100,
    maxShield: 50,
    maxMana: 100,
    shieldDelay: 3,
    shieldRegen: 25,
    quickShieldDelay: 1.8,
    quickShieldRegenMult: 1.5,
    manaRegen: 5,
    secondWindTime: 10,
    reviveHpFrac: 0.3,
    reviveInvuln: 2,
    downedSpeedMult: 0.3,
    sandboxRespawn: 3,
    startAmmo: { bullets: 240, shells: 24, sniper: 12, rockets: 4 },
    ammoCap: { bullets: 480, shells: 64, sniper: 36, rockets: 12 },
    ammoDrop: { bullets: 45, shells: 8, sniper: 5, rockets: 2 },
    medkitHeal: 50,
    medkitTime: 0.8,
    medkitCarry: 3,
    healthOrb: 20,
    bigOrb: 60,
    manaOrb: 25,
    magnetRadius: 4,
    magnetAccel: 30,
    collectRadius: 0.9,
    pickupTtl: 30,
    gunPickupTtl: 120,
    gunPickupRadius: 2.2,
    hitscanRange: 150
  };
  var ARENA_R = TUNING.arenaRadius;

  // src/data/guns.js
  var B = (o) => ({
    damage: 0,
    fireRate: 1,
    spread: 1,
    adsSpread: 0.5,
    magSize: 1,
    reloadTime: 2,
    projectileSpeed: 0,
    critMult: 2,
    critChance: 0.05,
    elementChance: 0.1,
    pellets: 1,
    splashRadius: 0,
    splashDamage: 0,
    recoil: 1,
    recoilYaw: 0.2,
    swapTime: 0.5,
    zoomFov: 70,
    pierce: 0,
    ...o
  });
  var GUN_TYPES = [
    // infiniteReserve: spare ammo never runs out, but the magazine still empties and reloads
    // range (hitscan): full damage up to `full` metres, falling off to `min`× at `max`; nothing hits beyond `max`
    {
      id: "mg",
      name: "Machine Gun",
      short: "MG",
      ammoType: "bullets",
      weight: 60,
      fireMode: "auto",
      infiniteReserve: true,
      range: { full: 30, max: 75, min: 0.5 },
      base: B({ damage: 9, fireRate: 10, spread: 1.2, adsSpread: 0.45, magSize: 36, reloadTime: 2.5, critMult: 2, critChance: 0.05, elementChance: 0.1, recoil: 0.35, recoilYaw: 0.15, swapTime: 0.5, zoomFov: 70 })
    },
    {
      id: "shotgun",
      name: "Shotgun",
      short: "SG",
      ammoType: "shells",
      weight: 17,
      fireMode: "auto",
      range: { full: 7, max: 16, min: 0.3 },
      base: B({ damage: 8, pellets: 9, fireRate: 1.2, spread: 6, adsSpread: 4.5, magSize: 6, reloadTime: 2.4, critMult: 2, critChance: 0.03, elementChance: 0.06, recoil: 3.5, recoilYaw: 1, swapTime: 0.5, zoomFov: 75 })
    },
    // zoomLevels: 2 = a second, much stronger zoom (field of view × SCOPE_ZOOM2) for long range
    {
      id: "sniper",
      name: "Sniper",
      short: "SN",
      ammoType: "sniper",
      weight: 17,
      fireMode: "auto",
      zoomLevels: 2,
      range: { full: 120, max: 150, min: 1 },
      base: B({ damage: 85, fireRate: 0.8, spread: 3, adsSpread: 0, magSize: 4, reloadTime: 2.6, critMult: 3, critChance: 0.08, elementChance: 0.35, recoil: 5, recoilYaw: 0.8, swapTime: 0.6, zoomFov: 12, pierce: 1 })
    },
    {
      id: "bazooka",
      name: "Bazooka",
      short: "BZ",
      ammoType: "rockets",
      weight: 6,
      fireMode: "auto",
      base: B({ damage: 140, fireRate: 0.6, spread: 0.5, adsSpread: 0.2, magSize: 1, reloadTime: 2.2, projectileSpeed: 28, critMult: 1.5, critChance: 0, elementChance: 0.5, splashRadius: 4, splashDamage: 110, recoil: 4, recoilYaw: 0.5, swapTime: 0.7, zoomFov: 70 })
    },
    // Boss weapons (bossOnly): never rolled at random (weight 0), not crafted or sold in the shop. Every boss kill
    // drops one (data/drops.js 'bossGun'). Endless spare ammo; the magazine still reloads.
    // Ray Gun: a piercing laser beam (hitscan, drawn as a glowing ray), fast and accurate.
    {
      id: "raygun",
      name: "Ray Gun",
      short: "RG",
      ammoType: "energy",
      weight: 0,
      bossOnly: true,
      beam: true,
      fireMode: "auto",
      infiniteReserve: true,
      range: { full: 60, max: 100, min: 0.6 },
      base: B({ damage: 24, fireRate: 7, spread: 0.3, adsSpread: 0.08, magSize: 30, reloadTime: 2.2, critMult: 2.2, critChance: 0.08, elementChance: 0.2, recoil: 0.3, recoilYaw: 0.08, swapTime: 0.55, zoomFov: 60, pierce: 2 })
    },
    // Big Bullets: huge, slow-firing rounds you can watch fly; each hit does massive damage, punches through one
    // target and bursts on impact.
    {
      id: "bigbullets",
      name: "Big Bullets",
      short: "BB",
      ammoType: "heavy",
      weight: 0,
      bossOnly: true,
      projectile: "bigBullet",
      fireMode: "auto",
      infiniteReserve: true,
      base: B({ damage: 340, fireRate: 1.1, spread: 0.5, adsSpread: 0.1, magSize: 4, reloadTime: 2.6, projectileSpeed: 70, critMult: 2.5, critChance: 0.1, elementChance: 0.3, splashRadius: 2.5, splashDamage: 120, recoil: 6.5, recoilYaw: 1, swapTime: 0.7, zoomFov: 60, pierce: 1 })
    },
    // Duck Gun (legendaryOnly): always legendary, never rolled at random; the sandbox has one to grab. Lobs
    // medium-sized rubber bullets that bounce once off the floor or arena wall and explode on whatever they hit
    // (or when they land after the bounce), damaging everything nearby.
    {
      id: "duckgun",
      name: "Duck Gun",
      short: "DG",
      ammoType: "rubber",
      weight: 0,
      legendaryOnly: true,
      projectile: "rubberBullet",
      fireMode: "auto",
      infiniteReserve: true,
      base: B({ damage: 60, fireRate: 2.2, spread: 0.9, adsSpread: 0.3, magSize: 8, reloadTime: 2.4, projectileSpeed: 36, critMult: 2, critChance: 0.08, elementChance: 0.25, splashRadius: 3.6, splashDamage: 95, recoil: 3, recoilYaw: 0.6, swapTime: 0.6, zoomFov: 62 })
    }
  ];
  var BOSS_GUN_TYPES = GUN_TYPES.filter((t) => t.bossOnly).map((t) => t.id);
  var QUALITIES = [
    { id: "common", idx: 0, name: "Common", color: "#cfcfcf", weight: 55, damageMult: 1, magMult: 1, reloadMult: 1, spreadMult: 1, partSlots: 1, priceMult: 1, sellMult: 1 },
    { id: "uncommon", idx: 1, name: "Uncommon", color: "#4cd964", weight: 27, damageMult: 1.12, magMult: 1.1, reloadMult: 0.97, spreadMult: 0.95, partSlots: 2, priceMult: 1.6, sellMult: 1.6 },
    { id: "rare", idx: 2, name: "Rare", color: "#3fa9ff", weight: 12, damageMult: 1.27, magMult: 1.15, reloadMult: 0.94, spreadMult: 0.9, partSlots: 3, priceMult: 2.6, sellMult: 2.6 },
    { id: "epic", idx: 3, name: "Epic", color: "#b05cff", weight: 5, damageMult: 1.45, magMult: 1.2, reloadMult: 0.9, spreadMult: 0.85, partSlots: 4, priceMult: 4.2, sellMult: 4.2 },
    { id: "legendary", idx: 4, name: "Legendary", color: "#ff9f1a", weight: 1, damageMult: 1.7, magMult: 1.3, reloadMult: 0.85, spreadMult: 0.8, partSlots: 4, priceMult: 7, sellMult: 7 }
  ];
  var MANUFACTURERS = [
    { id: "blastco", name: "Blastco", color: 14240314, weight: 1, mods: { damage: 1.15, fireRate: 0.9, recoil: 1.2 }, add: {}, quirk: "Big boom, big kick" },
    { id: "zippity", name: "Zippity", color: 3800968, weight: 1, mods: { fireRate: 1.2, magSize: 1.25, damage: 0.88, reloadTime: 0.85 }, add: {}, quirk: "Brrrrrt" },
    { id: "reliable", name: "Ol' Reliable", color: 11041098, weight: 1, mods: { spread: 0.7, adsSpread: 0.7, recoil: 0.7, reloadTime: 1.1 }, add: { critMult: 0.3 }, quirk: "Steady as a rock" },
    { id: "gloop", name: "Gloop Labs", color: 10181119, weight: 1, mods: { elementChance: 1.5, damage: 0.95 }, add: { elementChance: 0.05 }, alwaysElement: true, quirk: "Always elemental" }
  ];
  var SLOTS = ["barrel", "grip", "mag", "scope"];
  var PARTS = [
    { id: "long", slot: "barrel", name: "Long Barrel", mods: { damage: 1.1, spread: 0.85, projectileSpeed: 1.1, fireRate: 0.95 }, add: {} },
    { id: "short", slot: "barrel", name: "Short Barrel", mods: { fireRate: 1.1, spread: 1.25 }, add: {} },
    { id: "ported", slot: "barrel", name: "Ported Barrel", mods: { recoil: 0.75 }, add: {} },
    { id: "ergo", slot: "grip", name: "Ergo Grip", mods: { recoil: 0.8 }, add: {} },
    { id: "quickdraw", slot: "grip", name: "Quickdraw Grip", mods: { swapTime: 0.75, reloadTime: 0.9 }, add: {} },
    { id: "heavy", slot: "grip", name: "Heavy Grip", mods: { adsSpread: 0.7, recoil: 0.9, fireRate: 0.95 }, add: {} },
    { id: "drum", slot: "mag", name: "Drum Mag", mods: { magSize: 1.5, reloadTime: 1.2 }, add: {} },
    { id: "quick", slot: "mag", name: "Quick Mag", mods: { reloadTime: 0.75, magSize: 0.85 }, add: {} },
    { id: "spicy", slot: "mag", name: "Spicy Mag", mods: {}, add: { elementChance: 0.1 } },
    { id: "redDot", slot: "scope", name: "Red Dot", mods: { adsSpread: 0.8 }, add: {} },
    { id: "longScope", slot: "scope", name: "Long Scope", mods: { zoomFov: 0.75 }, add: { critMult: 0.3 } },
    { id: "lucky", slot: "scope", name: "Lucky Scope", mods: {}, add: { critChance: 0.05 } }
  ];
  var ELEMENTS = [
    { id: "none", name: "Plain", color: "#dddddd", weight: 50 },
    { id: "fire", name: "Fire", color: "#ff7a1a", weight: 17, proc: { kind: "burn", dpsFrac: 0.25, duration: 3 } },
    { id: "shock", name: "Shock", color: "#4fe3ff", weight: 17, proc: { kind: "chain", targets: 2, range: 5, dmgFrac: 0.5 } },
    { id: "goo", name: "Goo", color: "#9be33b", weight: 16, proc: { kind: "slow", slow: 0.4, duration: 2.5 } }
  ];
  var WACKY = [
    { id: "rubberDuck", name: "Rubber Duckie", desc: "Shots become bouncing rubber ducks.", allowedTypes: ["mg", "shotgun", "sniper"] },
    { id: "yeetReload", name: "Yeet Reload", desc: "Reloading throws the gun as an explosive.", allowedTypes: ["mg", "shotgun", "sniper", "bazooka", "raygun", "bigbullets", "duckgun"] },
    { id: "tenthMega", name: "Every Tenth", desc: "Every 10th shot fires a giant mega bullet.", allowedTypes: ["mg", "shotgun", "sniper"] },
    { id: "critSproto", name: "Lil Buddy", desc: "Weak-spot hits spawn a mini friendly Sproto.", allowedTypes: ["mg", "shotgun", "sniper", "bazooka", "raygun", "bigbullets", "duckgun"] },
    { id: "confettiKill", name: "Party Popper", desc: "Kills explode in damaging confetti.", allowedTypes: ["mg", "shotgun", "sniper", "bazooka", "raygun", "bigbullets", "duckgun"] },
    { id: "bigHead", name: "Big Head Mode", desc: "Enemies you hit get huge heads (bigger weak spots).", allowedTypes: ["mg", "shotgun", "sniper", "bazooka", "raygun", "bigbullets", "duckgun"] }
  ];
  var byId = (arr) => Object.fromEntries(arr.map((x) => [x.id, x]));
  var GUN_TYPES_BY_ID = byId(GUN_TYPES);
  var QUALITIES_BY_ID = byId(QUALITIES);
  var MANUFACTURERS_BY_ID = byId(MANUFACTURERS);
  var PARTS_BY_ID = byId(PARTS);
  var ELEMENTS_BY_ID = byId(ELEMENTS);
  var WACKY_BY_ID = byId(WACKY);
  var SCOPE_ZOOM2 = 1 / 3;
  function rangeFalloff(range, d) {
    if (d > range.max) return 0;
    if (d <= range.full) return 1;
    return 1 + (range.min - 1) * ((d - range.full) / Math.max(1e-6, range.max - range.full));
  }
  var PARTS_BY_SLOT = Object.fromEntries(SLOTS.map((s) => [s, PARTS.filter((p) => p.slot === s)]));

  // src/core/rng.js
  function hashSeed(n) {
    let s = n >>> 0 || 2654435769;
    const out = [];
    for (let i = 0; i < 4; i++) {
      s = s + 2654435769 >>> 0;
      let z = s;
      z = Math.imul(z ^ z >>> 16, 2246822507) >>> 0;
      z = Math.imul(z ^ z >>> 13, 3266489909) >>> 0;
      out.push((z ^ z >>> 16) >>> 0);
    }
    return out;
  }
  function createRng(seed) {
    const [a, b, c, d] = hashSeed(seed);
    const r = { a, b, c, d };
    for (let i = 0; i < 12; i++) next(r);
    return r;
  }
  function next(r) {
    r.a >>>= 0;
    r.b >>>= 0;
    r.c >>>= 0;
    r.d >>>= 0;
    const t = r.a + r.b >>> 0;
    r.a = r.b ^ r.b >>> 9;
    r.b = r.c + (r.c << 3) >>> 0;
    r.c = r.c << 21 | r.c >>> 11;
    r.d = r.d + 1 >>> 0;
    const res = t + r.d >>> 0;
    r.c = r.c + res >>> 0;
    return res;
  }
  var float = (r) => next(r) / 4294967296;
  var chance = (r, p) => float(r) < p;

  // src/core/math.js
  var deg = (d) => d * Math.PI / 180;
  function dirFromYawPitch(yaw, pitch) {
    const cp = Math.cos(pitch);
    return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
  }
  var yawTo = (a, b) => Math.atan2(-(b.x - a.x), -(b.z - a.z));

  // src/sim/hash.js
  function stableStringify(value) {
    if (value === null) return "null";
    const t = typeof value;
    if (t === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
    if (t === "string" || t === "boolean") return JSON.stringify(value);
    if (t !== "object") return "null";
    if (Array.isArray(value)) {
      let s2 = "[";
      for (let i = 0; i < value.length; i++) {
        if (i) s2 += ",";
        s2 += stableStringify(value[i]);
      }
      return s2 + "]";
    }
    const keys = Object.keys(value).sort();
    let s = "{";
    let n = 0;
    for (const k of keys) {
      const v = value[k];
      if (v === void 0) continue;
      if (n++) s += ",";
      s += JSON.stringify(k) + ":" + stableStringify(v);
    }
    return s + "}";
  }
  function fnv1a(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }
  function quantizeForHash(value) {
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return 0;
      return Math.round(value * 1e6);
    }
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) {
      const arr = new Array(value.length);
      for (let i = 0; i < value.length; i++) arr[i] = quantizeForHash(value[i]);
      return arr;
    }
    const out = {};
    const keys = Object.keys(value);
    for (let i = 0; i < keys.length; i++) {
      if (keys[i] === "events") continue;
      out[keys[i]] = quantizeForHash(value[keys[i]]);
    }
    return out;
  }
  function verifyStateHash(state) {
    return fnv1a(stableStringify(quantizeForHash(state)));
  }

  // src/sim/pvp/hit.js
  function raySphere(o, d, c, r) {
    const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
    const b = ox * d.x + oy * d.y + oz * d.z;
    const cc = ox * ox + oy * oy + oz * oz - r * r;
    const disc = b * b - cc;
    if (disc < 0) return -1;
    const s = Math.sqrt(disc);
    let t = -b - s;
    if (t < 0) t = -b + s;
    return t >= 0 ? t : -1;
  }
  function rayCapsule(o, d, cx, cz, y0, y1, r) {
    const a0 = y0 + r, a1 = Math.max(a0, y1 - r);
    let best = -1;
    const ox = o.x - cx, oz = o.z - cz;
    const A = d.x * d.x + d.z * d.z;
    if (A > 1e-9) {
      const B2 = ox * d.x + oz * d.z;
      const C = ox * ox + oz * oz - r * r;
      const disc = B2 * B2 - A * C;
      if (disc >= 0) {
        const s = Math.sqrt(disc);
        for (const t of [(-B2 - s) / A, (-B2 + s) / A]) {
          if (t < 0) continue;
          const y = o.y + d.y * t;
          if (y >= a0 && y <= a1) {
            best = t;
            break;
          }
        }
      }
    }
    for (const yy of [a0, a1]) {
      const t = raySphere(o, d, { x: cx, y: yy, z: cz }, r);
      if (t >= 0 && (best < 0 || t < best)) best = t;
    }
    return best;
  }

  // src/sim/pvp/rules.js
  var PVP_PROTOCOL_VERSION = 1;
  var PVP_SIM_VERSION = 1;
  var TICK_HZ = 30;
  var DT = 1 / TICK_HZ;
  var STEP_MS = 1e3 / TICK_HZ;
  var MATCH_SECONDS = 90;
  var MATCH_TICKS = MATCH_SECONDS * TICK_HZ;
  var MAX_MATCH_MS = 10 * 60 * 1e3;
  var READY_MS = 30 * 1e3;
  var STALL_MS = 10 * 1e3;
  var SPAWN_RADIUS = 16;
  var STAGE_ID = "arena";
  var GUN_IDS = Object.freeze(["mg", "shotgun", "sniper"]);
  var INPUT_LIMITS = Object.freeze({
    maxInputsPerSecond: 60,
    maxInputsPerTick: 4,
    futureFrames: 4,
    pastFrames: 15,
    frameBytes: 16,
    maxFrame: 1e6,
    maxIdLength: 80
  });
  function round3(n) {
    return Math.round(n * 1e3) / 1e3;
  }
  function arenaGun(typeId) {
    const def = GUN_TYPES_BY_ID[typeId];
    const man = MANUFACTURERS_BY_ID.reliable;
    const quality = QUALITIES_BY_ID.common;
    const stats = { ...def.base };
    for (const [key, mult] of Object.entries(man.mods || {})) if (key in stats) stats[key] *= mult;
    for (const [key, add] of Object.entries(man.add || {})) if (key in stats) stats[key] += add;
    stats.damage *= quality.damageMult;
    if (stats.splashDamage) stats.splashDamage *= quality.damageMult;
    stats.magSize = Math.max(1, Math.round(stats.magSize * quality.magMult));
    stats.reloadTime = Math.max(0.3, stats.reloadTime * quality.reloadMult);
    stats.spread *= quality.spreadMult;
    stats.adsSpread *= quality.spreadMult;
    stats.elementChance = 0;
    stats.splashRadius = 0;
    stats.splashDamage = 0;
    for (const key of Object.keys(stats)) {
      if (key === "magSize" || key === "pellets" || key === "pierce") stats[key] = Math.round(stats[key]);
      else stats[key] = round3(stats[key]);
    }
    return {
      type: typeId,
      name: def.name,
      quality: "common",
      manufacturer: "reliable",
      element: "none",
      parts: { barrel: "stock", grip: "stock", mag: "stock", scope: "stock" },
      wacky: null,
      perks: [],
      level: 1,
      ammoType: def.ammoType,
      infiniteReserve: !!def.infiniteReserve,
      range: { full: def.range.full, max: def.range.max, min: def.range.min },
      stats
    };
  }
  var LOADOUT = Object.freeze(GUN_IDS.map((id) => Object.freeze(arenaGun(id))));
  var LOADOUT_HASH = fnv1a(stableStringify(LOADOUT));
  var RESERVE = Object.freeze({
    shells: TUNING.startAmmo.shells,
    sniper: TUNING.startAmmo.sniper
  });
  function contentBody() {
    return {
      protocol: PVP_PROTOCOL_VERSION,
      sim: PVP_SIM_VERSION,
      stage: STAGE_ID,
      radius: TUNING.arenaRadius,
      spawnRadius: SPAWN_RADIUS,
      hp: TUNING.maxHp,
      shield: TUNING.maxShield,
      guns: LOADOUT,
      reserve: RESERVE,
      matchTicks: MATCH_TICKS,
      readyMs: READY_MS,
      stallMs: STALL_MS,
      perks: [],
      stakes: false
    };
  }
  function contentFingerprint() {
    return fnv1a(stableStringify(contentBody()));
  }
  var CONTENT_FINGERPRINT = contentFingerprint();
  var ECONOMY = Object.freeze({
    mintsTickets: false,
    ticketsMintedByArtifact: 0,
    payoutAuthority: "server",
    stakes: false,
    wagerMayCreateTickets: false
  });

  // src/sim/pvp/sim.js
  var MAX_HP = TUNING.maxHp * 1e3;
  var MAX_SHIELD = TUNING.maxShield * 1e3;
  function q4(n) {
    return Math.round(n * 1e4) / 1e4;
  }
  function rngOf(seed) {
    return createRng(seed >>> 0 || 1);
  }
  function spawnsFor(seed) {
    const angle = (seed >>> 0) % 360 * Math.PI / 180;
    const x = q4(Math.cos(angle) * SPAWN_RADIUS);
    const z = q4(Math.sin(angle) * SPAWN_RADIUS);
    const a = { x, y: 0, z };
    const b = { x: q4(-x), y: 0, z: q4(-z) };
    return [a, b];
  }
  function makePlayer(seat, pos, yaw, seed) {
    return {
      seat,
      x: pos.x,
      y: 0,
      z: pos.z,
      vx: 0,
      vy: 0,
      vz: 0,
      yaw: q4(yaw),
      pitch: 0,
      hp: MAX_HP,
      shield: MAX_SHIELD,
      shieldDelay: 0,
      alive: true,
      onGround: true,
      invuln: 0,
      dashT: 0,
      dashCd: 0,
      dashX: 0,
      dashZ: 0,
      slot: 0,
      mag: LOADOUT.map((gun) => gun.stats.magSize),
      shells: RESERVE.shells,
      sniper: RESERVE.sniper,
      fireCd: 0,
      reloadT: 0,
      swapT: 0,
      rng: rngOf(seed)
    };
  }
  function createMatch(seed) {
    const n = seed >>> 0;
    const points = spawnsFor(n);
    const yaw0 = yawTo(points[0], points[1]);
    const yaw1 = yawTo(points[1], points[0]);
    return {
      seed: n,
      stage: STAGE_ID,
      tick: 0,
      phase: "live",
      outcome: null,
      winner: null,
      reason: null,
      players: [
        makePlayer(0, points[0], yaw0, n),
        makePlayer(1, points[1], yaw1, n)
      ]
    };
  }
  function normalizeWish(player, raw) {
    const wish = raw || {};
    const num = (value, fallback) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
    let slot = -1;
    if (Number.isInteger(wish.slot) && wish.slot >= 0 && wish.slot <= 2) slot = wish.slot;
    return {
      yaw: num(wish.yaw, player.yaw),
      pitch: Math.max(-1.5, Math.min(1.5, num(wish.pitch, player.pitch))),
      moveX: Math.max(-1, Math.min(1, num(wish.moveX, 0))),
      moveZ: Math.max(-1, Math.min(1, num(wish.moveZ, 0))),
      fire: !!wish.fire,
      zoom: !!wish.zoom,
      sprint: !!wish.sprint && !wish.zoom,
      jump: !!wish.jump,
      dash: !!wish.dash,
      reload: !!wish.reload,
      slot
    };
  }
  function integrate(p, wish, dt) {
    p.yaw = q4(wish.yaw);
    p.pitch = q4(Math.max(-1.5, Math.min(1.5, wish.pitch)));
    if (wish.slot >= 0 && wish.slot !== p.slot) {
      p.slot = wish.slot;
      p.reloadT = 0;
      p.swapT = LOADOUT[p.slot].stats.swapTime;
    }
    const sy = Math.sin(p.yaw);
    const cy = Math.cos(p.yaw);
    let wx = -sy * wish.moveZ + cy * wish.moveX;
    let wz = -cy * wish.moveZ - sy * wish.moveX;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) {
      wx /= wl;
      wz /= wl;
    }
    const maxSpeed = wish.sprint && wish.moveZ > 0 ? TUNING.sprintSpeed : TUNING.walkSpeed;
    p.dashCd = Math.max(0, p.dashCd - dt);
    p.invuln = Math.max(0, p.invuln - dt);
    if (wish.dash && p.dashCd <= 0) {
      const dl = Math.hypot(wx, wz);
      p.dashX = dl > 0.1 ? wx / dl : -sy;
      p.dashZ = dl > 0.1 ? wz / dl : -cy;
      p.dashT = TUNING.dashTime;
      p.dashCd = TUNING.dashCd;
      p.invuln = Math.max(p.invuln, TUNING.dashInvuln);
    }
    if (p.dashT > 0) {
      p.dashT -= dt;
      p.vx = p.dashX * TUNING.dashSpeed;
      p.vz = p.dashZ * TUNING.dashSpeed;
      p.vy = Math.max(p.vy, 0);
      if (p.dashT < 0) p.dashT = 0;
    } else if (p.onGround) {
      const tx = wx * maxSpeed;
      const tz = wz * maxSpeed;
      const dx = tx - p.vx;
      const dz = tz - p.vz;
      const dl = Math.hypot(dx, dz);
      const hs = Math.hypot(p.vx, p.vz);
      const acc = (wl > 0.01 ? TUNING.groundAccel : TUNING.friction * Math.max(hs, 2)) * dt;
      if (dl > 0) {
        const k = Math.min(1, acc / dl);
        p.vx += dx * k;
        p.vz += dz * k;
      }
    } else {
      const hs = Math.hypot(p.vx, p.vz);
      const cap = Math.max(hs, TUNING.walkSpeed);
      p.vx += wx * TUNING.airAccel * dt;
      p.vz += wz * TUNING.airAccel * dt;
      const nh = Math.hypot(p.vx, p.vz);
      if (nh > cap) {
        p.vx *= cap / nh;
        p.vz *= cap / nh;
      }
    }
    if (wish.jump && p.onGround) {
      p.vy = TUNING.jumpVel;
      p.onGround = false;
    }
    if (p.dashT <= 0) p.vy -= TUNING.gravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;
    if (p.y <= 0) {
      p.y = 0;
      if (p.vy < 0) p.vy = 0;
      p.onGround = true;
    } else p.onGround = false;
    const radius = Math.hypot(p.x, p.z);
    const maxR = TUNING.arenaRadius - TUNING.playerRadius;
    if (radius > maxR && radius > 0) {
      const nx = p.x / radius;
      const nz = p.z / radius;
      p.x = nx * maxR;
      p.z = nz * maxR;
      const vr = p.vx * nx + p.vz * nz;
      if (vr > 0) {
        p.vx -= nx * vr;
        p.vz -= nz * vr;
      }
    }
  }
  function separate(players) {
    const a = players[0];
    const b = players[1];
    let dx = b.x - a.x;
    let dz = b.z - a.z;
    let dist = Math.hypot(dx, dz);
    const min = TUNING.playerRadius * 2;
    if (dist >= min) return;
    if (dist < 1e-6) {
      dx = 1;
      dz = 0;
      dist = 1;
    }
    const push = (min - dist) / 2;
    const nx = dx / dist;
    const nz = dz / dist;
    a.x -= nx * push;
    a.z -= nz * push;
    b.x += nx * push;
    b.z += nz * push;
  }
  function snap(p) {
    p.x = q4(p.x);
    p.y = q4(p.y);
    p.z = q4(p.z);
    p.vx = q4(p.vx);
    p.vy = q4(p.vy);
    p.vz = q4(p.vz);
    p.yaw = q4(p.yaw);
    p.pitch = q4(p.pitch);
    p.fireCd = q4(Math.max(0, p.fireCd));
    p.reloadT = q4(Math.max(0, p.reloadT));
    p.swapT = q4(Math.max(0, p.swapT));
    p.dashT = q4(Math.max(0, p.dashT));
    p.dashCd = q4(Math.max(0, p.dashCd));
    p.invuln = q4(Math.max(0, p.invuln));
    p.shieldDelay = q4(Math.max(0, p.shieldDelay));
  }
  function reserveOf(p, gun) {
    if (gun.ammoType === "shells") return p.shells;
    if (gun.ammoType === "sniper") return p.sniper;
    return 0;
  }
  function takeReserve(p, gun, n) {
    if (gun.ammoType === "shells") p.shells -= n;
    else if (gun.ammoType === "sniper") p.sniper -= n;
  }
  function planShots(p, other, wish, dt) {
    const hits = [];
    p.fireCd = Math.max(0, p.fireCd - dt);
    p.swapT = Math.max(0, p.swapT - dt);
    if (p.reloadT > 0) {
      p.reloadT = Math.max(0, p.reloadT - dt);
      if (p.reloadT === 0) finishReload(p);
      return hits;
    }
    const gun = LOADOUT[p.slot];
    if (wish.reload && p.mag[p.slot] < gun.stats.magSize && canReload(p, gun)) {
      p.reloadT = gun.stats.reloadTime;
      return hits;
    }
    if (!wish.fire || p.swapT > 0 || p.fireCd > 0) return hits;
    if (p.mag[p.slot] <= 0) {
      if (canReload(p, gun)) p.reloadT = gun.stats.reloadTime;
      return hits;
    }
    p.mag[p.slot] -= 1;
    p.fireCd = 1 / gun.stats.fireRate;
    const pellets = gun.stats.pellets || 1;
    const spread = deg(wish.zoom ? gun.stats.adsSpread : gun.stats.spread);
    const eye = { x: p.x, y: p.y + TUNING.eyeHeight, z: p.z };
    for (let i = 0; i < pellets; i++) {
      const jy = (float(p.rng) - 0.5) * spread;
      const jp = (float(p.rng) - 0.5) * spread;
      const dir = dirFromYawPitch(p.yaw + jy, p.pitch + jp);
      const dist = rayCapsule(eye, dir, other.x, other.z, other.y, other.y + TUNING.playerHeight, TUNING.playerRadius);
      if (dist < 0) continue;
      const fall = rangeFalloff(gun.range, dist);
      if (fall <= 0) continue;
      let raw = gun.stats.damage * fall;
      if (chance(p.rng, gun.stats.critChance)) raw *= gun.stats.critMult;
      hits.push(Math.max(0, Math.round(raw * 1e3)));
    }
    if (p.mag[p.slot] <= 0 && canReload(p, gun)) p.reloadT = gun.stats.reloadTime;
    return hits;
  }
  function canReload(p, gun) {
    return gun.infiniteReserve || reserveOf(p, gun) > 0;
  }
  function finishReload(p) {
    const gun = LOADOUT[p.slot];
    const need = gun.stats.magSize - p.mag[p.slot];
    if (need <= 0) return;
    const got = gun.infiniteReserve ? need : Math.min(need, reserveOf(p, gun));
    if (!gun.infiniteReserve) takeReserve(p, gun, got);
    p.mag[p.slot] += got;
  }
  function applyHits(target, hits) {
    if (!target.alive || target.invuln > 0) return;
    for (let i = 0; i < hits.length; i++) {
      let left = hits[i];
      const absorb = Math.min(target.shield, left);
      target.shield -= absorb;
      left -= absorb;
      target.hp -= left;
      target.shieldDelay = TUNING.shieldDelay;
    }
  }
  function regen(p, dt) {
    if (!p.alive) return;
    p.shieldDelay = Math.max(0, p.shieldDelay - dt);
    if (p.shieldDelay <= 0 && p.shield < MAX_SHIELD) {
      p.shield = Math.min(MAX_SHIELD, p.shield + Math.round(TUNING.shieldRegen * dt * 1e3));
    }
  }
  function resolve(state) {
    const a = state.players[0];
    const b = state.players[1];
    if (a.hp <= 0) {
      a.hp = 0;
      a.alive = false;
      a.vx = a.vy = a.vz = 0;
    }
    if (b.hp <= 0) {
      b.hp = 0;
      b.alive = false;
      b.vx = b.vy = b.vz = 0;
    }
    if (!a.alive && !b.alive) return finish(state, "draw", null, "double_ko");
    if (!a.alive) return finish(state, "ko", 1, "ko");
    if (!b.alive) return finish(state, "ko", 0, "ko");
    if (state.tick >= MATCH_TICKS) {
      const sa = a.hp + a.shield;
      const sb = b.hp + b.shield;
      if (sa === sb) return finish(state, "draw", null, "time");
      return finish(state, "time", sa > sb ? 0 : 1, "time");
    }
    return state;
  }
  function finish(state, outcome, winner, reason) {
    state.phase = "done";
    state.outcome = outcome;
    state.winner = winner;
    state.reason = reason;
    return state;
  }
  function step(state, wishes) {
    if (state.phase === "done") return state;
    const wish = [
      normalizeWish(state.players[0], wishes && wishes[0]),
      normalizeWish(state.players[1], wishes && wishes[1])
    ];
    for (let i = 0; i < 2; i++) if (state.players[i].alive) integrate(state.players[i], wish[i], DT);
    separate(state.players);
    for (const p of state.players) snap(p);
    const hits = [
      state.players[0].alive ? planShots(state.players[0], state.players[1], wish[0], DT) : [],
      state.players[1].alive ? planShots(state.players[1], state.players[0], wish[1], DT) : []
    ];
    applyHits(state.players[1], hits[0]);
    applyHits(state.players[0], hits[1]);
    for (const p of state.players) {
      snap(p);
      regen(p, DT);
      snap(p);
    }
    state.tick += 1;
    return resolve(state);
  }
  function hashState(state) {
    return verifyStateHash(state);
  }
  function snapshotOf(state) {
    return {
      tick: state.tick,
      hash: hashState(state),
      phase: state.phase,
      outcome: state.outcome,
      winner: state.winner,
      reason: state.reason,
      players: state.players.map((p) => ({
        seat: p.seat,
        x: p.x,
        y: p.y,
        z: p.z,
        yaw: p.yaw,
        pitch: p.pitch,
        vx: p.vx,
        vz: p.vz,
        hp: p.hp,
        shield: p.shield,
        alive: p.alive,
        slot: p.slot
      }))
    };
  }
  function replay(body) {
    const state = createMatch(body.seed >>> 0);
    const inputs = Array.isArray(body.inputs) ? body.inputs : [];
    for (let i = 0; i < inputs.length; i++) step(state, inputs[i]);
    return state;
  }

  // src/net/inputCodec.js
  var FRAME_BYTES = INPUT_LIMITS.frameBytes;
  var BUTTONS = Object.freeze(["fire", "zoom", "sprint", "jump", "dash", "reload", "slide"]);
  var PvpInputError = class extends Error {
    constructor(reason) {
      super(reason);
      this.reason = reason;
    }
  };
  function fail(reason) {
    throw new PvpInputError(reason);
  }
  function unwrapPi(yaw) {
    if (typeof yaw !== "number" || !Number.isFinite(yaw)) fail("nan");
    if (Math.abs(yaw) > 1e6) fail("malformed");
    return Math.atan2(Math.sin(yaw), Math.cos(yaw));
  }
  function quantYaw(yaw) {
    const wrapped = unwrapPi(yaw);
    let q = Math.round(wrapped / Math.PI * 32767);
    if (q > 32767) q = 32767;
    if (q < -32767) q = -32767;
    return q;
  }
  function quantPitch(pitch) {
    if (typeof pitch !== "number" || !Number.isFinite(pitch)) fail("nan");
    if (pitch < -Math.PI / 2 - 1e-4 || pitch > Math.PI / 2 + 1e-4) fail("malformed");
    const clamped = Math.max(-1.5, Math.min(1.5, pitch));
    return Math.round(clamped / 1.5 * 32767);
  }
  function quantMove(v) {
    if (typeof v !== "number" || !Number.isFinite(v)) fail("nan");
    if (v < -1 - 1e-6 || v > 1 + 1e-6) fail("malformed");
    const c = Math.max(-1, Math.min(1, v));
    return Math.max(-127, Math.min(127, Math.round(c * 127)));
  }
  function buttonMask(wish) {
    let mask = 0;
    for (let i = 0; i < BUTTONS.length; i++) if (wish[BUTTONS[i]]) mask |= 1 << i;
    return mask;
  }
  function readSeq(seq) {
    if (typeof seq !== "number" || !Number.isFinite(seq)) fail("nan");
    if (!Number.isInteger(seq) || seq < 1 || seq > 4294967295) fail("sequence");
    return seq;
  }
  function readFrame(frame) {
    if (typeof frame !== "number" || !Number.isFinite(frame)) fail("nan");
    if (!Number.isInteger(frame) || frame < 0 || frame > INPUT_LIMITS.maxFrame) fail("frame");
    return frame;
  }
  function readSlot(slot) {
    if (slot == null) return -1;
    if (typeof slot !== "number" || !Number.isFinite(slot)) fail("nan");
    if (!Number.isInteger(slot) || slot < -1 || slot > 2) fail("malformed");
    return slot;
  }
  function encodeInput(wish) {
    if (!wish || typeof wish !== "object") fail("malformed");
    const seq = readSeq(wish.seq);
    const frame = readFrame(wish.frame);
    const yaw = quantYaw(wish.yaw ?? 0);
    const pitch = quantPitch(wish.pitch ?? 0);
    const moveX = quantMove(wish.moveX ?? 0);
    const moveZ = quantMove(wish.moveZ ?? 0);
    const slot = readSlot(wish.slot);
    const buttons = buttonMask(wish);
    const buf = new Uint8Array(FRAME_BYTES);
    const view = new DataView(buf.buffer);
    view.setUint32(0, seq, true);
    view.setInt32(4, frame, true);
    view.setInt16(8, yaw, true);
    view.setInt16(10, pitch, true);
    view.setInt8(12, moveX);
    view.setInt8(13, moveZ);
    view.setUint8(14, buttons);
    view.setInt8(15, slot);
    return buf;
  }
  function decodeInput(buf) {
    if (!(buf instanceof Uint8Array) || buf.length !== FRAME_BYTES) fail("malformed");
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const buttons = view.getUint8(14);
    if (buttons & 128) fail("malformed");
    const slot = view.getInt8(15);
    if (slot < -1 || slot > 2) fail("malformed");
    const yawQ = view.getInt16(8, true);
    const pitchQ = view.getInt16(10, true);
    if (yawQ < -32767 || yawQ > 32767 || pitchQ < -32767 || pitchQ > 32767) fail("malformed");
    const moveX = view.getInt8(12);
    const moveZ = view.getInt8(13);
    const out = {
      seq: view.getUint32(0, true),
      frame: view.getInt32(4, true),
      yaw: yawQ / 32767 * Math.PI,
      pitch: pitchQ / 32767 * 1.5,
      moveX: moveX / 127,
      moveZ: moveZ / 127,
      slot
    };
    if (out.seq < 1) fail("sequence");
    if (out.frame < 0) fail("frame");
    for (let i = 0; i < BUTTONS.length; i++) out[BUTTONS[i]] = (buttons & 1 << i) !== 0;
    return out;
  }

  // src/net/protocol.js
  var OP = Object.freeze({
    HELLO: 1,
    WELCOME: 2,
    REJECT: 3,
    READY: 4,
    PHASE: 5,
    INPUT: 6,
    SNAPSHOT: 7,
    RESULT: 8,
    RESYNC: 9
  });
  var PROTOCOL = PVP_PROTOCOL_VERSION;
  var SIM_VERSION = PVP_SIM_VERSION;
  var CONTENT = CONTENT_FINGERPRINT;
  var ID_RE = /^[A-Za-z0-9_.:@|-]{1,80}$/;
  var HOSTILE = /* @__PURE__ */ new Set([
    "winner",
    "result",
    "settle",
    "earn",
    "earnTickets",
    "stake",
    "wager",
    "tickets",
    "god",
    "godMode",
    "debug",
    "refund"
  ]);
  function validId(value) {
    return typeof value === "string" && value.length <= INPUT_LIMITS.maxIdLength && ID_RE.test(value);
  }
  function hostileReason(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) return "malformed";
    const keys = Object.keys(body);
    for (let i = 0; i < keys.length; i++) {
      if (HOSTILE.has(keys[i])) return "client_result";
    }
    return null;
  }
  function versionsMatch(body) {
    return !!body && body.protocol === PVP_PROTOCOL_VERSION && body.sim === PVP_SIM_VERSION && body.content === CONTENT_FINGERPRINT;
  }
  function bytesToAscii(data) {
    if (typeof data === "string") return data;
    if (!data || typeof data.length !== "number") return "";
    let out = "";
    for (let i = 0; i < data.length; i++) out += String.fromCharCode(data[i]);
    return out;
  }
  function parseJsonBody(data) {
    try {
      const value = JSON.parse(bytesToAscii(data) || "{}");
      if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, reason: "malformed" };
      return { ok: true, body: value };
    } catch {
      return { ok: false, reason: "malformed" };
    }
  }

  // src/sim/pvp/director.js
  function reject(accountId, reason, extra = {}) {
    return {
      ok: false,
      reason,
      messages: [{ op: OP.REJECT, body: { accountId, reason, ticketsMinted: 0, ...extra } }]
    };
  }
  function blankSeat(accountId, sessionId) {
    return {
      accountId,
      sessionId,
      ready: false,
      connected: true,
      lastInputAt: 0,
      lastSeq: 0,
      holdYaw: 0,
      holdPitch: 0,
      queue: /* @__PURE__ */ new Map(),
      acceptedAt: [],
      tickMark: -1,
      inputsThisTick: 0
    };
  }
  function createDirector({ seed = 1, matchId = "local" } = {}) {
    const director = {
      seed: seed >>> 0,
      matchId,
      phase: "lobby",
      seats: [null, null],
      sim: null,
      result: null,
      liveStart: 0,
      waitDeadline: null,
      readyDeadline: null,
      phaseMessage: null,
      forceSnap: false
    };
    function occupied() {
      return director.seats.filter(Boolean).length;
    }
    function seatIndex(accountId) {
      return director.seats.findIndex((seat) => seat && seat.accountId === accountId);
    }
    function otherAccount(index) {
      const other = director.seats[1 - index];
      return other ? other.accountId : null;
    }
    function welcome(index) {
      const seat = director.seats[index];
      return {
        accountId: seat.accountId,
        seat: index,
        matchId: director.matchId,
        protocol: PROTOCOL,
        sim: SIM_VERSION,
        content: CONTENT,
        seed: director.seed,
        loadoutHash: LOADOUT_HASH,
        phase: director.phase,
        tick: director.sim ? director.sim.tick : 0,
        opponent: otherAccount(index),
        ticketsMinted: 0,
        stakes: false
      };
    }
    function ok(index, extra = {}) {
      return { ok: true, seat: index, messages: [{ op: OP.WELCOME, body: welcome(index) }], ...extra };
    }
    function bothReady() {
      return director.seats.length === 2 && director.seats.every((seat) => seat && seat.ready);
    }
    function publish(phase, tick) {
      director.phaseMessage = {
        phase,
        tick,
        seed: director.seed,
        matchId: director.matchId,
        ticketsMinted: 0,
        stakes: false
      };
    }
    function startLive(now) {
      director.sim = createMatch(director.seed);
      director.phase = "live";
      director.liveStart = now;
      for (const seat of director.seats) {
        seat.lastInputAt = now;
        seat.holdYaw = director.sim.players[seat === director.seats[0] ? 0 : 1].yaw;
        seat.holdPitch = 0;
      }
      director.seats[0].holdYaw = director.sim.players[0].yaw;
      director.seats[1].holdYaw = director.sim.players[1].yaw;
      publish("live", 0);
      director.forceSnap = true;
    }
    function finish2(outcome, winner, reason) {
      director.phase = "done";
      director.result = {
        outcome,
        winner,
        reason,
        tick: director.sim ? director.sim.tick : 0,
        stateHash: director.sim ? hashState(director.sim) : null,
        ticketsMinted: 0,
        stakes: false
      };
      publish("done", director.result.tick);
      director.forceSnap = true;
      return director.result;
    }
    function adoptSim() {
      return finish2(director.sim.outcome, director.sim.winner, director.sim.reason);
    }
    function requireSeat(presenceUserId, sessionId) {
      if (!validId(presenceUserId) || !validId(sessionId)) return { error: reject(presenceUserId, "malformed") };
      const index = seatIndex(presenceUserId);
      if (index < 0) return { error: reject(presenceUserId, "wrong_sender") };
      const seat = director.seats[index];
      if (!seat.connected || seat.sessionId !== sessionId) return { error: reject(presenceUserId, "wrong_sender", { lastSeq: seat.lastSeq, tick: director.sim ? director.sim.tick : 0 }) };
      return { index, seat };
    }
    function hello({ presenceUserId, sessionId, body, now }) {
      if (!validId(presenceUserId) || !validId(sessionId)) return reject(presenceUserId, "malformed");
      if (!body || typeof body !== "object") return reject(presenceUserId, "malformed");
      const hostile = hostileReason(body);
      if (hostile) return reject(presenceUserId, hostile);
      if (body.accountId !== presenceUserId) return reject(presenceUserId, "wrong_sender");
      if (!versionsMatch(body)) return reject(presenceUserId, "version");
      if (director.phase === "done") return reject(presenceUserId, "ended");
      let index = seatIndex(presenceUserId);
      if (index < 0) {
        if (occupied() >= 2) return reject(presenceUserId, "match_full");
        index = director.seats[0] ? 1 : 0;
        director.seats[index] = blankSeat(presenceUserId, sessionId);
        if (occupied() === 1) director.waitDeadline = now + READY_MS;
        if (occupied() === 2) director.readyDeadline = now + READY_MS;
      } else {
        director.seats[index].sessionId = sessionId;
        director.seats[index].connected = true;
      }
      return ok(index);
    }
    function ready({ presenceUserId, sessionId, now }) {
      const got = requireSeat(presenceUserId, sessionId);
      if (got.error) return got.error;
      if (director.phase === "done") return reject(presenceUserId, "ended");
      got.seat.ready = true;
      if (director.phase === "lobby" && bothReady()) startLive(now);
      else publish(director.phase, director.sim ? director.sim.tick : 0);
      return ok(got.index);
    }
    function acceptPacket(seat, packet) {
      if (packet instanceof Uint8Array) return decodeInput(packet);
      return decodeInput(encodeInput(packet));
    }
    function input({ presenceUserId, sessionId, packet, now }) {
      const got = requireSeat(presenceUserId, sessionId);
      if (got.error) return got.error;
      if (director.phase !== "live" || !director.sim) return reject(presenceUserId, "not_live");
      let wish;
      try {
        wish = acceptPacket(got.seat, packet);
      } catch (err) {
        const reason = err instanceof PvpInputError ? err.reason : "malformed";
        return reject(presenceUserId, reason, { lastSeq: got.seat.lastSeq, tick: director.sim.tick });
      }
      const cursor = director.sim.tick;
      if (wish.seq !== got.seat.lastSeq + 1) {
        return reject(presenceUserId, "sequence", { lastSeq: got.seat.lastSeq, tick: cursor });
      }
      if (wish.frame < cursor - INPUT_LIMITS.pastFrames || wish.frame > cursor + INPUT_LIMITS.futureFrames || wish.frame < cursor) {
        return reject(presenceUserId, "frame", { lastSeq: got.seat.lastSeq, tick: cursor });
      }
      const times = got.seat.acceptedAt;
      while (times.length && now - times[0] > 1e3) times.shift();
      if (times.length >= INPUT_LIMITS.maxInputsPerSecond) {
        return reject(presenceUserId, "rate", { lastSeq: got.seat.lastSeq, tick: cursor });
      }
      if (got.seat.tickMark !== cursor) {
        got.seat.tickMark = cursor;
        got.seat.inputsThisTick = 0;
      }
      if (got.seat.inputsThisTick >= INPUT_LIMITS.maxInputsPerTick) {
        return reject(presenceUserId, "rate", { lastSeq: got.seat.lastSeq, tick: cursor });
      }
      got.seat.inputsThisTick += 1;
      times.push(now);
      got.seat.lastSeq = wish.seq;
      got.seat.lastInputAt = now;
      got.seat.holdYaw = wish.yaw;
      got.seat.holdPitch = wish.pitch;
      got.seat.queue.set(wish.frame, wish);
      return { ok: true, seat: got.index, messages: [] };
    }
    function wishFor(seat, tick) {
      if (seat.queue.has(tick)) {
        const wish = seat.queue.get(tick);
        seat.queue.delete(tick);
        return wish;
      }
      return {
        yaw: seat.holdYaw,
        pitch: seat.holdPitch,
        moveX: 0,
        moveZ: 0,
        fire: false,
        zoom: false,
        sprint: false,
        jump: false,
        dash: false,
        reload: false,
        slot: -1
      };
    }
    function snapBody() {
      const body = snapshotOf(director.sim);
      body.matchId = director.matchId;
      body.protocol = PROTOCOL;
      body.sim = SIM_VERSION;
      body.content = CONTENT;
      body.graceMs = STALL_MS;
      body.ticketsMinted = 0;
      body.stakes = false;
      return body;
    }
    function advance(now) {
      const snapshots = [];
      if (!Number.isFinite(now)) return { snapshots, result: director.result, phaseMessage: takePhase() };
      if (director.phase === "lobby") {
        const filled = occupied();
        if (filled < 2 && director.waitDeadline != null && now >= director.waitDeadline) finish2("cancel", null, "ready_timeout");
        else if (filled >= 2 && !bothReady() && director.readyDeadline != null && now >= director.readyDeadline) finish2("cancel", null, "ready_timeout");
        return { snapshots, result: director.result, phaseMessage: takePhase() };
      }
      if (director.phase === "live" && director.sim && director.sim.phase !== "done") {
        const target = Math.max(director.sim.tick, Math.floor((now - director.liveStart) / STEP_MS + 1e-9));
        const cap = director.sim.tick + 18e3;
        while (director.sim.phase === "live" && director.sim.tick < target && director.sim.tick < cap) {
          const tick = director.sim.tick;
          step(director.sim, [wishFor(director.seats[0], tick), wishFor(director.seats[1], tick)]);
          if (director.sim.tick % 3 === 0 || director.sim.phase === "done") snapshots.push(snapBody());
        }
        if (director.sim.phase === "done") adoptSim();
        else {
          const stalled = director.seats.map((seat) => now - seat.lastInputAt >= STALL_MS);
          if (stalled[0] && stalled[1]) finish2("draw", null, "both_stall");
          else if (stalled[0]) finish2("forfeit", 1, "stall");
          else if (stalled[1]) finish2("forfeit", 0, "stall");
        }
      }
      if (director.forceSnap && director.sim) {
        director.forceSnap = false;
        snapshots.push(snapBody());
      }
      return { snapshots, result: director.result, phaseMessage: takePhase() };
    }
    function takePhase() {
      const message = director.phaseMessage;
      director.phaseMessage = null;
      return message;
    }
    function disconnect(userId, sessionId) {
      const index = seatIndex(userId);
      if (index < 0) return;
      const seat = director.seats[index];
      if (seat.sessionId !== sessionId) return;
      seat.connected = false;
    }
    function clientResult(presenceUserId) {
      return reject(presenceUserId, "client_result", { tick: director.sim ? director.sim.tick : 0 });
    }
    function handle(sender, op, data, now) {
      const presenceUserId = sender && sender.userId;
      const sessionId = sender && sender.sessionId;
      if (op === OP.RESULT) return clientResult(presenceUserId);
      if (op === OP.HELLO || op === OP.READY || op === OP.RESYNC) {
        const parsed = data && typeof data === "object" && !(data instanceof Uint8Array) ? { ok: true, body: data } : parseJsonBody(data);
        if (!parsed.ok) return reject(presenceUserId, parsed.reason);
        if (op === OP.HELLO) return hello({ presenceUserId, sessionId, body: { ...parsed.body, accountId: parsed.body.accountId }, now });
        if (op === OP.READY) return ready({ presenceUserId, sessionId, now });
        const got = requireSeat(presenceUserId, sessionId);
        if (got.error) return got.error;
        director.forceSnap = true;
        return ok(got.index);
      }
      if (op === OP.INPUT) {
        const packet = data instanceof Uint8Array ? data : null;
        return input({ presenceUserId, sessionId, packet: packet || data, now });
      }
      return reject(presenceUserId, "malformed");
    }
    return {
      get phase() {
        return director.phase;
      },
      get result() {
        return director.result;
      },
      get sim() {
        return director.sim;
      },
      seatOf: seatIndex,
      occupied,
      joinAttempt(userId) {
        if (!validId(userId)) return { accept: false, reason: "malformed" };
        if (seatIndex(userId) >= 0) return { accept: true };
        if (director.phase === "done") return { accept: false, reason: "ended" };
        if (occupied() >= 2) return { accept: false, reason: "match_full" };
        return { accept: true };
      },
      hello,
      ready,
      input,
      advance,
      disconnect,
      handle,
      clientResult
    };
  }

  // src/sim/pvp/export.js
  var SOURCE_COMMIT = "5ccaf82a04c8e4233b257b71194ad82d8fd5f022";
  function receipt(state) {
    const pinned = /^0{40}$/.test(SOURCE_COMMIT) ? null : SOURCE_COMMIT;
    return {
      ok: true,
      outcome: state.outcome,
      winner: state.winner,
      reason: state.reason,
      tick: state.tick,
      stateHash: hashState(state),
      protocol: PVP_PROTOCOL_VERSION,
      sim: PVP_SIM_VERSION,
      content: CONTENT_FINGERPRINT,
      loadoutHash: LOADOUT_HASH,
      ticketsMinted: 0,
      sourceCommit: pinned,
      players: state.players.map((p) => ({
        hp: p.hp,
        shield: p.shield,
        x: p.x,
        z: p.z,
        alive: p.alive
      }))
    };
  }
  function replayJSON(text) {
    const raw = typeof text === "string" ? text : JSON.stringify(text);
    if (/[:\s]NaN\b|Infinity/.test(raw)) {
      return JSON.stringify({ ok: false, reason: "nan", ticketsMinted: 0, outcome: null, winner: null });
    }
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return JSON.stringify({ ok: false, reason: "malformed", ticketsMinted: 0, outcome: null, winner: null });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return JSON.stringify({ ok: false, reason: "malformed", ticketsMinted: 0, outcome: null, winner: null });
    }
    return JSON.stringify(receipt(replay(body)));
  }
  return __toCommonJS(export_exports);
})();
globalThis.SprotoShooterPvp = SprotoShooterPvp;
