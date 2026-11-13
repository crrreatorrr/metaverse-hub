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
    LEAD_IN_TICKS: () => LEAD_IN_TICKS,
    LOADOUT_HASH: () => LOADOUT_HASH,
    OP: () => OP,
    PVP_PROTOCOL_VERSION: () => PVP_PROTOCOL_VERSION,
    PVP_SIM_VERSION: () => PVP_SIM_VERSION,
    REPLAY_LIMITS: () => REPLAY_LIMITS,
    REWIND: () => REWIND,
    SOURCE_COMMIT: () => SOURCE_COMMIT,
    combatCommitOf: () => combatCommitOf,
    createDirector: () => createDirector,
    createHostedDirector: () => createHostedDirector,
    decodeInput: () => decodeInput,
    encodeInput: () => encodeInput,
    replayJSON: () => replayJSON,
    restoreDirector: () => restoreDirector,
    rewindCapFor: () => rewindCapFor,
    sha256Hex: () => sha256Hex
  });

  // src/data/gameplay.js
  var GAMEPLAY = Object.freeze({
    eyeHeight: 1.6,
    slideEye: 0.72,
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
    slideMinSpeed: 4.2,
    slideBoost: 16,
    slideCruise: 8,
    slideDrag: 2.4,
    slideTime: 0.7,
    slideCd: 0.22,
    slideHopCd: 0.85,
    slideHopBoost: 1.12,
    slideSlope: 14,
    slideStamina: 0.14,
    slideSteer: 10,
    slideStopFrac: 0.9,
    slideProbe: Object.freeze({
      radius: 0.15,
      ahead: 0.75,
      hereFeet: 0.5,
      hereReach: 0.8,
      thereFeet: 1.4,
      thereReach: 1.4,
      drop: 0.02,
      gain: 12
    }),
    dashEndScale: 0.45,
    staminaSprint: 4.5,
    staminaRegenDelay: 0.55,
    staminaRegen: 1.7,
    staminaRefill: 0.28,
    grappleRange: 16,
    grappleCd: 6,
    grapplePull: 54,
    grappleSpeed: 12.5,
    grappleReleaseSpeed: 8.5,
    grappleArrive: 1.35,
    grappleOrigin: 0.9,
    dashSpeed: 24,
    dashTime: 0.15,
    dashCd: 2,
    dashInvuln: 0.12,
    maxHp: 100,
    maxShield: 50,
    shieldDelay: 3,
    shieldRegen: 25,
    secondWindTime: 10,
    downedSpeedMult: 0.3,
    hitscanRange: 150,
    pitchLimit: 1.5,
    /** Campaign damageEnemy multiplies a crit by this, not by the gun's critMult. */
    critHitMult: 1.5,
    /** Splash is full damage at the impact and this fraction at the edge. */
    splashMinFalloff: 0.3
  });

  // src/data/tuning.js
  var TUNING = {
    arenaRadius: 45,
    spawnRadius: 43,
    spawnPointCount: 16,
    eyeHeight: GAMEPLAY.eyeHeight,
    slideEye: GAMEPLAY.slideEye,
    downedEye: GAMEPLAY.downedEye,
    playerRadius: GAMEPLAY.playerRadius,
    playerHeight: GAMEPLAY.playerHeight,
    walkSpeed: GAMEPLAY.walkSpeed,
    sprintSpeed: GAMEPLAY.sprintSpeed,
    groundAccel: GAMEPLAY.groundAccel,
    friction: GAMEPLAY.friction,
    airAccel: GAMEPLAY.airAccel,
    gravity: GAMEPLAY.gravity,
    jumpVel: GAMEPLAY.jumpVel,
    doubleJumpVel: GAMEPLAY.doubleJumpVel,
    coyote: GAMEPLAY.coyote,
    jumpBuffer: GAMEPLAY.jumpBuffer,
    slideMinSpeed: GAMEPLAY.slideMinSpeed,
    slideBoost: GAMEPLAY.slideBoost,
    slideCruise: GAMEPLAY.slideCruise,
    slideDrag: GAMEPLAY.slideDrag,
    slideTime: GAMEPLAY.slideTime,
    slideCd: GAMEPLAY.slideCd,
    slideHopCd: GAMEPLAY.slideHopCd,
    slideHopBoost: GAMEPLAY.slideHopBoost,
    slideSlope: GAMEPLAY.slideSlope,
    slideStamina: GAMEPLAY.slideStamina,
    staminaSprint: GAMEPLAY.staminaSprint,
    staminaRegenDelay: GAMEPLAY.staminaRegenDelay,
    staminaRegen: GAMEPLAY.staminaRegen,
    staminaRefill: GAMEPLAY.staminaRefill,
    grappleRange: GAMEPLAY.grappleRange,
    grappleCd: GAMEPLAY.grappleCd,
    grapplePull: GAMEPLAY.grapplePull,
    grappleSpeed: GAMEPLAY.grappleSpeed,
    grappleReleaseSpeed: GAMEPLAY.grappleReleaseSpeed,
    grappleArrive: GAMEPLAY.grappleArrive,
    dashSpeed: GAMEPLAY.dashSpeed,
    dashTime: GAMEPLAY.dashTime,
    dashCd: GAMEPLAY.dashCd,
    dashInvuln: GAMEPLAY.dashInvuln,
    fovBase: 90,
    fovSprint: 6,
    fovAds: 70,
    fovScope: 12,
    // god mode keeps you at or above these while it's on
    godTickets: 99999,
    maxHp: GAMEPLAY.maxHp,
    maxShield: GAMEPLAY.maxShield,
    maxMana: 100,
    shieldDelay: GAMEPLAY.shieldDelay,
    shieldRegen: GAMEPLAY.shieldRegen,
    quickShieldDelay: 1.8,
    quickShieldRegenMult: 1.5,
    manaRegen: 5,
    secondWindTime: GAMEPLAY.secondWindTime,
    reviveHpFrac: 0.3,
    reviveInvuln: 2,
    downedSpeedMult: GAMEPLAY.downedSpeedMult,
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
    hitscanRange: GAMEPLAY.hitscanRange
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

  // src/core/sha256.js
  var K = [
    1116352408,
    1899447441,
    3049323471,
    3921009573,
    961987163,
    1508970993,
    2453635748,
    2870763221,
    3624381080,
    310598401,
    607225278,
    1426881987,
    1925078388,
    2162078206,
    2614888103,
    3248222580,
    3835390401,
    4022224774,
    264347078,
    604807628,
    770255983,
    1249150122,
    1555081692,
    1996064986,
    2554220882,
    2821834349,
    2952996808,
    3210313671,
    3336571891,
    3584528711,
    113926993,
    338241895,
    666307205,
    773529912,
    1294757372,
    1396182291,
    1695183700,
    1986661051,
    2177026350,
    2456956037,
    2730485921,
    2820302411,
    3259730800,
    3345764771,
    3516065817,
    3600352804,
    4094571909,
    275423344,
    430227734,
    506948616,
    659060556,
    883997877,
    958139571,
    1322822218,
    1537002063,
    1747873779,
    1955562222,
    2024104815,
    2227730452,
    2361852424,
    2428436474,
    2756734187,
    3204031479,
    3329325298
  ];
  function utf8Bytes(text) {
    const out = [];
    for (let i = 0; i < text.length; i++) {
      let c = text.charCodeAt(i);
      if (c >= 55296 && c <= 56319 && i + 1 < text.length) {
        const d = text.charCodeAt(i + 1);
        if (d >= 56320 && d <= 57343) {
          c = 65536 + (c - 55296 << 10) + (d - 56320);
          i += 1;
        }
      }
      if (c < 128) out.push(c);
      else if (c < 2048) out.push(192 | c >> 6, 128 | c & 63);
      else if (c < 65536) out.push(224 | c >> 12, 128 | c >> 6 & 63, 128 | c & 63);
      else out.push(240 | c >> 18, 128 | c >> 12 & 63, 128 | c >> 6 & 63, 128 | c & 63);
    }
    return out;
  }
  function rotr(x, n) {
    return x >>> n | x << 32 - n;
  }
  function sha256Hex(text) {
    const bytes = utf8Bytes(String(text));
    const bitLength = bytes.length * 8;
    bytes.push(128);
    while (bytes.length % 64 !== 56) bytes.push(0);
    const high = Math.floor(bitLength / 4294967296);
    bytes.push(high >>> 24 & 255, high >>> 16 & 255, high >>> 8 & 255, high & 255);
    bytes.push(bitLength >>> 24 & 255, bitLength >>> 16 & 255, bitLength >>> 8 & 255, bitLength & 255);
    const h = [1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225];
    const w = new Array(64);
    for (let at = 0; at < bytes.length; at += 64) {
      for (let i = 0; i < 16; i++) {
        const j = at + i * 4;
        w[i] = bytes[j] << 24 | bytes[j + 1] << 16 | bytes[j + 2] << 8 | bytes[j + 3] | 0;
      }
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ w[i - 15] >>> 3;
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ w[i - 2] >>> 10;
        w[i] = w[i - 16] + s0 + w[i - 7] + s1 | 0;
      }
      let [a, b, c, d, e, f, g, k] = h;
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = e & f ^ ~e & g;
        const t1 = k + S1 + ch + K[i] + w[i] | 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = a & b ^ a & c ^ b & c;
        const t2 = S0 + maj | 0;
        k = g;
        g = f;
        f = e;
        e = d + t1 | 0;
        d = c;
        c = b;
        b = a;
        a = t1 + t2 | 0;
      }
      h[0] = h[0] + a | 0;
      h[1] = h[1] + b | 0;
      h[2] = h[2] + c | 0;
      h[3] = h[3] + d | 0;
      h[4] = h[4] + e | 0;
      h[5] = h[5] + f | 0;
      h[6] = h[6] + g | 0;
      h[7] = h[7] + k | 0;
    }
    let out = "";
    for (let i = 0; i < 8; i++) out += (h[i] >>> 0).toString(16).padStart(8, "0");
    return out;
  }

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

  // src/sim/campaign/terrain.js
  function hash2(ix, iz, seed) {
    let n = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed | 0, 1442695041) | 0;
    n = Math.imul(n ^ n >>> 16, 2146121005);
    n = Math.imul(n ^ n >>> 15, 2221713035);
    n = (n ^ n >>> 16) >>> 0;
    return n / 4294967296;
  }
  function fade(t) {
    return t * t * (3 - 2 * t);
  }
  function valueNoise(x, z, seed) {
    const x0 = Math.floor(x);
    const z0 = Math.floor(z);
    const tx = fade(x - x0);
    const tz = fade(z - z0);
    const v00 = hash2(x0, z0, seed);
    const v10 = hash2(x0 + 1, z0, seed);
    const v01 = hash2(x0, z0 + 1, seed);
    const v11 = hash2(x0 + 1, z0 + 1, seed);
    const a = v00 + (v10 - v00) * tx;
    const b = v01 + (v11 - v01) * tx;
    return (a + (b - a) * tz) * 2 - 1;
  }
  function fbm(x, z, seed, octaves) {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    const n = Math.max(1, octaves | 0);
    for (let i = 0; i < n; i++) {
      sum += valueNoise(x * freq, z * freq, seed + i * 101 | 0) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return norm > 0 ? sum / norm : 0;
  }
  function terrainLocal(t, x, z) {
    if (!t || !t.origin || !t.size) return null;
    const u = x - t.origin[0];
    const v = z - t.origin[2];
    if (u < 0 || v < 0 || u > t.size[0] || v > t.size[1]) return null;
    return { u, v, north: t.size[1] - v };
  }
  function inFlat(t, u, north) {
    const flats = t.flat || [];
    for (let i = 0; i < flats.length; i++) {
      const f = flats[i];
      if (f.x0 != null && (u < f.x0 || u > f.x1)) continue;
      if (f.n0 != null) {
        const lo = Math.min(f.n0, f.n1);
        const hi = Math.max(f.n0, f.n1);
        if (north < lo || north > hi) continue;
      }
      if (f.x0 == null && f.n0 == null) continue;
      return true;
    }
    return false;
  }
  function heightAt(t, x, z) {
    const local = terrainLocal(t, x, z);
    if (!local) return null;
    const base = t.origin[1] || 0;
    if (inFlat(t, local.u, local.north)) return base;
    const noise = t.noise || {};
    const amp = noise.amp || 0;
    if (!amp) return base;
    const freq = noise.freq == null ? 0.02 : noise.freq;
    const octaves = noise.octaves == null ? 1 : noise.octaves;
    return base + amp * fbm(x * freq, z * freq, t.seed || 1, octaves);
  }

  // src/sim/campaign/solids.js
  var STEP_UP = 0.4;
  function overlapsXZ(s, x, z, r) {
    return x + r > s.min[0] && x - r < s.max[0] && z + r > s.min[2] && z - r < s.max[2];
  }
  function surfaceY(s, x, z) {
    if (s.kind === "terrain") {
      const h = heightAt(s.terrain, x, z);
      return h == null ? -1e9 : h;
    }
    if (s.kind !== "ramp") return s.max[1];
    const spanZ = Math.max(1e-3, s.max[2] - s.min[2]);
    const spanX = Math.max(1e-3, s.max[0] - s.min[0]);
    let t;
    if (s.yaw === 90) t = (x - s.min[0]) / spanX;
    else if (s.yaw === 270) t = (s.max[0] - x) / spanX;
    else if (s.yaw === 180) t = (s.max[2] - z) / spanZ;
    else t = (z - s.min[2]) / spanZ;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    return s.min[1] + t * (s.max[1] - s.min[1]);
  }
  function groundHeight(solids, x, z, radius, feet, step2 = STEP_UP) {
    let g = -Infinity;
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      if (!overlapsXZ(s, x, z, radius)) continue;
      const top = surfaceY(s, x, z);
      if (top > feet + step2 + 0.02) continue;
      if (top > g) g = top;
    }
    return g;
  }
  function snapToGround(ent, solids, radius, step2 = STEP_UP) {
    const feet = ent.prevPos ? ent.prevPos.y : ent.pos.y;
    const g = groundHeight(solids, ent.pos.x, ent.pos.z, radius * 0.2, Math.max(feet, ent.pos.y), step2);
    if (g === -Infinity) {
      ent.onGround = false;
      return;
    }
    const crossed = feet + 0.05 >= g - step2 && ent.pos.y <= g + 0.02;
    if (crossed) {
      ent.pos.y = g;
      if (ent.vel && ent.vel.y < 0) ent.vel.y = 0;
      ent.onGround = true;
      return;
    }
    ent.onGround = Math.abs(ent.pos.y - g) < 0.02;
  }
  function firstSolid(solids, origin, dir, maxDist, allow2 = null, includeThin = false) {
    let best = null;
    let bestT = -1;
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      if (typeof allow2 === "function" && !allow2(s)) continue;
      const thin = s.kind !== "terrain" && s.max[1] - s.min[1] <= 0.6;
      if (!includeThin && thin && s.max[1] <= origin.y + 0.05) continue;
      const t = s.kind === "terrain" ? rayTerrain(origin, dir, s.terrain, maxDist, includeThin) : rayAabb(origin, dir, s.min, s.max, maxDist);
      if (t < 0) continue;
      if (bestT < 0 || t < bestT) {
        bestT = t;
        best = s;
      }
    }
    return best ? { t: bestT, solid: best } : null;
  }
  function rayTerrain(o, d, field, maxDist, includeThin) {
    const step2 = Math.max(0.5, (field && field.cell || 2) * 0.5);
    const startH = heightAt(field, o.x, o.z);
    let prevY = o.y;
    let prevH = startH;
    let prev = 0;
    for (let dist = step2; dist <= maxDist; dist += step2) {
      const x = o.x + d.x * dist;
      const y = o.y + d.y * dist;
      const z = o.z + d.z * dist;
      const h = heightAt(field, x, z);
      if (prevH != null && h != null && (prevY - prevH) * (y - h) <= 0) {
        const denom = prevY - prevH - (y - h);
        const f = Math.abs(denom) < 1e-8 ? 0 : (prevY - prevH) / denom;
        const hit = prev + (dist - prev) * Math.max(0, Math.min(1, f));
        if (hit > 0.2 && hit <= maxDist) return hit;
        if (includeThin && hit >= 0 && hit <= maxDist) return hit;
      }
      prevY = y;
      prevH = h;
      prev = dist;
    }
    return -1;
  }
  function rayAabb(o, d, min, max, maxDist) {
    let t0 = 0, t1 = maxDist;
    for (let axis = 0; axis < 3; axis++) {
      const p = axis === 0 ? o.x : axis === 1 ? o.y : o.z;
      const v = axis === 0 ? d.x : axis === 1 ? d.y : d.z;
      const lo = min[axis], hi = max[axis];
      if (Math.abs(v) < 1e-8) {
        if (p < lo || p > hi) return -1;
        continue;
      }
      let ta = (lo - p) / v, tb = (hi - p) / v;
      if (ta > tb) {
        const s = ta;
        ta = tb;
        tb = s;
      }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) return -1;
    }
    return t0 >= 0 && t0 <= maxDist ? t0 : -1;
  }

  // src/sim/pvp/arena.js
  var ARENA_WALL_H = 12;
  function box(id, x, z, hx, hy, hz) {
    return Object.freeze({
      id,
      kind: "box",
      min: Object.freeze([x - hx, 0, z - hz]),
      max: Object.freeze([x + hx, hy, z + hz])
    });
  }
  var ARENA_SOLIDS = Object.freeze([
    box("ne", 14, 14, 1.1, 10, 1.1),
    box("nw", -14, 14, 1.1, 10, 1.1),
    box("se", 14, -14, 1.1, 10, 1.1),
    box("sw", -14, -14, 1.1, 10, 1.1)
  ]);
  function rayArenaWall(origin, dir, maxDist) {
    const radius = TUNING.arenaRadius;
    const A = dir.x * dir.x + dir.z * dir.z;
    if (A < 1e-8) return null;
    const B2 = origin.x * dir.x + origin.z * dir.z;
    const C = origin.x * origin.x + origin.z * origin.z - radius * radius;
    const disc = B2 * B2 - A * C;
    if (disc < 0) return null;
    const t = (-B2 + Math.sqrt(disc)) / A;
    if (!(t >= 0.4) || t > maxDist) return null;
    const y = origin.y + dir.y * t;
    if (y < 0 || y > ARENA_WALL_H) return null;
    return {
      t,
      x: origin.x + dir.x * t,
      y,
      z: origin.z + dir.z * t,
      id: "wall"
    };
  }
  function arenaHook(origin, dir) {
    const maxDist = TUNING.grappleRange;
    let best = null;
    const solid = firstSolid(ARENA_SOLIDS, origin, dir, maxDist, null, true);
    if (solid) {
      best = {
        t: solid.t,
        x: origin.x + dir.x * solid.t,
        y: origin.y + dir.y * solid.t,
        z: origin.z + dir.z * solid.t,
        id: solid.solid.id
      };
    }
    const wall = rayArenaWall(origin, dir, maxDist);
    if (wall && (!best || wall.t < best.t)) best = wall;
    if (!best) return null;
    return { x: best.x, y: best.y, z: best.z, id: best.id };
  }
  function arenaOccludes(origin, dir, maxDist, ignoreId) {
    const hit = firstSolid(ARENA_SOLIDS, origin, dir, maxDist, (s) => s.id !== ignoreId, true);
    return !!hit;
  }

  // src/sim/grappleMotion.js
  function grappleSpeedScale(x, y, z, limit) {
    const speed = Math.hypot(x, y, z);
    return speed > limit ? limit / speed : 1;
  }
  function steerGrapple(vel, dx, dy, dz, dt) {
    const dist = Math.hypot(dx, dy, dz) || 1;
    if (dist < GAMEPLAY.grappleArrive) return "arrive";
    const pull = GAMEPLAY.grapplePull * dt;
    vel.x += dx / dist * pull;
    vel.y += dy / dist * pull;
    vel.z += dz / dist * pull;
    const k = grappleSpeedScale(vel.x, vel.y, vel.z, GAMEPLAY.grappleSpeed);
    vel.x *= k;
    vel.y *= k;
    vel.z *= k;
    return "pull";
  }
  function releaseGrappleSpeed(vel) {
    const k = grappleSpeedScale(vel.x, vel.y, vel.z, GAMEPLAY.grappleReleaseSpeed);
    vel.x *= k;
    vel.y *= k;
    vel.z *= k;
  }

  // src/sim/gameplay.js
  function stepLocomotion(body, wish, dt, world = {}) {
    const move = body.move;
    const vel = body.vel;
    move.slideCd = Math.max(0, move.slideCd - dt);
    move.dashCd = Math.max(0, move.dashCd - dt);
    const sy = Math.sin(body.yaw);
    const cy = Math.cos(body.yaw);
    let wx = -sy * wish.moveZ + cy * wish.moveX;
    let wz = -cy * wish.moveZ - sy * wish.moveX;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) {
      wx /= wl;
      wz /= wl;
    }
    const canAct = !body.downed;
    if (!wish.zoom) body.zoomCancelled = false;
    const sprintHeld = canAct && !!wish.sprint && wish.moveZ > 0;
    if (sprintHeld && wish.zoom) body.zoomCancelled = true;
    body.zooming = !!wish.zoom && !body.zoomCancelled;
    const wantSprint = sprintHeld && !body.staminaLock && body.stamina > 0;
    let sprinting = wantSprint;
    if (sprinting) {
      body.stamina = Math.max(0, body.stamina - dt / GAMEPLAY.staminaSprint);
      body.staminaDelay = GAMEPLAY.staminaRegenDelay;
      if (body.stamina <= 0) {
        body.staminaLock = true;
        sprinting = false;
      }
    } else {
      if (body.staminaDelay > 0) body.staminaDelay = Math.max(0, body.staminaDelay - dt);
      else if (body.stamina < 1) body.stamina = Math.min(1, body.stamina + dt / GAMEPLAY.staminaRegen);
      if (body.staminaLock && body.stamina >= GAMEPLAY.staminaRefill) body.staminaLock = false;
    }
    let maxSpeed = sprinting ? GAMEPLAY.sprintSpeed : GAMEPLAY.walkSpeed;
    const scales = body.speedScales;
    if (scales) for (let i = 0; i < scales.length; i++) maxSpeed *= scales[i];
    if (body.downed) maxSpeed *= GAMEPLAY.downedSpeedMult;
    if (wish.jump) body.jumpBufferT = GAMEPLAY.jumpBuffer;
    else body.jumpBufferT = Math.max(0, body.jumpBufferT - dt);
    if (body.onGround) {
      body.coyoteT = GAMEPLAY.coyote;
      body.jumpsLeft = 2;
    } else body.coyoteT = Math.max(0, body.coyoteT - dt);
    const emit = world.emit;
    if (canAct && wish.dash && move.dashCd <= 0) {
      const dl = Math.hypot(wx, wz);
      move.dashDir = dl > 0.1 ? { x: wx / dl, z: wz / dl } : { x: -sy, z: -cy };
      move.mode = "dash";
      move.dashT = GAMEPLAY.dashTime;
      move.dashCd = GAMEPLAY.dashCd;
      body.invulnT = Math.max(body.invulnT || 0, GAMEPLAY.dashInvuln);
      if (emit) emit("dash");
    }
    const hs = Math.hypot(vel.x, vel.z);
    const wantSlide = canAct && body.onGround && move.mode !== "slide" && move.slideCd <= 0 && (wish.slide || wish.crouch && sprinting) && (hs > GAMEPLAY.slideMinSpeed || sprinting);
    if (wantSlide) {
      const dirx = hs > 0.4 ? vel.x / hs : -sy;
      const dirz = hs > 0.4 ? vel.z / hs : -cy;
      const boost = Math.max(hs, GAMEPLAY.slideBoost);
      vel.x = dirx * boost;
      vel.z = dirz * boost;
      move.mode = "slide";
      move.slideT = GAMEPLAY.slideTime;
      body.stamina = Math.max(0, body.stamina - GAMEPLAY.slideStamina);
      body.staminaDelay = GAMEPLAY.staminaRegenDelay;
      if (body.stamina <= 0) body.staminaLock = true;
      if (emit) emit("slide");
    }
    const hooked = !!body.grapple;
    if (move.mode === "dash") {
      move.dashT -= dt;
      vel.x = move.dashDir.x * GAMEPLAY.dashSpeed;
      vel.z = move.dashDir.z * GAMEPLAY.dashSpeed;
      vel.y = Math.max(vel.y, 0);
      if (move.dashT <= 0) {
        move.mode = "walk";
        vel.x *= GAMEPLAY.dashEndScale;
        vel.z *= GAMEPLAY.dashEndScale;
      }
    } else if (move.mode === "slide" && !hooked) {
      move.slideT -= dt;
      if (wl > 0.2) {
        vel.x += wx * GAMEPLAY.slideSteer * dt;
        vel.z += wz * GAMEPLAY.slideSteer * dt;
      }
      let sp = Math.hypot(vel.x, vel.z) || 1e-4;
      const probe = GAMEPLAY.slideProbe;
      if (world.groundAt) {
        const pos = body.pos;
        const ux = vel.x / sp;
        const uz = vel.z / sp;
        const here = world.groundAt(pos.x, pos.z, probe.radius, pos.y + probe.hereFeet, probe.hereReach);
        const there = world.groundAt(
          pos.x + ux * probe.ahead,
          pos.z + uz * probe.ahead,
          probe.radius,
          pos.y + probe.thereFeet,
          probe.thereReach
        );
        if (here > -1e8 && there > -1e8 && here - there > probe.drop) {
          const gain = Math.min(GAMEPLAY.slideSlope * dt, (here - there) * probe.gain);
          vel.x += ux * gain;
          vel.z += uz * gain;
          sp = Math.hypot(vel.x, vel.z) || 1e-4;
        }
      }
      const next2 = sp + (GAMEPLAY.slideCruise - sp) * Math.min(1, GAMEPLAY.slideDrag * dt);
      const k = Math.max(0, next2) / sp;
      vel.x *= k;
      vel.z *= k;
      if (move.slideT <= 0 || next2 < GAMEPLAY.walkSpeed * GAMEPLAY.slideStopFrac || !body.onGround) {
        move.mode = body.onGround ? "walk" : "air";
        move.slideCd = GAMEPLAY.slideCd;
      }
    } else if (body.onGround && !hooked) {
      const tx = wx * maxSpeed;
      const tz = wz * maxSpeed;
      const dx = tx - vel.x;
      const dz = tz - vel.z;
      const dl = Math.hypot(dx, dz);
      const acc = (wl > 0.01 ? GAMEPLAY.groundAccel : GAMEPLAY.friction * Math.max(hs, 2)) * dt;
      if (dl > 0) {
        const k = Math.min(1, acc / dl);
        vel.x += dx * k;
        vel.z += dz * k;
      }
      move.mode = sprinting ? "sprint" : "walk";
    } else if (hooked) {
      move.mode = "air";
    } else {
      const cap = Math.max(hs, GAMEPLAY.walkSpeed);
      vel.x += wx * GAMEPLAY.airAccel * dt;
      vel.z += wz * GAMEPLAY.airAccel * dt;
      const nh = Math.hypot(vel.x, vel.z);
      if (nh > cap) {
        vel.x *= cap / nh;
        vel.z *= cap / nh;
      }
      move.mode = "air";
    }
    if (canAct && body.jumpBufferT > 0) {
      if (body.onGround || body.coyoteT > 0) {
        vel.y = GAMEPLAY.jumpVel;
        body.onGround = false;
        body.coyoteT = 0;
        body.jumpsLeft = 1;
        body.jumpBufferT = 0;
        if (move.mode === "slide") {
          const sp = Math.hypot(vel.x, vel.z);
          if (sp > 0.1) {
            const boosted = sp * GAMEPLAY.slideHopBoost;
            vel.x = vel.x / sp * boosted;
            vel.z = vel.z / sp * boosted;
          }
          move.mode = "air";
          move.slideCd = GAMEPLAY.slideHopCd;
        }
        if (emit) emit("jump");
      } else if (body.jumpsLeft > 0) {
        vel.y = GAMEPLAY.doubleJumpVel;
        body.jumpsLeft = 0;
        body.jumpBufferT = 0;
        if (emit) emit("doubleJump");
      }
    }
  }
  function applyGravity(body, dt) {
    if (body.move.mode !== "dash") body.vel.y -= GAMEPLAY.gravity * dt;
  }
  function beginDowned(body) {
    body.hp = 0;
    body.downed = true;
    body.downedT = GAMEPLAY.secondWindTime;
  }
  function resolvePellet(rng, hit) {
    const crit = !!(hit.canCrit && float(rng) < (hit.critChance ?? 0.05));
    let damage = hit.base * (crit ? GAMEPLAY.critHitMult : 1);
    const element = hit.element || "none";
    const elementProc = !hit.noProc && element !== "none" && float(rng) < (hit.elementChance ?? 0);
    const radius = hit.splashRadius || 0;
    if (radius > 0 && hit.splashDistance <= radius) {
      const f = 1 + (GAMEPLAY.splashMinFalloff - 1) * ((hit.splashDistance || 0) / radius);
      damage += (hit.splashDamage || 0) * f;
    }
    return { damage, crit, elementProc };
  }
  function tickDowned(body, dt) {
    if (!body.downed) return false;
    body.downedT -= dt;
    if (body.downedT <= 0) {
      body.downed = false;
      body.downedT = 0;
      return true;
    }
    return false;
  }

  // src/sim/pvp/rules.js
  var PVP_PROTOCOL_VERSION = 2;
  var PVP_SIM_VERSION = 2;
  var GAME_ID = "sproto-shooter";
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
    maxFramesPerSecond: 45,
    // At least futureFrames + 1, so a TCP burst that delivers the whole window in one tick passes.
    maxFramesPerCursor: 9,
    futureFrames: 8,
    holdTicks: 3,
    catchUpTicks: 4,
    maxPingsPerSecond: 10,
    /** Per seat: HELLO and RESYNC together, and READY, each at most this many per second. */
    maxHelloPerSecond: 2,
    maxReadyPerSecond: 2,
    frameBytes: 18,
    maxFrame: 1e6,
    maxIdLength: 80,
    maxNameLength: 32,
    maxLeadInTicks: 90
  });
  var REWIND = Object.freeze({
    maxTicks: 10,
    historyTicks: 12,
    maxBack: 255,
    fracSteps: 256,
    interpMs: 100,
    interpMinMs: 50,
    interpMaxMs: 150,
    extraTicks: 2,
    rttWindow: 8,
    /** An echo round trip longer than this is not a sample (a held-back echo inflates the cap). */
    maxRttMs: 1e3,
    pongMemory: 4,
    /** Between consecutive inputs of a seat, frame - viewTick may move by at most this much. */
    maxBackStep: 2
  });
  var REPLAY_LIMITS = Object.freeze({
    maxTicks: MATCH_TICKS,
    maxBytes: 512 * 1024
  });
  var LEAD_IN_TICKS = 9;
  var HASH_EVERY_TICKS = TICK_HZ;
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
      crits: true,
      rewind: REWIND,
      // sha256 commit, reveal in RESULT; the RNG takes 128 bits of sha256(seed).
      combatSeed: "commit-reveal-sha256-128",
      stakes: false,
      // Both seats share these. A hook lands on arenaSolids or the wall, never the floor.
      movement: {
        walk: TUNING.walkSpeed,
        sprint: TUNING.sprintSpeed,
        gravity: TUNING.gravity,
        jump: TUNING.jumpVel,
        doubleJump: GAMEPLAY.doubleJumpVel,
        coyote: GAMEPLAY.coyote,
        jumpBuffer: GAMEPLAY.jumpBuffer,
        air: TUNING.airAccel,
        ground: TUNING.groundAccel,
        friction: TUNING.friction,
        dashEnd: GAMEPLAY.dashEndScale,
        sprintCancelsZoom: true,
        downedTime: GAMEPLAY.secondWindTime,
        downedSpeed: GAMEPLAY.downedSpeedMult,
        slide: {
          min: TUNING.slideMinSpeed,
          boost: TUNING.slideBoost,
          cruise: TUNING.slideCruise,
          drag: TUNING.slideDrag,
          time: TUNING.slideTime,
          cd: TUNING.slideCd,
          hopCd: TUNING.slideHopCd,
          hop: TUNING.slideHopBoost,
          slope: GAMEPLAY.slideSlope,
          steer: GAMEPLAY.slideSteer,
          stamina: TUNING.slideStamina
        },
        stamina: {
          sprint: TUNING.staminaSprint,
          delay: TUNING.staminaRegenDelay,
          regen: TUNING.staminaRegen,
          refill: TUNING.staminaRefill
        },
        grapple: {
          range: TUNING.grappleRange,
          cd: TUNING.grappleCd,
          pull: TUNING.grapplePull,
          speed: TUNING.grappleSpeed,
          releaseSpeed: TUNING.grappleReleaseSpeed,
          arrive: TUNING.grappleArrive
        }
      },
      arenaSolids: ARENA_SOLIDS,
      arenaWall: ARENA_WALL_H
    };
  }
  function contentFingerprint() {
    return fnv1a(stableStringify(contentBody()));
  }
  var CONTENT_FINGERPRINT = contentFingerprint();
  function matchmakerQuery(fingerprint = CONTENT_FINGERPRINT) {
    return `+properties.game:${GAME_ID} +properties.mode:free +properties.protocol:${PVP_PROTOCOL_VERSION} +properties.content:${fingerprint}`;
  }
  var MATCHMAKER_QUERY = matchmakerQuery();
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
  function combatRngWords(combatSeed) {
    const digest = sha256Hex(`sproto-shooter:combat:${combatSeed}`);
    const words = [];
    for (let i = 0; i < 4; i++) words.push(parseInt(digest.slice(i * 8, i * 8 + 8), 16) >>> 0);
    return words;
  }
  function combatRng(combatSeed) {
    if (typeof combatSeed !== "string") return createRng(Number(combatSeed) >>> 0 || 1);
    const [a, b, c, d] = combatRngWords(combatSeed);
    const r = { a, b, c, d: d || 1 };
    for (let i = 0; i < 12; i++) next(r);
    return r;
  }
  function spawnsFor(seed) {
    const angle = (seed >>> 0) % 360 * Math.PI / 180;
    const x = q4(Math.cos(angle) * SPAWN_RADIUS);
    const z = q4(Math.sin(angle) * SPAWN_RADIUS);
    const a = { x, y: 0, z };
    const b = { x: q4(-x), y: 0, z: q4(-z) };
    return [a, b];
  }
  function makePlayer(seat, pos, yaw, rng) {
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
      stamina: 1,
      staminaDelay: 0,
      staminaLock: false,
      slideT: 0,
      slideCd: 0,
      coyoteT: 0,
      jumpBufferT: 0,
      jumpsLeft: 2,
      downed: false,
      downedT: 0,
      moveMode: "walk",
      zoomCancelled: false,
      grappleCd: 0,
      grapple: null,
      slot: 0,
      mag: LOADOUT.map((gun) => gun.stats.magSize),
      shells: RESERVE.shells,
      sniper: RESERVE.sniper,
      fireCd: 0,
      reloadT: 0,
      swapT: 0,
      rng: { ...rng }
    };
  }
  function histEntry(tick, p) {
    return { t: tick, x: p.x, y: p.y, z: p.z, alive: p.alive, invuln: p.invuln };
  }
  function record(state, tick) {
    const slot = tick % REWIND.historyTicks;
    for (let i = 0; i < 2; i++) state.hist[i][slot] = histEntry(tick, state.players[i]);
  }
  function createMatch(spawnSeed, combatSeed = spawnSeed) {
    const n = spawnSeed >>> 0;
    const rng = combatRng(combatSeed);
    const points = spawnsFor(n);
    const yaw0 = yawTo(points[0], points[1]);
    const yaw1 = yawTo(points[1], points[0]);
    const state = {
      spawnSeed: n,
      stage: STAGE_ID,
      tick: 0,
      phase: "live",
      outcome: null,
      winner: null,
      reason: null,
      players: [
        makePlayer(0, points[0], yaw0, rng),
        makePlayer(1, points[1], yaw1, rng)
      ],
      hist: [[], []]
    };
    for (let i = 0; i < REWIND.historyTicks; i++) {
      state.hist[0].push(null);
      state.hist[1].push(null);
    }
    record(state, 0);
    return state;
  }
  function viewOf(wish, tick) {
    let back = 0;
    if (Number.isInteger(wish.rewind)) back = wish.rewind;
    else if (Number.isInteger(wish.viewTick)) back = tick - wish.viewTick;
    let frac = Number.isInteger(wish.viewFrac) ? Math.max(0, Math.min(REWIND.fracSteps - 1, wish.viewFrac)) : 0;
    if (back < 0) {
      back = 0;
      frac = 0;
    }
    if (back > REWIND.maxTicks) {
      back = REWIND.maxTicks;
      frac = 0;
    }
    if (back > tick) {
      back = tick;
      frac = 0;
    }
    return { back, frac };
  }
  function normalizeWish(player, raw, tick = 0) {
    const wish = raw || {};
    const num = (value, fallback) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
    let slot = -1;
    if (Number.isInteger(wish.slot) && wish.slot >= 0 && wish.slot <= 2) slot = wish.slot;
    const view = viewOf(wish, tick);
    return {
      yaw: num(wish.yaw, player.yaw),
      pitch: Math.max(-GAMEPLAY.pitchLimit, Math.min(GAMEPLAY.pitchLimit, num(wish.pitch, player.pitch))),
      moveX: Math.max(-1, Math.min(1, num(wish.moveX, 0))),
      moveZ: Math.max(-1, Math.min(1, num(wish.moveZ, 0))),
      fire: !!wish.fire,
      zoom: !!wish.zoom,
      sprint: !!wish.sprint,
      jump: !!wish.jump,
      dash: !!wish.dash,
      reload: !!wish.reload,
      slide: !!wish.slide,
      crouch: !!wish.crouch,
      grapple: !!wish.grapple,
      slot,
      rewind: view.back,
      viewFrac: view.frac
    };
  }
  function histAt(state, seat, tick) {
    const entry = state.hist[seat][tick % REWIND.historyTicks];
    return entry && entry.t === tick ? entry : null;
  }
  function rewoundTarget(state, seat, frame, rewind, viewFrac) {
    const base = frame - rewind;
    const a = histAt(state, seat, base) || histAt(state, seat, frame + 1);
    const b = histAt(state, seat, base + 1) || a;
    const t = viewFrac / REWIND.fracSteps;
    return {
      x: q4(a.x + (b.x - a.x) * t),
      y: q4(a.y + (b.y - a.y) * t),
      z: q4(a.z + (b.z - a.z) * t),
      invuln: a.invuln,
      base,
      rewind,
      viewFrac
    };
  }
  function ensureMove(p) {
    if (p.stamina == null) {
      p.stamina = 1;
      p.staminaDelay = 0;
      p.staminaLock = false;
      p.slideT = 0;
      p.slideCd = 0;
      p.grappleCd = 0;
      p.grapple = null;
    }
    if (p.coyoteT == null) p.coyoteT = 0;
    if (p.jumpBufferT == null) p.jumpBufferT = 0;
    if (p.jumpsLeft == null) p.jumpsLeft = 2;
    if (p.downed == null) p.downed = false;
    if (p.downedT == null) p.downedT = 0;
    if (p.moveMode == null) p.moveMode = "walk";
    if (p.zoomCancelled == null) p.zoomCancelled = false;
  }
  function eyeOf(p) {
    const h = p.slideT > 0 ? TUNING.slideEye : TUNING.eyeHeight;
    return { x: p.x, y: p.y + h, z: p.z };
  }
  function pushOut(x, z, s, radius) {
    const cx = Math.max(s.min[0], Math.min(x, s.max[0]));
    const cz = Math.max(s.min[2], Math.min(z, s.max[2]));
    const dx = x - cx;
    const dz = z - cz;
    const dist = Math.hypot(dx, dz);
    if (dist >= radius) return null;
    if (dist < 1e-6) {
      const left = x - s.min[0];
      const right = s.max[0] - x;
      const back = z - s.min[2];
      const fwd = s.max[2] - z;
      const m = Math.min(left, right, back, fwd);
      const pad = radius + 1e-4;
      if (m === left) return { x: s.min[0] - pad, z };
      if (m === right) return { x: s.max[0] + pad, z };
      if (m === back) return { x, z: s.min[2] - pad };
      return { x, z: s.max[2] + pad };
    }
    const k = (radius - dist) / dist + 1e-4;
    return { x: x + dx * k, z: z + dz * k };
  }
  function pushArena(p) {
    const height = p.slideT > 0 ? 1 : TUNING.playerHeight;
    const feet = p.y;
    const head = feet + height;
    const step2 = 0.4;
    for (let n = 0; n < 4; n++) {
      for (let i = 0; i < ARENA_SOLIDS.length; i++) {
        const s = ARENA_SOLIDS[i];
        if (s.max[1] <= feet + step2 + 0.02) continue;
        if (head <= s.min[1] + 0.01 || feet + step2 >= s.max[1]) continue;
        const next2 = pushOut(p.x, p.z, s, TUNING.playerRadius);
        if (!next2) continue;
        p.x = next2.x;
        p.z = next2.z;
      }
    }
  }
  function releaseArenaGrapple(p) {
    if (!p.grapple) return;
    const vel = { x: p.vx, y: p.vy, z: p.vz };
    releaseGrappleSpeed(vel);
    p.vx = vel.x;
    p.vy = vel.y;
    p.vz = vel.z;
    p.grapple = null;
  }
  function tickArenaGrapple(p, wish, dt) {
    if (p.grappleCd > 0) p.grappleCd = Math.max(0, p.grappleCd - dt);
    if (!wish.grapple) {
      releaseArenaGrapple(p);
      return;
    }
    if (!p.grapple) {
      if (p.grappleCd > 0) return;
      const hook2 = arenaHook(eyeOf(p), dirFromYawPitch(p.yaw, p.pitch));
      p.grappleCd = GAMEPLAY.grappleCd;
      if (!hook2) {
        p.grappleMiss = true;
        return;
      }
      delete p.grappleMiss;
      p.grapple = hook2;
    }
    const hook = p.grapple;
    const eye = eyeOf(p);
    const ex = hook.x - eye.x;
    const ey = hook.y - eye.y;
    const ez = hook.z - eye.z;
    const ed = Math.hypot(ex, ey, ez) || 1;
    if (arenaOccludes(eye, { x: ex / ed, y: ey / ed, z: ez / ed }, ed - 0.35, hook.id)) {
      releaseArenaGrapple(p);
      return;
    }
    const oy = p.y + GAMEPLAY.grappleOrigin;
    const vel = { x: p.vx, y: p.vy, z: p.vz };
    const phase = steerGrapple(vel, hook.x - p.x, hook.y - oy, hook.z - p.z, dt);
    p.vx = vel.x;
    p.vy = vel.y;
    p.vz = vel.z;
    if (phase === "arrive") releaseArenaGrapple(p);
  }
  function movePlayer(p, wish, dt) {
    ensureMove(p);
    p.yaw = q4(wish.yaw);
    p.pitch = q4(Math.max(-GAMEPLAY.pitchLimit, Math.min(GAMEPLAY.pitchLimit, wish.pitch)));
    if (wish.slot >= 0 && wish.slot !== p.slot) {
      p.slot = wish.slot;
      p.reloadT = 0;
      p.swapT = LOADOUT[p.slot].stats.swapTime;
    }
    p.invuln = Math.max(0, p.invuln - dt);
    const body = {
      pos: { x: p.x, y: p.y, z: p.z },
      vel: { x: p.vx, y: p.vy, z: p.vz },
      yaw: p.yaw,
      pitch: p.pitch,
      onGround: p.onGround,
      downed: !!p.downed,
      zooming: !!wish.zoom,
      stamina: p.stamina,
      staminaDelay: p.staminaDelay,
      staminaLock: !!p.staminaLock,
      coyoteT: p.coyoteT,
      jumpBufferT: p.jumpBufferT,
      jumpsLeft: p.jumpsLeft,
      invulnT: p.invuln,
      grapple: p.grapple,
      zoomCancelled: !!p.zoomCancelled,
      move: {
        mode: p.moveMode,
        slideCd: p.slideCd,
        dashCd: p.dashCd,
        dashT: p.dashT,
        dashDir: { x: p.dashX, z: p.dashZ },
        slideT: p.moveMode === "slide" ? p.slideT : 0
      }
    };
    stepLocomotion(body, wish, dt, {
      groundAt: (x, z, radius2, feet, reach) => groundHeight(ARENA_SOLIDS, x, z, radius2, feet, reach)
    });
    applyGravity(body, dt);
    p.vx = body.vel.x;
    p.vy = body.vel.y;
    p.vz = body.vel.z;
    p.onGround = body.onGround;
    p.stamina = body.stamina;
    p.staminaDelay = body.staminaDelay;
    p.staminaLock = body.staminaLock;
    p.coyoteT = body.coyoteT;
    p.jumpBufferT = body.jumpBufferT;
    p.jumpsLeft = body.jumpsLeft;
    p.invuln = body.invulnT;
    p.dashT = body.move.dashT;
    p.dashCd = body.move.dashCd;
    p.dashX = body.move.dashDir.x;
    p.dashZ = body.move.dashDir.z;
    p.slideCd = body.move.slideCd;
    p.moveMode = body.move.mode;
    p.zooming = !!body.zooming;
    p.zoomCancelled = !!body.zoomCancelled;
    p.slideT = body.move.mode === "slide" ? Math.max(0, body.move.slideT) : 0;
    tickArenaGrapple(p, wish, dt);
    const prevY = p.y;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;
    pushArena(p);
    const groundBody = {
      pos: { x: p.x, y: p.y, z: p.z },
      prevPos: { y: prevY },
      vel: { y: p.vy },
      onGround: false
    };
    snapToGround(groundBody, ARENA_SOLIDS, TUNING.playerRadius, 0.4);
    if (groundBody.onGround) {
      p.y = groundBody.pos.y;
      p.vy = groundBody.vel.y;
      p.onGround = true;
    } else if (p.y <= 0) {
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
    if (typeof p.stamina === "number") p.stamina = q4(Math.max(0, p.stamina));
    if (typeof p.staminaDelay === "number") p.staminaDelay = q4(Math.max(0, p.staminaDelay));
    if (typeof p.slideT === "number") p.slideT = q4(Math.max(0, p.slideT));
    if (typeof p.slideCd === "number") p.slideCd = q4(Math.max(0, p.slideCd));
    if (typeof p.coyoteT === "number") p.coyoteT = q4(Math.max(0, p.coyoteT));
    if (typeof p.jumpBufferT === "number") p.jumpBufferT = q4(Math.max(0, p.jumpBufferT));
    if (typeof p.jumpsLeft === "number") p.jumpsLeft = Math.max(0, Math.round(p.jumpsLeft));
    if (typeof p.downedT === "number") p.downedT = q4(Math.max(0, p.downedT));
    if (typeof p.grappleCd === "number") p.grappleCd = q4(Math.max(0, p.grappleCd));
    if (p.grapple) {
      p.grapple.x = q4(p.grapple.x);
      p.grapple.y = q4(p.grapple.y);
      p.grapple.z = q4(p.grapple.z);
    }
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
  function weaponTick(p, wish, dt) {
    p.fireCd = Math.max(0, p.fireCd - dt);
    p.swapT = Math.max(0, p.swapT - dt);
    if (p.reloadT > 0) {
      p.reloadT = Math.max(0, p.reloadT - dt);
      if (p.reloadT === 0) finishReload(p);
      return false;
    }
    const gun = LOADOUT[p.slot];
    if (wish.reload && p.mag[p.slot] < gun.stats.magSize && canReload(p, gun)) {
      p.reloadT = gun.stats.reloadTime;
      return false;
    }
    if (!wish.fire || p.swapT > 0 || p.fireCd > 0) return false;
    if (p.mag[p.slot] <= 0) {
      if (canReload(p, gun)) p.reloadT = gun.stats.reloadTime;
      return false;
    }
    p.mag[p.slot] -= 1;
    p.fireCd = 1 / gun.stats.fireRate;
    if (p.mag[p.slot] <= 0 && canReload(p, gun)) p.reloadT = gun.stats.reloadTime;
    return true;
  }
  function traceShots(p, target, wish) {
    const hits = [];
    const gun = LOADOUT[p.slot];
    const pellets = gun.stats.pellets || 1;
    const zoom = p.zoomCancelled ? false : !!wish.zoom;
    const spread = deg(zoom ? gun.stats.adsSpread : gun.stats.spread);
    const eye = eyeOf(p);
    for (let i = 0; i < pellets; i++) {
      const jy = (float(p.rng) - 0.5) * spread;
      const jp = (float(p.rng) - 0.5) * spread;
      const dir = dirFromYawPitch(p.yaw + jy, p.pitch + jp);
      const dist = rayCapsule(eye, dir, target.x, target.z, target.y, target.y + TUNING.playerHeight, TUNING.playerRadius);
      if (dist < 0) continue;
      const cover = firstSolid(ARENA_SOLIDS, eye, dir, dist, null, true);
      if (cover && cover.t < dist) continue;
      const fall = rangeFalloff(gun.range, dist);
      if (fall <= 0) continue;
      const strike = resolvePellet(p.rng, {
        base: gun.stats.damage * fall,
        canCrit: true,
        critChance: gun.stats.critChance,
        element: gun.element,
        elementChance: gun.stats.elementChance,
        noProc: false,
        splashRadius: gun.stats.splashRadius,
        splashDamage: gun.stats.splashDamage,
        splashDistance: 0
      });
      hits.push(Math.max(0, Math.round(strike.damage * 1e3)));
    }
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
  function applyHits(target, hits, invuln) {
    if (!target.alive || invuln > 0 || hits.length === 0) return 0;
    let total = 0;
    for (let i = 0; i < hits.length; i++) {
      total += hits[i];
      let left = hits[i];
      const absorb = Math.min(target.shield, left);
      target.shield -= absorb;
      left -= absorb;
      if (!target.downed) target.hp -= left;
      target.shieldDelay = TUNING.shieldDelay;
      if (!target.downed && target.hp <= 0) beginDowned(target);
    }
    return total;
  }
  function regen(p, dt) {
    if (!p.alive || p.downed) return;
    p.shieldDelay = Math.max(0, p.shieldDelay - dt);
    if (p.shieldDelay <= 0 && p.shield < MAX_SHIELD) {
      p.shield = Math.min(MAX_SHIELD, p.shield + Math.round(TUNING.shieldRegen * dt * 1e3));
    }
  }
  function resolve(state) {
    const a = state.players[0];
    const b = state.players[1];
    if (a.hp <= 0 && !a.downed) {
      a.hp = 0;
      a.alive = false;
      a.vx = a.vy = a.vz = 0;
    }
    if (b.hp <= 0 && !b.downed) {
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
  function step(state, wishes, events = null) {
    if (state.phase === "done") return state;
    const frame = state.tick;
    const wish = [
      normalizeWish(state.players[0], wishes && wishes[0], frame),
      normalizeWish(state.players[1], wishes && wishes[1], frame)
    ];
    for (let i = 0; i < 2; i++) if (state.players[i].alive) movePlayer(state.players[i], wish[i], DT);
    separate(state.players);
    for (const p of state.players) pushArena(p);
    for (const p of state.players) snap(p);
    record(state, frame + 1);
    const seen = [
      rewoundTarget(state, 1, frame, wish[0].rewind, wish[0].viewFrac),
      rewoundTarget(state, 0, frame, wish[1].rewind, wish[1].viewFrac)
    ];
    const fired = [false, false];
    const hits = [[], []];
    for (let i = 0; i < 2; i++) {
      const p = state.players[i];
      if (!p.alive || !weaponTick(p, wish[i], DT)) continue;
      fired[i] = true;
      hits[i] = traceShots(p, seen[i], wish[i]);
    }
    const dealt = [
      applyHits(state.players[1], hits[0], seen[0].invuln),
      applyHits(state.players[0], hits[1], seen[1].invuln)
    ];
    if (events) {
      for (let i = 0; i < 2; i++) {
        if (!fired[i]) continue;
        events.push({
          tick: frame,
          shooter: i,
          dmg: dealt[i],
          pellets: LOADOUT[state.players[i].slot].stats.pellets || 1,
          hits: hits[i].length,
          rewind: wish[i].rewind,
          viewFrac: wish[i].viewFrac
        });
      }
    }
    for (const p of state.players) {
      snap(p);
      if (p.downed) {
        if (tickDowned(p, DT)) {
          p.alive = false;
          p.vx = p.vy = p.vz = 0;
        }
      } else regen(p, DT);
      snap(p);
    }
    state.tick += 1;
    resolve(state);
    record(state, state.tick);
    return state;
  }
  function hashState(state) {
    return verifyStateHash(state);
  }
  function withoutRng(state) {
    return { ...state, players: state.players.map(({ rng: _rng, ...rest }) => rest) };
  }
  function publicStateHash(state) {
    return verifyStateHash(withoutRng(state));
  }
  function stateSha256(state) {
    return sha256Hex(stableStringify(quantizeForHash(state)));
  }
  function replay(body) {
    const spawn = body.spawnSeed != null ? body.spawnSeed : body.seed;
    const combat = body.combatSeed != null ? body.combatSeed : spawn;
    const state = createMatch(spawn >>> 0, typeof combat === "string" ? combat : combat >>> 0);
    const inputs = Array.isArray(body.inputs) ? body.inputs : [];
    for (let i = 0; i < inputs.length; i++) step(state, inputs[i]);
    return state;
  }

  // src/net/inputCodec.js
  var FRAME_BYTES = INPUT_LIMITS.frameBytes;
  var BUTTONS = Object.freeze(["fire", "zoom", "sprint", "jump", "dash", "reload", "slide", "grapple"]);
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
  function readView(wish, frame) {
    let back = 0;
    if (wish.viewTick != null) {
      if (typeof wish.viewTick !== "number" || !Number.isFinite(wish.viewTick)) fail("nan");
      back = frame - Math.floor(wish.viewTick);
    }
    back = Math.max(0, Math.min(REWIND.maxBack, frame, back));
    let frac = 0;
    if (wish.viewFrac != null) {
      if (typeof wish.viewFrac !== "number" || !Number.isFinite(wish.viewFrac)) fail("nan");
      frac = Math.max(0, Math.min(REWIND.fracSteps - 1, Math.floor(wish.viewFrac)));
    }
    return { back, frac };
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
    const viewState = readView(wish, frame);
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
    view.setUint8(16, viewState.back);
    view.setUint8(17, viewState.frac);
    return buf;
  }
  function decodeInput(buf) {
    if (!(buf instanceof Uint8Array) || buf.length !== FRAME_BYTES) fail("malformed");
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const buttons = view.getUint8(14);
    const slot = view.getInt8(15);
    if (slot < -1 || slot > 2) fail("malformed");
    const yawQ = view.getInt16(8, true);
    const pitchQ = view.getInt16(10, true);
    if (yawQ < -32767 || yawQ > 32767 || pitchQ < -32767 || pitchQ > 32767) fail("malformed");
    const moveX = view.getInt8(12);
    const moveZ = view.getInt8(13);
    const frame = view.getInt32(4, true);
    const back = view.getUint8(16);
    const out = {
      seq: view.getUint32(0, true),
      frame,
      // The tick the shooter saw. A back past tick 0 is clamped, not rejected.
      viewTick: Math.max(0, frame - back),
      viewFrac: view.getUint8(17),
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
    RESYNC: 9,
    PING: 10,
    PONG: 11
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

  // src/sim/pvp/used.js
  var SOURCE = Object.freeze({ input: 0, hold: 1, neutral: 2 });
  var TICK_HEX = 40;
  var SEAT_HEX = TICK_HEX / 2;
  var CHUNK_TICKS = 30;
  var BUTTONS2 = Object.freeze(["fire", "zoom", "sprint", "jump", "dash", "reload", "slide", "grapple"]);
  var HELD_MASK = 135;
  var KEEP = -32768;
  function quant(value, scale) {
    const q = Math.round(value / scale * 32767);
    return Math.max(-32767, Math.min(32767, q));
  }
  function u8(value) {
    return Number.isInteger(value) ? Math.max(0, Math.min(255, value)) : 0;
  }
  function usedOf(wish, source = SOURCE.input, view = null) {
    let buttons = 0;
    for (let i = 0; i < BUTTONS2.length; i++) if (wish[BUTTONS2[i]]) buttons |= 1 << i;
    return {
      y: quant(wish.yaw, Math.PI),
      p: quant(wish.pitch, 1.5),
      mx: Math.max(-127, Math.min(127, Math.round(wish.moveX * 127))),
      mz: Math.max(-127, Math.min(127, Math.round(wish.moveZ * 127))),
      b: buttons,
      s: Number.isInteger(wish.slot) && wish.slot >= 0 && wish.slot <= 2 ? wish.slot : -1,
      src: source,
      r: view ? u8(view.rewind) : 0,
      f: view ? u8(view.frac) : 0
    };
  }
  function neutralUsed(y = null, p = null, source = SOURCE.neutral) {
    return { y, p, mx: 0, mz: 0, b: 0, s: -1, src: source, r: 0, f: 0 };
  }
  function wishOfUsed(u) {
    const out = {
      yaw: u.y == null ? void 0 : u.y / 32767 * Math.PI,
      pitch: u.p == null ? void 0 : u.p / 32767 * 1.5,
      moveX: u.mx / 127,
      moveZ: u.mz / 127,
      slot: u.s,
      rewind: u.r || 0,
      viewFrac: u.f || 0
    };
    for (let i = 0; i < BUTTONS2.length; i++) out[BUTTONS2[i]] = (u.b & 1 << i) !== 0;
    return out;
  }
  function hex(value, bytes) {
    const mod = bytes === 2 ? 65536 : 256;
    return ((value + mod) % mod).toString(16).padStart(bytes * 2, "0");
  }
  function signed(text, bytes) {
    const v = parseInt(text, 16);
    const half = bytes === 2 ? 32768 : 128;
    return v >= half ? v - half * 2 : v;
  }
  function encodeOne(u) {
    return hex(u.y == null ? KEEP : u.y, 2) + hex(u.p == null ? KEEP : u.p, 2) + hex(u.mx, 1) + hex(u.mz, 1) + hex(u.b & 255, 1) + hex(u.s + 1 & 3 | (u.src & 3) << 2, 1) + hex(u8(u.r), 1) + hex(u8(u.f), 1);
  }
  function encodeUsedTick(pair) {
    return encodeOne(pair[0]) + encodeOne(pair[1]);
  }
  var HEX_RE = /^[0-9a-f]*$/;
  function decodeOne(text, at) {
    const y = signed(text.slice(at, at + 4), 2);
    const p = signed(text.slice(at + 4, at + 8), 2);
    const mx = signed(text.slice(at + 8, at + 10), 1);
    const mz = signed(text.slice(at + 10, at + 12), 1);
    const b = parseInt(text.slice(at + 12, at + 14), 16);
    const meta = parseInt(text.slice(at + 14, at + 16), 16);
    const r = parseInt(text.slice(at + 16, at + 18), 16);
    const f = parseInt(text.slice(at + 18, at + 20), 16);
    if (meta > 15 || mx < -127 || mz < -127) return null;
    if (y !== KEEP && y < -32767 || p !== KEEP && p < -32767) return null;
    const src = meta >> 2 & 3;
    if (src > SOURCE.neutral) return null;
    return {
      y: y === KEEP ? null : y,
      p: p === KEEP ? null : p,
      mx,
      mz,
      b,
      s: (meta & 3) - 1,
      src,
      r,
      f
    };
  }
  function decodeUsedLog(chunks) {
    if (!Array.isArray(chunks)) return null;
    const ticks = [];
    for (const chunk of chunks) {
      if (typeof chunk !== "string" || chunk.length % TICK_HEX !== 0 || !HEX_RE.test(chunk)) return null;
      for (let at = 0; at < chunk.length; at += TICK_HEX) {
        const a = decodeOne(chunk, at);
        const b = decodeOne(chunk, at + SEAT_HEX);
        if (!a || !b) return null;
        ticks.push([a, b]);
      }
    }
    return ticks;
  }
  function usedTickAt(chunks, tick) {
    if (!Array.isArray(chunks) || !Number.isInteger(tick) || tick < 0) return null;
    const chunk = chunks[Math.floor(tick / CHUNK_TICKS)];
    const at = tick % CHUNK_TICKS * TICK_HEX;
    if (typeof chunk !== "string" || chunk.length < at + TICK_HEX) return null;
    const a = decodeOne(chunk, at);
    const b = decodeOne(chunk, at + SEAT_HEX);
    return a && b ? [a, b] : null;
  }
  function appendUsedTick(chunks, pair) {
    const text = encodeUsedTick(pair);
    const a = decodeOne(text, 0);
    const b = decodeOne(text, SEAT_HEX);
    if (!a || !b) throw new Error("used log: a record does not encode");
    const last = chunks.length ? chunks[chunks.length - 1] : null;
    if (last != null && last.length < CHUNK_TICKS * TICK_HEX) chunks[chunks.length - 1] = last + text;
    else chunks.push(text);
    return [a, b];
  }

  // src/sim/pvp/director.js
  var DIRECTOR_STATE_VERSION = 3;
  var COMBAT_SEED_RE = /^[0-9a-f]{32,128}$/;
  function combatCommitOf(combatSeed) {
    return sha256Hex(String(combatSeed));
  }
  function resolveCombatSeed(combatSeed, spawnSeed, matchId) {
    if (combatSeed == null) return { seed: sha256Hex(`derived:${spawnSeed}:${matchId}`).slice(0, 32), derived: true };
    if (typeof combatSeed !== "string" || !COMBAT_SEED_RE.test(combatSeed)) {
      throw new Error("combatSeed: 32..128 lowercase hex chars");
    }
    return { seed: combatSeed, derived: false };
  }
  var HEX_RE2 = /^[0-9a-f]+$/;
  function checkAccounts(accounts) {
    if (accounts == null) return null;
    if (!Array.isArray(accounts) || accounts.length !== 2 || !accounts.every(validId) || accounts[0] === accounts[1]) {
      throw new Error("accounts: two distinct valid account ids, seat 0 first");
    }
    return accounts.slice();
  }
  function checkBuild(build) {
    const out = { bundleSha256: null, sourceCommit: null };
    if (build == null) return out;
    if (typeof build !== "object") throw new Error("build: { bundleSha256, sourceCommit }");
    if (build.bundleSha256 != null) {
      if (typeof build.bundleSha256 !== "string" || build.bundleSha256.length !== 64 || !HEX_RE2.test(build.bundleSha256)) {
        throw new Error("build.bundleSha256: 64 lowercase hex chars");
      }
      out.bundleSha256 = build.bundleSha256;
    }
    if (build.sourceCommit != null) {
      if (typeof build.sourceCommit !== "string" || build.sourceCommit.length !== 40 || !HEX_RE2.test(build.sourceCommit)) {
        throw new Error("build.sourceCommit: 40 lowercase hex chars");
      }
      out.sourceCommit = build.sourceCommit;
    }
    return out;
  }
  function checkCeiling(rttCeilingMs) {
    if (rttCeilingMs == null) return null;
    if (typeof rttCeilingMs !== "number" || !Number.isFinite(rttCeilingMs) || rttCeilingMs <= 0) {
      throw new Error("rttCeilingMs: a positive number of ms");
    }
    return rttCeilingMs;
  }
  var PRIVATE_SKIP = /* @__PURE__ */ new Set([
    "rng",
    "seat",
    "x",
    "y",
    "z",
    "yaw",
    "pitch",
    "vx",
    "vz",
    "hp",
    "shield",
    "alive",
    "slot",
    "slideT",
    "grappleCd",
    "grappleMiss"
  ]);
  function presence(userId, sessionId) {
    return { userId: typeof userId === "string" ? userId : "", sessionId: typeof sessionId === "string" ? sessionId : "" };
  }
  function reject(to, reason, extra = {}) {
    return {
      ok: false,
      reason,
      messages: [{ op: OP.REJECT, body: { accountId: to.userId, reason, ticketsMinted: 0, ...extra }, to }]
    };
  }
  function cleanName(name, fallback) {
    if (typeof name !== "string" || !name) return fallback;
    return name.slice(0, INPUT_LIMITS.maxNameLength);
  }
  function clampLeadIn(value) {
    if (!Number.isInteger(value) || value < 0) return LEAD_IN_TICKS;
    return Math.min(INPUT_LIMITS.maxLeadInTicks, value);
  }
  function allow(seat, atKey, countKey, limit, now) {
    if (!(now - (seat[atKey] || 0) < 1e3)) {
      seat[atKey] = now;
      seat[countKey] = 0;
    }
    if ((seat[countKey] || 0) >= limit) return false;
    seat[countKey] = (seat[countKey] || 0) + 1;
    return true;
  }
  function asBytes(data) {
    if (typeof ArrayBuffer !== "undefined") {
      if (data instanceof ArrayBuffer) return new Uint8Array(data);
      if (ArrayBuffer.isView(data) && !(data instanceof Uint8Array)) {
        return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      }
    }
    return data;
  }
  function blankSeat(accountId, sessionId, name) {
    return {
      accountId,
      sessionId,
      name,
      ready: false,
      connected: true,
      lastInputAt: 0,
      lastSeq: 0,
      queue: {},
      hold: neutralUsed(null, null, SOURCE.hold),
      miss: 0,
      tokens: INPUT_LIMITS.maxFramesPerSecond,
      tokensAt: 0,
      cursorMark: null,
      framesThisCursor: 0,
      pingAt: 0,
      pings: 0,
      pongs: [],
      rtts: [],
      rttMs: null,
      interpMs: REWIND.interpMs,
      // The last input's view (after the continuity clamp), for the backtrack check.
      viewTick: null,
      viewBack: null,
      viewClamped: 0,
      helloAt: 0,
      hellos: 0,
      readyAt: 0,
      readys: 0,
      ackFrame: -1,
      ackSeq: 0,
      applied: 0,
      held: 0,
      neutral: 0,
      late: 0
    };
  }
  function round32(n) {
    return Math.round(n * 1e3) / 1e3;
  }
  function median(values) {
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length - 1) / 2)];
  }
  function clampInterp(interpMs) {
    if (typeof interpMs !== "number" || !Number.isFinite(interpMs)) return REWIND.interpMs;
    return Math.max(REWIND.interpMinMs, Math.min(REWIND.interpMaxMs, interpMs));
  }
  function rewindCapFor(rttMs, interpMs = REWIND.interpMs) {
    const rtt = Number.isFinite(rttMs) && rttMs > 0 ? rttMs : 0;
    const ms = rtt + clampInterp(interpMs) + REWIND.extraTicks * STEP_MS;
    const ticks = Math.ceil(ms / STEP_MS - 1e-9);
    return Math.max(0, Math.min(REWIND.maxTicks, ticks));
  }
  function clampView(wish, frame, cap) {
    const claim = Number.isInteger(wish.viewTick) ? frame - wish.viewTick : 0;
    let frac = Number.isInteger(wish.viewFrac) ? wish.viewFrac : 0;
    let rewind = claim;
    if (rewind < 0) {
      rewind = 0;
      frac = 0;
    }
    if (rewind > cap) {
      rewind = cap;
      frac = 0;
    }
    return { rewind, frac, claim, clamped: claim > cap };
  }
  function continuousView(seat, frame, viewTick) {
    if (seat.viewTick == null || seat.viewBack == null) return { viewTick, clamped: false };
    let back = frame - viewTick;
    const step2 = REWIND.maxBackStep;
    if (back > seat.viewBack + step2) back = seat.viewBack + step2;
    if (back < seat.viewBack - step2) back = seat.viewBack - step2;
    let v = frame - back;
    if (v < seat.viewTick) v = seat.viewTick;
    return { viewTick: v, clamped: v !== viewTick };
  }
  function createDirector({
    seed = 1,
    spawnSeed,
    combatSeed,
    matchId = "local",
    leadInTicks = LEAD_IN_TICKS,
    hosted = false,
    accounts,
    build,
    rttCeilingMs
  } = {}) {
    const spawn = (spawnSeed != null ? spawnSeed : seed) >>> 0;
    const combat = resolveCombatSeed(combatSeed, spawn, String(matchId));
    const built = checkBuild(build);
    let director = {
      v: DIRECTOR_STATE_VERSION,
      spawnSeed: spawn,
      combatSeed: combat.seed,
      combatCommit: combatCommitOf(combat.seed),
      combatSeedDerived: combat.derived,
      matchId: String(matchId),
      hosted: !!hosted,
      // Seat 0, seat 1 account ids the host matched, or null (first HELLO takes seat 0).
      accounts: checkAccounts(accounts),
      bundleSha256: built.bundleSha256,
      sourceCommit: built.sourceCommit,
      // The host's ceiling on the RTT the rewind cap uses (lobby baseline + margin for wagers).
      rttCeilingMs: checkCeiling(rttCeilingMs),
      leadInTicks: clampLeadIn(leadInTicks),
      phase: "lobby",
      seats: [null, null],
      sim: null,
      result: null,
      resultSent: false,
      liveStart: 0,
      waitDeadline: null,
      readyDeadline: null,
      log: [],
      hits: [],
      clamped: [0, 0]
    };
    function occupied() {
      return director.seats.filter(Boolean).length;
    }
    function seatIndex(accountId) {
      return director.seats.findIndex((seat) => seat && seat.accountId === accountId);
    }
    function seatTo(seat) {
      return presence(seat.accountId, seat.sessionId);
    }
    function cursor() {
      return director.sim ? director.sim.tick : 0;
    }
    function clockTick(now) {
      if (director.phase !== "live" && director.phase !== "done") return 0;
      if (!director.sim) return 0;
      return round32((now - director.liveStart) / STEP_MS);
    }
    function welcome(index) {
      const seat = director.seats[index];
      const other = director.seats[1 - index];
      return {
        accountId: seat.accountId,
        seat: index,
        matchId: director.matchId,
        protocol: PROTOCOL,
        sim: SIM_VERSION,
        content: CONTENT,
        spawnSeed: director.spawnSeed,
        combatCommit: director.combatCommit,
        loadoutHash: LOADOUT_HASH,
        phase: director.phase,
        tick: cursor(),
        ready: seat.ready,
        lastSeq: seat.lastSeq,
        leadInTicks: director.leadInTicks,
        opponent: other ? other.accountId : null,
        names: director.seats.map((s) => s ? s.name : null),
        ticketsMinted: 0,
        stakes: false
      };
    }
    function welcomeTo(index) {
      const seat = director.seats[index];
      return { op: OP.WELCOME, body: welcome(index), to: seatTo(seat) };
    }
    function welcomeAll() {
      const out = [];
      director.seats.forEach((seat, index) => {
        if (seat && seat.connected) out.push(welcomeTo(index));
      });
      return out;
    }
    function bothReady() {
      return director.seats.length === 2 && director.seats.every((seat) => seat && seat.ready && seat.connected);
    }
    function phaseBody(phase, now) {
      return {
        phase,
        tick: cursor(),
        clockTick: clockTick(now),
        startTick: 0,
        leadInTicks: director.leadInTicks,
        spawnSeed: director.spawnSeed,
        combatCommit: director.combatCommit,
        matchId: director.matchId,
        ticketsMinted: 0,
        stakes: false
      };
    }
    function bufferDepth(seat) {
      return Object.keys(seat.queue).length;
    }
    function privateOf(p) {
      const out = {};
      for (const key of Object.keys(p)) {
        if (PRIVATE_SKIP.has(key)) continue;
        const value = p[key];
        if (Array.isArray(value)) out[key] = value.slice();
        else if (value && typeof value === "object") out[key] = { ...value };
        else out[key] = value;
      }
      return out;
    }
    function rewindCap(seat) {
      const ceiling = director.rttCeilingMs;
      const rtt = ceiling != null && seat.rttMs != null ? Math.min(seat.rttMs, ceiling) : seat.rttMs;
      return rewindCapFor(rtt, seat.interpMs);
    }
    function snapshotFor(index, now, hits = []) {
      const sim = director.sim;
      const seat = director.seats[index];
      const body = {
        tick: sim.tick,
        clockTick: clockTick(now),
        phase: sim.phase === "done" ? "done" : director.phase,
        outcome: director.result ? director.result.outcome : sim.outcome,
        winner: director.result ? director.result.winner : sim.winner,
        reason: director.result ? director.result.reason : sim.reason,
        players: sim.players.map((p) => ({
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
          downed: !!p.downed,
          downedT: p.downedT || 0,
          slot: p.slot,
          slideT: p.slideT,
          grappleCd: p.grappleCd,
          grappleMiss: p.grappleMiss,
          grapple: p.grapple ? { x: p.grapple.x, y: p.grapple.y, z: p.grapple.z, id: p.grapple.id } : null
        })),
        you: {
          seat: index,
          ackFrame: seat.ackFrame,
          ackSeq: seat.ackSeq,
          lastSeq: seat.lastSeq,
          buffer: bufferDepth(seat),
          late: seat.late,
          held: seat.held,
          neutral: seat.neutral,
          rttMs: seat.rttMs,
          interpMs: seat.interpMs,
          rewindCap: rewindCap(seat),
          // The rest of this seat's exact sim state: players[seat] plus these fields.
          private: privateOf(sim.players[index])
        },
        // Server-confirmed hits stepped since the last snapshot: { tick, shooter, dmg, ... }.
        // Clients draw hitmarkers and damage from these, never from their own spread.
        hits: hits.map((hit) => ({ ...hit })),
        ticketsMinted: 0
      };
      if (sim.tick % HASH_EVERY_TICKS === 0 || director.phase === "done" || sim.phase === "done") {
        body.hash = publicStateHash(sim);
      }
      return { op: OP.SNAPSHOT, body, to: seatTo(seat) };
    }
    function snapshotsAll(now, hits = []) {
      const out = [];
      if (!director.sim) return out;
      director.seats.forEach((seat, index) => {
        if (seat && seat.connected) out.push(snapshotFor(index, now, hits));
      });
      return out;
    }
    function startLive(now) {
      director.sim = createMatch(director.spawnSeed, director.combatSeed);
      director.phase = "live";
      director.liveStart = now + director.leadInTicks * STEP_MS;
      for (const seat of director.seats) {
        seat.lastInputAt = director.liveStart;
        seat.queue = {};
        seat.hold = neutralUsed(null, null, SOURCE.hold);
        seat.miss = 0;
        seat.tokens = INPUT_LIMITS.maxFramesPerSecond;
        seat.tokensAt = now;
      }
      return [{ op: OP.PHASE, body: phaseBody("live", now), to: null }, ...snapshotsAll(now)];
    }
    function finish2(outcome, winner, reason, now) {
      director.phase = "done";
      director.result = {
        outcome,
        winner,
        reason,
        tick: cursor(),
        stateHash: director.sim ? hashState(director.sim) : null,
        stateSha256: director.sim ? stateSha256(director.sim) : null,
        spawnSeed: director.spawnSeed,
        // Revealed now so clients can check sha256(combatSeed) against the commit they got at start.
        combatSeed: director.combatSeed,
        combatCommit: director.combatCommit,
        ticketsMinted: 0,
        stakes: false
      };
      const out = [...snapshotsAll(now, director.hits), { op: OP.PHASE, body: phaseBody("done", now), to: null }];
      if (!director.resultSent) {
        director.resultSent = true;
        out.push({ op: OP.RESULT, body: { ...director.result }, to: null });
      }
      return out;
    }
    function requireSeat(from) {
      if (!validId(from.userId) || !validId(from.sessionId)) return { error: reject(from, "malformed") };
      const index = seatIndex(from.userId);
      if (index < 0) return { error: reject(from, "wrong_sender") };
      const seat = director.seats[index];
      if (!seat.connected || seat.sessionId !== from.sessionId) {
        return { error: reject(from, "wrong_sender", { lastSeq: seat.lastSeq, tick: cursor() }) };
      }
      return { index, seat };
    }
    function hello({ presenceUserId, sessionId, body, now, name }) {
      const from = presence(presenceUserId, sessionId);
      if (!validId(presenceUserId) || !validId(sessionId)) return reject(from, "malformed");
      if (!body || typeof body !== "object") return reject(from, "malformed");
      const hostile = hostileReason(body);
      if (hostile) return reject(from, hostile);
      if (body.accountId !== presenceUserId) return reject(from, "wrong_sender");
      if (!versionsMatch(body)) return reject(from, "version");
      let index = seatIndex(presenceUserId);
      if (index < 0 && director.accounts && director.accounts.indexOf(presenceUserId) < 0) {
        return reject(from, "not_invited");
      }
      if (index >= 0 && !allow(director.seats[index], "helloAt", "hellos", INPUT_LIMITS.maxHelloPerSecond, now)) {
        return reject(from, "rate");
      }
      if (director.phase === "done") {
        if (index < 0) return reject(from, "ended");
        const seat2 = director.seats[index];
        seat2.sessionId = sessionId;
        seat2.connected = true;
        const messages2 = [welcomeTo(index)];
        if (director.sim) messages2.push(snapshotFor(index, now));
        if (director.result) messages2.push({ op: OP.RESULT, body: { ...director.result }, to: seatTo(seat2) });
        return { ok: true, seat: index, messages: messages2 };
      }
      if (index < 0) {
        if (occupied() >= 2) return reject(from, "match_full");
        index = director.accounts ? director.accounts.indexOf(presenceUserId) : director.seats[0] ? 1 : 0;
        director.seats[index] = blankSeat(presenceUserId, sessionId, cleanName(name, presenceUserId));
        allow(director.seats[index], "helloAt", "hellos", INPUT_LIMITS.maxHelloPerSecond, now);
        takeInterp(director.seats[index], body);
        if (occupied() === 1) director.waitDeadline = now + READY_MS;
        if (occupied() === 2) director.readyDeadline = now + READY_MS;
        return { ok: true, seat: index, messages: welcomeAll() };
      }
      const seat = director.seats[index];
      seat.sessionId = sessionId;
      seat.connected = true;
      if (typeof name === "string" && name) seat.name = cleanName(name, seat.name);
      takeInterp(seat, body);
      seat.viewTick = null;
      seat.viewBack = null;
      const messages = [welcomeTo(index)];
      if (director.phase === "live" && director.sim) messages.push(snapshotFor(index, now));
      return { ok: true, seat: index, messages };
    }
    function ready({ presenceUserId, sessionId, now }) {
      const got = requireSeat(presence(presenceUserId, sessionId));
      if (got.error) return got.error;
      if (!allow(got.seat, "readyAt", "readys", INPUT_LIMITS.maxReadyPerSecond, now)) {
        return reject(presence(presenceUserId, sessionId), "rate");
      }
      if (director.phase === "done") return reject(presence(presenceUserId, sessionId), "ended");
      got.seat.ready = true;
      const messages = [welcomeTo(got.index)];
      if (director.phase === "lobby" && bothReady() && director.hosted && director.combatSeedDerived) {
        messages.push(...finish2("cancel", null, "no_combat_seed", now));
      } else if (director.phase === "lobby" && bothReady()) {
        messages.push(...startLive(now));
      }
      return { ok: true, seat: got.index, messages };
    }
    function refill(seat, now) {
      const dt = Math.max(0, now - seat.tokensAt);
      seat.tokens = Math.min(INPUT_LIMITS.maxFramesPerSecond, seat.tokens + dt * INPUT_LIMITS.maxFramesPerSecond / 1e3);
      seat.tokensAt = Math.max(seat.tokensAt, now);
    }
    function decodePacket(packet) {
      if (packet instanceof Uint8Array) return decodeInput(packet);
      return decodeInput(encodeInput(packet));
    }
    function input({ presenceUserId, sessionId, packet, now }) {
      const from = presence(presenceUserId, sessionId);
      const got = requireSeat(from);
      if (got.error) return got.error;
      const seat = got.seat;
      if (director.phase !== "live" || !director.sim) return reject(from, "not_live");
      let wish;
      try {
        wish = decodePacket(packet);
      } catch (err) {
        const reason = err instanceof PvpInputError ? err.reason : "malformed";
        return reject(from, reason, { lastSeq: seat.lastSeq, tick: cursor() });
      }
      const tick = cursor();
      const extra = { lastSeq: seat.lastSeq, tick, seq: wish.seq, frame: wish.frame };
      if (wish.seq <= seat.lastSeq) return reject(from, "sequence", extra);
      if (wish.frame > tick + INPUT_LIMITS.futureFrames) return reject(from, "frame", extra);
      refill(seat, now);
      if (seat.tokens < 1) return reject(from, "rate", extra);
      const late = wish.frame < tick;
      if (!late) {
        const mark = Math.floor((now - director.liveStart) / STEP_MS + 1e-9);
        if (seat.cursorMark !== mark) {
          seat.cursorMark = mark;
          seat.framesThisCursor = 0;
        }
        if (seat.framesThisCursor >= INPUT_LIMITS.maxFramesPerCursor) return reject(from, "rate", extra);
        seat.framesThisCursor += 1;
      }
      seat.tokens -= 1;
      seat.lastSeq = wish.seq;
      seat.lastInputAt = Math.max(now, seat.lastInputAt);
      const kept = continuousView(seat, wish.frame, wish.viewTick);
      if (kept.clamped) seat.viewClamped += 1;
      seat.viewTick = kept.viewTick;
      seat.viewBack = wish.frame - kept.viewTick;
      const view = clampView({ ...wish, viewTick: kept.viewTick }, wish.frame, rewindCap(seat));
      if (view.clamped) director.clamped[got.index] += 1;
      const used = usedOf(wish, SOURCE.input, view);
      if (late) {
        seat.late += 1;
        seat.hold.y = used.y;
        seat.hold.p = used.p;
        return { ok: true, seat: got.index, late: true, messages: [] };
      }
      seat.queue[String(wish.frame)] = { u: used, seq: wish.seq };
      return { ok: true, seat: got.index, messages: [] };
    }
    function ping({ presenceUserId, sessionId, body, now }) {
      const from = presence(presenceUserId, sessionId);
      const got = requireSeat(from);
      if (got.error) return got.error;
      const seat = got.seat;
      if (!body || typeof body.t !== "number" || !Number.isFinite(body.t)) return reject(from, "malformed");
      if (now - seat.pingAt >= 1e3) {
        seat.pingAt = now;
        seat.pings = 0;
      }
      if (seat.pings >= INPUT_LIMITS.maxPingsPerSecond) return reject(from, "rate");
      seat.pings += 1;
      takeInterp(seat, body);
      rttSample(seat, body, now);
      seat.pongs.push(now);
      if (seat.pongs.length > REWIND.pongMemory) seat.pongs.shift();
      return {
        ok: true,
        seat: got.index,
        messages: [{
          op: OP.PONG,
          body: { t: body.t, serverMs: now, tick: cursor(), clockTick: clockTick(now), phase: director.phase },
          to: from
        }]
      };
    }
    function takeInterp(seat, body) {
      if (body && typeof body.interpMs === "number" && Number.isFinite(body.interpMs)) {
        seat.interpMs = clampInterp(body.interpMs);
      }
    }
    function rttSample(seat, body, now) {
      if (typeof body.echo !== "number" || !Number.isFinite(body.echo)) return;
      const at = seat.pongs.indexOf(body.echo);
      if (at < 0) return;
      seat.pongs.splice(at, 1);
      const hold = typeof body.hold === "number" && Number.isFinite(body.hold) ? body.hold : 0;
      const span = now - body.echo;
      if (hold < 0 || hold > span) return;
      const sample = span - hold;
      if (!(sample >= 0) || sample > REWIND.maxRttMs) return;
      seat.rtts.push(round32(sample));
      if (seat.rtts.length > REWIND.rttWindow) seat.rtts.shift();
      seat.rttMs = median(seat.rtts);
    }
    function takeWish(seat, tick) {
      const key = String(tick);
      const entry = seat.queue[key];
      if (entry) {
        delete seat.queue[key];
        seat.miss = 0;
        seat.ackFrame = tick;
        seat.ackSeq = entry.seq;
        seat.applied += 1;
        const u = entry.u;
        seat.hold = {
          y: u.y,
          p: u.p,
          mx: u.mx,
          mz: u.mz,
          b: u.b & HELD_MASK,
          s: -1,
          src: SOURCE.hold,
          r: u.r,
          f: u.f
        };
        return u;
      }
      seat.miss += 1;
      if (seat.miss <= INPUT_LIMITS.holdTicks) {
        seat.held += 1;
        return { ...seat.hold, src: SOURCE.hold };
      }
      seat.neutral += 1;
      return neutralUsed(seat.hold.y, seat.hold.p, SOURCE.neutral);
    }
    function dropStale(seat, tick) {
      for (const key of Object.keys(seat.queue)) if (Number(key) < tick) delete seat.queue[key];
    }
    function advance(now) {
      const messages = [];
      if (!Number.isFinite(now)) return { messages, result: director.result };
      if (director.phase === "lobby") {
        const filled = occupied();
        if (filled < 2 && director.waitDeadline != null && now >= director.waitDeadline) {
          messages.push(...finish2("cancel", null, "ready_timeout", now));
        } else if (filled >= 2 && !bothReady() && director.readyDeadline != null && now >= director.readyDeadline) {
          messages.push(...finish2("cancel", null, "ready_timeout", now));
        }
        return { messages, result: director.result };
      }
      if (director.phase === "live" && director.sim && director.sim.phase !== "done") {
        const sim = director.sim;
        const target = Math.floor((now - director.liveStart) / STEP_MS + 1e-9);
        const cap = sim.tick + INPUT_LIMITS.catchUpTicks;
        let stepped = 0;
        const events = [];
        director.hits = [];
        while (sim.phase === "live" && sim.tick < target && sim.tick < cap) {
          const tick = sim.tick;
          const pair = [takeWish(director.seats[0], tick), takeWish(director.seats[1], tick)];
          const logged = appendUsedTick(director.log, pair);
          step(sim, [wishOfUsed(logged[0]), wishOfUsed(logged[1])], events);
          for (const seat of director.seats) dropStale(seat, sim.tick);
          stepped += 1;
        }
        if (events.length > 0) {
          director.hits = events.filter((hit) => hit.dmg > 0).map((hit) => ({
            tick: hit.tick,
            shooter: hit.shooter,
            dmg: hit.dmg,
            hits: hit.hits,
            rewind: hit.rewind
          }));
        }
        if (sim.phase === "done") {
          messages.push(...finish2(sim.outcome, sim.winner, sim.reason, now));
        } else {
          const stalled = director.seats.map((seat) => now - seat.lastInputAt >= STALL_MS);
          if (stalled[0] && stalled[1]) messages.push(...finish2("draw", null, "both_stall", now));
          else if (stalled[0]) messages.push(...finish2("forfeit", 1, "stall", now));
          else if (stalled[1]) messages.push(...finish2("forfeit", 0, "stall", now));
          else if (stepped > 0) messages.push(...snapshotsAll(now, director.hits));
        }
      }
      return { messages, result: director.result };
    }
    function disconnect(userId, sessionId) {
      const index = seatIndex(userId);
      if (index < 0) return;
      const seat = director.seats[index];
      if (seat.sessionId !== sessionId) return;
      seat.connected = false;
      if (director.phase === "lobby") seat.ready = false;
    }
    function clientResult(from) {
      return reject(from, "client_result", { tick: cursor() });
    }
    function handle(sender, op, raw, now) {
      const data = asBytes(raw);
      const presenceUserId = sender && sender.userId;
      const sessionId = sender && sender.sessionId;
      const from = presence(presenceUserId, sessionId);
      if (op === OP.RESULT) return clientResult(from);
      if (op === OP.HELLO || op === OP.READY || op === OP.RESYNC || op === OP.PING) {
        const parsed = data && typeof data === "object" && !(data instanceof Uint8Array) ? { ok: true, body: data } : parseJsonBody(data);
        if (!parsed.ok) return reject(from, parsed.reason);
        if (op === OP.HELLO) {
          return hello({ presenceUserId, sessionId, body: parsed.body, now, name: sender && sender.username });
        }
        if (op === OP.READY) return ready({ presenceUserId, sessionId, now });
        if (op === OP.PING) return ping({ presenceUserId, sessionId, body: parsed.body, now });
        const got = requireSeat(from);
        if (got.error) return got.error;
        if (!allow(got.seat, "helloAt", "hellos", INPUT_LIMITS.maxHelloPerSecond, now)) return reject(from, "rate");
        const messages = [welcomeTo(got.index)];
        if (director.sim) messages.push(snapshotFor(got.index, now));
        return { ok: true, seat: got.index, messages };
      }
      if (op === OP.INPUT) return input({ presenceUserId, sessionId, packet: data, now });
      return reject(from, "malformed");
    }
    function exportState() {
      return JSON.parse(JSON.stringify(director));
    }
    function importState(state) {
      const copy = typeof state === "string" ? JSON.parse(state) : JSON.parse(JSON.stringify(state));
      if (!copy || copy.v !== DIRECTOR_STATE_VERSION || !Array.isArray(copy.seats) || !Array.isArray(copy.log) || typeof copy.combatSeed !== "string") {
        throw new Error("director state: unsupported version");
      }
      director = copy;
    }
    function replayRecord() {
      const sim = director.sim;
      return {
        v: 2,
        spawnSeed: director.spawnSeed,
        combatSeed: director.combatSeed,
        combatCommit: director.combatCommit,
        matchId: director.matchId,
        // Seat 0, seat 1 account ids, and the build that ran the match when the host knows it.
        accounts: director.seats.map((s) => s ? s.accountId : null),
        bundleSha256: director.bundleSha256,
        sourceCommit: director.sourceCommit,
        protocol: PROTOCOL,
        sim: SIM_VERSION,
        content: CONTENT,
        used: director.log.slice(),
        expect: sim ? {
          tick: sim.tick,
          stateHash: hashState(sim),
          stateSha256: stateSha256(sim),
          outcome: sim.outcome,
          winner: sim.winner,
          reason: sim.reason
        } : null,
        result: director.result ? { ...director.result } : null,
        ticketsMinted: 0
      };
    }
    function seatStats(index) {
      const seat = director.seats[index];
      if (!seat) return null;
      return {
        accountId: seat.accountId,
        connected: seat.connected,
        lastSeq: seat.lastSeq,
        ackFrame: seat.ackFrame,
        buffer: bufferDepth(seat),
        applied: seat.applied,
        held: seat.held,
        neutral: seat.neutral,
        late: seat.late,
        rttMs: seat.rttMs,
        interpMs: seat.interpMs,
        rewindCap: rewindCap(seat),
        clamped: director.clamped[index],
        viewClamped: seat.viewClamped || 0
      };
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
      get liveStart() {
        return director.liveStart;
      },
      get leadInTicks() {
        return director.leadInTicks;
      },
      get spawnSeed() {
        return director.spawnSeed;
      },
      get combatCommit() {
        return director.combatCommit;
      },
      /** True when no combatSeed was passed: the seed is predictable. A hosted match must be false. */
      get combatSeedDerived() {
        return director.combatSeedDerived;
      },
      /** The used-input pair applied on `tick` (decoded), or null. */
      usedAt(tick) {
        return usedTickAt(director.log, tick);
      },
      seatOf: seatIndex,
      occupied,
      joinAttempt(userId) {
        if (!validId(userId)) return { accept: false, reason: "malformed" };
        if (seatIndex(userId) >= 0) return { accept: true };
        if (director.accounts && director.accounts.indexOf(userId) < 0) return { accept: false, reason: "not_invited" };
        if (director.phase === "done") return { accept: false, reason: "ended" };
        if (occupied() >= 2) return { accept: false, reason: "match_full" };
        return { accept: true };
      },
      hello,
      ready,
      input,
      ping,
      advance,
      disconnect,
      handle,
      clientResult(userId, sessionId) {
        return clientResult(presence(userId, sessionId));
      },
      exportState,
      importState,
      replayRecord,
      seatStats
    };
  }
  function createHostedDirector(options = {}) {
    const { matchId, combatSeed } = options;
    const spawnSeed = options.spawnSeed != null ? options.spawnSeed : options.seed;
    if (!Number.isInteger(spawnSeed) || spawnSeed < 0 || spawnSeed > 4294967295) {
      throw new Error("hosted director: spawnSeed must be a 32-bit unsigned integer chosen by the host");
    }
    if (typeof combatSeed !== "string" || !COMBAT_SEED_RE.test(combatSeed)) {
      throw new Error("hosted director: combatSeed must be a fresh secret of 32..128 lowercase hex chars");
    }
    if (typeof matchId !== "string" || !matchId || matchId.length > 128) {
      throw new Error("hosted director: matchId must be the Nakama match id");
    }
    return createDirector({ ...options, spawnSeed, hosted: true });
  }
  function restoreDirector(state) {
    const director = createDirector();
    director.importState(state);
    return director;
  }

  // src/sim/pvp/export.js
  var SOURCE_COMMIT = "dce559c523d6e9ce007126317b12042608864c3e";
  function receipt(state) {
    const pinned = /^0{40}$/.test(SOURCE_COMMIT) ? null : SOURCE_COMMIT;
    return {
      ok: true,
      outcome: state.outcome,
      winner: state.winner,
      reason: state.reason,
      tick: state.tick,
      stateHash: hashState(state),
      stateSha256: stateSha256(state),
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
  function refused(reason) {
    return JSON.stringify({ ok: false, reason, ticketsMinted: 0, outcome: null, winner: null, verified: false });
  }
  var EXPECT_KEYS = ["tick", "stateHash", "outcome", "winner", "reason"];
  var SEED_RE = /^[0-9a-f]{32,128}$/;
  var DIRECTOR_OUTCOMES = Object.freeze({
    "forfeit:stall": "settle_director",
    "draw:both_stall": "refund",
    "cancel:ready_timeout": "refund",
    "cancel:no_combat_seed": "refund"
  });
  var STALL_TICKS = Math.ceil(STALL_MS / STEP_MS) - INPUT_LIMITS.futureFrames - INPUT_LIMITS.catchUpTicks;
  function trailingNonInput(ticks, seat) {
    let n = 0;
    for (let i = ticks.length - 1; i >= 0 && ticks[i][seat].src !== SOURCE.input; i--) n += 1;
    return n;
  }
  function judge(body, ticks, state, out, replayOk) {
    const result = body.result && typeof body.result === "object" ? body.result : null;
    const accounts = Array.isArray(body.accounts) ? body.accounts.slice(0, 2) : null;
    const verdict = {
      replay: replayOk,
      result: null,
      outcome: result ? result.outcome : null,
      winner: result ? result.winner : null,
      reason: result ? result.reason : null,
      provable: false,
      accounts,
      bundleSha256: typeof body.bundleSha256 === "string" ? body.bundleSha256 : null,
      evidence: null,
      policy: "refuse"
    };
    const checks = [];
    if (!result) return { checks, verdict };
    const noSim = result.outcome === "cancel" && ticks.length === 0;
    const want = {
      tick: out.tick,
      stateHash: out.stateHash,
      stateSha256: out.stateSha256,
      spawnSeed: body.spawnSeed,
      combatSeed: body.combatSeed,
      combatCommit: out.combatCommit
    };
    if (noSim) {
      want.tick = 0;
      want.stateHash = null;
      want.stateSha256 = null;
    }
    for (const key of Object.keys(want)) {
      if (key === "stateSha256" && result[key] === void 0) continue;
      if (result[key] !== want[key]) checks.push(`result.${key}`);
    }
    if (state.outcome != null) {
      for (const key of ["outcome", "winner", "reason"]) if (result[key] !== state[key]) checks.push(`result.${key}`);
      verdict.provable = true;
      if (checks.length === 0) verdict.policy = "settle";
    } else {
      const policy = DIRECTOR_OUTCOMES[`${result.outcome}:${result.reason}`];
      const winnerOk = result.outcome === "forfeit" ? result.winner === 0 || result.winner === 1 : result.winner === null;
      const knownOutcome = Object.keys(DIRECTOR_OUTCOMES).some((key) => key.startsWith(`${result.outcome}:`));
      if (!policy) checks.push(knownOutcome ? "result.reason" : "result.outcome");
      else if (!winnerOk) checks.push("result.winner");
      if (!noSim) {
        const trailing = [trailingNonInput(ticks, 0), trailingNonInput(ticks, 1)];
        let consistent = true;
        if (result.outcome === "forfeit") consistent = trailing[1 - result.winner] >= STALL_TICKS;
        else if (result.reason === "both_stall") consistent = trailing[0] >= STALL_TICKS && trailing[1] >= STALL_TICKS;
        verdict.evidence = { trailingNonInput: trailing, stallTicks: STALL_TICKS, consistent };
        if (checks.length === 0) verdict.policy = policy === "settle_director" && !consistent ? "review" : policy;
      } else if (checks.length === 0) {
        verdict.policy = policy;
      }
    }
    verdict.result = checks.length === 0;
    if (!replayOk) verdict.policy = "refuse";
    return { checks, verdict };
  }
  function replayUsed(body) {
    if (body.sim !== void 0 && body.sim !== PVP_SIM_VERSION) return refused("version");
    if (!Array.isArray(body.used)) return refused("malformed");
    let hex2 = 0;
    for (const chunk of body.used) hex2 += typeof chunk === "string" ? chunk.length : 0;
    if (body.used.length > REPLAY_LIMITS.maxTicks || hex2 > REPLAY_LIMITS.maxTicks * TICK_HEX) return refused("too_long");
    const ticks = decodeUsedLog(body.used);
    if (!ticks) return refused("malformed");
    const spawn = body.spawnSeed;
    if (!Number.isInteger(spawn) || spawn < 0 || spawn > 4294967295) return refused("malformed");
    if (typeof body.combatSeed !== "string" || !SEED_RE.test(body.combatSeed)) return refused("malformed");
    if (body.sourceCommit != null && !/^0{40}$/.test(SOURCE_COMMIT) && body.sourceCommit !== SOURCE_COMMIT) {
      return refused("build");
    }
    const state = createMatch(spawn >>> 0, body.combatSeed);
    let extra = 0;
    for (let i = 0; i < ticks.length; i++) {
      if (state.phase === "done") {
        extra += 1;
        continue;
      }
      step(state, [wishOfUsed(ticks[i][0]), wishOfUsed(ticks[i][1])]);
    }
    const out = receipt(state);
    out.v = 2;
    out.ticksLogged = ticks.length;
    const mismatch = [];
    if (extra > 0) mismatch.push("extraTicks");
    out.combatCommit = combatCommitOf(body.combatSeed);
    if (body.combatCommit !== out.combatCommit) mismatch.push("combatCommit");
    const expect = body.expect && typeof body.expect === "object" ? body.expect : null;
    const cancelledInLobby = !expect && ticks.length === 0 && body.result && body.result.outcome === "cancel";
    if (!expect) {
      if (!cancelledInLobby) mismatch.push("expect");
    } else {
      for (const key of EXPECT_KEYS) {
        if (!(key in expect)) mismatch.push(key);
        else if (expect[key] !== out[key]) mismatch.push(key);
      }
      if ("stateSha256" in expect && expect.stateSha256 !== out.stateSha256) mismatch.push("stateSha256");
    }
    const { checks, verdict } = judge(body, ticks, state, out, mismatch.length === 0);
    mismatch.push(...checks);
    out.verified = mismatch.length === 0;
    out.mismatch = mismatch;
    out.verdict = verdict;
    return JSON.stringify(out);
  }
  function allFinite(value, depth = 0) {
    if (typeof value === "number") return Number.isFinite(value);
    if (value === null || typeof value !== "object") return true;
    if (depth > 32) return false;
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) if (!allFinite(value[i], depth + 1)) return false;
      return true;
    }
    for (const key of Object.keys(value)) if (!allFinite(value[key], depth + 1)) return false;
    return true;
  }
  function replayJSON(text) {
    let body;
    if (typeof text === "string") {
      if (text.length > REPLAY_LIMITS.maxBytes) return refused("too_long");
      try {
        body = JSON.parse(text);
      } catch {
        return refused("malformed");
      }
    } else {
      body = text;
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return refused("malformed");
    if (!allFinite(body)) return refused("nan");
    if (body.v === 2) return replayUsed(body);
    if (Array.isArray(body.inputs) && body.inputs.length > REPLAY_LIMITS.maxTicks) return refused("too_long");
    return JSON.stringify(receipt(replay(body)));
  }
  return __toCommonJS(export_exports);
})();
globalThis.SprotoShooterPvp = SprotoShooterPvp;
