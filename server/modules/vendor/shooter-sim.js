globalThis.__SPROTO_VERIFY_BUNDLE = true;
var SprotoShooterSim = (() => {
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
      for (let key2 of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key2) && key2 !== except)
          __defProp(to, key2, { get: () => from[key2], enumerable: !(desc = __getOwnPropDesc(from, key2)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/server/verify.js
  var verify_exports = {};
  __export(verify_exports, {
    ECONOMY: () => ECONOMY,
    INCREMENTAL_CHECKPOINT_SCHEMA_VERSION: () => INCREMENTAL_CHECKPOINT_SCHEMA_VERSION,
    LIMITS: () => LIMITS,
    PROTOCOL_VERSION: () => PROTOCOL_VERSION,
    REPLAY_API_VERSION: () => REPLAY_API_VERSION,
    SOURCE_COMMIT: () => SOURCE_COMMIT,
    UPLOAD_PROTOCOL_VERSION: () => UPLOAD_PROTOCOL_VERSION,
    acceptReplayBatch: () => acceptReplayBatch,
    beginIncrementalReplay: () => beginIncrementalReplay,
    bossById: () => bossById,
    buildIssuance: () => buildIssuance,
    contentFingerprintOf: () => contentFingerprintOf,
    publicReplayJSON: () => publicReplayJSON,
    pureClone: () => pureClone,
    runKiteProbeJSON: () => runKiteProbeJSON,
    stepReplaySlice: () => stepReplaySlice,
    verifyRun: () => verifyRun,
    verifyRunJSON: () => verifyRunJSON
  });

  // src/server/replayChecks.js
  function runtimeCheat(state) {
    const t = state.tuning || {};
    if (t.godMode) return "god_mode";
    if (t.infiniteAmmo || t.freezeEnemies || t.unlockAllRecipes) return "debug";
    if (t.enemyHpMult !== 1 || t.enemyDmgMult !== 1) return "debug";
    if (state.mode !== "campaign" || state.testMode || state.bossFight) return "debug";
    return null;
  }
  var SIM_GUN_SOURCES = { start: 1, world: 1, boss: 1, drop: 1 };
  function inventoryCheat(state) {
    const p = state.players[state.localPlayerId];
    if (!p) return "malformed";
    for (let i = 0; i < p.guns.length; i++) {
      const g = p.guns[i];
      if (g && !SIM_GUN_SOURCES[g.source]) return "injected_inventory";
    }
    for (let i = 0; i < state.pickups.length; i++) {
      const gun = state.pickups[i].gun;
      if (gun && !SIM_GUN_SOURCES[gun.source]) return "injected_inventory";
    }
    return null;
  }
  function emptyPart(type) {
    return { type, spawned: false, dead: false, fled: false, sourceKind: null, sourceId: null };
  }
  function noteParts(seen2, state, boss2) {
    for (let i = 0; i < boss2.parts.length; i++) {
      const type = boss2.parts[i];
      const prev = seen2[type] || emptyPart(type);
      const matches = [];
      for (let e = 0; e < state.enemies.length; e++) {
        const enemy2 = state.enemies[e];
        if (enemy2.type === type && enemy2.boss) matches.push(enemy2);
      }
      const enemy = matches.length ? matches[matches.length - 1] : null;
      if (!enemy) {
        seen2[type] = prev;
        continue;
      }
      prev.spawned = true;
      if (enemy.fled) prev.fled = true;
      if (enemy.dead && enemy.hp <= 0) {
        prev.dead = true;
        if (enemy.lastHit) {
          prev.sourceKind = enemy.lastHit.sourceKind;
          prev.sourceId = enemy.lastHit.sourceId;
        }
      }
      seen2[type] = prev;
    }
  }
  function classify(seen2, boss2, playerDead, playerId) {
    const parts = [];
    for (let i = 0; i < boss2.parts.length; i++) parts.push(seen2[boss2.parts[i]] || emptyPart(boss2.parts[i]));
    if (playerDead) return { outcome: "fail", reason: "player_down", parts, eligible: false };
    if (parts.some((part) => part.fled)) return { outcome: "fail", reason: "boss_fled", parts, eligible: false };
    if (!parts.every((part) => part.dead)) return { outcome: "incomplete", reason: "boss_alive", parts, eligible: false };
    const clean = parts.every((part) => (part.sourceKind === "gun" || part.sourceKind === "splash") && part.sourceId === playerId);
    if (!clean) return { outcome: "assisted", reason: "assisted", parts, eligible: false };
    return { outcome: "clear", reason: "boss_clear", parts, eligible: true };
  }
  function checkpointRestored(state) {
    const events = state && state.events;
    if (!events) return false;
    for (let i = 0; i < events.length; i++) {
      const type = events[i].type;
      if (type === "lockdownReset" || type === "voidRescue") return true;
    }
    return false;
  }

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
  var range = (r, lo, hi) => lo + float(r) * (hi - lo);
  var int = (r, lo, hiIncl) => lo + Math.floor(float(r) * (hiIncl - lo + 1));
  var pick = (r, arr) => arr[Math.floor(float(r) * arr.length)];
  function weighted(r, entries) {
    const f = float(r);
    return pickWeightedByFloat(entries, f);
  }
  function pickWeightedByFloat(entries, f) {
    let total = 0;
    for (const e of entries) total += e.weight;
    let x = f * total;
    for (const e of entries) {
      if (x < e.weight) return e;
      x -= e.weight;
    }
    return entries[entries.length - 1];
  }

  // src/data/skills.js
  var SKILLS = {
    health: { id: "health", name: "Health", icon: "\u2764", color: "#ff4d6d", xpBase: 100, xpGrowth: 1.45, maxLevel: 10 },
    gunslinger: { id: "gunslinger", name: "Gunslinger", icon: "\u{1F3AF}", color: "#ffcc33", xpBase: 120, xpGrowth: 1.45, maxLevel: 10 }
  };
  var SKILL_IDS = ["health", "gunslinger"];
  var XP = {
    health: { kill: 10, perDamage: 0.2, damageCapPerSec: 15, orb: 3, medkit: 5, bigOrb: 10, physicalBoss: 200 },
    gunslinger: { gunKill: 10, critKill: 5, weakKill: 5, weakHit: 1, weakHitCapPerSec: 10, physicalBoss: 200 }
  };
  var PERKS = [
    { id: "quickShield", skill: "health", level: 3, name: "Quick Shield", desc: "Shield recharges sooner and faster." },
    { id: "lifesteal", skill: "health", level: 6, name: "Lifesteal", desc: "Heal 2% of damage you deal (max 4 HP/s)." },
    { id: "unkillable", skill: "health", level: 10, name: "Unkillable Sproto", desc: "Once per wave, survive a lethal hit at 1 HP + 3s invulnerable." },
    { id: "fastHands", skill: "gunslinger", level: 3, name: "Fast Hands", desc: "Weapon swaps take 0.2s." },
    { id: "deadeye", skill: "gunslinger", level: 6, name: "Deadeye", desc: "+0.5 weak-spot crit multiplier." },
    { id: "bottomlessMags", skill: "gunslinger", level: 8, name: "Bottomless Mags", desc: "15% chance shots use no ammo." },
    { id: "killFrenzy", skill: "gunslinger", level: 10, name: "Kill Frenzy", desc: "Kills stack +4% fire rate, +3% damage (max 10, 4s)." }
  ];
  var PERKS_BY_ID = Object.fromEntries(PERKS.map((p) => [p.id, p]));
  var SPELLS = {
    gooBolt: { id: "gooBolt", name: "Goo Bolt", key: "Q", mana: 15, cd: 0.6, damage: 25, speed: 30, splash: 1.5 },
    chainZap: { id: "chainZap", name: "Chain Zap", key: "E", mana: 30, cd: 4, damage: 40, range: 25, chains: 4, chainRange: 6, falloff: 0.8 },
    swarm: { id: "swarm", name: "Sproto Swarm", key: "Z", mana: 50, cd: 15, count: 5 },
    manaShield: { id: "manaShield", name: "Mana Shield", key: "X", mana: 10, drain: 4, cd: 1, absorb: 0.6, dmgPerMana: 1.5 },
    meteor: { id: "meteor", name: "Meteor Bonk", key: "T", mana: "all", cd: 30, damage: 300, radius: 6, delay: 1, knockback: 14 }
  };
  var SPELL_IDS = ["gooBolt", "chainZap", "swarm", "manaShield", "meteor"];
  var WAVE_XP_GROWTH = 1.75;
  var xpToNext = (skillId, level, mode) => {
    const s = SKILLS[skillId];
    return Math.round(s.xpBase * Math.pow(mode === "waves" ? WAVE_XP_GROWTH : s.xpGrowth, level - 1));
  };

  // src/sim/spellbook.js
  function syncSpellbook(state, p) {
    if (!p.spellUnlocks) p.spellUnlocks = {};
    const god = !!(state.tuning && state.tuning.godMode);
    for (let i = 0; i < SPELL_IDS.length; i++) {
      const id = SPELL_IDS[i];
      const earned = !!p.spellUnlocks[id] || id === "gooBolt" && state.mode !== "campaign";
      p.perks[id] = god || earned;
    }
    if (!p.perks.manaShield && p.spells) p.spells.manaShieldOn = false;
  }
  function clearCampaignSpells(state, p) {
    p.spellUnlocks = {};
    syncSpellbook(state, p);
  }
  function grantSpell(state, p, id) {
    if (!p.spellUnlocks) p.spellUnlocks = {};
    p.spellUnlocks[id] = true;
    syncSpellbook(state, p);
  }

  // src/sim/events.js
  function emit(state, type, payload = {}) {
    state.events.push({ ...payload, type, tick: state.tick });
  }

  // src/data/tuning.js
  var TUNING = {
    arenaRadius: 45,
    spawnRadius: 43,
    spawnPointCount: 16,
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

  // src/data/duelBosses.js
  function boss(partial) {
    return {
      tag: "magic",
      campaign: true,
      ai: "mega",
      rig: "humanoid",
      stageHeights: [2.2, 2.4, 2.6],
      phases: [
        { hpBelow: 1, name: "1" },
        { hpBelow: 0.66, name: "2" },
        { hpBelow: 0.33, name: "3" }
      ],
      hitboxes: [
        { type: "capsule", zone: "body", r: 0.7, y0: 0, y1: 2 },
        { type: "sphere", zone: "weak", r: 0.35, y: 1.7, onlyWhen: "stunned" }
      ],
      attackEvery: 1.6,
      speed: 3.2,
      ...partial
    };
  }
  var DUEL_BOSS_LIST = [
    boss({
      id: "sahil",
      name: "SAHIL",
      hp: 980,
      radius: 0.7,
      height: 2.2,
      color: 4116366,
      model: "sahil",
      portraits: ["ui/bosses/sahil.png", "ui/bosses/sahil_stage2.png", "ui/bosses/sahil_stage3.png"],
      attacks: ["bolt", "blast", "rugSlam", "summon"]
    }),
    boss({
      id: "obamaDuo",
      name: "BITCOIN OBAMA",
      hp: 760,
      radius: 0.7,
      height: 2.2,
      color: 8377166,
      model: "obama",
      portraits: [],
      attacks: ["bolt", "blast", "summon"],
      tag: "physical"
    }),
    boss({
      id: "midgetDuo",
      name: "THE MIDGET",
      hp: 520,
      radius: 0.5,
      height: 1.4,
      color: 16735940,
      model: "midget",
      stageHeights: [1.4, 1.5, 1.6],
      portraits: [],
      attacks: ["bolt", "fly", "blast"],
      tag: "physical"
    }),
    boss({
      id: "broccoli",
      name: "BROCCOLI HEAD",
      hp: 1100,
      radius: 0.8,
      height: 2.4,
      color: 7003962,
      model: "sahil",
      portraits: [],
      attacks: ["blast", "bolt", "summon", "cloud"]
    }),
    boss({
      id: "glowie",
      name: "GLOWIE",
      hp: 1040,
      radius: 0.7,
      height: 2.2,
      color: 9357567,
      model: "sahil",
      portraits: [],
      attacks: ["bolt", "flash", "drone", "blast"]
    }),
    boss({
      id: "tinubu",
      name: "TINUBU",
      hp: 1600,
      radius: 1.1,
      height: 3.2,
      color: 16738877,
      model: "tinubu",
      stageHeights: [3.2, 3.6, 4],
      portraits: ["ui/bosses/tinubu.png", "ui/bosses/tinubu_stage2.png", "ui/bosses/tinubu_stage3.png"],
      attacks: ["breath", "blast", "slam", "summon"],
      tag: "physical"
    })
  ];
  var DUEL_BOSSES = Object.fromEntries(DUEL_BOSS_LIST.map((b) => [b.id, b]));

  // src/data/enemies.js
  var ENEMIES = {
    // Fast melee runner that comes in swarms. Never shoots.
    midget: {
      name: "Midget",
      hp: 40,
      speed: 7.8,
      accel: 40,
      radius: 0.45,
      height: 1.3,
      damage: 9,
      range: 1.3,
      windup: 0.25,
      active: 0.15,
      recover: 0.45,
      poiseMax: 25,
      staggerTime: 0.4,
      color: 16747069,
      affinity: { resist: null, weak: null },
      weights: { seek: 1, sep: 1.2, wall: 2, strafe: 0.25 },
      model: "midget",
      stage: 1,
      hitboxes: [
        { type: "capsule", zone: "body", r: 0.45, y0: 0, y1: 1.15 },
        { type: "sphere", zone: "weak", r: 0.22, x: 0, y: 1.1, z: 0.05 }
      ]
    },
    // Flying minion (Midget stage 3 model + propeller beanie): fast, erratic, circles you in the air and
    // peppers you with tiny weak pellets. Hard to hit, easy to kill.
    flyingMidget: {
      name: "Flying Midget",
      hp: 30,
      speed: 10.5,
      accel: 26,
      radius: 0.4,
      height: 1.3,
      damage: 0,
      flying: true,
      altMin: 3,
      altMax: 6.5,
      orbitMin: 7,
      orbitMax: 14,
      jinkMin: 0.5,
      jinkMax: 1.2,
      poiseMax: 20,
      staggerTime: 0.35,
      color: 16735940,
      affinity: { resist: null, weak: "shock" },
      weights: { seek: 1, sep: 1.2, wall: 2, strafe: 0.4 },
      gun: { damage: 2, burst: 2, burstGap: 0.12, cooldownMin: 1.1, cooldownMax: 1.8, spread: 6, speed: 34, range: 30, windup: 0.2, small: true },
      model: "midget",
      stage: 3,
      hitboxes: [
        { type: "capsule", zone: "body", r: 0.4, y0: 0, y1: 1.15 },
        { type: "sphere", zone: "weak", r: 0.22, x: 0, y: 1.1, z: 0.05 }
      ]
    },
    // Keeps its distance, strafes and shoots bursts of bitcoins. Slower and much less accurate than you.
    obama: {
      name: "Bitcoin Obama",
      hp: 70,
      speed: 4.2,
      accel: 22,
      radius: 0.5,
      height: 2.1,
      damage: 0,
      keepMin: 9,
      keepMax: 20,
      poiseMax: 30,
      staggerTime: 0.5,
      color: 8377166,
      affinity: { resist: "goo", weak: "fire" },
      weights: { seek: 1, sep: 1.5, wall: 2, strafe: 0.8 },
      gun: { damage: 6, burst: 3, burstGap: 0.22, cooldownMin: 2, cooldownMax: 3, spread: 4.5, speed: 30, range: 34, windup: 0.45 },
      model: "obama",
      stage: 1,
      hitboxes: [
        { type: "capsule", zone: "body", r: 0.5, y0: 0, y1: 1.85 },
        { type: "sphere", zone: "weak", r: 0.24, x: 0, y: 1.9, z: 0.05 }
      ]
    },
    // Heavy: slow, front shield, ground pound up close and a sloppy bullet hose at range. Hit the back battery.
    bigObama: {
      name: "Big Bitcoin Obama",
      hp: 320,
      speed: 2.4,
      accel: 8,
      radius: 0.9,
      height: 2.6,
      damage: 25,
      turnRate: 70,
      range: 3.5,
      poundRadius: 3.2,
      windup: 0.9,
      recover: 1.2,
      poiseMax: 150,
      staggerTime: 0.8,
      color: 6978513,
      affinity: { resist: "fire", weak: "shock" },
      weakMultOverride: 2.5,
      gun: { damage: 5, burst: 6, burstGap: 0.12, cooldownMin: 3, cooldownMax: 4, spread: 7, speed: 26, range: 28, windup: 0.7 },
      model: "obama",
      stage: 3,
      hitboxes: [
        { type: "capsule", zone: "body", r: 0.9, y0: 0, y1: 2.6 },
        { type: "sphere", zone: "shield", r: 1, x: 0, y: 1.3, z: 0.95 },
        { type: "sphere", zone: "weak", r: 0.38, x: 0, y: 1.5, z: -0.9 }
      ]
    },
    // Robots: rigged + animated in Blender (art/blender/new_enemies.blend). `clips: true` = every state is an authored
    // clip (render/bossClips.js enemyClipWant). `from` = where shots leave the model, as fractions of its height
    // (up, fwd, side; side + = the model's left), measured on the firing frame of the clip.
    // Common ranged robot: keeps its distance and fires 2-shot bursts of fast red lasers from its head.
    robotLaser: {
      name: "Laser Bot",
      hp: 60,
      speed: 4.6,
      accel: 22,
      radius: 0.5,
      height: 2.2,
      damage: 0,
      keepMin: 8,
      keepMax: 18,
      poiseMax: 30,
      staggerTime: 0.5,
      color: 16730685,
      affinity: { resist: "fire", weak: "shock" },
      weights: { seek: 1, sep: 1.5, wall: 2, strafe: 0.8 },
      gun: {
        kind: "laser",
        damage: 7,
        burst: 2,
        burstGap: 0.2,
        cooldownMin: 1.6,
        cooldownMax: 2.6,
        spread: 2.5,
        speed: 46,
        range: 36,
        windup: 0.5,
        radius: 0.16,
        from: { up: 0.78, fwd: 0.12, side: 0.04 },
        trackDone: true
      },
      model: "robotLaser",
      stage: 1,
      clips: true,
      behavior: "obama",
      hitboxes: [
        { type: "capsule", zone: "body", r: 0.5, y0: 0, y1: 1.4 },
        { type: "sphere", zone: "weak", r: 0.42, x: 0, y: 1.8, z: 0.05 }
      ]
    },
    // Tougher robot: arm-gun bursts as its regular attack and, on its own cooldown, a charged big head laser.
    robotShooter: {
      name: "Shooter Bot",
      hp: 170,
      speed: 3.6,
      accel: 16,
      radius: 0.55,
      height: 2.7,
      damage: 0,
      keepMin: 10,
      keepMax: 22,
      poiseMax: 90,
      staggerTime: 0.6,
      color: 9063935,
      affinity: { resist: "fire", weak: "shock" },
      weights: { seek: 1, sep: 1.5, wall: 2, strafe: 0.6 },
      gun: {
        kind: "bullet",
        damage: 6,
        burst: 3,
        burstGap: 0.15,
        cooldownMin: 1.4,
        cooldownMax: 2.2,
        spread: 4,
        speed: 34,
        range: 34,
        windup: 0.45,
        from: { up: 0.75, fwd: 0.33, side: 0.03 },
        trackDone: true
      },
      special: {
        kind: "bigLaser",
        damage: 26,
        burst: 1,
        burstGap: 0.2,
        cooldownMin: 5.5,
        cooldownMax: 7.5,
        spread: 0.5,
        speed: 58,
        range: 44,
        windup: 1,
        radius: 0.55,
        from: { up: 0.87, fwd: 0.12, side: -0.01 },
        trackDone: true
      },
      model: "robotShooter",
      stage: 1,
      clips: true,
      behavior: "gunner",
      hitboxes: [
        { type: "capsule", zone: "body", r: 0.5, y0: 0, y1: 2.15 },
        { type: "sphere", zone: "weak", r: 0.3, x: 0, y: 2.35, z: 0.1 }
      ]
    },
    dummy: {
      name: "Target Dummy",
      hp: 500,
      speed: 0,
      accel: 0,
      radius: 0.5,
      height: 1.8,
      damage: 0,
      poiseMax: 1e9,
      staggerTime: 0,
      color: 15259560,
      affinity: { resist: null, weak: null },
      regen: true,
      hitboxes: [
        { type: "capsule", zone: "body", r: 0.5, y0: 0, y1: 1.6 },
        { type: "sphere", zone: "weak", r: 0.3, x: 0, y: 1.85, z: 0 }
      ]
    }
  };
  function dress(behavior, over) {
    return { ...ENEMIES[behavior], ...over, behavior };
  }
  Object.assign(ENEMIES, {
    boomMidget: dress("midget", { name: "Boom Midget", hp: 34, color: 16733491, archetype: { deathBlast: { radius: 3.2, damage: 28 } } }),
    // Runs at you, lights its fuse inside `trigger` metres and goes off `delay` seconds later. Shot first,
    // the same bomb goes off among its friends. It never punches: the bomb is the attack.
    kamikazeMidget: dress("midget", {
      name: "Kamikaze Midget",
      hp: 26,
      speed: 9.6,
      damage: 0,
      color: 16726815,
      archetype: { fuse: { trigger: 2.4, delay: 0.5, radius: 3.4, damage: 26 }, deathBlast: { radius: 3.4, damage: 30 } }
    }),
    riotMidget: dress("midget", { name: "Riot Midget", hp: 58, speed: 5.4, color: 8954048, archetype: { frontShield: 0.3 } }),
    sewerMidget: dress("midget", { name: "Sewer Midget", hp: 36, color: 6989903, archetype: { burrow: { every: 5, duration: 0.6 } } }),
    floretSprout: dress("midget", { name: "Floret Sprout", hp: 48, speed: 6.2, color: 7003962, archetype: { mortar: { every: 3, damage: 8, speed: 11 } } }),
    hexAcolyte: dress("obama", { name: "Hex Acolyte", hp: 64, color: 4116366, model: "sahil", archetype: { bubble: { radius: 8, every: 4, duration: 2.5 } } }),
    glowieAgent: dress("obama", { name: "Glowie Agent", hp: 70, color: 9357567, model: "sahil", archetype: { flash: { every: 6, radius: 7 } } }),
    auditSniper: dress("obama", {
      name: "Audit Sniper",
      hp: 55,
      color: 13162751,
      model: "obama",
      gun: { damage: 8, burst: 1, burstGap: 0.2, cooldownMin: 1.6, cooldownMax: 2.4, spread: 1.5, speed: 40, range: 48, windup: 0.35 },
      archetype: { relocate: { every: 4 } }
    }),
    miningRig: dress("bigObama", { name: "Mining Rig", hp: 140, speed: 1.4, color: 10134706, model: "obama", archetype: { turret: true } }),
    daycare: dress("midget", { name: "Daycare Nest", hp: 80, speed: 2.2, color: 16757922, archetype: { nest: true } }),
    bitbug: dress("flyingMidget", { name: "Bitbug", hp: 18, color: 11566335, model: "midget", archetype: { flock: true } }),
    jetObama: dress("flyingMidget", { name: "Jet Obama", hp: 55, color: 8377166, model: "obama", stage: 2, weakMultOverride: 2.5, archetype: { thruster: true } }),
    balloonMidget: dress("flyingMidget", { name: "Balloon Midget", hp: 28, color: 16747220, model: "midget", archetype: { deathBlast: { radius: 2.6, damage: 18 } } }),
    flakPod: {
      name: "Gas Fee Flak Pod",
      hp: 160,
      speed: 0,
      accel: 0,
      radius: 1.3,
      height: 2.6,
      damage: 0,
      poiseMax: 1e9,
      staggerTime: 0,
      color: 11693055,
      affinity: { resist: null, weak: null },
      behavior: "midget",
      look: [
        { kind: "cylinder", at: [0, 0, 0], r: 1.3, h: 1, mat: "metal" },
        { kind: "sphere", at: [0, 1.7, 0], r: 0.85, mat: "neon" },
        { kind: "box", at: [0, 0.8, -1.2], size: [0.5, 0.5, 0.3], mat: "metal" }
      ],
      hitboxes: [
        { type: "capsule", zone: "body", r: 1.3, y0: 0, y1: 1 },
        { type: "sphere", zone: "armor", r: 0.85, x: 0, y: 1.7, z: 0 },
        { type: "sphere", zone: "weak", r: 0.4, x: 0, y: 0.8, z: -1.2 }
      ]
    },
    spotterDrone: {
      name: "Spotter Drone",
      hp: 45,
      speed: 8,
      accel: 20,
      radius: 0.6,
      height: 0.8,
      damage: 0,
      flying: true,
      altMin: 8,
      altMax: 9,
      orbitMin: 7,
      orbitMax: 14,
      jinkMin: 0.5,
      jinkMax: 1.2,
      poiseMax: 20,
      staggerTime: 0.3,
      color: 10475263,
      affinity: { resist: null, weak: "shock" },
      behavior: "flyingMidget",
      look: [
        { kind: "box", at: [0, 0.6, 0], size: [1, 0.4, 1], mat: "metal" },
        { kind: "cone", at: [0, 0.1, 0], r: 0.3, h: 0.5, mat: "neon" },
        { kind: "disc", at: [0.45, 0.7, 0.45], r: 0.35, mat: "metal" },
        { kind: "disc", at: [-0.45, 0.7, 0.45], r: 0.35, mat: "metal" },
        { kind: "disc", at: [0.45, 0.7, -0.45], r: 0.35, mat: "metal" },
        { kind: "disc", at: [-0.45, 0.7, -0.45], r: 0.35, mat: "metal" }
      ],
      hitboxes: [
        { type: "sphere", zone: "body", r: 0.6, y: 0.6 },
        { type: "sphere", zone: "weak", r: 0.25, x: 0, y: 0.7, z: 0.2 }
      ]
    },
    frostHound: {
      name: "Frost Hound",
      hp: 55,
      speed: 5,
      run: 9.5,
      accel: 24,
      radius: 0.5,
      height: 0.9,
      damage: 16,
      weights: { seek: 1, sep: 1.2, wall: 2, strafe: 0.25 },
      range: 9,
      windup: 0.5,
      active: 0.2,
      recover: 0.9,
      lunge: 20,
      knockback: 6,
      patch: { radius: 2.5, seconds: 6, slow: 0.15 },
      poiseMax: 30,
      staggerTime: 0.35,
      color: 14017775,
      affinity: { resist: null, weak: "fire" },
      behavior: "midget",
      look: [
        { kind: "box", at: [0, 0.55, 0], size: [1.2, 0.5, 0.6], mat: "ice" },
        { kind: "box", at: [0, 0.7, 0.55], size: [0.45, 0.45, 0.45], mat: "ice" },
        { kind: "cylinder", at: [-0.35, 0, 0.3], r: 0.1, h: 0.5, mat: "ice" },
        { kind: "cylinder", at: [0.35, 0, 0.3], r: 0.1, h: 0.5, mat: "ice" },
        { kind: "cylinder", at: [-0.35, 0, -0.3], r: 0.1, h: 0.5, mat: "ice" },
        { kind: "cylinder", at: [0.35, 0, -0.3], r: 0.1, h: 0.5, mat: "ice" },
        { kind: "cone", at: [0, 0.55, -0.5], r: 0.15, h: 0.5, mat: "ice" },
        { kind: "sphere", at: [0.12, 0.85, 0.7], r: 0.08, mat: "neon" },
        { kind: "sphere", at: [-0.12, 0.85, 0.7], r: 0.08, mat: "neon" }
      ],
      hitboxes: [
        { type: "capsule", zone: "body", r: 0.5, y0: 0.3, y1: 0.9 },
        { type: "sphere", zone: "weak", r: 0.28, x: 0, y: 0.85, z: 0.55 }
      ]
    },
    miniTinubu: dress("midget", { name: "Mini Tinubu", hp: 90, speed: 6.4, color: 16738877, model: "tinubu", radius: 0.55, height: 1.8, archetype: { charge: { every: 3, duration: 0.4, speed: 14 } } }),
    gateGenerator: dress("midget", { name: "Gate Generator", hp: 200, speed: 0, accel: 0, damage: 0, color: 6750156, model: "robotLaser" }),
    gatekeeper: dress("bigObama", {
      name: "The Gatekeeper",
      hp: 1600,
      speed: 2.4,
      color: 13938487,
      radius: 1.35,
      height: 3.9,
      archetype: { audit: true }
    }),
    hexWisp: {
      name: "Hex Wisp",
      hp: 45,
      speed: 5,
      accel: 22,
      radius: 0.5,
      height: 1,
      damage: 0,
      flying: true,
      ghost: true,
      altMin: 1.2,
      altMax: 2.6,
      orbitMin: 6,
      orbitMax: 14,
      jinkMin: 0.6,
      jinkMax: 1.2,
      poiseMax: 15,
      staggerTime: 0.3,
      color: 11766015,
      affinity: { resist: null, weak: null },
      taken: { bullet: 0.2, explosive: 0.5, spell: 2 },
      weights: { seek: 1, sep: 0.4, wall: 0, strafe: 0.2 },
      behavior: "flyingMidget",
      archetype: { wisp: { every: 3.2, damage: 8, speed: 9 } },
      look: [
        { kind: "sphere", at: [0, 0.6, 0], r: 0.5, mat: "neon" },
        { kind: "sphere", at: [0.12, 0.7, 0.2], r: 0.08, mat: "stone" },
        { kind: "sphere", at: [-0.12, 0.7, 0.2], r: 0.08, mat: "stone" },
        { kind: "cone", at: [0, 0.5, -0.4], r: 0.3, h: 0.8, mat: "neon" }
      ],
      hitboxes: [{ type: "sphere", zone: "body", r: 0.5, x: 0, y: 0.6, z: 0 }]
    },
    barkBrute: {
      name: "Bark Brute",
      hp: 260,
      speed: 3.2,
      accel: 14,
      radius: 0.8,
      height: 2.4,
      damage: 22,
      range: 2.6,
      windup: 0.8,
      active: 0.2,
      recover: 0.6,
      turnRate: 90,
      poiseMax: 80,
      staggerTime: 0.5,
      color: 9067051,
      affinity: { resist: null, weak: null },
      weakIgnoresArmour: true,
      armour: {
        hard: { bullet: 0, explosive: 0.25, spell: 1 },
        softened: { bullet: 1, explosive: 1, spell: 1 },
        cracked: { bullet: 1, explosive: 1, spell: 1 },
        stripped: { bullet: 1.25, explosive: 1.25, spell: 1 }
      },
      weights: { seek: 1, sep: 0.8, wall: 2, strafe: 0.1 },
      behavior: "midget",
      archetype: { bark: true },
      look: [
        { kind: "box", at: [0, 0.45, 0], size: [1, 0.9, 0.7], mat: "wood" },
        { kind: "box", at: [0, 1.3, 0], size: [1.4, 1, 0.9], mat: "wood" },
        { kind: "box", at: [0, 2, 0], size: [0.7, 0.5, 0.6], mat: "wood" }
      ],
      hitboxes: [
        { type: "capsule", zone: "body", r: 0.8, y0: 0, y1: 2.2 },
        { type: "sphere", zone: "weak", r: 0.25, x: 0, y: 1.3, z: -0.7 }
      ]
    },
    manaLeech: {
      name: "Mana Leech",
      hp: 55,
      speed: 3.8,
      accel: 18,
      radius: 0.45,
      height: 1.1,
      damage: 4,
      range: 1.2,
      windup: 0.25,
      active: 0.15,
      recover: 0.4,
      poiseMax: 20,
      staggerTime: 0.35,
      color: 8257386,
      affinity: { resist: null, weak: "shock" },
      weights: { seek: 1, sep: 1, wall: 2, strafe: 0.4 },
      behavior: "midget",
      archetype: { leech: { range: 10, drain: 8 } },
      look: [
        { kind: "cylinder", at: [0, 0, 0], r: 0.4, h: 1.1, mat: "toxic" },
        { kind: "disc", at: [0, 0.7, 0.4], r: 0.45, mat: "neon" }
      ],
      hitboxes: [
        { type: "capsule", zone: "body", r: 0.45, y0: 0, y1: 1.1 },
        { type: "sphere", zone: "weak", r: 0.2, x: 0, y: 0.7, z: 0.4 }
      ]
    },
    gooGlob: {
      name: "Goo Glob",
      hp: 90,
      speed: 3,
      accel: 12,
      radius: 1.1,
      height: 1.6,
      damage: 14,
      range: 2.2,
      windup: 0.4,
      active: 0.2,
      recover: 0.5,
      poiseMax: 40,
      staggerTime: 0.4,
      color: 7003962,
      affinity: { resist: "goo", weak: null },
      split: "gooGlobMid",
      weights: { seek: 1, sep: 0.6, wall: 2, strafe: 0.1 },
      behavior: "midget",
      look: [
        { kind: "sphere", at: [0, 0.8, 0], r: 1.1, mat: "toxic" },
        { kind: "sphere", at: [0, 0.9, 0.2], r: 0.33, mat: "neon" }
      ],
      hitboxes: [{ type: "sphere", zone: "body", r: 1.1, x: 0, y: 0.8, z: 0 }]
    },
    gooGlobMid: {
      name: "Goo Glob",
      hp: 40,
      speed: 4.2,
      accel: 16,
      radius: 0.7,
      height: 1.1,
      damage: 9,
      range: 1.6,
      windup: 0.3,
      active: 0.15,
      recover: 0.4,
      poiseMax: 20,
      staggerTime: 0.3,
      color: 7003962,
      affinity: { resist: "goo", weak: null },
      split: "gooGlobSmall",
      weights: { seek: 1, sep: 0.8, wall: 2, strafe: 0.2 },
      behavior: "midget",
      hitboxes: [{ type: "sphere", zone: "body", r: 0.7, x: 0, y: 0.5, z: 0 }]
    },
    gooGlobSmall: {
      name: "Goo Glob",
      hp: 15,
      speed: 6,
      accel: 22,
      radius: 0.4,
      height: 0.7,
      damage: 5,
      range: 1.2,
      windup: 0.2,
      active: 0.1,
      recover: 0.3,
      poiseMax: 10,
      staggerTime: 0.25,
      color: 10354554,
      affinity: { resist: "goo", weak: null },
      weights: { seek: 1.2, sep: 1, wall: 2, strafe: 0.3 },
      behavior: "midget",
      hitboxes: [{ type: "sphere", zone: "body", r: 0.4, x: 0, y: 0.35, z: 0 }]
    }
  });
  var ELITE = { hpMult: 2.5, dmgMult: 1.3, speedMult: 1.1, scale: 1.25, poiseMult: 2, dropMult: 2, gunMult: 3, xpMult: 3 };
  var AFFINITY_POOL = ["fire", "shock", "goo"];
  var ENEMY_BULLET_RADIUS = 0.2;
  var BOSSES = {
    // Physical bosses (ai 'mega'): chase, volley, charge, slam, summon, missiles, plus a heavy melee swipe when
    // you get close. melee.range is reach beyond the boss radius; missiles home in and explode.
    megaSproto: {
      name: "MEGA TINUBU",
      tag: "physical",
      ai: "mega",
      hp: 3500,
      radius: 2.6,
      height: 5.85,
      color: 16738877,
      speed: 4.5,
      contactDamage: 15,
      chargeDamage: 35,
      chargeSpeed: 22,
      slamDamage: 25,
      volley: { damage: 10, count: 7, fan: 50, speed: 24, waves: 2, gap: 0.4, y: 4.2 },
      // melee timing follows boss-attack research: a readable windup that holds (>= 0.34 s from tell to hit), a
      // fast strike, then a long recovery (the punish window)
      melee: { range: 3, damage: 45, windup: 0.7, recover: 0.85, cd: 1.6, knockback: 14 },
      missiles: { count: 2, damage: 32, splash: 4.5, speed: 13, homing: 1.1, ttl: 6, gap: 0.3, y: 5.2 },
      model: "tinubu",
      stageHeights: [5.5, 6, 6.5],
      portraits: ["ui/bosses/tinubu.png", "ui/bosses/tinubu_stage2.png", "ui/bosses/tinubu_stage3.png"],
      phases: [
        { hpBelow: 1, speedMult: 1, pattern: ["chase", "volley", "charge", "chase", "missiles", "slam"] },
        { hpBelow: 0.5, speedMult: 1.3, pattern: ["chase", "charge", "missiles", "volley", "slam", "charge", "slam", "summon"] },
        { hpBelow: 0.2, speedMult: 1.5, pattern: ["volley", "missiles", "charge", "slam", "volley", "charge", "summon"] }
      ],
      hitboxes: [
        { type: "capsule", zone: "body", r: 2.6, y0: 0, y1: 5.85 },
        { type: "sphere", zone: "weak", r: 0.78, x: 0, y: 5.7, z: 0.78 },
        { type: "sphere", zone: "weak", r: 0.65, x: 0, y: 2.6, z: 2.5, onlyWhen: "stunned" }
      ]
    },
    monster: {
      // Wave 2 boss. Rigged humanoid without clips: the renderer animates its skeleton (humanoidRig.js).
      // Its melee is an overhead arm smash. Spits monster bullets.
      name: "BLUE MONSTER",
      tag: "physical",
      ai: "mega",
      hp: 3800,
      radius: 2.4,
      height: 7,
      color: 3107839,
      speed: 4.8,
      contactDamage: 18,
      chargeDamage: 40,
      chargeSpeed: 24,
      slamDamage: 30,
      volley: { damage: 12, count: 5, fan: 40, speed: 26, waves: 2, gap: 0.45, y: 6, kind: "monsterBullet" },
      melee: { range: 3.2, damage: 50, windup: 0.75, recover: 0.9, cd: 1.5, knockback: 16 },
      missiles: { count: 3, damage: 34, splash: 4.5, speed: 13, homing: 1.2, ttl: 6, gap: 0.28, y: 6.2 },
      model: "monster",
      rig: "humanoid",
      stageHeights: [7, 7.6, 8.2],
      portraits: [],
      phases: [
        { hpBelow: 1, speedMult: 1, pattern: ["chase", "volley", "missiles", "chase", "charge", "slam"] },
        { hpBelow: 0.5, speedMult: 1.25, pattern: ["chase", "missiles", "volley", "charge", "slam", "summon"] },
        { hpBelow: 0.2, speedMult: 1.45, pattern: ["missiles", "volley", "charge", "slam", "missiles", "charge", "summon"] }
      ],
      hitboxes: [
        { type: "capsule", zone: "body", r: 2.4, y0: 0, y1: 7 },
        { type: "sphere", zone: "weak", r: 0.9, x: 0, y: 6.5, z: 0.5 },
        { type: "sphere", zone: "weak", r: 0.7, x: 0, y: 3.6, z: 1.5, onlyWhen: "stunned" }
      ]
    },
    // Jade Dragon: wave 1 boss (Tripo quadruped rig, no clips: animated procedurally in render/dragonRig.js).
    // Long body along local +z, so its hitboxes are a chain of spheres from head to tail.
    dragon: {
      name: "JADE DRAGON",
      tag: "physical",
      hp: 2200,
      radius: 1.6,
      height: 3.2,
      color: 3124826,
      speed: 5,
      breath: { damage: 6, speed: 18, rate: 0.07, duration: 1.6, sweep: 60, telegraph: 0.7 },
      fireball: { damage: 15, splash: 2.6, count: 3, flight: 1.2 },
      tail: { damage: 20, radius: 6.5, windup: 0.6 },
      // flight: take off, circle you at altitude dropping fireballs, land
      fly: { height: 7, heightSwing: 3, rise: 1.2, duration: 7, land: 1.4, speed: 13, radius: 13, radiusSwing: 4, shotEvery: 1.1, swoopAt: 3.2, swoopTime: 1.6, swoopHeight: 2.6 },
      model: "dragon",
      stageHeights: [3.2, 3.4, 3.6],
      portraits: [],
      phases: [
        { hpBelow: 1, speedMult: 1, pattern: ["stalk", "breath", "fly", "stalk", "fireballs", "tailSwipe"] },
        { hpBelow: 0.6, speedMult: 1.2, pattern: ["stalk", "fly", "breath", "fireballs", "summon", "tailSwipe", "fly"] },
        { hpBelow: 0.25, speedMult: 1.4, pattern: ["fly", "breath", "fireballs", "tailSwipe", "fly", "summon"] }
      ],
      hitboxes: [
        { type: "sphere", zone: "weak", r: 0.55, x: 0, y: 2.55, z: 2.55 },
        { type: "sphere", zone: "body", r: 0.95, x: 0, y: 2, z: 1.9 },
        { type: "sphere", zone: "body", r: 1.15, x: 0, y: 1.35, z: 0.7 },
        { type: "sphere", zone: "body", r: 1.15, x: 0, y: 1.2, z: -0.6 },
        { type: "sphere", zone: "body", r: 0.9, x: 0, y: 0.95, z: -1.8 },
        { type: "sphere", zone: "body", r: 0.6, x: 0, y: 0.7, z: -2.7 }
      ]
    },
    sprotoBeast: {
      // Rigged humanoid (Tripo skeleton) without clips, animated by humanoidRig.js. Fights with punches and kicks.
      name: "SPROTO BEAST",
      tag: "physical",
      ai: "mega",
      hp: 4500,
      radius: 2.4,
      height: 7.5,
      color: 8011007,
      speed: 5.4,
      contactDamage: 20,
      chargeDamage: 45,
      chargeSpeed: 25,
      slamDamage: 32,
      volley: { damage: 11, count: 7, fan: 55, speed: 26, waves: 2, gap: 0.35, y: 6 },
      melee: { range: 3.4, damage: 55, windup: 0.6, recover: 0.75, cd: 1.2, knockback: 15, combo: ["punch", "kick", "punch", "punch", "kick"], kick: { range: 1, damage: 1.2, knockback: 1.4 } },
      missiles: { count: 4, damage: 34, splash: 4.5, speed: 14, homing: 1.3, ttl: 6, gap: 0.25, y: 6.4 },
      model: "sprotoBeast",
      rig: "humanoid",
      stageHeights: [7.5, 8, 8.6],
      portraits: [],
      phases: [
        { hpBelow: 1, speedMult: 1, pattern: ["chase", "missiles", "chase", "volley", "charge", "slam"] },
        { hpBelow: 0.55, speedMult: 1.25, pattern: ["chase", "charge", "missiles", "chase", "slam", "summon"] },
        { hpBelow: 0.2, speedMult: 1.5, pattern: ["missiles", "chase", "charge", "slam", "volley", "chase", "summon"] }
      ],
      hitboxes: [
        { type: "capsule", zone: "body", r: 2.4, y0: 0, y1: 7.5 },
        { type: "sphere", zone: "weak", r: 0.9, x: 0, y: 6.4, z: 1.9 },
        { type: "sphere", zone: "weak", r: 0.75, x: 0, y: 3.9, z: 1.6, onlyWhen: "stunned" }
      ]
    },
    // Car Part Monster: magnet-fisted junk golem. Smashes up close and hurls car tyres that bounce once and explode.
    // rig 'clips': every action is an authored clip (render/bossClips.js); no procedural rig under it.
    carMonster: {
      name: "CAR PART MONSTER",
      tag: "physical",
      ai: "mega",
      hp: 4200,
      radius: 2.6,
      height: 6.4,
      color: 12597547,
      speed: 4.4,
      contactDamage: 20,
      chargeDamage: 42,
      chargeSpeed: 23,
      slamDamage: 30,
      melee: { range: 3.2, damage: 52, windup: 0.75, recover: 0.9, cd: 1.5, knockback: 17 },
      // thrown from alternating hands every `gap` s after a 0.6 s wind-up, lobbed to land on you (`flight` s), one bounce
      missiles: { kind: "tyre", count: 4, damage: 30, splash: 5, gap: 0.3, flight: 1.15, gravity: 16, bounces: 1, scatter: 2.5, ttl: 6, from: { up: 0.95, fwd: 0.25, side: 0.45 } },
      model: "carMonster",
      rig: "clips",
      stageHeights: [6.4, 6.9, 7.4],
      portraits: [],
      phases: [
        { hpBelow: 1, speedMult: 1, pattern: ["chase", "missiles", "chase", "charge", "slam"] },
        { hpBelow: 0.55, speedMult: 1.2, pattern: ["chase", "missiles", "charge", "slam", "summon"] },
        { hpBelow: 0.2, speedMult: 1.4, pattern: ["missiles", "chase", "charge", "missiles", "slam", "summon"] }
      ],
      hitboxes: [
        { type: "capsule", zone: "body", r: 2.6, y0: 0, y1: 6.4 },
        { type: "sphere", zone: "weak", r: 0.9, x: 0, y: 5.8, z: 0.8 },
        { type: "sphere", zone: "weak", r: 0.8, x: 0, y: 3.4, z: 1.8, onlyWhen: "stunned" }
      ]
    },
    // Mole Monster: a miner mole with a drill for a right hand. Drill stab up close; fans of drill heads at range.
    moleMonster: {
      name: "MOLE MONSTER",
      tag: "physical",
      ai: "mega",
      hp: 4e3,
      radius: 2.4,
      height: 5.6,
      color: 9268835,
      speed: 4.8,
      contactDamage: 18,
      chargeDamage: 40,
      chargeSpeed: 24,
      slamDamage: 30,
      melee: { range: 3.4, damage: 50, windup: 0.75, recover: 0.9, cd: 1.4, knockback: 16 },
      // fired from the drill hand: a 0.5 s aim, then `waves` fans every `gap` s (the shoot_loop clip is one gap long)
      volley: { kind: "drill", damage: 14, count: 3, fan: 22, speed: 30, waves: 3, gap: 0.4, radius: 0.45, from: { up: 0.68, fwd: 0.79, side: -0.13 } },
      model: "moleMonster",
      rig: "clips",
      stageHeights: [5.6, 6, 6.5],
      portraits: [],
      phases: [
        { hpBelow: 1, speedMult: 1, pattern: ["chase", "volley", "chase", "charge", "slam"] },
        { hpBelow: 0.55, speedMult: 1.2, pattern: ["chase", "volley", "charge", "volley", "slam", "summon"] },
        { hpBelow: 0.2, speedMult: 1.4, pattern: ["volley", "chase", "charge", "volley", "slam", "summon"] }
      ],
      hitboxes: [
        { type: "capsule", zone: "body", r: 2.4, y0: 0, y1: 5.6 },
        { type: "sphere", zone: "weak", r: 0.85, x: 0, y: 4.9, z: 0.9 },
        { type: "sphere", zone: "weak", r: 0.75, x: 0, y: 2.8, z: 1.6, onlyWhen: "stunned" }
      ]
    },
    hexAuditor: {
      // Floats ~1.6 m off the ground: pos.y is the body centre, so hitboxes go below and above it.
      name: "HEX SAHIL",
      tag: "magic",
      ai: "hex",
      hp: 3e3,
      radius: 0.7,
      height: 2.5,
      color: 10181119,
      speed: 4.5,
      hoverY: 1.6,
      orbDamage: 8,
      taxDamage: 12,
      auraRadius: 9,
      auraRadiusP3: 13,
      auraDrain: 15,
      model: "sahil",
      stageHeights: [2.6, 2.8, 3.1],
      portraits: ["ui/bosses/sahil.png", "ui/bosses/sahil_stage2.png", "ui/bosses/sahil_stage3.png"],
      phases: [
        { hpBelow: 1, pattern: ["drift", "ring", "fan", "spiral", "teleport"] },
        { hpBelow: 0.6, pattern: ["ring", "taxBolts", "spiral", "fan", "teleport"] },
        { hpBelow: 0.25, pattern: ["spiralRing", "taxBolts", "fan", "teleport"] }
      ],
      hitboxes: [
        { type: "capsule", zone: "body", r: 0.7, y0: -1.3, y1: 1.3 },
        { type: "sphere", zone: "weak", r: 0.45, orbit: 1.9 }
      ]
    }
  };
  for (const b of DUEL_BOSS_LIST) BOSSES[b.id] = b;
  var ALLY = { ttl: 8, speed: 7, damage: 30, splashRadius: 2, fireCd: 0.8, range: 14 };

  // src/data/waves.js
  var S = (type, count, elites = 0) => ({ type, count, elites });
  var WAVES = [
    {
      id: 1,
      name: "Wave 1: Midget Rush",
      clearTickets: 20,
      maxAlive: 14,
      groups: [
        { at: 0, aliveBelow: null, pattern: "cluster", spawns: [S("midget", 5)] },
        { at: 7, aliveBelow: 2, pattern: "spread", spawns: [S("obama", 2), S("midget", 3)] },
        { at: 16, aliveBelow: 3, pattern: "cluster", spawns: [S("midget", 6)] },
        { at: 26, aliveBelow: 3, pattern: "spread", spawns: [S("obama", 2), S("midget", 2)] }
      ],
      boss: { types: ["dragon"], introDelay: 3 }
    },
    {
      id: 2,
      name: "Wave 2: Bitcoin Barrage",
      clearTickets: 35,
      maxAlive: 18,
      groups: [
        { at: 0, aliveBelow: null, pattern: "spread", spawns: [S("midget", 6), S("obama", 2)] },
        { at: 10, aliveBelow: 4, pattern: "cluster", spawns: [S("midget", 8)] },
        { at: 20, aliveBelow: 4, pattern: "spread", spawns: [S("bigObama", 1), S("obama", 3), S("midget", 4, 1), S("flyingMidget", 2)] },
        { at: 32, aliveBelow: 4, pattern: "spread", spawns: [S("bigObama", 1, 1), S("obama", 2, 1), S("midget", 6), S("flyingMidget", 2)] }
      ],
      boss: { types: ["monster"], introDelay: 3 }
    },
    {
      id: 3,
      name: "Wave 3: The Final Audit",
      clearTickets: 50,
      maxAlive: 24,
      groups: [
        { at: 0, aliveBelow: null, pattern: "spread", spawns: [S("midget", 8), S("obama", 3)] },
        { at: 10, aliveBelow: 5, pattern: "cluster", spawns: [S("midget", 10, 1), S("bigObama", 1), S("flyingMidget", 3)] },
        { at: 22, aliveBelow: 5, pattern: "spread", spawns: [S("obama", 4, 1), S("midget", 8), S("bigObama", 1, 1)] },
        { at: 34, aliveBelow: 5, pattern: "spread", spawns: [S("midget", 10, 1), S("obama", 3, 1), S("bigObama", 2), S("flyingMidget", 4, 1)] }
      ],
      boss: { types: ["megaSproto", "hexAuditor"], introDelay: 3 }
    }
  ];
  var INTERMISSION_TIME = 15;
  var VICTORY_TICKETS = 150;
  var MAX_TIER = 10;
  var tierEnemyMult = (t) => Math.pow(1.15, t - 1);
  var ARENA_HP = { step: 1.18, knee: 7, lateStep: 1.1 };
  var tierArenaHpMult = (t) => Math.pow(ARENA_HP.step, Math.min(t, ARENA_HP.knee) - 1) * Math.pow(ARENA_HP.lateStep, Math.max(0, t - ARENA_HP.knee));
  var SECOND_WIND = { step: 3, min: 3 };
  var secondWindTime = (base, downs) => Math.max(SECOND_WIND.min, base - SECOND_WIND.step * downs);
  var WAVE_SPELLS = ["chainZap", "swarm", "manaShield", "meteor"];
  function nextWaveSpell(unlocks, tier) {
    const pool = tier >= 2 ? WAVE_SPELLS : WAVE_SPELLS.slice(0, 2);
    for (const id of pool) if (!unlocks || !unlocks[id]) return id;
    return null;
  }
  var tierExtraElites = (tier, gi = 0) => Math.floor((tier - (tier >= 7 && gi % 2 === 0 ? 2 : 1)) / 2);
  var tierExtraAlive = (tier) => tier >= 8 ? 4 : tier >= 4 ? 2 : 0;
  var WAVE2_BOSSES = ["carMonster", "moleMonster", "monster"];
  var LATE_BOSS_HP = 0.7;
  var tierWaveCache = /* @__PURE__ */ new Map();
  function tierWave(index, tier = 1) {
    const base = WAVES[index];
    if (!base || !(tier > 1)) return base;
    const key2 = index * 100 + tier;
    if (tierWaveCache.has(key2)) return tierWaveCache.get(key2);
    const robots = tier >= 4 && index >= 1;
    let shooters = robots ? 1 : 0;
    const groups = base.groups.map((g, gi) => {
      const spawns = [];
      for (const s of g.spawns) {
        if (robots && s.type === "obama" && s.count >= 2) {
          const lasers = Math.floor(s.count / 2);
          const keepElites = Math.min(s.count - lasers, s.elites);
          spawns.push(S("obama", s.count - lasers, keepElites), S("robotLaser", lasers, s.elites - keepElites));
        } else if (shooters > 0 && s.type === "bigObama") {
          shooters--;
          if (s.count > 1) spawns.push(S("bigObama", s.count - 1, Math.min(s.count - 1, s.elites)));
          spawns.push(S("robotShooter", 1, s.count > 1 ? 0 : s.elites));
        } else spawns.push(S(s.type, s.count, s.elites));
      }
      let left = tierExtraElites(tier, gi);
      for (const s of spawns) {
        const add3 = Math.min(left, s.count - s.elites);
        s.elites += add3;
        left -= add3;
      }
      return { ...g, spawns };
    });
    let types = base.boss.types;
    if (index === 1 && tier >= 4) types = [WAVE2_BOSSES[(tier - 4) % WAVE2_BOSSES.length]];
    const late = index === WAVES.length - 1 && tier >= 7 ? ["sprotoBeast"] : [];
    const out = { ...base, maxAlive: base.maxAlive + tierExtraAlive(tier), groups, boss: { ...base.boss, types, late, lateHp: LATE_BOSS_HP } };
    tierWaveCache.set(key2, out);
    return out;
  }
  var tierRewardMult = (t) => 1 + 0.1 * (t - 1);

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
  var LEGENDARY_SLOT = 4;
  var SLOT_COUNT = 5;
  var slotUsable = (p, i) => i === LEGENDARY_SLOT || i >= 0 && i < p.unlockedSlots;
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
  var NAME_BITS = {
    mg: ["Brrrt-o-Matic", "Spray Sprout", "Bullet Hose", "Rattler"],
    shotgun: ["Boomstick", "Door Knocker", "Pellet Party", "Splatterer"],
    sniper: ["Long Boi", "Pokey Stick", "Eyeball", "Far Bonker"],
    bazooka: ["Big Yeet", "Kaboomer", "Rocket Pal", "Sky Mail"],
    raygun: ["Zapper", "Beam Buddy", "Ray-o-Matic", "Laser Lad"],
    bigbullets: ["Hand Cannon", "Chonker", "Big Bertha", "Thumper"],
    duckgun: ["Quackinator", "Bath Time", "Quack Attack", "Rubber Ruckus"],
    element: { none: ["", "Trusty", "Basic"], fire: ["Spicy", "Toasty", "Hot"], shock: ["Zappy", "Buzzy", "Static"], goo: ["Gloopy", "Sticky", "Slimy"] }
  };
  var byId = (arr) => Object.fromEntries(arr.map((x) => [x.id, x]));
  var GUN_TYPES_BY_ID = byId(GUN_TYPES);
  var QUALITIES_BY_ID = byId(QUALITIES);
  var MANUFACTURERS_BY_ID = byId(MANUFACTURERS);
  var PARTS_BY_ID = byId(PARTS);
  var ELEMENTS_BY_ID = byId(ELEMENTS);
  var WACKY_BY_ID = byId(WACKY);
  var SCOPE_ZOOM2 = 1 / 3;
  function gunRange(gun) {
    const r = GUN_TYPES_BY_ID[gun.type] && GUN_TYPES_BY_ID[gun.type].range || { full: 999, max: 999, min: 1 };
    const k = gun.parts && gun.parts.barrel === "long" ? 1.2 : gun.parts && gun.parts.barrel === "short" ? 0.85 : 1;
    return { full: r.full * k, max: r.max * k, min: r.min };
  }
  function rangeFalloff(range2, d) {
    if (d > range2.max) return 0;
    if (d <= range2.full) return 1;
    return 1 + (range2.min - 1) * ((d - range2.full) / Math.max(1e-6, range2.max - range2.full));
  }
  var hasInfiniteReserve = (gun) => !!(gun && GUN_TYPES_BY_ID[gun.type] && GUN_TYPES_BY_ID[gun.type].infiniteReserve);
  var PARTS_BY_SLOT = Object.fromEntries(SLOTS.map((s) => [s, PARTS.filter((p) => p.slot === s)]));
  var STAT_KEYS = ["damage", "fireRate", "spread", "magSize", "reloadTime", "projectileSpeed", "critMult", "elementChance"];

  // src/data/shop.js
  var SHOP = {
    offerCount: 4,
    basePrice: { mg: 25, shotgun: 45, sniper: 45, bazooka: 90, raygun: 150, bigbullets: 170, duckgun: 200 },
    sellBase: 8,
    typePremium: { mg: 1, shotgun: 1.5, sniper: 1.5, bazooka: 2.5, raygun: 3, bigbullets: 3.5, duckgun: 4 },
    rerollBase: 10,
    rerollStep: 5,
    vendPrice: 35,
    vendOutcomes: [
      { id: "gun", weight: 55 },
      { id: "resources", weight: 30 },
      { id: "jackpot", weight: 10 },
      { id: "chicken", weight: 5 }
    ],
    upgrades: [
      { id: "ammoCap", name: "Ammo Cap +25%", prices: [40, 80, 120] },
      { id: "shieldCap", name: "Shield Cap +25", prices: [50, 100, 150] },
      { id: "slot4", name: "4th Gun Slot", prices: [100] }
    ],
    supplies: [
      { id: "ammoRefill", name: "Ammo Refill", price: 30 },
      { id: "medkit", name: "Medkit", price: 20 }
    ]
  };

  // src/sim/guns.js
  var ELEMENTS_NO_NONE = ELEMENTS.filter((e) => e.id !== "none");
  var levelMult = (level) => Math.pow(1.13, level - 1);
  function applyMods(s, def) {
    for (const [k, m] of Object.entries(def.mods || {})) if (k in s) s[k] *= m;
    for (const [k, a] of Object.entries(def.add || {})) if (k in s) s[k] += a;
  }
  function shuffle4(r) {
    const a = SLOTS.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(float(r) * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function clampStats(s) {
    s.fireRate = Math.max(0.2, s.fireRate);
    s.spread = Math.max(0, s.spread);
    s.adsSpread = Math.max(0, s.adsSpread);
    s.magSize = Math.max(1, Math.round(s.magSize));
    s.reloadTime = Math.max(0.3, s.reloadTime);
    s.elementChance = Math.min(1, Math.max(0, s.elementChance));
    s.critChance = Math.min(0.6, Math.max(0, s.critChance));
  }
  function roundStats(s) {
    for (const k of Object.keys(s)) {
      if (k === "magSize" || k === "pellets" || k === "pierce") s[k] = Math.round(s[k]);
      else s[k] = Math.round(s[k] * 1e3) / 1e3;
    }
  }
  function applyReroll(s, rr, seed) {
    const r = createRng((seed ^ rr.salt) >>> 0);
    const m = range(r, 0.92, 1.18);
    if (rr.stat === "spread" || rr.stat === "reloadTime") s[rr.stat] /= m;
    else s[rr.stat] *= m;
  }
  function makeName(type, man, element, nameDraws) {
    const typeBits = NAME_BITS[type];
    const elBits = NAME_BITS.element[element];
    const el = elBits[Math.floor(nameDraws[0] * elBits.length)];
    const noun = typeBits[Math.floor(nameDraws[1] * typeBits.length)];
    return [man.name, el, noun].filter(Boolean).join(" ");
  }
  function generateGun({ seed, level = 1, forced = {}, arcane = false, rerolls = [] }) {
    const r = createRng(seed >>> 0);
    const dType = weighted(r, GUN_TYPES);
    const dQual = weighted(r, QUALITIES);
    const dMan = weighted(r, MANUFACTURERS);
    const slotOrder = shuffle4(r);
    const partDraws = SLOTS.map(() => float(r));
    const dElem = weighted(r, ELEMENTS);
    const dElemAlt = weighted(r, ELEMENTS_NO_NONE);
    const dWacky = float(r);
    const jitter = STAT_KEYS.map(() => range(r, -0.05, 0.05));
    const nameDraws = [float(r), float(r)];
    const type = forced.type ?? dType.id;
    const quality = GUN_TYPES_BY_ID[type].legendaryOnly ? "legendary" : forced.quality ?? dQual.id;
    const man = MANUFACTURERS_BY_ID[forced.manufacturer ?? dMan.id];
    const q2 = QUALITIES_BY_ID[quality];
    const parts = { barrel: "stock", grip: "stock", mag: "stock", scope: "stock" };
    for (let i = 0; i < q2.partSlots; i++) {
      const slot = slotOrder[i];
      const opts = PARTS_BY_SLOT[slot];
      parts[slot] = opts[Math.floor(partDraws[SLOTS.indexOf(slot)] * opts.length)].id;
    }
    if (forced.parts) Object.assign(parts, forced.parts);
    if (forced.part) parts[forced.part.slot] = forced.part.id;
    const element = forced.element ?? (man.alwaysElement && dElem.id === "none" ? dElemAlt.id : dElem.id);
    let wacky = null;
    if (quality === "legendary") {
      const pool = WACKY.filter((w) => w.allowedTypes.includes(type)).map((w) => ({ ...w, weight: 1 }));
      wacky = forced.wacky ?? pickWeightedByFloat(pool, dWacky).id;
    }
    const def = GUN_TYPES_BY_ID[type];
    const s = { ...def.base };
    applyMods(s, man);
    for (const slot of SLOTS) if (parts[slot] !== "stock") applyMods(s, PARTS_BY_ID[parts[slot]]);
    const lm = levelMult(level);
    s.damage *= q2.damageMult * lm;
    if (s.splashDamage) s.splashDamage *= q2.damageMult * lm;
    s.magSize = s.magSize * q2.magMult;
    s.reloadTime *= q2.reloadMult;
    s.spread *= q2.spreadMult;
    s.adsSpread *= q2.spreadMult;
    STAT_KEYS.forEach((k, i) => {
      if (k in s) s[k] *= 1 + jitter[i];
    });
    if (def.base.projectileSpeed === 0) s.projectileSpeed = 0;
    if (element === "none") s.elementChance = 0;
    if (arcane && element !== "none") s.elementChance += 0.2;
    for (const rr of rerolls) applyReroll(s, rr, seed);
    clampStats(s);
    roundStats(s);
    return {
      id: 0,
      seed: seed >>> 0,
      level,
      type,
      quality,
      manufacturer: man.id,
      element,
      parts,
      wacky,
      arcane,
      rerolls,
      name: makeName(type, man, element, nameDraws),
      ammoType: def.ammoType,
      stats: s,
      ammoInMag: s.magSize,
      source: "drop"
    };
  }
  function effectiveGunStats(gun, player) {
    const s = gun.stats;
    const gs = player.skills.gunslinger.level;
    const stacks = player.buffs.killFrenzy.stacks;
    const mv = player.move.mode;
    let movePenalty = 1;
    if (!player.onGround) movePenalty = 2;
    else if (mv === "slide") movePenalty = 0.8;
    else if (Math.hypot(player.vel.x, player.vel.z) > 1) movePenalty = 1.4;
    const skillMult = Math.max(0.4, 1 - 0.04 * (gs - 1));
    return {
      ...s,
      damage: s.damage * (1 + 0.03 * stacks),
      splashDamage: s.splashDamage * (1 + 0.03 * stacks),
      fireRate: s.fireRate * (1 + 0.04 * stacks),
      spread: (player.zooming ? s.adsSpread : s.spread) * movePenalty * skillMult,
      recoil: s.recoil * skillMult,
      recoilYaw: s.recoilYaw * skillMult,
      reloadTime: s.reloadTime * (1 - 0.03 * (gs - 1)),
      swapTime: player.perks.fastHands ? 0.2 : s.swapTime,
      critMult: s.critMult + (player.perks.deadeye ? 0.5 : 0),
      ammoSaveChance: player.perks.bottomlessMags ? 0.15 : 0
    };
  }
  function sellValue(gun) {
    const q2 = QUALITIES_BY_ID[gun.quality];
    return Math.round(SHOP.sellBase * q2.sellMult * SHOP.typePremium[gun.type] * (1 + 0.1 * (gun.level - 1)));
  }
  function shopPrice(gun, tier) {
    const q2 = QUALITIES_BY_ID[gun.quality];
    return Math.round(SHOP.basePrice[gun.type] * q2.priceMult * (1 + 0.15 * (tier - 1)));
  }

  // src/sim/state.js
  var nextId = (state) => state.nextId++;
  function createGameState({ seed = 12345, mode = "sandbox", tier = 1 } = {}) {
    const state = {
      version: 1,
      seed,
      rng: createRng(seed),
      tick: 0,
      time: 0,
      nextId: 1,
      mode,
      tier,
      localPlayerId: 0,
      players: {},
      enemies: [],
      allies: [],
      projectiles: [],
      pickups: [],
      hazards: [],
      weaponBoxes: [],
      spawnPoints: [],
      wave: null,
      shop: { offers: [], rerolls: 0, upgrades: { ammoCap: 0, shieldCap: 0, slot4: false } },
      run: newRunStats(),
      tuning: { godMode: false, enemyHpMult: 1, enemyDmgMult: 1, unlockAllRecipes: false, infiniteAmmo: false, freezeEnemies: false },
      events: []
    };
    for (let i = 0; i < TUNING.spawnPointCount; i++) {
      const a = i / TUNING.spawnPointCount * Math.PI * 2;
      state.spawnPoints.push({ x: Math.cos(a) * TUNING.spawnRadius, z: Math.sin(a) * TUNING.spawnRadius });
    }
    const p = createPlayer(state, mode === "sandbox" ? 4 : 3);
    state.players[p.id] = p;
    state.localPlayerId = p.id;
    return state;
  }
  function newRunStats() {
    return {
      kills: 0,
      eliteKills: 0,
      bossKills: 0,
      damageDealt: 0,
      damageTaken: 0,
      bestHit: 0,
      crits: 0,
      weakHits: 0,
      ticketsEarned: 0,
      gunsFound: 0,
      crafts: 0,
      xpGained: { health: 0, gunslinger: 0 },
      time: 0
    };
  }
  function createPlayer(state, slots = 4) {
    const id = nextId(state);
    const start2 = generateGun({ seed: 12648430, level: 1, forced: { type: "mg", quality: "common", manufacturer: "reliable", element: "none" } });
    start2.id = nextId(state);
    start2.source = "start";
    const p = {
      id,
      kind: "player",
      pos: { x: 0, y: 0, z: 8 },
      prevPos: { x: 0, y: 0, z: 8 },
      vel: { x: 0, y: 0, z: 0 },
      yaw: 0,
      pitch: 0,
      onGround: true,
      jumpsLeft: 2,
      coyoteT: 0,
      jumpBufferT: 0,
      move: { mode: "walk", slideT: 0, slideCd: 0, dashT: 0, dashCd: 0, dashDir: { x: 0, z: 0 } },
      hp: TUNING.maxHp,
      maxHp: TUNING.maxHp,
      shield: TUNING.maxShield,
      maxShield: TUNING.maxShield,
      shieldDelayT: 0,
      mana: TUNING.maxMana,
      maxMana: TUNING.maxMana,
      invulnT: 0,
      downed: false,
      downedT: 0,
      dead: false,
      respawnT: 0,
      unkillableUsed: false,
      guns: [start2, null, null, null, null],
      unlockedSlots: slots,
      activeSlot: 0,
      // 5th = legendary slot (key L)
      swapT: 0,
      reloadT: 0,
      fireCd: 0,
      zooming: false,
      recoil: { pitch: 0, yaw: 0, heat: 0 },
      shotCounter: 0,
      ammo: { ...TUNING.startAmmo },
      ammoCap: { ...TUNING.ammoCap },
      medkits: 1,
      medkitT: 0,
      tickets: 0,
      skills: { health: sk(), gunslinger: sk() },
      perks: {},
      spellUnlocks: state.mode === "campaign" ? {} : { gooBolt: true },
      spells: { cd: { gooBolt: 0, chainZap: 0, swarm: 0, manaShield: 0, meteor: 0 }, manaShieldOn: false },
      buffs: { killFrenzy: { stacks: 0, t: 0 } },
      lastDamageT: 99,
      lifestealBudget: 4,
      xpCaps: { dmg: 0, weak: 0 },
      interactBoxId: null,
      nearGunPickupId: null
    };
    for (const perk of PERKS) if (perk.level === 1) p.perks[perk.id] = true;
    if (p.spellUnlocks.gooBolt) p.perks.gooBolt = true;
    return p;
  }
  var sk = () => ({ level: 1, xp: 0, total: 0 });
  var ladderMode = (state) => state.mode === "waves" || state.mode === "boss";
  function createEnemy(state, type, { tier = state.tier, elite = false, pos = { x: 0, z: 0 }, summoned = false } = {}) {
    const def = ENEMIES[type];
    const tm = tierEnemyMult(tier);
    const e = {
      id: nextId(state),
      kind: "enemy",
      type,
      faction: "enemy",
      pos: { x: pos.x, y: 0, z: pos.z },
      prevPos: { x: pos.x, y: 0, z: pos.z },
      vel: { x: 0, y: 0, z: 0 },
      yaw: Math.atan2(pos.x, pos.z),
      // face roughly center
      radius: def.radius,
      height: def.height,
      scale: elite ? ELITE.scale : 1,
      hp: 0,
      maxHp: 0,
      dmgMult: tm * (elite ? ELITE.dmgMult : 1),
      speedMult: elite ? ELITE.speedMult : 1,
      tier,
      elite,
      affinity: { ...def.affinity },
      state: type === "dummy" ? "idle" : "spawning",
      stateT: 0,
      attack: { phase: "windup", t: 0, hasHit: false, cd: 0 },
      poise: 0,
      poiseMax: def.poiseMax * (elite ? ELITE.poiseMult : 1),
      status: { burn: null, goo: null, burnTick: 0 },
      ai: { strafeDir: 1, strafeT: 2, hopT: 1, airborne: false, regenT: 0 },
      lastHit: null,
      dead: false,
      boss: null,
      summoned,
      bigHeadT: 0,
      hitFlash: 0
    };
    const hm = ladderMode(state) ? tierArenaHpMult(tier) : tm;
    e.maxHp = Math.round(def.hp * hm * (elite ? ELITE.hpMult : 1) * state.tuning.enemyHpMult);
    e.hp = e.maxHp;
    if (def.archetype && def.archetype.audit) e.ai.audit = true;
    if (def.armour) e.ai.armour = "hard";
    if (elite) {
      const resist = pick(state.rng, AFFINITY_POOL);
      const weaks = AFFINITY_POOL.filter((a) => a !== resist);
      e.affinity = { resist, weak: weaks[Math.floor(float(state.rng) * weaks.length)] };
    }
    state.enemies.push(e);
    return e;
  }
  function createBoss(state, type, { tier = state.tier, pos = { x: 0, z: -15 }, paired = false } = {}) {
    const def = BOSSES[type];
    const tm = tierEnemyMult(tier);
    const e = {
      id: nextId(state),
      kind: "enemy",
      type,
      faction: "enemy",
      pos: { x: pos.x, y: def.hoverY || 0, z: pos.z },
      prevPos: { x: pos.x, y: def.hoverY || 0, z: pos.z },
      vel: { x: 0, y: 0, z: 0 },
      yaw: 0,
      radius: def.radius,
      height: def.height,
      scale: 1,
      hp: 0,
      maxHp: 0,
      dmgMult: tm,
      speedMult: 1,
      tier,
      elite: false,
      affinity: { resist: null, weak: null },
      state: "boss",
      stateT: 0,
      attack: { phase: "windup", t: 0, hasHit: false, cd: 0 },
      poise: 0,
      poiseMax: 1e9,
      status: { burn: null, goo: null, burnTick: 0 },
      ai: {},
      lastHit: null,
      dead: false,
      summoned: false,
      bigHeadT: 0,
      hitFlash: 0,
      boss: {
        bossType: type,
        tag: def.tag,
        phaseIdx: 0,
        transitioning: false,
        invuln: false,
        action: { id: "intro", t: 0, data: {} },
        patternIdx: 0,
        weakAngle: 0,
        summonT: 0,
        manaOrbNext: 0.9,
        paired,
        fade: 1
      }
    };
    const hm = ladderMode(state) ? tierArenaHpMult(tier) : tm;
    e.maxHp = Math.round(def.hp * hm * (paired ? 0.85 : 1) * state.tuning.enemyHpMult);
    e.hp = e.maxHp;
    state.enemies.push(e);
    return e;
  }
  function createProjectile(state, o) {
    const p = {
      id: nextId(state),
      kind: "rocket",
      faction: "player",
      ownerId: 0,
      gunId: null,
      sourceKind: "gun",
      pos: { x: 0, y: 0, z: 0 },
      prevPos: { x: 0, y: 0, z: 0 },
      vel: { x: 0, y: 0, z: 0 },
      radius: 0.15,
      gravity: 0,
      damage: 0,
      element: "none",
      elementChance: 0,
      arcane: false,
      splash: null,
      ttl: 5,
      bounces: 0,
      pierce: 0,
      homing: 0,
      hitIds: {},
      critMult: 2,
      critChance: 0,
      wacky: null,
      dead: false,
      ...o
    };
    p.prevPos = { ...p.pos };
    state.projectiles.push(p);
    return p;
  }
  function createPickup(state, o) {
    const p = {
      id: nextId(state),
      kind: "health",
      pos: { x: 0, y: 0.5, z: 0 },
      prevPos: { x: 0, y: 0.5, z: 0 },
      vel: { x: 0, y: 0, z: 0 },
      amount: 0,
      ammoType: null,
      resId: null,
      gun: null,
      ttl: TUNING.pickupTtl,
      age: 0,
      magnetized: false,
      dead: false,
      ...o
    };
    p.prevPos = { ...p.pos };
    state.pickups.push(p);
    return p;
  }
  function createHazard(state, o) {
    const h = {
      id: nextId(state),
      kind: "shockwave",
      pos: { x: 0, y: 0, z: 0 },
      radius: 0,
      maxRadius: 0,
      speed: 0,
      height: 0.6,
      t: 0,
      ttl: 1,
      ownerId: 0,
      damage: 0,
      hitIds: {},
      data: {},
      dead: false,
      ...o
    };
    state.hazards.push(h);
    return h;
  }

  // src/data/drops.js
  var DROP_TABLES = {
    midget: [
      { kind: "resource", resId: "scrap", min: 1, max: 3, chance: 1 },
      { kind: "resource", resId: "springs", min: 1, max: 2, chance: 1 },
      { kind: "health", chance: 0.08 },
      { kind: "ammo", chance: 0.4 },
      { kind: "gun", chance: 0.02, table: "enemyGun" },
      { kind: "tickets", min: 1, max: 1, chance: 1 }
    ],
    flyingMidget: [
      { kind: "resource", resId: "scrap", min: 1, max: 2, chance: 1 },
      { kind: "resource", resId: "springs", min: 2, max: 3, chance: 1 },
      { kind: "health", chance: 0.1 },
      { kind: "ammo", chance: 0.5 },
      { kind: "gun", chance: 0.04, table: "enemyGun" },
      { kind: "tickets", min: 2, max: 2, chance: 1 }
    ],
    obama: [
      { kind: "resource", resId: "scrap", min: 3, max: 5, chance: 1 },
      { kind: "resource", resId: "goo", min: 2, max: 3, chance: 1 },
      { kind: "health", chance: 0.18 },
      { kind: "ammo", chance: 0.7 },
      { kind: "gun", chance: 0.06, table: "enemyGun" },
      { kind: "tickets", min: 2, max: 2, chance: 1 }
    ],
    bigObama: [
      { kind: "resource", resId: "scrap", min: 5, max: 8, chance: 1 },
      { kind: "resource", resId: "plating", min: 3, max: 5, chance: 1 },
      { kind: "health", chance: 0.25 },
      { kind: "ammo", chance: 0.85 },
      { kind: "gun", chance: 0.1, table: "enemyGun" },
      { kind: "tickets", min: 4, max: 4, chance: 1 }
    ],
    dummy: [],
    carMonster: [
      { kind: "resource", resId: "scrap", min: 25, max: 25, chance: 1 },
      { kind: "resource", resId: "bossCore", min: 1, max: 1, chance: 1, noScale: true },
      { kind: "bigHealth", count: 2, chance: 1 },
      { kind: "ammo", count: 3, chance: 1 },
      { kind: "gun", count: 2, chance: 1, table: "boss" },
      { kind: "bossGun", chance: 1, table: "boss", arena: { chance: 0.5, shift: 0 } },
      // a Ray Gun or Big Bullets
      { kind: "tickets", min: 60, max: 60, chance: 1 }
    ],
    moleMonster: [
      { kind: "resource", resId: "scrap", min: 25, max: 25, chance: 1 },
      { kind: "resource", resId: "bossCore", min: 1, max: 1, chance: 1, noScale: true },
      { kind: "bigHealth", count: 2, chance: 1 },
      { kind: "ammo", count: 3, chance: 1 },
      { kind: "gun", count: 2, chance: 1, table: "boss" },
      { kind: "bossGun", chance: 1, table: "boss", arena: { chance: 0.5, shift: 0 } },
      // a Ray Gun or Big Bullets
      { kind: "tickets", min: 60, max: 60, chance: 1 }
    ],
    robotLaser: [
      { kind: "resource", resId: "scrap", min: 3, max: 5, chance: 1 },
      { kind: "resource", resId: "goo", min: 2, max: 3, chance: 1 },
      { kind: "health", chance: 0.18 },
      { kind: "ammo", chance: 0.7 },
      { kind: "gun", chance: 0.06, table: "enemyGun" },
      { kind: "tickets", min: 2, max: 2, chance: 1 }
    ],
    robotShooter: [
      { kind: "resource", resId: "scrap", min: 5, max: 8, chance: 1 },
      { kind: "resource", resId: "plating", min: 3, max: 5, chance: 1 },
      { kind: "health", chance: 0.25 },
      { kind: "ammo", chance: 0.85 },
      { kind: "gun", chance: 0.1, table: "enemyGun" },
      { kind: "tickets", min: 4, max: 4, chance: 1 }
    ],
    megaSproto: [
      { kind: "resource", resId: "scrap", min: 25, max: 25, chance: 1 },
      { kind: "resource", resId: "bossCore", min: 1, max: 1, chance: 1, noScale: true },
      { kind: "bigHealth", count: 2, chance: 1 },
      { kind: "ammo", count: 3, chance: 1 },
      { kind: "gun", count: 2, chance: 1, table: "boss" },
      { kind: "bossGun", chance: 1, table: "boss", arena: { chance: 0.5, shift: 0 } },
      // a Ray Gun or Big Bullets
      { kind: "tickets", min: 60, max: 60, chance: 1 }
    ],
    monster: [
      { kind: "resource", resId: "scrap", min: 25, max: 25, chance: 1 },
      { kind: "resource", resId: "bossCore", min: 1, max: 1, chance: 1, noScale: true },
      { kind: "bigHealth", count: 2, chance: 1 },
      { kind: "ammo", count: 3, chance: 1 },
      { kind: "gun", count: 2, chance: 1, table: "boss" },
      { kind: "bossGun", chance: 1, table: "boss", arena: { chance: 0.5, shift: 0 } },
      // a Ray Gun or Big Bullets
      { kind: "tickets", min: 60, max: 60, chance: 1 }
    ],
    sprotoBeast: [
      { kind: "resource", resId: "scrap", min: 25, max: 25, chance: 1 },
      { kind: "resource", resId: "bossCore", min: 1, max: 1, chance: 1, noScale: true },
      { kind: "bigHealth", count: 2, chance: 1 },
      { kind: "ammo", count: 3, chance: 1 },
      { kind: "gun", count: 2, chance: 1, table: "boss" },
      { kind: "bossGun", chance: 1, table: "boss", arena: { chance: 0.5, shift: 0 } },
      // a Ray Gun or Big Bullets
      { kind: "tickets", min: 60, max: 60, chance: 1 }
    ],
    dragon: [
      { kind: "resource", resId: "scrap", min: 20, max: 20, chance: 1 },
      { kind: "resource", resId: "bossCore", min: 1, max: 1, chance: 1, noScale: true },
      { kind: "bigHealth", count: 2, chance: 1 },
      { kind: "ammo", count: 3, chance: 1 },
      { kind: "gun", count: 1, chance: 1, table: "boss", arena: { count: 2 } },
      { kind: "bossGun", chance: 1, table: "boss", arena: { chance: 0.25, shift: 0 } },
      // a Ray Gun or Big Bullets
      { kind: "tickets", min: 45, max: 45, chance: 1 }
    ],
    hexAuditor: [
      { kind: "resource", resId: "scrap", min: 20, max: 20, chance: 1 },
      { kind: "resource", resId: "bossCore", min: 1, max: 1, chance: 1, noScale: true },
      { kind: "resource", resId: "manaCrystal", min: 2, max: 2, chance: 1, noScale: true },
      { kind: "bigHealth", count: 2, chance: 1 },
      { kind: "ammo", count: 3, chance: 1 },
      { kind: "gun", count: 2, chance: 1, table: "boss" },
      { kind: "bossGun", chance: 1, table: "boss", arena: { chance: 0.5, shift: 0 } },
      // a Ray Gun or Big Bullets
      { kind: "tickets", min: 60, max: 60, chance: 1 }
    ]
  };
  for (const id of Object.keys(DROP_TABLES)) {
    DROP_TABLES[id] = DROP_TABLES[id].filter((entry) => entry.kind !== "resource");
  }
  var QUALITY_TABLES = {
    enemyGun: [55, 27, 12, 5, 1],
    boss: [0, 0, 40, 35, 25],
    shop: [35, 35, 20, 9, 1],
    vending: [40, 30, 18, 9, 3]
  };
  var RESOURCES = [
    { id: "scrap", name: "Scrap", color: "#b8b8b8", icon: "\u2699" },
    { id: "springs", name: "Springs", color: "#ff5ec4", icon: "\u27B0" },
    // from Midgets
    { id: "goo", name: "Goo", color: "#7fd34e", icon: "\u25CF" },
    // from Bitcoin Obamas
    { id: "plating", name: "Plating", color: "#6a7bd1", icon: "\u25A3" },
    // from Big Bitcoin Obamas
    { id: "bossCore", name: "Boss Core", color: "#ff3b3b", icon: "\u25C6" },
    { id: "manaCrystal", name: "Mana Crystal", color: "#b07cff", icon: "\u2726" }
  ];
  var RES_IDS = RESOURCES.map((r) => r.id);

  // src/sim/drops.js
  function rollQuality(rng, tableId, shift2 = 0) {
    const w = QUALITY_TABLES[tableId];
    const q2 = weighted(rng, QUALITIES.map((qq, i) => ({ id: qq.id, idx: i, weight: w[i] })));
    return QUALITIES[Math.min(4, q2.idx + shift2)].id;
  }
  function rollGunType(rng) {
    return weighted(rng, GUN_TYPES).id;
  }
  var BOSS_WEAPON_DROP = { kind: "bossGun", chance: 1, table: "boss" };
  function rollDrops(rng, tableId, ctx = {}) {
    let table = DROP_TABLES[tableId] || [];
    if (ctx.boss && !table.some((e) => e.kind === "bossGun")) table = [...table, BOSS_WEAPON_DROP];
    const tierM = 1 + 0.1 * ((ctx.tier || 1) - 1);
    const eliteM = ctx.elite ? ELITE.dropMult : 1;
    const out = [];
    for (const base of table) {
      const entry = ctx.arena && base.arena ? { ...base, ...base.arena } : base;
      let chance = entry.chance;
      if (entry.kind === "gun" && ctx.elite) chance = Math.min(0.6, chance * ELITE.gunMult);
      if (ctx.summoned && entry.kind === "gun") chance *= 0.25;
      const roll = float(rng);
      if (roll >= chance) continue;
      const count = entry.count || 1;
      for (let c = 0; c < count; c++) {
        switch (entry.kind) {
          case "resource": {
            const base2 = int(rng, entry.min, entry.max);
            const amt = entry.noScale ? base2 : Math.round(base2 * tierM * eliteM);
            out.push({ kind: "resource", resId: entry.resId, amount: amt });
            break;
          }
          case "tickets": {
            const base2 = int(rng, entry.min, entry.max);
            out.push({ kind: "tickets", amount: Math.round(base2 * tierM * eliteM) });
            break;
          }
          case "health":
            out.push({ kind: "health", amount: TUNING.healthOrb });
            break;
          case "bigHealth":
            out.push({ kind: "bigHealth", amount: TUNING.bigOrb });
            break;
          case "ammo": {
            const types = ctx.playerGunTypes && ctx.playerGunTypes.length ? ctx.playerGunTypes : ["bullets"];
            const t = types[Math.floor(float(rng) * types.length)];
            if (t) out.push({ kind: "ammo", ammoType: t, amount: TUNING.ammoDrop[t] });
            break;
          }
          case "gun": {
            const shift2 = ctx.elite && float(rng) < 0.5 ? 1 : 0;
            const quality = rollQuality(rng, entry.table, shift2);
            const type = rollGunType(rng);
            out.push({ kind: "gun", type, quality, seed: next(rng), level: ctx.tier || 1 });
            break;
          }
          case "bossGun": {
            const type = BOSS_GUN_TYPES[Math.min(BOSS_GUN_TYPES.length - 1, Math.floor(float(rng) * BOSS_GUN_TYPES.length))];
            const quality = rollQuality(rng, entry.table, entry.shift ?? 1);
            out.push({ kind: "gun", type, quality, seed: next(rng), level: ctx.tier || 1, source: "boss" });
            break;
          }
        }
      }
    }
    return out;
  }
  function spawnDrops(state, specs, pos) {
    for (const s of specs) {
      const a = range(state.rng, 0, Math.PI * 2);
      const sp = range(state.rng, 2, 4.5);
      const vel = { x: Math.cos(a) * sp, y: range(state.rng, 4, 7), z: Math.sin(a) * sp };
      const base = { pos: { x: pos.x, y: Math.max(0.5, pos.y), z: pos.z }, vel };
      if (s.kind === "gun") {
        const gun = generateGun({ seed: s.seed, level: s.level, forced: { type: s.type, quality: s.quality } });
        gun.id = nextId(state);
        gun.source = s.source || "drop";
        createPickup(state, { ...base, kind: "gun", gun, ttl: TUNING.gunPickupTtl, vel: { x: vel.x * 0.5, y: 6, z: vel.z * 0.5 } });
        state.run.gunsFound++;
      } else {
        createPickup(state, { ...base, kind: s.kind, amount: s.amount, resId: s.resId || null, ammoType: s.ammoType || null });
      }
    }
  }
  function spawnGunPickup(state, gun, pos, source = "drop") {
    gun.id = gun.id || nextId(state);
    gun.source = source;
    return createPickup(state, { kind: "gun", gun, pos: { x: pos.x, y: 1, z: pos.z }, vel: { x: 0, y: 5, z: 0 }, ttl: TUNING.gunPickupTtl });
  }

  // src/sim/progression.js
  function addXp(state, p, skillId, amount) {
    if (amount <= 0) return;
    amount *= 1 + 0.1 * (state.tier - 1);
    const s = p.skills[skillId];
    if (s.level >= SKILLS[skillId].maxLevel) return;
    s.xp += amount;
    s.total += amount;
    state.run.xpGained[skillId] += amount;
    emit(state, "xpGain", { playerId: p.id, skill: skillId, amount });
    while (s.level < SKILLS[skillId].maxLevel && s.xp >= xpToNext(skillId, s.level, state.mode)) {
      s.xp -= xpToNext(skillId, s.level, state.mode);
      s.level++;
      emit(state, "levelUp", { playerId: p.id, skill: skillId, level: s.level });
      for (const perk of PERKS) {
        if (perk.skill === skillId && perk.level === s.level && !p.perks[perk.id]) {
          p.perks[perk.id] = true;
          emit(state, "perkUnlocked", { playerId: p.id, perkId: perk.id });
        }
      }
      applySkillPassives(state, p);
    }
    if (s.level >= SKILLS[skillId].maxLevel) s.xp = 0;
  }
  function applySkillPassives(state, p) {
    const h = p.skills.health.level;
    const newMaxHp = Math.round(TUNING.maxHp * (1 + 0.08 * (h - 1)));
    if (newMaxHp !== p.maxHp) {
      p.hp += newMaxHp - p.maxHp;
      p.maxHp = newMaxHp;
    }
    const up = state.shop.upgrades;
    p.maxShield = TUNING.maxShield + 25 * up.shieldCap;
    p.shield = Math.min(p.shield, p.maxShield);
    for (const k of Object.keys(p.ammoCap)) p.ammoCap[k] = Math.round(TUNING.ammoCap[k] * (1 + 0.25 * up.ammoCap));
  }
  function progression(state) {
    const n = state.events.length;
    for (let i = 0; i < n; i++) {
      const ev = state.events[i];
      switch (ev.type) {
        case "kill": {
          if (ev.isDummy) break;
          const p = state.players[ev.killerId] || state.players[state.localPlayerId];
          if (!p) break;
          const em = ev.elite ? 3 : 1;
          addXp(state, p, "health", XP.health.kill * em);
          if (ev.sourceKind === "gun" || ev.sourceKind === "splash" && !ev.spell) {
            let g = XP.gunslinger.gunKill;
            if (ev.wasCrit) g += XP.gunslinger.critKill;
            if (ev.wasWeak) g += XP.gunslinger.weakKill;
            addXp(state, p, "gunslinger", g * em);
          }
          if (ev.bossTag === "physical") {
            addXp(state, p, "health", XP.health.physicalBoss);
            addXp(state, p, "gunslinger", XP.gunslinger.physicalBoss);
          }
          break;
        }
        case "damage": {
          const p = state.players[ev.sourceId];
          if (p && ev.isWeak && ev.sourceKind === "gun" && p.xpCaps.weak < 10) {
            p.xpCaps.weak += 1;
            addXp(state, p, "gunslinger", XP.gunslinger.weakHit);
          }
          break;
        }
        case "playerDamaged": {
          const p = state.players[ev.playerId];
          if (!p || ev.sourceKind === "self") break;
          const amt = Math.min(ev.amount * XP.health.perDamage, Math.max(0, 15 - p.xpCaps.dmg));
          p.xpCaps.dmg += amt;
          addXp(state, p, "health", amt);
          break;
        }
        case "pickup": {
          const p = state.players[ev.playerId];
          if (!p) break;
          if (ev.kind === "health") addXp(state, p, "health", XP.health.orb);
          if (ev.kind === "bigHealth") addXp(state, p, "health", XP.health.bigOrb);
          if (ev.kind === "medkit") addXp(state, p, "health", XP.health.medkit);
          break;
        }
        case "cast":
        case "craftComplete":
        case "salvage":
        case "reroll":
          break;
      }
    }
  }

  // src/sim/collision.js
  function clampToArena(ent, radius) {
    const r = Math.hypot(ent.pos.x, ent.pos.z);
    const maxR = ARENA_R - radius;
    if (r > maxR) {
      const nx = ent.pos.x / r, nz = ent.pos.z / r;
      ent.pos.x = nx * maxR;
      ent.pos.z = nz * maxR;
      const vr = ent.vel.x * nx + ent.vel.z * nz;
      if (vr > 0) {
        ent.vel.x -= nx * vr;
        ent.vel.z -= nz * vr;
      }
      return true;
    }
    return false;
  }
  function pushOutOfBoxes(state, ent, radius) {
    for (const b of state.weaponBoxes) {
      const dx = ent.pos.x - b.pos.x, dz = ent.pos.z - b.pos.z;
      const d = Math.hypot(dx, dz);
      const min = b.radius + radius;
      if (d < min && ent.pos.y < 1.2) {
        const nx = d > 1e-4 ? dx / d : 1, nz = d > 1e-4 ? dz / d : 0;
        ent.pos.x = b.pos.x + nx * min;
        ent.pos.z = b.pos.z + nz * min;
      }
    }
  }
  function raySphere(o, d, c, r) {
    const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
    const b = ox * d.x + oy * d.y + oz * d.z;
    const cc = ox * ox + oy * oy + oz * oz - r * r;
    const disc3 = b * b - cc;
    if (disc3 < 0) return -1;
    const s = Math.sqrt(disc3);
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
      const disc3 = B2 * B2 - A * C;
      if (disc3 >= 0) {
        const s = Math.sqrt(disc3);
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
  function distToCapsule(p, cx, cz, y0, y1, r) {
    const y = Math.max(y0 + r, Math.min(Math.max(y0 + r, y1 - r), p.y));
    return Math.max(0, Math.hypot(p.x - cx, p.y - y, p.z - cz) - r);
  }
  function entityDef(e) {
    return e.boss ? BOSSES[e.type] : ENEMIES[e.type];
  }
  function worldHitboxes(e, out = []) {
    out.length = 0;
    const def = entityDef(e);
    const sc = e.scale;
    const cy = Math.cos(e.yaw), sy = Math.sin(e.yaw);
    const toWorld = (lx, lz) => ({ x: e.pos.x + (-sy * lz + cy * lx), z: e.pos.z + (-cy * lz - sy * lx) });
    for (const hb of def.hitboxes) {
      if (hb.onlyWhen) {
        const bossWhen = !!(e.boss && e.boss.action && e.boss.action.id === hb.onlyWhen);
        const exposed = !!(e.ai && e.ai.exposed === hb.onlyWhen);
        if (!bossWhen && !exposed) continue;
      }
      let r = hb.r * sc;
      if (hb.zone === "weak" && e.bigHeadT > 0) r *= 1.8;
      if (hb.type === "capsule") {
        out.push({ type: "capsule", zone: hb.zone, x: e.pos.x, z: e.pos.z, y0: e.pos.y + hb.y0 * sc, y1: e.pos.y + hb.y1 * sc, r });
      } else if (hb.orbit) {
        const a = e.boss.weakAngle;
        out.push({ type: "sphere", zone: hb.zone, x: e.pos.x + Math.cos(a) * hb.orbit, y: e.pos.y + 0.2, z: e.pos.z + Math.sin(a) * hb.orbit, r });
      } else {
        const w = toWorld(hb.x * sc, hb.z * sc);
        out.push({ type: "sphere", zone: hb.zone, x: w.x, y: e.pos.y + hb.y * sc, z: w.z, r });
      }
    }
    return out;
  }
  var ZONE_PRI = { weak: 3, shield: 2, body: 1 };
  var _hbs = [];
  function boundCenter(e) {
    const def = entityDef(e);
    if (e.type === "hexAuditor") return { x: e.pos.x, y: e.pos.y, z: e.pos.z, r: 2.6 * e.scale };
    const h = def.height * e.scale;
    return { x: e.pos.x, y: e.pos.y + h / 2, z: e.pos.z, r: (h / 2 + def.radius * e.scale) * 1.6 };
  }
  function raycastEnemies(state, o, d, maxDist, ignore = null) {
    let best = null;
    for (const e of state.enemies) {
      if (e.dead || e.state === "spawning") continue;
      if (ignore && ignore[e.id]) continue;
      const bc = boundCenter(e);
      const tb = raySphere(o, d, bc, bc.r);
      if (tb < 0 || tb > maxDist + bc.r * 2) continue;
      worldHitboxes(e, _hbs);
      for (const hb of _hbs) {
        const t = hb.type === "sphere" ? raySphere(o, d, hb, hb.r) : rayCapsule(o, d, hb.x, hb.z, hb.y0, hb.y1, hb.r);
        if (t < 0 || t > maxDist) continue;
        if (!best || t < best.t - 0.05 || Math.abs(t - best.t) <= 0.05 && ZONE_PRI[hb.zone] > ZONE_PRI[best.zone]) {
          best = { e, t, zone: hb.zone, point: { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t } };
        }
      }
    }
    return best;
  }
  function rayWorld(o, d, maxDist) {
    let t = maxDist;
    if (d.y < -1e-4) t = Math.min(t, -o.y / d.y);
    return t;
  }
  function sphereHitsPlayer(c, r, p) {
    const top = p.pos.y + playerHeight(p);
    const y = Math.max(p.pos.y + TUNING.playerRadius, Math.min(top - TUNING.playerRadius, c.y));
    return Math.hypot(c.x - p.pos.x, c.y - y, c.z - p.pos.z) < r + TUNING.playerRadius;
  }
  function playerHeight(p) {
    if (p.downed) return 0.9;
    return p.move.mode === "slide" ? 1 : TUNING.playerHeight;
  }
  function eyePos(p) {
    const eye = p.downed ? TUNING.downedEye : p.move.mode === "slide" ? TUNING.slideEye : TUNING.eyeHeight;
    return { x: p.pos.x, y: p.pos.y + eye, z: p.pos.z };
  }

  // src/sim/campaign/archetypes.js
  function archetypeOf(e) {
    const def = ENEMIES[e.type];
    return def && def.archetype;
  }
  function sourceTakenMul(e, hit) {
    const def = ENEMIES[e.type];
    if (!def) return 1;
    if (hit.zone === "weak" && def.weakIgnoresArmour) return 1;
    const name = e.ai && e.ai.armour;
    const table = name && def.armour ? def.armour[name] : null;
    const spec = table || def.taken;
    if (!spec) return 1;
    const key2 = hit.sourceKind === "spell" ? "spell" : hit.isSplash || hit.sourceKind === "world" ? "explosive" : "bullet";
    return spec[key2] == null ? 1 : spec[key2];
  }
  function archetypeDamageMul(e, from) {
    const a = archetypeOf(e);
    let mul = e.ai && e.ai.bubble > 0 ? 0.5 : 1;
    if (a && a.frontShield && from) {
      const fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw);
      const dx = from.x - e.pos.x, dz = from.z - e.pos.z;
      if (fx * dx + fz * dz > 0) mul *= a.frontShield;
    }
    return mul;
  }
  function archetypeDeathBlast(e) {
    const a = archetypeOf(e);
    return a && a.deathBlast;
  }
  function tickArchetype(state, e, target, dt) {
    const a = archetypeOf(e);
    if (!a || !target) return;
    const ai = e.ai;
    if (a.fuse && !ai.detonate) {
      if (ai.fuseT == null) {
        const d = Math.hypot(target.pos.x - e.pos.x, target.pos.z - e.pos.z);
        if (d <= a.fuse.trigger && Math.abs(target.pos.y - e.pos.y) < 3) {
          ai.fuseT = a.fuse.delay;
          emit(state, "fuseLit", { id: e.id, pos: { ...e.pos }, delay: a.fuse.delay });
        }
      } else {
        ai.fuseT -= dt;
        if (ai.fuseT <= 0) ai.detonate = true;
      }
    }
    if (a.burrow) {
      ai.burrowCd = (ai.burrowCd == null ? a.burrow.every : ai.burrowCd) - dt;
      if (ai.burrowCd <= 0) {
        ai.burrowCd = a.burrow.every;
        ai.buried = a.burrow.duration;
      }
    }
    if (a.bubble) {
      ai.bubbleCd = (ai.bubbleCd == null ? a.bubble.every : ai.bubbleCd) - dt;
      if (ai.bubbleCd <= 0) {
        ai.bubbleCd = a.bubble.every;
        let best = null, bd = a.bubble.radius;
        for (const o of state.enemies) {
          if (o === e || o.dead) continue;
          const d = Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z);
          if (d < bd) {
            bd = d;
            best = o;
          }
        }
        if (best) best.ai.bubble = a.bubble.duration;
      }
    }
    if (a.mortar) {
      ai.mortarCd = (ai.mortarCd == null ? a.mortar.every : ai.mortarCd) - dt;
      if (ai.mortarCd <= 0) {
        ai.mortarCd = a.mortar.every;
        const dx = target.pos.x - e.pos.x, dz = target.pos.z - e.pos.z;
        const d = Math.hypot(dx, dz) || 1;
        createProjectile(state, {
          kind: "bullet",
          faction: "enemy",
          ownerId: e.id,
          sourceKind: "enemy",
          pos: { x: e.pos.x, y: e.pos.y + 1.4, z: e.pos.z },
          vel: { x: dx / d * a.mortar.speed, y: 8, z: dz / d * a.mortar.speed },
          gravity: 12,
          damage: a.mortar.damage,
          ttl: 2.5,
          radius: 0.25
        });
      }
    }
    if (a.charge) {
      ai.chargeCd = (ai.chargeCd == null ? a.charge.every : ai.chargeCd) - dt;
      if (ai.chargeLeft > 0) {
        ai.chargeLeft -= dt;
        const dx = target.pos.x - e.pos.x, dz = target.pos.z - e.pos.z;
        const d = Math.hypot(dx, dz) || 1;
        e.vel.x = dx / d * a.charge.speed;
        e.vel.z = dz / d * a.charge.speed;
      } else if (ai.chargeCd <= 0) {
        ai.chargeCd = a.charge.every;
        ai.chargeLeft = a.charge.duration;
      }
    }
    if (a.relocate) {
      ai.relocateCd = (ai.relocateCd == null ? a.relocate.every : ai.relocateCd) - dt;
      if (ai.relocateCd <= 0) {
        ai.relocateCd = a.relocate.every;
        const fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw);
        e.vel.x += fz * 8;
        e.vel.z += -fx * 8;
      }
    }
    if (a.turret) {
      e.vel.x *= 0.15;
      e.vel.z *= 0.15;
    }
    if (a.flock) {
      let sx = 0, sz = 0, n = 0;
      for (const o of state.enemies) {
        if (o === e || o.dead || o.type !== e.type) continue;
        sx += o.pos.x;
        sz += o.pos.z;
        n++;
      }
      if (n) {
        const dx = sx / n - e.pos.x, dz = sz / n - e.pos.z;
        e.vel.x += dx * 0.4 * dt;
        e.vel.z += dz * 0.4 * dt;
      }
    }
    if (a.bark && e.ai.armour !== "stripped") {
      e.ai.armour = e.status && e.status.goo ? "softened" : e.ai.armour === "softened" ? "hard" : e.ai.armour || "hard";
    }
    if (a.leech && target) {
      const d = Math.hypot(target.pos.x - e.pos.x, target.pos.z - e.pos.z);
      if (d < (a.leech.range || 10)) target.mana = Math.max(0, target.mana - (a.leech.drain || 8) * dt);
    }
    if (a.wisp && target) {
      e.ai.wispCd = (e.ai.wispCd == null ? a.wisp.every : e.ai.wispCd) - dt;
      if (e.ai.wispCd <= 0) {
        e.ai.wispCd = a.wisp.every;
        const dx = target.pos.x - e.pos.x, dz = target.pos.z - e.pos.z;
        const dist = Math.hypot(dx, dz) || 1;
        createProjectile(state, {
          kind: "bullet",
          faction: "enemy",
          ownerId: e.id,
          sourceKind: "enemy",
          pos: { x: e.pos.x, y: e.pos.y + 0.6, z: e.pos.z },
          vel: { x: dx / dist * a.wisp.speed, y: 0, z: dz / dist * a.wisp.speed },
          damage: a.wisp.damage,
          ttl: 4,
          radius: 0.25
        });
      }
    }
    if (a.audit) {
      e.ai.audit = state.enemies.some((o) => !o.dead && o.type === "gateGenerator" && o.campaignEnc && o.campaignEnc === e.campaignEnc);
    }
    if (a.flash) {
      ai.flashCd = (ai.flashCd == null ? a.flash.every : ai.flashCd) - dt;
      const d = Math.hypot(target.pos.x - e.pos.x, target.pos.z - e.pos.z);
      if (ai.flashCd <= 0 && d < a.flash.radius) {
        ai.flashCd = a.flash.every;
        target.vel.x *= 0.45;
        target.vel.z *= 0.45;
      }
    }
  }

  // src/sim/campaign/plates.js
  var PLATES = [
    { id: "brow", covers: "head", hp: 250 },
    { id: "chest", covers: "front", hp: 400, bodyMul: 0.1 },
    { id: "back", covers: "rear", hp: 400, bodyMul: 0.1 }
  ];
  function equipAuditorPlates(e, tier = 1) {
    const tm = tierEnemyMult(tier || 1);
    e.plates = PLATES.map((p) => {
      const hp = Math.round(p.hp * tm);
      return { id: p.id, covers: p.covers, bodyMul: p.bodyMul, hp, maxHp: hp };
    });
  }
  function applyPlates(state, e, hit, dmg) {
    if (!e.plates || !hit.point || hit.sourceKind === "dot" || hit.sourceKind === "spell") return null;
    let plate = null;
    let mul = 1;
    const head = e.plates.find((p) => p.covers === "head" && p.hp > 0);
    if (head && hit.zone === "weak" && hit.point.y >= e.pos.y + 5) {
      plate = head;
      mul = 0;
    } else if (hit.zone !== "weak") {
      const dx = hit.point.x - e.pos.x;
      const dz = hit.point.z - e.pos.z;
      const front = dx * -Math.sin(e.yaw) + dz * -Math.cos(e.yaw) >= 0;
      plate = e.plates.find((p) => p.hp > 0 && p.covers === (front ? "front" : "rear"));
      if (plate) mul = plate.bodyMul == null ? 1 : plate.bodyMul;
    }
    if (!plate) return null;
    plate.hp = Math.max(0, plate.hp - dmg);
    if (plate.hp === 0) emit(state, "plateBreak", { targetId: e.id, plate: plate.id });
    return Math.max(0, Math.round(dmg * mul));
  }

  // src/data/levels/arena.js
  var R = TUNING.arenaRadius;
  var arena_default = {
    id: "arena",
    name: "Arena",
    stage: null,
    legacy: true,
    radius: R,
    tier: 1,
    parTime: 0,
    bounds: { min: [-R, -40, -R], max: [R, 80, R] },
    sections: []
  };

  // src/data/levels/kit.js
  function box({ id, at: at2, size, yaw = 0, mat = "stone", tag } = {}) {
    return { kind: "box", id, at: at2.slice(), size: size.slice(), yaw, mat, tag };
  }
  function ramp({ id, at: at2, size, yaw = 0, mat = "stone", tag } = {}) {
    return { kind: "ramp", id, at: at2.slice(), size: size.slice(), yaw, mat, tag };
  }
  function stairs(o = {}) {
    const steps = o.steps ?? Math.max(2, Math.round((o.size?.[2] || 1) / 0.3));
    return { ...ramp(o), visual: "stairs", steps };
  }
  function cylinder({ id, at: at2, r, h, mat = "pillar", tag } = {}) {
    return { kind: "cylinder", id, at: at2.slice(), r, h, mat, tag };
  }
  function sphere({ id, at: at2, r, mat = "stone", tag } = {}) {
    return { kind: "sphere", id, at: at2.slice(), r, mat, tag };
  }
  function cone({ id, at: at2, r, h, mat = "stone", tag } = {}) {
    return { kind: "cone", id, at: at2.slice(), r, h, mat, tag };
  }
  function disc({ id, at: at2, r, mat = "neon", tag } = {}) {
    return { kind: "disc", id, at: at2.slice(), r, mat, tag };
  }
  function terrain({ id, origin, size, cell = 2, seed = 1, noise = {}, mat = "rock", flat = [] } = {}) {
    return {
      kind: "terrain",
      id,
      origin: origin.slice(),
      size: size.slice(),
      cell,
      seed,
      mat,
      noise: { amp: noise.amp ?? 0, freq: noise.freq ?? 0.02, octaves: noise.octaves ?? 1 },
      flat: (flat || []).map((f) => ({ ...f }))
    };
  }

  // src/data/levels/assemble.js
  function shiftAt(at2, dx) {
    return [at2[0] + dx, at2[1], at2[2]];
  }
  function makeLevel(def) {
    let cursor = 0;
    const sections = [];
    for (let i = 0; i < def.sections.length; i++) {
      const s = def.sections[i];
      const len = s.length ?? 46;
      const width2 = s.width ?? 22;
      const x0 = cursor;
      const x1 = x0 + len;
      const geometry = [
        box({ id: `${s.id}-floor`, at: [(x0 + x1) / 2, -0.25, width2 / 2], size: [len + 1, 0.5, width2], mat: s.floor || "stone" }),
        box({ id: `${s.id}-wallN`, at: [(x0 + x1) / 2, 1.6, 0.3], size: [len + 1, 3.2, 0.6], mat: "stone" }),
        box({ id: `${s.id}-wallS`, at: [(x0 + x1) / 2, 1.6, width2 - 0.3], size: [len + 1, 3.2, 0.6], mat: "stone" })
      ];
      for (const c of s.cover || []) {
        const h = c.h || 1.2;
        geometry.push(box({
          id: `${s.id}-cov-${c.x}`,
          at: [x0 + c.x, h / 2, c.z ?? width2 * 0.32],
          size: [1.4, h, 1.4],
          mat: "crate",
          tag: "cover"
        }));
      }
      for (const prim of s.props || []) {
        const copy = { ...prim, at: prim.at ? shiftAt(prim.at, x0) : prim.at, origin: prim.origin ? shiftAt(prim.origin, x0) : prim.origin };
        geometry.push(copy);
      }
      const encounters = (s.encounters || []).map((e) => encounterAt(e, s.id, x0, width2));
      const mechanisms2 = (s.mechanisms || []).map((m) => placeMech(m, s, x0, width2));
      if (s.secret) {
        mechanisms2.push({ kind: "secret", id: `${s.id}-secret`, at: [x0 + s.secret.x, 1, width2 * 0.72], modifier: s.secret.modifier });
      }
      const weapons = (s.weapons || []).map((w) => ({
        kind: "rack",
        id: w.id,
        at: [x0 + w.x, 0.9, width2 * 0.62],
        gun: w.gun,
        why: w.why
      }));
      const checkpoints = (s.checkpoints || []).map((c) => ({
        id: c.id,
        at: [x0 + c.x, 0, width2 / 2],
        when: prefixRef(c.when, s)
      }));
      const next2 = def.sections[i + 1];
      const exit = next2 ? {
        min: [x1 - 4, -1, 2],
        max: [x1 - 0.4, 4, width2 - 2],
        to: next2.id,
        kind: s.transition || "seamless",
        card: s.card || null
      } : null;
      sections.push({
        id: s.id,
        name: s.name,
        start: [x0 + 3.5, 0, width2 / 2],
        yaw: 0,
        geometry,
        encounters,
        mechanisms: mechanisms2,
        weapons,
        checkpoints,
        exit,
        intro: s.intro || null
      });
      cursor = x1 - 2;
    }
    const width = def.sections[0].width ?? 22;
    return {
      id: def.id,
      name: def.name,
      stage: def.stage,
      tier: def.tier,
      parTime: def.parTime,
      jetpack: def.jetpack || false,
      gravityMult: def.gravityMult || 1,
      lighting: def.lighting || null,
      bounds: { min: [-10, -25, -6], max: [cursor + 12, 48, width + 6] },
      sections,
      modifiers: def.modifiers || []
    };
  }
  function prefixRef(opens, s) {
    if (!opens || typeof opens !== "string") return opens;
    if (!opens.endsWith(".cleared")) return opens;
    const id = opens.slice(0, -".cleared".length);
    if ((s.encounters || []).some((e) => e.id === id)) return `${s.id}-${id}.cleared`;
    return opens;
  }
  function encounterAt(e, sid, x0, width) {
    const x = x0 + e.x;
    const at2 = [];
    const units2 = [];
    let n = 0;
    for (const [type, count] of e.units) {
      units2.push({ type, count });
      for (let k = 0; k < count; k++) at2.push([x + 7, 0, width / 2 - 3 + n++ % 6 * 1.25]);
    }
    return {
      id: `${sid}-${e.id}`,
      space: e.space || "corridor",
      zone: { min: [x - 8, -2, 1], max: [x + 16, 14, width - 1] },
      activate: { min: [x - 4, -1, 1.2], max: [x + 3, 6, width - 1.2] },
      objective: { kind: e.objective || "clearAll" },
      maxAlive: e.maxAlive || 12,
      fleeAt: e.fleeAt || 0,
      squads: [{ delay: 0, units: units2, at: at2 }]
    };
  }
  function placeMech(m, s, x0, width) {
    const x = x0 + m.x;
    const z = m.z ?? width * 0.28;
    const base = { kind: m.kind, id: m.id, opens: prefixRef(m.opens, s), modifier: m.modifier, dps: m.dps, slow: m.slow, power: m.power, speed: m.speed };
    if (m.kind === "door") return { ...base, at: [x, 1.6, z], size: [0.8, 3.2, 3.2], yaw: 0 };
    if (m.kind === "switch") return { ...base, at: [x, 1, z], holdTime: m.holdTime ?? 0.35 };
    if (m.kind === "barrel") return { ...base, at: [x, 0.55, z], hp: 30 };
    if (m.kind === "jumpPad") return { ...base, at: [x, 0.2, width / 2], power: m.power || 11, r: 1.4 };
    if (m.kind === "hazard") return { ...base, min: [x - 2, -1, z - 2], max: [x + 2, 2, z + 2], dps: m.dps ?? 8, slow: m.slow ?? 0 };
    if (m.kind === "mover" || m.kind === "carpet" || m.kind === "elevator") {
      return { ...base, kind: "mover", from: [x, 0.4, 3], to: [x, m.y ?? 0.4, width - 3], speed: m.speed || 2.2 };
    }
    if (m.kind === "zipline") return { ...base, from: [x, 3.5, width / 2], to: [x + 12, 2.2, width / 2] };
    if (m.kind === "portal") return { ...base, at: [x, 1, 4], to: [x + (m.dx || 10), 0, width / 2] };
    if (m.kind === "laser") return { ...base, at: [x, 1.2, 4], size: [0.4, 1.6, 3], dps: m.dps || 12 };
    if (m.kind === "rail") return { ...base, from: [x, 0.3, width / 2], to: [x + 18, 0.3, width / 2], speed: m.speed || 10 };
    if (m.kind === "crusher") return { ...base, at: [x, 2.6, z], size: [2.4, 1, 2.4], speed: 1.2 };
    if (m.kind === "bridge") return { ...base, from: [x, 0, width / 2], to: [x + 6, 0, width / 2], width: 2 };
    if (m.kind === "jetpack" || m.kind === "fuel" || m.kind === "power" || m.kind === "depot") return { ...base, at: [x, 1, width * 0.4] };
    return { ...base, at: [x, 1, z] };
  }

  // src/data/levels/register.js
  var byId2 = /* @__PURE__ */ new Map();
  function registerLevel(level) {
    if (!level || typeof level.id !== "string") throw new Error("registerLevel needs a level id");
    byId2.set(level.id, level);
    return level;
  }

  // src/data/levels/v2.js
  function add(at2, origin) {
    if (!at2) return at2;
    return [at2[0] + origin[0], (at2[1] || 0) + (origin[1] || 0), at2[2] + origin[2]];
  }
  function shiftNav(bounds, origin) {
    if (!bounds) return null;
    return {
      min: [bounds.min[0] + origin[0], bounds.min[1] + origin[2]],
      max: [bounds.max[0] + origin[0], bounds.max[1] + origin[2]]
    };
  }
  function shiftBox(box3, origin) {
    if (!box3 || !box3.min || !box3.max) return box3;
    return { min: add(box3.min, origin), max: add(box3.max, origin) };
  }
  function shiftPrim(g, origin) {
    const next2 = { ...g };
    if (g.at) next2.at = add(g.at, origin);
    if (g.origin) next2.origin = add(g.origin, origin);
    return next2;
  }
  function shiftScript(script, origin) {
    if (!script) return null;
    const shiftAt2 = (at2) => at2 ? add(at2, origin) : at2;
    const shiftField = (field2) => field2 ? { ...field2, at: shiftAt2(field2.at) } : field2;
    return {
      ...script,
      parts: (script.parts || []).map((part) => ({
        ...part,
        targets: (part.targets || []).map((t) => ({ ...t, at: shiftAt2(t.at) })),
        pit: shiftField(part.pit),
        pools: (part.pools || []).map(shiftField),
        vents: (part.vents || []).map(shiftField)
      }))
    };
  }
  function shiftSquad(squad6, origin) {
    const at2 = (squad6.at || []).map((p) => add(p, origin));
    return { ...squad6, at: at2, trigger: squad6.trigger || { type: "onEnter" }, method: squad6.method || "placed" };
  }
  function makeV2Level(def) {
    const sections = (def.sections || []).map((sec, i) => {
      const origin = sec.origin || [0, 0, 0];
      const geometry = (sec.geometry || []).map((g) => shiftPrim(g, origin));
      const encounters = (sec.encounters || []).map((enc) => ({
        ...enc,
        objective: enc.objective || { kind: "clearAll" },
        zone: shiftBox(enc.zone, origin),
        activate: shiftBox(enc.activate, origin),
        hold: shiftBox(enc.hold, origin),
        squads: (enc.squads || []).map((sq) => shiftSquad(sq, origin)),
        lockdown: enc.lockdown ? {
          ...enc.lockdown,
          threshold: shiftBox(enc.lockdown.threshold, origin),
          room: shiftBox(enc.lockdown.room, origin)
        } : null,
        lid: shiftBox(enc.lid, origin),
        arena: enc.arena ? { x: enc.arena.x + origin[0], z: enc.arena.z + origin[2], radius: enc.arena.radius } : null,
        script: shiftScript(enc.script, origin)
      }));
      const next2 = def.sections[i + 1];
      return {
        ...sec,
        origin,
        geometry,
        encounters,
        mechanisms: (sec.mechanisms || []).map((m) => ({
          ...m,
          at: m.at ? add(m.at, origin) : m.at,
          from: m.from ? add(m.from, origin) : m.from,
          to: m.to ? add(m.to, origin) : m.to,
          min: m.min ? add(m.min, origin) : m.min,
          max: m.max ? add(m.max, origin) : m.max
        })),
        weapons: (sec.weapons || []).map((w) => ({ ...w, at: w.at ? add(w.at, origin) : w.at })),
        navBounds: shiftNav(sec.navBounds, origin),
        flyerVolume: shiftBox(sec.flyerVolume, origin),
        checkpoints: (sec.checkpoints || []).map((c) => ({ ...c, at: add(c.at, origin) })),
        hazards: (sec.hazards || []).map((h) => ({
          ...h,
          min: add(h.min, origin),
          max: add(h.max, origin),
          slow: h.slow != null ? h.slow : h.speed
        })),
        geysers: (sec.geysers || []).map((g) => ({
          ...g,
          kind: "geyser",
          at: add(g.at, origin),
          to: g.to ? add(g.to, origin) : g.to
        })),
        carpets: (sec.carpets || []).map((c) => ({ ...c, from: add(c.from, origin), to: add(c.to, origin) })),
        noGrapple: (sec.noGrapple || []).map((z) => ({ ...z, min: add(z.min, origin), max: add(z.max, origin) })),
        grappleAnchors: (sec.grappleAnchors || []).map((a) => ({ ...a, at: add(a.at, origin) })),
        ...sec.terrain ? {
          terrain: sec.terrain.origin ? { ...sec.terrain, origin: add(sec.terrain.origin, origin) } : sec.terrain
        } : {},
        links: (sec.links || []).map((link) => ({
          ...link,
          at: link.at ? add(link.at, origin) : link.at,
          from: link.from ? add(link.from, origin) : link.from,
          to: link.to ? add(link.to, origin) : link.to
        })),
        start: add(sec.start || [2, 0, 2], origin),
        yaw: sec.yaw || 0,
        exit: next2 ? shiftBox(sec.exit, origin) : null,
        intro: sec.intro || null
      };
    });
    let maxX = 10, maxZ = 10;
    for (const sec of sections) {
      for (const g of sec.geometry) {
        const x = g.at ? g.at[0] : 0;
        const z = g.at ? g.at[2] : 0;
        if (x > maxX) maxX = x;
        if (z > maxZ) maxZ = z;
      }
    }
    return {
      format: "v2",
      id: def.id,
      name: def.name,
      stage: def.stage || "city",
      tier: def.tier || 1,
      parTime: def.parTime || 0,
      jetpack: def.jetpack || false,
      gravityMult: def.gravityMult || 1,
      lighting: def.lighting || null,
      maxAlive: def.maxAlive || 8,
      useNav: !!def.useNav,
      startAmmo: def.startAmmo || null,
      bounds: def.bounds || { min: [-10, -25, -10], max: [maxX + 10, 48, maxZ + 10] },
      sections,
      modifiers: def.modifiers || []
    };
  }

  // src/data/levels/L01/index.js
  var card = (title, lines) => ({ title, lines });
  function floor(id, length) {
    return box({ id, at: [length / 2, -0.25, 16], size: [length, 0.5, 28], mat: "concrete" });
  }
  function zone(x0, x1, z0 = 4, z1 = 28) {
    return { min: [x0, -2, z0], max: [x1, 8, z1] };
  }
  function squad(id, trigger, units2, at2, method = "placed") {
    return {
      id,
      trigger,
      method,
      at: at2,
      units: units2.map(([type, count, partId]) => partId ? { type, count, partId } : { type, count })
    };
  }
  var carAt = (id, x, z) => box({ id, at: [x, 0.7, z], size: [3, 1.4, 1.6], mat: "metal" });
  var binAt = (id, x, z) => box({ id, at: [x, 0.7, z], size: [2.4, 1.4, 1.4], mat: "metal" });
  var planterAt = (id, x, z) => box({ id, at: [x, 0.6, z], size: [1.6, 1.2, 1.6], mat: "stone" });
  function sides(id, length, { h = 6, gapS = null } = {}) {
    const z = h < 2 ? [1.7, 30.3] : [1.4, 30.6];
    const w = h < 2 ? 0.5 : 0.8;
    const wall2 = (tag, x0, x1, zz) => box({ id: `${id}-side-${tag}`, at: [(x0 + x1) / 2, h / 2, zz], size: [x1 - x0, h, w], mat: "concrete" });
    const south = gapS ? [wall2("s1", 0, gapS[0], z[1]), wall2("s2", gapS[1], length, z[1])] : [wall2("s", 0, length, z[1])];
    return [wall2("n", 0, length, z[0]), ...south];
  }
  function ammo(id, at2, ammoType = "bullets", amount = 60) {
    return { kind: "ammo", id, at: at2, ammoType, amount };
  }
  function door(id, at2) {
    return { kind: "door", id, at: at2, size: [1.2, 4, 32] };
  }
  var S1 = {
    id: "S1",
    name: "Drop Zone",
    origin: [0, 0, 0],
    start: [8, 0, 10],
    yaw: -Math.PI / 2,
    // North lane (z 10) is the lesson. South of z 12 the road is flat, so a walk
    // with an empty stamina bar still reaches every fight.
    intro: card("SPROTO LANDING", [
      "Los Angeles. Dusk.",
      "The Bitcoin Tax Empire has shut the city gate.",
      "You have one machine gun and a bad attitude.",
      "Sprint the lane. Slide under the truck. Hook the gold ring, then let go."
    ]),
    grappleAnchors: [{ id: "S1-hook", at: [30, 5.6, 10], r: 2.2 }],
    navBounds: { min: [0, 2], max: [200, 30] },
    exit: zone(190, 200),
    geometry: [
      floor("S1-floor", 200),
      ...sides("S1", 200),
      box({ id: "S1-truck", at: [62, 1.2, 8], size: [4, 2.4, 2.4], mat: "metal" }),
      box({ id: "S1-cover-a", at: [54, 0.7, 8], size: [2.4, 1.4, 1.4], mat: "metal" }),
      box({ id: "S1-cover-b", at: [54, 0.7, 24], size: [2.4, 1.4, 1.4], mat: "metal" }),
      box({ id: "S1-barricade", at: [150, 1.1, 8], size: [1.2, 2.2, 4], mat: "metal" }),
      // Party cover (E1) and a second firing line at the barricade (E2). The middle of the road stays open.
      carAt("S1-car-a", 70, 22),
      carAt("S1-car-b", 77, 11),
      carAt("S1-car-c", 132, 20),
      binAt("S1-bin-c", 140, 10),
      box({ id: "S1-barricade-s", at: [154, 1.1, 24], size: [1.2, 2.2, 4], mat: "metal" }),
      sphere({ id: "S1-tinubu", at: [40, 14, 48], r: 8, mat: "gold" }),
      cone({ id: "S1-tinubu-hat", at: [40, 22, 48], r: 5, h: 8, mat: "gold" }),
      box({ id: "S1-sign", at: [20, 6, -6], size: [14, 2, 0.6], mat: "neon" }),
      // Sprint lane. Discs only: the bar on the HUD is the lesson, and walking
      // the same lane still reaches the truck.
      disc({ id: "S1-sprint-a", at: [11, 0.06, 10], r: 1.15, mat: "neon" }),
      disc({ id: "S1-sprint-b", at: [13.5, 0.06, 10], r: 0.7, mat: "neon" }),
      disc({ id: "S1-sprint-c", at: [16, 0.06, 10], r: 0.7, mat: "neon" }),
      cylinder({ id: "S1-lane-n", at: [12, 0, 7.2], r: 0.35, h: 1.2, mat: "neon" }),
      cylinder({ id: "S1-lane-s", at: [12, 0, 12.8], r: 0.35, h: 1.2, mat: "neon" }),
      // Slide truck. Underside y 1.15 blocks a standing body (1.8) and lets a
      // slide (height 1.0) through. South of z 11.4 the road is open.
      box({ id: "S1-slide-body", at: [20, 2.25, 7.2], size: [4.2, 2.2, 8.4], mat: "metal" }),
      box({ id: "S1-slide-cab", at: [20, 0.55, 3.8], size: [4.2, 1.1, 1.6], mat: "metal" }),
      disc({ id: "S1-slide-pad", at: [16.2, 0.06, 10], r: 1.15, mat: "neon" }),
      disc({ id: "S1-walk-pad", at: [20, 0.06, 18], r: 0.85, mat: "neon" }),
      // First hook. Hold the ring for about a third of a second, then let go.
      // The pull stays on you and throws you over the wall toward the party.
      // The south road walks around it, and an empty stamina bar still can.
      box({ id: "S1-hook-wall", at: [30, 2, 7.8], size: [1.2, 4, 9.6], mat: "concrete" }),
      cylinder({ id: "S1-hook-post-n", at: [30, 4, 8.4], r: 0.3, h: 2.6, mat: "gold" }),
      cylinder({ id: "S1-hook-post-s", at: [30, 4, 11.6], r: 0.3, h: 2.6, mat: "gold" }),
      box({ id: "S1-hook-bar", at: [30, 6.45, 10], size: [0.6, 0.5, 3.8], mat: "gold" }),
      sphere({ id: "S1-hook-ring", at: [30, 5.6, 10], r: 0.55, mat: "gold" }),
      disc({ id: "S1-hook-pad", at: [25.2, 0.06, 10], r: 1.15, mat: "neon" })
    ],
    weapons: [],
    checkpoints: [
      { id: "CP1", at: [96, 0, 16], when: "S1-E1.cleared" },
      { id: "CP2", at: [176, 0, 16], when: "S1-E2.cleared" }
    ],
    mechanisms: [
      { kind: "secret", id: "S1-bonk", at: [12, 0.6, 22], modifier: "bigHead" },
      { kind: "secret", id: "S1-file-1", at: [88, 0.4, 8], tickets: 5 },
      { kind: "barrel", id: "S1-brl-1", at: [58, 0.55, 14], element: "fire" },
      { kind: "barrel", id: "S1-brl-2", at: [66, 0.55, 18], element: "fire" },
      { kind: "barrel", id: "S1-brl-3", at: [156, 0.55, 16], element: "fire" },
      { kind: "switch", id: "S1-sw-gate", at: [168, 0.5, 16], needsHold: true, holdTime: 1.5 },
      ammo("A1", [46, 0.4, 16]),
      ammo("A2", [70, 0.4, 14]),
      ammo("A3", [72, 0.4, 18]),
      ammo("A4", [100, 0.4, 16]),
      ammo("A5", [158, 0.4, 16]),
      disc({ id: "S1-pad", at: [46, 0.05, 16], r: 1.2, mat: "neon" })
    ].filter((m) => m.kind),
    encounters: [
      {
        id: "S1-E1",
        maxAlive: 6,
        noAmmoDrop: true,
        objective: { kind: "clearAll" },
        activate: zone(48, 80),
        squads: [
          squad("A", { type: "onEnter" }, [["midget", 4]], [[60, 0, 16]]),
          squad("B", { type: "onKills", n: 2 }, [["midget", 2]], [[66, 0, 10]], "door"),
          squad("C", { type: "onKills", n: 5 }, [["midget", 3]], [[66, 0, 22]], "door")
        ]
      },
      {
        id: "S1-E2",
        maxAlive: 6,
        objective: { kind: "clearAll" },
        activate: zone(120, 175),
        squads: [
          squad("A", { type: "onEnter" }, [["obama", 3]], [[150, 0, 12], [152, 0, 16], [150, 0, 20]]),
          squad("B", { type: "onKills", n: 2 }, [["midget", 3]], [[140, 0, 24]], "door"),
          squad("C", { type: "onKills", n: 5 }, [["obama", 2]], [[146, 4, 8]], "hidden"),
          // First Kamikaze Midgets. They start 20 m out on open road, so the fuse is seen before it is felt.
          squad("K", { type: "onKills", n: 3 }, [["kamikazeMidget", 2]], [[126, 0, 14], [126, 0, 18]], "door")
        ]
      }
    ]
  };
  var S2 = {
    id: "S2",
    name: "Alley and Fire Escapes",
    origin: [185, 0, 0],
    navBounds: { min: [0, 2], max: [180, 30] },
    exit: zone(168, 180),
    // Crown of the north slide. The alley at z 16 stays flat.
    grappleAnchors: [{ id: "S2-hook", at: [30, 4.6, 8], r: 1.8 }],
    geometry: [
      floor("S2-floor", 180),
      ...sides("S2", 180),
      box({ id: "S2-alley-n", at: [40, 2, 4], size: [70, 4, 1], mat: "concrete" }),
      box({ id: "S2-alley-s", at: [40, 2, 28], size: [70, 4, 1], mat: "concrete" }),
      cylinder({ id: "S2-pillar", at: [78, 0, 12], r: 0.5, h: 4, mat: "stone" }),
      box({ id: "S2-tank", at: [130, 1.2, 16], size: [3, 2.4, 3], mat: "metal" }),
      // Shrine court corners for the hold, and a car to duck the flyers behind.
      binAt("S2-bin-a", 88, 10),
      binAt("S2-bin-b", 88, 22),
      carAt("S2-car-a", 146, 21),
      // Walk up, or hook the crown and let go. Slide down the far side.
      ramp({ id: "S2-slide-up", at: [22, 1.1, 8], size: [3.2, 2.2, 12], yaw: 90, mat: "metal" }),
      box({ id: "S2-slide-crown", at: [30, 1.95, 8], size: [4, 0.5, 3.2], mat: "metal" }),
      ramp({ id: "S2-slide-down", at: [38, 1.1, 8], size: [3.2, 2.2, 12], yaw: 270, mat: "metal" }),
      sphere({ id: "S2-hook-ring", at: [30, 4.6, 8], r: 0.5, mat: "gold" }),
      disc({ id: "S2-hook-pad", at: [14, 0.06, 8], r: 1, mat: "neon" }),
      disc({ id: "S2-slide-pad", at: [30, 2.28, 8], r: 0.75, mat: "neon" })
    ],
    weapons: [{ id: "S2-rack-sg", at: [22, 0.5, 16], gun: "shotgun", why: "E3 corridor swarm" }],
    checkpoints: [{ id: "CP3", at: [78, 0, 16] }],
    mechanisms: [
      { kind: "shrine", id: "S2-shrine", at: [78, 0.5, 16], spell: "gooBolt" },
      { kind: "secret", id: "S2-cache", at: [100, 0.4, 8], modifier: "bigHead" },
      { kind: "secret", id: "S2-file-2", at: [130, 2.2, 10], tickets: 5 },
      ammo("A6", [22, 0.4, 14], "shells", 12),
      ammo("A7", [24, 0.4, 18]),
      ammo("A8", [76, 0.4, 14]),
      ammo("A9", [80, 0.4, 18], "shells", 12),
      ammo("A10", [110, 0.4, 16], "shells", 8),
      ammo("A11", [128, 0.4, 16])
    ],
    encounters: [
      {
        id: "S2-E3",
        maxAlive: 8,
        objective: { kind: "clearAll" },
        activate: zone(28, 60),
        squads: [
          squad("A", { type: "onEnter" }, [["midget", 5]], [[52, 0, 16]], "door"),
          squad("B", { type: "time", t: 7 }, [["midget", 3]], [[30, 0, 16]], "door"),
          squad("C", { type: "onKills", n: 6 }, [["midget", 2]], [[40, 4, 16]], "drop"),
          squad("D", { type: "onRemain", n: 1 }, [["midget", 2]], [[52, 0, 16]], "door"),
          // Down the corridor at you: shoot them in the pack and the swarm thins itself.
          squad("K", { type: "onKills", n: 4 }, [["kamikazeMidget", 2]], [[58, 0, 16]], "door")
        ]
      },
      {
        id: "S2-E4",
        maxAlive: 8,
        objective: { kind: "hold", seconds: 25 },
        activate: zone(70, 96),
        hold: zone(72, 90),
        squads: [
          squad("A", { type: "onHold", p: 0 }, [["midget", 3]], [[84, 0, 16]], "door"),
          squad("B", { type: "onHold", p: 10 }, [["midget", 5]], [[84, 0, 16]], "door")
        ]
      },
      {
        id: "S2-E5",
        maxAlive: 4,
        objective: { kind: "clearAll" },
        activate: zone(110, 160),
        squads: [
          squad("A", { type: "onEnter" }, [["flyingMidget", 2]], [[130, 6, 16]]),
          squad("B", { type: "onKills", n: 1 }, [["flyingMidget", 2]], [[148, 8, 16]], "air"),
          squad("C", { type: "onEnter" }, [["flyingMidget", 2]], [[140, 7, 12]], "air")
        ]
      }
    ]
  };
  var S3 = {
    id: "S3",
    name: "Mall of Sproto",
    origin: [350, 0, 0],
    navBounds: { min: [0, 2], max: [90, 30] },
    flyerVolume: { min: [0, 0, 2], max: [90, 12, 30] },
    exit: zone(84, 90),
    // North balcony. One hook during the lockdown, or the ramp. The floor at z 16 is the fight.
    grappleAnchors: [{ id: "S3-hook", at: [58, 6.2, 5], r: 1.8 }],
    geometry: [
      floor("S3-floor", 90),
      ...sides("S3", 90),
      box({ id: "S3-kiosk", at: [40, 1, 8], size: [3, 2, 3], mat: "neon" }),
      box({ id: "S3-kiosk-b", at: [64, 1, 22], size: [3, 2, 3], mat: "neon" }),
      planterAt("S3-planter-a", 32, 19.5),
      planterAt("S3-planter-b", 50, 11),
      cylinder({ id: "S3-pillar-w", at: [28, 0, 10], r: 0.6, h: 6, mat: "stone" }),
      cylinder({ id: "S3-pillar-e", at: [52, 0, 22], r: 0.6, h: 6, mat: "stone" }),
      ramp({ id: "S3-balc-ramp", at: [48, 1.825, 5], size: [3, 3.65, 12], yaw: 90, mat: "metal" }),
      box({ id: "S3-balc", at: [58, 3.4, 5], size: [8, 0.5, 3], mat: "metal" }),
      sphere({ id: "S3-hook-ring", at: [58, 6.2, 5], r: 0.5, mat: "gold" }),
      disc({ id: "S3-hook-pad", at: [40, 0.06, 5], r: 0.9, mat: "neon" })
    ],
    weapons: [],
    checkpoints: [
      { id: "CP4", at: [6, 0, 16] },
      { id: "CP5", at: [70, 0, 16], when: "S3-E6.cleared" }
    ],
    mechanisms: [
      door("S3-L1-in", [10, 2, 16]),
      door("S3-L1-out", [80, 2, 16]),
      { kind: "barrel", id: "S3-brl-1", at: [24, 0.55, 12], element: "shock" },
      { kind: "barrel", id: "S3-brl-2", at: [40, 0.55, 20], element: "shock" },
      { kind: "barrel", id: "S3-brl-3", at: [56, 0.55, 12], element: "shock" },
      { kind: "chest", id: "S3-chest", at: [70, 0.5, 12], gun: "mg", opens: "S3-E6.cleared" },
      ammo("A12", [6, 0.4, 16]),
      ammo("A13", [8, 0.4, 12]),
      ammo("A14", [8, 0.4, 20], "shells", 8),
      ammo("A15", [36, 0.4, 10]),
      ammo("A16", [36, 0.4, 22], "shells", 8),
      ammo("A17", [60, 0.4, 16]),
      ammo("C1", [70, 0.4, 18], "bullets", 120),
      ammo("D1", [86, 0.4, 16], "bullets", 180)
    ],
    encounters: [
      {
        id: "S3-E6",
        maxAlive: 8,
        objective: { kind: "clearAll" },
        activate: zone(12, 78),
        lockdown: { entry: "S3-L1-in", exit: "S3-L1-out", threshold: zone(14, 24) },
        squads: [
          squad("W1", { type: "onEnter" }, [["robotLaser", 2]], [[40, 0, 16]]),
          squad("W1b", { type: "with", after: "W1", delay: 4 }, [["robotLaser", 2]], [[22, 0, 10]], "door"),
          squad("W2", { type: "onRemain", n: 2 }, [["midget", 5]], [[58, 0, 22]], "door"),
          squad("W2b", { type: "with", after: "W2", delay: 0 }, [["robotLaser", 2]], [[60, 5, 12]], "door"),
          squad("W3", { type: "onRemain", n: 2 }, [["flyingMidget", 4]], [[40, 6, 16]], "drop"),
          squad("W3b", { type: "with", after: "W3", delay: 3 }, [["midget", 3]], [[22, 0, 16]], "door"),
          squad("W4", { type: "onRemain", n: 2 }, [["obama", 2]], [[48, 5, 10]], "door"),
          squad("W4b", { type: "with", after: "W4", delay: 0 }, [["midget", 5]], [[30, 0, 22]], "door")
        ]
      }
    ]
  };
  var S4 = {
    id: "S4",
    name: "Parking Spiral",
    origin: [425, 0, 0],
    navBounds: { min: [0, 2], max: [130, 30] },
    flyerVolume: { min: [70, 0, 2], max: [130, 20, 30] },
    exit: zone(118, 130),
    geometry: [
      floor("S4-floor", 130),
      ...sides("S4", 130),
      box({ id: "S4-ramp", at: [36, 0.4, 8], size: [16, 0.5, 4], mat: "concrete" }),
      box({ id: "S4-car", at: [24, 0.7, 10], size: [3, 1.4, 1.6], mat: "metal" }),
      // It is a car park: parked rows on the south side of the ramp deck and two on the sealed roof.
      carAt("S4-car-b", 14, 22),
      carAt("S4-car-c", 32, 23.5),
      carAt("S4-car-d", 86, 25.5),
      carAt("S4-car-e", 100, 9),
      box({ id: "S4-core", at: [90, 1.5, 8], size: [4, 3, 4], mat: "metal" })
    ],
    weapons: [],
    checkpoints: [
      { id: "CP6", at: [48, 0, 16], when: "S4-E7.cleared" },
      { id: "CP7", at: [100, 0, 16], when: "S4-E8.cleared" }
    ],
    mechanisms: [
      { kind: "mover", id: "S4-lift", carry: true, from: [48, 0, 8], to: [62, 4, 8], speed: 2 },
      { kind: "switch", id: "S4-sw-lift", at: [46, 0.5, 8], needsHold: true, holdTime: 1 },
      door("S4-L2-in", [70, 2, 16]),
      door("S4-L2-out", [112, 2, 16]),
      { kind: "barrel", id: "S4-brl-1", at: [96, 0.55, 16], element: "shock" },
      { kind: "chest", id: "S4-chest", at: [104, 0.5, 12], gun: "shotgun", opens: "S4-E8.cleared" },
      { kind: "secret", id: "S4-file-3", at: [20, 0.4, 24], tickets: 5 },
      ammo("A18", [8, 0.4, 16]),
      ammo("A19", [30, 0.4, 16]),
      ammo("A20", [44, 0.4, 16], "shells", 8),
      ammo("A21", [48, 0.4, 20]),
      ammo("A22", [84, 0.4, 12]),
      ammo("A23", [84, 0.4, 20], "shells", 8),
      ammo("A24", [96, 0.4, 12]),
      ammo("A25", [104, 0.4, 20]),
      ammo("C2", [104, 0.4, 16], "bullets", 120)
    ],
    encounters: [
      {
        id: "S4-E7",
        maxAlive: 6,
        objective: { kind: "clearAll" },
        activate: zone(6, 64),
        squads: [
          squad("A", { type: "onEnter" }, [["midget", 4]], [[18, 0, 16]], "hidden"),
          squad("B", { type: "onKills", n: 3 }, [["obama", 2]], [[28, 3, 10]], "hidden"),
          squad("C", { type: "onKills", n: 6 }, [["midget", 2]], [[36, 0, 20]], "hidden"),
          squad("D", { type: "onKills", n: 8 }, [["midget", 3]], [[44, 0, 16]], "hidden"),
          squad("K", { type: "onKills", n: 5 }, [["kamikazeMidget", 3]], [[50, 0, 14]], "hidden"),
          squad("E", { type: "onKills", n: 11 }, [["robotShooter", 1]], [[58, 0, 16]]),
          squad("G", { type: "onEnter" }, [["gateGenerator", 1, "S4-gen"]], [[52, 0, 22]])
        ]
      },
      {
        id: "S4-E8",
        maxAlive: 8,
        objective: { kind: "clearAll" },
        activate: zone(74, 110),
        lockdown: { entry: "S4-L2-in", exit: "S4-L2-out", threshold: zone(74, 84) },
        squads: [
          squad("W1", { type: "onEnter" }, [["midget", 3]], [[80, 0, 10]], "door"),
          squad("W1b", { type: "with", after: "W1", delay: 0 }, [["midget", 3]], [[80, 0, 22]], "door"),
          squad("W2", { type: "onRemain", n: 2 }, [["flyingMidget", 4]], [[96, 8, 16]], "air"),
          squad("W2b", { type: "with", after: "W2", delay: 4 }, [["midget", 3]], [[88, 0, 22]], "door"),
          squad("W3", { type: "onRemain", n: 2 }, [["midget", 6]], [[92, 0, 12]], "door"),
          squad("W3b", { type: "with", after: "W3", delay: 6 }, [["flyingMidget", 3]], [[100, 8, 10]], "air"),
          squad("W4", { type: "onRemain", n: 2 }, [["robotShooter", 1], ["robotLaser", 2]], [[108, 0, 16]], "door")
        ]
      }
    ]
  };
  var S5 = {
    id: "S5",
    name: "Overpass",
    origin: [540, 0, 0],
    navBounds: { min: [0, 2], max: [140, 30] },
    exit: zone(128, 140),
    geometry: [
      floor("S5-floor", 140),
      ...sides("S5", 140, { h: 1.1, gapS: [47, 57] }),
      box({ id: "S5-toll", at: [52, 1.2, 8], size: [1, 2.4, 4], mat: "metal" }),
      box({ id: "S5-canopy", at: [52, 4.5, 16], size: [8, 0.5, 12], mat: "concrete" }),
      box({ id: "S5-rail-n", at: [52, 5.35, 9.7], size: [8.4, 1.2, 0.8], mat: "concrete" }),
      box({ id: "S5-car", at: [30, 0.7, 10], size: [3, 1.4, 1.6], mat: "metal" }),
      // Stalled traffic: the Big Obama is met alone among cars, and they are how you get behind him.
      carAt("S5-car-b", 40, 20),
      carAt("S5-car-c", 72, 11),
      carAt("S5-car-d", 108, 20),
      carAt("S5-car-e", 116, 11),
      // Stair up to the mana battery, then a catwalk and a downhill slide back
      // to the road. The deck at z 16 stays a flat walk under the canopy.
      box({ id: "S5-stair-pad", at: [52, -0.25, 32.5], size: [8, 0.5, 8], mat: "concrete" }),
      ramp({ id: "S5-stair", at: [52, 2.375, 28.7], size: [4, 4.75, 8.6], yaw: 180, mat: "concrete" }),
      box({ id: "S5-cat", at: [67.15, 4.5, 23], size: [34.3, 0.5, 2.8], mat: "metal" }),
      ramp({ id: "S5-slide", at: [92.15, 2.375, 23], size: [2.8, 4.75, 16.3], yaw: 270, mat: "concrete" }),
      disc({ id: "S5-slide-pad", at: [84, 4.82, 23], r: 0.7, mat: "neon" })
    ],
    weapons: [],
    checkpoints: [],
    mechanisms: [
      { kind: "secret", id: "S5-battery", at: [52, 5, 10], mana: 10 },
      ammo("A26", [12, 0.4, 16]),
      ammo("A27", [16, 0.4, 12], "shells", 8),
      ammo("A28", [52, 5, 12]),
      ammo("A29", [90, 0.4, 16]),
      ammo("C3", [60, 0.4, 16], "bullets", 120)
    ],
    encounters: [
      {
        id: "S5-E9",
        maxAlive: 6,
        objective: { kind: "clearAll" },
        activate: zone(16, 120),
        squads: [
          squad("A", { type: "onEnter" }, [["bigObama", 1]], [[52, 0, 16]], "door"),
          squad("B", { type: "onKills", n: 1 }, [["midget", 4]], [[58, 0, 16]], "door"),
          squad("C", { type: "with", after: "B", delay: 0 }, [["obama", 2]], [[52, 5, 10]], "hidden"),
          squad("D", { type: "onKills", n: 6 }, [["robotLaser", 1], ["robotShooter", 1]], [[100, 0, 16]])
        ]
      }
    ]
  };
  var S6 = {
    id: "S6",
    name: "Gate Plaza",
    origin: [665, 0, 0],
    navBounds: { min: [0, 2], max: [110, 30] },
    flyerVolume: { min: [0, 0, 2], max: [110, 22, 30] },
    intro: card("Gate Plaza", ["A Big Bitcoin Obama is counting the take.", "The gate does not open until he drops it."]),
    geometry: [
      floor("S6-floor", 110),
      ...sides("S6", 110),
      cylinder({ id: "S6-fountain", at: [48, 0, 8], r: 2, h: 2, mat: "stone" }),
      box({ id: "S6-stand", at: [40, 1.2, 8], size: [6, 2.4, 4], mat: "stone" }),
      planterAt("S6-planter-a", 40, 22),
      planterAt("S6-planter-b", 78, 10),
      planterAt("S6-planter-c", 78, 22),
      box({ id: "S6-gate-l", at: [96, 6, 6], size: [2, 12, 2], mat: "gold" }),
      box({ id: "S6-gate-r", at: [96, 6, 26], size: [2, 12, 2], mat: "gold" }),
      // Walk-up perch for the flying adds. No hook: a fling here leaves the floor.
      ramp({ id: "S6-perch-ramp", at: [52, 1.6, 24], size: [3, 3.2, 14], yaw: 90, mat: "metal" }),
      box({ id: "S6-perch", at: [62, 3.2, 24], size: [6, 0.5, 3], mat: "metal" })
    ],
    weapons: [
      { id: "S6-rack-sg", at: [16, 0.5, 12], gun: "shotgun", why: "finale tower doors" },
      { id: "S6-rack-mg", at: [16, 0.5, 20], gun: "mg", why: "the Gatekeeper battery" }
    ],
    checkpoints: [{ id: "CP8", at: [8, 0, 16] }],
    mechanisms: [
      door("S6-L3-in", [12, 2, 16]),
      door("S6-gate", [96, 2, 16]),
      { kind: "barrel", id: "S6-brl-f1", at: [30, 0.55, 10], element: "fire" },
      { kind: "barrel", id: "S6-brl-f2", at: [30, 0.55, 22], element: "fire" },
      { kind: "barrel", id: "S6-brl-s1", at: [70, 0.55, 10], element: "shock" },
      { kind: "barrel", id: "S6-brl-s2", at: [70, 0.55, 22], element: "shock" },
      ammo("A30", [24, 0.4, 12]),
      ammo("A31", [24, 0.4, 20], "shells", 8),
      ammo("A32", [60, 0.4, 12]),
      ammo("A33", [60, 0.4, 20]),
      ammo("C4", [40, 0.4, 16], "bullets", 120),
      ammo("D2", [8, 0.4, 12], "bullets", 180)
    ],
    encounters: [
      {
        id: "S6-FIN",
        maxAlive: 8,
        objective: { kind: "clearAll" },
        activate: zone(14, 92),
        lockdown: { entry: "S6-L3-in", exit: "S6-gate", threshold: zone(16, 26) },
        squads: [
          squad("P1", { type: "onEnter" }, [
            ["gateGenerator", 1, "S6-gen-N"],
            ["gateGenerator", 1, "S6-gen-W"],
            ["gateGenerator", 1, "S6-gen-E"],
            ["robotLaser", 3],
            ["gatekeeper", 1]
          ], [[28, 0, 10], [28, 0, 16], [28, 0, 22], [36, 0, 16], [80, 0, 16]]),
          squad("P1b", { type: "onPartDestroyed", id: "S6-gen-N" }, [["robotShooter", 1]], [[22, 0, 8]], "door"),
          squad("P1c", { type: "onPartDestroyed", id: "S6-gen-W" }, [["robotShooter", 1], ["robotLaser", 1]], [[22, 0, 24]], "door"),
          squad("P2a", { type: "onKills", n: 8 }, [["midget", 4]], [[70, 0, 8]], "door"),
          squad("P2b", { type: "onKills", n: 12 }, [["midget", 4]], [[70, 0, 24]], "door"),
          squad("P2c", { type: "onKills", n: 16 }, [["midget", 4]], [[64, 0, 16]], "door"),
          squad("P2k", { type: "onKills", n: 14 }, [["kamikazeMidget", 3]], [[72, 0, 16]], "door"),
          squad("P3a", { type: "onKills", n: 20 }, [["flyingMidget", 3]], [[90, 8, 16]], "air"),
          squad("P3b", { type: "onKills", n: 24 }, [["flyingMidget", 3]], [[90, 8, 12]], "air")
        ]
      },
      {
        id: "S6-EXIT",
        objective: { kind: "reach" },
        activate: zone(98, 108),
        zone: zone(98, 108),
        squads: []
      }
    ]
  };
  S1.mechanisms = S1.mechanisms.filter((m) => m.kind !== "disc");
  S1.geometry.push(disc({ id: "S1-neon-pad", at: [46, 0.06, 16], r: 1.2, mat: "neon" }));
  var L01 = makeV2Level({
    id: "L01",
    name: "Sproto Landing",
    stage: "city",
    tier: 1,
    parTime: 18 * 60,
    jetpack: false,
    useNav: true,
    maxAlive: 8,
    startAmmo: { bullets: 36 },
    lighting: "dusk",
    sections: [S1, S2, S3, S4, S5, S6]
  });
  registerLevel(L01);

  // src/data/levels/L02/spec.js
  var LOOT = {
    baseTier: "common",
    odds: { common: 65, uncommon: 30, rare: 5, epic: 0, legendary: 0 },
    gunLevel: 2,
    poolAtStart: ["mg", "shotgun"],
    unlocks: ["sniper", "bazooka"],
    guaranteed: [
      { id: "chest-L1", tier: "common", note: "one gun the player does not carry, else shotgun" },
      { id: "chest-L2", tier: "common", note: "same rule, after loom-0" },
      { id: "cache-secret", gun: "shotgun", tier: "rare" },
      { id: "elite-rug-security", tierStep: 1, odds: { uncommon: 65, rare: 30, epic: 5 } },
      { id: "sahil", guns: 2, tier: "uncommon", bossGun: ["raygun", "bigbullets"], spell: "magicCarpet" }
    ]
  };
  var AMMO = [
    ["ab01", "bullets", 60, "S1", [98, 0, 142]],
    ["ab02", "shells", 12, "S1", [106, 0, 96]],
    ["ab03", "shells", 12, "S1", [92, 0, 48]],
    ["ab04", "bullets", 60, "S1", [110, 0, 56]],
    ["ab05", "shells", 12, "S1", [108, 0, 28]],
    ["ab06", "bullets", 60, "S1", [92, 0, 16]],
    ["ab07", "shells", 12, "S1", [156, 0, 32]],
    ["ab08", "bullets", 60, "S1", [188, 0, 12]],
    ["ab09", "bullets", 60, "S2", [14, 0, 104]],
    ["ab10", "shells", 12, "S2", [152, 0, 100]],
    ["ab11", "bullets", 60, "S2", [150, 0, 104]],
    ["ab12", "shells", 12, "S2", [200, 9, 94]],
    ["ab13", "shells", 12, "S2", [212, 9, 84]],
    ["ab14", "bullets", 60, "S2", [242, 9, 114]],
    ["ab15", "sniper", 8, "S3", [41, 6, 60]],
    ["ab16", "sniper", 8, "S3", [38, 6, 64]],
    ["ab17", "bullets", 60, "S3", [82, 0, 66]],
    ["ab18", "shells", 12, "S3", [86, 0, 98]],
    ["ab19", "bullets", 60, "S3", [78, 0, 150]],
    ["ab20", "sniper", 8, "S3", [118, 0, 143]],
    ["ab21", "shells", 12, "S3", [166, 0, 120]],
    ["ab22", "shells", 12, "SM", [8, 4, 22]],
    ["ab23", "bullets", 60, "SM", [54, 4, 36]],
    ["ab24", "shells", 12, "SM", [67, 7, 46]],
    ["ab25", "bullets", 60, "SM", [104, 10, 96]],
    ["ab26", "shells", 12, "SM", [86, 2, 152]],
    ["ab27", "bullets", 60, "SM", [94, 2, 152]],
    ["ab28", "shells", 12, "SM", [88, 0, 165]],
    ["ab29", "rockets", 3, "S4", [47, 0, 11]],
    ["ab30", "rockets", 3, "S4", [47, 0, 13]],
    ["ab31", "shells", 12, "S4", [30, 0, 48]],
    ["ab32", "bullets", 60, "S4", [50, 0, 48]],
    ["ab33", "bullets", 60, "S4", [20, 0, 62]],
    ["ab34", "bullets", 60, "S4", [60, 0, 78]],
    ["ab35", "shells", 12, "S4", [46, 0, 92]],
    ["ab36", "rockets", 3, "S4", [34, 0, 92]]
  ];
  var CRATES = [
    { id: "ac1", kind: "ammoCrate", uses: 3, section: "S1", at: [184, 0, 24] },
    { id: "ac2", kind: "ammoCrate", uses: 3, section: "S2", at: [240, 9, 100] },
    { id: "ac3", kind: "ammoCrate", uses: 3, section: "S4", at: [40, 0, 94] },
    { id: "ac4", kind: "ammoCrate", uses: 3, section: "S4", at: [28, 0, 57] },
    { id: "dc1", kind: "depotCrate", uses: null, section: "S2", at: [262, 9, 92] },
    { id: "dc2", kind: "depotCrate", uses: null, section: "SM", at: [80, 0, 226] },
    { id: "dc3", kind: "depotCrate", uses: null, section: "S4", at: [35, 0, 12] }
  ];
  var BEATS = [
    { id: "E1", sec: 47.2 },
    { id: "E2", sec: 77.1 },
    { id: "shrine", sec: 26.2 },
    { id: "L1", sec: 152.4 },
    { id: "E4", sec: 84.2 },
    { id: "L2", sec: 159 },
    { id: "depot1", sec: 52.6 },
    { id: "E6", sec: 87.2 },
    { id: "E7", sec: 105.8 },
    { id: "E8", sec: 115 },
    { id: "E9", sec: 73.9 },
    { id: "depot2", sec: 50.8 },
    { id: "L3", sec: 262.5 }
  ];
  var BOSS_HP = { part2: 1714, part4: 1909, part5: 1967, loom: 161, pylon: 230, elite: 173 };
  var BOSS_SCRIPT = {
    designEncounter: "SB-BOSS",
    liveEncounter: "S4-E4",
    parts: [
      {
        id: 1,
        kind: "entry",
        seconds: 30,
        designTargets: [{ id: "loom-E", hp: 161, at: [58, 0, 70] }, { id: "loom-W", hp: 161, at: [22, 0, 70] }],
        attacks: { bolts: "half" },
        adds: [
          { t: 2, from: ["sh-NW", "sh-NE"], units: [["midget", 3], ["midget", 3]] },
          { on: "firstLoom", from: ["sh-SE"], units: [["boomMidget", 2]], gap: 1.5 }
        ]
      },
      {
        id: 2,
        kind: "phase",
        seconds: 55,
        hp: 1300,
        designHp: 1714,
        duelStage: 1,
        attacks: ["bolt", "carpetSweep"],
        adds: [
          { onBossHp: 65, from: ["sh-SW", "sh-SE"], units: [["midget", 2], ["midget", 2]] },
          { onBossHp: 30, from: ["sh-NW"], units: [["boomMidget", 2]] }
        ]
      },
      {
        id: 3,
        kind: "intermission",
        seconds: 8,
        designTargets: [
          { id: "pylon-N", hp: 230, at: [40, 0, 52] },
          { id: "pylon-SE", hp: 230, at: [55.6, 0, 79] },
          { id: "pylon-SW", hp: 230, at: [24.4, 0, 79] }
        ],
        pit: { at: [40, 0, 70], r: 7, slow: 0.5, dps: 4 },
        adds: [
          { t: 0, from: ["sh-NE"], units: [["riotMidget", 2], ["hexAcolyte", 1]] },
          { t: 10, from: ["sh-SE", "sh-SW"], units: [["midget", 3], ["midget", 2]] },
          { on: "secondPylon", from: ["sh-NW"], units: [["midget", 3]] }
        ]
      },
      {
        id: 4,
        kind: "phase",
        seconds: 60,
        hp: 1e3,
        designHp: 1909,
        duelStage: 2,
        ring: 26.8,
        adds: [
          { onBossHp: 70, from: ["sh-NE", "sh-SW"], units: [["midget", 2], ["midget", 1]] },
          { onBossHp: 35, from: ["sh-SE"], units: [["boomMidget", 3]], gap: 1.5 }
        ]
      },
      {
        id: 5,
        kind: "phase",
        seconds: 65,
        hp: 900,
        designHp: 1967,
        duelStage: 3,
        ring: 25.5,
        adds: [
          { onBossHp: 75, from: ["sh-NW"], units: [["riotMidget", 1, { elite: true, name: "Head of Rug Security", hp: 173 }], ["midget", 3]] },
          { onBossHp: 40, from: ["sh-NE", "sh-SE"], units: [["midget", 3], ["boomMidget", 2]] }
        ]
      }
    ]
  };
  var BOT_ROUTE = [
    { section: "S1", steps: ["(100,144)", "clear E1", "rack-sg-arch", "clear E2", "shrine", "zap C1", "cross pass.line", "clear L1", "chest-L1", "(196,24)"] },
    { section: "S2", steps: ["(12,100)", "road to (124,84)", "clear E4", "G5 or shelf.ramp", "cross serai.line", "clear L2", "loom-0", "chest-L2", "depot", "(288,98)"] },
    { section: "S3", steps: ["(4,80)", "tower rack-sn-tower", "clear E6", "C1", "Needle", "C2", "C3 or ramp", "(214,112)"] },
    { section: "S4", steps: ["(4,16)", "clear 8a-8c", "zap C2", "L1", "clear 8d", "Z1", "J1", "os-1", "Z2", "looms", "clear E9", "depot", "(90,237)"] },
    { section: "SB", steps: ["(40,6)", "dc3", "rack-bz-vault", "cross ring.line", "looms", "bars and pylons", "exitRug"] }
  ];
  var DIFFICULTY = {
    easy: {
      maxAlive: 8,
      e2Riots: 1,
      l1Wave1Riots: 2,
      l1DropBoom: 1,
      l1AddMidget: 3,
      bubbleHp: 30,
      quicksand: 0.65,
      loomHp: 120,
      waveSec: 35,
      bossNoPart2Adds: true,
      bossNoElite: true,
      springHeal: 60,
      ammoMult: 1.5
    },
    heroic: {
      maxAlive: 12,
      elites: ["L1 wave 3 riot", "L2 wave 4 acolyte", "E6 shooter", "E8 riot"],
      e9BigObama: true,
      bubbleHp: 60,
      waveSec: 20,
      pylonRegrowSec: 25,
      springNoRefill: true,
      crateUses: 2
    }
  };
  var CARDS = {
    start: { title: "The Grand Bazaar", lines: ["Sahil's bazaar is where the Empire launders its rugs.", "Take his carpet."] },
    dunes: { title: "Into the Dunes", lines: ["The souk was the easy part.", "Sahil's caravan route crosses the Dune Sea."] },
    boss: { title: "Sahil, the RugMaster", lines: ["Every rug comes with a lifetime guarantee. The rug pull is free."] }
  };
  var DEV_ENTRY = {
    unlock: "L01 cleared",
    query: "?mode=campaign&level=L02",
    grants: ["gooBolt"]
  };

  // src/data/levels/L02/author.js
  function box2(id, size, at2, mat = "stone", extra = {}) {
    return { kind: "box", id, size: size.slice(), at: at2.slice(), yaw: extra.yaw || 0, mat, ...extra };
  }
  function cylinder2(id, r, h, at2, mat = "pillar", extra = {}) {
    return { kind: "cylinder", id, r, h, at: at2.slice(), mat, ...extra };
  }
  function sphere2(id, r, at2, mat = "rock", extra = {}) {
    return { kind: "sphere", id, r, at: at2.slice(), mat, ...extra };
  }
  function cone2(id, r, h, at2, mat = "stone", extra = {}) {
    return { kind: "cone", id, r, h, at: at2.slice(), mat, ...extra };
  }
  function disc2(id, r, at2, mat = "neon", extra = {}) {
    return { kind: "disc", id, r, at: at2.slice(), mat, ...extra };
  }
  function ramp2(id, size, at2, yaw, mat = "stone", extra = {}) {
    return { kind: "ramp", id, size: size.slice(), at: at2.slice(), yaw, mat, keep: true, ...extra };
  }
  function floor2(id, x0, x1, z0, z1, mat = "sand") {
    return box2(id, [x1 - x0, 0.5, z1 - z0], [(x0 + x1) / 2, -0.25, (z0 + z1) / 2], mat);
  }
  function wall(id, x0, x1, z0, z1, h = 6, mat = "stone", y0 = 0) {
    return box2(id, [Math.max(0.6, x1 - x0), h, Math.max(0.6, z1 - z0)], [(x0 + x1) / 2, y0 + h / 2, (z0 + z1) / 2], mat);
  }
  function axisBox(g) {
    if (!g || g.kind !== "box" && g.kind !== "ramp") return g;
    const yaw = ((g.yaw || 0) % 360 + 360) % 360;
    if (yaw === 90 || yaw === 270) return { ...g, yaw: 0, size: [g.size[2], g.size[1], g.size[0]] };
    if (yaw === 180) return { ...g, yaw: 0 };
    return g;
  }
  function aabb(g) {
    const b = axisBox(g);
    if (!b) return null;
    if (b.kind === "box" || b.kind === "ramp") {
      return {
        minX: b.at[0] - b.size[0] / 2,
        maxX: b.at[0] + b.size[0] / 2,
        minY: b.at[1] - b.size[1] / 2,
        maxY: b.at[1] + b.size[1] / 2,
        minZ: b.at[2] - b.size[2] / 2,
        maxZ: b.at[2] + b.size[2] / 2,
        box: b
      };
    }
    if (b.kind === "cylinder") {
      return {
        minX: b.at[0] - b.r,
        maxX: b.at[0] + b.r,
        minY: b.at[1],
        maxY: b.at[1] + b.h,
        minZ: b.at[2] - b.r,
        maxZ: b.at[2] + b.r,
        box: b
      };
    }
    return null;
  }
  function hits(a, r) {
    return a.maxX > r.x0 && a.minX < r.x1 && a.maxZ > r.z0 && a.minZ < r.z1;
  }
  function subtract(g, rect) {
    const x0 = g.at[0] - g.size[0] / 2;
    const x1 = g.at[0] + g.size[0] / 2;
    const z0 = g.at[2] - g.size[2] / 2;
    const z1 = g.at[2] + g.size[2] / 2;
    const y = g.at[1];
    const sy = g.size[1];
    const ix0 = Math.max(x0, rect.x0);
    const ix1 = Math.min(x1, rect.x1);
    const iz0 = Math.max(z0, rect.z0);
    const iz1 = Math.min(z1, rect.z1);
    if (ix1 - ix0 <= 0.02 || iz1 - iz0 <= 0.02) return [g];
    const raw = [];
    const add3 = (xa, xb, za, zb) => {
      if (xb - xa < 0.5 || zb - za < 0.5 || sy < 0.5) return;
      raw.push([xa, xb, za, zb]);
    };
    if (ix0 - x0 >= 0.5) add3(x0, ix0, z0, z1);
    if (x1 - ix1 >= 0.5) add3(ix1, x1, z0, z1);
    if (iz0 - z0 >= 0.5) add3(ix0, ix1, z0, iz0);
    if (z1 - iz1 >= 0.5) add3(ix0, ix1, iz1, z1);
    return raw.map((p, i) => ({
      ...g,
      yaw: 0,
      id: `${g.id}~${i}`,
      at: [(p[0] + p[1]) / 2, y, (p[2] + p[3]) / 2],
      size: [p[1] - p[0], sy, p[3] - p[2]]
    }));
  }
  function cutRoute(geometry, rects) {
    let parts = geometry.filter(Boolean);
    for (const rect of rects) {
      const next2 = [];
      for (const prim of parts) {
        if (prim.keep || prim.kind === "sphere" || prim.kind === "cone" || prim.kind === "disc" || prim.kind === "terrain") {
          next2.push(prim);
          continue;
        }
        const box3 = axisBox(prim);
        const a = aabb(box3);
        if (!a || a.maxY < 0.5 || a.minY > 1.7 || !hits(a, rect)) {
          next2.push(prim);
          continue;
        }
        if (box3.kind !== "box") continue;
        next2.push(...subtract(box3, rect));
      }
      parts = next2;
    }
    return parts;
  }
  function points(n, x, z, along = "x", gap = 1.5) {
    const out = [];
    const start2 = -((n - 1) * gap) / 2;
    for (let i = 0; i < n; i++) {
      const d = start2 + i * gap;
      out.push(along === "z" ? [x, 0, z + d] : [x + d, 0, z]);
    }
    return out;
  }
  function squad2(id, trigger, method, units2, at2, designAt) {
    const list = units2.map(([type, count]) => ({ type, count }));
    return { id, trigger, method, units: list, at: at2, designAt: designAt || at2 };
  }
  function ammo2(id, at2, ammoType, amount) {
    return { kind: "ammo", id, at: at2, ammoType, amount };
  }
  function door2(id, at2, size) {
    return { kind: "door", id, at: at2, size };
  }
  function zone2(x0, x1, z0, z1, y0 = -2, y1 = 12) {
    return { min: [x0, y0, z0], max: [x1, y1, z1] };
  }

  // src/data/levels/L02/sections.js
  var card2 = (title, lines) => ({ title, lines });
  function units(list) {
    const n = list.reduce((s, u4) => s + u4[1], 0);
    return { list, n };
  }
  function atFor(n, x, z, along) {
    return points(n, x, z, along, 1.4);
  }
  var S1_ROUTE = [
    { x0: 96, x1: 104, z0: 18, z1: 150 },
    { x0: 96, x1: 200, z0: 19, z1: 29 }
  ];
  function s1() {
    const geometry = [
      floor2("s1-ground", -20, 220, -20, 170),
      wall("s1-berm-w", 58, 60, 100, 148, 6, "sand"),
      wall("s1-berm-e", 140, 142, 100, 148, 6, "sand"),
      wall("s1-berm-s", 60, 140, 148, 150, 6, "sand"),
      box2("s1-tent1", [5, 3, 5], [74, 1.5, 112], "wood"),
      box2("s1-tent2", [5, 3, 5], [126, 1.5, 110], "wood"),
      box2("s1-tent3", [5, 3, 5], [84, 1.5, 138], "wood"),
      cylinder2("s1-fire", 1.2, 0.5, [100, 0, 118], "stone"),
      box2("s1-cart", [3, 1.4, 1.6], [112, 0.7, 122], "wood"),
      box2("s1-low-a", [6, 1.2, 1], [88, 0.6, 108], "stone"),
      box2("s1-low-b", [6, 1.2, 1], [112, 0.6, 108], "stone"),
      wall("s1-souk-w", 60, 96, 98, 100, 7),
      wall("s1-souk-e", 104, 140, 98, 100, 7),
      box2("s1-lintel", [8, 2, 2], [100, 6, 99], "trim"),
      wall("s1-block-a", 83, 97, 67, 93, 4),
      wall("s1-block-b", 103, 117, 67, 93, 4),
      wall("s1-block-w", 60, 80, 44, 98, 8),
      wall("s1-block-e", 120, 140, 44, 98, 8),
      cylinder2("s1-well", 1.5, 1.2, [100, 0, 53], "stone"),
      wall("s1-sq-n-w", 80, 96, 42, 44, 7),
      wall("s1-sq-n-e", 104, 120, 42, 44, 7),
      box2("s1-shrine", [2, 2.2, 2], [100, 1.1, 14], "neon"),
      wall("s1-shrine-n", 88, 112, 12, 14, 7),
      wall("s1-shrine-s-w", 88, 96, 30, 32, 7),
      wall("s1-shrine-s-e", 104, 112, 30, 32, 7),
      wall("s1-pass-n", 114, 149, 17, 19, 7),
      wall("s1-pass-s", 114, 149, 29, 31, 7),
      box2("s1-canopy", [35, 0.5, 8], [131.5, 7.25, 22], "wood"),
      disc2("s1-line", 2, [120, 0.05, 22]),
      // Dyers' Court, 44 × 44 (x 151–195, z 2–46).
      wall("s1-dye-w-n", 150, 152, 2, 18, 7),
      wall("s1-dye-w-s", 150, 152, 30, 46, 7),
      wall("s1-dye-e-n", 194, 196, 2, 18, 7),
      wall("s1-dye-e-s", 194, 196, 30, 46, 7),
      wall("s1-dye-n", 152, 194, 2, 4, 7),
      wall("s1-dye-s", 152, 194, 44, 46, 7),
      box2("s1-dye-plat", [6, 2, 10], [181, 1, 24], "wood"),
      cylinder2("s1-vat-1", 2, 1.2, [162, 0, 12], "stone"),
      cylinder2("s1-vat-2", 2, 1.2, [173, 0, 12], "stone"),
      cylinder2("s1-vat-3", 2, 1.2, [184, 0, 12], "stone"),
      cylinder2("s1-vat-4", 2, 1.2, [162, 0, 36], "stone"),
      cylinder2("s1-vat-5", 2, 1.2, [173, 0, 36], "stone"),
      cylinder2("s1-vat-6", 2, 1.2, [184, 0, 36], "stone"),
      box2("s1-rack-1", [6, 2, 0.6], [158, 1, 30], "wood"),
      box2("s1-rack-2", [6, 2, 0.6], [188, 1, 16], "wood"),
      cone2("s1-palm", 1.2, 4, [66, 4, 104], "hedge"),
      sphere2("s1-bonk-roll", 0.8, [118.5, 6, 80], "gold")
    ];
    const e1 = units([["midget", 3], ["obama", 1], ["midget", 1], ["boomMidget", 1], ["midget", 2], ["boomMidget", 1]]);
    const e2 = units([["riotMidget", 2], ["midget", 3], ["obama", 2], ["midget", 3]]);
    const e3 = units([["riotMidget", 3], ["obama", 2], ["midget", 7], ["riotMidget", 1], ["boomMidget", 2], ["midget", 3], ["boomMidget", 4], ["midget", 3]]);
    return {
      id: "S1",
      name: "Caravan Camp and Souk Alleys",
      designId: "S1",
      origin: [-614.5, 0, -181],
      start: [100, 0, 144],
      yaw: 0,
      intro: card2(CARDS.start.title, CARDS.start.lines),
      flyerVolume: { min: [151, 0, 2], max: [195, 7, 46] },
      exit: zone2(190, 202, 18, 30),
      grappleAnchors: [
        { id: "s1-arch", at: [100, 5.2, 96], r: 1.6 },
        { id: "s1-roll", at: [118.5, 6.3, 80], r: 1.8 },
        { id: "s1-roof", at: [100, 5.2, 74], r: 1.4 }
      ],
      rooms: { L1: { x0: 151, x1: 195, z0: 2, z1: 46 } },
      geometry: cutRoute(geometry, S1_ROUTE),
      weapons: [
        { id: "rack-sg-arch", at: [104, 0, 96], gun: "shotgun", why: "E2 Shield Wall and L1 Dyers Court, 4 to 5 m alleys" }
      ],
      checkpoints: [
        { id: "cp1", at: [100, 0, 140], when: null },
        { id: "cp2", at: [100, 0, 22], when: null },
        { id: "cp3", at: [186, 0, 24], when: "S1-E3.cleared" }
      ],
      mechanisms: [
        { kind: "shrine", id: "shrine-chainzap", at: [100, 0, 14], spell: "chainZap" },
        { kind: "switch", id: "C1", at: [100, 0, 24], opens: "dyersGate", needsHold: false, designAt: [111.5, 0, 17] },
        door2("dyersGate", [113, 3.5, 24], [0.8, 7, 8]),
        door2("caravanGate", [196, 3.5, 24], [0.8, 7, 10]),
        { kind: "barrel", id: "pot1", at: [92, 0, 110], element: "fire", hp: 30 },
        { kind: "barrel", id: "pot4", at: [134, 0, 20], element: "shock", hp: 30 },
        { kind: "barrel", id: "pot5", at: [142, 0, 28], element: "shock", hp: 30 },
        { kind: "barrel", id: "pot6", at: [166, 0, 16], element: "fire", hp: 30 },
        { kind: "secret", id: "secret-confetti", at: [108, 0, 130], modifier: "confetti" },
        { kind: "secret", id: "af1", at: [84, 0, 130], tickets: 5, text: "Invoice 0001: one (1) city gate, rug included" },
        { kind: "chest", id: "chest-L1", at: [186, 0, 20], gun: "shotgun", opens: "S1-E3.cleared" },
        ...placeAmmo("S1"),
        ...placeCrates("S1")
      ],
      encounters: [
        {
          id: "S1-E1",
          name: "Caravan Camp",
          maxAlive: 8,
          objective: { kind: "clearAll" },
          activate: zone2(70, 140, 100, 150),
          squads: [
            squad2("1a", { type: "onEnter" }, "placed", [["midget", 3], ["obama", 1]], atFor(4, 100, 120, "x"), [[100, 0, 118], [112, 0, 122]]),
            squad2("1b", { type: "onKills", n: 2 }, "door", [["midget", 1]], atFor(1, 100, 116), [[76, 0, 112]]),
            squad2("1c", { type: "onRemain", n: 0 }, "door", [["boomMidget", 1]], atFor(1, 100, 108), [[100, 0, 99]]),
            squad2("1d", { type: "with", after: "1c", delay: 2 }, "door", [["midget", 2], ["boomMidget", 1]], atFor(3, 100, 104), [[100, 0, 99]])
          ]
        },
        {
          id: "S1-E2",
          name: "Shield Wall",
          maxAlive: 8,
          objective: { kind: "clearAll" },
          activate: zone2(90, 112, 40, 98),
          squads: [
            squad2("2a", { type: "onEnter" }, "door", [["riotMidget", 2]], atFor(2, 100, 78, "z"), [[100, 0, 60]]),
            squad2("2b", { type: "time", t: 6 }, "door", [["midget", 3]], atFor(3, 100, 70), [[80, 0, 78]]),
            squad2("2c", { type: "onKills", n: 3 }, "hidden", [["obama", 2]], atFor(2, 100, 62), [[97, 4, 78], [103, 4, 86]]),
            squad2("2d", { type: "onRemain", n: 2 }, "door", [["midget", 3]], atFor(3, 100, 54), [[120, 0, 72]])
          ]
        },
        {
          id: "S1-E3",
          name: "Dyers Court",
          maxAlive: 10,
          objective: { kind: "clearAll" },
          activate: zone2(96, 110, 18, 32),
          lockdown: {
            entry: "dyersGate",
            exit: "caravanGate",
            threshold: zone2(116, 124, 19, 29),
            room: { min: [112, -1, 2], max: [198, 8, 48] },
            waves: 4,
            waveSec: 25,
            stallSec: 12
          },
          squads: [
            squad2("w1", { type: "onEnter" }, "placed", [["riotMidget", 3], ["obama", 2]], atFor(5, 160, 24), [[146, 0, 22], [181, 2, 24]]),
            squad2("w2", { type: "onRemain", n: 2 }, "door", [["midget", 7]], atFor(7, 170, 24), [[168, 0, 8], [168, 0, 40]]),
            squad2("w3", { type: "onRemain", n: 2 }, "door", [["riotMidget", 1], ["boomMidget", 2], ["midget", 3]], atFor(6, 180, 24), [[190, 0, 36]]),
            squad2("w4", { type: "onRemain", n: 2 }, "door", [["boomMidget", 4], ["midget", 3]], atFor(7, 176, 24), [[168, 0, 40], [190, 0, 36]])
          ]
        }
      ],
      counts: { e1: e1.n, e2: e2.n, e3: e3.n }
    };
  }
  var S2_ROUTE = [{ x0: 6, x1: 292, z0: 94, z1: 102 }];
  function s2() {
    const geometry = [
      floor2("s2-ground", -20, 310, -20, 220),
      wall("s2-cliff-n", 0, 290, 0, 4, 8, "rock"),
      wall("s2-cliff-s", 0, 290, 196, 200, 8, "rock"),
      // Shelf split around the road slot z 94–102. The room itself is at y 0.
      wall("s2-shelf-n", 198, 290, 64, 93, 6, "rock"),
      wall("s2-shelf-s", 198, 290, 103, 132, 6, "rock"),
      disc2("s2-road", 1.2, [16, 0.05, 98], "stone"),
      disc2("s2-road-b", 1.2, [80, 0.05, 98], "stone"),
      disc2("s2-road-c", 1.2, [140, 0.05, 98], "stone"),
      // High Caravanserai 44 × 44, floor x 204–248, z 76–120.
      wall("s2-serai-w-n", 203, 205, 76, 94, 6),
      wall("s2-serai-w-s", 203, 205, 102, 120, 6),
      wall("s2-serai-e-n", 247, 249, 76, 94, 6),
      wall("s2-serai-e-s", 247, 249, 102, 120, 6),
      wall("s2-serai-n", 205, 247, 76, 78, 6),
      wall("s2-serai-s", 205, 247, 118, 120, 6),
      box2("s2-gallery", [30, 3, 5], [226, 1.5, 82], "stone"),
      cylinder2("s2-well", 1.5, 1.2, [226, 0, 110], "stone"),
      cylinder2("s2-stub-1", 0.6, 1.2, [214, 0, 90], "pillar"),
      cylinder2("s2-stub-2", 0.6, 1.2, [238, 0, 90], "pillar"),
      disc2("s2-line", 4, [210, 0.05, 98]),
      // Optional downhill slide south of the firm road. The road at z 98 stays flat.
      ramp2("s2-slide", [8, 4, 70], [90, 2, 112], 270, "sand"),
      box2("s2-teeth-1", [10, 2, 1], [130, 1, 90], "stone"),
      box2("s2-teeth-2", [8, 1.2, 1], [142, 0.6, 108], "stone"),
      cone2("s2-rib", 0.4, 2.5, [180, 0, 108], "stone"),
      sphere2("s2-cache-mark", 0.8, [136, 0.8, 172], "hedge")
    ];
    return {
      id: "S2",
      name: "Dune Sea",
      designId: "S2",
      origin: [-430.5, 0, -257],
      start: [12, 0, 98],
      yaw: 0,
      intro: card2(CARDS.dunes.title, CARDS.dunes.lines),
      flyerVolume: { min: [204, 0, 76], max: [248, 8, 120] },
      exit: zone2(280, 292, 92, 104),
      grappleAnchors: [
        { id: "s2-arch", at: [143, 7.5, 92], r: 2 },
        { id: "s2-shelf", at: [201, 8, 98], r: 2.2 }
      ],
      rooms: { L2: { x0: 204, x1: 248, z0: 76, z1: 120 } },
      hazards: [
        { id: "Q1", kind: "slow", min: [60, -1, 86], max: [90, 3, 116], speed: 0.5, dps: 0, navCost: 4 },
        { id: "Q2", kind: "slow", min: [108, -1, 86], max: [122, 3, 112], speed: 0.5, dps: 0, navCost: 4 }
      ],
      geysers: [
        { id: "G0", at: [143, 0, 96], period: 6, damage: 0, to: [143, 7.5, 92] },
        { id: "G1", at: [170, 0, 90], period: 5, offset: 0, damage: 15 },
        { id: "G2", at: [176, 0, 108], period: 5, offset: 1.5, damage: 15 },
        { id: "G3", at: [184, 0, 94], period: 5, offset: 3, damage: 15 },
        { id: "G4", at: [190, 0, 106], period: 5, offset: 0.5, damage: 15 },
        { id: "G5", at: [195, 0, 98], period: 4, damage: 0, to: [201, 9, 98] }
      ],
      geometry: cutRoute(geometry, S2_ROUTE),
      weapons: [
        { id: "standee-sg-2", at: [254, 0, 104], gun: "shotgun", why: "second shotgun past L2" }
      ],
      checkpoints: [
        { id: "cp4", at: [200, 0, 98] },
        { id: "cp5", at: [252, 0, 98], when: "S2-E5.cleared" }
      ],
      mechanisms: [
        door2("seraiGateW", [204, 3, 98], [0.8, 6, 8]),
        door2("seraiGateE", [248, 3, 98], [0.8, 6, 8]),
        { kind: "chest", id: "chest-L2", at: [242, 0, 98], gun: "shotgun", opens: "S2-E5.cleared" },
        { kind: "chest", id: "cache-secret", at: [136, 0, 172], gun: "shotgun", tier: "rare", opens: null },
        { kind: "secret", id: "af2", at: [143, 0, 92], tickets: 5, text: "Shipping manifest: 400 rugs, 0 rugs delivered" },
        { kind: "depot", id: "depot-1", at: [262, 0, 92] },
        ...placeAmmo("S2"),
        ...placeCrates("S2")
      ],
      encounters: [
        {
          id: "S2-E4",
          name: "Boom Dunes",
          maxAlive: 10,
          objective: { kind: "clearAll" },
          activate: zone2(16, 170, 88, 108),
          squads: [
            squad2("4a", { type: "onEnter" }, "hidden", [["boomMidget", 3]], atFor(3, 40, 98), [[50, 0, 100]]),
            squad2("4b", { type: "onKills", n: 2 }, "hidden", [["boomMidget", 1], ["midget", 2]], atFor(3, 70, 98), [[88, 0, 62]]),
            squad2("4c", { type: "onKills", n: 5 }, "placed", [["obama", 2]], atFor(2, 110, 98), [[150, 0, 86]]),
            squad2("4d", { type: "onKills", n: 6 }, "hidden", [["boomMidget", 2], ["midget", 2]], atFor(4, 140, 98), [[120, 0, 140]])
          ]
        },
        {
          id: "S2-E5",
          name: "High Caravanserai",
          maxAlive: 10,
          objective: { kind: "clearAll" },
          activate: zone2(200, 250, 80, 116),
          lockdown: {
            entry: "seraiGateW",
            exit: "seraiGateE",
            threshold: zone2(206, 214, 94, 102),
            room: { min: [204, -1, 76], max: [248, 8, 120] },
            waves: 4,
            waveSec: 25,
            stallSec: 12
          },
          squads: [
            squad2("w1", { type: "onEnter" }, "placed", [["hexAcolyte", 1], ["obama", 2]], atFor(3, 226, 98), [[226, 0, 98], [236, 0, 92]]),
            squad2("w2", { type: "onRemain", n: 2 }, "door", [["midget", 7]], atFor(7, 220, 98), [[226, 0, 119]]),
            squad2("w3", { type: "onRemain", n: 2 }, "air", [["flyingMidget", 3], ["midget", 4]], atFor(7, 230, 98), [[204, 2, 86]]),
            squad2("w4", { type: "onRemain", n: 2 }, "door", [["hexAcolyte", 1], ["boomMidget", 4], ["midget", 3]], atFor(8, 224, 98), [[226, 0, 77]])
          ]
        }
      ]
    };
  }
  var S3_ROUTE = [{ x0: 0, x1: 220, z0: 74, z1: 86 }];
  function s3() {
    const geometry = [
      floor2("s3-ground", -40, 250, -30, 180),
      wall("s3-mass-n", 10, 90, 0, 40, 8, "rock"),
      wall("s3-mass-s", 10, 86, 110, 160, 8, "rock"),
      box2("s3-tower", [8, 6, 8], [40, 3, 40], "stone"),
      ramp2("s3-tower-ramp", [8, 6, 12], [40, 3, 52], 180, "stone"),
      box2("s3-ledge-a", [10, 1, 18], [115, 3, 45], "stone"),
      box2("s3-ledge-b", [8, 1, 18], [116, 1, 110], "stone"),
      cylinder2("s3-needle", 6, 1, [120, 0, 140], "rock"),
      box2("s3-dock-e", [16, 1, 10], [170, 0.5, 120], "wood"),
      cone2("s3-spire", 3, 8, [100, 0, 20], "rock"),
      // Walkable span where the canyon would be a hole. The kill plane is data
      // until void rescue copies onto the sim.
      box2("s3-canyon-span", [70, 0.5, 20], [120, -0.25, 80], "sand", { keep: true })
    ];
    return {
      id: "S3",
      name: "Canyon Rim",
      designId: "S3",
      origin: [-146.5, 0, -239],
      start: [4, 0, 80],
      yaw: 0,
      exit: zone2(206, 220, 74, 86),
      grappleAnchors: [
        { id: "s3-tower", at: [40, 7, 40], r: 2 },
        { id: "s3-ledge", at: [115, 4.5, 45], r: 2 },
        { id: "s3-needle", at: [120, 6, 140], r: 2.4 }
      ],
      voidRescue: { y: -20, penalty: 0.25, design: true },
      carpets: [
        { id: "carpetC1", from: [98, 0, 150], to: [112, 0, 141], speed: 3, mode: "pingpong", pause: 2.5 },
        { id: "carpetC2", from: [128, 0, 139], to: [142, 0, 127], speed: 3.5, mode: "pingpong", pause: 2.5 },
        { id: "carpetC3", from: [162, 0, 114], to: [196, 4, 112], speed: 5, mode: "onTrigger" }
      ],
      geometry: cutRoute(geometry, S3_ROUTE),
      weapons: [
        { id: "rack-sn-tower", at: [40, 0, 70], gun: "sniper", why: "E6 far ledges, 77 to 83 m" }
      ],
      checkpoints: [{ id: "cp6", at: [88, 0, 80], when: "S3-E6.cleared" }],
      mechanisms: [
        door2("rimGate", [88, 2.5, 80], [1, 5, 4]),
        { kind: "barrel", id: "pot8", at: [70, 0, 90], element: "fire", hp: 30 },
        ...placeAmmo("S3")
      ],
      encounters: [
        {
          id: "S3-E6",
          name: "Far Ledge",
          maxAlive: 7,
          objective: { kind: "clearAll" },
          activate: zone2(8, 100, 70, 90),
          squads: [
            squad2("6a", { type: "onEnter" }, "placed", [["obama", 2]], atFor(2, 55, 80), [[112, 3, 45]]),
            squad2("6b", { type: "onKills", n: 1 }, "door", [["obama", 1], ["hexAcolyte", 1]], atFor(2, 62, 80), [[119, 3, 45]]),
            squad2("6c", { type: "onKills", n: 3 }, "door", [["robotLaser", 2]], atFor(2, 70, 80), [[119, 0, 95]]),
            squad2("6d", { type: "onRemain", n: 1 }, "door", [["robotShooter", 1]], atFor(1, 78, 80), [[119, 0, 95]])
          ]
        },
        {
          id: "S3-E7",
          name: "Narrows and Carpets",
          maxAlive: 8,
          objective: { kind: "clearAll" },
          activate: zone2(100, 210, 70, 90),
          squads: [
            squad2("7a", { type: "onEnter" }, "door", [["midget", 2], ["boomMidget", 2]], atFor(4, 130, 80), [[88, 0, 118]]),
            squad2("7b", { type: "onKills", n: 2 }, "air", [["flyingMidget", 2]], atFor(2, 145, 80), [[100, 3, 150]]),
            squad2("7c", { type: "onKills", n: 4 }, "burrow", [["midget", 2]], atFor(2, 160, 80), [[120, 0, 140]]),
            squad2("7d", { type: "onKills", n: 6 }, "placed", [["obama", 2]], atFor(2, 175, 80), [[156, 0, 126]])
          ]
        }
      ]
    };
  }
  var SM_ROUTE = [
    { x0: 2, x1: 100, z0: 54, z1: 66 },
    { x0: 84, x1: 96, z0: 54, z1: 236 }
  ];
  function sm() {
    const geometry = [
      floor2("sm-ground", -40, 160, -20, 260),
      box2("sm-r1", [24, 0.5, 20], [14, 4.2, 16], "stone"),
      box2("sm-r2", [26, 0.5, 22], [47, 4.2, 15], "stone"),
      box2("sm-r3", [22, 0.5, 24], [47, 4.2, 44], "stone"),
      box2("sm-m1", [28, 0.5, 26], [78, 7.2, 43], "stone"),
      box2("sm-m2", [28, 0.5, 24], [80, 7.2, 88], "stone"),
      box2("sm-h1", [24, 0.5, 26], [112, 10.2, 87], "stone"),
      cylinder2("sm-minaret", 3, 12, [118, 10, 80], "stone"),
      cone2("sm-minaret-cap", 3.5, 5, [118, 22, 80], "gold"),
      wall("sm-sq-w", 58, 60, 162, 212, 8),
      wall("sm-sq-e", 120, 122, 162, 212, 8),
      wall("sm-sq-n-w", 60, 86, 160, 162, 8),
      wall("sm-sq-n-e", 94, 120, 160, 162, 8),
      wall("sm-gate-w", 60, 86, 212, 216, 8),
      wall("sm-gate-e", 94, 120, 212, 216, 8),
      cylinder2("sm-fountain", 3, 1.2, [90, 0, 200], "stone"),
      box2("sm-guard-w", [10, 5, 14], [66, 2.5, 187], "stone"),
      box2("sm-guard-e", [10, 5, 14], [114, 2.5, 187], "stone"),
      cylinder2("sm-tank", 1.5, 2, [14, 5, 50], "metal"),
      box2("sm-f1", [26, 0.5, 24], [17, 5.2, 46], "stone"),
      // Slide beside the street, high at the north, low at the gate. The street itself stays flat.
      ramp2("sm-slide", [6, 8, 80], [108, 4, 140], 180, "wood")
    ];
    return {
      id: "SM",
      name: "Rooftop Market and Bazaar Gate",
      designId: "S4",
      origin: [59.5, 0, -219],
      start: [8, 0, 60],
      yaw: 0,
      exit: zone2(84, 96, 222, 236),
      grappleAnchors: [
        { id: "sm-minaret", at: [118, 18, 80], r: 2.2 },
        { id: "sm-crane", at: [80, 13, 88], r: 1.8 },
        { id: "sm-gate", at: [90, 11, 214], r: 2 }
      ],
      links: [
        { id: "C2", kind: "conduit", at: [57, 4, 44], powers: "L1" },
        { id: "L1", kind: "mover", from: [61, 4, 44], to: [61, 7, 44], speed: 2, mode: "onTrigger" },
        { id: "Z1", kind: "zipline", from: [78, 9.5, 55], to: [80, 8.5, 77], speed: 16 },
        { id: "Z2", kind: "zipline", from: [112, 12.5, 99], to: [92, 4.5, 146], speed: 16 },
        { id: "J1", kind: "jumpPad", at: [91, 7, 90], to: [104, 10, 86], apex: 13 },
        { id: "J2", kind: "jumpPad", at: [110, 10, 94], to: [116, 16.5, 83], apex: 19 }
      ],
      geometry: cutRoute(geometry, SM_ROUTE),
      weapons: [],
      checkpoints: [
        { id: "cp7", at: [8, 0, 60] },
        { id: "cp8", at: [90, 0, 150] },
        { id: "cp9", at: [90, 0, 220], when: "SM-E9.cleared" }
      ],
      mechanisms: [
        { kind: "secret", id: "mana-battery", at: [12, 5, 50], mana: 10, manaRegen: 0.5 },
        { kind: "secret", id: "af3", at: [118, 0, 80], tickets: 5, text: "Warranty terms: void where prohibited, and over the void" },
        { kind: "power", id: "os-1", at: [108, 0, 80], modifier: "overshield" },
        { kind: "switch", id: "C2", at: [70, 0, 60], needsHold: false },
        { kind: "barrel", id: "pot9", at: [40, 0, 70], element: "goo", hp: 30 },
        { kind: "barrel", id: "pot15", at: [80, 0, 190], element: "fire", hp: 30 },
        { kind: "depot", id: "depot-2", at: [80, 0, 226] },
        door2("bazaarGate", [90, 3.5, 214], [8, 7, 1.2]),
        door2("vaultDoor", [90, 3, 234], [8, 6, 1.2]),
        ...placeAmmo("SM"),
        ...placeCrates("SM")
      ],
      encounters: [
        {
          id: "SM-E8",
          name: "Rooftop Market",
          maxAlive: 10,
          objective: { kind: "clearAll" },
          activate: zone2(10, 100, 50, 70),
          squads: [
            squad2("8a", { type: "onEnter" }, "door", [["midget", 5]], atFor(5, 40, 60), [[47, 4, 15], [47, 4, 44]]),
            squad2("8b", { type: "time", t: 8 }, "hidden", [["boomMidget", 2]], atFor(2, 55, 60), [[44, 4, 16]]),
            squad2("8c", { type: "onKills", n: 5 }, "hidden", [["obama", 2]], atFor(2, 70, 60), [[64, 7, 43]]),
            squad2("8d", { type: "onKills", n: 7 }, "door", [["riotMidget", 2], ["hexAcolyte", 1]], atFor(3, 85, 60), [[89, 7, 33]])
          ]
        },
        {
          id: "SM-E9",
          name: "Bazaar Gate",
          maxAlive: 10,
          objective: { kind: "clearAll" },
          destroy: ["loom-1", "loom-2"],
          activate: zone2(70, 110, 165, 210),
          squads: [
            squad2("9a", { type: "onEnter" }, "drop", [["midget", 4]], atFor(4, 90, 180), [[78, 0, 212], [102, 0, 212]]),
            squad2("9b", { type: "onRemain", n: 1 }, "door", [["riotMidget", 2]], atFor(2, 90, 190), [[66, 0, 187]]),
            squad2("9c", { type: "onKills", n: 5 }, "drop", [["boomMidget", 3]], atFor(3, 90, 196), [[78, 0, 212]]),
            squad2("9d", { type: "onKills", n: 8 }, "door", [["midget", 2]], atFor(2, 90, 204), [[114, 0, 187]])
          ]
        }
      ]
    };
  }
  function s4() {
    const geometry = [
      // Wide sand so a multi-bar kite cannot walk off the floor.
      floor2("s4-ground", -900, 900, -900, 900),
      // Low vault marks. Full-height walls were trapping the straight-line bot in corners.
      cone2("s4-vault-n", 1.2, 1.6, [40, 0, 3], "stone"),
      cone2("s4-vault-w", 1.2, 1.6, [29, 0, 14], "stone"),
      cone2("s4-vault-e", 1.2, 1.6, [51, 0, 14], "stone"),
      cone2("s4-fac-nw", 2, 6, [22, 0, 40], "stone"),
      cone2("s4-fac-ne", 2, 6, [58, 0, 40], "stone"),
      cone2("s4-fac-s", 2, 6, [40, 0, 112], "stone"),
      disc2("s4-rug", 7, [40, 0.05, 70], "gold"),
      disc2("s4-line", 3, [40, 0.05, 48]),
      // Cones, not columns: a solid pillar here pushes the five-bar replay over the verifier's time budget.
      cone2("s4-pil-1", 0.7, 2, [28, 0, 66], "pillar"),
      cone2("s4-pil-2", 0.7, 2, [52, 0, 66], "pillar"),
      cone2("s4-pil-3", 0.7, 2, [34, 0, 88], "pillar"),
      cone2("s4-pil-4", 0.7, 2, [46, 0, 88], "pillar"),
      box2("s4-pile-1", [3, 1.2, 1.5], [32, 0.6, 58], "trim"),
      box2("s4-pile-2", [3, 1.2, 1.5], [48, 0.6, 58], "trim"),
      cone2("s4-balcony", 4, 9, [40, 0, 105], "stone"),
      cone2("s4-balcony-roof", 4.5, 4, [40, 13, 105], "gold")
    ];
    const route = [
      { x0: 36, x1: 44, z0: 2, z1: 120 }
    ];
    return {
      id: "S4",
      name: "Sahil's Showroom",
      designId: "SB",
      origin: [109.5, 0, 5],
      start: [40, 0, 6],
      yaw: 0,
      intro: card2(CARDS.boss.title, CARDS.boss.lines),
      flyerVolume: { min: [8, 0, 38], max: [72, 14, 102] },
      grappleAnchors: [
        { id: "sb-balcony", at: [40, 14, 105], r: 2.4 },
        { id: "sb-facade", at: [40, 8, 39], r: 1.8 }
      ],
      exit: null,
      rooms: { L3: { d: 56, center: [40, 0, 70], ring: [27.8, 26.8, 25.5] } },
      bossScript: BOSS_SCRIPT,
      geometry: cutRoute(geometry, route),
      weapons: [
        { id: "rack-bz-vault", at: [45, 0, 12], gun: "bazooka", why: "SB-BOSS looms, pylons and add clumps" }
      ],
      checkpoints: [{ id: "cp10", at: [40, 0, 6] }],
      mechanisms: [
        door2("ringGate", [40, 3, 41], [6, 6, 0.8]),
        door2("vaultGate", [40, 2.5, 25], [4, 5, 0.8]),
        { kind: "barrel", id: "pot19", at: [56, 0, 66], element: "shock", hp: 30 },
        { kind: "barrel", id: "pot20", at: [24, 0, 74], element: "shock", hp: 30 },
        { kind: "barrel", id: "pot21", at: [55, 0, 84], element: "fire", hp: 30 },
        { kind: "barrel", id: "pot22", at: [25, 0, 84], element: "fire", hp: 30 },
        ...placeAmmo("S4"),
        ...placeCrates("S4")
      ],
      encounters: [
        {
          id: "S4-E4",
          name: "SB-BOSS",
          designId: "SB-BOSS",
          maxAlive: 10,
          objective: { kind: "boss" },
          // Includes the vault start so Sahil exists before the walker picks a direction.
          activate: zone2(10, 70, 0, 108),
          lockdown: {
            entry: "ringGate",
            exit: null,
            threshold: zone2(34, 46, 78, 88),
            room: { min: [8, -1, 0], max: [72, 16, 110] },
            waves: 5,
            waveSec: 25,
            stallSec: 12,
            noExit: true
          },
          script: BOSS_SCRIPT,
          hp: BOSS_HP,
          squads: [
            squad2("sahil", { type: "onEnter" }, "placed", [["sahil", 1]], [[40, 0, 70]], [[40, 0, 70]])
          ]
        }
      ]
    };
  }
  function placeAmmo(section) {
    return AMMO.filter((row) => row[3] === section).map(([id, ammoType, amount, , at2]) => ammo2(id, nudge(section, at2), ammoType, amount));
  }
  function placeCrates(section) {
    return CRATES.filter((c) => c.section === section).map((c) => ({
      kind: "ammo",
      id: c.id,
      at: nudge(section, c.at),
      ammoType: "bullets",
      amount: c.kind === "depotCrate" ? 480 : 240,
      crate: c.kind,
      uses: c.uses,
      designAt: c.at
    }));
  }
  function nudge(section, at2) {
    const on = {
      S1: [100, 0, 24],
      S2: [220, 0, 98],
      S3: [40, 0, 80],
      SM: [90, 0, 60],
      S4: [40, 0, 20]
    };
    const spot = on[section] || [at2[0], 0, at2[2]];
    const k = (at2[0] + at2[2]) % 7;
    return [spot[0] + (k - 3) * 0.4, 0, spot[2] + (at2[0] % 5 - 2) * 0.3];
  }
  function buildSections() {
    return [s1(), s2(), s3(), sm(), s4()];
  }

  // src/data/levels/L02/index.js
  var beats = BEATS.reduce((sum, row) => sum + row.sec, 0);
  var L02 = makeV2Level({
    id: "L02",
    name: "The Grand Bazaar",
    stage: "desert",
    tier: 2,
    parTime: 20 * 60,
    jetpack: false,
    maxAlive: 10,
    useNav: false,
    lighting: { preset: "desert", sun: "late-afternoon", boss: "dusk-fire-ring" },
    sections: buildSections()
  });
  L02.design = {
    loot: LOOT,
    beats: BEATS,
    estimateSec: Math.round(beats),
    botRoute: BOT_ROUTE,
    devEntry: DEV_ENTRY,
    difficulty: DIFFICULTY,
    parTime: 20 * 60
  };
  registerLevel(L02);

  // src/data/levels/L03/prim.js
  function rotY(x, z, yawDeg) {
    const t = (yawDeg || 0) * Math.PI / 180;
    const c = Math.cos(t);
    const s = Math.sin(t);
    return [x * c + z * s, -x * s + z * c];
  }
  function place(parts, { at: at2 = [0, 0, 0], yaw = 0, id }) {
    return parts.map((part, i) => {
      const [x, z] = rotY(part.at[0], part.at[2], yaw);
      return {
        ...part,
        id: `${id}-${part.id || i}`,
        at: [at2[0] + x, (at2[1] || 0) + part.at[1], at2[2] + z],
        yaw: ((part.yaw || 0) + (yaw || 0)) % 360
      };
    });
  }
  function polar(cx, cz, radius, bearing, y = 0) {
    const b = bearing * Math.PI / 180;
    return [cx + radius * Math.sin(b), y, cz - radius * Math.cos(b)];
  }
  function span(a, b) {
    return { length: b - a, centre: (a + b) / 2 };
  }
  function hedgeRing(id, { a, b, h, west, north, east, south }) {
    const thick = b - a;
    const westX = (a + b) / 2;
    const eastX = 120 - westX;
    const southZ = -westX;
    const northZ = -(120 - westX);
    const alongZ = span(a, 120 - a).length;
    const z0 = -60 - alongZ / 2;
    const z1 = -60 + alongZ / 2;
    const alongX = 120 - 2 * b;
    const x0 = b;
    const x1 = 120 - b;
    const parts = [];
    splitWall(parts, `${id}-W`, west, z0, z1, (piece, n) => box({
      id: `${id}-W${n}`,
      at: [westX, h / 2, piece.centre],
      size: [thick, h, piece.length],
      mat: "hedge"
    }));
    splitWall(parts, `${id}-E`, east, z0, z1, (piece, n) => box({
      id: `${id}-E${n}`,
      at: [eastX, h / 2, piece.centre],
      size: [thick, h, piece.length],
      mat: "hedge"
    }));
    splitWall(parts, `${id}-S`, south, x0, x1, (piece, n) => box({
      id: `${id}-S${n}`,
      at: [piece.centre, h / 2, southZ],
      size: [piece.length, h, thick],
      mat: "hedge"
    }));
    splitWall(parts, `${id}-N`, north, x0, x1, (piece, n) => box({
      id: `${id}-N${n}`,
      at: [piece.centre, h / 2, northZ],
      size: [piece.length, h, thick],
      mat: "hedge"
    }));
    return parts;
  }
  function splitWall(out, _id, gap, from, to, make) {
    if (!(to - from >= 0.5)) return;
    const gaps = !gap ? [] : Array.isArray(gap) ? gap : [gap];
    const cuts = gaps.map((g) => ({ a: g.at - (g.width || 4) / 2, b: g.at + (g.width || 4) / 2 })).sort((p, q2) => p.a - q2.a);
    let cursor = from;
    let n = 0;
    for (const cut of cuts) {
      if (cut.a - cursor >= 0.5) out.push(make(span(cursor, cut.a), String(n++)));
      cursor = Math.max(cursor, cut.b);
    }
    if (to - cursor >= 0.5) out.push(make(span(cursor, to), gaps.length ? String(n) : ""));
  }
  function door3(id, at2, size, extra = {}) {
    return { kind: "door", id, at: at2, size, ...extra };
  }

  // src/data/levels/L03/prefabs.js
  function tree() {
    return [
      cylinder({ id: "trunk", at: [0, 0, 0], r: 0.6, h: 6, mat: "wood" }),
      sphere({ id: "crown", at: [0, 7.5, 0], r: 3.2, mat: "hedge" })
    ];
  }
  function truck() {
    return [
      box({ id: "body", at: [0, 1.7, 0], size: [6, 2.2, 2.4], mat: "metal" }),
      box({ id: "cab", at: [0, 1.5, 4], size: [2, 1.8, 2.2], mat: "metal" }),
      cylinder({ id: "w0", at: [-2.2, 0.3, -0.9], r: 0.6, h: 0.5, mat: "rock" }),
      cylinder({ id: "w1", at: [2.2, 0.3, -0.9], r: 0.6, h: 0.5, mat: "rock" }),
      cylinder({ id: "w2", at: [-2.2, 0.3, 0.9], r: 0.6, h: 0.5, mat: "rock" }),
      cylinder({ id: "w3", at: [2.2, 0.3, 0.9], r: 0.6, h: 0.5, mat: "rock" }),
      box({ id: "tail", at: [0, 0.3, -2.2], size: [2.2, 0.6, 2], mat: "metal" })
    ];
  }
  function shrine() {
    const stones = [];
    for (let i = 0; i < 4; i++) {
      const b = i * 90 + 45;
      const t = b * Math.PI / 180;
      stones.push(box({
        id: `stone${i}`,
        at: [Math.sin(t) * 3.5, 1.5, Math.cos(t) * 3.5],
        size: [1, 3, 1],
        mat: "stone"
      }));
    }
    return [
      disc({ id: "pad", at: [0, 0.02, 0], r: 4, mat: "neon" }),
      cylinder({ id: "pedestal", at: [0, 0, 0], r: 0.8, h: 1.2, mat: "stone" }),
      sphere({ id: "orb", at: [0, 2, 0], r: 0.5, mat: "neon" }),
      ...stones
    ];
  }
  function podStump() {
    return [
      cylinder({ id: "stump", at: [0, 0, 0], r: 0.6, h: 0.8, mat: "wood" }),
      sphere({ id: "pod", at: [0, 1.15, 0], r: 0.45, mat: "toxic" })
    ];
  }
  function scarecrow() {
    return [
      cylinder({ id: "pole", at: [0, 0, 0], r: 0.25, h: 2.2, mat: "wood" }),
      box({ id: "arm", at: [0, 1.6, 0], size: [1.8, 0.5, 0.5], mat: "wood" }),
      sphere({ id: "head", at: [0, 2.4, 0], r: 0.35, mat: "sand" })
    ];
  }
  function scarecrowTower() {
    const posts = [[-2.2, -2.2], [2.2, -2.2], [-2.2, 2.2], [2.2, 2.2]].map(([x, z], i) => cylinder({ id: `post${i}`, at: [x, 0, z], r: 0.3, h: 5, mat: "wood" }));
    return [
      ...posts,
      box({ id: "deck", at: [0, 5.25, 0], size: [5, 0.5, 5], mat: "wood" }),
      box({ id: "parN", at: [0, 6.1, -2.25], size: [5, 1.2, 0.5], mat: "wood" }),
      box({ id: "parE", at: [2.25, 6.1, 0], size: [0.5, 1.2, 5], mat: "wood" }),
      box({ id: "parW", at: [-2.25, 6.1, 0], size: [0.5, 1.2, 5], mat: "wood" }),
      ...scarecrow().map((part) => ({ ...part, id: `crow-${part.id}`, at: [part.at[0], part.at[1] + 5.5, part.at[2]] }))
    ];
  }
  function tractor() {
    return [
      box({ id: "body", at: [0, 1.2, 0], size: [4, 1.6, 2.2], mat: "metal" }),
      box({ id: "cab", at: [-1, 2.7, 0], size: [1.6, 1.4, 1.8], mat: "metal" }),
      cylinder({ id: "w0", at: [0, 0.6, -1.4], r: 1, h: 0.6, mat: "rock" }),
      cylinder({ id: "w1", at: [0, 0.6, 1.4], r: 1, h: 0.6, mat: "rock" })
    ];
  }
  function shed() {
    return [
      box({ id: "back", at: [0, 1.5, -2.5], size: [6, 3, 0.5], mat: "wood" }),
      box({ id: "sideW", at: [-2.75, 1.5, 0], size: [0.5, 3, 5], mat: "wood" }),
      box({ id: "sideE", at: [2.75, 1.5, 0], size: [0.5, 3, 5], mat: "wood" }),
      box({ id: "roof", at: [0, 3.25, 0], size: [6.5, 0.5, 5.5], mat: "wood" }),
      box({ id: "jambW", at: [-2.1, 1.5, 2.25], size: [1.8, 3, 0.5], mat: "wood" }),
      box({ id: "jambE", at: [2.1, 1.5, 2.25], size: [1.8, 3, 0.5], mat: "wood" })
    ];
  }
  function mound() {
    return [
      disc({ id: "disc", at: [0, 0.02, 0], r: 1.2, mat: "dirt" }),
      cone({ id: "cone", at: [0, 0, 0], r: 1.2, h: 0.5, mat: "dirt" })
    ];
  }
  function beanstalk() {
    return [
      cylinder({ id: "stalk", at: [0, 0, 0], r: 1.6, h: 24, mat: "hedge" }),
      box({ id: "leaf1", at: [-3.5, 5, 0], size: [4, 0.5, 4], mat: "hedge" }),
      box({ id: "leaf2", at: [0, 10.5, 3.5], size: [4, 0.5, 4], mat: "hedge" }),
      box({ id: "leaf3", at: [3.5, 16, 0], size: [4, 0.5, 4], mat: "hedge" }),
      box({ id: "leaf4", at: [0, 21.5, -3.5], size: [4, 0.5, 4], mat: "hedge" })
    ];
  }
  function gazebo() {
    const pillars = [];
    for (let i = 0; i < 6; i++) {
      const b = i * 60;
      const t = b * Math.PI / 180;
      pillars.push(cylinder({
        id: `pil${i}`,
        at: [Math.sin(t) * 4.5, 0.5, Math.cos(t) * 4.5],
        r: 0.35,
        h: 3.5,
        mat: "stone"
      }));
    }
    return [
      cylinder({ id: "base", at: [0, -0.15, 0], r: 5, h: 0.5, mat: "stone" }),
      ...pillars,
      cylinder({ id: "roof", at: [0, 4, 0], r: 5.5, h: 0.5, mat: "wood" }),
      cone({ id: "spire", at: [0, 4.5, 0], r: 1.5, h: 2, mat: "wood" })
    ];
  }
  function topiary() {
    return [
      cylinder({ id: "stem", at: [0, 0, 0], r: 0.4, h: 1.2, mat: "wood" }),
      sphere({ id: "ball", at: [0, 2.4, 0], r: 1.5, mat: "hedge" })
    ];
  }
  function rootArch() {
    return [
      cylinder({ id: "l", at: [-2.5, 0, 0], r: 0.6, h: 5, mat: "wood" }),
      cylinder({ id: "r", at: [2.5, 0, 0], r: 0.6, h: 5, mat: "wood" }),
      box({ id: "lintel", at: [0, 5.5, 0], size: [7, 1, 1.5], mat: "wood" })
    ];
  }
  function manaBloom() {
    return [
      cylinder({ id: "stem", at: [0, 0, 0], r: 0.25, h: 0.6, mat: "hedge" }),
      sphere({ id: "flower", at: [0, 0.9, 0], r: 0.5, mat: "neon" }),
      disc({ id: "disc", at: [0, 0.02, 0], r: 1, mat: "neon" })
    ];
  }

  // src/data/levels/L03/encounters.js
  function squad3(id, trigger, units2, at2, method = "placed", design = null) {
    return { id, trigger, method, at: at2, units: units2, design };
  }
  function u(type, count, extra) {
    return extra ? { type, count, ...extra } : { type, count };
  }
  function line(origin, count, step = 1.2, axis = 2) {
    const pts = [];
    for (let i = 0; i < count; i++) {
      const p = origin.slice();
      p[axis] += (i - (count - 1) / 2) * step;
      pts.push(p);
    }
    return pts;
  }
  var E1 = {
    id: "S1-E1",
    name: "Scarecrow Row",
    maxAlive: 10,
    intensity: 0.4,
    objective: { kind: "clearAll" },
    activate: { min: [20, -2, -110], max: [150, 8, -50] },
    squads: [
      squad3("E1-a", { type: "onEnter" }, [u("floretSprout", 2)], [[90, 0, -80], [94, 0, -80]], "placed", "onEnter x>66, behind CB3 (99,-84) and CB4 (107,-116)"),
      squad3("E1-b", { type: "time", t: 6 }, [u("midget", 4)], line([110, 0, -80], 4, 1.4, 0), "door", "onAlert or t+6, shed SD1, 0.4s apart"),
      squad3("E1-c", { type: "onKills", n: 4 }, [u("obama", 2)], [[120, 0, -80], [124, 0, -80]], "hidden", "parapets of T1 and T2"),
      squad3("E1-d", { type: "onRemain", n: 2 }, [u("midget", 3), u("floretSprout", 1)], line([130, 0, -80], 4, 1.4, 0), "door", "SD2, sprout 2s late toward CB7")
    ]
  };
  var E2 = {
    id: "S1-E2",
    name: "Wisp Furrows",
    maxAlive: 10,
    intensity: 0.5,
    objective: { kind: "clearAll" },
    activate: { min: [168, -2, -90], max: [255, 8, -70] },
    squads: [
      squad3("E2-a", { type: "onEnter" }, [u("hexWisp", 2)], [[190, 1.2, -80], [194, 1.2, -80]], "hidden", "rise out of PK2 and PK5"),
      squad3("E2-b", { type: "onKills", n: 2 }, [u("flyingMidget", 3)], line([200, 4, -80], 3, 2, 0), "air", "over the barn roof from the south"),
      squad3("E2-c", { type: "onKills", n: 4 }, [u("riotMidget", 1), u("midget", 5)], line([210, 0, -80], 6, 1.4, 0), "door", "barn doorway, riot first"),
      squad3("E2-d", { type: "onRemain", n: 3 }, [u("hexWisp", 3)], line([220, 1.2, -80], 3, 1.6, 0), "hidden", "through the silo wall and the hay")
    ]
  };
  var E3 = {
    id: "S2-E3",
    name: "Dust in the Hedges",
    maxAlive: 10,
    intensity: 0.55,
    objective: { kind: "clearAll" },
    activate: { min: [2, -2, -80], max: [36, 6, -40] },
    squads: [
      squad3("E3-a", { type: "onEnter" }, [u("sewerMidget", 3)], line([12, 0, -60], 3, 1.4, 0), "burrow", "BM1 and BM2"),
      squad3("E3-b", { type: "onKills", n: 2 }, [u("sewerMidget", 2)], line([16, 0, -60], 2, 1.4, 0), "burrow", "BM3 behind the player, BM4"),
      squad3("E3-c", { type: "onKills", n: 5 }, [u("boomMidget", 3)], line([20, 0, -60], 3, 1.4, 0), "door", "onEnter corridor B, HD1, 0.6s apart"),
      squad3("E3-d", { type: "onKills", n: 8 }, [u("sewerMidget", 3)], line([24, 0, -60], 3, 1.4, 0), "burrow", "onEnter corridor C, BM5 and BM6"),
      squad3("E3-e", { type: "with", after: "E3-d", delay: 0 }, [u("midget", 3), u("hexAcolyte", 1)], line([28, 0, -60], 4, 1.4, 0), "door", "HD2, acolyte 3s late")
    ]
  };
  var E4 = {
    id: "S2-E4",
    name: "Gazebo Court",
    maxAlive: 10,
    intensity: 0.8,
    objective: { kind: "clearAll" },
    activate: { min: [38, -2, -82], max: [82, 10, -38] },
    lockdown: {
      entry: "LD1-IN",
      exit: "LD1-OUT",
      threshold: { min: [42, -1, -64], max: [46, 3, -56] },
      room: { min: [38, 0, -82], max: [82, 9, -38] },
      waves: 4,
      fallbackSec: 25
    },
    squads: [
      squad3("E4-w1a", { type: "onEnter" }, [u("manaLeech", 1)], [[55, 0, -60]], "placed", "GZ-ROOF, alone for 4s"),
      squad3("E4-w1b", { type: "with", after: "E4-w1a", delay: 4 }, [u("midget", 4)], line([58, 0, -60], 4, 1.3, 0), "door", "GZ-N"),
      squad3("E4-w2a", { type: "onRemain", n: 2 }, [u("sewerMidget", 5)], line([62, 0, -60], 5, 1.3, 0), "burrow", "GZ-M1 M2 M4"),
      squad3("E4-w2b", { type: "with", after: "E4-w2a", delay: 0 }, [u("manaLeech", 1)], [[68, 0, -60]], "door", "GZ-S"),
      squad3("E4-w3a", { type: "onRemain", n: 2 }, [u("midget", 5), u("manaLeech", 1)], line([50, 0, -60], 6, 1.3, 0), "door", "GZ-N and GZ-S"),
      squad3("E4-w3b", { type: "with", after: "E4-w3a", delay: 0 }, [u("sewerMidget", 3)], line([70, 0, -60], 3, 1.3, 0), "burrow", "GZ-M3 and GZ-M1"),
      squad3("E4-w4a", { type: "onRemain", n: 2 }, [u("hexWisp", 3)], line([52, 1.2, -60], 3, 1.4, 0), "hidden", "GZ-E"),
      squad3("E4-w4b", { type: "with", after: "E4-w4a", delay: 0 }, [u("midget", 3)], line([72, 0, -60], 3, 1.3, 0), "door", "GZ-S")
    ]
  };
  var E5 = {
    id: "S3-E5",
    name: "First Bridge",
    maxAlive: 10,
    intensity: 0.6,
    objective: { kind: "clearAll" },
    activate: { min: [8, -2, -100], max: [100, 6, -20] },
    squads: [
      squad3("E5-a", { type: "onEnter" }, [u("barkBrute", 1)], [[43, 0, -60]], "placed", "middle of Bridge 1, in the runoff that strips bark"),
      squad3("E5-b", { type: "onKills", n: 1 }, [u("boomMidget", 4)], line([70, 0, -60], 4, 1.4, 0), "door", "pump shack PS1, 0.6s apart"),
      squad3("E5-c", { type: "onRemain", n: 1 }, [u("barkBrute", 1), u("midget", 4)], [[74, 0, -40], ...line([78, 0, -60], 4, 1.4, 0)], "door", "PS1, midgets 2s late, brute in RP1")
    ]
  };
  var E6 = {
    id: "S3-E6",
    name: "Runoff Flats",
    maxAlive: 10,
    intensity: 0.65,
    objective: { kind: "clearAll" },
    activate: { min: [130, -2, -110], max: [200, 6, -20] },
    plates: ["S3-PP1", "S3-PP2"],
    designObjective: "switch: PP1 and PP2 held together for 1s, then clearAll",
    squads: [
      squad3("E6-a", { type: "onEnter" }, [u("gooGlob", 1)], [[150, 0, -60]], "placed", "in pool RP3"),
      squad3("E6-b", { type: "onRemain", n: 0 }, [u("robotLaser", 2)], [[200, 0, -60], [204, 0, -60]], "hidden", "far-bank crates FC1 FC2"),
      squad3("E6-c", { type: "with", after: "E6-b", delay: 0 }, [u("sewerMidget", 4)], line([155, 0, -60], 4, 1.4, 0), "burrow", "onSwitch of the first plate, S3-BM1..4"),
      squad3("E6-d", { type: "onKills", n: 7 }, [u("gooGlob", 1), u("midget", 3)], line([210, 0, -60], 4, 1.4, 0), "door", "Bridge 3 grown, PS2, midgets 3s late")
    ]
  };
  var E7 = {
    id: "S4-E7",
    name: "The Hothouse",
    maxAlive: 10,
    intensity: 0.85,
    objective: { kind: "clearAll" },
    activate: { min: [34, -2, -67], max: [98, 9, -23] },
    lockdown: {
      entry: "LD2-IN",
      exit: "LD2-OUT",
      threshold: { min: [38, -1, -48], max: [42, 3, -42] },
      room: { min: [34, 0, -67], max: [98, 8, -23] },
      waves: 4,
      fallbackSec: 25
    },
    squads: [
      squad3("E7-w1a", { type: "onEnter" }, [u("daycare", 1, { spawnBudget: 5 })], [[50, 0, -45]], "placed", "nest A, core opens 1.5s at each spawn"),
      squad3("E7-w1b", { type: "with", after: "E7-w1a", delay: 0 }, [u("midget", 5)], line([54, 0, -45], 5, 1.3, 0), "summon", "budget 5, two every 6s once the nest ticker exists"),
      squad3("E7-w2a", { type: "onRemain", n: 2 }, [u("floretSprout", 2)], [[60, 0, -45], [63, 0, -45]], "door", "HH-CE"),
      squad3("E7-w2b", { type: "with", after: "E7-w2a", delay: 0 }, [u("sewerMidget", 4)], line([66, 0, -45], 4, 1.3, 0), "burrow", "HH-M1 and HH-M3"),
      squad3("E7-w3a", { type: "onRemain", n: 2 }, [u("daycare", 1, { spawnBudget: 5 }), u("midget", 5)], [[74, 0, -45], ...line([78, 0, -45], 5, 1.2, 0)], "drop", "HH-ROOF nest B"),
      squad3("E7-w3b", { type: "with", after: "E7-w3a", delay: 0 }, [u("manaLeech", 1)], [[84, 0, -45]], "door", "HH-S"),
      squad3("E7-w3c", { type: "with", after: "E7-w3a", delay: 0 }, [u("hexWisp", 2)], [[86, 1.2, -45], [88, 1.2, -45]], "hidden", "HH-N through the glass"),
      squad3("E7-w4", { type: "onRemain", n: 2 }, [u("barkBrute", 1), u("midget", 4)], [[66, 0, -66], ...line([70, 0, -45], 4, 1.3, 0)], "door", "HH-N brute in the north runoff, midgets on the lane")
    ]
  };
  var E8 = {
    id: "S4-E8",
    name: "Compost Yard",
    maxAlive: 10,
    intensity: 0.5,
    objective: { kind: "clearAll" },
    activate: { min: [106, -2, -80], max: [168, 6, -20] },
    squads: [
      squad3("E8-a", { type: "onEnter" }, [u("gooGlob", 1)], [[134, 0, -45]], "placed", "in pool RP5"),
      squad3("E8-b", { type: "time", t: 2 }, [u("boomMidget", 3)], line([140, 0, -45], 3, 1.4, 0), "door", "onAlert, shed S4-CSH, 0.6s apart"),
      squad3("E8-c", { type: "onRemain", n: 2 }, [u("hexWisp", 2), u("midget", 2)], line([148, 0, -45], 4, 1.4, 0), "hidden", "bins CB3 CB5 and behind CB4")
    ]
  };
  var F1 = {
    id: "S5-F1",
    name: "The Compost Hex",
    maxAlive: 10,
    intensity: 0.95,
    objective: { kind: "boss" },
    boss: "hexAuditor",
    arena: { x: 45, z: -80, radius: 34 },
    activate: { min: [20, -2, -114], max: [70, 12, -46] },
    lockdown: {
      entry: "LD3-IN",
      exit: "LD3-OUT",
      threshold: { min: [42, -1, -54], max: [48, 3, -50] },
      room: { min: [11, 0, -114], max: [79, 12, -46] },
      waves: 3,
      fallbackSec: null
    },
    parts: [
      { id: "audit", kind: "phase", hpFrom: 3e3, hpTo: 1800, ends: "60% HP", seconds: 50 },
      { id: "rooted", kind: "intermission", ends: "third totem destroyed", seconds: 55, totems: ["TOT-N", "TOT-SE", "TOT-SW"] },
      { id: "liquidation", kind: "phase", hpFrom: 1800, hpTo: 0, ends: "0 HP", seconds: 80, floodAt: 0.25 }
    ],
    squads: [
      squad3("F1-boss", { type: "onEnter" }, [u("hexAuditor", 1)], [[45, 1.6, -80]], "placed", "arena centre C"),
      squad3("F1-p1a", { type: "onBossHp", p: 85 }, [u("midget", 5)], line([45, 0, -90], 5, 1.4, 0), "burrow", "RM2 and RM5"),
      squad3("F1-p1b", { type: "onBossHp", p: 70 }, [u("hexWisp", 2)], [[48, 1.2, -80], [42, 1.2, -80]], "summon", "HEAP"),
      squad3("F1-p2a", { type: "onBossHp", p: 60 }, [u("sewerMidget", 3)], [[45, 0, -100], [47, 0, -100], [43, 0, -100]], "burrow", "TOT-N, shots break the post on the way"),
      squad3("F1-p2b", { type: "onBossHp", p: 60 }, [u("manaLeech", 1), u("midget", 3)], line([55, 0, -80], 4, 1.4, 0), "summon", "TOT-SE"),
      squad3("F1-p2c", { type: "onBossHp", p: 60 }, [u("barkBrute", 1, { elite: true })], [[26, 0, -69]], "burrow", "TOT-SW elite, runoff strips bark"),
      squad3("F1-p2d", { type: "onBossHp", p: 60 }, [u("midget", 3)], line([45, 0, -96], 3, 1.4, 0), "burrow", "onPartDestroyed TOT-N, RM1 and RM6"),
      squad3("F1-p3a", { type: "onBossHp", p: 45 }, [u("boomMidget", 3)], line([40, 0, -80], 3, 1.4, 0), "burrow", "RM3 and RM4"),
      squad3("F1-p3b", { type: "onBossHp", p: 25 }, [u("hexWisp", 2)], [[50, 1.2, -80], [40, 1.2, -80]], "summon", "HEAP, flood starts"),
      squad3("F1-p3c", { type: "onBossHp", p: 12 }, [u("sewerMidget", 3)], line([45, 0, -86], 3, 1.4, 0), "burrow", "RM1 RM3 RM5")
    ]
  };
  var F2 = {
    id: "S6-F2",
    name: "Broccoli Head Sprout",
    maxAlive: 10,
    intensity: 0.7,
    objective: { kind: "boss" },
    boss: "broccoli",
    fleeAt: 0.5,
    fleeTo: "S6-LG",
    activate: { min: [12, -2, -65], max: [58, 6, -16] },
    squads: [
      squad3("F2-boss", { type: "onEnter" }, [u("broccoli", 1)], [[36, 0.6, -40]], "placed", "on the vape tank, stage 1 only"),
      squad3("F2-a", { type: "time", t: 8 }, [u("midget", 3)], line([36, 0, -48], 3, 1.4, 0), "door", "PT-N"),
      squad3("F2-b", { type: "onBossHp", p: 80 }, [u("midget", 3)], line([30, 0, -40], 3, 1.4, 0), "door", "PT-W"),
      squad3("F2-c", { type: "onBossHp", p: 65 }, [u("floretSprout", 2)], [[42, 0, -40], [46, 0, -40]], "hidden", "behind GV1 and GV2")
    ]
  };
  var F3 = {
    id: "S6-F3",
    name: "Runoff Escape",
    maxAlive: 10,
    intensity: 0.6,
    objective: { kind: "escape" },
    zone: { min: [126, -2, -52], max: [144, 14, -36] },
    activate: { min: [126, -2, -52], max: [144, 14, -36] },
    squads: [
      squad3("F3-a", { type: "onEnter" }, [u("sewerMidget", 2)], [[134, 9, -44], [136, 9, -46]], "burrow", "terrace 1, EM1 EM2"),
      squad3("F3-b", { type: "onEnter" }, [u("floretSprout", 2)], [[132, 9, -42], [138, 9, -44]], "placed", "terrace 2"),
      squad3("F3-c", { type: "time", t: 8 }, [u("sewerMidget", 2)], [[134, 9, -40], [136, 9, -48]], "burrow", "onEnter terrace 2, EM3 EM4"),
      squad3("F3-d", { type: "time", t: 12 }, [u("floretSprout", 2)], [[130, 9, -44], [140, 9, -44]], "placed", "levee, can be outrun")
    ]
  };
  var ENCOUNTERS = { E1, E2, E3, E4, E5, E6, E7, E8, F1, F2, F3 };
  var EXPECTED_COUNTS = {
    midget: 67,
    sewerMidget: 34,
    hexWisp: 16,
    boomMidget: 13,
    floretSprout: 11,
    manaLeech: 5,
    barkBrute: 4,
    gooGlob: 3,
    flyingMidget: 3,
    obama: 2,
    robotLaser: 2,
    daycare: 2,
    riotMidget: 1,
    hexAcolyte: 1
  };

  // src/data/levels/L03/S1.js
  var trees = [];
  for (const z of [-152, -8]) {
    for (let i = 0; i < 7; i++) {
      trees.push(...place(tree(), { at: [18 + i * 36, 0, z], id: `S1-TREE-${z}-${i}` }));
    }
  }
  var cabbageR = [2.2, 2.6, 3, 2.4, 2.6, 2.2, 3, 2.4];
  var cabbageAt = [[74, 1.6, -70], [84, 2, -104], [96, 2.4, -84], [104, 1.8, -116], [112, 2, -66], [120, 1.6, -92], [134, 2.4, -78], [142, 1.8, -110]];
  var pumpR = [1.6, 2.2, 1.8, 2.4, 2, 1.6, 2.4, 1.8];
  var pumpAt = [[178, 1.1, -72], [186, 1.7, -94], [194, 1.3, -112], [200, 1.9, -78], [210, 1.5, -100], [216, 1.1, -120], [238, 1.9, -106], [246, 1.3, -86]];
  function spheres(prefix, radii, ats, mat) {
    return radii.map((r, i) => ({
      kind: "sphere",
      id: `${prefix}${i + 1}`,
      at: ats[i],
      r,
      mat
    }));
  }
  var S12 = {
    id: "S1",
    name: "Crop Fields",
    origin: [0, 0, 0],
    start: [18, 0, -80],
    yaw: -Math.PI / 2,
    footprint: [260, 160],
    routeM: 290,
    navBounds: { min: [0, -160], max: [260, 0] },
    exit: { min: [259, -1, -83], max: [264, 4, -77] },
    intro: { title: "The Vegetable Grove", lines: ["The Cabal grows it here.", "Bullets are a second opinion. Bring spells."] },
    geometry: [
      box({ id: "S1-FL", at: [130, -0.25, -80], size: [260, 0.5, 160], mat: "grass" }),
      // `at` is only so the level view can skip this. It reads at[1] before the kind, and terrain has no mesh yet.
      { kind: "terrain", id: "S1-T", at: [130, 0, -80], origin: [0, 0, -160], size: [260, 160], cell: 2, seed: 301, mat: "grass", noise: { amp: 0.4, freq: 0.03, octaves: 1 } },
      box({ id: "S1-WN", at: [130, 3, -159], size: [260, 6, 2], mat: "hedge" }),
      box({ id: "S1-WS", at: [130, 3, -1], size: [260, 6, 2], mat: "hedge" }),
      box({ id: "S1-WW", at: [1, 3, -80], size: [2, 6, 160], mat: "hedge" }),
      box({ id: "S1-WE1", at: [259, 3, -38.5], size: [2, 6, 77], mat: "hedge" }),
      box({ id: "S1-WE2", at: [259, 3, -121.5], size: [2, 6, 77], mat: "hedge" }),
      ...place(truck(), { at: [10, 0, -80], yaw: 90, id: "S1-TRK" }),
      ...place(shrine(), { at: [34, 0, -88], id: "SH-YEET" }),
      ...place(podStump(), { at: [46, 0, -74], id: "S1-ST1" }),
      ...place(podStump(), { at: [46, 0, -80], id: "S1-ST2" }),
      ...place(podStump(), { at: [46, 0, -86], id: "S1-ST3" }),
      ...place(scarecrow(), { at: [58, 0, -74], id: "S1-SC1" }),
      ...place(scarecrow(), { at: [58, 0, -80], id: "S1-SC2" }),
      ...place(scarecrow(), { at: [58, 0, -86], id: "S1-SC3" }),
      box({ id: "S1-LB", at: [64, 1.5, -80], size: [2, 3, 6], mat: "wood", tag: "target" }),
      box({ id: "S1-F1", at: [64, 1.5, -39.5], size: [2, 3, 75], mat: "wood" }),
      box({ id: "S1-F2", at: [64, 1.5, -120.5], size: [2, 3, 75], mat: "wood" }),
      ...spheres("S1-CB", cabbageR, cabbageAt, "grass"),
      box({ id: "S1-CW1", at: [86, 1.2, -60], size: [12, 2.4, 1.5], mat: "hedge" }),
      box({ id: "S1-CW2", at: [108, 1.2, -100], size: [12, 2.4, 1.5], mat: "hedge" }),
      box({ id: "S1-CW3", at: [126, 1.2, -124], size: [12, 2.4, 1.5], mat: "hedge" }),
      box({ id: "S1-CW4", at: [140, 1.2, -60], size: [12, 2.4, 1.5], mat: "hedge" }),
      ...place(scarecrowTower(), { at: [100, 0, -50], id: "S1-T1" }),
      ...place(scarecrowTower(), { at: [128, 0, -112], id: "S1-T2" }),
      ...place(tractor(), { at: [78, 0, -92], yaw: 20, id: "S1-TR1" }),
      ...place(shed(), { at: [124, 0, -62], yaw: 180, id: "S1-SD1" }),
      ...place(shed(), { at: [144, 0, -96], yaw: 270, id: "S1-SD2" }),
      box({ id: "S1-CNL", at: [157, -0.2, -80], size: [10, 0.5, 156], mat: "toxic" }),
      box({ id: "S1-PB1", at: [157, 0.25, -136], size: [12, 0.5, 3], mat: "wood" }),
      ...spheres("S1-PK", pumpR, pumpAt, "gold"),
      box({ id: "S1-BN1", at: [228, 4, -54.25], size: [18, 8, 0.5], mat: "wood" }),
      box({ id: "S1-BN2", at: [219.25, 4, -60], size: [0.5, 8, 12], mat: "wood" }),
      box({ id: "S1-BN3", at: [236.75, 4, -60], size: [0.5, 8, 12], mat: "wood" }),
      box({ id: "S1-BN4", at: [222.5, 4, -65.75], size: [7, 8, 0.5], mat: "wood" }),
      box({ id: "S1-BN5", at: [233.5, 4, -65.75], size: [7, 8, 0.5], mat: "wood" }),
      box({ id: "S1-BN6", at: [228, 8.25, -60], size: [19, 0.5, 13], mat: "wood" }),
      box({ id: "S1-BN7", at: [228, 4, -57], size: [17, 0.5, 5], mat: "wood" }),
      stairs({ id: "S1-BN8", at: [221.5, 2, -61.5], size: [3, 4, 7], yaw: 0, mat: "wood" }),
      cylinder({ id: "S1-SI", at: [250, 0, -50], r: 4, h: 14, mat: "metal" }),
      cone({ id: "S1-SI-cap", at: [250, 14, -50], r: 4.4, h: 3, mat: "metal" }),
      box({ id: "S1-HB1", at: [190, 0.6, -66], size: [2, 1.2, 1.2], mat: "sand" }),
      box({ id: "S1-HB2", at: [204, 0.6, -90], size: [2, 1.2, 1.2], mat: "sand" }),
      box({ id: "S1-HB3", at: [222, 0.6, -88], size: [2, 1.2, 1.2], mat: "sand" }),
      box({ id: "S1-HB4", at: [232, 1.2, -114], size: [2, 2.4, 1.2], mat: "sand" }),
      box({ id: "S1-HB5", at: [244, 0.6, -72], size: [2, 1.2, 1.2], mat: "sand" }),
      box({ id: "S1-HB6", at: [214, 1.2, -72], size: [2, 2.4, 1.2], mat: "sand" }),
      ...place(beanstalk(), { at: [244, 0, -142], id: "S1-BS" }),
      ...place(manaBloom(), { at: [52, 0, -92], id: "MB1" }),
      ...place(manaBloom(), { at: [108, 0, -86], id: "MB2" }),
      ...place(manaBloom(), { at: [174, 0, -80], id: "MB3" }),
      ...place(manaBloom(), { at: [228, 4.5, -57], id: "MB4" }),
      disc({ id: "S1-MP1-pad", at: [95, 0.05, -54], r: 1.2, mat: "neon" }),
      disc({ id: "S1-MP2-pad", at: [123, 0.05, -108], r: 1.2, mat: "neon" }),
      disc({ id: "S1-MP3-pad", at: [149, 0.05, -80], r: 1.2, mat: "neon" }),
      sphere({ id: "S1-GA-GATE-mark", at: [232, 6, -80], r: 0.45, mat: "neon" }),
      sphere({ id: "S1-GA-LEAF-mark", at: [240.5, 6.2, -142], r: 0.45, mat: "neon" }),
      sphere({ id: "S1-GA-CROWN-mark", at: [240, 22, -145], r: 0.45, mat: "neon" }),
      disc({ id: "S1-MP4-pad", at: [165, 0.05, -84], r: 1.2, mat: "neon" }),
      ...trees
    ],
    weapons: [
      { id: "W1", at: [80, 0.9, -94], gun: "sniper", why: "E1: Obamas on the towers, Sprouts across the field" }
    ],
    checkpoints: [
      { id: "CP1", at: [34, 0, -80] },
      { id: "CP2", at: [168, 0, -80], when: "S1-E1.cleared" }
    ],
    mechanisms: [
      { kind: "door", id: "S1-GATE", at: [259, 2.5, -80], size: [1, 5, 6], opens: "S1-E2.cleared" },
      { kind: "shrine", id: "SH-YEET-use", at: [34, 1, -88], spell: "yeet" },
      { kind: "seedPod", id: "S1-POD1", at: [46, 1.1, -74], regrow: 12, damage: 150, radius: 4 },
      { kind: "seedPod", id: "S1-POD2", at: [46, 1.1, -80], regrow: 12, damage: 150, radius: 4 },
      { kind: "seedPod", id: "S1-POD3", at: [46, 1.1, -86], regrow: 12, damage: 150, radius: 4 },
      { kind: "target", id: "S1-LB-hp", at: [64, 1.5, -80], hp: 200, bulletMul: 0.2, podHits: 2 },
      { kind: "target", id: "S1-SC1-hp", at: [58, 1.2, -74], hp: 1 },
      { kind: "target", id: "S1-SC2-hp", at: [58, 1.2, -80], hp: 1 },
      { kind: "target", id: "S1-SC3-hp", at: [58, 1.2, -86], hp: 1 },
      { kind: "jumpPad", id: "S1-MP1", at: [95, 0.2, -54], r: 1.2, power: 11, to: [100, 5.5, -50] },
      { kind: "jumpPad", id: "S1-MP2", at: [123, 0.2, -108], r: 1.2, power: 11, to: [128, 5.5, -112] },
      { kind: "jumpPad", id: "S1-MP3", at: [149, 0.2, -80], r: 1.2, power: 9, to: [166, 0, -80] },
      { kind: "jumpPad", id: "S1-MP4", at: [165, 0.2, -84], r: 1.2, power: 9, to: [148, 0, -84] },
      { kind: "jumpPad", id: "S1-BS-P0", at: [236, 0.2, -142], r: 1.2, power: 11, to: [240.5, 5, -142] },
      { kind: "jumpPad", id: "S1-BS-P1", at: [240.5, 5.2, -142], r: 1.2, power: 11, to: [244, 10.5, -138.5] },
      { kind: "jumpPad", id: "S1-BS-P2", at: [244, 10.7, -138.5], r: 1.2, power: 11, to: [247.5, 16, -142] },
      { kind: "jumpPad", id: "S1-BS-P3", at: [247.5, 16.2, -142], r: 1.2, power: 11, to: [244, 21.5, -145.5] },
      { kind: "hazard", id: "S1-CNL-HZ", min: [152, -1, -158], max: [162, 2, -2], dps: 12, enemyDps: 40, element: "toxic" },
      { kind: "manaBloom", id: "MB1-use", at: [52, 0.6, -92], mana: 50, regrow: 20 },
      { kind: "manaBloom", id: "MB2-use", at: [108, 0.6, -86], mana: 50, regrow: 20 },
      { kind: "manaBloom", id: "MB3-use", at: [174, 0.6, -80], mana: 50, regrow: 20 },
      { kind: "manaBloom", id: "MB4-use", at: [228, 4.8, -57], mana: 50, regrow: 20 },
      { kind: "ammo", id: "AB1", at: [30, 0.4, -84], ammoType: "bullets", amount: 60 },
      { kind: "ammo", id: "AB2", at: [76, 0.4, -95], ammoType: "sniper", amount: 8 },
      { kind: "ammo", id: "AB3", at: [168, 0.4, -76], ammoType: "shells", amount: 12 },
      { kind: "secret", id: "S1-BONK", at: [244, 22.5, -145.5], modifier: "floorIsLava" },
      { kind: "secret", id: "S1-AF1", at: [100, 6.2, -50], tickets: 15, story: "Invoice: 400 scarecrows. None of them scare." }
    ],
    encounters: [ENCOUNTERS.E1, ENCOUNTERS.E2],
    // Optional swings. The lane and the beanstalk pads still work at a walk.
    grappleAnchors: [
      { id: "S1-GA-GATE", at: [232, 6, -80], r: 2.2 },
      { id: "S1-GA-LEAF", at: [240.5, 6.2, -142], r: 1.8 },
      { id: "S1-GA-CROWN", at: [240, 22, -145], r: 2 }
    ],
    navLinks: [
      { from: { x: 95, z: -54 }, to: { x: 100, z: -50 }, kind: "pad" },
      { from: { x: 123, z: -108 }, to: { x: 128, z: -112 }, kind: "pad" },
      { from: { x: 149, z: -80 }, to: { x: 166, z: -80 }, kind: "pad" },
      { from: { x: 165, z: -84 }, to: { x: 148, z: -84 }, kind: "pad" }
    ]
  };

  // src/data/levels/L03/S2.js
  var rings = [
    ...hedgeRing("S2-HB", { a: 0, b: 2, h: 5, west: { at: -60, width: 6 }, east: { at: -60, width: 5 } }),
    ...hedgeRing("S2-H1", { a: 7, b: 10, h: 3.5, west: [{ at: -30, width: 4 }, { at: -60, width: 5 }], north: { at: 30, width: 4 }, east: { at: -60, width: 5 } }),
    ...hedgeRing("S2-H2", { a: 14, b: 17, h: 3.5, west: [{ at: -70, width: 4 }, { at: -60, width: 5 }], north: { at: 50, width: 4 }, east: { at: -60, width: 5 } }),
    ...hedgeRing("S2-H3", { a: 21, b: 24, h: 3.5, west: [{ at: -50, width: 4 }, { at: -60, width: 5 }], north: { at: 64, width: 4 }, east: { at: -60, width: 5 } }),
    ...hedgeRing("S2-H4", { a: 28, b: 31, h: 3.5, west: [{ at: -66, width: 4 }, { at: -60, width: 5 }], north: { at: 56, width: 4 }, east: { at: -60, width: 5 } }),
    ...hedgeRing("S2-H5", { a: 35, b: 38, h: 9, west: { at: -60, width: 4 }, north: { at: 60, width: 4 }, east: { at: -60, width: 4 }, south: { at: 60, width: 4 } })
  ];
  var mounds = [[4.5, -50], [4.5, -40], [4.5, -74], [12, -38], [19, -62], [26, -58], [43, -43], [77, -43], [43, -77], [77, -77]];
  var S22 = {
    id: "S2",
    name: "Hedge Maze",
    origin: [259, 0, -20],
    start: [3, 0, -60],
    yaw: -Math.PI / 2,
    footprint: [120, 120],
    routeM: 232,
    navBounds: { min: [0, -120], max: [120, 0] },
    exit: { min: [120, -1, -64], max: [126, 4, -56] },
    geometry: [
      box({ id: "S2-FL", at: [60, -0.25, -60], size: [128, 0.5, 120], mat: "grass" }),
      ...rings,
      box({ id: "S2-LIN1", at: [101.5, 1.75, -57], size: [33, 3.5, 1], mat: "hedge" }),
      box({ id: "S2-LIN2", at: [101.5, 1.75, -63], size: [33, 3.5, 1], mat: "hedge" }),
      box({ id: "S2-BLKB", at: [12, 1.75, -98], size: [4, 3.5, 1], mat: "hedge" }),
      box({ id: "S2-BLKD", at: [26, 1.75, -36], size: [4, 3.5, 1], mat: "hedge" }),
      ...mounds.flatMap(([x, z], i) => place(mound(), { at: [x, 0, z], id: `S2-BM${i + 1}` })),
      box({ id: "S2-LID", at: [60, 9.25, -60], size: [50, 0.5, 50], mat: "glass" }),
      ...place(gazebo(), { at: [60, 0, -60], id: "S2-GZ" }),
      box({ id: "S2-BN1", at: [50, 0.6, -50], size: [3, 1.2, 1], mat: "stone" }),
      box({ id: "S2-BN2", at: [70, 0.6, -50], size: [3, 1.2, 1], mat: "stone" }),
      box({ id: "S2-BN3", at: [50, 0.6, -70], size: [3, 1.2, 1], mat: "stone" }),
      box({ id: "S2-BN4", at: [70, 0.6, -70], size: [3, 1.2, 1], mat: "stone" }),
      ...place(topiary(), { at: [44, 0, -52], id: "S2-TP1" }),
      ...place(topiary(), { at: [76, 0, -68], id: "S2-TP2" }),
      ...place(topiary(), { at: [60, 0, -44], id: "S2-TP3" }),
      ...place(topiary(), { at: [60, 0, -76], id: "S2-TP4" }),
      cylinder({ id: "S2-UR1", at: [54, 0, -42], r: 1, h: 1.2, mat: "stone" }),
      cylinder({ id: "S2-UR2", at: [66, 0, -42], r: 1, h: 1.2, mat: "stone" }),
      cylinder({ id: "S2-UR3", at: [54, 0, -78], r: 1, h: 1.2, mat: "stone" }),
      cylinder({ id: "S2-UR4", at: [66, 0, -78], r: 1, h: 1.2, mat: "stone" }),
      ...place(manaBloom(), { at: [19, 0, -92], id: "MB5" }),
      ...place(manaBloom(), { at: [79, 0, -66], id: "MB6" }),
      ...place(manaBloom(), { at: [41, 0, -48], id: "MB6b" }),
      ...place(manaBloom(), { at: [96, 0, -60], id: "MB7" }),
      disc({ id: "S2-THR", at: [44, 0.05, -60], r: 2, mat: "neon" }),
      disc({ id: "S2-GZP-pad", at: [66.5, 0.05, -60], r: 1.2, mat: "neon" }),
      sphere({ id: "S2-GA-GZ-mark", at: [48, 7, -60], r: 0.45, mat: "neon" })
    ],
    weapons: [
      { id: "W2", at: [3, 0.9, -57], gun: "shotgun", why: "E3: burrowers at arm's length in 4 m corridors" },
      { id: "W3", at: [3, 0.9, -63], gun: "mg", why: "E3 and E4: packs of fodder" }
    ],
    checkpoints: [
      { id: "CP3", at: [3, 0, -60] },
      { id: "CP4", at: [26, 0, -62], when: "S2-E3.cleared" },
      { id: "CP5", at: [86, 0, -60], when: "S2-E4.cleared" }
    ],
    mechanisms: [
      door3("LD1-IN", [37.7, 4.5, -60], [0.6, 9, 4]),
      door3("LD1-OUT", [82.3, 4.5, -60], [0.6, 9, 4]),
      door3("S2-XD", [110, 1.75, -60], [1, 3.5, 5], { opens: "S2-CD2" }),
      door3("HD1", [12, 1.75, -98], [4, 3.5, 1]),
      door3("HD2", [26, 1.75, -36], [4, 3.5, 1]),
      { kind: "mover", id: "S2-TG-N", at: [29.5, 1.2, -65], from: [29.5, 1.2, -65], to: [29.5, 1.2, -66], size: [0.5, 2.4, 2], crush: 40, closed: 0.8, open: 0.4 },
      { kind: "mover", id: "S2-TG-S", at: [29.5, 1.2, -67], from: [29.5, 1.2, -67], to: [29.5, 1.2, -66], size: [0.5, 2.4, 2], crush: 40, closed: 0.8, open: 0.4 },
      { kind: "gooGear", id: "S2-GG1", at: [29.5, 1.5, -63.6], radius: 0.5, holds: "S2-TG-N", seconds: 4 },
      { kind: "conduit", id: "S2-CD1", at: [65, 2, -60], radius: 0.4, spell: "chainZap", stun: 2, radiusEffect: 8, recharge: 20 },
      { kind: "conduit", id: "S2-CD2", at: [106, 1.5, -57.6], radius: 0.4, barkCap: true },
      { kind: "jumpPad", id: "S2-GZP", at: [66.5, 0.2, -60], r: 1.2, power: 10, to: [60, 4.5, -60] },
      { kind: "manaBloom", id: "MB5-use", at: [19, 0.6, -92], mana: 50, regrow: 20 },
      { kind: "manaBloom", id: "MB6-use", at: [79, 0.6, -66], mana: 50, regrow: 20 },
      { kind: "manaBloom", id: "MB6b-use", at: [41, 0.6, -48], mana: 50, regrow: 20 },
      { kind: "manaBloom", id: "MB7-use", at: [96, 0.6, -60], mana: 50, regrow: 20 },
      { kind: "ammo", id: "AB4", at: [6, 0.4, -57], ammoType: "shells", amount: 12 },
      { kind: "ammo", id: "AB5", at: [6, 0.4, -63], ammoType: "bullets", amount: 60 },
      { kind: "ammo", id: "AB6", at: [26, 0.4, -60], ammoType: "shells", amount: 12 },
      { kind: "ammo", id: "AB7", at: [41, 0.4, -66], ammoType: "bullets", amount: 60 },
      { kind: "ammo", id: "AB8", at: [41, 0.4, -54], ammoType: "shells", amount: 12 },
      { kind: "ammo", id: "AB9", at: [88, 0.4, -60], ammoType: "sniper", amount: 8 },
      { kind: "ammoCrate", id: "RC1", at: [80, 0.4, -58], uses: 3, fraction: 0.5 },
      { kind: "chest", id: "L1-CHEST", at: [80, 0.5, -62], opens: "S2-E4.cleared", tier: "uncommon" },
      { kind: "secret", id: "S2-BAT", at: [108, 0.5, -104], mana: 10, regen: 0.5 },
      { kind: "secret", id: "S2-AF2", at: [101, 0.4, -54], tickets: 15, story: "The maze is a tax shelter. Nothing in the middle is declared." }
    ],
    encounters: [ENCOUNTERS.E3, ENCOUNTERS.E4],
    // West of the gazebo roof, in the z = -60 gap, so a hook from the lane clears the hedge.
    grappleAnchors: [
      { id: "S2-GA-GZ", at: [48, 7, -60], r: 2.2 }
    ]
  };

  // src/data/levels/L03/S3.js
  var mounds2 = [[138, -42], [148, -30], [160, -90], [170, -80]];
  var S32 = {
    id: "S3",
    name: "Toxic Creek",
    origin: [379, 0, -20],
    start: [4, 0, -60],
    yaw: -Math.PI / 2,
    footprint: [230, 120],
    routeM: 230,
    navBounds: { min: [0, -120], max: [230, 0] },
    exit: { min: [228, -1, -64], max: [234, 4, -56] },
    voids: [{ id: "S3-CRK", min: [30, -20, -118], max: [196, -1, -2], to: [20, 0, -60], penalty: 0.15 }],
    geometry: [
      box({ id: "S3-CRK", at: [115, -8.25, -60], size: [230, 0.5, 120], mat: "toxic" }),
      box({ id: "S3-APR", at: [-4, -0.25, -60], size: [12, 0.5, 16], mat: "grass" }),
      box({ id: "S3-DECK", at: [115, -0.25, -60], size: [400, 0.5, 400], mat: "grass" }),
      box({ id: "S3-WN", at: [115, 0.15, -119], size: [230, 0.5, 2], mat: "rock" }),
      box({ id: "S3-WS", at: [115, 0.15, -1], size: [230, 0.5, 2], mat: "rock" }),
      box({ id: "S3-WW1", at: [1, 3, -28.5], size: [2, 6, 57], mat: "hedge" }),
      box({ id: "S3-WW2", at: [1, 3, -91.5], size: [2, 6, 57], mat: "hedge" }),
      box({ id: "S3-WE1", at: [229, 3, -28.5], size: [2, 6, 57], mat: "hedge" }),
      box({ id: "S3-WE2", at: [229, 3, -91.5], size: [2, 6, 57], mat: "hedge" }),
      box({ id: "S3-NB", at: [15, -4, -60], size: [30, 8, 116], mat: "grass" }),
      box({ id: "S3-IA", at: [81, -4, -60], size: [50, 8, 76], mat: "grass" }),
      box({ id: "S3-IB", at: [152, -4, -60], size: [40, 8, 80], mat: "grass" }),
      box({ id: "S3-FB", at: [213, -4, -60], size: [34, 8, 116], mat: "grass" }),
      box({ id: "S3-BR1", at: [43, -0.25, -60], size: [26, 0.5, 8], mat: "wood" }),
      box({ id: "S3-BR2", at: [119, -0.25, -50], size: [26, 0.5, 8], mat: "wood", tag: "collapse" }),
      box({ id: "S3-BR3", at: [184, -0.25, -60], size: [24, 0.5, 8], mat: "wood", tag: "energyBridge" }),
      box({ id: "S3-NC1", at: [20, 0.6, -56], size: [2, 1.2, 2], mat: "crate" }),
      box({ id: "S3-NC2", at: [24, 0.6, -64], size: [2, 1.2, 2], mat: "crate" }),
      box({ id: "S3-NC3", at: [17, 0.6, -62], size: [2, 1.2, 2], mat: "crate" }),
      { kind: "sphere", id: "S3-AB1", at: [62, 1, -50], r: 1.6, mat: "rock" },
      { kind: "sphere", id: "S3-AB2", at: [66, 1, -72], r: 1.6, mat: "rock" },
      box({ id: "S3-AC1", at: [72, 0.6, -56], size: [2, 1.2, 2], mat: "crate" }),
      box({ id: "S3-AC2", at: [76, 0.6, -66], size: [2, 1.2, 2], mat: "crate" }),
      box({ id: "S3-AC3", at: [70, 0.6, -62], size: [2, 1.2, 2], mat: "crate" }),
      box({ id: "S3-ALOG", at: [84, 0.6, -76], size: [6, 1.2, 1.2], mat: "wood" }),
      disc({ id: "S3-RP1", at: [74, 0.05, -40], r: 5, mat: "toxic" }),
      ...place(shed(), { at: [80, 0, -88], yaw: 0, id: "S3-PS1" }),
      ...place(shrine(), { at: [92, 0, -42], id: "SH-SWARM" }),
      cylinder({ id: "S3-SP1", at: [114, -8, -74], r: 2, h: 8, mat: "rock" }),
      cylinder({ id: "S3-SP2", at: [124, -8, -70], r: 2, h: 8, mat: "rock" }),
      cylinder({ id: "S3-SP3", at: [119, -8, -92], r: 2, h: 8, mat: "rock" }),
      disc({ id: "S3-RP3", at: [146, 0.05, -70], r: 5, mat: "toxic" }),
      disc({ id: "S3-RP4", at: [164, 0.05, -46], r: 4, mat: "toxic" }),
      box({ id: "S3-BC1", at: [138, 0.6, -54], size: [2, 1.2, 2], mat: "crate" }),
      box({ id: "S3-BC2", at: [150, 0.6, -48], size: [2, 1.2, 2], mat: "crate" }),
      box({ id: "S3-BC3", at: [158, 0.6, -72], size: [2, 1.2, 2], mat: "crate" }),
      box({ id: "S3-BC4", at: [168, 0.6, -62], size: [2, 1.2, 2], mat: "crate" }),
      { kind: "sphere", id: "S3-BB1", at: [156, 1, -36], r: 1.6, mat: "rock" },
      { kind: "sphere", id: "S3-BB2", at: [140, 1, -84], r: 1.6, mat: "rock" },
      ...mounds2.flatMap(([x, z], i) => place(mound(), { at: [x, 0, z], id: `S3-BM${i + 1}` })),
      box({ id: "S3-FC1", at: [198, 0.6, -54], size: [2, 1.2, 2], mat: "crate" }),
      box({ id: "S3-FC2", at: [198, 0.6, -66], size: [2, 1.2, 2], mat: "crate" }),
      box({ id: "S3-FC3", at: [206, 0.6, -72], size: [2, 1.2, 2], mat: "crate" }),
      ...place(shed(), { at: [214, 0, -86], yaw: 0, id: "S3-PS2" }),
      box({ id: "S3-BGF1", at: [101, 1.5, -35], size: [1, 3, 26], mat: "wood" }),
      box({ id: "S3-BGF2", at: [101, 1.5, -83], size: [1, 3, 30], mat: "wood" }),
      ...place(manaBloom(), { at: [22, 0, -66], id: "MB8" }),
      ...place(manaBloom(), { at: [96, 0, -60], id: "MB9" }),
      ...place(manaBloom(), { at: [152, 0, -58], id: "MB10" }),
      ...place(manaBloom(), { at: [202, 0, -50], id: "MB11" }),
      disc({ id: "S3-PP0-pad", at: [90, 0.04, -50], r: 1.2, mat: "neon" }),
      disc({ id: "S3-PP1-pad", at: [142, 0.04, -36], r: 1.2, mat: "neon" }),
      disc({ id: "S3-PP2-pad", at: [166, 0.04, -86], r: 1.2, mat: "neon" })
    ],
    weapons: [],
    checkpoints: [
      { id: "CP6", at: [94, 0, -74], when: "S3-E5.cleared" }
    ],
    mechanisms: [
      { kind: "door", id: "S3-DE", at: [229, 2.5, -60], size: [1, 5, 6], opens: "S3-E6.cleared" },
      { kind: "door", id: "S3-BG", at: [101, 1.5, -50], size: [1, 3, 4], heldBy: "S3-PP0" },
      { kind: "ropeBridge", id: "S3-BR1-mech", from: [30, 0, -60], to: [56, 0, -60], width: 4 },
      { kind: "ropeBridge", id: "S3-BR2-mech", from: [106, 0, -50], to: [132, 0, -50], width: 3, collapseOn: "x>114", resetAfterRescue: 4 },
      { kind: "energyBridge", id: "S3-BR3-mech", from: [172, 0, -60], to: [196, 0, -60], width: 4, plates: ["S3-PP1", "S3-PP2"], latch: true },
      { kind: "pressurePlate", id: "S3-PP0", at: [90, 0.1, -50], r: 1.2, holds: "S3-BG" },
      { kind: "pressurePlate", id: "S3-PP1", at: [142, 0.1, -36], r: 1.2, group: "S3-BR3" },
      { kind: "pressurePlate", id: "S3-PP2", at: [166, 0.1, -86], r: 1.2, group: "S3-BR3", hold: 1 },
      { kind: "mushroomPad", id: "S3-MP5", at: [26, 0.2, -34], r: 1.2, power: 10, to: [59, 0, -34] },
      { kind: "mushroomPad", id: "S3-MP6", at: [104, 0.2, -72], r: 1, power: 8, to: [114, 0, -74] },
      { kind: "mushroomPad", id: "S3-MP7", at: [114, 0.2, -74], r: 1, power: 8, to: [124, 0, -70] },
      { kind: "mushroomPad", id: "S3-MP8", at: [124, 0.2, -70], r: 1, power: 8, to: [134, 0, -66] },
      { kind: "mushroomPad", id: "S3-MP9", at: [115.5, 0.2, -75.5], r: 1, power: 8, to: [119, 0, -92] },
      { kind: "mushroomPad", id: "S3-MP9b", at: [119, 0.2, -92], r: 1, power: 8, to: [124, 0, -70] },
      { kind: "hazard", id: "S3-RP1-HZ", min: [69, -1, -45], max: [79, 2, -35], dps: 12, enemyDps: 40, stripsBark: true, element: "toxic" },
      { kind: "hazard", id: "S3-BR1-HZ", min: [38, -1, -64], max: [48, 2, -56], dps: 12, enemyDps: 40, stripsBark: true, element: "toxic" },
      { kind: "hazard", id: "S3-BARK", min: [-8, -4, -124], max: [236, 6, 4], dps: 0, enemyDps: 0.01, stripsBark: true, element: "toxic" },
      { kind: "hazard", id: "S3-RP3-HZ", min: [141, -1, -75], max: [151, 2, -65], dps: 12, enemyDps: 40, stripsBark: true, element: "toxic" },
      { kind: "hazard", id: "S3-RP4-HZ", min: [160, -1, -50], max: [168, 2, -42], dps: 12, enemyDps: 40, stripsBark: true, element: "toxic" },
      { kind: "depot", id: "DP1", at: [94, 0, -74] },
      { kind: "shrine", id: "SH-SWARM-use", at: [92, 1, -42], spell: "swarm" },
      { kind: "power", id: "PU1", at: [103.5, 0.5, -50], modifier: "turbo" },
      { kind: "manaBloom", id: "MB8-use", at: [22, 0.6, -66], mana: 50, regrow: 20 },
      { kind: "manaBloom", id: "MB9-use", at: [96, 0.6, -60], mana: 50, regrow: 20 },
      { kind: "manaBloom", id: "MB10-use", at: [152, 0.6, -58], mana: 50, regrow: 20 },
      { kind: "manaBloom", id: "MB11-use", at: [202, 0.6, -50], mana: 50, regrow: 20 },
      { kind: "ammo", id: "AB10", at: [22, 0.4, -58], ammoType: "bullets", amount: 60 },
      { kind: "ammo", id: "AB11", at: [150, 0.4, -52], ammoType: "shells", amount: 12 },
      { kind: "secret", id: "SC1", at: [119, 0.6, -92], gun: "epic" }
    ],
    encounters: [ENCOUNTERS.E5, ENCOUNTERS.E6],
    navLinks: [
      { from: { x: 26, z: -34 }, to: { x: 59, z: -34 }, kind: "pad" },
      { from: { x: 104, z: -72 }, to: { x: 114, z: -74 }, kind: "pad" },
      { from: { x: 114, z: -74 }, to: { x: 124, z: -70 }, kind: "pad" },
      { from: { x: 124, z: -70 }, to: { x: 134, z: -66 }, kind: "pad" },
      { from: { x: 115.5, z: -75.5 }, to: { x: 119, z: -92 }, kind: "pad" }
    ]
  };

  // src/data/levels/L03/S4.js
  var S42 = {
    id: "S4",
    name: "Greenhouses",
    origin: [608, 0, -35],
    start: [8, 0, -45],
    yaw: -Math.PI / 2,
    footprint: [170, 90],
    routeM: 200,
    navBounds: { min: [0, -90], max: [170, 0] },
    exit: { min: [168, -1, -48], max: [174, 4, -42] },
    geometry: [
      box({ id: "S4-FL", at: [85, -0.25, -45], size: [400, 0.5, 400], mat: "dirt" }),
      box({ id: "S4-WN", at: [85, 3, -89], size: [170, 6, 2], mat: "hedge" }),
      box({ id: "S4-WS", at: [85, 3, -1], size: [170, 6, 2], mat: "hedge" }),
      box({ id: "S4-WW1", at: [1, 3, -21], size: [2, 6, 42], mat: "hedge" }),
      box({ id: "S4-WW2", at: [1, 3, -69], size: [2, 6, 42], mat: "hedge" }),
      box({ id: "S4-WE1", at: [169, 3, -21], size: [2, 6, 42], mat: "hedge" }),
      box({ id: "S4-WE2", at: [169, 3, -69], size: [2, 6, 42], mat: "hedge" }),
      ...place(shed(), { at: [12, 0, -22], yaw: 180, id: "S4-PSH" }),
      box({ id: "S4-PCR", at: [16, 0.75, -22], size: [1.5, 1.5, 1.5], mat: "crate" }),
      box({ id: "S4-YF1", at: [33.5, 3, -11.5], size: [1, 6, 21], mat: "hedge" }),
      box({ id: "S4-YF2", at: [33.5, 3, -78.5], size: [1, 6, 21], mat: "hedge" }),
      box({ id: "HH-WN", at: [66, 4, -67.25], size: [64, 8, 0.5], mat: "glass" }),
      box({ id: "HH-WS", at: [66, 4, -22.75], size: [64, 8, 0.5], mat: "glass" }),
      box({ id: "HH-WW1", at: [33.75, 4, -29.5], size: [0.5, 8, 13], mat: "glass" }),
      box({ id: "HH-WW2", at: [33.75, 4, -60.5], size: [0.5, 8, 13], mat: "glass" }),
      box({ id: "HH-WE1", at: [98.25, 4, -29.5], size: [0.5, 8, 13], mat: "glass" }),
      box({ id: "HH-WE2", at: [98.25, 4, -60.5], size: [0.5, 8, 13], mat: "glass" }),
      box({ id: "HH-ROOF", at: [66, 8.25, -45], size: [65, 0.5, 45], mat: "glass" }),
      box({ id: "HH-CWN", at: [66, 3, -65], size: [56, 0.5, 3], mat: "metal" }),
      box({ id: "HH-CWS", at: [66, 3, -25], size: [56, 0.5, 3], mat: "metal" }),
      box({ id: "HH-CWE", at: [95, 3, -45], size: [3, 0.5, 37], mat: "metal" }),
      stairs({ id: "HH-ST1", at: [40, 1.6, -59.5], size: [3, 3.25, 7], yaw: 180, mat: "metal" }),
      stairs({ id: "HH-ST2", at: [40, 1.6, -30.5], size: [3, 3.25, 7], yaw: 0, mat: "metal" }),
      ...[46, 58, 74, 86].flatMap((x) => [-37, -53].map((z, i) => box({
        id: `HH-PL-${x}-${i}`,
        at: [x, 0.6, z],
        size: [8, 1.2, 1.6],
        mat: "wood"
      }))),
      ...place(mound(), { at: [42, 0, -28], id: "HH-M1" }),
      ...place(mound(), { at: [66, 0, -60], id: "HH-M2" }),
      ...place(mound(), { at: [90, 0, -28], id: "HH-M3" }),
      box({ id: "HH-SUMP", at: [70, -0.2, -31], size: [6, 0.5, 4], mat: "toxic" }),
      disc({ id: "HH-NB", at: [82, 0.05, -45], r: 2.5, mat: "neon" }),
      disc({ id: "HH-THR", at: [40, 0.05, -45], r: 2, mat: "neon" }),
      box({ id: "S4-TUN1", at: [102, 2, -42.75], size: [8, 4, 0.5], mat: "glass" }),
      box({ id: "S4-TUN2", at: [102, 2, -47.25], size: [8, 4, 0.5], mat: "glass" }),
      box({ id: "S4-CB1", at: [114, 1, -30], size: [4, 2, 4], mat: "wood" }),
      box({ id: "S4-CB2", at: [126, 1, -62], size: [4, 2, 4], mat: "wood" }),
      box({ id: "S4-CB3", at: [138, 1, -28], size: [4, 2, 4], mat: "wood" }),
      box({ id: "S4-CB4", at: [146, 1, -58], size: [4, 2, 4], mat: "wood" }),
      box({ id: "S4-CB5", at: [156, 1, -36], size: [4, 2, 4], mat: "wood" }),
      box({ id: "S4-CB6", at: [120, 1, -58], size: [4, 2, 4], mat: "wood" }),
      disc({ id: "S4-RP5", at: [134, 0.05, -45], r: 5, mat: "toxic" }),
      ...place(shed(), { at: [152, 0, -74], yaw: 0, id: "S4-CSH" }),
      ...place(podStump(), { at: [112, 0, -56], id: "S4-ST1" }),
      ...place(podStump(), { at: [128, 0, -34], id: "S4-ST2" }),
      ...place(manaBloom(), { at: [37, 0, -56], id: "MB12" }),
      ...place(manaBloom(), { at: [94, 3.5, -65], id: "MB13" }),
      ...place(manaBloom(), { at: [74, 0, -45], id: "MB14" }),
      ...place(manaBloom(), { at: [112, 0, -60], id: "MB15" }),
      sphere({ id: "S4-GA-CAT-mark", at: [70, 6.2, -62], r: 0.45, mat: "neon" })
    ],
    weapons: [
      { id: "W4", at: [40, 0.9, -38], gun: "bazooka", why: "E7: two nests" }
    ],
    checkpoints: [
      { id: "CP7", at: [24, 0, -45], when: "S3-E6.cleared" },
      { id: "CP8", at: [100, 0, -45], when: "S4-E7.cleared" }
    ],
    mechanisms: [
      { kind: "door", id: "S4-DE", at: [169, 2.5, -45], size: [1, 5, 6], opens: "S4-E8.cleared" },
      { kind: "door", id: "LD2-IN", at: [34, 4, -45], size: [0.6, 8, 4] },
      { kind: "door", id: "LD2-OUT", at: [98, 4, -45], size: [0.6, 8, 4] },
      { kind: "door", id: "HH-DN", at: [66, 1, -67], size: [2.4, 3, 0.6] },
      { kind: "door", id: "HH-DS", at: [66, 1, -23], size: [2.4, 3, 0.6] },
      { kind: "door", id: "HH-DCE", at: [98, 3.25, -58], size: [2.4, 3, 0.6] },
      { kind: "hazard", id: "HH-SUMP-HZ", min: [67, -1, -33], max: [73, 1, -29], dps: 12, enemyDps: 40, stripsBark: true, element: "toxic" },
      { kind: "hazard", id: "HH-N-HZ", min: [62, -1, -70], max: [70, 3, -63], dps: 12, enemyDps: 40, stripsBark: true, element: "toxic" },
      { kind: "hazard", id: "S4-BARK", min: [-8, -2, -92], max: [176, 8, 4], dps: 0, enemyDps: 0.01, stripsBark: true, element: "toxic" },
      { kind: "hazard", id: "S4-RP5-HZ", min: [129, -1, -50], max: [139, 2, -40], dps: 12, enemyDps: 40, stripsBark: true, element: "toxic" },
      { kind: "seedPod", id: "S4-POD1", at: [112, 1.1, -56], regrow: 12, damage: 150, radius: 4 },
      { kind: "seedPod", id: "S4-POD2", at: [128, 1.1, -34], regrow: 12, damage: 150, radius: 4 },
      { kind: "power", id: "PU2", at: [66, 3.75, -65], modifier: "manaSurge" },
      { kind: "manaBloom", id: "MB12-use", at: [37, 0.6, -56], mana: 50, regrow: 20 },
      { kind: "manaBloom", id: "MB13-use", at: [94, 3.8, -65], mana: 50, regrow: 20 },
      { kind: "manaBloom", id: "MB14-use", at: [74, 0.6, -45], mana: 50, regrow: 20 },
      { kind: "manaBloom", id: "MB15-use", at: [112, 0.6, -60], mana: 50, regrow: 20 },
      { kind: "ammo", id: "AB12", at: [24, 0.4, -41], ammoType: "bullets", amount: 60 },
      { kind: "ammo", id: "AB13", at: [12, 0.4, -22], ammoType: "rockets", amount: 3 },
      { kind: "ammo", id: "AB14", at: [40, 0.4, -52], ammoType: "bullets", amount: 60 },
      { kind: "ammo", id: "AB15", at: [62, 0.4, -45], ammoType: "shells", amount: 12 },
      { kind: "ammo", id: "AB16", at: [40, 0.4, -36], ammoType: "rockets", amount: 3 },
      { kind: "ammo", id: "AB17", at: [102, 0.4, -45], ammoType: "shells", amount: 12 },
      { kind: "ammo", id: "AB18", at: [110, 0.4, -40], ammoType: "shells", amount: 12 },
      { kind: "ammoCrate", id: "RC2", at: [95, 0.4, -49], uses: 3, fraction: 0.5 },
      { kind: "chest", id: "L2-CHEST", at: [95, 0.5, -41], opens: "S4-E7.cleared", tier: "uncommon" },
      { kind: "secret", id: "S4-AF3", at: [12, 3.6, -22], tickets: 15, story: "Shipment 6: to Los Angeles, by cloud." }
    ],
    encounters: [ENCOUNTERS.E7, ENCOUNTERS.E8],
    // Under the glass roof, above the north catwalk. The floor lane does not need it.
    grappleAnchors: [
      { id: "S4-GA-CAT", at: [70, 6.2, -62], r: 2 }
    ]
  };

  // src/data/levels/L03/S5.js
  var HEX_ANCHORS = [
    { id: "S5-GA-N", at: [45, 9, -108], r: 2.4 },
    { id: "S5-GA-E", at: [73, 9, -80], r: 2.4 },
    { id: "S5-GA-S", at: [45, 9, -52], r: 2.4 },
    { id: "S5-GA-W", at: [17, 9, -80], r: 2.4 }
  ];
  function arenaWalls() {
    const parts = [];
    for (let i = 0; i < 16; i++) {
      const bearing = i * 22.5;
      const at2 = polar(45, -80, 35, bearing, 6);
      const tag = String(i).padStart(2, "0");
      if (i === 0 || i === 8) {
        for (const side of [-1, 1]) {
          const [dx, dz] = rotY(side * 4.5, 0, bearing);
          parts.push(box({
            id: `S5-W${tag}${side < 0 ? "a" : "b"}`,
            at: [at2[0] + dx, 6, at2[2] + dz],
            size: [5, 12, 2],
            yaw: bearing,
            mat: "rock"
          }));
        }
      } else {
        parts.push(box({
          id: `S5-W${tag}`,
          at: at2,
          size: [14.2, 12, 2],
          yaw: bearing,
          mat: "rock"
        }));
      }
    }
    return parts;
  }
  function floodZones() {
    const zones = [];
    for (let i = 0; i < 16; i++) {
      const bearing = i * 22.5;
      const at2 = polar(45, -80, 31, bearing, 0.5);
      zones.push({
        kind: "hazardSet",
        id: `S5-FLD${String(i).padStart(2, "0")}`,
        at: at2,
        size: [13, 1, 6],
        yaw: bearing,
        enabled: false,
        dps: 12,
        enemyDps: 40,
        element: "toxic",
        starts: "F1.hp<=0.25"
      });
    }
    return zones;
  }
  var boulderBearings = [30, 90, 150, 210, 270, 330];
  var podBearings = [0, 60, 120, 180, 240, 300];
  var moundBearings = [20, 100, 140, 220, 260, 340];
  var bloomBearings = [60, 180, 300];
  var S52 = {
    id: "S5",
    name: "The Rootway",
    origin: [732, 0, -80],
    start: [45, 0, -4],
    yaw: Math.PI,
    footprint: [90, 120],
    routeM: 110,
    navBounds: { min: [0, -120], max: [90, 0] },
    exit: { min: [41, -1, -120], max: [49, 6, -114] },
    intro: { title: "The Compost Hex", lines: ["Sahil left a shade to guard the crop.", "It eats mana. Feed it its own orbs."] },
    geometry: [
      box({ id: "S5-FL", at: [45, -0.25, -60], size: [400, 0.5, 400], mat: "dirt" }),
      box({ id: "S5-HW1", at: [34, 2.5, -8], size: [2, 5, 16], mat: "wood" }),
      box({ id: "S5-HW2", at: [56, 2.5, -8], size: [2, 5, 16], mat: "wood" }),
      box({ id: "S5-HW3a", at: [38, 2.5, -17], size: [8, 5, 2], mat: "wood" }),
      box({ id: "S5-HW3b", at: [52, 2.5, -17], size: [8, 5, 2], mat: "wood" }),
      box({ id: "S5-TW1", at: [41, 2.5, -31], size: [2, 5, 28], mat: "wood" }),
      box({ id: "S5-TW2", at: [49, 2.5, -31], size: [2, 5, 28], mat: "wood" }),
      ...place(rootArch(), { at: [45, 0, -22], id: "S5-AR1" }),
      ...place(rootArch(), { at: [45, 0, -31], id: "S5-AR2" }),
      ...place(rootArch(), { at: [45, 0, -40], id: "S5-AR3" }),
      ...arenaWalls(),
      disc({ id: "S5-LID", at: [45, 12, -80], r: 35, mat: "glass" }),
      cylinder({ id: "S5-HEAP", at: [45, -0.2, -80], r: 6, h: 0.5, mat: "dirt" }),
      cylinder({ id: "TOT-N", at: [45, 0, -102], r: 0.8, h: 4, mat: "wood" }),
      sphere({ id: "TOT-N-eye", at: [45, 4.4, -102], r: 0.7, mat: "neon" }),
      cylinder({ id: "TOT-SE", at: [64.1, 0, -69], r: 0.8, h: 4, mat: "wood" }),
      sphere({ id: "TOT-SE-eye", at: [64.1, 4.4, -69], r: 0.7, mat: "neon" }),
      cylinder({ id: "TOT-SW", at: [25.9, 0, -69], r: 0.8, h: 4, mat: "wood" }),
      sphere({ id: "TOT-SW-eye", at: [25.9, 4.4, -69], r: 0.7, mat: "neon" }),
      ...boulderBearings.map((b, i) => {
        const at2 = polar(45, -80, 14, b, 1.4);
        return { kind: "sphere", id: `S5-B${i}`, at: at2, r: 2, mat: "rock" };
      }),
      box({ id: "S5-L1", at: polar(45, -80, 27, 90, 0.6), size: [1.5, 1.2, 8], yaw: 90, mat: "wood" }),
      box({ id: "S5-L2", at: polar(45, -80, 27, 210, 0.6), size: [1.5, 1.2, 8], yaw: 210, mat: "wood" }),
      box({ id: "S5-L3", at: polar(45, -80, 27, 330, 0.6), size: [1.5, 1.2, 8], yaw: 330, mat: "wood" }),
      ...podBearings.flatMap((b, i) => place(podStump(), { at: polar(45, -80, 18, b, 0), id: `S5-POD${i + 1}` })),
      ...moundBearings.flatMap((b, i) => place(mound(), { at: polar(45, -80, 26, b, 0), id: `S5-RM${i + 1}` })),
      ...place(manaBloom(), { at: [45, 0, -30], id: "MB16" }),
      ...bloomBearings.flatMap((b, i) => place(manaBloom(), { at: polar(45, -80, 24, b, 0), id: `MB${17 + i}` })),
      disc({ id: "S5-THR", at: [45, 0.05, -52], r: 2, mat: "neon" }),
      ...HEX_ANCHORS.map((a) => sphere({ id: `${a.id}-mark`, at: a.at, r: 0.45, mat: "neon" }))
    ],
    weapons: [
      { id: "W5", at: [41, 0.9, -52], gun: "mg", why: "F1: the finale section holds its own gun" }
    ],
    checkpoints: [
      { id: "CP9", at: [45, 0, -4] },
      { id: "CP10", at: [45, 0, -116], when: "S5-F1.cleared" }
    ],
    mechanisms: [
      { kind: "door", id: "LD3-IN", at: [45, 6, -45.3], size: [4, 12, 0.6] },
      { kind: "door", id: "LD3-OUT", at: [45, 6, -114.7], size: [4, 12, 0.6] },
      { kind: "depot", id: "DP2", at: [39, 0, -8] },
      { kind: "target", id: "TOT-N-hp", at: [45, 2, -102], hp: 240, bark: true },
      { kind: "target", id: "TOT-SE-hp", at: [64.1, 2, -69], hp: 240, bark: true },
      { kind: "target", id: "TOT-SW-hp", at: [25.9, 2, -69], hp: 240, bark: true },
      { kind: "hazard", id: "TOT-SW-HZ", min: [22, -1, -73], max: [30, 3, -65], dps: 12, enemyDps: 40, stripsBark: true, element: "toxic" },
      { kind: "hazard", id: "S5-BARK", min: [-4, -2, -124], max: [94, 8, 8], dps: 0, enemyDps: 0.01, stripsBark: true, element: "toxic" },
      ...podBearings.map((b, i) => ({
        kind: "seedPod",
        id: `S5-POD-use${i + 1}`,
        at: polar(45, -80, 18, b, 1.1),
        regrow: 12,
        damage: 150,
        radius: 4
      })),
      ...floodZones(),
      { kind: "power", id: "PU3", at: [45, 1, -80], modifier: "manaSurge", starts: "F1.part2" },
      { kind: "manaBloom", id: "MB16-use", at: [45, 0.6, -30], mana: 50, regrow: 20 },
      ...bloomBearings.map((b, i) => ({
        kind: "manaBloom",
        id: `MB${17 + i}-use`,
        at: polar(45, -80, 24, b, 0.6),
        mana: 50,
        regrow: 20
      })),
      { kind: "ammo", id: "AB19", at: [49, 0.4, -52], ammoType: "bullets", amount: 60 },
      { kind: "ammo", id: "AB20", at: [41, 0.4, -58], ammoType: "shells", amount: 12 },
      { kind: "ammo", id: "AB21", at: [45, 0.4, -117], ammoType: "sniper", amount: 8 },
      { kind: "ammoCrate", id: "RC3", at: [45, 0.4, -84], uses: 3, fraction: 0.5 },
      { kind: "chest", id: "L3-CHEST", at: [45, 0.6, -80], opens: "S5-F1.cleared", guns: 2, tier: "rare" }
    ],
    encounters: [ENCOUNTERS.F1],
    grappleAnchors: HEX_ANCHORS
  };

  // src/data/levels/L03/S6.js
  var CHASE_ANCHORS = [
    { id: "S6-GA-T1", at: [64, 5.5, -40], r: 2.2 },
    { id: "S6-GA-T2", at: [96, 8.5, -40], r: 2.2 },
    { id: "S6-GA-TRK", at: [134, 13, -44], r: 2.4 }
  ];
  var planterBearings = [0, 60, 120, 180, 240, 300];
  var S62 = {
    id: "S6",
    name: "The Patch",
    origin: [741, 0, -189],
    start: [36, 0, -8],
    yaw: Math.PI,
    footprint: [150, 100],
    routeM: 210,
    navBounds: { min: [0, -100], max: [150, 0] },
    intro: {
      title: "Something Smells Green",
      lines: ["The Floret Lord is only a sprout.", "He will not stay for the whole fight."]
    },
    geometry: [
      box({ id: "S6-FL", at: [75, -0.25, -50], size: [400, 0.5, 400], mat: "dirt" }),
      box({ id: "S6-WN", at: [75, 6, -99], size: [150, 12, 2], mat: "hedge" }),
      box({ id: "S6-WW", at: [1, 6, -50], size: [2, 12, 100], mat: "hedge" }),
      box({ id: "S6-WE", at: [149, 6, -50], size: [2, 12, 100], mat: "hedge" }),
      box({ id: "S6-WS1", at: [16.5, 6, -1], size: [33, 12, 2], mat: "hedge" }),
      box({ id: "S6-WS2", at: [94.5, 6, -1], size: [111, 12, 2], mat: "hedge" }),
      box({ id: "S6-AW", at: [11, 2, -40], size: [2, 4, 48], mat: "hedge" }),
      box({ id: "S6-AN", at: [36, 2, -65], size: [48, 4, 2], mat: "hedge" }),
      box({ id: "S6-AS1", at: [23, 2, -15], size: [22, 4, 2], mat: "hedge" }),
      box({ id: "S6-AS2", at: [49, 2, -15], size: [22, 4, 2], mat: "hedge" }),
      ...planterBearings.map((b, i) => box({
        id: `S6-PL${i + 1}`,
        at: polar(36, -40, 9, b, 0.6),
        size: [3, 1.2, 1.2],
        mat: "wood"
      })),
      sphere({ id: "S6-GV1", at: [20, 1.9, -24], r: 2.5, mat: "grass" }),
      sphere({ id: "S6-GV2", at: [52, 1.9, -24], r: 2.5, mat: "grass" }),
      sphere({ id: "S6-GV3", at: [20, 1.9, -58], r: 2.5, mat: "grass" }),
      cylinder({ id: "S6-PED", at: [36, 0, -58], r: 2, h: 0.6, mat: "metal" }),
      box({ id: "S6-T1", at: [75, 2.75, -40], size: [30, 0.5, 44], mat: "grass" }),
      box({ id: "S6-T2", at: [105, 5.75, -40], size: [30, 0.5, 44], mat: "grass" }),
      box({ id: "S6-LV", at: [135, 8.75, -50], size: [30, 0.5, 96], mat: "concrete" }),
      box({ id: "S6-FN", at: [90, 6, -80], size: [60, 12, 36], mat: "hedge" }),
      box({ id: "S6-FS", at: [90, 6, -10], size: [60, 12, 16], mat: "hedge" }),
      ramp({ id: "S6-R1", at: [55, 1.5, -56], size: [10, 3, 5], yaw: 90, mat: "wood" }),
      ramp({ id: "S6-R2", at: [85, 4.5, -24], size: [10, 3, 5], yaw: 90, mat: "wood" }),
      ramp({ id: "S6-R3", at: [115, 7.5, -56], size: [10, 3, 5], yaw: 90, mat: "wood" }),
      // Yaw 90 rises toward +x, so this chute drops from terrace 2's south edge to the ground.
      ramp({ id: "S6-SLIDE", at: [84, 3, -18], size: [24, 6, 8], yaw: 90, mat: "wood" }),
      box({ id: "S6-HCB", at: [79, 4, -24], size: [1, 2, 5], mat: "sand", tag: "target" }),
      ...place(podStump(), { at: [64, 3, -48], id: "S6-POD1" }),
      ...place(podStump(), { at: [68, 3, -30], id: "S6-POD2" }),
      ...place(mound(), { at: [70, 3, -44], id: "S6-EM1" }),
      ...place(mound(), { at: [74, 3, -30], id: "S6-EM2" }),
      ...place(mound(), { at: [98, 6, -36], id: "S6-EM3" }),
      ...place(mound(), { at: [106, 6, -50], id: "S6-EM4" }),
      ...place(truck(), { at: [134, 9, -44], yaw: 0, id: "S6-TRK" }),
      cylinder({ id: "S6-WT", at: [140, 9, -90], r: 3, h: 18, mat: "hedge" }),
      sphere({ id: "S6-WT-head", at: [140, 30, -90], r: 6, mat: "hedge" }),
      sphere({ id: "S6-WT-f1", at: [134, 28, -90], r: 3, mat: "hedge" }),
      sphere({ id: "S6-WT-f2", at: [146, 28, -90], r: 3, mat: "hedge" }),
      sphere({ id: "S6-WT-f3", at: [140, 28, -84], r: 3, mat: "hedge" }),
      ...place(manaBloom(), { at: [16, 0, -40], id: "MB20" }),
      disc({ id: "S6-MP1-pad", at: [86, 3.05, -54], r: 1.2, mat: "neon" }),
      disc({ id: "S6-MP2-pad", at: [116, 6.05, -26], r: 1.2, mat: "neon" }),
      ...CHASE_ANCHORS.map((a) => sphere({ id: `${a.id}-mark`, at: a.at, r: 0.45, mat: "neon" }))
    ],
    weapons: [],
    checkpoints: [],
    mechanisms: [
      { kind: "door", id: "S6-LG", at: [120.5, 11, -56], size: [1, 4, 5], opens: "S6-F2.fled" },
      { kind: "door", id: "PT-N", at: [36, 1, -65], size: [2.4, 3, 0.6] },
      { kind: "door", id: "PT-W", at: [11, 1, -40], size: [0.6, 3, 2.4] },
      { kind: "risingHazard", id: "S6-RISE", min: [0, -1, -100], max: [120, 8.5, 0], rate: 0.18, dps: 12, element: "toxic", starts: "S6-F2.fled" },
      { kind: "target", id: "S6-HCB-hp", at: [79, 4, -24], hp: 150, bulletSeconds: 8, podHits: 1 },
      { kind: "seedPod", id: "S6-POD1-use", at: [64, 4.1, -48], regrow: 12, damage: 150, radius: 4 },
      { kind: "seedPod", id: "S6-POD2-use", at: [68, 4.1, -30], regrow: 12, damage: 150, radius: 4 },
      { kind: "mushroomPad", id: "S6-MP1", at: [86, 3.2, -54], r: 1.2, power: 9, to: [93, 6, -54] },
      { kind: "mushroomPad", id: "S6-MP2", at: [116, 6.2, -26], r: 1.2, power: 9, to: [123, 9, -28] },
      { kind: "power", id: "PU4", at: [48, 0.5, -50], modifier: "turbo" },
      { kind: "manaBloom", id: "MB20-use", at: [16, 0.6, -40], mana: 50, regrow: 20 },
      { kind: "ammo", id: "AB22", at: [36, 0.4, -8], ammoType: "bullets", amount: 60 }
    ],
    encounters: [ENCOUNTERS.F2, ENCOUNTERS.F3],
    grappleAnchors: CHASE_ANCHORS,
    navLinks: [
      { from: { x: 86, z: -54 }, to: { x: 93, z: -54 }, kind: "pad" },
      { from: { x: 116, z: -26 }, to: { x: 123, z: -28 }, kind: "pad" }
    ]
  };

  // src/data/levels/L03/enemies.js
  var L03_ARCHETYPES = {
    floretSprout: {
      hp: 50,
      speed: 6.2,
      radius: 0.4,
      height: 1.3,
      seconds: 8,
      attacks: { florets: 3, flight: 1.2, warningR: 1.6, damage: 6, every: 5, puffR: 2, puffDps: 3, puffTime: 3 },
      yeetReturn: { window: 0.4, damageEach: 30 }
    },
    sewerMidget: {
      hp: 40,
      speed: 7.8,
      radius: 0.45,
      height: 1.3,
      seconds: 3,
      melee: 9,
      burrow: { dust: 0.6, near: 12, surface: 4 },
      gooPlug: 4
    },
    daycare: {
      hp: 400,
      speed: 0,
      radius: 2,
      height: 3,
      seconds: 25,
      spawn: { count: 2, every: 6, capAlive: 8, budget: 5, coreOpen: 1.5 },
      damageTaken: { shellBullets: 0.5, core: 2.5, explosives: 1 },
      gooJam: 4
    },
    hexWisp: {
      hp: 45,
      speed: 5,
      fly: [1.2, 2.6],
      radius: 0.5,
      height: 1,
      seconds: 5,
      ghost: true,
      damageTaken: { bullet: 0.2, explosive: 0.5, spell: 2, reflectedOrb: 2 },
      orb: { every: 3.2, range: 16, damage: 8, speed: 9, life: 4 },
      touch: { range: 1.5, windup: 0.6, damage: 6, mana: 12 },
      look: [
        { kind: "sphere", at: [0, 0.6, 0], r: 0.5, mat: "neon" },
        { kind: "sphere", at: [-0.12, 0.7, 0.2], r: 0.08, mat: "neon" },
        { kind: "sphere", at: [0.12, 0.7, 0.2], r: 0.08, mat: "neon" },
        { kind: "cone", at: [0, 0.5, -0.4], r: 0.3, h: 0.8, mat: "neon" }
      ]
    },
    barkBrute: {
      hp: 260,
      speed: 3.2,
      turn: 90,
      radius: 0.8,
      height: 2.4,
      seconds: 18,
      club: { reach: 2.6, windup: 0.8, damage: 22, knockback: 8 },
      charge: { from: 6, to: 14, windup: 0.7, speed: 10, distance: 10, damage: 18, knockback: 10, every: 6 },
      bark: { hard: { bullet: 0, explosive: 0.25, spell: 1 }, softened: 4, cracked: 6, knotBullet: 1, strippedBullet: 1.25 },
      yeet: { closed: 5, open: 8 },
      look: [
        { kind: "box", at: [0, 0.45, 0], size: [1, 0.9, 0.7], mat: "wood" },
        { kind: "box", at: [0, 1.4, 0], size: [1.4, 1, 0.9], mat: "wood" },
        { kind: "box", at: [0, 2.15, 0], size: [0.7, 0.5, 0.6], mat: "wood" }
      ]
    },
    manaLeech: {
      hp: 55,
      speed: 3.8,
      radius: 0.45,
      height: 1.1,
      seconds: 6,
      latch: { range: 10, windup: 0.8, drain: 8, heal: 4, shieldDps: 4, maxLatched: 2, breakLos: 0.5, relatch: 2 },
      keep: [6, 9],
      look: [
        { kind: "cylinder", at: [0, 0, 0], r: 0.4, h: 1.1, mat: "toxic" },
        { kind: "disc", at: [0, 0.7, 0.4], r: 0.45, mat: "neon" }
      ]
    },
    gooGlob: {
      hp: { big: 90, medium: 40, small: 15 },
      speed: { big: 3, medium: 4.2, small: 6 },
      radius: { big: 1.1, medium: 0.7, small: 0.4 },
      seconds: 14,
      slam: { hop: 6, shadow: 1, damage: 14, radius: 2.5, puddle: 3, puddleTime: 5, slow: 0.4 },
      split: [1, 2, 4],
      core: 2.5,
      immune: ["goo", "toxic"],
      yeetKillWithoutSplit: true,
      look: [
        { kind: "sphere", at: [0, 1.1, 0], r: 1.1, mat: "toxic" },
        { kind: "sphere", at: [0, 1.1, 0], r: 0.33, mat: "neon" }
      ]
    }
  };
  var L03_SPELLS = {
    yeet: { mana: 20, cd: 3, length: 7, arc: 60, light: 8, bruteClosed: 5, bruteOpen: 8, riot: 5, bigObama: 2, boss: 0, wallHit: 20, slowSpeed: 14, returnMul: 5, returnMin: 30 },
    gooBolt: { puddle: 3, puddleTime: 4, plugBurrow: 4, hexOrbit: 0.25 },
    chainZap: { puddleHitsAll: true, barkCapNeedsGoo: true },
    swarm: { life: 12, parkedMax: 30, commandCd: 0.5, commandMana: 0 },
    manaSurge: { seconds: 20, regenMul: 4, breaksLatch: true },
    magicCarpet: { gapDrop: 2 },
    toxic: { enemyDps: 40, stripsBark: true, globImmune: true }
  };

  // src/data/levels/L03/index.js
  var L03_PACING = [
    ["B1", 31],
    ["E1", 74],
    ["canal", 5],
    ["E2", 82],
    ["toMaze", 5],
    ["E3", 65],
    ["E4", 138],
    ["barkCap", 17],
    ["toBridge", 5],
    ["E5", 78],
    ["depot1", 45],
    ["swarm", 34],
    ["E6", 94],
    ["toHothouse", 12],
    ["E7", 200],
    ["toCompost", 4],
    ["E8", 51],
    ["depot2", 49],
    ["tunnel", 7],
    ["F1", 185],
    ["F2", 65],
    ["F3", 41]
  ];
  var L03_BOT = [
    { section: "S1", steps: ["truck", "SH-YEET", "pod 2 twice at the barricade", "clear E1", "MP3", "clear E2", "S1-GATE", "optional hook S1-GA-LEAF then S1-GA-CROWN"] },
    { section: "S2", steps: ["W2 W3", "main ring route", "clear E3", "goo S2-GG1", "threshold", "four waves", "zap S2-CD1 when 3 are near the gazebo", "goo then zap S2-CD2"] },
    { section: "S3", steps: ["Yeet the brute off Bridge 1", "clear E5", "DP1", "SH-SWARM", "buddy on S3-PP0", "sprint Bridge 2", "PP1 and swarm on PP2", "Bridge 3"] },
    { section: "S4", steps: ["threshold", "four waves", "bazooka the nest cores", "clear E8", "S4-DE"] },
    { section: "S5", steps: ["DP2", "threshold", "swing S5-GA-N E S W inside the room", "Yeet orbs in part 1", "goo then zap totems from TOT-SE", "stay inside radius 24 after the flood"] },
    { section: "S6", steps: ["F2 until the flee", "hook S6-GA-T1 T2 TRK or walk R1 R3", "S6-SLIDE back down", "truck"] }
  ];
  var BUILT = makeV2Level({
    id: "L03",
    name: "The Vegetable Grove",
    stage: "grove",
    tier: 3,
    parTime: 20 * 60,
    jetpack: false,
    useNav: true,
    maxAlive: 10,
    startAmmo: { bullets: 240, shells: 24, sniper: 12, rockets: 4 },
    lighting: { time: "twilight", fog: 1849880, sun: "west", fireflies: true },
    bounds: { min: [-20, -30, -420], max: [980, 48, 40] },
    sections: [S12, S22, S32, S42, S52, S62]
  });
  for (const sec of BUILT.sections) {
    if (sec.navBounds) {
      sec.navPlan = sec.navBounds;
      delete sec.navBounds;
    }
    if (!sec.navLinks) continue;
    const o = sec.origin;
    sec.navLinks = sec.navLinks.map((link) => ({
      ...link,
      from: { x: link.from.x + o[0], z: link.from.z + o[2] },
      to: { x: link.to.x + o[0], z: link.to.z + o[2] }
    }));
  }
  BUILT.estimateSeconds = L03_PACING.reduce((sum, row) => sum + row[1], 0);
  BUILT.pacing = L03_PACING;
  BUILT.botRoute = L03_BOT;
  BUILT.census = EXPECTED_COUNTS;
  BUILT.archetypes = L03_ARCHETYPES;
  BUILT.spellNotes = L03_SPELLS;
  BUILT.difficulty = {
    easy: { maxAlive: 8, fodder: -0.25, leechDrain: 5, aura: 10, bloomRegrow: 12, ammo: 1.5, barkSoft: 6, totemHp: 180, runoff: 0.14, waveTimer: 35 },
    heroic: { maxAlive: 10, queueSooner: 0.3, fodder: 0.25, leechDrain: 12, aura: 15, auraRadius: 11, bloomRegrow: 30, knotNeedsSpell: true, totemHp: 300, ringEvery: 8, runoff: 0.22, waveTimer: 20 }
  };
  BUILT.loot = {
    tierOdds: { common: 45, uncommon: 40, rare: 14, epic: 1, legendary: 0 },
    baseTier: "uncommon",
    chests: ["L1-CHEST", "L2-CHEST", "L3-CHEST"],
    secretCache: "SC1",
    elite: "F1-p2c"
  };
  var L03 = BUILT;
  registerLevel(L03);

  // src/data/levels/L04/prim.js
  function stair(id, from, to, width = 6) {
    const rise = to[1] - from[1];
    const run = to[0] - from[0];
    const steps = Math.max(1, Math.ceil(Math.abs(rise) / 0.35));
    const parts = [];
    const z = (from[2] + to[2]) / 2;
    for (let i = 0; i < steps; i++) {
      const t1 = (i + 1) / steps;
      const x0 = from[0] + run * (i / steps);
      const x1 = from[0] + run * t1;
      parts.push(deckBox(`${id}-${i}`, Math.min(x0, x1), Math.max(x0, x1) + 0.15, from[1] + rise * t1, z, width));
    }
    return parts;
  }
  function deckBox(id, x0, x1, top, z, width = 4) {
    return box({
      id,
      at: [(x0 + x1) / 2, top - 0.25, z],
      size: [Math.max(0.5, x1 - x0), 0.5, width],
      mat: "metal",
      tag: "slide"
    });
  }
  function ammo3(id, at2, ammoType, amount) {
    return { kind: "ammo", id, at: at2, ammoType, amount };
  }
  function door4(id, at2, size, extra = {}) {
    return { kind: "door", id, at: at2, size, ...extra };
  }
  function deck(id, from, to, width, top = 0) {
    const dx = to[0] - from[0];
    const dz = to[2] - from[2];
    const len = Math.hypot(dx, dz) || 1;
    const step = Math.max(width * 0.65, 2);
    const n = Math.max(1, Math.ceil(len / step));
    const parts = [];
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      parts.push(box({
        id: `${id}-${i + 1}`,
        at: [from[0] + dx * t, top - 0.25, from[2] + dz * t],
        size: [width, 0.5, width],
        mat: "neon",
        tag: "energyBridge"
      }));
    }
    return parts;
  }

  // src/data/levels/L04/prefabs.js
  function candle(id, size, at2, dir = "up") {
    const [w, h, d] = size;
    const mat = dir === "down" ? "candleDown" : "candleUp";
    const wickH = Math.max(0.5, Math.min(h / 4, 6));
    const top = at2[1] + h / 2;
    const bot = at2[1] - h / 2;
    return [
      box({ id: `${id}-body`, at: at2, size: [w, h, d], mat }),
      box({ id: `${id}-wick-t`, at: [at2[0], top, at2[2]], size: [0.6, wickH, 0.6], mat: "trim" }),
      box({ id: `${id}-wick-b`, at: [at2[0], bot, at2[2]], size: [0.6, wickH, 0.6], mat: "trim" })
    ];
  }
  function hollowCandle(id, size, at2, mat = "candleDown") {
    const [w, h, d] = size;
    const bot = at2[1] - h / 2;
    const wallH = h - 1;
    const wallY = bot + 1 + wallH / 2;
    const x0 = at2[0] - w / 2;
    const z0 = at2[2] - d / 2;
    return [
      box({ id: `${id}-floor`, at: [at2[0], bot + 0.5, at2[2]], size: [w, 1, d], mat }),
      box({ id: `${id}-n`, at: [at2[0], wallY, z0 + 0.5], size: [w, wallH, 1], mat }),
      box({ id: `${id}-s`, at: [at2[0], wallY, z0 + d - 0.5], size: [w, wallH, 1], mat }),
      box({ id: `${id}-w`, at: [x0 + 0.5, wallY, at2[2]], size: [1, wallH, d - 2], mat }),
      box({ id: `${id}-e`, at: [x0 + w - 0.5, wallY, at2[2]], size: [1, wallH, d - 2], mat })
    ];
  }
  function island(id, r, h, at2, mat = "stone") {
    return [
      cylinder({ id, at: at2, r, h, mat }),
      disc({ id: `${id}-rim`, at: [at2[0], at2[1] + h + 0.04, at2[2]], r, mat: "neon" })
    ];
  }
  function podIsle(id, at2) {
    return island(id, 4, 3, at2);
  }
  function chain(id, from, to) {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const dz = to[2] - from[2];
    const len = Math.hypot(dx, dy, dz);
    const n = Math.max(1, Math.round(len / 2));
    const alongX = Math.abs(dx) >= Math.abs(dz);
    const size = alongX ? [2.4, 0.6, 1.6] : [1.6, 0.6, 2.4];
    const parts = [];
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      parts.push(box({
        id: `${id}-${i + 1}`,
        at: [from[0] + dx * t, from[1] + dy * t, from[2] + dz * t],
        size,
        mat: "trim"
      }));
    }
    return parts;
  }
  function crate(id, at2) {
    return box({ id, at: at2, size: [1.6, 1.2, 1.6], mat: "crate" });
  }
  function server(id, at2) {
    return [
      box({ id, at: at2, size: [1.2, 2, 2.4], mat: "metal" }),
      box({ id: `${id}-strip`, at: [at2[0], at2[1] + 1.25, at2[2]], size: [0.5, 0.5, 2.4], mat: "neon" })
    ];
  }
  function ticker(id, at2, length) {
    return box({ id, at: at2, size: [0.6, 2, length], mat: "neon" });
  }
  function hut(id, size, at2) {
    return [box({ id, at: at2, size, mat: "concrete" })];
  }
  function sign(id, at2, text) {
    const boardY = at2[1];
    return [
      cylinder({ id: `${id}-pole`, at: [at2[0], boardY - 3, at2[2]], r: 0.25, h: 2, mat: "metal" }),
      { ...box({ id, at: at2, size: [4, 2, 0.5], mat: "neon" }), text }
    ];
  }
  function vent(id, at2) {
    return [
      cylinder({ id, at: at2, r: 3, h: 0.5, mat: "metal" }),
      disc({ id: `${id}-rim`, at: [at2[0], at2[1] + 0.52, at2[2]], r: 3, mat: "neon" })
    ];
  }
  function tunnel(id, { length, floorAt, innerH = 4 }) {
    const [x, y, z] = floorAt;
    const wallH = innerH + 2;
    const wallY = y - 0.5 + wallH / 2;
    return [
      box({ id: `${id}-floor`, at: [x, y, z], size: [length, 1, 8], mat: "metal" }),
      box({ id: `${id}-roof`, at: [x, y + innerH + 1, z], size: [length, 1, 8], mat: "metal" }),
      box({ id: `${id}-n`, at: [x, wallY, z - 3.5], size: [length, wallH, 1], mat: "metal" }),
      box({ id: `${id}-s`, at: [x, wallY, z + 3.5], size: [length, wallH, 1], mat: "metal" })
    ];
  }
  function pylon(id, at2, mat = "metal") {
    const top = at2[1] + 5;
    return [
      cylinder({ id, at: at2, r: 0.8, h: 5, mat }),
      sphere({ id: `${id}-core`, at: [at2[0], top + 1.2, at2[2]], r: 1.2, mat: "neon" }),
      box({ id: `${id}-bar1`, at: [at2[0] - 0.8, at2[1] + 0.5, at2[2] + 1.2], size: [0.5, 1, 0.5], mat: "trim" }),
      box({ id: `${id}-bar2`, at: [at2[0], at2[1] + 1, at2[2] + 1.2], size: [0.5, 2, 0.5], mat: "trim" }),
      box({ id: `${id}-bar3`, at: [at2[0] + 0.8, at2[1] + 1.5, at2[2] + 1.2], size: [0.5, 3, 0.5], mat: "trim" })
    ];
  }
  function validatorNode(id, at2) {
    return [
      box({ id, at: [at2[0], at2[1] + 1.5, at2[2]], size: [2, 3, 2], mat: "metal" }),
      sphere({ id: `${id}-core`, at: [at2[0], at2[1] + 3.9, at2[2]], r: 0.9, mat: "gold" })
    ];
  }
  function spans(from, to, gaps) {
    const cuts = (gaps || []).slice().sort((a, b) => a.at - b.at);
    const out = [];
    let cursor = from;
    for (const g of cuts) {
      const a = g.at - g.width / 2;
      const b = g.at + g.width / 2;
      if (a - cursor >= 0.5) out.push([cursor, a]);
      cursor = Math.max(cursor, b);
    }
    if (to - cursor >= 0.5) out.push([cursor, to]);
    return out;
  }
  function lockRoom(id, { min, max, gaps = [] }) {
    const thick = 0.6;
    const [x0, y0, z0] = min;
    const [x1, y1, z1] = max;
    const parts = [];
    const ySize = y1 - y0;
    const yMid = y0 + ySize / 2;
    function add3(partId, at2, size) {
      if (size.some((n) => n < 0.5)) return;
      parts.push(box({ id: `${id}-${partId}`, at: at2, size, mat: "forceField", tag: "lockWall" }));
    }
    const on = (side) => gaps.filter((g) => g.side === side).map((g) => ({ at: g.at, width: g.width }));
    for (const [a, b] of spans(z0, z1, on("w"))) {
      add3(`w-${Math.round(a)}`, [x0, yMid, (a + b) / 2], [thick, ySize, b - a]);
    }
    for (const [a, b] of spans(z0, z1, on("e"))) {
      add3(`e-${Math.round(a)}`, [x1, yMid, (a + b) / 2], [thick, ySize, b - a]);
    }
    for (const [a, b] of spans(x0, x1, on("n"))) {
      add3(`n-${Math.round(a)}`, [(a + b) / 2, yMid, z0], [b - a, ySize, thick]);
    }
    for (const [a, b] of spans(x0, x1, on("s"))) {
      add3(`s-${Math.round(a)}`, [(a + b) / 2, yMid, z1], [b - a, ySize, thick]);
    }
    for (const g of gaps) {
      const lintel = y1 - (y0 + g.height);
      if (lintel < 0.5) continue;
      const y = y0 + g.height + lintel / 2;
      if (g.side === "w") add3(`w-top-${g.at}`, [x0, y, g.at], [thick, lintel, g.width]);
      if (g.side === "e") add3(`e-top-${g.at}`, [x1, y, g.at], [thick, lintel, g.width]);
      if (g.side === "n") add3(`n-top-${g.at}`, [g.at, y, z0], [g.width, lintel, thick]);
      if (g.side === "s") add3(`s-top-${g.at}`, [g.at, y, z1], [g.width, lintel, thick]);
    }
    add3("lid", [(x0 + x1) / 2, y1 + thick / 2, (z0 + z1) / 2], [x1 - x0 + thick, thick, z1 - z0 + thick]);
    return parts;
  }
  function fireRing(id, { at: at2, r, h = 4 }) {
    const n = 48;
    const parts = [];
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2;
      let d = Math.abs(a - Math.PI);
      if (d > Math.PI) d = Math.PI * 2 - d;
      if (d < 0.55) continue;
      parts.push(box({
        id: `${id}-${i}`,
        at: [at2[0] + Math.cos(a) * r, h / 2, at2[2] + Math.sin(a) * r],
        size: [3.2, h, 3.2],
        mat: "lava",
        tag: "fireRing"
      }));
    }
    return parts;
  }

  // src/data/levels/L04/encounters.js
  function squad4(id, trigger, units2, at2, method = "placed", design = null, extra = null) {
    const row = { id, trigger, method, at: at2, units: units2 };
    if (design) row.design = design;
    if (extra) Object.assign(row, extra);
    return row;
  }
  function u2(type, count, extra) {
    return extra ? { type, count, ...extra } : { type, count };
  }
  var E12 = {
    id: "S1-E1",
    name: "Welcome Desk",
    maxAlive: 8,
    intensity: 0.3,
    objective: { kind: "clearAll" },
    activate: { min: [44, -2, 42], max: [80, 6, 78] },
    squads: [
      squad4("A", { type: "onEnter" }, [u2("midget", 4)], [[58, 0, 56], [66, 0, 56], [58, 0, 64], [66, 0, 64]], "placed", "placed, wakes on sight, ring round (62, 0, 60)"),
      squad4("B", { type: "time", t: 1 }, [u2("obama", 2)], [[58, 0, 50], [66, 0, 50]], "door", "onAlert, hutN, delay 1s"),
      squad4("C", { type: "onKills", n: 4 }, [u2("midget", 4)], [[54, 0, 70], [60, 0, 70], [66, 0, 70], [72, 0, 70]], "door", "onKills(4), hutS"),
      squad4("C2", { type: "with", after: "C", delay: 3 }, [u2("boomMidget", 2)], [[58, 0, 68], [68, 0, 68]], "door", "booms 3s after the midgets")
    ]
  };
  var E22 = {
    id: "S1-E2",
    name: "First Flight",
    maxAlive: 8,
    intensity: 0.4,
    objective: { kind: "clearAll" },
    activate: { min: [96, -4, 56], max: [230, 16, 64] },
    squads: [
      squad4("A", { type: "onEnter" }, [u2("flyingMidget", 2)], [[110, 2, 60], [118, 2, 60]], "air", "onEnter h2, y 7 to 10", { alt: [7, 10] }),
      squad4("B", { type: "time", t: 6 }, [u2("flyingMidget", 3)], [[140, 2, 60], [148, 2, 60], [156, 2, 60]], "air", "onEnter h3, y 11 to 15", { alt: [11, 15] }),
      squad4("C", { type: "time", t: 12 }, [u2("obama", 2)], [[198, 0, 60], [206, 0, 60]], "placed", "onEnter Mempool x>182, perched on the stubs"),
      squad4("D", { type: "onKills", n: 5 }, [u2("midget", 3)], [[214, 0, 60], [218, 0, 60], [222, 0, 60]], "door", "onKills(5), memHut")
    ]
  };
  var E32 = {
    id: "S2-E3",
    name: "Trading Pit",
    maxAlive: 12,
    flockUnit: 6,
    intensity: 0.75,
    objective: { kind: "clearAll" },
    activate: { min: [40, -2, 74], max: [92, 24, 126] },
    lockdown: {
      id: "L1",
      entry: "s2.pitIn",
      exit: "s2.pitOut",
      threshold: { min: [46.5, -1, 96], max: [48.5, 6, 104] },
      room: { min: [41, 0, 75], max: [91, 24, 125] },
      waves: 4,
      fallbackSec: 25
    },
    squads: [
      squad4("W1", { type: "onEnter" }, [u2("bitbug", 6)], [[66, 1, 100]], "air", "door drops, PIT-N, y 8 to 18", { alt: [1, 4], spawn: "PIT-N" }),
      squad4("W2a", { type: "onRemain", n: 2 }, [u2("bitbug", 6)], [[70, 1, 100]], "air", "onRemain(2) or 25s, PIT-S", { alt: [1, 4], spawn: "PIT-S", fallbackSec: 25 }),
      squad4("W2b", { type: "with", after: "W2a", delay: 0 }, [u2("flyingMidget", 3)], [[62, 1, 100]], "air", "PIT-LID, y 14 to 22", { alt: [1, 4], spawn: "PIT-LID" }),
      squad4("W3a", { type: "onRemain", n: 2 }, [u2("boomMidget", 3)], [[74, 0, 100]], "door", "PIT-E", { spawn: "PIT-E", fallbackSec: 25 }),
      squad4("W3b", { type: "with", after: "W3a", delay: 0 }, [u2("bitbug", 6)], [[58, 1, 100]], "air", "PIT-N again", { alt: [1, 4], spawn: "PIT-N" }),
      squad4("W4a", { type: "onRemain", n: 2 }, [u2("bitbug", 3)], [[66, 1, 98]], "air", "half-flock PIT-N", { alt: [1, 4], spawn: "PIT-N", fallbackSec: 25 }),
      squad4("W4b", { type: "with", after: "W4a", delay: 0 }, [u2("bitbug", 3)], [[66, 1, 102]], "air", "half-flock PIT-S", { alt: [1, 4], spawn: "PIT-S" })
    ]
  };
  var E42 = {
    id: "S2-E4",
    name: "Bull Run",
    maxAlive: 6,
    intensity: 0.6,
    objective: { kind: "clearAll" },
    activate: { min: [100, -14, 60], max: [262, 60, 140] },
    squads: [
      squad4("A", { type: "onEnter" }, [u2("jetObama", 1)], [[130, 16, 100]], "air", "onEnter slider 1, matches the player, y 4 to 28", { alt: [4, 28] }),
      squad4("B", { type: "onKills", n: 1 }, [u2("robotLaser", 1)], [[160, 32, 100]], "placed", "onEnter K8, perched on K10"),
      squad4("C", { type: "onKills", n: 2 }, [u2("jetObama", 1)], [[190, 48, 100]], "air", "onEnter K11, north", { alt: [38, 56] }),
      squad4("C2", { type: "with", after: "C", delay: 4 }, [u2("jetObama", 1)], [[210, 56, 100]], "air", "second jet 4s later, south", { alt: [38, 56] }),
      squad4("D", { type: "onKills", n: 4 }, [u2("obama", 1, { elite: true, name: "Head Trader" })], [[240, 72, 100]], "placed", "wakes on landing on K12, K13 or K14")
    ]
  };
  var E52 = {
    id: "S3-E5",
    name: "Gas Fees",
    maxAlive: 5,
    flockUnit: 6,
    intensity: 0.7,
    objective: { kind: "clearAll", design: "destroy s3.gatePylon and reach the mouth" },
    activate: { min: [50, -12, 40], max: [250, 30, 80] },
    squads: [
      squad4("A", { type: "onEnter" }, [u2("flakPod", 1)], [[63, 0, 60]], "placed", "FP1, static y 0"),
      squad4("B", { type: "time", t: 4 }, [u2("flakPod", 1)], [[122, 1, 60]], "placed", "onEnter x>80, FP2"),
      squad4("B2", { type: "with", after: "B", delay: 2 }, [u2("bitbug", 6)], [[110, 2, 60]], "air", "flock 4s later, riding the wind, y 8 to 16", { alt: [8, 16] }),
      squad4("C", { type: "time", t: 10 }, [u2("flakPod", 1)], [[164, 1, 60]], "placed", "onEnter R2, FP3 below the lane"),
      squad4("D", { type: "time", t: 16 }, [u2("flakPod", 1, { elite: true, name: "Priority Fee" })], [[208, 1, 60]], "placed", "onEnter R3, FP4")
    ]
  };
  var E62 = {
    id: "S4-E6",
    name: "Dust Sweep",
    maxAlive: 9,
    intensity: 0.45,
    objective: { kind: "clearAll" },
    activate: { min: [4, -8, 60], max: [140, 20, 140] },
    squads: [
      squad4("A", { type: "onEnter" }, [u2("balloonMidget", 3)], [[52, 6, 100], [58, 9, 94], [58, 5, 106]], "placed", "cluster 30 to 36m from the entry wall, y 5 to 9", { alt: [5, 9] }),
      squad4("B", { type: "onKills", n: 2 }, [u2("balloonMidget", 3)], [[76, 12, 94], [84, 14, 100], [90, 10, 90]], "placed", "onKills(2), round b3 and b6, y 10 to 14", { alt: [10, 14] }),
      squad4("C", { type: "onKills", n: 5 }, [u2("balloonMidget", 1)], [[100, 14, 62]], "air", "onKills(5), crosswind, 2s apart", { alt: [12, 16] }),
      squad4("C2", { type: "with", after: "C", delay: 2 }, [u2("balloonMidget", 1)], [[108, 16, 62]], "air", "second mine", { alt: [12, 16] }),
      squad4("C3", { type: "with", after: "C2", delay: 2 }, [u2("balloonMidget", 1)], [[116, 12, 62]], "air", "third mine", { alt: [12, 16] })
    ]
  };
  var E72 = {
    id: "S4-E7",
    name: "Clearing House",
    maxAlive: 10,
    flockUnit: 6,
    intensity: 0.9,
    objective: { kind: "clearAll" },
    activate: { min: [146, -12, 70], max: [208, 30, 130] },
    lockdown: {
      id: "L2",
      entry: "s4.chIn",
      exit: "s4.chOut",
      threshold: { min: [152, -1, 96], max: [154, 6, 104] },
      room: { min: [147, 0, 70], max: [207, 30, 130] },
      waves: 4,
      fallbackSec: 25
    },
    squads: [
      squad4("W1", { type: "onEnter" }, [u2("bitbug", 8)], [[177, 16, 70.5]], "air", "door drops, CH-N, y 6 to 20", { alt: [6, 20], spawn: "CH-N" }),
      squad4("W1b", { type: "with", after: "W1", delay: 4 }, [u2("jetObama", 1)], [[195, 29, 100]], "air", "CH-LID 4s later, matches the player", { alt: [4, 26], spawn: "CH-LID" }),
      squad4("W2a", { type: "onRemain", n: 2 }, [u2("jetObama", 2)], [[177, 16, 129.5]], "air", "onRemain(2) or 25s, CH-S", { alt: [4, 26], spawn: "CH-S", fallbackSec: 25 }),
      squad4("W2b", { type: "with", after: "W2a", delay: 0 }, [u2("balloonMidget", 4)], [[195, 29, 100]], "air", "CH-LID, y 26 falling to 8", { alt: [8, 26], spawn: "CH-LID" }),
      squad4("W3a", { type: "onRemain", n: 2 }, [u2("flakPod", 1)], [[202, 0, 126]], "burrow", "CH-HATCH", { spawn: "CH-HATCH", fallbackSec: 25 }),
      squad4("W3b", { type: "with", after: "W3a", delay: 0 }, [u2("bitbug", 8)], [[177, -10, 100]], "air", "CH-WELL, y 0 to 16", { alt: [0, 16], spawn: "CH-WELL" }),
      squad4("W4", { type: "onRemain", n: 2 }, [u2("jetObama", 1, { elite: true, name: "Whale" })], [[195, 29, 100]], "air", "CH-LID, y 6 to 26", { alt: [6, 26], spawn: "CH-LID", fallbackSec: 25 })
    ]
  };
  var E82 = {
    id: "S5-E8",
    name: "Proof of Stake",
    maxAlive: 10,
    intensity: 0.7,
    objective: {
      kind: "clearAll",
      alsoDestroy: ["n1", "n2", "n3"],
      design: "destroy n1, n2, n3 and clearAll"
    },
    activate: { min: [18, -8, 38], max: [102, 20, 122] },
    squads: [
      squad4("A", { type: "onEnter" }, [u2("riotMidget", 2), u2("obama", 2)], [[40, 0, 76], [40, 0, 84], [46, 0, 64], [46, 0, 96]], "placed", "west plaza"),
      squad4("B", { type: "onKills", n: 4 }, [u2("hexAcolyte", 1), u2("midget", 4)], [[60, 0, 47.3], [58, 0, 47.3], [62, 0, 47.3], [56, 0, 47.3], [64, 0, 47.3]], "door", "onPartDestroyed of the first node (n1, n2 or n3), hutN"),
      squad4("C", { type: "onKills", n: 7 }, [u2("robotShooter", 1, { elite: true, name: "Shooter Bot" })], [[36, 0, 80]], "drop", "onKills(7), drop pod on the Ledger roof"),
      squad4("C2", { type: "with", after: "C", delay: 1 }, [u2("manaLeech", 1)], [[40, 0, 84]], "door", "leech 3s later, hutS")
    ]
  };
  var BOSS = {
    id: "SB-BOSS",
    name: "Bitcoin Obama & The Midget",
    maxAlive: 12,
    flockUnit: 6,
    intensity: 1,
    objective: { kind: "boss", design: "The Midget is knocked out in stage 3, after Bitcoin Obama is out" },
    activate: { min: [40, -4, 30], max: [100, 16, 90] },
    lockdown: {
      id: "L3",
      entry: "sb.gate",
      exit: null,
      threshold: { min: [45.5, -1, 54], max: [47.5, 6, 66] },
      room: { min: [42, -8, 32], max: [98, 16, 88] },
      waves: 5,
      fallbackSec: null
    },
    // t is seconds from the part start. Today's director ignores `part` and fires
    // on encounter time. ENGINE-NEEDS says to gate these on the active part.
    parts: [
      { id: 1, name: "Opening Bell", kind: "entry", seconds: 30, ends: "pylons destroyed" },
      { id: 2, name: "Pump", kind: "double", seconds: 60, ends: "either stage-2 bar empty" },
      { id: 3, name: "Flash Crash", kind: "intermission", seconds: 40, ends: "both breakers destroyed" },
      { id: 4, name: "Dump", kind: "double", seconds: 75, ends: "Obama out and the Midget in stage 3" },
      { id: 5, name: "Short Squeeze", kind: "chase", seconds: 45, ends: "the Midget is knocked out" }
    ],
    squads: [
      squad4("P1a", { type: "onEnter" }, [
        u2("bitbug", 1, { partId: "sb.py3" }),
        u2("bitbug", 1, { partId: "sb.cb1" }),
        u2("bitbug", 1, { partId: "sb.py1" }),
        u2("bitbug", 1, { partId: "sb.py2" }),
        u2("bitbug", 1, { partId: "sb.cb2" }),
        u2("bitbug", 1)
      ], [[48, 1, 60], [52, 1, 60], [56, 1, 60], [60, 1, 60], [64, 1, 60], [68, 1, 60]], "placed", "part 1 t+3, SB-N", { spawn: "SB-N", alt: [1, 2] }),
      squad4("bosses", { type: "onEnter" }, [u2("obamaDuo", 1), u2("midgetDuo", 1)], [[80, 1, 60], [84, 1, 60]], "placed", "both on the podium under the Price Shield"),
      squad4("P1b", { type: "time", t: 15, part: 1 }, [u2("bitbug", 6)], [[80, 1, 60]], "air", "part 1 t+15, SB-S", { spawn: "SB-S", alt: [1, 3], optional: true }),
      squad4("P2a", { type: "time", t: 20, part: 2 }, [u2("midget", 4)], [[80, 0, 60]], "drop", "part 2 t+20, SB-W", { spawn: "SB-W", optional: true }),
      squad4("P2b", { type: "time", t: 40, part: 2 }, [u2("midget", 3), u2("boomMidget", 2)], [[84, 0, 60]], "drop", "part 2 t+40, SB-E", { spawn: "SB-E", optional: true }),
      squad4("P3a", { type: "time", t: 0, part: 3 }, [u2("bitbug", 6)], [[80, 1, 60]], "air", "part 3 t+2, SB-N", { spawn: "SB-N", optional: true }),
      squad4("P3b", { type: "time", t: 10, part: 3 }, [u2("balloonMidget", 4)], [[84, 1, 60]], "air", "part 3 t+10, SB-LID", { spawn: "SB-LID", optional: true }),
      squad4("P3c", { type: "time", t: 20, part: 3 }, [u2("bitbug", 6)], [[82, 1, 60]], "air", "part 3 t+20, SB-S", { spawn: "SB-S", optional: true }),
      squad4("P4", { type: "time", t: 15, part: 4 }, [u2("boomMidget", 3)], [[80, 0, 60]], "drop", "part 4 t+15, SB-C", { spawn: "SB-C", optional: true })
    ]
  };
  var ENCOUNTERS2 = { E1: E12, E2: E22, E3: E32, E4: E42, E5: E52, E6: E62, E7: E72, E8: E82, BOSS };
  var EXPECTED_COUNTS2 = {
    midget: 22,
    boomMidget: 10,
    obama: 7,
    robotLaser: 1,
    flyingMidget: 8,
    bitbug: 70,
    jetObama: 7,
    balloonMidget: 17,
    flakPod: 5,
    riotMidget: 2,
    hexAcolyte: 1,
    manaLeech: 1,
    robotShooter: 1
  };

  // src/data/levels/L04/S1.js
  var vistaX = [20, 60, 100, 140, 180, 220];
  var vistaH = [40, 50, 60, 70, 80, 55];
  var vista = [];
  vistaX.forEach((x, i) => {
    const h = vistaH[i];
    vista.push(...candle(`s1.vista${i + 1}`, [10, h, 10], [x, h / 2, 8], i % 2 ? "down" : "up"));
  });
  [80, 160].forEach((x, i) => {
    const h = i ? 75 : 65;
    vista.push(...candle(`s1.vista${i + 7}`, [10, h, 10], [x, h / 2, 112], i ? "down" : "up"));
  });
  var S13 = {
    id: "S1",
    name: "Genesis Block",
    origin: [0, 0, 0],
    start: [4, 0, 60],
    yaw: -Math.PI / 2,
    footprint: [240, 120],
    routeM: 240,
    navBounds: { min: [0, 0], max: [240, 120] },
    flyerVolume: { min: [0, -40, 0], max: [240, 70, 120] },
    voids: [{ id: "s1.void", min: [-20, -200, -20], max: [260, -40, 140], penalty: 0.25, invuln: 1, mode: "lastSafe", to: [4, 0, 60] }],
    exit: { min: [232, -2, 56], max: [242, 14, 64] },
    intro: {
      title: "The Blockchain Void",
      lines: ["The money leaves the Grove and goes up.", "There is no floor on this exchange. Mind the gap."]
    },
    navLinks: [
      { from: { x: 30, z: 60 }, to: { x: 44, z: 60 }, kind: "bridge" },
      { from: { x: 218, z: 60 }, to: { x: 224, z: 60 }, kind: "chain" }
    ],
    grappleAnchors: [
      { id: "s1.hook.h1", at: [108, 8, 48], r: 3 },
      { id: "s1.hook.h2", at: [136, 12, 46], r: 3 },
      { id: "s1.hook.h3", at: [168, 16, 74], r: 3 },
      { id: "s1.hook.mem", at: [200, 16, 60], r: 3 }
    ],
    geometry: [
      box({ id: "s1.gen", at: [15, -2, 60], size: [30, 4, 40], mat: "metal" }),
      box({ id: "s1.mono", at: [4, 6, 46], size: [4, 12, 4], mat: "gold" }),
      crate("s1.genCr1", [12, 0.6, 52]),
      crate("s1.genCr2", [12, 0.6, 68]),
      crate("s1.genCr3", [22, 0.6, 64]),
      ...sign("s1.signZap", [27, 3, 54], "ZAP THE CONDUIT"),
      box({ id: "s1.c1post", at: [37, -0.5, 50], size: [3, 3, 3], mat: "metal" }),
      ...deck("eb1", [30, 0, 60], [44, 0, 60], 4, 0),
      box({ id: "s1.blk1", at: [62, -2, 60], size: [36, 4, 40], mat: "metal" }),
      ...hut("s1.hutN", [6, 3, 5], [62, 1.5, 42.5]),
      ...hut("s1.hutS", [6, 3, 5], [62, 1.5, 77.5]),
      ticker("s1.tickA", [52, 1, 52], 6),
      ticker("s1.tickB", [52, 1, 68], 6),
      ...server("s1.srvA", [68, 1, 54]),
      ...server("s1.srvB", [68, 1, 66]),
      crate("s1.blkCr1", [48, 0.6, 64]),
      crate("s1.blkCr2", [58, 0.6, 48]),
      crate("s1.blkCr3", [58, 0.6, 72]),
      crate("s1.blkCr4", [74, 0.6, 64]),
      box({ id: "s1.wallN", at: [79.7, 2, 48], size: [0.6, 4, 16], mat: "metal" }),
      box({ id: "s1.wallS", at: [79.7, 2, 72], size: [0.6, 4, 16], mat: "metal" }),
      box({ id: "s1.launch", at: [85, -2, 60], size: [10, 4, 16], mat: "metal" }),
      cylinder({ id: "s1.dais", at: [85, 0, 54], r: 2, h: 0.5, mat: "gold" }),
      ...sign("s1.signHold", [88, 3, 54], "HOLD SPACE TO FLY"),
      ...island("s1.h1", 6, 3, [108, -3, 48]),
      ...island("s1.h2", 6, 3, [136, 0, 46]),
      ...sign("s1.signHover", [136, 6, 40], "HOLD TO HOVER"),
      ...island("s1.h3", 6, 3, [168, 4, 74]),
      ...sign("s1.signDrop", [168, 10, 80], "C TO DROP"),
      box({ id: "s1.file1", at: [136, -6.25, 46], size: [4, 0.5, 4], mat: "metal" }),
      box({ id: "s1.mem", at: [200, 6, 60], size: [36, 4, 44], mat: "metal" }),
      ...candle("s1.stubN", [6, 8, 6], [198, 12, 46], "up"),
      ...candle("s1.stubS", [6, 6, 6], [198, 11, 74], "down"),
      ...hut("s1.memHut", [5, 3, 5], [212, 9.5, 42.5]),
      crate("s1.memCr1", [188, 8.6, 64]),
      crate("s1.memCr2", [204, 8.6, 54]),
      crate("s1.memCr3", [204, 8.6, 66]),
      ticker("s1.memWall", [210, 9, 66], 6),
      ...chain("s1.chainX", [218, 8, 60], [224, 8, 60]),
      ...tunnel("s1.tun", { length: 16, floorAt: [232, 7.5, 60] }),
      deckBox("s1.slide.h1", 78, 242, 0, 60, 8),
      disc({ id: "s1.slide-pad", at: [100, 0.08, 60], r: 1.1, mat: "neon" }),
      ...vista,
      disc({ id: "crit-CP1", at: [4, 0.08, 60], r: 1.2, mat: "neon" }),
      disc({ id: "crit-CP2", at: [85, 0.08, 60], r: 1.2, mat: "neon" })
    ],
    weapons: [],
    checkpoints: [
      { id: "CP1", at: [4, 0, 60] },
      { id: "CP2", at: [85, 0, 60], when: "S1-E1.cleared" }
    ],
    mechanisms: [
      { kind: "killPlane", id: "s1.kill", y: -40 },
      { kind: "conduit", id: "c1", at: [37, 2, 50], spell: "chainZap", powers: "eb1" },
      { kind: "energyBridge", id: "eb1", from: [30, 0, 60], to: [44, 0, 60], width: 4, when: "c1" },
      door4("gate1", [79.7, 2, 60], [0.6, 4, 8], { opens: "S1-E1.cleared" }),
      { kind: "jetpack", id: "s1.jet", at: [88, 0.4, 60] },
      { kind: "jetpack", id: "s1.jet-n", at: [88, 0.4, 58] },
      { kind: "jetpack", id: "s1.jet-s", at: [88, 0.4, 62] },
      { kind: "fuelPad", id: "s1.pad.h1", at: [108, 0.2, 48], safe: true },
      { kind: "fuelPad", id: "s1.pad.h2", at: [136, 3.2, 46], safe: true },
      { kind: "fuelPad", id: "s1.pad.h3", at: [168, 7.2, 74], safe: true },
      { kind: "secret", id: "s1.file", at: [136, -6, 46], tickets: 5, story: "Block #0 was mined by a midget on a dare." },
      ammo3("ammo-s1-1", [8, 0, 56], "bullets", 60),
      ammo3("ammo-s1-2", [26, 0, 64], "bullets", 60),
      ammo3("ammo-s1-3", [83, 0, 56], "bullets", 60),
      ammo3("ammo-s1-4", [132, 3, 54], "bullets", 60),
      ammo3("ammo-s1-5", [190, 8, 66], "shells", 12)
    ],
    encounters: [ENCOUNTERS2.E1, ENCOUNTERS2.E2]
  };

  // src/data/levels/L04/S2.js
  var vista2 = [];
  var heights = [60, 80, 100, 70, 120, 90, 110, 65, 85, 75];
  [30, 170].forEach((z, row) => {
    [20, 70, 120, 170, 220].forEach((x, i) => {
      const h = heights[row * 5 + i];
      vista2.push(...candle(`s2.vista${row * 5 + i + 1}`, [10, h, 10], [x, h / 2, z], (row + i) % 2 ? "down" : "up"));
    });
  });
  function updraft(id, min, max) {
    return { kind: "hazardZone", id, hazard: "updraft", accel: 30, min, max };
  }
  var S23 = {
    id: "S2",
    name: "Candle Forest",
    origin: [240, 0, -40],
    start: [6, 0, 100],
    yaw: -Math.PI / 2,
    footprint: [270, 200],
    routeM: 260,
    navBounds: { min: [0, 0], max: [270, 200] },
    flyerVolume: { min: [0, -40, 0], max: [270, 100, 200] },
    voids: [{ id: "s2.void", min: [-20, -200, -20], max: [290, -40, 220], penalty: 0.25, invuln: 1, mode: "lastSafe", to: [6, 0, 100] }],
    exit: { min: [250, 40, 94], max: [266, 90, 106] },
    grappleAnchors: [
      { id: "s2.hook.pit", at: [66, 20, 100], r: 2.4 },
      { id: "s2.hook.k8", at: [154, 24, 100], r: 2.6 },
      { id: "s2.hook.k11", at: [200, 48, 100], r: 2.6 },
      { id: "s2.hook.k14", at: [252, 60, 100], r: 3 }
    ],
    navLinks: [
      { from: { x: 20, z: 100 }, to: { x: 32, z: 100 }, kind: "chain" },
      { from: { x: 100, z: 100 }, to: { x: 112, z: 100 }, kind: "slider" },
      { from: { x: 112, z: 100 }, to: { x: 132, z: 100 }, kind: "slider" },
      { from: { x: 132, z: 100 }, to: { x: 154, z: 100 }, kind: "slider" }
    ],
    geometry: [
      box({ id: "s2.ent", at: [10, -2, 100], size: [20, 4, 20], mat: "metal" }),
      deckBox("s2.slide.lip", -12, 24, 0, 100, 12),
      ...stair("s2.slide.climb", [100, 0, 100], [262, 76, 100], 10),
      disc({ id: "s2.slide-pad", at: [108, 4, 100], r: 1.1, mat: "neon" }),
      ...chain("s2.chainIn", [20, 0, 100], [32, 0, 100]),
      box({ id: "s2.porchW", at: [36, -2, 100], size: [8, 4, 12], mat: "metal" }),
      box({ id: "s2.pit", at: [60, -2, 100], size: [80, 4, 160], mat: "metal" }),
      disc({ id: "s2.thresh", at: [47, 0.06, 100], r: 2, mat: "neon" }),
      ...candle("s2.pk1", [8, 6, 8], [54, 3, 40], "up"),
      ...candle("s2.pk2", [8, 10, 8], [78, 5, 40], "down"),
      ...candle("s2.pk3", [8, 8, 8], [54, 4, 160], "down"),
      ...candle("s2.pk4", [8, 12, 8], [78, 6, 160], "up"),
      ...candle("s2.pk5", [6, 16, 6], [66, 8, 170], "up"),
      crate("s2.pitCr1", [48, 0.6, 108]),
      crate("s2.pitCr2", [60, 0.6, 78]),
      crate("s2.pitCr3", [72, 0.6, 122]),
      crate("s2.pitCr4", [86, 0.6, 108]),
      ticker("s2.pitT1", [60, 1, 88], 6),
      ticker("s2.pitT2", [84, 1, 92], 6),
      ...hut("s2.pitHut", [5, 3, 5], [88, 1.5, 78]),
      ...vent("s2.pv1", [46, 0, 80]),
      ...vent("s2.pv2", [86, 0, 120]),
      box({ id: "s2.porchE", at: [96, -2, 100], size: [8, 4, 12], mat: "metal" }),
      box({ id: "s2.book", at: [135, -13, 100], size: [60, 2, 70], mat: "glass" }),
      ...vent("s2.v1", [122, -12, 100]),
      ...vent("s2.v2", [144, -12, 112]),
      box({ id: "s2.rail1", at: [112, 3.7, 100], size: [0.6, 0.6, 60], mat: "trim" }),
      box({ id: "s2.sl1-deck", at: [112, 5, 74], size: [8, 2, 8], mat: "metal", tag: "mover" }),
      box({ id: "s2.sl1-wall", at: [116.3, 6.6, 74], size: [0.6, 1.2, 8], mat: "trim" }),
      box({ id: "s2.rail2", at: [132, 9.7, 100], size: [0.6, 0.6, 60], mat: "trim" }),
      box({ id: "s2.sl2-deck", at: [132, 11, 126], size: [8, 2, 8], mat: "metal", tag: "mover" }),
      box({ id: "s2.sl2-wall", at: [136.3, 12.6, 126], size: [0.6, 1.2, 8], mat: "trim" }),
      ...candle("s2.k8", [12, 20, 12], [154, 10, 100], "up"),
      ...vent("s2.v3", [154, 20, 100]),
      ...candle("s2.k9", [8, 18, 8], [176, 21, 80], "down"),
      ...candle("s2.k10", [8, 22, 8], [176, 23, 120], "up"),
      ...candle("s2.k11", [12, 24, 12], [200, 30, 100], "up"),
      ...vent("s2.v4", [200, 42, 100]),
      ...hollowCandle("s2.k12", [10, 20, 10], [222, 38, 80]),
      ...candle("s2.k13", [8, 24, 8], [222, 40, 120], "up"),
      ...candle("s2.k14", [20, 30, 20], [252, 39, 100], "up"),
      ticker("s2.athT1", [246, 55, 94], 6),
      ticker("s2.athT2", [246, 55, 106], 6),
      ...server("s2.athSrv", [254, 55, 100]),
      disc({ id: "s2.ring", at: [259, 54.1, 100], r: 3, mat: "neon" }),
      ...vista2,
      disc({ id: "crit-CP3", at: [36, 0.08, 100], r: 1.2, mat: "neon" }),
      disc({ id: "crit-CP4", at: [96, 0.08, 100], r: 1.2, mat: "neon" })
    ],
    weapons: [
      { id: "mg-pit", at: [50, 0, 94], gun: "mg", quality: "uncommon", why: "bitbug flocks in S2-E3" }
    ],
    checkpoints: [
      { id: "CP3", at: [36, 0, 100] },
      { id: "CP4", at: [96, 0, 100], when: "S2-E3.cleared" }
    ],
    mechanisms: [
      { kind: "killPlane", id: "s2.kill", y: -40 },
      door4("s2.pitIn", [40.3, 3, 100], [0.6, 6, 8]),
      door4("s2.pitOut", [91.7, 3, 100], [0.6, 6, 8]),
      updraft("s2.pv1-up", [43, 0, 77], [49, 18, 83]),
      updraft("s2.pv2-up", [83, 0, 117], [89, 18, 123]),
      updraft("s2.v1-up", [119, -12, 97], [125, 14, 103]),
      updraft("s2.v2-up", [141, -12, 109], [147, 14, 115]),
      updraft("s2.v3-up", [151, 20, 97], [157, 38, 103]),
      updraft("s2.v4-up", [197, 42, 97], [203, 56, 103]),
      { kind: "mover", id: "s2.sl1", mode: "pingpong", speed: 4, from: [112, 5, 74], to: [112, 5, 126], size: [8, 2, 8] },
      { kind: "mover", id: "s2.sl2", mode: "pingpong", speed: 4, from: [132, 11, 126], to: [132, 11, 74], size: [8, 2, 8] },
      { kind: "fuelPad", id: "s2.pad.pk5", at: [66, 16.2, 112], safe: true },
      { kind: "fuelPad", id: "s2.pad.k8", at: [154, 20.2, 100], safe: true },
      { kind: "fuelPad", id: "s2.pad.k11", at: [200, 42.2, 100], safe: true },
      { kind: "fuelPad", id: "s2.pad.k14", at: [252, 54.2, 100], safe: true },
      { kind: "secret", id: "s2.bonk", at: [222, 29, 80], modifier: "moonBoots" },
      ammo3("ammo-s2-1", [36, 0, 96], "bullets", 60),
      ammo3("ammo-s2-2", [50, 0, 106], "bullets", 60),
      ammo3("ammo-s2-3", [80, 0, 104], "bullets", 60),
      ammo3("ammo-s2-4", [96, 0, 104], "bullets", 60),
      ammo3("ammo-s2-5", [200, 42, 104], "bullets", 60),
      { kind: "ammoCrate", id: "crate-l1", at: [66, 0, 108], uses: 3, refill: 0.5, opens: "S2-E3.cleared" },
      { kind: "manaBloom", id: "bloom-l1", at: [66, 0, 110], amount: 50, regrow: 20, opens: "S2-E3.cleared" },
      { kind: "chest", id: "chest-l1", at: [66, 0, 104], opens: "S2-E3.cleared", roll: { minTier: "uncommon", avoidCarried: true } }
    ],
    encounters: [ENCOUNTERS2.E3, ENCOUNTERS2.E4]
  };

  // src/data/levels/L04/S3.js
  var wallX = [95, 120, 145, 170, 195, 220, 245];
  var walls = [];
  wallX.forEach((x, i) => {
    walls.push(...candle(`s3.wallN${i + 1}`, [10, 60, 10], [x, 10, 30], "down"));
    walls.push(...candle(`s3.wallS${i + 1}`, [10, 60, 10], [x, 10, 90], "down"));
  });
  var S33 = {
    id: "S3",
    name: "Liquidity Stream",
    origin: [490, 0, 0],
    start: [14, 0, 60],
    yaw: -Math.PI / 2,
    footprint: [270, 120],
    routeM: 278,
    navBounds: { min: [0, 20], max: [270, 110] },
    flyerVolume: { min: [0, -40, 20], max: [270, 80, 110] },
    voids: [{ id: "s3.void", min: [-20, -200, 0], max: [290, -40, 130], penalty: 0.25, invuln: 1, mode: "lastSafe", to: [14, 0, 60] }],
    exit: { min: [262, -6, 54], max: [270, 6, 66] },
    intro: {
      title: "Liquidity",
      lines: ["Bitcoin Obama pumps the price. The Midget dumps it.", "You ride the chart."]
    },
    grappleAnchors: [
      { id: "s3.hook.r1", at: [100, 10, 70], r: 2.4 },
      { id: "s3.hook.r2", at: [142, 10, 52], r: 2.4 },
      { id: "s3.hook.r3", at: [186, 8, 66], r: 2.4 },
      { id: "s3.hook.r4", at: [230, 8, 58], r: 2.4 }
    ],
    navLinks: [
      { from: { x: 34, z: 60 }, to: { x: 54, z: 60 }, kind: "chain" },
      { from: { x: 106, z: 68 }, to: { x: 136, z: 54 }, kind: "bridge" },
      { from: { x: 192, z: 65 }, to: { x: 224, z: 59 }, kind: "bridge" }
    ],
    geometry: [
      ...island("s3.head", 16, 4, [18, -4, 60]),
      box({ id: "s3.depotWall", at: [4, 1.5, 60], size: [0.6, 3, 8], mat: "metal" }),
      cylinder({ id: "s3.shrine", at: [22, 0, 50], r: 2.5, h: 0.5, mat: "gold" }),
      disc({ id: "s3.bloom", at: [22, 0.08, 70], r: 1.5, mat: "neon" }),
      ...sign("s3.sign", [30, 3, 56], "FLAK HITS FLYERS. WALK, SHIELD OR SNIPE."),
      ...chain("s3.chainA", [34, 0, 60], [54, 0, 60]),
      ...island("s3.isl1", 7, 3, [61, -3, 60]),
      box({ id: "s3.slide.lane", at: [140, -0.25, 60], size: [280, 0.5, 36], mat: "metal", tag: "slide" }),
      crate("s3.isl1Cr1", [56, 0.6, 57.5]),
      crate("s3.isl1Cr2", [56, 0.6, 62.5]),
      ...walls,
      ...island("s3.r1", 6, 3, [100, -1, 70]),
      box({ id: "s3.r1Wall", at: [104, 2.6, 70], size: [0.6, 1.2, 5], mat: "metal" }),
      cylinder({ id: "s3.c2post", at: [98, 2, 74], r: 0.5, h: 2, mat: "metal" }),
      ...podIsle("s3.p2", [122, 1, 46]),
      box({ id: "s3.railA", at: [120, 7.7, 53], size: [70, 0.6, 0.6], mat: "trim" }),
      box({ id: "s3.slA-deck", at: [90, 12, 53], size: [10, 8, 1.5], mat: "metal", tag: "mover" }),
      ...island("s3.r2", 6, 3, [142, -1, 52]),
      box({ id: "s3.r2Wall", at: [146, 2.6, 52], size: [0.6, 1.2, 5], mat: "metal" }),
      ...podIsle("s3.p3", [164, -9, 74]),
      box({ id: "s3.railB", at: [182, 1.7, 68], size: [70, 0.6, 0.6], mat: "trim" }),
      box({ id: "s3.slB-deck", at: [150, 6, 68], size: [10, 8, 1.5], mat: "metal", tag: "mover" }),
      ...island("s3.r3", 6, 3, [186, -5, 66]),
      box({ id: "s3.r3Wall", at: [190, -1, 66], size: [0.6, 2, 5], mat: "metal" }),
      cylinder({ id: "s3.c3post", at: [184, -2, 70], r: 0.5, h: 2, mat: "metal" }),
      ...podIsle("s3.p4", [208, 7, 48]),
      ...island("s3.r4", 6, 3, [230, -5, 58]),
      box({ id: "s3.mouth", at: [258, -4, 60], size: [24, 4, 28], mat: "metal" }),
      ticker("s3.mouthWall", [250, -1, 60], 6),
      ...pylon("s3.pylon", [252, -2, 52]),
      ...deck("eb2", [106, 8, 68], [136, 8, 54], 4, 8),
      ...deck("eb3", [192, 8, 65], [224, 8, 59], 4, 8),
      box({ id: "s3.tun-roof", at: [264, 2.5, 60], size: [12, 1, 8], mat: "metal" }),
      box({ id: "s3.tun-n", at: [264, 1, 56.5], size: [12, 6, 1], mat: "metal" }),
      box({ id: "s3.tun-s", at: [264, 1, 63.5], size: [12, 6, 1], mat: "metal" }),
      ...island("s3.fileIsl", 3, 2, [158, -3, 104]),
      disc({ id: "crit-CP5", at: [14, 0.08, 60], r: 1.2, mat: "neon" })
    ],
    weapons: [],
    checkpoints: [
      { id: "CP5", at: [14, 0, 60] }
    ],
    mechanisms: [
      { kind: "killPlane", id: "s3.kill", y: -40 },
      { kind: "depot", id: "depot-a", at: [8, 0, 60], yaw: 90, services: ["crate", "health", "bench", "shop", "checkpoint"] },
      { kind: "depotCrate", id: "depot-crate-a", at: [8, 0, 60] },
      { kind: "shrine", id: "s3.shrine-use", at: [22, 0.5, 50], spell: "manaShield" },
      { kind: "manaBloom", id: "s3.bloom-use", at: [22, 0, 70], amount: 50, regrow: 20 },
      { kind: "hazardZone", id: "s3.wind", hazard: "wind", min: [80, -8, 44], max: [250, 34, 76], force: [6, 0, 0] },
      { kind: "mover", id: "s3.slA", mode: "pingpong", speed: 8, pause: 1, from: [90, 12, 53], to: [150, 12, 53], size: [10, 8, 1.5] },
      { kind: "mover", id: "s3.slB", mode: "pingpong", speed: 8, pause: 1, from: [150, 6, 68], to: [214, 6, 68], size: [10, 8, 1.5] },
      { kind: "conduit", id: "c2", at: [98, 4.5, 74], spell: "chainZap", powers: "eb2" },
      { kind: "energyBridge", id: "eb2", from: [106, 2, 68], to: [136, 2, 54], width: 4, when: "c2" },
      { kind: "conduit", id: "c3", at: [184, 0.5, 70], spell: "chainZap", powers: "eb3" },
      { kind: "energyBridge", id: "eb3", from: [192, -2, 65], to: [224, -2, 59], width: 4, when: "c3" },
      { kind: "target", id: "s3.gatePylon", at: [252, -2, 52], hp: 228, def: "pylon", weak: 2 },
      door4("s3.mouthGate", [258.3, 0, 60], [0.6, 4, 6], { opens: "s3.gatePylon.destroyed" }),
      { kind: "fuelPad", id: "s3.pad.r1", at: [100, 2.2, 70], safe: true },
      { kind: "fuelPad", id: "s3.pad.r2", at: [142, 2.2, 52], safe: true },
      { kind: "fuelPad", id: "s3.pad.r3", at: [186, -1.8, 66], safe: true },
      { kind: "fuelPad", id: "s3.pad.r4", at: [230, -1.8, 58], safe: true },
      { kind: "secret", id: "s3.file", at: [158, -1, 104], tickets: 5, story: "The spread is the fee. The fee is the point." },
      ammo3("ammo-s3-1", [40, 0, 60], "bullets", 60),
      ammo3("ammo-s3-2", [100, 2, 66], "bullets", 60),
      ammo3("ammo-s3-3", [142, 2, 48], "sniper", 8),
      ammo3("ammo-s3-4", [186, -2, 62], "bullets", 60),
      ammo3("ammo-s3-5", [252, -2, 66], "bullets", 60)
    ],
    encounters: [ENCOUNTERS2.E5]
  };

  // src/data/levels/L04/S4.js
  var S43 = {
    id: "S4",
    name: "Mine Field",
    origin: [750, 0, -40],
    start: [6, 0, 100],
    yaw: -Math.PI / 2,
    footprint: [250, 200],
    routeM: 220,
    navBounds: { min: [0, 40], max: [250, 160] },
    flyerVolume: { min: [0, -60, 40], max: [250, 90, 160] },
    voids: [{ id: "s4.void", min: [-20, -200, 20], max: [270, -60, 180], penalty: 0.25, invuln: 1, mode: "lastSafe", to: [6, 0, 100] }],
    exit: { min: [222, -2, 94], max: [230, 6, 106] },
    grappleAnchors: [
      { id: "s4.hook.b3", at: [68, 14, 98], r: 2.4 },
      { id: "s4.hook.b7", at: [110, 18, 72], r: 2.4 },
      { id: "s4.hook.b9", at: [132, 12, 100], r: 2.4 },
      { id: "s4.hook.hb5", at: [177, 26, 100], r: 2.2 }
    ],
    navLinks: [
      { from: { x: 169, z: 100 }, to: { x: 185, z: 100 }, kind: "bridge" }
    ],
    geometry: [
      box({ id: "s4.ent", at: [12, -2, 100], size: [24, 4, 24], mat: "metal" }),
      deckBox("s4.slide.lip", -16, 8, 0, 100, 8),
      ...stair("s4.slide.up", [20, 0, 100], [36, 10, 100], 10),
      deckBox("s4.slide.field", 36, 140, 10, 100, 10),
      ...stair("s4.slide.down", [140, 10, 100], [156, 0, 100], 10),
      box({ id: "s4.entWall", at: [22, 0.6, 100], size: [0.6, 1.2, 8], mat: "metal" }),
      ...sign("s4.sign", [22, 3, 92], "POP THEM FROM HERE"),
      box({ id: "s4.b1", at: [44, -1, 84], size: [10, 6, 10], mat: "metal" }),
      box({ id: "s4.b2", at: [50, 2, 116], size: [8, 8, 8], mat: "metal" }),
      box({ id: "s4.b3", at: [68, 6, 98], size: [14, 4, 8], mat: "metal" }),
      box({ id: "s4.b4", at: [74, -7, 74], size: [6, 6, 6], mat: "metal" }),
      box({ id: "s4.b5", at: [88, 7, 124], size: [10, 10, 10], mat: "metal" }),
      box({ id: "s4.b6", at: [96, 0, 92], size: [8, 4, 14], mat: "metal" }),
      box({ id: "s4.b7", at: [110, 9, 72], size: [12, 6, 12], mat: "metal" }),
      box({ id: "s4.b8", at: [116, 0, 112], size: [6, 12, 6], mat: "metal" }),
      box({ id: "s4.b9", at: [132, 4, 100], size: [12, 4, 12], mat: "metal" }),
      box({ id: "s4.b9Wall", at: [128, 6.6, 100], size: [0.6, 1.2, 6], mat: "metal" }),
      box({ id: "s4.porchW", at: [142, -2, 100], size: [8, 4, 12], mat: "metal" }),
      box({ id: "s4.chFloorN", at: [177, -2, 80.5], size: [62, 4, 23], mat: "metal" }),
      box({ id: "s4.chFloorS", at: [177, -2, 119.5], size: [62, 4, 23], mat: "metal" }),
      box({ id: "s4.chFloorW", at: [157.5, -2, 100], size: [23, 4, 16], mat: "metal" }),
      box({ id: "s4.chFloorE", at: [196.5, -2, 100], size: [23, 4, 16], mat: "metal" }),
      ...lockRoom("s4.chRoom", {
        min: [147, 0, 70],
        max: [207, 30, 130],
        gaps: [{ side: "w", at: 100, width: 4, height: 6 }, { side: "e", at: 100, width: 4, height: 6 }]
      }),
      disc({ id: "s4.thresh", at: [153, 0.06, 100], r: 2, mat: "neon" }),
      box({ id: "s4.hb1", at: [159, 8.5, 82], size: [8, 3, 8], mat: "metal" }),
      box({ id: "s4.hb2", at: [195, 10.5, 82], size: [8, 3, 8], mat: "metal" }),
      box({ id: "s4.hb3", at: [159, 12.5, 118], size: [8, 3, 8], mat: "metal" }),
      box({ id: "s4.hb4", at: [195, 6.5, 118], size: [8, 3, 8], mat: "metal" }),
      box({ id: "s4.hb5", at: [177, 18.5, 100], size: [6, 3, 6], mat: "metal" }),
      box({ id: "s4.chSrv1", at: [154, 1, 92], size: [1.2, 2, 2.4], mat: "metal" }),
      box({ id: "s4.chSrv2", at: [154, 1, 108], size: [1.2, 2, 2.4], mat: "metal" }),
      box({ id: "s4.chSrv3", at: [200, 1, 92], size: [1.2, 2, 2.4], mat: "metal" }),
      box({ id: "s4.chSrv4", at: [200, 1, 108], size: [1.2, 2, 2.4], mat: "metal" }),
      box({ id: "s4.chCr1", at: [165, 0.6, 76], size: [1.6, 1.2, 1.6], mat: "crate" }),
      box({ id: "s4.chCr2", at: [189, 0.6, 76], size: [1.6, 1.2, 1.6], mat: "crate" }),
      box({ id: "s4.chCr3", at: [165, 0.6, 124], size: [1.6, 1.2, 1.6], mat: "crate" }),
      box({ id: "s4.chCr4", at: [189, 0.6, 124], size: [1.6, 1.2, 1.6], mat: "crate" }),
      box({ id: "s4.chT1", at: [166, 1, 78], size: [0.6, 2, 6], mat: "neon" }),
      box({ id: "s4.chT2", at: [188, 1, 122], size: [0.6, 2, 6], mat: "neon" }),
      cylinder({ id: "s4.c4post", at: [152, 0, 76], r: 0.5, h: 2, mat: "metal" }),
      sphere({ id: "s4.wellVis", at: [177, -8, 100], r: 3, mat: "metal" }),
      disc({ id: "s4.well1", at: [177, -5, 100], r: 6, mat: "neon" }),
      disc({ id: "s4.well2", at: [177, -5.1, 100], r: 9, mat: "neon" }),
      disc({ id: "s4.well3", at: [177, -5.2, 100], r: 12, mat: "neon" }),
      ...deck("eb4", [169, 0, 100], [185, 0, 100], 4, 0),
      box({ id: "s4.exit", at: [219, -2, 100], size: [22, 4, 20], mat: "metal" }),
      box({ id: "s4.duckCache", at: [177, 30.6, 100], size: [1.2, 0.8, 0.8], mat: "gold" }),
      box({ id: "s4.tun-roof", at: [224, 4.5, 100], size: [12, 1, 8], mat: "metal" }),
      box({ id: "s4.tun-n", at: [224, 3, 96.5], size: [12, 6, 1], mat: "metal" }),
      box({ id: "s4.tun-s", at: [224, 3, 103.5], size: [12, 6, 1], mat: "metal" }),
      disc({ id: "crit-CP6", at: [8, 0.08, 100], r: 1.2, mat: "neon" }),
      disc({ id: "crit-CP7", at: [142, 0.08, 100], r: 1.2, mat: "neon" }),
      disc({ id: "crit-CP8", at: [219, 0.08, 100], r: 1.2, mat: "neon" })
    ],
    weapons: [
      { id: "sn-mines", at: [16, 0, 94], gun: "sniper", quality: "uncommon", why: "Balloon Midgets in S4-E6 and Jet Obamas in S4-E7" }
    ],
    checkpoints: [
      { id: "CP6", at: [8, 0, 100] },
      { id: "CP7", at: [142, 0, 100], when: "S4-E6.cleared" },
      { id: "CP8", at: [219, 0, 100], when: "S4-E7.cleared" }
    ],
    mechanisms: [
      { kind: "killPlane", id: "s4.kill", y: -60 },
      { kind: "hazardZone", id: "s4.wind", hazard: "wind", min: [36, -10, 60], max: [126, 30, 140], force: [0, 0, 3] },
      door4("s4.chIn", [146.3, 3, 100], [0.6, 6, 4]),
      door4("s4.chOut", [207.7, 3, 100], [0.6, 6, 4]),
      { kind: "gravityWell", id: "s4.well", at: [177, -8, 100], r: 26, strength: 5, killR: 4 },
      { kind: "conduit", id: "c4", at: [152, 2.5, 76], spell: "chainZap", powers: "eb4" },
      { kind: "energyBridge", id: "eb4", from: [169, 0, 100], to: [185, 0, 100], width: 4, when: "c4" },
      { kind: "fuelPad", id: "s4.pad.b3", at: [68, 8.2, 98], safe: true },
      { kind: "fuelPad", id: "s4.pad.b9", at: [132, 6.2, 100], safe: true },
      { kind: "fuelPad", id: "s4.pad.w", at: [150, 0.2, 94], safe: true },
      { kind: "fuelPad", id: "s4.pad.e", at: [204, 0.2, 94], safe: true },
      { kind: "power", id: "s4.overshield", at: [177, 20, 100], modifier: "overshield" },
      { kind: "cache", id: "s4.cache", at: [177, 30.6, 100], gun: "duck", quality: "legendary" },
      { kind: "secret", id: "s4.file", at: [74, -4, 74], tickets: 5, story: "Dust: balances too small to move, so they float." },
      ammo3("ammo-s4-1", [8, 0, 104], "bullets", 60),
      ammo3("ammo-s4-2", [16, 0, 106], "sniper", 8),
      ammo3("ammo-s4-3", [96, 2, 96], "sniper", 8),
      ammo3("ammo-s4-4", [130, 6, 104], "sniper", 8),
      ammo3("ammo-s4-5", [142, 0, 96], "bullets", 60),
      ammo3("ammo-s4-6", [150, 0, 106], "bullets", 60),
      ammo3("ammo-s4-7", [204, 0, 106], "bullets", 60),
      ammo3("ammo-s4-8", [159, 10, 82], "sniper", 8),
      ammo3("ammo-s4-9", [219, 0, 94], "bullets", 60),
      ammo3("ammo-s4-10", [176, 30.6, 101], "rubber", 16),
      ammo3("ammo-s4-11", [178, 30.6, 101], "rubber", 16),
      { kind: "ammoCrate", id: "crate-l2", at: [204, 0, 100], uses: 3, refill: 0.5, opens: "S4-E7.cleared" },
      { kind: "health", id: "s4.l2-health", at: [204, 0, 102], opens: "S4-E7.cleared" },
      { kind: "chest", id: "chest-l2", at: [204, 0, 96], opens: "S4-E7.cleared", roll: { minTier: "uncommon", avoidCarried: true } }
    ],
    encounters: [ENCOUNTERS2.E6, ENCOUNTERS2.E7]
  };

  // src/data/levels/L04/S5.js
  var S53 = {
    id: "S5",
    name: "Ledger Hub",
    origin: [960, 0, -20],
    start: [4, 0, 80],
    yaw: -Math.PI / 2,
    footprint: [140, 160],
    routeM: 205,
    navBounds: { min: [0, 20], max: [140, 140] },
    flyerVolume: { min: [0, -40, 20], max: [140, 80, 140] },
    voids: [{ id: "s5.void", min: [-20, -200, 0], max: [160, -40, 170], penalty: 0.25, invuln: 1, mode: "lastSafe", to: [4, 0, 80] }],
    exit: { min: [130, -1, 74], max: [138, 6, 86] },
    grappleAnchors: [
      { id: "s5.hook.n2", at: [31, 20, 97], r: 2.2 },
      { id: "s5.hook.n1", at: [60, 16, 46], r: 2.2 },
      { id: "s5.hook.n3", at: [89, 24, 97], r: 2.2 },
      { id: "s5.hook.roof", at: [60, 22, 100], r: 2.4 }
    ],
    navLinks: [
      { from: { x: 102, z: 80 }, to: { x: 112, z: 80 }, kind: "bridge" }
    ],
    geometry: [
      box({ id: "s5.ent", at: [9, -2, 80], size: [18, 4, 10], mat: "metal" }),
      ...island("s5.isl", 42, 6, [60, -6, 80]),
      cylinder({ id: "s5.tower", at: [60, 0, 100], r: 8, h: 16, mat: "metal" }),
      box({ id: "s5.roofP1", at: [60, 16.6, 73], size: [0.6, 1.2, 4], mat: "metal" }),
      box({ id: "s5.roofP2", at: [60, 16.6, 87], size: [0.6, 1.2, 4], mat: "metal" }),
      box({ id: "s5.stepA", at: [48, 2, 76], size: [4, 4, 4], mat: "metal" }),
      box({ id: "s5.stepB", at: [49, 4, 84], size: [4, 8, 4], mat: "metal" }),
      box({ id: "s5.stepC", at: [54, 6, 90], size: [4, 12, 4], mat: "metal" }),
      ticker("s5.tickW1", [38, 1, 72], 6),
      ticker("s5.tickW2", [38, 1, 88], 6),
      ...server("s5.srvW1", [30, 1, 68]),
      ...server("s5.srvW2", [46, 1, 64]),
      ...server("s5.srvW3", [46, 1, 96]),
      crate("s5.crW1", [26, 0.6, 74]),
      crate("s5.crW2", [26, 0.6, 86]),
      crate("s5.crW3", [44, 0.6, 80]),
      ...hut("s5.hutN", [8, 3, 6], [60, 1.5, 44]),
      ...hut("s5.hutS", [8, 3, 6], [60, 1.5, 116]),
      cylinder({ id: "s5.n1plat", at: [60, 8, 46], r: 5, h: 2, mat: "stone" }),
      cylinder({ id: "s5.n2plat", at: [31, 12, 97], r: 5, h: 2, mat: "stone" }),
      cylinder({ id: "s5.n3plat", at: [89, 16, 97], r: 5, h: 2, mat: "stone" }),
      ...validatorNode("n1-body", [60, 10, 46]),
      ...validatorNode("n2-body", [31, 14, 97]),
      ...validatorNode("n3-body", [89, 18, 97]),
      ...server("s5.srvE1", [84, 1, 72]),
      ...server("s5.srvE2", [84, 1, 88]),
      crate("s5.crE", [96, 0.6, 76]),
      box({ id: "s5.vaultFloor", at: [123, -2, 80], size: [22, 4, 24], mat: "metal" }),
      box({ id: "s5.vaultN", at: [123, 2.5, 68.5], size: [22, 5, 1], mat: "metal" }),
      box({ id: "s5.vaultS", at: [123, 2.5, 91.5], size: [22, 5, 1], mat: "metal" }),
      box({ id: "s5.vaultW1", at: [112.5, 2.5, 72.5], size: [1, 5, 9], mat: "metal" }),
      box({ id: "s5.vaultW2", at: [112.5, 2.5, 87.5], size: [1, 5, 9], mat: "metal" }),
      box({ id: "s5.vaultE1", at: [133.5, 2.5, 72.5], size: [1, 5, 9], mat: "metal" }),
      box({ id: "s5.vaultE2", at: [133.5, 2.5, 87.5], size: [1, 5, 9], mat: "metal" }),
      box({ id: "s5.vaultRoof", at: [123, 5.5, 80], size: [22, 1, 24], mat: "metal" }),
      box({ id: "s5.batLedge", at: [60, -9.25, 114], size: [4, 0.5, 4], mat: "metal" }),
      ...deck("eb5", [102, 0, 80], [112, 0, 80], 5, 0),
      disc({ id: "crit-CP9", at: [123, 0.08, 80], r: 1.2, mat: "neon" })
    ],
    weapons: [],
    checkpoints: [
      { id: "CP9", at: [123, 0, 80], when: "S5-E8.cleared" }
    ],
    mechanisms: [
      { kind: "killPlane", id: "s5.kill", y: -40 },
      { kind: "target", id: "n1", at: [60, 10, 46], hp: 228, def: "validatorNode", weak: 2 },
      { kind: "target", id: "n2", at: [31, 14, 97], hp: 228, def: "validatorNode", weak: 2 },
      { kind: "target", id: "n3", at: [89, 18, 97], hp: 228, def: "validatorNode", weak: 2 },
      { kind: "energyBridge", id: "eb5", from: [102, 0, 80], to: [112, 0, 80], width: 5, when: "nodes" },
      door4("s5.vaultDoor", [112.5, 2, 80], [0.6, 4, 6], { opens: "S5-E8.cleared" }),
      door4("s5.exitDoor", [133.5, 2, 80], [0.6, 4, 6]),
      { kind: "depot", id: "depot-b", at: [123, 0, 74], yaw: 180, services: ["crate", "health", "bench", "shop", "checkpoint"] },
      { kind: "depotCrate", id: "depot-crate-b", at: [123, 0, 74] },
      { kind: "power", id: "s5.fuel", at: [60, 17, 100], modifier: "fuel" },
      { kind: "fuelPad", id: "s5.pad.w", at: [24, 0.2, 80], safe: true },
      { kind: "fuelPad", id: "s5.pad.e", at: [92, 0.2, 80], safe: true },
      { kind: "secret", id: "s5.battery", at: [60, -9, 114], mana: 10, manaRegen: 0.5 },
      ammo3("ammo-s5-1", [9, 0, 77], "bullets", 60),
      ammo3("ammo-s5-2", [34, 0, 92], "sniper", 8),
      ammo3("ammo-s5-3", [60, 16, 76], "bullets", 60),
      ammo3("ammo-s5-4", [92, 0, 84], "bullets", 60),
      ammo3("ammo-s5-5", [118, 0, 84], "bullets", 60)
    ],
    encounters: [ENCOUNTERS2.E8]
  };

  // src/data/levels/L04/SB.js
  var tiles = [];
  for (let j = 0; j < 5; j++) {
    for (let i = 0; i < 5; i++) {
      if ((i === 0 || i === 4) && (j === 0 || j === 4)) continue;
      const drop = (i + j) % 2 === 1;
      const rise = i === 2 && j === 0 ? 6 : i === 2 && j === 4 ? 3 : 0;
      tiles.push({
        ...box({
          id: `sb.t${i}${j}`,
          at: [46 + 12 * i, -2, 36 + 12 * j],
          size: [12, 4, 12],
          mat: "metal"
        }),
        tag: drop ? "drop" : "keep",
        rise
      });
    }
  }
  var rivets = [
    [64, 54],
    [76, 54],
    [64, 66],
    [76, 66],
    [52, 54],
    [52, 66],
    [88, 54],
    [88, 66]
  ].map(([x, z], n) => cylinder({ id: `sb.rivet${n + 1}`, at: [x, -4, z], r: 1.5, h: 4, mat: "trim" }));
  var vista3 = [];
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2;
    const h = 60;
    const y = 20 + h / 2;
    vista3.push(...candle(`sb.vista${i + 1}`, [10, h, 10], [70 + Math.cos(a) * 45, y, 60 + Math.sin(a) * 45], i % 2 ? "down" : "up"));
  }
  var SB = {
    id: "SB",
    name: "The Exchange",
    origin: [1088, 0, 0],
    start: [4, 0, 60],
    yaw: -Math.PI / 2,
    footprint: [110, 120],
    routeM: 110,
    navBounds: { min: [0, 20], max: [110, 100] },
    flyerVolume: { min: [0, -40, 20], max: [110, 16, 100] },
    voids: [{
      id: "sb.void",
      min: [-20, -200, 0],
      max: [130, -40, 130],
      penalty: 0.25,
      invuln: 1,
      mode: "fixed",
      when: "flashCrash",
      to: [70, 0, 60]
    }],
    exit: null,
    intro: {
      title: "The Pump & Dump Duo",
      lines: ["Shiller shills.", "One counts. One flies."]
    },
    grappleAnchors: [
      { id: "sb.hook.moon", at: [70, 12, 36], r: 2.6 },
      { id: "sb.hook.py2", at: [92, 16, 74], r: 2.2 },
      { id: "sb.hook.py3", at: [48, 18, 74], r: 2.2 },
      { id: "sb.hook.lid", at: [70, 14, 60], r: 2.4 }
    ],
    navLinks: [
      { from: { x: 52, z: 51 }, to: { x: 88, z: 51 }, kind: "slider" },
      { from: { x: 88, z: 69 }, to: { x: 52, z: 69 }, kind: "slider" }
    ],
    geometry: [
      box({ id: "sb.vest", at: [11, -2, 60], size: [22, 4, 16], mat: "metal" }),
      cylinder({ id: "sb.jetDais", at: [6, 0, 54], r: 1.5, h: 0.5, mat: "gold" }),
      box({ id: "sb.cause", at: [31, -0.5, 60], size: [18, 1, 6], mat: "metal" }),
      box({ id: "sb.gateP1", at: [39.7, 2.5, 56.5], size: [1, 5, 1], mat: "metal" }),
      box({ id: "sb.gateP2", at: [39.7, 2.5, 63.5], size: [1, 5, 1], mat: "metal" }),
      ...tiles,
      ...rivets,
      cylinder({ id: "sb.podium", at: [70, 0, 60], r: 3, h: 1, mat: "gold" }),
      ...candle("sb.bar1", [3, 3, 3], [58, 1.5, 46], "up"),
      ...candle("sb.bar2", [3, 4, 3], [82, 2, 46], "down"),
      ...candle("sb.bar3", [3, 4, 3], [58, 2, 74], "up"),
      ...candle("sb.bar4", [3, 3, 3], [82, 1.5, 74], "down"),
      crate("sb.chainW1", [46, 0.6, 48]),
      crate("sb.chainW2", [46, 0.6, 72]),
      ...chain("sb.chainW", [46, 1.2, 46], [46, 1.2, 52]),
      crate("sb.chainE1", [94, 0.6, 55.5]),
      crate("sb.chainE2", [94, 0.6, 64.5]),
      ...chain("sb.chainE", [94, 1.2, 56.5], [94, 1.2, 63.5]),
      box({ id: "sb.SLa-deck", at: [52, 1.25, 51], size: [3, 2.5, 3], mat: "metal", tag: "mover" }),
      box({ id: "sb.SLb-deck", at: [88, 1.25, 69], size: [3, 2.5, 3], mat: "metal", tag: "mover" }),
      ...pylon("sb.py1-vis", [70, 0, 35]),
      cylinder({ id: "sb.py2stub", at: [92, 0, 74], r: 1.5, h: 5, mat: "candleDown" }),
      ...pylon("sb.py2-vis", [92, 5, 74]),
      cylinder({ id: "sb.py3stub", at: [48, 0, 74], r: 1.5, h: 8, mat: "candleUp" }),
      ...pylon("sb.py3-vis", [48, 8, 74]),
      ...pylon("sb.cb1-vis", [47, 0, 66]),
      ...pylon("sb.cb2-vis", [93, 0, 66]),
      box({ id: "sb.lid", at: [70, 16.3, 60], size: [56, 0.6, 56], mat: "forceField", tag: "lockWall" }),
      ...fireRing("sb.ring", { at: [70, 0, 60], r: 27.8, h: 4 }),
      ...vista3,
      disc({ id: "crit-CP10", at: [11, 0.08, 60], r: 1.2, mat: "neon" })
    ],
    weapons: [
      { id: "bz-duo", at: [6, 0, 66], gun: "bazooka", quality: "uncommon", why: "pylons and the Duo in SB-BOSS" }
    ],
    checkpoints: [
      { id: "CP10", at: [11, 0, 60] }
    ],
    mechanisms: [
      { kind: "killPlane", id: "sb.kill", y: -40, rescue: [70, 0, 60], when: "flashCrash" },
      { kind: "jetpack", id: "sb.jet", at: [6, 1.2, 54], skipIfOwned: true },
      { kind: "jetpack", id: "sb.jet-lane", at: [12, 0.4, 60], skipIfOwned: true },
      door4("sb.gate", [39.7, 3, 60], [0.6, 6, 6], { opens: "p.jet.has" }),
      { kind: "fireRing", id: "sb.fire", at: [70, 0, 60], r: [27.8, 26.8, 25.5] },
      { kind: "mover", id: "sb.SLa", mode: "pingpong", speed: 3, from: [52, 1.25, 51], to: [88, 1.25, 51], size: [3, 2.5, 3] },
      { kind: "mover", id: "sb.SLb", mode: "pingpong", speed: 3, from: [88, 1.25, 69], to: [52, 1.25, 69], size: [3, 2.5, 3] },
      { kind: "depotCrate", id: "depot-crate-vest", at: [18, 0, 60] },
      { kind: "depotCrate", id: "depot-crate-arena", at: [74, 0, 64.5] },
      { kind: "fuelPad", id: "sb.pad.vest", at: [16, 0.2, 66], safe: true },
      { kind: "fuelPad", id: "sb.pad.t31", at: [86, 0.2, 44], safe: true },
      { kind: "fuelPad", id: "sb.pad.t13", at: [54, 0.2, 76], safe: true },
      { kind: "power", id: "sb.fuel", at: [70, 1, 60], modifier: "fuel", when: "part:5" },
      ammo3("ammo-sb-1", [14, 0, 54], "bullets", 60),
      ammo3("ammo-sb-2", [9, 0, 66], "rockets", 3),
      ammo3("ammo-sb-3", [62, 0, 44], "bullets", 60),
      ammo3("ammo-sb-4", [78, 0, 76], "bullets", 60),
      ammo3("ammo-sb-5", [78, 0, 44], "rockets", 3),
      { kind: "ammoCrate", id: "crate-l3", at: [70, 1, 60], uses: 3, refill: 0.5, opens: "SB-BOSS.cleared" },
      {
        kind: "bossReward",
        id: "sb.reward",
        at: [70, 1, 60],
        spell: "pumpIt",
        guns: { rare: 2, boss: ["ray", "bigbullets"] }
      }
    ],
    encounters: [ENCOUNTERS2.BOSS]
  };

  // src/data/levels/L04/enemies.js
  var L04_FLYERS = {
    bitbug: {
      archetype: "swarmFlock",
      hp: 12,
      hpTier: 18,
      seconds: 3,
      note: "Live dress() hp is 18. Flocks of 6 count as 1 against maxAlive."
    },
    jetObama: {
      archetype: "jetFlyer",
      hp: 80,
      hpTier: 122,
      seconds: 9,
      thruster: 2,
      death: { r: 3, damage: 15 },
      note: "Live dress() hp is 55 and the weak spot is 2.5\xD7. The level wants \xD72."
    },
    balloonMidget: {
      archetype: "floaterMine",
      hp: 10,
      hpTier: 15,
      seconds: 5,
      speed: 3,
      fuse: 2.5,
      burst: { r: 4, damage: 20, damageTier: 30 },
      note: "Live dress() hp is 28 and the blast is 18 in r 2.6."
    }
  };
  var FLAK_POD = {
    id: "flakPod",
    name: "Gas Fee Flak Pod",
    archetype: "flakTurret",
    hp: 160,
    hpTier: 243,
    stagger: false,
    radius: 1.3,
    height: 2.6,
    speed: 0,
    turn: 120,
    pitch: [-5, 85],
    range: 45,
    airborne: { groundedFor: 0.35, feetAbove: 1.2 },
    dropLock: 0.5,
    tell: 0.9,
    shells: 4,
    shellGap: 0.22,
    shellSpeed: 24,
    shellRadius: 0.3,
    fuse: 2.5,
    burst: { r: 3.2, damage: [8, 4], damageTier: [12, 6] },
    fuelDrain: 18,
    lead: 0.7,
    between: [3, 3.6],
    gooJam: 4,
    zapStun: 1.5,
    shield: { absorb: 0.6, fuel: 0, manaPerHit: 6 },
    elite: {
      name: "Priority Fee",
      hp: 400,
      hpTier: 608,
      shells: 6,
      range: 55,
      scale: 1.25
    },
    drops: { ammo: 0.85, gun: 0.08, tickets: 4, resources: 0 },
    seconds: 9,
    look: [
      { kind: "cylinder", at: [0, 0, 0], r: 1.3, h: 1, mat: "metal" },
      { kind: "sphere", at: [0, 1.7, 0], r: 0.85, mat: "neon", color: 11693055 },
      { kind: "box", at: [0.25, 1.7, 0.6], size: [0.3, 0.3, 1.6], mat: "metal" },
      { kind: "box", at: [-0.25, 1.7, 0.6], size: [0.3, 0.3, 1.6], mat: "metal" },
      { kind: "box", at: [0, 0.8, -1.2], size: [0.5, 0.5, 0.3], mat: "metal" }
    ],
    hitboxes: [
      { zone: "body", shape: "cylinder", r: 1.3, y0: 0, y1: 1 },
      { zone: "armor", shape: "sphere", r: 0.85, y: 1.7, mult: 0.4 },
      { zone: "weak", shape: "sphere", r: 0.4, y: 0.8, z: -1.2, mult: 2.5, onlyWhen: "vent" }
    ]
  };
  var DUO = {
    k: 1.52,
    obama: { pump: 578, hype: 669, dump: 760, total: 2007 },
    midget: { smallCap: 684, moon: 783, squeeze: 852, total: 2319 },
    pylon: 274,
    breaker: 365,
    names: { obama: "Bitcoin Obama", midget: "The Midget", duo: "The Pump & Dump Duo" }
  };
  var L04_SPELLS = {
    held: ["gooBolt", "chainZap", "carpet", "yeet", "swarm"],
    shrine: "manaShield",
    reward: "pumpIt"
  };

  // src/data/levels/L04/index.js
  var L04_PACING = [
    ["S1-E1", 70.2],
    ["jetpack", 42],
    ["S1-E2", 70.4],
    ["S2-E3", 142.1],
    ["S2-E4", 79.1],
    ["depot-a", 65.5],
    ["S3-E5", 125.2],
    ["S4-E6", 75.6],
    ["S4-E7", 175],
    ["S5-E8", 125.5],
    ["depot-b", 56.8],
    ["SB-BOSS", 257.3]
  ];
  var L04_BOT = [
    { section: "S1", steps: ["spawn", "zap c1 from (28, 0, 60)", "eb1", "clear E1", "gate1", "pedestal", "jet h1 h2 h3", "clear E2", "chain", "tunnel"] },
    { section: "S2", steps: ["porch", "cross x 47", "take mg-pit", "hold pk5 through 4 waves", "jet sl1 sl2 K8", "v3", "K11", "v4", "K14", "ring"] },
    { section: "S3", steps: ["depot", "shrine", "chain", "FP1 on foot", "zap c2", "walk eb2", "zap c3", "walk eb3", "destroy the gate pylon", "tunnel"] },
    { section: "S4", steps: ["take sn-mines", "snipe A and B from the wall", "jet b3 b6 b9", "cross x 153", "fight from hb3", "zap c4", "eb4", "pod", "exit"] },
    { section: "S5", steps: ["plaza", "jet n2 n1 n3", "roof", "vault", "depot", "exit door"] },
    { section: "SB", steps: ["pedestal", "gate", "pylons from the centre tile", "breakers from the centre tile", "follow the Midget cycle with jet steps"] }
  ];
  function shift(at2, origin) {
    return [at2[0] + origin[0], (at2[1] || 0) + (origin[1] || 0), at2[2] + origin[2]];
  }
  var BUILT2 = makeV2Level({
    id: "L04",
    name: "The Blockchain Void",
    stage: "void",
    tier: 4,
    parTime: 20 * 60,
    jetpack: "pickup",
    useNav: false,
    maxAlive: 12,
    lighting: { sky: "black", aurora: ["green", "purple"], chart: true, fogStart: 220 },
    bounds: { min: [-40, -80, -80], max: [1400, 160, 220] },
    sections: [S13, S23, S33, S43, S53, SB]
  });
  for (const sec of BUILT2.sections) {
    sec.navBounds = null;
    if (!sec.voidRescue) sec.voidRescue = { y: sec.id === "S4" ? -60 : -40, penalty: 0.25 };
    const o = sec.origin;
    if (sec.navLinks) {
      sec.navLinks = sec.navLinks.map((link) => ({
        ...link,
        from: { x: link.from.x + o[0], z: link.from.z + o[2] },
        to: { x: link.to.x + o[0], z: link.to.z + o[2] }
      }));
    }
    if (sec.voids) {
      sec.voids = sec.voids.map((v) => ({
        ...v,
        min: shift(v.min, o),
        max: shift(v.max, o),
        to: v.to ? shift(v.to, o) : v.to
      }));
    }
  }
  BUILT2.estimateSeconds = Math.round(L04_PACING.reduce((sum, row) => sum + row[1], 0) * 10) / 10;
  BUILT2.pacing = L04_PACING;
  BUILT2.botRoute = L04_BOT;
  BUILT2.census = EXPECTED_COUNTS2;
  BUILT2.archetypes = { ...L04_FLYERS, flakPod: FLAK_POD };
  BUILT2.duo = DUO;
  BUILT2.spellNotes = L04_SPELLS;
  BUILT2.drops = "voidSafe";
  BUILT2.difficulty = {
    easy: { voidPenalty: 0.1, flakShells: 3, flakFuel: 10, l1NoBooms: true, l2Whale: false, e5Flock: false, bossDrop: false, midgetStep: 16, ammo: 1.5 },
    heroic: { flakLead: 1, flakRange: 55, eliteRange: 65, e2EliteFlyer: true, l1ExtraFlock: 6, l2Pods: 2, e8Kills: 5, bossBreaker: 3, midgetStep: 9, crateUses: 1 }
  };
  BUILT2.loot = {
    tierOdds: { common: 30, uncommon: 45, rare: 22, epic: 3, legendary: 0 },
    baseTier: "uncommon",
    racks: ["mg-pit", "sn-mines", "bz-duo"],
    elites: ["Head Trader", "Priority Fee", "Whale", "Shooter Bot"],
    chests: ["chest-l1", "chest-l2"],
    boss: ["rare", "rare", "ray|bigbullets"],
    secretCache: "s4.cache"
  };
  var L04 = BUILT2;
  registerLevel(L04);

  // src/data/levels/L05/prim.js
  function P(x, y, n) {
    return [x, y == null ? 0 : y, -n];
  }
  function zone3(x0, x1, n0, n1, y0 = -8, y1 = 30) {
    return {
      min: [Math.min(x0, x1), y0, -Math.max(n0, n1)],
      max: [Math.max(x0, x1), y1, -Math.min(n0, n1)]
    };
  }
  function ammo4(id, x, y, n, ammoType, amount) {
    return { kind: "ammo", id, at: P(x, y, n), ammoType, amount };
  }
  function hook(id, x, y, n, r = 1.8) {
    return { id, at: P(x, y, n), r };
  }
  function door5(id, x, y, n, size, extra = {}) {
    return { kind: "door", id, at: P(x, y, n), size, ...extra };
  }
  function latch(id, doorId, at2) {
    return { kind: "switch", id, at: at2, opens: doorId, needsHold: true, holdTime: 999, latch: true };
  }
  function slab(id, x, y, n, size, mat, extra = {}) {
    return box({ id, at: P(x, y, n), size, mat, ...extra });
  }
  function spans2(a, b, gaps) {
    const cuts = gaps.slice().sort((p, q2) => p[0] - q2[0]);
    const out = [];
    let cursor = a;
    for (const [g0, g1] of cuts) {
      if (g0 - cursor >= 0.5) out.push([cursor, g0]);
      cursor = Math.max(cursor, g1);
    }
    if (b - cursor >= 0.5) out.push([cursor, b]);
    return out;
  }
  function room(id, x0, x1, n0, n1, y, h, doors = [], mat = "concrete") {
    const parts = [];
    const on = { s: [], n: [], w: [], e: [] };
    for (const d of doors) {
      const want = d.h || 2.6;
      const dh = h - want >= 0.5 ? want : h;
      const w = d.w || 2.4;
      const side = d.side;
      on[side].push({ at: d.at, w, dh });
    }
    const wallY = y + h / 2;
    const south = spans2(x0, x1, on.s.map((d) => [d.at - d.w / 2, d.at + d.w / 2]));
    south.forEach((seg, i) => {
      parts.push(slab(`${id}-s${i}`, (seg[0] + seg[1]) / 2, wallY, n0, [seg[1] - seg[0], h, 1], mat));
    });
    const north = spans2(x0, x1, on.n.map((d) => [d.at - d.w / 2, d.at + d.w / 2]));
    north.forEach((seg, i) => {
      parts.push(slab(`${id}-n${i}`, (seg[0] + seg[1]) / 2, wallY, n1, [seg[1] - seg[0], h, 1], mat));
    });
    const west = spans2(n0, n1, on.w.map((d) => [d.at - d.w / 2, d.at + d.w / 2]));
    west.forEach((seg, i) => {
      parts.push(slab(`${id}-w${i}`, x0, wallY, (seg[0] + seg[1]) / 2, [1, h, seg[1] - seg[0]], mat));
    });
    const east = spans2(n0, n1, on.e.map((d) => [d.at - d.w / 2, d.at + d.w / 2]));
    east.forEach((seg, i) => {
      parts.push(slab(`${id}-e${i}`, x1, wallY, (seg[0] + seg[1]) / 2, [1, h, seg[1] - seg[0]], mat));
    });
    for (const d of [...on.s, ...on.n, ...on.w, ...on.e]) {
      if (!(h - d.dh >= 0.5)) continue;
      const lintelY = y + d.dh + (h - d.dh) / 2;
      const horizontal = on.s.includes(d) || on.n.includes(d);
      const n = on.s.includes(d) ? n0 : on.n.includes(d) ? n1 : d.at;
      const x = horizontal ? d.at : on.w.includes(d) ? x0 : x1;
      const size = horizontal ? [d.w, h - d.dh, 1] : [1, h - d.dh, d.w];
      parts.push(slab(`${id}-lintel-${parts.length}`, x, lintelY, n, size, mat));
    }
    parts.push(slab(`${id}-roof`, (x0 + x1) / 2, y + h + 0.25, (n0 + n1) / 2, [x1 - x0, 0.5, n1 - n0], mat));
    return parts;
  }
  function hazard(id, x0, x1, n0, n1, extra = {}) {
    const box3 = zone3(x0, x1, n0, n1, extra.y0 == null ? -2 : extra.y0, extra.y1 == null ? 6 : extra.y1);
    const mech = { kind: "hazardZone", id, min: box3.min, max: box3.max };
    for (const key2 of Object.keys(extra)) {
      if (key2 === "y0" || key2 === "y1") continue;
      mech[key2] = extra[key2];
    }
    return mech;
  }

  // src/data/levels/L05/encounters.js
  var u3 = (type, count, extra = {}) => ({ type, count, ...extra });
  function at(points2) {
    return points2.map((p) => p.length === 2 ? P(p[0], 0, p[1]) : P(p[0], p[1], p[2]));
  }
  function squad5(id, trigger, units2, points2, method = "placed", extra = {}) {
    return { id, trigger, method, at: at(points2), units: units2, ...extra };
  }
  function alarm(id, alarmId, units2, points2, method = "door") {
    return squad5(id, { type: "onAlarm", alarm: alarmId }, units2, points2, method, { optional: true, delay: 6 });
  }
  var E13 = {
    id: "S1-E1",
    name: "The Picket",
    maxAlive: 9,
    objective: { kind: "clearAll", text: "Clear the picket" },
    activate: zone3(90, 200, 60, 220, -4, 12),
    squads: [
      squad5("E1-a", { type: "onEnter" }, [u3("midget", 5)], [[158, 0, 168]], "placed", {
        facing: "away",
        note: "Two face away from the ridge. Fire barrel is heard by the lookout."
      }),
      squad5("E1-b", { type: "onEnter" }, [
        u3("obama", 1, { role: "runner", alarm: "S1-alarm1" }),
        u3("obama", 1)
      ], [[120, 2.5, 186], [122, 2.5, 186]], "placed"),
      squad5("E1-c", { type: "onEnter" }, [
        u3("sewerMidget", 2)
      ], [[150, 0, 165], [172, 0, 166]], "burrow", { delay: 0.6, near: "the campfire, 20 m" }),
      alarm("E1-R", "S1-alarm1", [u3("midget", 4), u3("boomMidget", 2)], [[18, 0, 215]])
    ]
  };
  var E23 = {
    id: "S1-E2",
    name: "Frozen Creek",
    maxAlive: 7,
    objective: { kind: "reach", text: "Reach the north bank" },
    activate: zone3(12, 288, 200, 356, -4, 16),
    zone: zone3(12, 288, 266, 290, -2, 8),
    squads: [
      squad5("E2-a", { type: "onEnter" }, [u3("spotterDrone", 1)], [[80, 8, 256]], "air", {
        patrol: { loop: [[80, 8, 256], [235, 8, 256]], speed: 8, period: 39 }
      }),
      squad5("E2-b", { type: "onEnter" }, [u3("midget", 4)], [[150, 0, 274]], "placed", { asleep: true, hearing: 12 }),
      squad5("E2-c", { type: "onAlert", zBelow: -266 }, [u3("frostHound", 2)], [[205, 0, 285], [205, 0, 285]], "door", { delay: 1.5 }),
      alarm("E2-R", "S1-drone", [u3("midget", 3), u3("robotLaser", 1)], [[150, 0, 275]], "drop")
    ]
  };
  var E33 = {
    id: "S1-E3",
    name: "The Listening Post",
    maxAlive: 5,
    objective: { kind: "clearAll", text: "Clear the listening post" },
    activate: zone3(40, 270, 300, 530, -4, 30),
    squads: [
      squad5("E3-a", { type: "onEnter" }, [u3("auditSniper", 2)], [[150, 14, 442], [70, 6, 420]], "placed", {
        perches: [["P1", "P3", "P1"], ["P2", "P3", "P2"]],
        shotsBeforeMove: 2
      }),
      squad5("E3-b", { type: "onEnter" }, [
        u3("obama", 1, { role: "runner", alarm: "S1-alarm3" })
      ], [[216, 0, 433]], "placed"),
      squad5("E3-c", { type: "onKills", n: 2 }, [
        u3("auditSniper", 1, { elite: true, name: "the Head Auditor" })
      ], [[150, 22, 442]], "hidden", { delay: 2, perches: ["P4", "P1", "P3"] }),
      squad5("E3-d", { type: "onAlert", box: zone3(100, 200, 400, 530, -2, 8) }, [
        u3("miningRig", 1)
      ], [[150, 0, 512]], "placed"),
      alarm("E3-R", "S1-alarm3", [u3("midget", 3), u3("riotMidget", 2)], [[216, 0, 433]])
    ]
  };
  var E43 = {
    id: "S2-E4",
    name: "The Kill Zone",
    maxAlive: 12,
    objective: { kind: "reach", text: "Reach the gate apron" },
    activate: zone3(0, 260, 0, 380, -8, 20),
    zone: zone3(110, 150, 180, 200, -2, 6),
    squads: [
      squad5("E4-a", { type: "onEnter" }, [u3("miningRig", 2)], [[130, 0, 172], [130, 0, 176]], "placed", {
        overheatOffset: 3,
        openFire: 90
      }),
      squad5("E4-b", { type: "onEnter" }, [u3("auditSniper", 2)], [[130, 0, 100], [130, 0, 108]], "placed", {
        perches: [[60, 12, 203], [85, 12, 203], [200, 12, 203], [175, 12, 203]]
      }),
      squad5("E4-c", { type: "onEnter" }, [u3("spotterDrone", 2)], [[100, 9, 110], [150, 9, 70]], "air", {
        patrol: [
          [[100, 9, 110], [160, 9, 110], [160, 9, 160], [100, 9, 160]],
          [[150, 9, 70], [240, 9, 70], [240, 9, 170], [150, 9, 170]]
        ],
        ringsAlarm: "S2-alarm4"
      }),
      squad5("E4-d", { type: "onEnter" }, [u3("midget", 3)], [[130, 0, 196]], "placed", { asleep: true, hearing: 0.01 }),
      squad5("E4-e", { type: "onEnter" }, [u3("obama", 2)], [[130, 0, 148]], "placed", {
        patrol: { loop: [[130, 0, 148], [130, 0, 130], [130, 0, 148]], period: 40 }
      }),
      squad5("E4-f", { type: "onEnter" }, [u3("balloonMidget", 2)], [[200, 4, 95], [225, 5, 135]], "placed", { tethered: true }),
      squad5("E4-g", { type: "onAlert", zBelow: -150 }, [u3("frostHound", 2)], [[130, 0, 160]], "door", { delay: 1 }),
      alarm("E4-R", "S2-alarm4", [u3("midget", 4), u3("obama", 2)], [[130, 0, 160]], "drop")
    ]
  };
  var E53 = {
    id: "S2-E5",
    name: "The two Bunkers",
    maxAlive: 8,
    objective: { kind: "destroy", ids: ["BW-gen-body", "BE-gen-body"], text: "Destroy both generators" },
    activate: zone3(80, 180, 198, 240, -2, 12),
    squads: [
      squad5("E5-a", { type: "onEnter" }, [u3("riotMidget", 3)], [[130, 0, 208]], "placed"),
      squad5("E5-b", { type: "onAlert", box: zone3(86, 114, 214, 236, -2, 8) }, [u3("midget", 2)], [[108, 0, 208]], "door", { delay: 1 }),
      alarm("E5-RW", "S2-alarm5W", [u3("midget", 2), u3("riotMidget", 1)], [[100, 0, 235]]),
      squad5("E5-c", { type: "onAlert", box: zone3(156, 164, 198, 206, -2, 6) }, [
        u3("glowieAgent", 3, { flashbang: 1 })
      ], [[153, 0, 221], [167, 0, 221], [160, 0, 219]], "placed"),
      squad5("E5-d", { type: "onKills", n: 2 }, [
        u3("glowieAgent", 1, { elite: true, name: "the Supervisor" }),
        u3("boomMidget", 2)
      ], [[160, 0, 235], [152, 0, 208]], "door", { also: "generator E at 50%" }),
      alarm("E5-RE", "S2-alarm5E", [u3("glowieAgent", 2)], [[170, 8, 208]], "drop")
    ]
  };
  var E63 = {
    id: "S4-E6",
    name: "Intake",
    maxAlive: 7,
    objective: { kind: "reach", text: "Reach Lift A" },
    activate: zone3(20, 60, 14, 110, -2, 8),
    zone: zone3(32, 48, 56, 68, -2, 8),
    squads: [
      squad5("E6-a", { type: "onAlert", zBelow: -14 }, [u3("riotMidget", 3)], [[40, 0, 52]], "placed"),
      squad5("E6-b", { type: "onAlert", zBelow: -28 }, [u3("midget", 2)], [[40, 0, 26]], "door"),
      squad5("E6-c", { type: "onKills", n: 3 }, [u3("frostHound", 2)], [[40, 0, 48]], "door", { delay: 1 })
    ]
  };
  var E73 = {
    id: "S4-E7",
    name: "Records Library",
    maxAlive: 12,
    objective: { kind: "clearAll", text: "Clear the Records Library" },
    activate: zone3(32, 48, 58, 66, 6, 12),
    lockdown: {
      id: "L2",
      entry: "LIB-in",
      exit: "LIB-out",
      threshold: zone3(36, 44, 48, 52, 6, 14),
      delaySec: 1,
      waveSec: 25,
      stallSec: 12,
      stallN: 2,
      room: zone3(12, 68, 12, 56, 7, 20)
    },
    squads: [
      squad5("W1", { type: "onEnter" }, [u3("midget", 6)], [[40, 7, 46]], "drop"),
      squad5("W1b", { type: "with", after: "W1", delay: 0 }, [u3("glowieAgent", 2)], [[40, 7, 42]], "door"),
      squad5("W2", { type: "onRemain", n: 2 }, [u3("riotMidget", 2)], [[40, 7, 38]], "door"),
      squad5("W2b", { type: "with", after: "W2", delay: 0 }, [u3("auditSniper", 2)], [[40, 7, 28], [40, 7, 24]], "door"),
      squad5("W2c", { type: "with", after: "W2", delay: 0 }, [u3("manaLeech", 1)], [[40, 7, 22]], "door"),
      squad5("W3", { type: "onRemain", n: 2 }, [u3("midget", 4), u3("boomMidget", 2)], [[40, 7, 48]], "drop"),
      squad5("W3b", { type: "with", after: "W3", delay: 0 }, [u3("frostHound", 2)], [[40, 7, 44]], "door"),
      squad5("W4", { type: "onRemain", n: 2 }, [u3("midget", 2)], [[40, 7, 40]], "drop"),
      squad5("W4b", { type: "with", after: "W4", delay: 0 }, [u3("glowieAgent", 1)], [[40, 7, 36]], "door"),
      squad5("W4c", { type: "with", after: "W4", delay: 0 }, [
        u3("robotShooter", 1, { elite: true, name: "the Archivist" })
      ], [[40, 7, 26]], "hidden")
    ]
  };
  var spW = [18, 0, 59];
  var spE = [82, 0, 59];
  var spN = [[35, 5, 92], [65, 5, 92]];
  var spK = [62, 0, 93];
  var F12 = {
    id: "S3-F1",
    name: "The Abominable Auditor",
    maxAlive: 8,
    objective: { kind: "clearAll", text: "Drop the Abominable Auditor" },
    activate: zone3(15, 85, 24, 94, -6, 14),
    arena: { x: 50, z: -59, radius: 35 },
    lockdown: {
      id: "L1",
      entry: "S3-arenaDoor",
      exit: "S3-exitDoor",
      threshold: zone3(42, 58, 28, 32, -2, 8),
      delaySec: 1,
      stallSec: 12,
      room: zone3(15, 85, 24, 94, -6, 12)
    },
    squads: [
      squad5("auditor", { type: "onEnter" }, [
        u3("monster", 1, { name: "The Abominable Auditor" })
      ], [[50, 0.6, 59]], "placed", { frozen: 2 })
    ],
    script: {
      parts: [
        {
          id: "frozen-assets",
          name: "Frozen Assets",
          seconds: 60,
          attacks: ["chase", "volley", "missiles", "chase", "charge", "slam"],
          adds: [
            { t: 20, at: spW, method: "door", spawn: "SP-W", units: [["midget", 4]] },
            { t: 45, at: spE, method: "door", spawn: "SP-E", units: [["midget", 4]] }
          ]
        },
        {
          id: "cold-storage",
          name: "Cold Storage",
          seconds: 40,
          immune: true,
          attacks: ["missiles"],
          targets: [
            { id: "S3-genNW", hp: 500, at: P(42, 0, 55) },
            { id: "S3-genNE", hp: 500, at: P(58, 0, 55) }
          ],
          adds: [
            { t: 0, at: spN[0], method: "drop", spawn: "SP-N", units: [["glowieAgent", 3, { flashbang: 1 }]] },
            { t: 18, at: spW, method: "door", spawn: "SP-W", units: [["midget", 3]] },
            { t: 18, at: spE, method: "door", spawn: "SP-E", units: [["boomMidget", 2]] }
          ]
        },
        {
          id: "final-notice",
          name: "Final Notice",
          seconds: 60,
          attacks: ["chase", "missiles", "volley", "charge", "slam"],
          adds: [
            { onBossHp: 35, at: spW, method: "door", spawn: "SP-W", units: [["midget", 3]] },
            { onBossHp: 35, at: spE, method: "door", spawn: "SP-E", units: [["midget", 2]] },
            { onBossHp: 20, at: spK, method: "door", spawn: "SP-K", units: [["frostHound", 1, { elite: true, name: "Alpha" }], ["frostHound", 2]] }
          ]
        }
      ]
    }
  };
  var F22 = {
    id: "S5-F2",
    name: "Vault hold",
    maxAlive: 12,
    objective: {
      kind: "clearAll",
      also: { kind: "hold", seconds: 90 },
      text: "Hold the drill and clear the vault"
    },
    activate: zone3(18, 62, 40, 84, -2, 14),
    hold: zone3(31, 49, 53, 71, -1, 4),
    lockdown: {
      id: "L3",
      entry: "S5-blastDoor",
      exit: "S5-exitDoor",
      threshold: zone3(34, 46, 44, 48, -2, 8),
      delaySec: 1,
      stallSec: 12,
      room: zone3(18, 62, 40, 84, -2, 13)
    },
    squads: [
      squad5("W1", { type: "onEnter" }, [u3("midget", 6)], [[26, 12, 50]], "drop"),
      squad5("W2", { type: "time", t: 25 }, [
        u3("glowieAgent", 3, { flashbang: 1 })
      ], [[54, 12, 50]], "drop"),
      squad5("W2b", { type: "with", after: "W2", delay: 0 }, [u3("boomMidget", 2)], [[26, 12, 74]], "drop"),
      squad5("W3", { type: "time", t: 50 }, [u3("spotterDrone", 1)], [[40, 12, 62]], "air"),
      squad5("W3b", { type: "with", after: "W3", delay: 0 }, [u3("midget", 4)], [[54, 12, 74]], "drop"),
      squad5("W3c", { type: "with", after: "W3", delay: 0 }, [u3("frostHound", 2)], [[17, 0, 62]], "door"),
      squad5("W4", { type: "time", t: 75 }, [u3("midget", 4)], [[26, 12, 50]], "drop"),
      squad5("W4b", { type: "with", after: "W4", delay: 0 }, [u3("boomMidget", 2)], [[26, 12, 74]], "drop"),
      squad5("W5", { type: "time", t: 100 }, [
        u3("riotMidget", 1, { elite: true, name: "the Vault Warden" })
      ], [[17, 0, 62]], "door")
    ],
    strikes: [8, 22, 36, 50, 64, 78, 92],
    strikeEvery: 14,
    coolant: [30, 60, 90]
  };
  var S5_END = {
    id: "S5-END",
    name: "Extraction",
    objective: { kind: "reach", text: "Step on the pad" },
    activate: zone3(30, 50, 88, 100, -2, 6),
    zone: zone3(35, 45, 91, 101, -1, 4),
    squads: []
  };
  function addUnits(counts, units2, key2) {
    for (const unit of units2) {
      const bucket2 = counts[key2];
      bucket2[unit.type] = (bucket2[unit.type] || 0) + unit.count;
      bucket2._n += unit.count;
    }
  }
  function census(list) {
    const counts = { always: { _n: 0 }, alarm: { _n: 0 }, script: { _n: 0 } };
    for (const enc of list) {
      for (const sq of enc.squads || []) {
        if (sq.units.some((unit) => unit.type === "monster")) continue;
        addUnits(counts, sq.units, sq.optional ? "alarm" : "always");
      }
      for (const part of enc.script && enc.script.parts || []) {
        for (const add3 of part.adds || []) {
          for (const unit of add3.units || []) {
            const type = unit[0];
            const n = unit[1] || 1;
            counts.script[type] = (counts.script[type] || 0) + n;
            counts.script._n += n;
          }
        }
      }
    }
    return counts;
  }

  // src/data/levels/L05/enemies.js
  var SPOTTER_DRONE = {
    id: "spotterDrone",
    name: "Spotter Drone",
    archetype: "detection",
    hp: 45,
    hpTier: 79,
    lamp: { hp: 20, hpTier: 35, weak: true },
    speed: 8,
    turn: 90,
    fly: { min: 8, max: 9, indoor: 4 },
    sense: { length: 35, halfAngle: 20, spotRadius: 5, spotAhead: 14 },
    hold: 1.5,
    holdWindow: 3,
    recall: 10,
    mortar: { count: 3, gap: 0.5, telegraph: 1.4, radius: 3.5, damage: 22, damageTier: 38 },
    wake: 60,
    poise: 20,
    affinity: { weak: "shock" },
    drops: { ammo: 0.5, tickets: 2, gun: 0.04 },
    seconds: 8,
    look: [
      { kind: "box", at: [0, 0, 0], size: [1, 0.4, 1], mat: "metal" },
      { kind: "cone", at: [0, -0.5, 0], r: 0.3, h: 0.5, mat: "neon" },
      { kind: "disc", at: [0.45, 0.1, 0.45], r: 0.35, mat: "metal" },
      { kind: "disc", at: [-0.45, 0.1, 0.45], r: 0.35, mat: "metal" },
      { kind: "disc", at: [0.45, 0.1, -0.45], r: 0.35, mat: "metal" },
      { kind: "disc", at: [-0.45, 0.1, -0.45], r: 0.35, mat: "metal" }
    ],
    hitboxes: [
      { zone: "body", shape: "sphere", r: 0.6 },
      { zone: "weak", shape: "sphere", r: 0.25, part: "lamp" }
    ]
  };
  var FROST_HOUND = {
    id: "frostHound",
    name: "Frost Hound",
    archetype: "tracker",
    hp: 55,
    hpTier: 96,
    trot: 5,
    run: 9.5,
    scent: 45,
    trail: { every: 2, length: 60 },
    bark: 12,
    lunge: { range: 9, crouch: 0.5, speed: 20, damage: 16, damageTier: 28, knockback: 6, recover: 0.9 },
    patch: { radius: 2.5, seconds: 6 },
    poise: 30,
    affinity: { weak: "fire" },
    drops: { ammo: 0.4, health: 0.08, tickets: 2, gun: 0.03 },
    seconds: 5,
    ignores: ["decoy", "weather", "slick"],
    elite: { name: "Alpha", hpMult: 2.5, lunges: 2, patch: 3.5 },
    look: [
      { kind: "box", at: [0, 0.55, 0], size: [1.2, 0.5, 0.6], mat: "ice" },
      { kind: "box", at: [0, 0.7, 0.55], size: [0.45, 0.45, 0.45], mat: "ice" },
      { kind: "cylinder", at: [-0.35, 0, 0.3], r: 0.1, h: 0.5, mat: "ice" },
      { kind: "cylinder", at: [0.35, 0, 0.3], r: 0.1, h: 0.5, mat: "ice" },
      { kind: "cylinder", at: [-0.35, 0, -0.3], r: 0.1, h: 0.5, mat: "ice" },
      { kind: "cylinder", at: [0.35, 0, -0.3], r: 0.1, h: 0.5, mat: "ice" },
      { kind: "cone", at: [0, 0.55, -0.5], r: 0.15, h: 0.5, mat: "ice" },
      { kind: "sphere", at: [0.12, 0.85, 0.7], r: 0.08, mat: "neon" },
      { kind: "sphere", at: [-0.12, 0.85, 0.7], r: 0.08, mat: "neon" }
    ],
    hitboxes: [
      { zone: "body", shape: "capsule", r: 0.5, length: 1.2, y0: 0.3, y1: 0.9 },
      { zone: "weak", shape: "sphere", r: 0.28, part: "head" }
    ]
  };
  var DECOY = {
    id: "decoy",
    name: "Cardboard Sproto",
    mana: 30,
    cooldown: 12,
    life: 6,
    castRange: 20,
    pop: { damage: 20, radius: 3 },
    locks: ["auditSniper", "spotterDrone", "searchlight", "miningRig", "droneStrike"],
    ignoredBy: ["frostHound"]
  };
  var AUDITOR = {
    id: "monster",
    name: "The Abominable Auditor",
    model: "monster",
    hp: 3800,
    hpTier: 6646,
    radius: 2.4,
    height: 7,
    plates: [
      { id: "brow", covers: "head", hp: 250, hpTier: 437, shape: { kind: "sphere", r: 1, y: 6.5 } },
      { id: "chest", covers: "front", hp: 400, hpTier: 700, arc: 180, bodyMul: 0.1 },
      { id: "back", covers: "rear", hp: 400, hpTier: 700, arc: 180, bodyMul: 0.1 }
    ]
  };
  var DRONE_STRIKE = {
    radius: 2.6,
    track: 1.8,
    lock: 0.75,
    every: 14,
    damagePlayer: 30,
    damageEnemy: 120,
    followsDecoy: true
  };

  // src/data/levels/L05/prefabs.js
  function pine(id, x, n) {
    return [
      cylinder({ id: `${id}-trunk`, at: P(x, 0, n), r: 0.3, h: 2.5, mat: "wood" }),
      cone({ id: `${id}-bough1`, at: P(x, 2, n), r: 1.6, h: 3, mat: "hedge" }),
      cone({ id: `${id}-bough2`, at: P(x, 4, n), r: 1.1, h: 2.4, mat: "hedge" })
    ];
  }
  function boulderS(id, x, n) {
    return [sphere({ id, at: P(x, 0.4, n), r: 1, mat: "ice" })];
  }
  function boulderM(id, x, n) {
    return [sphere({ id, at: P(x, 0.8, n), r: 1.6, mat: "ice" })];
  }
  function boulderL(id, x, n) {
    return [
      sphere({ id: `${id}-a`, at: P(x, 1.2, n), r: 2.6, mat: "ice" }),
      sphere({ id: `${id}-b`, at: P(x + 2.4, 0.6, n - 0.8), r: 1.6, mat: "ice" })
    ];
  }
  function rockSlab(id, x, n) {
    return [slab(id, x, 1.1, n, [4, 2.2, 1.2], "rock")];
  }
  function snowBerm(id, x, n) {
    return [slab(id, x, 0.6, n, [6, 1.2, 1.5], "snow")];
  }
  function crateStack(id, x, n) {
    return [
      box({ id: `${id}-a`, at: P(x - 0.6, 0.6, n), size: [1.2, 1.2, 1.2], mat: "crate" }),
      box({ id: `${id}-b`, at: P(x + 0.6, 0.6, n), size: [1.2, 1.2, 1.2], mat: "crate" }),
      box({ id: `${id}-c`, at: P(x, 1.8, n), size: [1.2, 1.2, 1.2], mat: "crate" })
    ];
  }
  function snowcat(id, x, n, yaw = 0) {
    const body = box({ id: `${id}-body`, at: P(x, 1.2, n), size: [5, 1.6, 2.4], yaw, mat: "metal" });
    const cabin = box({ id: `${id}-cabin`, at: P(x + 1.2, 2.7, n), size: [2.2, 1.4, 2.2], yaw, mat: "metal" });
    const west = box({ id: `${id}-trackW`, at: P(x, 0.4, n - 1.3), size: [5.4, 0.8, 0.6], yaw, mat: "metal" });
    const east = box({ id: `${id}-trackE`, at: P(x, 0.4, n + 1.3), size: [5.4, 0.8, 0.6], yaw, mat: "metal" });
    return [body, cabin, west, east];
  }
  function fishHut(id, x, n) {
    const parts = [];
    const segs = spansSafe(x - 1.5, x + 1.5, [[x - 0.6, x + 0.6]]);
    segs.forEach((seg, i) => {
      parts.push(slab(`${id}-s${i}`, (seg[0] + seg[1]) / 2, 1.2, n - 1.5, [seg[1] - seg[0], 2.4, 0.5], "wood"));
    });
    parts.push(slab(`${id}-n`, x, 1.2, n + 1.5, [3, 2.4, 0.5], "wood"));
    parts.push(slab(`${id}-w`, x - 1.5, 1.2, n, [0.5, 2.4, 3], "wood"));
    parts.push(slab(`${id}-e`, x + 1.5, 1.2, n, [0.5, 2.4, 3], "wood"));
    parts.push(slab(`${id}-roof`, x, 2.65, n, [3.4, 0.5, 3.4], "wood"));
    return parts;
  }
  function spansSafe(a, b, gaps) {
    const out = [];
    let cursor = a;
    for (const [g0, g1] of gaps) {
      if (g0 - cursor >= 0.5) out.push([cursor, g0]);
      cursor = Math.max(cursor, g1);
    }
    if (b - cursor >= 0.5) out.push([cursor, b]);
    return out;
  }
  function watchtower(id, x, y, n, legH = 8) {
    const half = 1.7;
    const corners = [[-half, -half], [half, -half], [-half, half], [half, half]];
    const parts = corners.map((c, i) => cylinder({
      id: `${id}-leg${i}`,
      at: P(x + c[0], y, n + c[1]),
      r: 0.3,
      h: legH,
      mat: "metal"
    }));
    const floor3 = y + legH;
    parts.push(slab(`${id}-deck`, x, floor3 - 0.25, n, [4.4, 0.5, 4.4], "metal"));
    const rails3 = [
      [0, 2.2, [4.4, 1.2, 0.5]],
      [0, -2.2, [4.4, 1.2, 0.5]],
      [2.2, 0, [0.5, 1.2, 4.4]],
      [-2.2, 0, [0.5, 1.2, 4.4]]
    ];
    rails3.forEach((r, i) => {
      parts.push(slab(`${id}-rail${i}`, x + r[0], floor3 + 0.6, n + r[1], r[2], "metal"));
    });
    corners.forEach((c, i) => {
      parts.push(cylinder({
        id: `${id}-post${i}`,
        at: P(x + c[0], floor3, n + c[1]),
        r: 0.25,
        h: 2.3,
        mat: "metal"
      }));
    });
    parts.push(slab(`${id}-roof`, x, floor3 + 2.55, n, [4.8, 0.5, 4.8], "metal"));
    parts.push({
      kind: "ramp",
      id: `${id}-stairs`,
      visual: "stairs",
      steps: 8,
      at: P(x, y + legH / 2, n + 2.2 + 2.5),
      size: [1, legH, 5],
      yaw: 0,
      mat: "metal"
    });
    return parts;
  }
  function searchlight(id, x, y, n) {
    return [
      cylinder({ id: `${id}-post`, at: P(x, y, n), r: 0.3, h: 2, mat: "metal" }),
      box({ id: `${id}-lamp`, at: P(x, y + 2.4, n), size: [0.8, 0.8, 0.8], mat: "metal" }),
      cone({ id: `${id}-beam`, at: P(x, y + 2.8, n), r: 0.6, h: 4, mat: "neon" })
    ];
  }
  function alarmPole(id, x, y, n) {
    return [
      cylinder({ id: `${id}-pole`, at: P(x, y, n), r: 0.25, h: 4, mat: "metal" }),
      box({ id: `${id}-siren`, at: P(x, y + 4, n), size: [0.6, 0.6, 0.6], mat: "neon" })
    ];
  }
  function generator(id, x, y, n) {
    return [
      cylinder({ id: `${id}-body`, at: P(x, y, n), r: 1.2, h: 2.4, mat: "metal" }),
      box({ id: `${id}-coilW`, at: P(x - 1.5, y + 1, n), size: [0.6, 2, 0.6], mat: "metal" }),
      box({ id: `${id}-coilE`, at: P(x + 1.5, y + 1, n), size: [0.6, 2, 0.6], mat: "metal" }),
      sphere({ id: `${id}-core`, at: P(x, y + 1.6, n), r: 0.5, mat: "neon" })
    ];
  }

  // src/data/levels/L05/S1.js
  var lips = [118, 134, 150, 166, 182].map((x, i) => slab(`S1-ridgeLip${i + 1}`, x, 3.6, 77.5, [6, 1.2, 1], "snow"));
  var pines = [[60, 100], [72, 118], [55, 135], [80, 140], [66, 160], [90, 170], [58, 185], [84, 198], [70, 215], [95, 225]].flatMap(([x, n], i) => pine(`S1-pine${i + 1}`, x, n));
  var flank = [[50, 330], [58, 350], [46, 368], [60, 385], [52, 400], [66, 410]].flatMap(([x, n], i) => pine(`S1-flank${i + 1}`, x, n));
  var field = [[140, 100], [170, 112], [128, 122], [152, 136], [186, 144], [122, 150]].flatMap(([x, n], i) => boulderM(`S1-fieldRock${i + 1}`, x, n));
  var bermX = [44.5, 114.5, 193, 263];
  var bermL = [65, 63, 78, 50];
  var berms = [];
  bermX.forEach((x, i) => {
    berms.push(slab(`S1-bermS${i + 1}`, x, 0.6, 249.25, [bermL[i], 1.2, 1.5], "snow"));
    berms.push(slab(`S1-bermN${i + 1}`, x, 0.6, 262.75, [bermL[i], 1.2, 1.5], "snow"));
  });
  var rowA = [[110, 320], [150, 320], [190, 320]].flatMap(([x, n], i) => boulderL(`S1-rowA${i + 1}`, x, n));
  var rowB = [[90, 340], [130, 340], [170, 340], [210, 340]].flatMap(([x, n], i) => boulderM(`S1-rowB${i + 1}`, x, n));
  var rowC = [[110, 360], [150, 360], [190, 360]].flatMap(([x, n], i) => rockSlab(`S1-rowC${i + 1}`, x, n));
  var rowD = [[95, 378], [135, 378], [165, 378], [205, 378]].flatMap(([x, n], i) => boulderM(`S1-rowD${i + 1}`, x, n));
  var rowE = [[120, 395], [150, 395], [180, 395]].flatMap(([x, n], i) => snowBerm(`S1-rowE${i + 1}`, x, n));
  var pass = [[146, 470], [154, 482], [146, 494]].flatMap(([x, n], i) => rockSlab(`S1-passSlab${i + 1}`, x, n));
  var mastRails = [
    [0, 2.5, [5, 1.2, 0.5]],
    [0, -2.5, [5, 1.2, 0.5]],
    [2.5, 0, [0.5, 1.2, 5]],
    [-2.5, 0, [0.5, 1.2, 5]]
  ].map((r, i) => slab(`S1-mastRail${i}`, 150 + r[0], 14.6, 445 + r[1], r[2], "metal"));
  var nestRails = [
    [0, 1.5, [3, 1.2, 0.5]],
    [0, -1.5, [3, 1.2, 0.5]],
    [1.5, 0, [0.5, 1.2, 3]],
    [-1.5, 0, [0.5, 1.2, 3]]
  ].map((r, i) => slab(`S1-nestRail${i}`, 150 + r[0], 22.6, 445 + r[1], r[2], "metal"));
  var S14 = {
    id: "S1",
    name: "Crash Site and Outer Snowfield",
    origin: [0, 0, 0],
    start: P(150, 0, 19),
    yaw: 0,
    footprint: [300, 520],
    routeM: 516,
    flyerVolume: { min: [0, 0, -520], max: [300, 40, 0] },
    exit: zone3(143, 157, 519, 524, -2, 8),
    intro: {
      title: "FROSTSPIRE BLACK SITE",
      lines: [
        "The ledgers are in a vault at the top of the spire.",
        "Glowie is watching from a drone. Be far away. Be boring."
      ]
    },
    grappleAnchors: [
      hook("S1-hook-ridge", 150, 3.6, 75, 2.2),
      hook("S1-hook-look", 120, 3.2, 186),
      hook("S1-hook-mast", 150, 14.4, 445),
      hook("S1-hook-nest", 150, 22.2, 445),
      hook("S1-hook-spire", 70, 6.4, 420),
      hook("S1-hook-hut", 225, 4.4, 432)
    ],
    terrain: terrain({
      id: "S1-ground",
      origin: [0, 0, -520],
      size: [300, 520],
      cell: 4,
      seed: 501,
      mat: "snow",
      noise: { amp: 1.2, freq: 0.012, octaves: 2 },
      flat: [{ n0: 244, n1: 268 }, { x0: 143, x1: 157, n0: 460, n1: 520 }]
    }),
    geometry: [
      slab("S1-floor", 150, -0.25, 260, [300, 0.5, 520], "snow", { tag: "terrainStandIn" }),
      slab("S1-cliffW", 6, 7, 260, [12, 14, 520], "rock"),
      slab("S1-cliffE", 294, 7, 260, [12, 14, 520], "rock"),
      slab("S1-cliffS", 150, 7, 4, [276, 14, 8], "rock"),
      slab("S1-cliffNW", 77.5, 7, 490, [131, 14, 60], "rock"),
      slab("S1-cliffNE", 222.5, 7, 490, [131, 14, 60], "rock"),
      { kind: "cylinder", id: "S1-pod", at: P(150, 0, 15), r: 1.6, h: 3.2, mat: "metal" },
      slab("S1-podFin1", 147.8, 1, 14, [0.5, 2, 2.4], "metal"),
      slab("S1-podFin2", 152.2, 1, 14, [0.5, 2, 2.4], "metal"),
      slab("S1-podFin3", 150, 1, 12.6, [0.5, 2, 2.4], "metal"),
      slab("S1-debris1", 143, 0.6, 26, [3, 1.2, 0.8], "metal"),
      slab("S1-debris2", 158, 0.6, 32, [3, 1.2, 0.8], "metal"),
      slab("S1-debris3", 149, 0.6, 40, [3, 1.2, 0.8], "metal"),
      slab("S1-debris4", 144, 0.6, 50, [3, 1.2, 0.8], "metal"),
      slab("S1-cacheC1", 156, 0.6, 54, [2.4, 1.2, 1.4], "crate"),
      { kind: "ramp", id: "S1-ridgeS", at: P(150, 1.5, 66), size: [80, 3, 12], yaw: 180, mat: "snow" },
      slab("S1-ridgeTop", 150, 1.5, 75, [80, 3, 6], "snow"),
      ...lips,
      { kind: "ramp", id: "S1-ridgeN", at: P(150, 1.5, 83), size: [80, 3, 10], yaw: 0, mat: "snow", tag: "slide" },
      ...field,
      ...pines,
      ...snowcat("S1-snowcat", 165, 172, 30),
      { kind: "cone", id: "S1-tent1", at: P(171, 0, 181), r: 2.2, h: 2.6, mat: "wood" },
      { kind: "cylinder", id: "S1-tent1-col", at: P(171, 0, 181), r: 1.8, h: 2, mat: "wood" },
      { kind: "cone", id: "S1-tent2", at: P(149, 0, 183), r: 2.2, h: 2.6, mat: "wood" },
      { kind: "cylinder", id: "S1-tent2-col", at: P(149, 0, 183), r: 1.8, h: 2, mat: "wood" },
      ...crateStack("S1-campCrate1", 152, 176),
      ...crateStack("S1-campCrate2", 164, 162),
      { kind: "sphere", id: "S1-mound1", at: P(150, -0.4, 165), r: 1.2, mat: "snow" },
      { kind: "sphere", id: "S1-mound2", at: P(172, -0.4, 166), r: 1.2, mat: "snow" },
      slab("S1-lookDeck", 120, 2.25, 186, [5, 0.5, 5], "wood"),
      { kind: "cylinder", id: "S1-lookLeg1", at: P(117.8, 0, 183.8), r: 0.3, h: 2, mat: "wood" },
      { kind: "cylinder", id: "S1-lookLeg2", at: P(122.2, 0, 183.8), r: 0.3, h: 2, mat: "wood" },
      { kind: "cylinder", id: "S1-lookLeg3", at: P(117.8, 0, 188.2), r: 0.3, h: 2, mat: "wood" },
      { kind: "cylinder", id: "S1-lookLeg4", at: P(122.2, 0, 188.2), r: 0.3, h: 2, mat: "wood" },
      stairs({ id: "S1-lookStairs", at: P(120, 1.25, 190.5), size: [1.5, 2.5, 4], yaw: 0, mat: "wood" }),
      slab("S1-lookRail", 120, 3.1, 183.75, [5, 1.2, 0.5], "wood"),
      ...alarmPole("S1-alarm1", 122, 2.5, 187.5),
      slab("S1-relay1", 120, 0.75, 205, [1, 1.5, 1], "metal"),
      slab("S1-tunnelJambW", 9.5, 2, 215, [1, 4, 1], "metal"),
      slab("S1-tunnelJambE", 15.5, 2, 215, [1, 4, 1], "metal"),
      slab("S1-tunnelLintel", 12.5, 4.5, 215, [6, 1, 1], "metal"),
      slab("S1-creekIce", 150, -0.2, 256, [276, 0.5, 12], "ice"),
      ...berms,
      slab("S1-bridge", 150, 1.5, 256, [3, 0.6, 18], "wood"),
      { kind: "ramp", id: "S1-bridgeRampS", at: P(150, 0.9, 244.5), size: [3, 1.8, 5], yaw: 180, mat: "wood" },
      { kind: "ramp", id: "S1-bridgeRampN", at: P(150, 0.9, 267.5), size: [3, 1.8, 5], yaw: 0, mat: "wood" },
      slab("S1-bridgeRailW", 148.25, 2.4, 256, [0.5, 1.2, 18], "wood"),
      slab("S1-bridgeRailE", 151.75, 2.4, 256, [0.5, 1.2, 18], "wood"),
      slab("S1-leanRoof", 165, 1.85, 265.5, [6, 0.5, 3], "wood"),
      slab("S1-leanWall", 165, 0.8, 267.25, [6, 1.6, 0.5], "wood"),
      ...room("S1-kennel", 203, 207, 284, 286, 0, 1.6, [{ side: "s", at: 205, w: 1.2, h: 1.6 }], "wood"),
      { kind: "disc", id: "S1-shrineDais", at: P(150, 0.02, 300), r: 3, mat: "stone" },
      { kind: "cylinder", id: "S1-shrineObelisk", at: P(150, 0.5, 300), r: 0.5, h: 3, mat: "gold" },
      { kind: "disc", id: "S1-shrineDisc", at: P(150, 0.05, 300), r: 5, mat: "neon" },
      { kind: "cylinder", id: "S1-shrineStone1", at: P(146, 0, 296), r: 0.6, h: 2.5, mat: "ice" },
      { kind: "cylinder", id: "S1-shrineStone2", at: P(154, 0, 296), r: 0.6, h: 2.5, mat: "ice" },
      { kind: "cylinder", id: "S1-shrineStone3", at: P(146, 0, 304), r: 0.6, h: 2.5, mat: "ice" },
      { kind: "cylinder", id: "S1-shrineStone4", at: P(154, 0, 304), r: 0.6, h: 2.5, mat: "ice" },
      ...searchlight("S1-practiceLight", 150, 0, 312),
      ...rowA,
      ...rowB,
      ...rowC,
      ...rowD,
      ...rowE,
      ...flank,
      slab("S1-flankWall", 250, 1.1, 360, [1.5, 2.2, 60], "snow"),
      slab("S1-fenceW", 122, 1.2, 410, [44, 2.4, 0.5], "metal"),
      slab("S1-fenceE", 178, 1.2, 410, [44, 2.4, 0.5], "metal"),
      { kind: "cylinder", id: "S1-mast", at: P(150, 0, 445), r: 0.6, h: 24, mat: "metal" },
      slab("S1-mastDeck", 150, 13.75, 445, [5, 0.5, 5], "metal"),
      ...mastRails,
      slab("S1-crowsNest", 150, 21.75, 445, [3, 0.5, 3], "metal"),
      ...nestRails,
      slab("S1-mastLift", 157, 0.25, 448, [1.5, 0.5, 1.5], "metal"),
      { kind: "cylinder", id: "S1-spire", at: P(70, 0, 425), r: 4, h: 9, mat: "ice" },
      { kind: "cone", id: "S1-spireCap", at: P(70, 9, 425), r: 4, h: 6, mat: "ice" },
      slab("S1-spireLedge", 70, 5.75, 420, [4, 0.5, 3], "ice"),
      { kind: "ramp", id: "S1-spireRamp", at: P(76, 3, 430), size: [2, 6, 12], yaw: 0, mat: "ice" },
      slab("S1-hut", 225, 2, 432, [10, 4, 8], "concrete"),
      stairs({ id: "S1-hutStairs", at: P(231.75, 2, 425), size: [1.5, 4, 6], yaw: 180, mat: "concrete" }),
      slab("S1-hutRail", 225, 4.6, 428.25, [10, 1.2, 0.5], "concrete"),
      ...pass,
      { kind: "disc", id: "S1-rigPad", at: P(150, 0.02, 512), r: 2.2, mat: "concrete" },
      slab("S1-rigBagW", 146.5, 0.6, 508, [3, 1.2, 0.8], "concrete"),
      slab("S1-rigBagE", 153.5, 0.6, 508, [3, 1.2, 0.8], "concrete")
    ],
    weapons: [
      { id: "C1", at: P(156, 0.6, 54), gun: "sniper", why: "E1, E3, E4: every long shot in the quiet half", quality: "uncommon", manufacturer: "reliable", element: "none", level: 5 },
      { id: "R1", at: P(146, 0, 462), gun: "bazooka", why: "The rig in the pass and the two wall rigs", quality: "uncommon", manufacturer: "reliable", element: "none", level: 5 }
    ],
    checkpoints: [
      { id: "CP1", at: P(163, 0, 174), when: "S1-E1.cleared" },
      { id: "CP2", at: P(150, 0, 300), when: "S1-shrine" },
      { id: "CP3", at: P(150, 0, 516), when: "S1-E3.cleared" }
    ],
    mechanisms: [
      { kind: "barrel", id: "S1-fire", at: P(158, 0.55, 168), element: "fire" },
      { kind: "shrine", id: "S1-shrine", at: P(150, 0.5, 300), spell: "decoy", name: "Cardboard Sproto" },
      { kind: "searchlight", id: "S1-practice", at: P(150, 0, 312), harmless: true, beam: 120, spot: 6, sweep: 8 },
      hazard("S1-slickW", 12, 146, 250, 262, { slow: 0.15, tag: "slick", y0: -1, y1: 1.2 }),
      hazard("S1-slickE", 154, 288, 250, 262, { slow: 0.15, tag: "slick", y0: -1, y1: 1.2 }),
      door5("S1-tunnel", 12.5, 1.5, 215, [4, 3, 1]),
      door5("S1-hutDoor", 220, 1.3, 433, [1, 2.6, 2.4]),
      door5("S1-passGate", 150, 2.5, 518.5, [14, 5, 1], { opens: "S1-E3.cleared" }),
      latch("S1-passLatch", "S1-passGate", P(6, 3, 500)),
      { kind: "mover", id: "S1-lift", carry: true, from: P(157, 0, 448), to: P(157, 22, 448), speed: 2, stops: [0, 14, 22] },
      { kind: "alarm", id: "S1-alarm1", at: P(122, 6.5, 187.5), hp: 40, cableHp: 20, cableTo: P(120, 0.75, 205), runner: 1.5, arrive: 6 },
      { kind: "alarm", id: "S1-alarm3", at: P(219.7, 2, 430), hp: 40, cableHp: 20, cableTo: P(219.7, 4, 436) },
      { kind: "cache", id: "S1-secretCache", at: P(70, 6, 424), gun: "sniper", quality: "legendary" },
      { kind: "secret", id: "S1-file1", at: P(150, 22, 445), tickets: 5, file: 1, name: "Audit File 1" },
      ammo4("AB1", 154, 0, 56, "sniper", 8),
      ammo4("AB2", 163, 0, 174, "bullets", 60),
      ammo4("AB3", 120, 2.5, 186, "sniper", 8),
      ammo4("AB4", 153, 0, 300, "sniper", 8),
      ammo4("AB5", 150, 14, 445, "sniper", 8),
      ammo4("AB6", 225, 4, 432, "sniper", 8),
      ammo4("AB7", 154, 0, 463, "rockets", 3),
      ammo4("AB8", 150, 0, 516, "sniper", 8)
    ],
    encounters: [E13, E23, E33]
  };

  // src/data/levels/L05/S2.js
  function mirror(parts) {
    return parts.map((p) => {
      const q2 = { ...p, id: p.id.replaceAll("BW-", "BE-") };
      if (p.at) q2.at = [260 - p.at[0], p.at[1], p.at[2]];
      if (p.size) q2.size = p.size.slice();
      return q2;
    });
  }
  var parapet = [];
  for (let i = 0; i < 20; i++) parapet.push(slab(`S2-parapet${i + 1}`, 16 + i * 12, 8.6, 200.25, [10, 1.2, 0.5], "concrete"));
  var bw = [
    ...room("BW-shell", 85, 115, 200, 236, 0, 8, [
      { side: "s", at: 100, w: 4 },
      { side: "n", at: 100, w: 2.4 }
    ], "concrete"),
    slab("BW-corrL", 97.5, 3.75, 207.5, [1, 7.5, 13], "concrete"),
    slab("BW-corrR", 102.5, 3.75, 207.5, [1, 7.5, 13], "concrete"),
    slab("BW-part1", 86.4, 3.75, 214.5, [0.8, 7.5, 1], "concrete"),
    slab("BW-part2", 94, 3.75, 214.5, [9.6, 7.5, 1], "concrete"),
    slab("BW-part3", 104, 3.75, 214.5, [5.6, 7.5, 1], "concrete"),
    slab("BW-part4", 111.6, 3.75, 214.5, [4.8, 7.5, 1], "concrete"),
    slab("BW-partLintel1", 88, 5.05, 214.5, [2.4, 4.9, 1], "concrete"),
    slab("BW-partLintel2", 100, 5.05, 214.5, [2.4, 4.9, 1], "concrete"),
    slab("BW-partLintel3", 108, 5.05, 214.5, [2.4, 4.9, 1], "concrete"),
    { kind: "ramp", id: "BW-stairs", visual: "stairs", steps: 16, at: P(88, 3.75, 207), size: [3, 7.5, 12], yaw: 0, mat: "concrete" },
    slab("BW-bunk1", 110, 0.6, 204, [2, 1.2, 1], "wood"),
    slab("BW-bunk2", 110, 0.6, 210, [2, 1.2, 1], "wood"),
    ...crateStack("BW-crate1", 93, 221),
    ...crateStack("BW-crate2", 107, 221),
    slab("BW-crate3", 100, 0.6, 219, [4, 1.2, 1], "crate"),
    { kind: "cylinder", id: "BW-rigPad", at: P(100, 8, 203), r: 2, h: 0.5, mat: "concrete" }
  ];
  var approach = [[125, 30], [137, 50], [121, 70]].flatMap(([x, n], i) => boulderM(`S2-approach${i + 1}`, x, n));
  var centre = [
    ...boulderM("S2-centre1", 116, 110),
    ...boulderM("S2-centre2", 146, 112),
    ...boulderM("S2-centre3", 112, 145),
    ...boulderM("S2-centre4", 141, 147),
    ...rockSlab("S2-centreSlab", 120, 128),
    ...boulderS("S2-centreS", 150, 126)
  ];
  var S24 = {
    id: "S2",
    name: "Kill Zone, Wall and two Bunkers",
    origin: [20, 0, -520],
    start: P(130, 0, 8),
    yaw: 0,
    footprint: [260, 250],
    routeM: 438,
    flyerVolume: { min: [0, -8, -250], max: [260, 24, 0] },
    exit: zone3(126, 134, 206, 214, -2, 8),
    grappleAnchors: [
      hook("S2-hook-towerW", 60, 12.6, 203),
      hook("S2-hook-towerE", 200, 12.6, 203),
      hook("S2-hook-walkW", 85, 8.6, 203),
      hook("S2-hook-walkE", 175, 8.6, 203),
      hook("S2-hook-hatchW", 88, 8.6, 202),
      hook("S2-hook-hatchE", 172, 8.6, 202)
    ],
    terrain: terrain({
      id: "S2-ground",
      origin: [0, 0, -200],
      size: [170, 200],
      cell: 4,
      seed: 502,
      mat: "snow",
      noise: { amp: 0.8, freq: 0.015, octaves: 1 }
    }),
    geometry: [
      slab("S2-floor", 85, -0.25, 100, [170, 0.5, 200], "snow", { tag: "terrainStandIn" }),
      slab("S2-yard", 130, -0.25, 219, [240, 0.5, 42], "concrete"),
      slab("S2-cliffW", 5, 7, 125, [10, 14, 250], "rock"),
      slab("S2-cliffE", 255, 7, 125, [10, 14, 250], "rock"),
      slab("S2-cliffS1", 66.5, 7, 4, [113, 14, 8], "rock"),
      slab("S2-cliffS2", 193.5, 7, 4, [113, 14, 8], "rock"),
      slab("S2-eastSnowS", 210, -3, 25, [80, 6, 50], "snow"),
      slab("S2-eastSnowN", 210, -3, 192.5, [80, 6, 15], "snow"),
      slab("S2-lakeBed", 210, -5.5, 117.5, [80, 1, 135], "rock"),
      slab("S2-ice1", 210, -0.25, 65, [80, 0.5, 30], "ice"),
      slab("S2-ice2", 210, -0.25, 106, [80, 0.5, 28], "ice"),
      slab("S2-ice3", 210, -0.25, 146, [80, 0.5, 28], "ice"),
      slab("S2-ice4", 210, -0.25, 178.5, [80, 0.5, 13], "ice"),
      slab("S2-band1", 210, -0.25, 86, [80, 0.5, 12], "ice", { tag: "crackTiles" }),
      slab("S2-band2", 210, -0.25, 126, [80, 0.5, 12], "ice", { tag: "crackTiles" }),
      slab("S2-band3", 210, -0.25, 166, [80, 0.5, 12], "ice", { tag: "crackTiles" }),
      slab("S2-log1", 190, 0.3, 86, [3, 0.6, 12], "wood"),
      slab("S2-log2", 240, 0.3, 86, [3, 0.6, 12], "wood"),
      slab("S2-log3", 180, 0.3, 126, [3, 0.6, 12], "wood"),
      slab("S2-log4", 225, 0.3, 126, [3, 0.6, 12], "wood"),
      slab("S2-log5", 200, 0.3, 166, [3, 0.6, 12], "wood"),
      slab("S2-log6", 245, 0.3, 166, [3, 0.6, 12], "wood"),
      ...fishHut("S2-hut1", 190, 70),
      ...fishHut("S2-hut2", 232, 100),
      ...fishHut("S2-hut3", 212, 143),
      ...fishHut("S2-hut4", 238, 150),
      slab("S2-caveFloor", 212, -4.25, 126, [10, 0.5, 10], "ice"),
      slab("S2-caveS", 212, -2.5, 121, [10, 4, 1], "ice"),
      slab("S2-caveN", 212, -2.5, 131, [10, 4, 1], "ice"),
      slab("S2-caveW", 207, -2.5, 126, [1, 4, 10], "ice"),
      slab("S2-caveE", 217, -2.5, 126, [1, 4, 10], "ice"),
      { kind: "ramp", id: "S2-caveRamp", at: P(212, -2, 136), size: [3, 4, 10], yaw: 180, mat: "ice" },
      { kind: "sphere", id: "S2-bonkGlow", at: P(212, -3.6, 126), r: 0.4, mat: "gold" },
      ...approach,
      slab("S2-rock1", 118, 1.1, 90, [5, 2.2, 1.5], "rock"),
      slab("S2-rock2", 122, 1.1, 88, [5, 2.2, 1.5], "rock"),
      slab("S2-rock3", 142, 1.1, 90, [5, 2.2, 1.5], "rock"),
      ...boulderL("S2-rockL", 104, 90),
      ...boulderL("S2-rockR", 156, 90),
      ...centre,
      ...snowBerm("S2-last1", 118, 152),
      ...snowBerm("S2-last2", 106, 155),
      ...snowBerm("S2-last3", 142, 152),
      slab("S2-apronW", 121, 0.6, 188, [4, 1.2, 1], "concrete"),
      slab("S2-apronE", 139, 0.6, 188, [4, 1.2, 1], "concrete"),
      slab("S2-trW1", 37.75, 1.1, 86.5, [1.5, 2.2, 73], "snow"),
      slab("S2-trE1", 42.25, 1.1, 65, [1.5, 2.2, 30], "snow"),
      slab("S2-trE2", 42.25, 1.1, 103.25, [1.5, 2.2, 30.5], "snow"),
      slab("S2-jog1N", 52.75, 1.1, 122.25, [31.5, 2.2, 1.5], "snow"),
      slab("S2-jog1S", 56.25, 1.1, 117.75, [26.5, 2.2, 1.5], "snow"),
      slab("S2-trW2", 67.75, 1.1, 135.25, [1.5, 2.2, 25.5], "snow"),
      slab("S2-trW3", 67.75, 1.1, 160.75, [1.5, 2.2, 17.5], "snow"),
      slab("S2-trE3", 72.25, 1.1, 128.5, [1.5, 2.2, 23], "snow"),
      slab("S2-trE4", 72.25, 1.1, 158.25, [1.5, 2.2, 20.5], "snow"),
      ...room("S2-dugout", 58, 67, 146, 154, 0, 2.2, [{ side: "e", at: 150, w: 2.4, h: 2.2 }], "wood"),
      slab("S2-jog2N", 82.75, 1.1, 172.25, [31.5, 2.2, 1.5], "snow"),
      slab("S2-jog2S", 86.25, 1.1, 167.75, [26.5, 2.2, 1.5], "snow"),
      slab("S2-trW4", 97.75, 1.1, 185.5, [1.5, 2.2, 27], "snow"),
      slab("S2-trE5", 102.25, 1.1, 183, [1.5, 2.2, 32], "snow"),
      slab("S2-wallW", 47.5, 4, 203, [75, 8, 6], "concrete"),
      slab("S2-wallE", 212.5, 4, 203, [75, 8, 6], "concrete"),
      slab("S2-pierW", 120.5, 4, 203, [11, 8, 6], "concrete"),
      slab("S2-pierE", 139.5, 4, 203, [11, 8, 6], "concrete"),
      slab("S2-lintel", 130, 7, 203, [8, 2, 6], "concrete"),
      ...parapet,
      slab("S2-parapetN", 130, 9.5, 205.75, [240, 3, 0.5], "concrete"),
      ...watchtower("S2-towerW", 60, 8, 203, 4),
      ...watchtower("S2-towerE", 200, 8, 203, 4),
      ...searchlight("S2-lightW", 30, 8, 202),
      ...searchlight("S2-lightE", 230, 8, 202),
      ...room("S2-kennel", 73, 77, 197, 200, 0, 2, [{ side: "s", at: 75, w: 1.6, h: 2 }], "concrete"),
      ...bw,
      ...mirror(bw),
      { kind: "box", id: "BW-gen-body", at: P(130, 1.2, 186), size: [8, 2.4, 1.2], mat: "metal" },
      { kind: "box", id: "BE-gen-body", at: P(130, 1.2, 192), size: [8, 2.4, 1.2], mat: "metal" },
      { kind: "box", id: "BW-gen-coil", at: P(124, 1, 186), size: [0.6, 2, 0.6], mat: "metal" },
      { kind: "box", id: "BE-gen-coil", at: P(136, 1, 192), size: [0.6, 2, 0.6], mat: "metal" }
    ],
    weapons: [],
    checkpoints: [
      { id: "CP4", at: P(130, 0, 157), whenDesign: "both tower snipers dead, or the apron" },
      { id: "CP5", at: P(100, 0, 230), whenDesign: "first generator destroyed" }
    ],
    mechanisms: [
      {
        kind: "weather",
        id: "S2-blizzard",
        whiteout: 20,
        period: 90,
        warning: 4,
        windows: [[10, 30], [100, 120], [190, 210]],
        sightCap: 40,
        viewCap: 40
      },
      { kind: "searchlight", id: "S2-lightW", at: P(30, 8, 202), yaw: Math.PI, beam: 120, spot: 6, hold: 2, lamp: 30, sweep: 8, alarm: "S2-alarm4" },
      { kind: "searchlight", id: "S2-lightE", at: P(230, 8, 202), yaw: Math.PI, beam: 120, spot: 6, hold: 2, lamp: 30, sweep: 8, alarm: "S2-alarm4" },
      { kind: "alarm", id: "S2-alarm4", at: P(130, 9.2, 200.2), hp: 40, cableHp: 20, cables: [P(30, 7, 203), P(230, 7, 203)] },
      { kind: "alarm", id: "S2-alarm5W", at: P(113, 2, 234), hp: 40, cableHp: 20, cableTo: P(100, 2, 234) },
      { kind: "alarm", id: "S2-alarm5E", at: P(147, 2, 234), hp: 40, cableHp: 20, cableTo: P(160, 2, 234) },
      { kind: "crackTiles", id: "S2-crack1", at: P(210, 0, 86), size: [80, 0.5, 12], tile: 4, fall: 1, telegraph: 0.5, return: 20 },
      { kind: "crackTiles", id: "S2-crack2", at: P(210, 0, 126), size: [80, 0.5, 12], tile: 4, fall: 1, telegraph: 0.5, return: 20, secret: "S2-bonk" },
      { kind: "crackTiles", id: "S2-crack3", at: P(210, 0, 166), size: [80, 0.5, 12], tile: 4, fall: 1, telegraph: 0.5, return: 20 },
      hazard("S2-lake", 170, 250, 50, 185, { dps: 100, kill: true, rescue: true, y0: -5, y1: -0.5, tag: "water" }),
      { kind: "target", id: "BW-gen-hp", solid: "BW-gen-body", hp: 500, at: P(130, 1.2, 186), weak: 2 },
      { kind: "target", id: "BE-gen-hp", solid: "BE-gen-body", hp: 500, at: P(130, 1.2, 192), weak: 2 },
      door5("S2-shieldGate", 130, 3, 200.5, [8, 6, 1], { opens: "S2-E5.cleared" }),
      latch("S2-gateLatch", "S2-shieldGate", P(5, 4, 230)),
      door5("S2-kennelDoor", 75, 1, 197, [1.6, 2, 0.6]),
      door5("BW-doorS", 100, 1.3, 200, [4, 2.6, 1]),
      door5("BW-doorN", 100, 1.3, 236, [2.4, 2.6, 1]),
      door5("BE-doorS", 160, 1.3, 200, [4, 2.6, 1]),
      door5("BE-doorN", 160, 1.3, 236, [2.4, 2.6, 1]),
      { kind: "power", id: "S2-overshield", at: P(238, 1, 150), modifier: "overshield" },
      { kind: "secret", id: "S2-bonk", at: P(212, -4, 126), modifier: "taxSeason", name: "Tax Season" },
      { kind: "secret", id: "S2-file2", at: P(60, 12, 203), tickets: 5, file: 2, name: "Audit File 2" },
      ammo4("AB9", 62, 0, 150, "bullets", 60),
      ammo4("AB10", 232, 0, 100, "sniper", 8),
      ammo4("AB11", 130, 0, 157, "rockets", 3),
      ammo4("AB12", 60, 12, 203, "sniper", 8),
      ammo4("AB13", 93, 0, 230, "shells", 12),
      ammo4("AB14", 167, 0, 230, "bullets", 60)
    ],
    encounters: [E43, E53]
  };

  // src/data/levels/L05/S3.js
  var rails = [];
  for (let i = 0; i < 6; i++) {
    const x = 22 + i * 10;
    const n = 30 + i * 10;
    rails.push(slab(`S3-railS${i}`, x, 5.6, 28, [8, 1.2, 0.5], "metal"));
    rails.push(slab(`S3-railN${i}`, x, 5.6, 90, [8, 1.2, 0.5], "metal"));
    rails.push(slab(`S3-railW${i}`, 19, 5.6, n, [0.5, 1.2, 8], "metal"));
    rails.push(slab(`S3-railE${i}`, 81, 5.6, n, [0.5, 1.2, 8], "metal"));
  }
  var dots = [];
  for (let i = 0; i < 8; i++) dots.push({ kind: "disc", id: `S3-threshold${i}`, at: P(46.5 + i, 0.05, 30), r: 0.4, mat: "neon" });
  var S34 = {
    id: "S3",
    name: "Gatehouse and Courtyard",
    origin: [100, 0, -726],
    start: P(50, 0, 6),
    yaw: 0,
    footprint: [100, 120],
    routeM: 105,
    flyerVolume: { min: [0, -6, -120], max: [100, 14, 0] },
    exit: zone3(48, 52, 114, 120, -2, 8),
    grappleAnchors: [
      hook("S3-hook-gallSW", 20, 5.8, 28),
      hook("S3-hook-gallSE", 80, 5.8, 28),
      hook("S3-hook-gallNW", 20, 5.8, 90),
      hook("S3-hook-gallNE", 80, 5.8, 90),
      hook("S3-hook-pillarSW", 32, 7.4, 41),
      hook("S3-hook-pillarSE", 68, 7.4, 41),
      hook("S3-hook-pillarNW", 32, 7.4, 77),
      hook("S3-hook-pillarNE", 68, 7.4, 77),
      hook("S3-hook-rig", 50, 6.4, 26)
    ],
    intro: {
      title: "Something in the courtyard has been on ice since the last audit.",
      lines: []
    },
    geometry: [
      slab("S3-floorS", 50, -0.5, 23, [100, 1, 46], "concrete"),
      slab("S3-floorN", 50, -0.5, 96, [100, 1, 48], "concrete"),
      slab("S3-floorW", 18.5, -0.5, 59, [37, 1, 26], "concrete"),
      slab("S3-floorE", 81.5, -0.5, 59, [37, 1, 26], "concrete"),
      slab("S3-basin", 50, -4.5, 59, [26, 1, 26], "ice"),
      slab("S3-iceFloor", 50, -0.25, 59, [26, 0.5, 26], "ice", { tag: "crackTiles" }),
      { kind: "cylinder", id: "S3-dais", at: P(50, -4, 59), r: 5, h: 4.6, mat: "ice" },
      { kind: "cylinder", id: "S3-iceMachine", at: P(50, 0.6, 59), r: 1.5, h: 4, mat: "metal" },
      slab("S3-passW", 45.5, 3, 11, [1, 6, 22], "concrete"),
      slab("S3-passE", 54.5, 3, 11, [1, 6, 22], "concrete"),
      slab("S3-passRoof", 50, 6.25, 11, [10, 0.5, 22], "concrete"),
      ...room("S3-depot", 28, 45, 2, 20, 0, 6, [{ side: "e", at: 11 }], "concrete"),
      ...room("S3-stairRoom", 55, 72, 2, 20, 0, 6, [{ side: "w", at: 11 }, { side: "n", at: 70 }], "concrete"),
      stairs({ id: "S3-stairUp", at: P(70, 2.5, 10), size: [3, 5, 12], yaw: 180, mat: "concrete" }),
      slab("S3-landing", 70, 4.75, 23, [4, 0.5, 6], "metal"),
      slab("S3-wallW1", 14, 6, 39.75, [2, 12, 35.5], "concrete"),
      slab("S3-wallW2", 14, 6, 78.25, [2, 12, 35.5], "concrete"),
      slab("S3-wallWLintel", 14, 7.5, 59, [2, 9, 3], "concrete"),
      slab("S3-wallE1", 86, 6, 39.75, [2, 12, 35.5], "concrete"),
      slab("S3-wallE2", 86, 6, 78.25, [2, 12, 35.5], "concrete"),
      slab("S3-wallELintel", 86, 7.5, 59, [2, 9, 3], "concrete"),
      slab("S3-wallS1", 30, 6, 23, [32, 12, 2], "concrete"),
      slab("S3-wallS2", 70, 6, 23, [32, 12, 2], "concrete"),
      slab("S3-wallSLintel", 50, 9, 23, [8, 6, 2], "concrete"),
      slab("S3-wallN1", 31, 6, 95, [34, 12, 2], "concrete"),
      slab("S3-wallN2", 69, 6, 95, [34, 12, 2], "concrete"),
      slab("S3-wallNLintel", 50, 8, 95, [4, 8, 2], "concrete"),
      slab("S3-gallS", 50, 4.75, 26, [62, 0.5, 4], "metal"),
      slab("S3-gallN", 50, 4.75, 92, [62, 0.5, 4], "metal"),
      slab("S3-gallW", 17, 4.75, 59, [4, 0.5, 70], "metal"),
      slab("S3-gallE", 83, 4.75, 59, [4, 0.5, 70], "metal"),
      ...rails,
      stairs({ id: "S3-stairSW", at: P(20.5, 2.5, 34), size: [3, 5, 10], yaw: 0, mat: "metal", tag: "slide" }),
      stairs({ id: "S3-stairSE", at: P(79.5, 2.5, 34), size: [3, 5, 10], yaw: 0, mat: "metal", tag: "slide" }),
      { kind: "cylinder", id: "S3-pillar1", at: P(32, 0, 41), r: 2, h: 8, mat: "ice" },
      { kind: "cylinder", id: "S3-pillar2", at: P(68, 0, 41), r: 2, h: 8, mat: "ice" },
      { kind: "cylinder", id: "S3-pillar3", at: P(32, 0, 77), r: 2, h: 8, mat: "ice" },
      { kind: "cylinder", id: "S3-pillar4", at: P(68, 0, 77), r: 2, h: 8, mat: "ice" },
      slab("S3-bar1", 40, 0.6, 32, [4, 1.2, 1], "concrete"),
      slab("S3-bar2", 60, 0.6, 32, [4, 1.2, 1], "concrete"),
      slab("S3-bar3", 24, 0.6, 59, [4, 1.2, 1], "concrete"),
      slab("S3-bar4", 76, 0.6, 59, [4, 1.2, 1], "concrete"),
      slab("S3-bar5", 40, 0.6, 86, [4, 1.2, 1], "concrete"),
      slab("S3-bar6", 60, 0.6, 86, [4, 1.2, 1], "concrete"),
      ...crateStack("S3-crate1", 26, 30),
      ...crateStack("S3-crate2", 74, 30),
      ...crateStack("S3-crate3", 26, 88),
      ...crateStack("S3-crate4", 74, 88),
      ...generator("S3-genNW", 17, 5, 91),
      ...generator("S3-genNE", 83, 5, 91),
      { kind: "cylinder", id: "S3-rigPad", at: P(50, 5, 26), r: 1.2, h: 1, mat: "metal" },
      slab("S3-hatch", 62, 0.75, 93, [3, 1.5, 2], "metal"),
      slab("S3-passN1", 47.5, 3, 106, [1, 6, 20], "concrete"),
      slab("S3-passN2", 52.5, 3, 106, [1, 6, 20], "concrete"),
      slab("S3-passNRoof", 50, 6.25, 106, [6, 0.5, 20], "concrete"),
      ...dots
    ],
    weapons: [],
    checkpoints: [
      { id: "CP6", at: P(50, 0, 18), whenDesign: "leaving depot 1" },
      { id: "CP7", at: P(50, 0.6, 59), when: "S3-F1.cleared" }
    ],
    mechanisms: [
      { kind: "depot", id: "D1", at: P(36, 0, 11) },
      { kind: "depotCrate", id: "D1-crate", at: P(33, 0, 6) },
      { kind: "health", id: "D1-health", at: P(33, 0, 16) },
      { kind: "bench", id: "D1-bench", at: P(41, 0, 6) },
      { kind: "shop", id: "D1-shop", at: P(41, 0, 16) },
      door5("S3-arenaDoor", 50, 3, 22.5, [8, 6, 0.6]),
      door5("S3-exitDoor", 50, 2, 95, [4, 4, 0.6]),
      door5("S3-doorUp", 70, 5, 20, [2.4, 2.6, 0.6]),
      door5("SP-W", 14, 1.5, 59, [2, 3, 3]),
      door5("SP-E", 86, 1.5, 59, [2, 3, 3]),
      { kind: "emplacement", id: "S3-rig", at: P(50, 5, 26), yaw: 180, def: "miningRig", arc: 120, rate: 8, damage: 3, overheat: 4, recover: 2 },
      { kind: "target", id: "S3-genNW-hp", solid: "S3-genNW-body", hp: 500, at: P(17, 6, 91), weak: 2 },
      { kind: "target", id: "S3-genNE-hp", solid: "S3-genNE-body", hp: 500, at: P(83, 6, 91), weak: 2 },
      hazard("S3-cold", 15, 85, 24, 94, { set: "F1-part2", dps: 3, shieldRegen: 0, y0: -4, y1: 3, tag: "cold" }),
      hazard("S3-slick", 35, 65, 44, 74, { set: "F1-part3", slow: 0.15, tag: "slick" }),
      { kind: "crackTiles", id: "S3-crack", at: P(50, 0, 59), size: [26, 0.5, 26], tile: 3.25, set: "F1-part3", fall: 1, telegraph: 0.5, return: 20 },
      { kind: "breakable", id: "S3-break1", solid: "S3-pillar1", hits: 2, stun: 2 },
      { kind: "breakable", id: "S3-break2", solid: "S3-pillar2", hits: 2, stun: 2 },
      { kind: "breakable", id: "S3-break3", solid: "S3-pillar3", hits: 2, stun: 2 },
      { kind: "breakable", id: "S3-break4", solid: "S3-pillar4", hits: 2, stun: 2 },
      { kind: "power", id: "S3-overshield", at: P(50, 5, 90), modifier: "overshield" },
      { kind: "chest", id: "chest-l1", at: P(50, 0.6, 63), opens: "S3-F1.cleared", tier: "uncommon" },
      { kind: "ammoCrate", id: "AC1", at: P(52, 0.6, 63), uses: 3, opens: "S3-F1.cleared" },
      ammo4("AB15", 50, 5, 92, "sniper", 8),
      ammo4("AB16", 46, 5, 26, "bullets", 60)
    ],
    encounters: [F12]
  };

  // src/data/levels/L05/S4.js
  var shelfX = [24, 29, 34, 46, 51, 56];
  var shelves = [];
  for (const x of shelfX) {
    for (const n of [25, 43]) shelves.push(slab(`S4-shelf-${x}-${n}`, x, 8.5, n, [0.8, 3, 10], "wood"));
  }
  var rails2 = [];
  for (let i = 0; i < 4; i++) {
    rails2.push(slab(`S4-railW${i}`, 16, 14.6, 18 + i * 10, [0.5, 1.2, 8], "metal"));
    rails2.push(slab(`S4-railE${i}`, 64, 14.6, 18 + i * 10, [0.5, 1.2, 8], "metal"));
    rails2.push(slab(`S4-railS${i}`, 20 + i * 12, 14.6, 16, [8, 1.2, 0.5], "metal"));
    rails2.push(slab(`S4-railN${i}`, 20 + i * 12, 14.6, 52, [8, 1.2, 0.5], "metal"));
  }
  var S44 = {
    id: "S4",
    name: "Frost Halls",
    origin: [110, 0, -842],
    start: P(40, 0, 2),
    yaw: 0,
    footprint: [80, 70],
    routeM: 250,
    flyerVolume: { min: [0, -2, -70], max: [80, 22, 0] },
    grappleAnchors: [
      hook("S4-hook-gallW", 14, 14.6, 34),
      hook("S4-hook-gallE", 66, 14.6, 34),
      hook("S4-hook-gallS", 40, 14.6, 14),
      hook("S4-hook-gallN", 40, 14.6, 54)
    ],
    exit: zone3(36, 44, 64, 70, 20, 26),
    geometry: [
      slab("S4-floor", 40, -0.5, 31, [80, 1, 78], "concrete"),
      slab("S4-f2s", 40, 6.5, 30, [80, 1, 60], "concrete"),
      slab("S4-f2n", 40, 6.5, 67, [80, 1, 6], "concrete"),
      slab("S4-f2w", 19, 6.5, 62, [38, 1, 4], "concrete"),
      slab("S4-f2e", 61, 6.5, 62, [38, 1, 4], "concrete"),
      slab("S4-roof", 40, 20.5, 35, [80, 1, 70], "concrete"),
      slab("S4-wallW", 0.5, 10.5, 35, [1, 21, 70], "concrete"),
      slab("S4-wallE", 79.5, 10.5, 35, [1, 21, 70], "concrete"),
      slab("S4-wallN", 40, 10.5, 69.5, [80, 21, 1], "concrete"),
      slab("S4-wallSlowL", 19, 1.3, 0.5, [38, 2.6, 1], "concrete"),
      slab("S4-wallSlowR", 61, 1.3, 0.5, [38, 2.6, 1], "concrete"),
      slab("S4-wallSup", 40, 11.8, 0.5, [80, 18.4, 1], "concrete"),
      ...room("S4-vest", 32, 48, 1, 12, 0, 6, [
        { side: "s", at: 40, w: 4 },
        { side: "n", at: 40, w: 2.4 },
        { side: "w", at: 8, w: 2.4 }
      ], "concrete"),
      slab("S4-corrW1", 37, 3, 16.5, [1, 6, 9], "concrete"),
      slab("S4-corrW2", 37, 3, 33.2, [1, 6, 19.6], "concrete"),
      slab("S4-corrW3", 37, 3, 50.7, [1, 6, 10.6], "concrete"),
      slab("S4-corrWlintel1", 37, 4.3, 22.2, [1, 3.4, 2.4], "concrete"),
      slab("S4-corrWlintel2", 37, 4.3, 44.2, [1, 3.4, 2.4], "concrete"),
      slab("S4-corrE1", 43, 3, 20.5, [1, 6, 17], "concrete"),
      slab("S4-corrE2", 43, 3, 40.2, [1, 6, 17.6], "concrete"),
      slab("S4-corrE3", 43, 3, 53.7, [1, 6, 4.6], "concrete"),
      slab("S4-corrElintel1", 43, 4.3, 30.2, [1, 3.4, 2.4], "concrete"),
      slab("S4-corrElintel2", 43, 4.3, 50.2, [1, 3.4, 2.4], "concrete"),
      slab("S4-pallet1", 39, 0.6, 20, [1.5, 1.2, 1], "ice"),
      slab("S4-pallet2", 41.5, 0.6, 32, [1.5, 1.2, 1], "ice"),
      slab("S4-pallet3", 39, 0.6, 44, [1.5, 1.2, 1], "ice"),
      slab("S4-service", 21.5, 3, 33, [1, 6, 52], "concrete"),
      slab("S4-linkS", 28.5, 3, 5.5, [7, 6, 1], "concrete"),
      slab("S4-linkN", 28.5, 3, 10.5, [7, 6, 1], "concrete"),
      ...room("S4-W1", 26, 36.5, 16, 28, 0, 6, [{ side: "e", at: 22 }, { side: "w", at: 22 }], "metal"),
      ...room("S4-W2", 26, 36.5, 38, 50, 0, 6, [{ side: "e", at: 44 }, { side: "w", at: 44 }], "metal"),
      ...room("S4-E1", 43.5, 56, 24, 36, 0, 6, [{ side: "w", at: 30 }], "metal"),
      ...room("S4-kennel", 43.5, 56, 44, 56, 0, 6, [{ side: "w", at: 50 }], "metal"),
      ...room("S4-lobby", 30, 50, 56, 68, 0, 6, [{ side: "s", at: 40 }, { side: "w", at: 58 }], "concrete"),
      slab("S4-liftA", 40, 0.25, 62, [4, 0.5, 2], "metal"),
      ...room("S4-f2lobby", 30, 50, 58, 68, 7, 6, [{ side: "s", at: 40 }], "concrete"),
      slab("S4-libNlowL", 25, 10, 56, [26, 6, 1], "concrete"),
      slab("S4-libNlowR", 55, 10, 56, [26, 6, 1], "concrete"),
      slab("S4-libNup", 40, 16.5, 56, [56, 7, 1], "concrete"),
      slab("S4-libSlow", 40, 10.5, 12, [56, 7, 1], "concrete"),
      slab("S4-libShighL", 25, 17, 12, [26, 6, 1], "concrete"),
      slab("S4-libShighR", 55, 17, 12, [26, 6, 1], "concrete"),
      slab("S4-libW1", 12, 13.5, 22.25, [1, 13, 20.5], "concrete"),
      slab("S4-libW2", 12, 13.5, 45.75, [1, 13, 20.5], "concrete"),
      slab("S4-libE1", 68, 13.5, 22.25, [1, 13, 20.5], "concrete"),
      slab("S4-libE2", 68, 13.5, 45.75, [1, 13, 20.5], "concrete"),
      ...shelves,
      slab("S4-table1", 20, 7.6, 34, [3, 1.2, 1.5], "wood"),
      slab("S4-table2", 30, 7.6, 34, [3, 1.2, 1.5], "wood"),
      slab("S4-table3", 50, 7.6, 34, [3, 1.2, 1.5], "wood"),
      slab("S4-table4", 60, 7.6, 34, [3, 1.2, 1.5], "wood"),
      { kind: "cylinder", id: "S4-desk", at: P(28, 7, 34), r: 2, h: 1.2, mat: "wood" },
      ...room("S4-cage", 13, 21, 13, 21, 7, 3, [{ side: "e", at: 17, h: 3 }], "glass"),
      slab("S4-gallW", 14, 13.75, 34, [4, 0.5, 44], "metal"),
      slab("S4-gallE", 66, 13.75, 34, [4, 0.5, 44], "metal"),
      slab("S4-gallS", 40, 13.75, 14, [48, 0.5, 4], "metal"),
      slab("S4-gallN", 40, 13.75, 54, [48, 0.5, 4], "metal"),
      ...rails2,
      stairs({ id: "S4-stairNW", at: P(17.5, 10.5, 43), size: [3, 7, 14], yaw: 180, mat: "metal", tag: "slide" }),
      slab("S4-landNW", 17.5, 13.75, 35, [3, 0.5, 2], "metal"),
      stairs({ id: "S4-stairSE", at: P(62.5, 10.5, 25), size: [3, 7, 14], yaw: 0, mat: "metal", tag: "slide" }),
      slab("S4-landSE", 62.5, 13.75, 33, [3, 0.5, 2], "metal"),
      slab("S4-vent1", 26, 19.75, 43, [2, 0.5, 2], "metal"),
      slab("S4-vent2", 54, 19.75, 25, [2, 0.5, 2], "metal"),
      slab("S4-f3floor", 40, 13.5, 6.5, [20, 1, 9], "concrete"),
      ...room("S4-f3lobby", 30, 50, 2, 11, 14, 6, [{ side: "n", at: 40, w: 4 }], "concrete"),
      slab("S4-freightCar", 40, 14.25, 67, [6, 0.5, 5], "metal")
    ],
    weapons: [
      { id: "R2", at: P(34, 0, 6), gun: "shotgun", why: "E6 corridor, Frost Hounds, the Library", quality: "uncommon", manufacturer: "reliable", element: "none", level: 5 }
    ],
    checkpoints: [
      { id: "CP8", at: P(40, 7, 64), whenDesign: "Lift A arrives" },
      { id: "CP9", at: P(40, 7, 34), when: "S4-E7.cleared" }
    ],
    mechanisms: [
      hazard("S4-slickW", 37.5, 38.5, 14, 54, { slow: 0.15, tag: "slick", y0: -1, y1: 2 }),
      hazard("S4-slickE", 42, 42.5, 14, 54, { slow: 0.15, tag: "slick", y0: -1, y1: 2 }),
      hazard("S4-coldW1", 26, 36.5, 16, 28, { shieldRegen: 0.5, tag: "cold", y0: 0, y1: 6 }),
      hazard("S4-coldW2", 26, 36.5, 38, 50, { shieldRegen: 0.5, tag: "cold", y0: 0, y1: 6 }),
      hazard("S4-coldE1", 43.5, 56, 24, 36, { shieldRegen: 0.5, tag: "cold", y0: 0, y1: 6 }),
      { kind: "mover", id: "S4-lift", carry: true, from: P(40, 0, 62), to: P(40, 7, 62), speed: 2 },
      { kind: "mover", id: "S4-freight", carry: true, from: P(40, 14, 67), to: P(40, 21, 67), speed: 7 / 15, rideSec: 15 },
      door5("LIB-in", 40, 10, 56.5, [4, 6, 0.6]),
      door5("LIB-out", 40, 17, 11.5, [4, 6, 0.6]),
      door5("LIB-doorW", 11.5, 8.5, 34, [0.6, 3, 3]),
      door5("LIB-doorE", 68.5, 8.5, 34, [0.6, 3, 3]),
      door5("LIB-doorG", 68.5, 15.5, 44, [0.6, 3, 3]),
      { kind: "secret", id: "S4-battery", at: P(31, 0.5, 47), mana: 10, manaRegen: 0.5, name: "Mana Battery" },
      { kind: "secret", id: "S4-file3", at: P(17, 7, 17), tickets: 5, file: 3, name: "Audit File 3", opens: "S4-E7.cleared" },
      { kind: "chest", id: "chest-l2", at: P(42, 7, 34), opens: "S4-E7.cleared", tier: "uncommon" },
      { kind: "ammoCrate", id: "AC2", at: P(44, 7, 34), uses: 3, opens: "S4-E7.cleared" },
      { kind: "manaBloom", id: "S4-bloom", at: P(40, 7.2, 34), mana: 50, regrow: 20, opens: "S4-E7.cleared" },
      ammo4("AB17", 46, 0, 6, "shells", 12),
      ammo4("AB18", 44, 7, 64, "shells", 12),
      ammo4("AB19", 38, 7, 36, "shells", 12),
      ammo4("AB20", 14, 14, 20, "sniper", 8)
    ],
    encounters: [E63, E73]
  };

  // src/data/levels/L05/S5.js
  var blocks = [
    [54, 62],
    [49.9, 71.9],
    [40, 76],
    [30.1, 71.9],
    [26, 62],
    [30.1, 52.1],
    [40, 48],
    [49.9, 52.1]
  ].map(([x, n], i) => slab(
    `S5-block${i + 1}`,
    x,
    i % 2 === 0 ? 1.1 : 0.6,
    n,
    i % 2 === 0 ? [3, 2.2, 1.5] : [3, 1.2, 1.5],
    "metal"
  ));
  function band(id, x0, x1, n, y = 12.5) {
    return slab(id, (x0 + x1) / 2, y, n, [x1 - x0, 1, 3], "metal");
  }
  var S54 = {
    id: "S5",
    name: "Armory and Vault",
    origin: [110, 21, -904],
    start: P(40, 0, 5),
    yaw: 0,
    footprint: [80, 100],
    routeM: 105,
    flyerVolume: { min: [0, -2, -100], max: [80, 14, 0] },
    grappleAnchors: [
      hook("S5-hook-pillarSW", 24, 10, 46),
      hook("S5-hook-pillarSE", 56, 10, 46),
      hook("S5-hook-pillarNW", 24, 10, 78),
      hook("S5-hook-pillarNE", 56, 10, 78)
    ],
    noGrapple: [zone3(18, 62, 40, 84, 12, 30)],
    exit: null,
    intro: {
      title: "Glowie, on the speakers: 'This is a routine inquiry. Please stand still.'",
      lines: []
    },
    geometry: [
      slab("S5-floor", 40, -0.5, 50, [80, 1, 100], "concrete"),
      ...room("S5-liftBay", 36, 44, 1, 9, 0, 5, [{ side: "n", at: 40 }], "concrete"),
      ...room("S5-armory", 28, 52, 9, 25, 0, 5, [{ side: "s", at: 40 }, { side: "n", at: 40 }], "concrete"),
      ...room("S5-ante", 36, 44, 25, 39, 0, 6, [{ side: "s", at: 40 }, { side: "n", at: 40, w: 6 }], "concrete"),
      slab("S5-vaultS1", 26.5, 6, 39, [21, 12, 2], "metal"),
      slab("S5-vaultS2", 53.5, 6, 39, [21, 12, 2], "metal"),
      slab("S5-vaultSLintel", 40, 9, 39, [6, 6, 2], "metal"),
      slab("S5-vaultN1", 27, 6, 85, [22, 12, 2], "metal"),
      slab("S5-vaultN2", 53, 6, 85, [22, 12, 2], "metal"),
      slab("S5-vaultNLintel", 40, 8, 85, [4, 8, 2], "metal"),
      slab("S5-vaultW1", 17, 6, 50.25, [2, 12, 20.5], "metal"),
      slab("S5-vaultW2", 17, 6, 73.75, [2, 12, 20.5], "metal"),
      slab("S5-vaultWLintel", 17, 7.5, 62, [2, 9, 3], "metal"),
      slab("S5-vaultE", 63, 6, 62, [2, 12, 44], "metal"),
      slab("S5-roofS1", 40, 12.5, 44.25, [44, 1, 8.5], "metal"),
      slab("S5-roofS2", 40, 12.5, 53.75, [44, 1, 4.5], "metal"),
      band("S5-roofSA", 18, 24.5, 50),
      band("S5-roofSM", 27.5, 52.5, 50),
      band("S5-roofSB", 55.5, 62, 50),
      slab("S5-roofN1", 40, 12.5, 70.25, [44, 1, 4.5], "metal"),
      slab("S5-roofN2", 40, 12.5, 79.75, [44, 1, 8.5], "metal"),
      band("S5-roofNC", 18, 24.5, 74),
      band("S5-roofNM", 27.5, 52.5, 74),
      band("S5-roofND", 55.5, 62, 74),
      slab("S5-roofW", 26, 12.5, 62, [16, 1, 12], "metal"),
      slab("S5-roofE", 54, 12.5, 62, [16, 1, 12], "metal"),
      ...room("S5-guard", 6, 17, 56, 68, 0, 4, [{ side: "e", at: 62, w: 3, h: 3 }], "concrete"),
      { kind: "cylinder", id: "S5-safe", at: P(40, 0, 62), r: 2.5, h: 3, mat: "gold" },
      slab("S5-drill", 40, 4, 62, [1, 1, 6], "metal"),
      { kind: "disc", id: "S5-ring", at: P(40, 0.04, 62), r: 9, mat: "neon" },
      slab("S5-console1", 46, 0.6, 62, [2, 1.2, 1], "metal"),
      slab("S5-console2", 34, 0.6, 62, [2, 1.2, 1], "metal"),
      slab("S5-console3", 40, 0.6, 56, [2, 1.2, 1], "metal"),
      slab("S5-console4", 40, 0.6, 68, [2, 1.2, 1], "metal"),
      ...blocks,
      { kind: "cylinder", id: "S5-pillar1", at: P(24, 0, 46), r: 1.5, h: 12, mat: "concrete" },
      { kind: "cylinder", id: "S5-pillar2", at: P(56, 0, 46), r: 1.5, h: 12, mat: "concrete" },
      { kind: "cylinder", id: "S5-pillar3", at: P(24, 0, 78), r: 1.5, h: 12, mat: "concrete" },
      { kind: "cylinder", id: "S5-pillar4", at: P(56, 0, 78), r: 1.5, h: 12, mat: "concrete" },
      { kind: "disc", id: "S5-grate1", at: P(30, 0.04, 56), r: 3, mat: "ice" },
      { kind: "disc", id: "S5-grate2", at: P(50, 0.04, 56), r: 3, mat: "ice" },
      { kind: "disc", id: "S5-grate3", at: P(30, 0.04, 68), r: 3, mat: "ice" },
      { kind: "disc", id: "S5-grate4", at: P(50, 0.04, 68), r: 3, mat: "ice" },
      slab("S5-gantry", 40, -0.25, 90, [4, 0.5, 12], "metal"),
      slab("S5-padFloor", 40, -0.25, 96, [10, 0.5, 10], "concrete", { tag: "padStandIn" }),
      { kind: "disc", id: "S5-pad", at: P(40, 0.05, 96), r: 5, mat: "neon" }
    ],
    weapons: [],
    checkpoints: [
      { id: "CP10", at: P(40, 0, 34), whenDesign: "leaving depot 2" }
    ],
    mechanisms: [
      { kind: "depot", id: "D2", at: P(40, 0, 17) },
      { kind: "depotCrate", id: "D2-crate", at: P(33, 0, 17) },
      { kind: "health", id: "D2-health", at: P(33, 0, 21) },
      { kind: "bench", id: "D2-bench", at: P(47, 0, 21) },
      { kind: "shop", id: "D2-shop", at: P(47, 0, 17) },
      door5("S5-blastDoor", 40, 3, 39.5, [6, 6, 0.6]),
      door5("S5-exitDoor", 40, 2, 84.5, [4, 4, 0.6]),
      door5("S5-guardDoor", 17, 1.5, 62, [0.6, 3, 3]),
      { kind: "switch", id: "S5-drillSwitch", at: P(40, 1.2, 59.5), needsHold: true, holdTime: 1.5, starts: "S5-F2" },
      {
        kind: "droneStrike",
        id: "S5-strikes",
        at: P(40, 12, 62),
        ...DRONE_STRIKE,
        times: [8, 22, 36, 50, 64, 78, 92],
        thenEvery: 14
      },
      hazard("S5-cool1", 27, 33, 53, 59, { set: "F2-coolant", tag: "cold", shieldRegen: 0, y0: -1, y1: 3 }),
      hazard("S5-cool2", 47, 53, 53, 59, { set: "F2-coolant", tag: "cold", shieldRegen: 0, y0: -1, y1: 3 }),
      hazard("S5-cool3", 27, 33, 65, 71, { set: "F2-coolant", tag: "cold", shieldRegen: 0, y0: -1, y1: 3 }),
      hazard("S5-cool4", 47, 53, 65, 71, { set: "F2-coolant", tag: "cold", shieldRegen: 0, y0: -1, y1: 3 }),
      { kind: "hold", id: "S5-hold", at: P(40, 0, 62), r: 9, seconds: 90, needs: "player-or-buddy" },
      { kind: "chest", id: "chest-l3", at: P(40, 0, 66), opens: "S5-F2.cleared", tier: "uncommon" },
      { kind: "ammoCrate", id: "AC3", at: P(42, 0, 66), uses: 3, opens: "S5-F2.cleared" },
      ammo4("AB21", 42, 0, 32, "bullets", 60),
      ammo4("AB22", 60, 0, 62, "bullets", 60),
      ammo4("AB23", 40, 0, 80, "shells", 12)
    ],
    encounters: [F22, S5_END]
  };

  // src/data/levels/L05/index.js
  var L05_PACING = [
    ["B1", 31],
    ["E1", 66],
    ["E2", 54],
    ["B2", 20],
    ["E3", 106],
    ["E4", 152],
    ["E5", 115],
    ["D1", 52],
    ["F1", 160],
    ["E6", 78],
    ["E7", 166],
    ["B3", 20],
    ["D2", 51],
    ["F2", 158]
  ];
  var L05_BOT = [
    { section: "S1", steps: ["C1", "ridge slot 3", "snipe the runner", "camp", "bridge after the drone", "shrine", "Decoy", "P1 P2 elite", "clerk", "R1", "vent", "gate"] },
    { section: "S2", steps: ["whiteout", "Sniper Rocks", "Last Cover", "rig vents", "hounds", "bunker W roof", "bunker E", "gate"] },
    { section: "S3", steps: ["depot", "south gallery", "brow plate", "emplacement", "generators", "gallery through part 3"] },
    { section: "S4", steps: ["R2", "service passage", "locker W2", "Lift A", "north-west stair", "freight"] },
    { section: "S5", steps: ["depot", "drill", "circle the ring", "ledgers", "pad"] }
  ];
  function add2(at2, origin) {
    return [at2[0] + origin[0], (at2[1] || 0) + (origin[1] || 0), at2[2] + origin[2]];
  }
  function shiftBox2(box3, origin) {
    if (!box3 || !box3.min || !box3.max) return box3;
    return { min: add2(box3.min, origin), max: add2(box3.max, origin) };
  }
  function shiftDesign(at2, origin) {
    if (!at2) return at2;
    return [at2[0] + origin[0], (at2[1] || 0) + (origin[1] || 0), -(at2[2] || 0) + origin[2]];
  }
  var BUILT3 = makeV2Level({
    id: "L05",
    name: "Frostspire Black Site",
    stage: "glacier",
    tier: 5,
    parTime: 20 * 60,
    jetpack: false,
    // Nav stays off until pathing can take a 300 by 520 section. See ENGINE-NEEDS.md.
    useNav: false,
    maxAlive: 12,
    lighting: { sky: "polar-night", aurora: true, indoor: "cold-blue", blizzard: "S2" },
    bounds: { min: [-30, -40, -1100], max: [420, 80, 40] },
    sections: [S14, S24, S34, S44, S54]
  });
  for (const sec of BUILT3.sections) {
    const origin = sec.origin;
    for (const enc of sec.encounters || []) {
      for (const sq of enc.squads || []) {
        const tr = sq.trigger;
        if (!tr) continue;
        if (tr.box) tr.box = shiftBox2(tr.box, origin);
        if (tr.zBelow != null) tr.zBelow += origin[2];
        if (tr.zAbove != null) tr.zAbove += origin[2];
      }
      const script = enc.script;
      if (!script) continue;
      for (const part of script.parts || []) {
        for (const addSpec of part.adds || []) {
          if (addSpec.at && addSpec.at.length && Array.isArray(addSpec.at[0])) {
            addSpec.at = addSpec.at.map((p) => shiftDesign(p, origin));
          } else addSpec.at = shiftDesign(addSpec.at, origin);
        }
      }
    }
  }
  var counted = census(BUILT3.sections.flatMap((sec) => sec.encounters));
  BUILT3.estimateSeconds = L05_PACING.reduce((sum, row) => sum + row[1], 0);
  BUILT3.estimateWithAlarms = BUILT3.estimateSeconds + 47;
  BUILT3.pacing = L05_PACING;
  BUILT3.botRoute = L05_BOT;
  BUILT3.census = counted;
  BUILT3.archetypes = { spotterDrone: SPOTTER_DRONE, frostHound: FROST_HOUND };
  BUILT3.spellNotes = { held: ["gooBolt", "chainZap", "carpet", "yeet", "swarm", "manaShield", "pumpIt"], shrine: DECOY };
  BUILT3.decoy = DECOY;
  BUILT3.auditor = AUDITOR;
  BUILT3.outro = { title: "You have the ledgers. Glowie has your face. See you at the office.", lines: [] };
  BUILT3.difficulty = {
    easy: { laser: 1.8, searchHold: 3, droneHold: 2.5, alarmFewer: 2, whiteout: 30, rigVent: 3, hounds: 1, sniperBox: 12, plates: 0.7, generators: 1, drill: 70, strike: 18 },
    heroic: { laser: 1.1, searchHold: 1.2, droneHold: 1, alarmMore: 2, whiteout: 15, rigVent: 2, thirdRig: true, hounds: 3, dropBoxes: ["AB4", "AB8"], plates: 1.3, generators: 3, missiles: 5, waveAt: 4, drill: 110, strike: 10, strikePairsAfter: 60 }
  };
  BUILT3.loot = {
    tierOdds: { common: 20, uncommon: 42, rare: 30, epic: 7, legendary: 1 },
    baseTier: "uncommon",
    racks: ["C1", "R1", "R2"],
    elites: ["the Head Auditor", "the Supervisor", "Alpha", "the Archivist", "the Vault Warden"],
    chests: ["chest-l1", "chest-l2", "chest-l3"],
    secretCache: "S1-secretCache",
    bonk: "Tax Season"
  };
  BUILT3.sightlines = [
    { name: "ridge to campfire", meters: 91 },
    { name: "ridge to lookout", meters: 113 },
    { name: "row A to mast", meters: 125 },
    { name: "row A to spire", meters: 128 },
    { name: "row A to hut", meters: 135 },
    { name: "Sniper Rocks to tower", meters: 135 },
    { name: "Sniper Rocks to rig", meters: 119 }
  ];
  var L05 = BUILT3;
  registerLevel(L05);

  // src/data/levels/campaign.js
  var card3 = (title, lines) => ({ title, lines });
  var L06 = makeLevel({
    id: "L06",
    name: "Vape Cabal Skyline",
    stage: "city",
    tier: 6,
    parTime: 22 * 60,
    jetpack: true,
    lighting: { weather: "rain" },
    sections: [
      {
        id: "S1",
        name: "Freeway",
        length: 56,
        floor: "metal",
        encounters: [{ id: "E1", x: 18, space: "rail", units: [["boomMidget", 3], ["riotMidget", 2]] }],
        weapons: [{ id: "sg-traffic", x: 30, gun: "shotgun", why: "traffic jam" }],
        mechanisms: [{ kind: "crusher", id: "bus-lane", x: 24 }],
        secret: { x: 8, modifier: "duckHunt" }
      },
      {
        id: "S2",
        name: "Crane Yard",
        length: 50,
        floor: "metal",
        encounters: [{ id: "E2", x: 16, space: "vertical", units: [["jetObama", 3]] }],
        weapons: [{ id: "sn-crane", x: 28, gun: "sniper", why: "crane cab overlook" }],
        mechanisms: [{ kind: "zipline", id: "roof-line", x: 20 }, { kind: "mover", id: "crane-hook", x: 34 }]
      },
      {
        id: "S3",
        name: "Rain Canyon",
        length: 50,
        floor: "metal",
        encounters: [{ id: "E3", x: 16, space: "sky", units: [["bitbug", 4], ["balloonMidget", 2]] }],
        weapons: [{ id: "mg-canyon", x: 12, gun: "mg", why: "bitbugs in the canyon" }]
      },
      {
        id: "S4",
        name: "Cabal Streets",
        length: 48,
        intro: card3("Los Angeles", ["Broccoli Head owns the night.", "The clouds are not weather."]),
        encounters: [{ id: "E4", x: 16, space: "arena", objective: "boss", units: [["broccoli", 1]] }],
        weapons: [{ id: "bz-broc", x: 10, gun: "bazooka", why: "Broccoli Head" }]
      }
    ]
  });
  var L07 = makeLevel({
    id: "L07",
    name: "Hellfire Underworks",
    stage: "volcano",
    tier: 7,
    parTime: 16 * 60,
    sections: [
      {
        id: "S1",
        name: "Shafts",
        length: 48,
        floor: "rock",
        encounters: [{ id: "E1", x: 16, space: "interior", units: [["miniTinubu", 2], ["midget", 2]] }],
        weapons: [{ id: "sg-shaft", x: 28, gun: "shotgun", why: "chargers in the shafts" }],
        mechanisms: [{ kind: "barrel", id: "ore-barrel", x: 20 }],
        secret: { x: 8, modifier: "lightsOut" }
      },
      {
        id: "S2",
        name: "Cart Run",
        length: 52,
        floor: "rock",
        encounters: [{ id: "E2", x: 18, space: "rail", units: [["midget", 4]] }],
        weapons: [{ id: "sn-cart", x: 12, gun: "sniper", why: "the cart ride" }],
        mechanisms: [{ kind: "rail", id: "mine-cart", x: 22 }]
      },
      {
        id: "S3",
        name: "Furnace Gallery",
        length: 48,
        floor: "rock",
        encounters: [{ id: "E3", x: 16, space: "arena", units: [["miniTinubu", 2], ["boomMidget", 2]] }],
        mechanisms: [{ kind: "hazard", id: "lava-run", x: 26, dps: 14 }, { kind: "crusher", id: "press", x: 32 }]
      },
      {
        id: "S4",
        name: "Meltdown",
        length: 48,
        floor: "rock",
        intro: card3("MELTDOWN", ["Reactors at 300%.", "Tinubu calls this a controlled burn. Run."]),
        encounters: [{ id: "E4", x: 16, space: "corridor", units: [["miniTinubu", 2]] }],
        weapons: [{ id: "bz-reactor", x: 10, gun: "bazooka", why: "the reactor ring" }]
      }
    ]
  });
  var L08 = makeLevel({
    id: "L08",
    name: "Government Office",
    stage: "office",
    tier: 8,
    parTime: 18 * 60,
    sections: [
      {
        id: "S1",
        name: "Lobby",
        length: 48,
        floor: "metal",
        encounters: [{ id: "E1", x: 16, space: "interior", units: [["glowieAgent", 4]] }],
        weapons: [{ id: "mg-lobby", x: 28, gun: "mg", why: "the lobby" }],
        mechanisms: [
          { kind: "laser", id: "lobby-laser", x: 22 },
          { kind: "door", id: "turnstile", x: 34, opens: "E1.cleared" }
        ],
        secret: { x: 8, modifier: "redTape" }
      },
      {
        id: "S2",
        name: "Cubicle Farm",
        length: 48,
        floor: "metal",
        encounters: [{ id: "E2", x: 16, space: "corridor", units: [["riotMidget", 2], ["glowieAgent", 2]] }],
        weapons: [{ id: "sg-cubes", x: 28, gun: "shotgun", why: "cubicle farm" }],
        mechanisms: [{ kind: "elevator", id: "lift-2", x: 34, y: 0.4 }]
      },
      {
        id: "S3",
        name: "Server Floor",
        length: 48,
        floor: "metal",
        encounters: [{ id: "E3", x: 16, space: "interior", units: [["auditSniper", 2], ["hexAcolyte", 2]] }],
        weapons: [{ id: "sn-atrium", x: 28, gun: "sniper", why: "the atrium sightline" }],
        mechanisms: [{ kind: "laser", id: "server-grid", x: 22, dps: 8 }]
      },
      {
        id: "S4",
        name: "The Roof",
        length: 48,
        intro: card3("Government Office", ["Glowie has a badge and a flashbang.", "Look away."]),
        encounters: [{ id: "E4", x: 16, space: "arena", objective: "boss", units: [["glowie", 1]] }],
        weapons: [{ id: "bz-glowie", x: 10, gun: "bazooka", why: "Glowie on the roof" }]
      }
    ]
  });
  var L09 = makeLevel({
    id: "L09",
    name: "Moonlit Ruins",
    stage: "moonlit",
    tier: 9,
    parTime: 28 * 60,
    jetpack: "pickup",
    sections: [
      {
        id: "S1",
        name: "Ruin Plains",
        length: 56,
        floor: "rock",
        encounters: [{ id: "E1", x: 18, space: "field", units: [["glowieAgent", 2], ["obama", 2], ["midget", 2]] }],
        weapons: [
          { id: "mg-camp", x: 10, gun: "mg", why: "camp cache" },
          { id: "sn-camp", x: 14, gun: "sniper", why: "camp cache" },
          { id: "bz-camp", x: 18, gun: "bazooka", why: "camp cache" }
        ],
        mechanisms: [
          { kind: "portal", id: "moon-gate", x: 30, dx: 8 },
          { kind: "jetpack", id: "moon-pack", x: 36 },
          { kind: "hazard", id: "low-g", x: 24, slow: 0, dps: 0 }
        ],
        secret: { x: 8, modifier: "swarmSurge" }
      },
      {
        id: "S2",
        name: "Catacombs",
        length: 50,
        floor: "rock",
        intro: card3("Descent", ["The plains were the map.", "The dead keep the other one."]),
        encounters: [{ id: "E2", x: 16, space: "interior", units: [["hexAcolyte", 3], ["sewerMidget", 3]] }],
        weapons: [{ id: "sg-cata", x: 28, gun: "shotgun", why: "catacomb standee" }]
      },
      {
        id: "S3",
        name: "Moon Gate",
        length: 50,
        intro: card3("The Moon Gate", ["Two Big Obamas. One key.", "Something older is waking up."]),
        encounters: [
          { id: "E3", x: 14, space: "arena", units: [["bigObama", 2]] },
          { id: "E4", x: 28, space: "arena", objective: "boss", fleeAt: 0.7, units: [["tinubu", 1]] }
        ]
      }
    ]
  });
  var L10 = makeLevel({
    id: "L10",
    name: "Hellfire Caldera",
    stage: "volcano",
    tier: 10,
    parTime: 30 * 60,
    jetpack: true,
    sections: [
      {
        id: "S1",
        name: "Ridge Trail",
        length: 54,
        floor: "rock",
        encounters: [{ id: "E1", x: 18, space: "ledge", units: [["miniTinubu", 2], ["auditSniper", 2]] }],
        weapons: [
          { id: "mg-cache", x: 8, gun: "mg", why: "ridge cache" },
          { id: "sg-cache", x: 12, gun: "shotgun", why: "ridge cache" },
          { id: "sn-cache", x: 16, gun: "sniper", why: "ridge cache" },
          { id: "bz-cache", x: 20, gun: "bazooka", why: "ridge cache" }
        ],
        mechanisms: [{ kind: "bridge", id: "rope-bridge", x: 32 }, { kind: "barrel", id: "ridge-barrel", x: 26 }],
        secret: { x: 6, modifier: "ironSproto" }
      },
      {
        id: "S2",
        name: "Geyser Fields",
        length: 52,
        floor: "rock",
        encounters: [{ id: "E2", x: 16, space: "field", units: [["boomMidget", 3], ["jetObama", 2]] }],
        mechanisms: [
          { kind: "jumpPad", id: "geyser", x: 12, power: 13 },
          { kind: "hazard", id: "lava-pool", x: 28, dps: 16 }
        ]
      },
      {
        id: "S3",
        name: "The Caldera",
        length: 50,
        intro: card3("Hellfire Caldera", ["Tinubu the Unshackled Demon.", "This is the audit."]),
        encounters: [{ id: "E3", x: 16, space: "arena", objective: "boss", units: [["tinubu", 1]] }]
      },
      {
        id: "S4",
        name: "Eruption",
        length: 46,
        floor: "rock",
        intro: card3("ERUPTION", ["The Demon is down. The volcano disagrees.", "Fly."]),
        encounters: [{ id: "E4", x: 16, space: "sky", units: [["flyingMidget", 3], ["bitbug", 3]] }],
        mechanisms: [{ kind: "fuel", id: "last-fuel", x: 10 }, { kind: "jumpPad", id: "vent", x: 24, power: 14 }]
      }
    ]
  });
  var CAMPAIGN_LEVELS = [L01, L02, L03, L04, L05, L06, L07, L08, L09, L10];

  // src/data/levels/index.js
  var LEVELS = { arena: arena_default };
  for (const level of CAMPAIGN_LEVELS) LEVELS[level.id] = level;
  var CAMPAIGN = CAMPAIGN_LEVELS.map((l) => l.id);
  function installLevel(level) {
    LEVELS[level.id] = level;
    return level;
  }
  function getLevelData(id) {
    const level = LEVELS[id] || LEVELS[resolveLevelId(id)];
    if (!level) throw new Error(`unknown level: ${id}`);
    return level;
  }
  function resolveLevelId(id) {
    if (!id) return null;
    const raw = String(id);
    if (LEVELS[raw]) return raw;
    const n = Number(raw);
    if (n >= 1 && n <= CAMPAIGN.length) return CAMPAIGN[n - 1];
    const hit = CAMPAIGN.find((k) => k.toLowerCase() === raw.toLowerCase());
    return hit || null;
  }

  // src/sim/level/runtime.js
  var cache = /* @__PURE__ */ new Map();
  function getLevelRuntime(id) {
    const key2 = String(id);
    if (cache.has(key2)) return cache.get(key2);
    const data = getLevelData(key2);
    const sectionById2 = {};
    for (const s of data.sections || []) sectionById2[s.id] = s;
    const rt = { ...data, sectionById: sectionById2 };
    cache.set(key2, rt);
    cache.set(data.id, rt);
    return rt;
  }
  function sectionById(levelId, sectionId) {
    const rt = getLevelRuntime(levelId);
    return rt.sectionById[sectionId] || rt.sections[0] || null;
  }
  function inBox(box3, x, y, z) {
    if (!box3) return false;
    const y0 = box3.min ? box3.min[1] : -1e9;
    const y1 = box3.max ? box3.max[1] : 1e9;
    const min = box3.min || box3;
    const max = box3.max || box3;
    if (box3.min) return x >= box3.min[0] && x <= box3.max[0] && y >= y0 && y <= y1 && z >= box3.min[2] && z <= box3.max[2];
    return x >= min[0] && x <= max[0] && z >= min[2] && z <= max[2];
  }
  function nearPoint(at2, x, y, z, r) {
    if (!at2) return false;
    const dx = x - at2[0], dy = y - (at2[1] || 0), dz = z - at2[2];
    return dx * dx + dy * dy + dz * dz <= r * r;
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
    const u4 = x - t.origin[0];
    const v = z - t.origin[2];
    if (u4 < 0 || v < 0 || u4 > t.size[0] || v > t.size[1]) return null;
    return { u: u4, v, north: t.size[1] - v };
  }
  function inFlat(t, u4, north) {
    const flats = t.flat || [];
    for (let i = 0; i < flats.length; i++) {
      const f = flats[i];
      if (f.x0 != null && (u4 < f.x0 || u4 > f.x1)) continue;
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
  function solidTerrain(sec) {
    if (!sec || !sec.terrain) return null;
    const geometry = sec.geometry || [];
    for (let i = 0; i < geometry.length; i++) {
      if (geometry[i] && geometry[i].tag === "terrainStandIn") return null;
    }
    return sec.terrain;
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
  function solidFromPrimitive(prim) {
    if (!prim) return null;
    if (prim.kind === "box" || prim.kind === "ramp") {
      let sx = prim.size[0], sy = prim.size[1], sz = prim.size[2];
      const yaw = ((prim.yaw || 0) % 360 + 360) % 360;
      if (yaw === 90 || yaw === 270) {
        const t = sx;
        sx = sz;
        sz = t;
      }
      return {
        kind: prim.kind,
        id: prim.id,
        yaw,
        min: [prim.at[0] - sx / 2, prim.at[1] - sy / 2, prim.at[2] - sz / 2],
        max: [prim.at[0] + sx / 2, prim.at[1] + sy / 2, prim.at[2] + sz / 2]
      };
    }
    if (prim.kind === "cylinder") {
      return {
        kind: "box",
        id: prim.id,
        yaw: 0,
        min: [prim.at[0] - prim.r, prim.at[1], prim.at[2] - prim.r],
        max: [prim.at[0] + prim.r, prim.at[1] + prim.h, prim.at[2] + prim.r]
      };
    }
    return null;
  }
  function solidsFromGeometry(geometry) {
    const out = [];
    for (const prim of geometry || []) {
      const s = solidFromPrimitive(prim);
      if (s) out.push(s);
    }
    return out;
  }
  function campaignSolidsOn(state) {
    return !!(state && state.mode === "campaign" && state.level && state.level.useSolids);
  }
  function activeSolids(state) {
    if (!campaignSolidsOn(state)) return null;
    const base = state.level.solids || [];
    const doors = state.level.closedDoors;
    if (!doors || !doors.length) return base;
    return base.concat(doors);
  }
  function overlapsXZ(s, x, z, r) {
    return x + r > s.min[0] && x - r < s.max[0] && z + r > s.min[2] && z - r < s.max[2];
  }
  function terrainSolid(t) {
    const amp = t.noise && t.noise.amp || 0;
    const oy = t.origin[1] || 0;
    return {
      kind: "terrain",
      id: t.id,
      terrain: t,
      min: [t.origin[0], oy - amp - 1, t.origin[2]],
      max: [t.origin[0] + t.size[0], oy + amp + 1, t.origin[2] + t.size[1]]
    };
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
  function groundHeight(solids, x, z, radius, feet, step = STEP_UP) {
    let g = -Infinity;
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      if (!overlapsXZ(s, x, z, radius)) continue;
      const top = surfaceY(s, x, z);
      if (top > feet + step + 0.02) continue;
      if (top > g) g = top;
    }
    return g;
  }
  function pushDownhill(ent, s, step) {
    const h = heightAt(s.terrain, ent.pos.x, ent.pos.z);
    if (h == null || h <= ent.pos.y + step + 0.02) return;
    const e = 0.35;
    const east = heightAt(s.terrain, ent.pos.x + e, ent.pos.z);
    const west = heightAt(s.terrain, ent.pos.x - e, ent.pos.z);
    const north = heightAt(s.terrain, ent.pos.x, ent.pos.z + e);
    const south = heightAt(s.terrain, ent.pos.x, ent.pos.z - e);
    const hx = (east == null ? h : east) - (west == null ? h : west);
    const hz = (north == null ? h : north) - (south == null ? h : south);
    const gl = Math.hypot(hx, hz);
    if (gl < 1e-4) return;
    ent.pos.x -= hx / gl * 0.2;
    ent.pos.z -= hz / gl * 0.2;
  }
  function pushCircle(x, z, s, radius) {
    const cx = Math.max(s.min[0], Math.min(x, s.max[0]));
    const cz = Math.max(s.min[2], Math.min(z, s.max[2]));
    let dx = x - cx, dz = z - cz;
    let dist = Math.hypot(dx, dz);
    if (dist >= radius) return null;
    if (dist < 1e-6) {
      const left = x - s.min[0], right = s.max[0] - x, back = z - s.min[2], fwd = s.max[2] - z;
      const m = Math.min(left, right, back, fwd);
      if (m === left) {
        dx = -1;
        dz = 0;
      } else if (m === right) {
        dx = 1;
        dz = 0;
      } else if (m === back) {
        dx = 0;
        dz = -1;
      } else {
        dx = 0;
        dz = 1;
      }
      dist = 1;
    }
    const k = (radius - dist) / dist + 1e-4;
    return { x: x + dx * k, z: z + dz * k };
  }
  function pushHorizontal(ent, solids, radius, height, step = STEP_UP) {
    const feet = ent.pos.y;
    const head = feet + height;
    for (let n = 0; n < 3; n++) {
      for (let i = 0; i < solids.length; i++) {
        const s = solids[i];
        if (s.kind === "terrain") {
          pushDownhill(ent, s, step);
          continue;
        }
        const top = surfaceY(s, ent.pos.x, ent.pos.z);
        if (top <= feet + step + 0.02) continue;
        if (head <= s.min[1] + 0.01 || feet + step >= s.max[1]) continue;
        const next2 = pushCircle(ent.pos.x, ent.pos.z, s, radius);
        if (!next2) continue;
        ent.pos.x = next2.x;
        ent.pos.z = next2.z;
      }
    }
  }
  function snapToGround(ent, solids, radius, step = STEP_UP) {
    const feet = ent.prevPos ? ent.prevPos.y : ent.pos.y;
    const g = groundHeight(solids, ent.pos.x, ent.pos.z, radius * 0.2, Math.max(feet, ent.pos.y), step);
    if (g === -Infinity) {
      ent.onGround = false;
      return;
    }
    const crossed = feet + 0.05 >= g - step && ent.pos.y <= g + 0.02;
    if (crossed) {
      ent.pos.y = g;
      if (ent.vel && ent.vel.y < 0) ent.vel.y = 0;
      ent.onGround = true;
      return;
    }
    ent.onGround = Math.abs(ent.pos.y - g) < 0.02;
  }
  function firstSolid(solids, origin, dir, maxDist, allow = null, includeThin = false) {
    let best = null;
    let bestT = -1;
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      if (typeof allow === "function" && !allow(s)) continue;
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
  function raySolids(solids, origin, dir, maxDist, allow = null) {
    const hit = firstSolid(solids, origin, dir, maxDist, allow);
    return hit ? hit.t : -1;
  }
  function rayTerrain(o, d, field2, maxDist, includeThin) {
    const step = Math.max(0.5, (field2 && field2.cell || 2) * 0.5);
    const startH = heightAt(field2, o.x, o.z);
    let prevY = o.y;
    let prevH = startH;
    let prev = 0;
    for (let dist = step; dist <= maxDist; dist += step) {
      const x = o.x + d.x * dist;
      const y = o.y + d.y * dist;
      const z = o.z + d.z * dist;
      const h = heightAt(field2, x, z);
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
  function voidAt(pos, volumes) {
    for (let i = 0; i < (volumes ? volumes.length : 0); i++) {
      const v = volumes[i];
      if (pos.x < v.min[0] || pos.x > v.max[0]) continue;
      if (pos.y < v.min[1] || pos.y > v.max[1]) continue;
      if (pos.z < v.min[2] || pos.z > v.max[2]) continue;
      return v;
    }
    return null;
  }

  // src/sim/campaign/bossScript.js
  function scriptBook(lv, encId) {
    if (!lv.scripts) lv.scripts = {};
    if (!lv.scripts[encId]) {
      lv.scripts[encId] = { part: 0, partT: 0, spawned: {}, targets: {}, outside: false };
    }
    return lv.scripts[encId];
  }
  function bossOf(state, enc) {
    for (const e of state.enemies) {
      if (!e.dead && e.boss && e.campaignEnc === enc.id) return e;
    }
    return null;
  }
  function spawnTarget(state, enc, spec, boss2, player, index) {
    const dx = player.pos.x - boss2.pos.x;
    const dz = player.pos.z - boss2.pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    const fx = dx / dist, fz = dz / dist;
    const side = index % 2 === 0 ? 1 : -1;
    const at2 = spec.at || [
      boss2.pos.x + fx * 3 + -fz * side * 1.6,
      0,
      boss2.pos.z + fz * 3 + fx * side * 1.6
    ];
    const e = createEnemy(state, "midget", { pos: { x: at2[0], z: at2[2] } });
    e.campaignEnc = enc.id;
    e.partId = spec.id;
    e.ai.scriptTarget = true;
    const rise = spec.rise != null ? spec.rise : String(spec.id).startsWith("pylon") ? 1.5 : 0;
    if (rise > 0) e.ai.riseT = rise;
    e.state = "chase";
    const hp = Math.max(1, Math.round((spec.hp || 1) * (state.tuning.enemyHpMult || 1)));
    e.maxHp = hp;
    e.hp = hp;
    return e;
  }
  function spawnAdd(state, enc, unit, boss2, at2, slot, count) {
    const type = unit[0];
    const extra = unit[2] || {};
    const base = at2 || [boss2.pos.x + 2, boss2.pos.y || 0, boss2.pos.z + 2];
    const ox = ((slot || 0) - ((count || 1) - 1) / 2) * 1.1;
    const e = createEnemy(state, type, { elite: !!extra.elite, pos: { x: base[0] + ox, z: base[2] } });
    e.pos.y = base[1] || 0;
    e.campaignEnc = enc.id;
    e.state = "chase";
    if (extra.name) e.name = extra.name;
    if (extra.hp) {
      const hp = Math.max(1, Math.round(extra.hp * (state.tuning.enemyHpMult || 1)));
      e.maxHp = hp;
      e.hp = hp;
    }
    return e;
  }
  function targetsLeft(state, prog) {
    let n = 0;
    for (const id of Object.keys(prog.targets)) {
      const e = state.enemies.find((en) => en.id === prog.targets[id]);
      if (e && !e.dead) n++;
    }
    return n;
  }
  function deadTargets(state, prog) {
    let n = 0;
    for (const id of Object.keys(prog.targets)) {
      const e = state.enemies.find((en) => en.id === prog.targets[id]);
      if (!e || e.dead) n++;
    }
    return n;
  }
  function scriptShields(state, solidId) {
    const book3 = state.level && state.level.scripts;
    if (!book3 || !solidId) return false;
    for (const prog of Object.values(book3)) {
      const targets = prog.targets || {};
      for (const id of Object.keys(targets)) {
        const spec = (prog.specs || {})[id];
        if (!spec || !spec.shields || spec.shields.indexOf(solidId) < 0) continue;
        const e = state.enemies.find((en) => en.id === targets[id]);
        if (e && !e.dead) return true;
      }
    }
    return false;
  }
  function applyField(state, p, center2, field2, dt) {
    if (!field2 || !p) return;
    const d = Math.hypot(p.pos.x - (field2.at ? field2.at[0] : center2.x), p.pos.z - (field2.at ? field2.at[2] : center2.z));
    if (d > (field2.r || 0)) return;
    if (field2.slow != null && field2.slow < 1) p.scriptSlow = Math.min(p.scriptSlow == null ? 1 : p.scriptSlow, field2.slow);
    if (field2.dps) damagePlayer(state, p, { base: field2.dps * dt, sourceKind: "world", fromPos: { x: p.pos.x, y: 0, z: p.pos.z } });
  }
  function tickBossScript(state, enc, dt) {
    const script = enc.script;
    if (!script || !script.parts || !script.parts.length) return;
    const p = state.players[state.localPlayerId];
    const boss2 = bossOf(state, enc);
    if (!boss2) {
      if (p && p.scriptSlow != null) delete p.scriptSlow;
      return;
    }
    const lv = state.level;
    const prog = scriptBook(lv, enc.id);
    const part = script.parts[prog.part];
    if (!part) return;
    prog.partT += dt;
    if (!prog.center) prog.center = { x: boss2.pos.x, z: boss2.pos.z };
    const last = prog.part >= script.parts.length - 1;
    if (part.hp && prog.hpFor !== prog.part) {
      prog.hpFor = prog.part;
      boss2.maxHp = part.hp;
      boss2.hp = part.hp;
    }
    boss2.boss.scripted = true;
    boss2.boss.attackList = Array.isArray(part.attacks) ? part.attacks : null;
    boss2.boss.attackScale = part.attacks && part.attacks.bolts === "half" ? 2 : 1;
    if (part.duelStage) boss2.boss.phaseIdx = part.duelStage - 1;
    if (p && p.scriptSlow != null) delete p.scriptSlow;
    if (!prog.specs) prog.specs = {};
    (part.targets || []).forEach((spec, i) => {
      if (prog.targets[spec.id]) return;
      const e = spawnTarget(state, enc, spec, boss2, p, i);
      prog.targets[spec.id] = e.id;
      prog.specs[spec.id] = spec;
    });
    if (part.immune && (part.targets || []).length) boss2.boss.invuln = targetsLeft(state, prog) > 0;
    else boss2.boss.invuln = !!part.immune && !(part.targets || []).length && prog.partT < (part.seconds || 0);
    boss2.boss.scriptHold = !part.immune && !last;
    (part.adds || []).forEach((add3, i) => {
      const key2 = `${part.id}:${i}`;
      if (prog.spawned[key2]) return;
      let ready = false;
      if (add3.t != null) ready = prog.partT >= add3.t;
      if (add3.on === "firstLoom" || add3.on === "firstTarget") ready = deadTargets(state, prog) >= 1;
      if (add3.on === "secondPylon" || add3.on === "secondTarget") ready = deadTargets(state, prog) >= 2;
      if (add3.onBossHp != null && boss2.maxHp > 0) ready = boss2.hp / boss2.maxHp * 100 <= add3.onBossHp;
      if (!ready) return;
      prog.spawned[key2] = true;
      for (const unit of add3.units || []) {
        const count = unit[1] || 1;
        for (let n = 0; n < count; n++) spawnAdd(state, enc, unit, boss2, add3.at, n, count);
      }
    });
    for (const id of Object.keys(prog.targets)) {
      const e = state.enemies.find((en) => en.id === prog.targets[id]);
      if (e && !e.dead && e.ai.riseT > 0) e.ai.riseT -= dt;
    }
    if (part.immune && (part.targets || []).length && targetsLeft(state, prog) > 0 && p) {
      const dx = p.pos.x - prog.center.x, dz = p.pos.z - prog.center.z;
      const d = Math.hypot(dx, dz) || 1;
      boss2.pos.x = prog.center.x - dx / d * 30;
      boss2.pos.z = prog.center.z - dz / d * 30;
      boss2.pos.y = part.perch != null ? part.perch : 6;
    }
    if (part.pit) applyField(state, p, prog.center, part.pit, dt);
    for (const pool of part.pools || []) applyField(state, p, prog.center, pool, dt);
    for (const vent2 of part.vents || []) {
      if (!vent2.period || (prog.partT + (vent2.offset || 0)) % vent2.period / vent2.period < 0.45) {
        applyField(state, p, prog.center, vent2, dt);
      }
    }
    if (part.ring && p) {
      const d = Math.hypot(p.pos.x - prog.center.x, p.pos.z - prog.center.z);
      const outside = d > part.ring;
      if (outside && !prog.outside) damagePlayer(state, p, { base: 12, sourceKind: "world", fromPos: { x: prog.center.x, y: 0, z: prog.center.z } });
      prog.outside = outside;
    } else prog.outside = false;
    const targetsDone = !(part.targets || []).length || (part.targets || []).every((spec) => {
      const e = state.enemies.find((en) => en.id === prog.targets[spec.id]);
      return !e || e.dead;
    });
    const barDone = !part.immune && (boss2.boss.barEmpty || boss2.dead);
    const timed = part.immune && !(part.targets || []).length && prog.partT >= (part.seconds || 0);
    if (!(targetsDone && part.immune) && !barDone && !timed) return;
    if (last && !part.immune) return;
    if (part.kind === "entry") {
      boss2.boss.stunT = 3;
      boss2.boss.action = { id: "stunned", t: 0 };
    }
    boss2.pos.x = prog.center.x;
    boss2.pos.z = prog.center.z;
    boss2.pos.y = 0;
    prog.part += 1;
    prog.partT = 0;
    prog.targets = {};
    boss2.boss.barEmpty = false;
    boss2.boss.invuln = false;
    const next2 = script.parts[prog.part];
    if (!next2) return;
    if (next2.hp) {
      boss2.maxHp = next2.hp;
      boss2.hp = next2.hp;
    }
  }

  // src/sim/campaign/duo.js
  var BARS = {
    obamaDuo: [578, 669, 760],
    midgetDuo: [684, 783, 852]
  };
  var PYLONS = ["sb.py1", "sb.py2", "sb.py3"];
  var BREAKERS = ["sb.cb1", "sb.cb2"];
  function book(lv, encId) {
    if (!lv.scripts) lv.scripts = {};
    if (!lv.scripts[encId]) lv.scripts[encId] = { part: 0, partT: 0, home: {} };
    return lv.scripts[encId];
  }
  function destroyed(lv, id) {
    return !!(lv.v2 && lv.v2.parts && lv.v2.parts[id]);
  }
  function tickDuo(state, enc, dt) {
    const parts = enc.parts;
    if (!parts || !parts.length) return;
    const bosses2 = [];
    for (const e of state.enemies) {
      if (!e.boss || e.campaignEnc !== enc.id || !BARS[e.type]) continue;
      if (e.dead && e.type !== "obamaDuo") continue;
      bosses2.push(e);
    }
    const living = bosses2.filter((e) => !e.dead);
    if (!living.length) return;
    const lv = state.level;
    const prog = book(lv, enc.id);
    const part = parts[prog.part];
    if (!part) return;
    prog.partT += dt;
    const obama = bosses2.find((e) => e.type === "obamaDuo");
    for (const b of living) {
      b.boss.scripted = true;
      if (!b.boss.bars) {
        b.boss.bars = BARS[b.type].slice();
        b.boss.bar = 0;
        b.maxHp = b.boss.bars[0];
        b.hp = b.maxHp;
        prog.home[b.id] = { x: b.pos.x, y: b.pos.y, z: b.pos.z };
      }
      const lastBar = b.boss.bar >= b.boss.bars.length - 1;
      if (b.boss.barEmpty && !lastBar) {
        b.boss.bar += 1;
        b.boss.barEmpty = false;
        b.maxHp = b.boss.bars[b.boss.bar];
        b.hp = b.maxHp;
        if (b.boss.bar >= 2) prog.held = true;
      }
      b.boss.phaseIdx = Math.min(2, b.boss.bar);
    }
    const midget = living.find((e) => e.type === "midgetDuo");
    let advance = false;
    if (part.kind === "entry") advance = PYLONS.every((id) => destroyed(lv, id));
    else if (part.kind === "intermission") advance = BREAKERS.every((id) => destroyed(lv, id));
    else if (part.kind === "double" && prog.part === 1) advance = living.some((b) => b.boss.bar >= 2);
    else if (part.kind === "double") advance = (!obama || obama.dead) && !!(midget && midget.boss.bar >= 2);
    else if (part.kind === "chase") advance = !midget;
    if (advance && prog.part < parts.length - 1) {
      prog.part += 1;
      prog.partT = 0;
    }
    const now = parts[prog.part];
    const shield = now && (now.kind === "entry" || now.kind === "intermission");
    for (const b of living) {
      const lastBar = b.boss.bar >= b.boss.bars.length - 1;
      const locked = b.type === "midgetDuo" && b.boss.bar >= 2 && obama && !obama.dead;
      if (shield && prog.home[b.id]) {
        const h = prog.home[b.id];
        b.pos.x = h.x;
        b.pos.y = h.y;
        b.pos.z = h.z;
        b.vel.x = 0;
        b.vel.y = 0;
        b.vel.z = 0;
        b.boss.invuln = true;
        b.boss.attackList = null;
        b.boss.scriptHold = false;
      } else if (locked) {
        b.boss.invuln = true;
        b.boss.scriptHold = false;
        b.boss.attackList = ["pigRain"];
      } else {
        b.boss.invuln = false;
        b.boss.scriptHold = !lastBar;
        b.boss.attackList = b.type === "midgetDuo" ? ["bolt", "fly", "blast"] : ["bolt", "blast"];
      }
    }
  }

  // src/sim/campaign/v2.js
  function book2(lv) {
    if (!lv.v2) lv.v2 = { enc: {}, parts: {}, doorOpen: {} };
    return lv.v2;
  }
  function encState(lv, id) {
    const v = book2(lv);
    if (!v.enc[id]) v.enc[id] = { started: false, t: 0, kills: 0, alive: 0, squads: {}, sealed: false };
    return v.enc[id];
  }
  function bindV2Section(state, sec) {
    const lv = state.level;
    const field2 = solidTerrain(sec);
    const geometry = field2 ? (sec.geometry || []).filter((g) => g.tag !== "terrainStandIn") : sec && sec.geometry;
    let solids = sec && sec.solids ? sec.solids.slice() : solidsFromGeometry(geometry);
    if (field2) solids.push(terrainSolid(field2));
    if (lv.brokenSolids) solids = solids.filter((s) => !lv.brokenSolids[s.id]);
    lv.solids = solids;
    lv.closedDoors = [];
    lv.useSolids = true;
  }
  function beginV2(state) {
    const lv = state.level;
    lv.format = "v2";
    lv.useSolids = true;
    book2(lv);
  }
  function squadKey(squad6, i) {
    return squad6.id || String(i);
  }
  function noteKills(state, enc, prog) {
    if (!prog.seen) prog.seen = {};
    for (const e of state.enemies) {
      if (!e.dead || e.dismissed || e.campaignEnc !== enc.id || prog.seen[e.id]) continue;
      prog.seen[e.id] = true;
      prog.kills++;
    }
  }
  function aliveOf(state, encId) {
    let n = 0;
    for (const e of state.enemies) if (!e.dead && e.campaignEnc === encId) n++;
    return n;
  }
  function unitOf(enc, type) {
    const size = enc && enc.flockUnit;
    if (size > 0 && type === "bitbug") return 1 / size;
    return 1;
  }
  function aliveUnits(state, enc) {
    let n = 0;
    for (const e of state.enemies) {
      if (e.dead || e.campaignEnc !== enc.id) continue;
      n += unitOf(enc, e.type);
    }
    return n;
  }
  function capOf(state, enc) {
    return enc.maxAlive || state.level.maxAlive || 8;
  }
  function roomFor(state, enc, type) {
    return aliveUnits(state, enc) + unitOf(enc, type) <= capOf(state, enc) + 1e-9;
  }
  function partClock(state, enc) {
    const book3 = state.level.scripts && state.level.scripts[enc.id];
    if (!book3) return null;
    return { n: (book3.part || 0) + 1, t: book3.partT || 0 };
  }
  function triggerReady(state, enc, squad6, prog) {
    const tr = squad6.trigger || { type: "onEnter" };
    if (tr.type === "onEnter") return prog.started;
    if (tr.type === "time") {
      if (tr.part != null) {
        const clock = partClock(state, enc);
        return !!clock && clock.n === tr.part && clock.t >= (tr.t || 0);
      }
      return prog.t >= (tr.t || 0);
    }
    if (tr.type === "onKills") return prog.kills >= (tr.n || 1);
    if (tr.type === "onRemain") {
      const byCount = prog.started && aliveOf(state, enc.id) <= (tr.n ?? 2) && Object.keys(prog.squads).length > 0;
      if (byCount) return true;
      const wait = waveWait(enc, squad6);
      if (wait == null || wait <= 0 || !prog.started) return false;
      const keys2 = Object.keys(prog.squads);
      if (!keys2.length) return false;
      const last = prog.squads[keys2[keys2.length - 1]];
      if (prog.t - (last.at || 0) < wait) return false;
      for (let i = 0; i < (enc.squads || []).length; i++) {
        const sq = enc.squads[i];
        if (prog.squads[squadKey(sq, i)]) continue;
        return sq === squad6;
      }
      return false;
    }
    if (tr.type === "onAlert") {
      const p = state.players[state.localPlayerId];
      if (!p) return false;
      if (tr.zBelow != null && p.pos.z < tr.zBelow) return true;
      if (tr.zAbove != null && p.pos.z > tr.zAbove) return true;
      if (tr.box && inBox(tr.box, p.pos.x, p.pos.y, p.pos.z)) return true;
      for (const e of state.enemies) {
        if (!e.dead && e.campaignEnc === enc.id && e.ai && e.ai.alert === "alerted") return true;
      }
      return false;
    }
    if (tr.type === "onHold") return (prog.hold || 0) >= (tr.p || 0);
    if (tr.type === "onBossHp") {
      for (const e of state.enemies) {
        if (e.dead || !e.boss || e.campaignEnc !== enc.id) continue;
        return e.hp / e.maxHp * 100 <= (tr.p ?? 100);
      }
      return false;
    }
    if (tr.type === "onPartDestroyed") return !!book2(state.level).parts[tr.id];
    if (tr.type === "with") {
      const prev = prog.squads[tr.after];
      return !!prev && prog.t - prev.at >= (tr.delay || 0);
    }
    if (tr.type === "onAlarm") {
      const at2 = state.level.alarms && state.level.alarms[tr.alarm];
      if (at2 == null) return false;
      const delay = squad6.delay != null ? squad6.delay : tr.delay || 0;
      return (state.level.time || 0) - at2 >= delay;
    }
    return false;
  }
  function ringAlarm(state, id) {
    if (!id) return;
    const lv = state.level;
    if (lv.alarmsCut && lv.alarmsCut[id]) return;
    if (!lv.alarms) lv.alarms = {};
    if (lv.alarms[id] != null) return;
    lv.alarms[id] = lv.time || 0;
    emit(state, "alarm", { id });
  }
  function waveWait(enc, squad6) {
    if (squad6 && squad6.fallbackSec != null) return squad6.fallbackSec;
    const lock = enc.lockdown;
    if (!lock) return null;
    if (lock.waveSec != null) return lock.waveSec;
    if (lock.fallbackSec != null) return lock.fallbackSec;
    return null;
  }
  function spawnOne(state, enc, squad6, at2) {
    const type = at2.type;
    const pos = at2.pos;
    const bossDef = BOSSES[type];
    const e = bossDef ? createBoss(state, type, { pos: { x: pos[0], z: pos[2] } }) : createEnemy(state, type, { elite: !!at2.elite, pos: { x: pos[0], z: pos[2] } });
    e.pos.y = pos[1] || 0;
    e.campaignEnc = enc.id;
    e.spawnMethod = squad6.method || "placed";
    if (enc.noAmmoDrop) e.noAmmoDrop = true;
    if (at2.partId) e.partId = at2.partId;
    if (at2.flockPart != null) e.flockPart = at2.flockPart;
    if (at2.role) e.role = at2.role;
    if (at2.alarm) e.alarm = at2.alarm;
    if (at2.ringsAlarm) e.ringsAlarm = at2.ringsAlarm;
    if (at2.asleep) {
      e.ai.alert = "asleep";
      e.ai.hearing = at2.hearing || 12;
    }
    if (bossDef) {
      if (state.mode === "campaign" && type === "monster") equipAuditorPlates(e, state.tier);
      if (enc.arena) e.boss.arena = enc.arena;
      if (at2.name) e.boss.displayName = at2.name;
      emit(state, "bossSpawn", { id: e.id, bossType: type });
    }
    return e;
  }
  function trySpawn(state, enc, squad6, key2) {
    const lv = state.level;
    const prog = encState(lv, enc.id);
    const spots = [];
    let i = 0;
    const flockPart = squad6.trigger && squad6.trigger.part != null ? squad6.trigger.part : null;
    for (const u4 of squad6.units || []) {
      for (let n = 0; n < u4.count; n++) {
        const at2 = squad6.at && squad6.at[Math.min(i, squad6.at.length - 1)] || [0, 0, 0];
        spots.push({
          type: u4.type,
          pos: at2,
          partId: u4.partId || null,
          elite: !!u4.elite,
          flockPart,
          role: u4.role || null,
          alarm: u4.alarm || null,
          ringsAlarm: squad6.ringsAlarm || u4.ringsAlarm || null,
          name: u4.name || null,
          asleep: !!(squad6.asleep || u4.asleep),
          hearing: squad6.hearing || u4.hearing || null
        });
        i++;
      }
    }
    const born = [];
    for (const spot of spots) {
      if (!roomFor(state, enc, spot.type)) {
        prog.queue = prog.queue || [];
        prog.queue.push({ encId: enc.id, squad: key2, spot, part: spot.flockPart });
        continue;
      }
      born.push(spawnOne(state, enc, squad6, spot));
    }
    prog.squads[key2] = { at: prog.t, count: spots.length };
    emit(state, "squadSpawn", { encounter: enc.id, squad: key2, method: squad6.method || "placed", count: born.length });
  }
  function doorBox(m) {
    if (!m || !m.at) return null;
    return solidFromPrimitive({
      kind: "box",
      id: m.id,
      at: m.at,
      size: m.size || [0.6, 3.2, 3.2]
    });
  }
  function pointInside(solid, x, y, z) {
    return x >= solid.min[0] && x <= solid.max[0] && y >= solid.min[1] && y <= solid.max[1] && z >= solid.min[2] && z <= solid.max[2];
  }
  function pushClear(p, solid, toward) {
    const y = p.pos.y + 1;
    if (!pointInside(solid, p.pos.x, y, p.pos.z)) return true;
    const cx = (solid.min[0] + solid.max[0]) / 2;
    const cz = (solid.min[2] + solid.max[2]) / 2;
    const tx = toward[0] - cx;
    const tz = toward[2] - cz;
    if (Math.abs(tx) >= Math.abs(tz)) p.pos.x = tx >= 0 ? solid.max[0] + 0.45 : solid.min[0] - 0.45;
    else p.pos.z = tz >= 0 ? solid.max[2] + 0.45 : solid.min[2] - 0.45;
    return !pointInside(solid, p.pos.x, y, p.pos.z);
  }
  function switchedDoorIds(sec) {
    const ids = {};
    for (const m of sec && sec.mechanisms || []) {
      if ((m.kind === "switch" || m.kind === "conduit") && m.opens) ids[m.opens] = true;
    }
    return ids;
  }
  function refreshDoors(state, sec) {
    const lv = state.level;
    const switched = switchedDoorIds(sec);
    const sealed = {};
    for (const enc of sec && sec.encounters || []) {
      const prog = encState(lv, enc.id);
      if (!enc.lockdown || !prog.sealed) continue;
      if (enc.lockdown.entry) sealed[enc.lockdown.entry] = enc;
      if (enc.lockdown.exit && !enc.lockdown.noExit) sealed[enc.lockdown.exit] = enc;
    }
    const doors = [];
    for (const m of sec && sec.mechanisms || []) {
      if (m.kind !== "door") continue;
      if (m.opens === "p.jet.has") {
        const who = state.players[state.localPlayerId];
        if (!who || !who.jetpack) {
          const gate = doorBox(m);
          if (gate) doors.push(gate);
        }
        continue;
      }
      if (!sealed[m.id] && !(switched[m.id] && !lv.got[m.id])) continue;
      const box3 = doorBox(m);
      if (box3) doors.push(box3);
    }
    lv.closedDoors = doors;
  }
  function seal(state, sec, enc) {
    const prog = encState(state.level, enc.id);
    if (prog.sealed || !enc.lockdown) return;
    const p = state.players[state.localPlayerId];
    const entry = (sec.mechanisms || []).find((m) => m.kind === "door" && m.id === enc.lockdown.entry);
    const box3 = doorBox(entry);
    if (box3 && prog.sealDelay && p) {
      const act = enc.activate;
      const toward = act ? [
        (act.min[0] + act.max[0]) / 2,
        0,
        (act.min[2] + act.max[2]) / 2
      ] : [p.pos.x, 0, p.pos.z];
      if (!pushClear(p, box3, toward)) return;
    }
    prog.sealed = true;
    prog.sealWait = 0;
    refreshDoors(state, sec);
    emit(state, "lockdown", { encounter: enc.id, sealed: true });
  }
  function unseal(state, enc) {
    const prog = encState(state.level, enc.id);
    if (!prog.sealed) return;
    prog.sealed = false;
    refreshDoors(state, state._v2section);
    emit(state, "lockdown", { encounter: enc.id, sealed: false });
  }
  function lockdownDelay(enc) {
    if (!enc.lockdown) return 0;
    if (enc.lockdown.delaySec != null) return enc.lockdown.delaySec;
    return enc.lockdown.waveSec ? 1 : 0;
  }
  function considerSeal(state, sec, enc, prog, dt) {
    if (!enc.lockdown || prog.sealed || lvCleared(state, enc)) return;
    const p = state.players[state.localPlayerId];
    const inside = enc.lockdown.threshold && inBox(enc.lockdown.threshold, p.pos.x, p.pos.y, p.pos.z);
    if (!inside && !(prog.sealWait > 0)) return;
    const delay = lockdownDelay(enc);
    if (delay <= 0) {
      seal(state, sec, enc);
      return;
    }
    if (!(prog.sealWait > 0)) {
      prog.sealWait = delay;
      prog.sealDelay = true;
    }
    prog.sealWait -= dt;
    if (prog.sealWait <= 0) seal(state, sec, enc);
  }
  function lvCleared(state, enc) {
    return !!(state.level.cleared && state.level.cleared[enc.id]);
  }
  function v2Pre(state, dt) {
    const lv = state.level;
    const rt = state._v2section;
    if (!rt) return;
    const p = state.players[state.localPlayerId];
    refreshDoors(state, rt);
    for (const enc of rt.encounters || []) {
      const prog = encState(lv, enc.id);
      if (!prog.started) {
        const box3 = enc.activate || enc.zone;
        if (box3 && inBox(box3, p.pos.x, p.pos.y, p.pos.z)) {
          prog.started = true;
          lv.spawned[enc.id] = true;
        }
      }
      if (!prog.started || lv.cleared[enc.id]) continue;
      noteKills(state, enc, prog);
      considerSeal(state, rt, enc, prog, dt);
      prog.t += dt;
      if (wantsHold(enc) && enc.hold && bodyIn(state, enc.hold)) {
        const rushed = enc.objective && enc.objective.also && enc.objective.also.kind === "hold" && wavesClear(state, enc, prog);
        prog.hold = (prog.hold || 0) + dt * (rushed ? 3 : 1);
      }
      tickStrikes(state, enc, prog, dt);
      (enc.squads || []).forEach((squad6, i) => {
        const key2 = squadKey(squad6, i);
        if (prog.squads[key2]) return;
        if (!triggerReady(state, enc, squad6, prog)) return;
        trySpawn(state, enc, squad6, key2);
      });
      if (prog.queue && prog.queue.length) {
        const job = prog.queue[0];
        const clock = partClock(state, enc);
        if (job.part != null && clock && clock.n !== job.part) prog.queue.shift();
        else if (roomFor(state, enc, job.spot.type)) {
          prog.queue.shift();
          const squad6 = (enc.squads || []).find((s, i) => squadKey(s, i) === job.squad) || { method: "door" };
          spawnOne(state, enc, squad6, job.spot);
        }
      }
    }
  }
  function retirePartSquads(state, enc, prog) {
    const clock = partClock(state, enc);
    if (!clock) return;
    if (prog.partSeen == null) {
      prog.partSeen = clock.n;
      return;
    }
    if (prog.partSeen === clock.n) return;
    const ended = prog.partSeen;
    prog.partSeen = clock.n;
    (enc.squads || []).forEach((squad6, i) => {
      if (!squad6.trigger || squad6.trigger.part !== ended) return;
      const key2 = squadKey(squad6, i);
      if (!prog.squads[key2]) prog.squads[key2] = { at: prog.t, count: 0, skipped: true };
    });
    if (prog.queue) prog.queue = prog.queue.filter((job) => job.part !== ended);
    for (const e of state.enemies) {
      if (e.dead || e.campaignEnc !== enc.id || e.flockPart !== ended) continue;
      e.dead = true;
      e.hp = 0;
      e.dismissed = true;
    }
  }
  function wantsHold(enc) {
    const obj = enc.objective;
    if (!obj) return false;
    if (obj.kind === "hold") return true;
    return !!(obj.also && obj.also.kind === "hold");
  }
  function bodyIn(state, box3) {
    const p = state.players[state.localPlayerId];
    if (p && !p.dead && inBox(box3, p.pos.x, p.pos.y, p.pos.z)) return true;
    for (const a of state.allies || []) {
      if (a && !a.dead && a.pos && inBox(box3, a.pos.x, a.pos.y, a.pos.z)) return true;
    }
    return false;
  }
  function wavesClear(state, enc, prog) {
    const accounted = (enc.squads || []).every((sq, i) => prog.squads[squadKey(sq, i)] || sq.optional);
    return !!(prog.started && accounted && aliveOf(state, enc.id) === 0 && !(prog.queue && prog.queue.length));
  }
  var STRIKE = { radius: 2.6, track: 1.8, lock: 0.75, player: 30, enemy: 120 };
  function strikeDue(enc, n) {
    const times = enc.strikes || [];
    if (!times.length || n < 0) return Infinity;
    if (n < times.length) return times[n];
    return times[times.length - 1] + (n - times.length + 1) * (enc.strikeEvery || 14);
  }
  function tickStrikes(state, enc, prog, dt) {
    if (!enc.strikes || !enc.strikes.length) return;
    if (prog.strikeN == null) prog.strikeN = 0;
    if (prog.inbound) {
      prog.inbound.t += dt;
      const p = state.players[state.localPlayerId];
      const tracking = enc.strikeTrack != null ? enc.strikeTrack : STRIKE.track;
      if (p && prog.inbound.t < tracking) {
        prog.inbound.x = p.pos.x;
        prog.inbound.z = p.pos.z;
      }
      const track = enc.strikeTrack != null ? enc.strikeTrack : STRIKE.track;
      const lock = enc.strikeLock != null ? enc.strikeLock : STRIKE.lock;
      if (prog.inbound.t >= track + lock) {
        const hit = prog.inbound;
        const pNow = state.players[state.localPlayerId];
        if (pNow && !pNow.dead && Math.hypot(pNow.pos.x - hit.x, pNow.pos.z - hit.z) <= STRIKE.radius) {
          damagePlayer(state, pNow, { base: STRIKE.player, sourceKind: "world", fromPos: { x: hit.x, y: 0, z: hit.z } });
        }
        for (const e of state.enemies) {
          if (e.dead || Math.hypot(e.pos.x - hit.x, e.pos.z - hit.z) > STRIKE.radius) continue;
          e.hp -= STRIKE.enemy;
          if (e.hp <= 0) {
            e.hp = 0;
            e.dead = true;
          }
        }
        emit(state, "droneStrike", { x: hit.x, z: hit.z, encounter: enc.id });
        prog.inbound = null;
      }
    }
    if (!prog.inbound && prog.t >= strikeDue(enc, prog.strikeN)) {
      const p = state.players[state.localPlayerId];
      prog.inbound = { t: 0, x: p ? p.pos.x : 0, z: p ? p.pos.z : 0 };
      prog.strikeN += 1;
    }
  }
  function objectiveDone(state, enc, prog) {
    const kind = enc.objective && enc.objective.kind || "clearAll";
    if (kind === "clearAll" || kind === "boss") {
      const waves = wavesClear(state, enc, prog);
      const also = enc.objective && enc.objective.also;
      if (also && also.kind === "hold") return waves && (prog.hold || 0) >= (also.seconds || 1);
      return waves;
    }
    if (kind === "reach" || kind === "escape" || kind === "switch") {
      const p = state.players[state.localPlayerId];
      return !!(enc.zone && inBox(enc.zone, p.pos.x, p.pos.y, p.pos.z));
    }
    if (kind === "hold" || kind === "survive" || kind === "capture") return (prog.hold || 0) >= (enc.objective && enc.objective.seconds || 1);
    if (kind === "destroy") {
      const ids = enc.objective && enc.objective.ids || [];
      return ids.length > 0 && ids.every((id) => book2(state.level).parts[id]);
    }
    if (kind === "escort") return (prog.hold || 0) >= (enc.objective && enc.objective.seconds || 1);
    return false;
  }
  function markPartDestroyed(state, id) {
    book2(state.level).parts[id] = true;
    emit(state, "partDestroyed", { id });
  }
  function v2Post(state, dt) {
    const lv = state.level;
    const sec = state._v2section;
    if (!sec) return;
    const p = state.players[state.localPlayerId];
    for (const enc of sec.encounters || []) {
      const prog = encState(lv, enc.id);
      if (!prog.started || lv.cleared[enc.id]) continue;
      tickBossScript(state, enc, dt);
      tickDuo(state, enc, dt);
      retirePartSquads(state, enc, prog);
      noteKills(state, enc, prog);
      if (enc.fleeAt) {
        for (const e of state.enemies) {
          if (e.dead || e.campaignEnc !== enc.id || !e.boss) continue;
          if (e.hp / e.maxHp > enc.fleeAt) continue;
          e.dead = true;
          e.fled = true;
          if (!lv.fled) lv.fled = {};
          lv.fled[enc.id] = true;
          const flag = `${enc.id}.fled`;
          for (const m of sec && sec.mechanisms || []) {
            if (m.opens === flag) lv.got[m.id] = true;
          }
          emit(state, "bossEscape", { id: e.id, bossType: e.type });
        }
      }
      if (enc.lockdown && enc.lockdown.stallSec && prog.sealed && !lv.cleared[enc.id]) {
        const left = [];
        for (const e of state.enemies) if (!e.dead && e.campaignEnc === enc.id) left.push(e);
        if (left.length > 0 && left.length <= (enc.lockdown.stallN || 2)) prog.stall = (prog.stall || 0) + dt;
        else prog.stall = 0;
        if ((prog.stall || 0) >= enc.lockdown.stallSec) {
          for (const e of left) {
            e.ai.charge = true;
            e.marked = true;
          }
        }
      }
      if (objectiveDone(state, enc, prog)) {
        lv.cleared[enc.id] = true;
        unseal(state, enc);
        emit(state, "encounterClear", { id: enc.id });
      }
    }
    if (p.dead) {
      let rewind = null;
      for (const enc of sec.encounters || []) {
        if (enc.lockdown && encState(lv, enc.id).sealed && !lv.cleared[enc.id]) rewind = enc.id;
      }
      if (rewind) {
        lv._rewind = rewind;
        return;
      }
      lv.lost = true;
      emit(state, "levelLost", { level: lv.id });
      return;
    }
    const rt = state._v2runtime;
    if (sec.exit && (sec.encounters || []).every((e) => lv.cleared[e.id]) && inBox(sec.exit, p.pos.x, p.pos.y, p.pos.z)) {
      const next2 = rt.sections[rt.sections.indexOf(sec) + 1];
      if (next2 && !lv.transition) {
        lv.transition = { to: next2.id, kind: "seamless", card: null };
        emit(state, "sectionExit", { from: sec.id, to: next2.id });
      }
    }
    let all = true;
    for (const s of rt.sections) for (const e of s.encounters || []) if (!lv.cleared[e.id]) all = false;
    if (all && rt.sections.length) {
      lv.won = true;
      lv.objective = "Level clear";
      emit(state, "levelClear", { level: lv.id, time: lv.time, par: lv.parTime });
    } else {
      const open = (sec.encounters || []).find((e) => !lv.cleared[e.id]);
      lv.objective = open ? open.lockdown && encState(lv, open.id).sealed ? `LOCKDOWN ${open.id}` : `Clear ${sec.name}` : `Exit: ${sec.name}`;
    }
    void dt;
  }
  function noteV2Section(state, sec, rt) {
    state._v2section = sec;
    state._v2runtime = rt;
    state.level.useNav = !!(sec && sec.navBounds);
    state.level.navBounds = sec && sec.navBounds;
    state.level.flyerVolume = sec && sec.flyerVolume;
    const lids = [];
    for (const enc of sec && sec.encounters || []) {
      const room2 = enc.lockdown && enc.lockdown.room;
      if (room2) lids.push(room2);
      if (enc.lid) lids.push(enc.lid);
    }
    if (lids.length) state.level.flyerLids = lids;
    else if (state.level.flyerLids) delete state.level.flyerLids;
    if (sec && sec.navLinks) state.level.navLinks = sec.navLinks;
    else if (state.level.navLinks) delete state.level.navLinks;
    if (sec && sec.voids && sec.voids.length) state.level.voids = sec.voids;
    else if (state.level.voids) delete state.level.voids;
    if (sec && sec.noGrapple && sec.noGrapple.length) state.level.noGrapple = sec.noGrapple;
    else if (state.level.noGrapple) delete state.level.noGrapple;
    if (sec && sec.grappleAnchors && sec.grappleAnchors.length) state.level.grappleAnchors = sec.grappleAnchors;
    else if (state.level.grappleAnchors) delete state.level.grappleAnchors;
    if (sec) bindV2Section(state, sec);
  }

  // src/sim/combat.js
  function healPlayer(p, amount) {
    if (p.dead) return 0;
    const before = p.hp;
    p.hp = Math.min(p.maxHp, p.hp + amount);
    return p.hp - before;
  }
  function damageEnemy(state, e, hit) {
    if (e.dead || e.state === "spawning" || e.boss && e.boss.invuln || e.ai && (e.ai.buried > 0 || e.ai.audit || e.ai.riseT > 0)) return 0;
    let dmg = hit.base;
    const p = state.players[hit.sourceId];
    if (p) {
      if (hit.sourceKind === "spell" && state.tier > 1) dmg *= Math.pow(1.15, state.tier - 1);
    }
    const isWeak = hit.zone === "weak";
    if (isWeak) {
      const override = !e.boss && ENEMIES[e.type].weakMultOverride;
      dmg *= Math.max(hit.critMult ?? 2, override || 0);
      if (e.boss && e.boss.action.id === "stunned") dmg *= 1.5;
    }
    const isCrit = !!hit.canCrit && float(state.rng) < (hit.critChance ?? 0.05);
    if (isCrit) dmg *= 1.5;
    if (hit.zone === "shield") dmg *= 0.1;
    if (e.type === "bigObama") {
      if (hit.isSplash) dmg *= 1.5;
      if (hit.pellet) dmg *= 1.3;
    }
    dmg *= archetypeDamageMul(e, p ? p.pos : null);
    const el = hit.element || "none";
    if (el !== "none") {
      if (e.affinity.weak === el) dmg *= 1.5;
      if (e.affinity.resist === el) dmg *= 0.5;
    }
    const taken = sourceTakenMul(e, hit);
    if (taken <= 0) return 0;
    dmg *= taken;
    dmg = Math.max(1, Math.round(dmg));
    const plated = applyPlates(state, e, hit, dmg);
    if (plated != null) {
      const soaked = dmg - plated;
      if (p && soaked > 0) state.run.damageDealt += soaked;
      if (plated <= 0) {
        e.hitFlash = 0.08;
        emit(state, "damage", {
          sourceId: hit.sourceId,
          targetId: e.id,
          amount: dmg,
          element: el,
          isCrit: false,
          isWeak: false,
          zone: "plate",
          pos: hit.point,
          sourceKind: hit.sourceKind,
          killed: false,
          pellet: !!hit.pellet
        });
        return dmg;
      }
      dmg = plated;
    }
    if (e.type === "dummy" && state.tuning.dummyInfinite) e.hp = e.maxHp + dmg;
    if (e.boss && e.boss.scriptHold && e.hp - dmg <= 0) {
      const dealt = Math.max(0, e.hp - 1);
      e.hp = 1;
      e.boss.barEmpty = true;
      e.hitFlash = 0.08;
      e.lastHit = { sourceId: hit.sourceId, sourceKind: hit.sourceKind, element: el, isCrit, isWeak, gunId: hit.gunId ?? null, wacky: hit.wacky ?? null };
      if (p) {
        state.run.damageDealt += dealt;
        state.run.bestHit = Math.max(state.run.bestHit, dealt);
      }
      emit(state, "damage", {
        sourceId: hit.sourceId,
        targetId: e.id,
        amount: dealt,
        element: el,
        isCrit,
        isWeak,
        zone: hit.zone,
        pos: hit.point || { x: e.pos.x, y: e.pos.y + 1, z: e.pos.z },
        sourceKind: hit.sourceKind,
        killed: false,
        pellet: !!hit.pellet
      });
      return dealt;
    }
    e.hp -= dmg;
    e.poise += dmg;
    e.hitFlash = 0.08;
    if (e.type === "dummy") e.ai.regenT = 2;
    e.lastHit = { sourceId: hit.sourceId, sourceKind: hit.sourceKind, element: el, isCrit, isWeak, gunId: hit.gunId ?? null, wacky: hit.wacky ?? null };
    if (hit.wacky === "bigHead") e.bigHeadT = 6;
    const killed = e.hp <= 0;
    if (p) {
      state.run.damageDealt += dmg;
      state.run.bestHit = Math.max(state.run.bestHit, dmg);
      if (isCrit) state.run.crits++;
      if (isWeak) state.run.weakHits++;
    }
    emit(state, "damage", {
      sourceId: hit.sourceId,
      targetId: e.id,
      amount: dmg,
      element: el,
      isCrit,
      isWeak,
      zone: hit.zone,
      pos: hit.point || { x: e.pos.x, y: e.pos.y + entityDef(e).height * e.scale * 0.8, z: e.pos.z },
      sourceKind: hit.sourceKind,
      killed,
      pellet: !!hit.pellet
    });
    if (!hit.noProc && el !== "none" && float(state.rng) < (hit.elementChance ?? 0)) applyElementProc(state, e, hit, dmg);
    if (p && p.perks.lifesteal && !p.downed && p.lifestealBudget > 0) {
      const h = Math.min(dmg * 0.02, p.lifestealBudget);
      p.lifestealBudget -= h;
      healPlayer(p, h);
    }
    if (hit.wacky === "critSproto" && isWeak && p && state.allies.length < 12) spawnAlly(state, p, e.pos, "gun");
    if (!e.boss && e.type !== "dummy" && !killed && e.poise >= e.poiseMax) {
      e.state = "stagger";
      e.stateT = 0;
      e.poise = 0;
      emit(state, "stagger", { targetId: e.id });
    }
    if (killed) onEnemyKilled(state, e);
    return dmg;
  }
  function applyElementProc(state, e, hit, dmg) {
    const def = ELEMENTS_BY_ID[hit.element];
    if (!def || !def.proc) return;
    const pot = hit.arcane ? 1.5 : 1;
    if (def.proc.kind === "burn") {
      const dps = dmg * def.proc.dpsFrac * pot;
      if (!e.status.burn || e.status.burn.dps < dps) e.status.burn = { t: def.proc.duration, dps, sourceId: hit.sourceId };
      else e.status.burn.t = def.proc.duration;
    } else if (def.proc.kind === "slow") {
      const b = e.boss ? 0.5 : 1;
      e.status.goo = { t: def.proc.duration * pot * b, slow: def.proc.slow * b };
    } else if (def.proc.kind === "chain") {
      const hitSet = { [e.id]: true };
      let from = e;
      for (let i = 0; i < def.proc.targets; i++) {
        const n = nearestEnemy(state, from.pos, def.proc.range, hitSet);
        if (!n) break;
        hitSet[n.id] = true;
        emit(state, "tracer", { from: centerOf(from), to: centerOf(n), element: "shock", zap: true });
        damageEnemy(state, n, { sourceId: hit.sourceId, sourceKind: hit.sourceKind, base: dmg * def.proc.dmgFrac * pot, element: "shock", zone: "body", noProc: true });
        from = n;
      }
    }
    emit(state, "statusApplied", { targetId: e.id, status: def.proc.kind, pos: centerOf(e) });
  }
  function centerOf(e) {
    const def = entityDef(e);
    return { x: e.pos.x, y: e.pos.y + (e.type === "hexAuditor" ? 0 : def.height * e.scale * 0.55), z: e.pos.z };
  }
  function nearestEnemy(state, pos, range2, exclude = null) {
    let best = null, bd = range2;
    for (const o of state.enemies) {
      if (o.dead || o.state === "spawning" || exclude && exclude[o.id]) continue;
      const d = Math.hypot(o.pos.x - pos.x, o.pos.z - pos.z);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }
  function onEnemyKilled(state, e) {
    if (e.dead) return;
    e.dead = true;
    e.hp = 0;
    const lh = e.lastHit || {};
    const killer = state.players[lh.sourceId];
    emit(state, "kill", {
      victimId: e.id,
      victimType: e.type,
      elite: e.elite,
      bossTag: e.boss ? e.boss.tag : null,
      killerId: lh.sourceId ?? null,
      sourceKind: lh.sourceKind ?? null,
      element: lh.element ?? "none",
      wasCrit: !!lh.isCrit,
      wasWeak: !!lh.isWeak,
      pos: centerOf(e),
      tier: e.tier,
      summoned: e.summoned,
      isDummy: e.type === "dummy"
    });
    if (e.partId) markPartDestroyed(state, e.partId);
    const split = ENEMIES[e.type] && ENEMIES[e.type].split;
    if (split) {
      for (let i = 0; i < 2; i++) {
        const baby = createEnemy(state, split, { pos: { x: e.pos.x + (i === 0 ? -0.6 : 0.6), z: e.pos.z }, summoned: true });
        baby.campaignEnc = e.campaignEnc;
        baby.state = "chase";
      }
    }
    if (e.type === "dummy") return;
    state.run.kills++;
    if (e.elite) state.run.eliteKills++;
    if (e.boss) {
      state.run.bossKills++;
      emit(state, "bossDefeated", { id: e.id, bossType: e.type });
    }
    for (const pid of Object.keys(state.players)) {
      const p2 = state.players[pid];
      if (p2.perks.killFrenzy && killer === p2) {
        p2.buffs.killFrenzy.stacks = Math.min(10, p2.buffs.killFrenzy.stacks + 1);
        p2.buffs.killFrenzy.t = 4;
      }
      if (p2.downed && !p2.dead) revivePlayer(state, p2);
    }
    if (lh.wacky === "confettiKill") {
      explode(state, centerOf(e), { radius: 4, damage: 40, minFalloff: 0.4, selfMult: 0, knockback: 6 }, lh.sourceId, "none", "splash", true);
    }
    const blast = archetypeDeathBlast(e);
    if (blast && e.ai && !e.ai.blasted) {
      e.ai.blasted = true;
      explode(state, centerOf(e), { radius: blast.radius, damage: blast.damage, minFalloff: 0.4, selfMult: 0, knockback: 4 }, lh.sourceId || 0, "fire", "world");
    }
    const p = state.players[state.localPlayerId];
    const ctx = { elite: e.elite, tier: e.tier, playerGunTypes: p.guns.filter((g) => g && !GUN_TYPES_BY_ID[g.type].bossOnly).map((g) => g.ammoType), summoned: e.summoned, boss: !!e.boss, arena: state.mode === "waves" || state.mode === "boss" };
    if (!e.noAmmoDrop) {
      const specs = rollDrops(state.rng, e.type, ctx);
      spawnDrops(state, specs, centerOf(e));
    }
  }
  function revivePlayer(state, p) {
    p.downed = false;
    p.downedT = 0;
    p.hp = Math.max(p.hp, p.maxHp * TUNING.reviveHpFrac);
    p.shield = p.maxShield;
    p.invulnT = TUNING.reviveInvuln;
    emit(state, "playerRevived", { playerId: p.id });
  }
  var GOD_HP = 99;
  function damagePlayer(state, p, hit) {
    if (p.invulnT > 0 || p.dead) return 0;
    if (state.mode === "sandbox" && hit.sourceKind === "boss") {
      const from2 = hit.fromPos;
      emit(state, "playerDamaged", {
        playerId: p.id,
        amount: 0,
        toShield: 0,
        toHealth: 0,
        absorbed: 0,
        sourceKind: "boss",
        noDamage: true,
        dir: from2 ? Math.atan2(from2.x - p.pos.x, from2.z - p.pos.z) : null
      });
      return 0;
    }
    let dmg = hit.base * (hit.sourceKind === "self" ? 1 : state.tuning.enemyDmgMult);
    dmg *= 1 - 0.03 * (p.skills.health.level - 1);
    let absorbed = 0;
    if (p.spells.manaShieldOn && p.mana > 0) {
      const absorb = Math.min(dmg * 0.6, p.mana * 1.5);
      p.mana -= absorb / 1.5;
      dmg -= absorb;
      absorbed = absorb;
    }
    const toShield = Math.min(p.shield, dmg);
    p.shield -= toShield;
    dmg -= toShield;
    if (toShield > 0 && p.shield <= 0.01) emit(state, "shieldBroken", { playerId: p.id });
    let toHealth = dmg;
    if (state.tuning.godMode) toHealth = Math.max(0, Math.min(toHealth, p.hp - Math.min(GOD_HP, p.maxHp)));
    if (p.hp - toHealth <= 0) {
      if (p.perks.unkillable && !p.unkillableUsed && !p.downed) {
        p.unkillableUsed = true;
        toHealth = p.hp - 1;
        p.invulnT = 3;
        emit(state, "unkillableTriggered", { playerId: p.id });
      } else if (!p.downed) {
        toHealth = p.hp;
        p.hp = 0;
        startDowned(state, p);
        toHealth = 0;
      } else toHealth = 0;
    }
    p.hp -= toHealth;
    p.lastDamageT = 0;
    p.shieldDelayT = p.perks.quickShield ? TUNING.quickShieldDelay : TUNING.shieldDelay;
    state.run.damageTaken += toShield + toHealth;
    const from = hit.fromPos;
    emit(state, "playerDamaged", {
      playerId: p.id,
      amount: toShield + toHealth,
      toShield,
      toHealth,
      absorbed,
      sourceKind: hit.sourceKind,
      dir: from ? Math.atan2(from.x - p.pos.x, from.z - p.pos.z) : null
    });
    return toShield + toHealth;
  }
  function startDowned(state, p) {
    p.downed = true;
    if (state.mode === "campaign") p.downedT = TUNING.secondWindTime;
    else {
      const downs = p.downCount || 0;
      p.downedT = secondWindTime(TUNING.secondWindTime, downs);
      p.downCount = downs + 1;
    }
    p.spells.manaShieldOn = false;
    emit(state, "playerDowned", { playerId: p.id });
  }
  function knockPlayer(p, from, strength, up = 3) {
    const dx = p.pos.x - from.x, dz = p.pos.z - from.z;
    const d = Math.hypot(dx, dz) || 1;
    p.vel.x += dx / d * strength;
    p.vel.z += dz / d * strength;
    p.vel.y = Math.max(p.vel.y, up);
    p.onGround = false;
  }
  function explode(state, pos, splash, ownerId, element = "none", sourceKind = "splash", noProc = false, extra = {}) {
    for (const e of state.enemies) {
      if (e.dead || e.state === "spawning") continue;
      const def = entityDef(e);
      const d = e.type === "hexAuditor" ? distToCapsule(pos, e.pos.x, e.pos.z, e.pos.y - 1.3, e.pos.y + 1.3, def.radius) : distToCapsule(pos, e.pos.x, e.pos.z, e.pos.y, e.pos.y + def.height * e.scale, def.radius * e.scale);
      if (d > splash.radius) continue;
      const f = 1 + (splash.minFalloff - 1) * (d / splash.radius);
      damageEnemy(state, e, {
        sourceId: ownerId,
        sourceKind,
        base: splash.damage * f,
        isSplash: true,
        zone: "body",
        element,
        elementChance: extra.elementChance ?? (element !== "none" ? 1 : 0),
        canCrit: false,
        noProc,
        arcane: extra.arcane,
        wacky: extra.wacky
      });
      if (!e.boss && e.type !== "bigObama" && e.type !== "dummy" && !e.dead) {
        const dx = e.pos.x - pos.x, dz = e.pos.z - pos.z, dd = Math.hypot(dx, dz) || 1;
        e.vel.x += dx / dd * splash.knockback * f;
        e.vel.z += dz / dd * splash.knockback * f;
      }
    }
    const owner = state.players[ownerId];
    if (owner && splash.selfMult > 0) {
      const top = owner.pos.y + 1.8;
      const cy = Math.max(owner.pos.y, Math.min(top, pos.y));
      const d = Math.hypot(pos.x - owner.pos.x, pos.y - cy, pos.z - owner.pos.z);
      if (d < splash.radius) {
        const f = 1 + (splash.minFalloff - 1) * (d / splash.radius);
        damagePlayer(state, owner, { base: splash.damage * f * splash.selfMult, sourceKind: "self" });
        knockPlayer(owner, pos, splash.knockback * f * 1.3, 6 * f + 2);
      }
    }
    emit(state, "explosion", { pos: { ...pos }, radius: splash.radius, element });
  }
  function enemyAoE(state, pos, radius, damage, sourceKind, maxY = 99) {
    for (const p of Object.values(state.players)) {
      if (p.dead) continue;
      const d = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z);
      if (d < radius + TUNING.playerRadius && p.pos.y < maxY) damagePlayer(state, p, { base: damage, sourceKind, fromPos: pos });
    }
  }
  function spawnAlly(state, owner, pos, sourceKind) {
    const a = range(state.rng, 0, Math.PI * 2);
    state.allies.push({
      id: nextId(state),
      kind: "ally",
      type: "miniSproto",
      pos: { x: pos.x + Math.cos(a), y: 0, z: pos.z + Math.sin(a) },
      prevPos: { x: pos.x, y: 0, z: pos.z },
      vel: { x: 0, y: 0, z: 0 },
      ttl: ALLY.ttl,
      targetId: null,
      fireCd: 0.3,
      damage: ALLY.damage,
      splashRadius: ALLY.splashRadius,
      sourceKind,
      ownerId: owner.id,
      dead: false,
      yaw: 0
    });
  }
  function hitPlayerSphere(state, c, r, damage, sourceKind, fromPos) {
    for (const p of Object.values(state.players)) {
      if (!p.dead && sphereHitsPlayer(c, r, p)) {
        damagePlayer(state, p, { base: damage, sourceKind, fromPos });
        return p;
      }
    }
    return null;
  }

  // src/sim/campaign/abyss.js
  var DROP = 30;
  var cache2 = /* @__PURE__ */ new Map();
  function lowest(rt) {
    let y = 0;
    for (const sec of rt.sections || []) {
      for (const g of sec.geometry || []) {
        if (!g.at) continue;
        const half = g.size ? g.size[1] / 2 : g.r && !g.h ? g.r : 0;
        y = Math.min(y, g.at[1] - half);
      }
      if (sec.terrain && sec.terrain.origin) y = Math.min(y, sec.terrain.origin[1] || 0);
      if (sec.start) y = Math.min(y, sec.start[1] || 0);
    }
    return y;
  }
  function abyssY(level) {
    if (!level || !level.id) return -Infinity;
    if (!cache2.has(level.id)) cache2.set(level.id, lowest(getLevelRuntime(level.id)) - DROP);
    return cache2.get(level.id);
  }

  // src/core/math.js
  var clamp = (x, lo, hi) => x < lo ? lo : x > hi ? hi : x;
  var deg = (d) => d * Math.PI / 180;
  function dirFromYawPitch(yaw, pitch) {
    const cp = Math.cos(pitch);
    return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
  }
  function angleWrap(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }
  var yawTo = (a, b) => Math.atan2(-(b.x - a.x), -(b.z - a.z));

  // src/sim/grappleMotion.js
  function grappleSpeedScale(x, y, z, limit) {
    const speed = Math.hypot(x, y, z);
    return speed > limit ? limit / speed : 1;
  }

  // src/sim/grapple.js
  function inBox2(box3, x, y, z) {
    if (!box3 || !box3.min || !box3.max) return false;
    return x >= box3.min[0] && x <= box3.max[0] && y >= box3.min[1] && y <= box3.max[1] && z >= box3.min[2] && z <= box3.max[2];
  }
  function sealOf(state, p) {
    const sec = state._v2section;
    const book3 = state.level && state.level.v2 && state.level.v2.enc;
    if (!sec || !book3) return null;
    for (const enc of sec.encounters || []) {
      const prog = book3[enc.id];
      const room2 = enc.lockdown && enc.lockdown.room;
      if (!prog || !prog.sealed || !room2) continue;
      if (inBox2(room2, p.pos.x, p.pos.y + 0.4, p.pos.z)) return room2;
    }
    return null;
  }
  function blocked(state, x, y, z) {
    const zones = state.level && state.level.noGrapple || [];
    for (let i = 0; i < zones.length; i++) if (inBox2(zones[i], x, y, z)) return true;
    return false;
  }
  function snapAnchor(state, point, origin, maxDist) {
    const anchors = state.level && state.level.grappleAnchors || [];
    let best = null;
    let bd = 2.4;
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      const at2 = a.at;
      if (!at2) continue;
      const d = Math.hypot(at2[0] - point.x, (at2[1] || 0) - point.y, at2[2] - point.z);
      const reach = a.r == null ? 2.4 : a.r;
      if (d <= reach && d < bd && Math.hypot(at2[0] - origin.x, (at2[1] || 0) - origin.y, at2[2] - origin.z) <= maxDist) {
        bd = d;
        best = { x: at2[0], y: at2[1] || 0, z: at2[2], id: a.id || null };
      }
    }
    return best;
  }
  function anchorOnRay(state, origin, dir, maxDist) {
    const anchors = state.level && state.level.grappleAnchors || [];
    let best = null;
    let bt = maxDist;
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      const at2 = a.at;
      if (!at2) continue;
      const ox = at2[0] - origin.x, oy = (at2[1] || 0) - origin.y, oz = at2[2] - origin.z;
      if (Math.hypot(ox, oy, oz) > maxDist) continue;
      const t = ox * dir.x + oy * dir.y + oz * dir.z;
      if (t < 0.4 || t > maxDist) continue;
      const px = origin.x + dir.x * t, py = origin.y + dir.y * t, pz = origin.z + dir.z * t;
      const miss = Math.hypot(at2[0] - px, (at2[1] || 0) - py, at2[2] - pz);
      const reach = a.r == null ? 1.4 : a.r;
      if (miss <= reach && t < bt) {
        bt = t;
        best = { x: at2[0], y: at2[1] || 0, z: at2[2], id: a.id || null, t };
      }
    }
    return best;
  }
  function findHook(state, p) {
    const origin = eyePos(p);
    const dir = dirFromYawPitch(p.yaw, p.pitch);
    const maxDist = TUNING.grappleRange;
    const solids = activeSolids(state);
    let hit = null;
    if (solids) {
      const wall2 = firstSolid(solids, origin, dir, maxDist, null, true);
      if (wall2) {
        hit = {
          x: origin.x + dir.x * wall2.t,
          y: origin.y + dir.y * wall2.t,
          z: origin.z + dir.z * wall2.t,
          t: wall2.t,
          id: wall2.solid.id || null
        };
      }
    }
    const groundT = rayWorld(origin, dir, maxDist);
    if (groundT > 0.4 && groundT < maxDist && (!hit || groundT < hit.t)) {
      hit = {
        x: origin.x + dir.x * groundT,
        y: origin.y + dir.y * groundT,
        z: origin.z + dir.z * groundT,
        t: groundT,
        id: "ground"
      };
    }
    const along = anchorOnRay(state, origin, dir, maxDist);
    if (along && (!hit || along.t <= hit.t + 0.4)) hit = along;
    if (hit) {
      const snapped = snapAnchor(state, hit, origin, maxDist);
      if (snapped) hit = snapped;
    }
    if (!hit || blocked(state, hit.x, hit.y, hit.z)) return null;
    const room2 = sealOf(state, p);
    if (room2 && !inBox2(room2, hit.x, hit.y, hit.z)) return null;
    return { x: hit.x, y: hit.y, z: hit.z, id: hit.id || null };
  }
  function stillClear(state, p, hook2) {
    const origin = eyePos(p);
    const dx = hook2.x - origin.x, dy = hook2.y - origin.y, dz = hook2.z - origin.z;
    const dist = Math.hypot(dx, dy, dz) || 1;
    const solids = activeSolids(state);
    if (!solids) return true;
    const wall2 = firstSolid(solids, origin, { x: dx / dist, y: dy / dist, z: dz / dist }, dist - 0.35, null, true);
    return !wall2;
  }
  function clampToRoom(p, room2) {
    if (!room2) return;
    const pad = 0.45;
    if (p.pos.x < room2.min[0] + pad) {
      p.pos.x = room2.min[0] + pad;
      if (p.vel.x < 0) p.vel.x = 0;
    }
    if (p.pos.x > room2.max[0] - pad) {
      p.pos.x = room2.max[0] - pad;
      if (p.vel.x > 0) p.vel.x = 0;
    }
    if (p.pos.z < room2.min[2] + pad) {
      p.pos.z = room2.min[2] + pad;
      if (p.vel.z < 0) p.vel.z = 0;
    }
    if (p.pos.z > room2.max[2] - pad) {
      p.pos.z = room2.max[2] - pad;
      if (p.vel.z > 0) p.vel.z = 0;
    }
    if (p.pos.y > room2.max[1] - 0.3) {
      p.pos.y = room2.max[1] - 0.3;
      if (p.vel.y > 0) p.vel.y = 0;
    }
  }
  function limitSpeed(p, limit) {
    const k = grappleSpeedScale(p.vel.x, p.vel.y, p.vel.z, limit);
    p.vel.x *= k;
    p.vel.y *= k;
    p.vel.z *= k;
  }
  function releaseGrapple(state, p) {
    if (!p.grapple) return;
    limitSpeed(p, TUNING.grappleReleaseSpeed);
    p.grapple = null;
    emit(state, "grappleRelease", { playerId: p.id });
  }
  function tickGrapple(state, p, dt) {
    if (p.grappleCd > 0) p.grappleCd = Math.max(0, p.grappleCd - dt);
    const c = p.cmd || {};
    const held = !!(c.held && c.held.grapple);
    if (!held || p.downed) {
      releaseGrapple(state, p);
      return;
    }
    if (!p.grapple) {
      if (p.grappleCd > 0) return;
      const hook3 = findHook(state, p);
      p.grappleCd = TUNING.grappleCd;
      if (!hook3) {
        p.grappleMiss = true;
        return;
      }
      delete p.grappleMiss;
      p.grapple = hook3;
      emit(state, "grapple", { playerId: p.id, pos: { x: hook3.x, y: hook3.y, z: hook3.z }, id: hook3.id });
    }
    const hook2 = p.grapple;
    if (!stillClear(state, p, hook2)) {
      releaseGrapple(state, p);
      return;
    }
    const originY = p.pos.y + 0.9;
    const dx = hook2.x - p.pos.x, dy = hook2.y - originY, dz = hook2.z - p.pos.z;
    const dist = Math.hypot(dx, dy, dz) || 1;
    if (dist < TUNING.grappleArrive) {
      releaseGrapple(state, p);
      return;
    }
    const pull = TUNING.grapplePull * dt;
    p.vel.x += dx / dist * pull;
    p.vel.y += dy / dist * pull;
    p.vel.z += dz / dist * pull;
    limitSpeed(p, TUNING.grappleSpeed);
    const room2 = sealOf(state, p);
    if (room2) {
      const pad = 0.45;
      if (p.pos.x < room2.min[0] + pad) p.pos.x = room2.min[0] + pad;
      if (p.pos.x > room2.max[0] - pad) p.pos.x = room2.max[0] - pad;
      if (p.pos.z < room2.min[2] + pad) p.pos.z = room2.min[2] + pad;
      if (p.pos.z > room2.max[2] - pad) p.pos.z = room2.max[2] - pad;
      if (p.pos.y > room2.max[1] - 0.2) {
        p.pos.y = room2.max[1] - 0.2;
        if (p.vel.y > 0) p.vel.y = 0;
      }
    }
  }

  // src/sim/campaign/mechanisms.js
  function detonateBarrel(state, section, m) {
    const lv = state.level;
    if (lv.got[m.id]) return;
    lv.got[m.id] = true;
    const pos = { x: m.at[0], y: m.at[1] || 0.5, z: m.at[2] };
    const element = m.element || "fire";
    emit(state, "barrel", { id: m.id, pos, element });
    explode(state, pos, { radius: m.radius || 4, damage: m.damage || 60, minFalloff: 0.35, selfMult: 0, knockback: 6 }, 0, element, "world");
    const p = state.players[state.localPlayerId];
    const d = Math.hypot(p.pos.x - pos.x, p.pos.y - pos.y, p.pos.z - pos.z);
    const radius = m.radius || 4;
    if (d < radius) damagePlayer(state, p, { base: (m.playerDamage || 25) * (1 - d / radius), sourceKind: "world", fromPos: pos });
    for (const other of section && section.mechanisms || []) {
      if (other.kind !== "barrel" || other.id === m.id || lv.got[other.id]) continue;
      if (Math.hypot(other.at[0] - pos.x, other.at[2] - pos.z) > radius) continue;
      detonateBarrel(state, section, other);
    }
  }
  function tickSwitch(state, p, m, dt) {
    const lv = state.level;
    if (lv.got[m.id]) return;
    const held = p.cmd && p.cmd.held && p.cmd.held.interact;
    if (!m.needsHold) {
      finishSwitch(state, m);
      return;
    }
    if (!held) {
      m._hold = 0;
      return;
    }
    m._hold = (m._hold || 0) + dt;
    if (m._hold >= (m.holdTime || 0.35)) finishSwitch(state, m);
  }
  function finishSwitch(state, m) {
    const lv = state.level;
    lv.got[m.id] = true;
    emit(state, "switch", { id: m.id });
    if (m.opens) lv.got[m.opens] = true;
  }
  function onMover(p, m) {
    if (!m.carry) return Math.abs(p.pos.x - m.from[0]) < 1.6;
    const dx = m.to[0] - m.from[0], dz = (m.to[2] || 0) - (m.from[2] || 0);
    const len2 = dx * dx + dz * dz || 1;
    const t = ((p.pos.x - m.from[0]) * dx + (p.pos.z - (m.from[2] || 0)) * dz) / len2;
    const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = m.from[0] + dx * clamped;
    const pz = (m.from[2] || 0) + dz * clamped;
    return Math.hypot(p.pos.x - px, p.pos.z - pz) < 1.6;
  }
  function tickMover(state, p, m, dt) {
    if (!m.carry || !m.from || !m.to) {
      p.vel.x += (m.speed || 2) * dt;
      return;
    }
    const dx = m.to[0] - p.pos.x, dz = m.to[2] - p.pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    const step = Math.min(dist, (m.speed || 2) * dt);
    p.pos.x += dx / dist * step;
    p.pos.z += dz / dist * step;
    if (m.to[1] != null) p.pos.y = m.to[1];
  }
  function slowEnemiesInHazard(state, m) {
    if (!m.affectsEnemies || m.slow == null) return;
    for (const e of state.enemies) {
      if (e.dead) continue;
      if (!insideZone(m, e.pos.x, e.pos.z)) continue;
      e.vel.x *= m.slow;
      e.vel.z *= m.slow;
    }
  }
  function insideZone(m, x, z) {
    if (m.min && m.max) return x >= m.min[0] && x <= m.max[0] && z >= m.min[2] && z <= m.max[2];
    if (m.at && m.r) return Math.hypot(x - m.at[0], z - m.at[2]) <= m.r;
    return false;
  }
  function hazardOn(lv, m) {
    if (!lv) return true;
    if (m.set) {
      const sets = lv.hazardSets || {};
      if (sets[m.set] == null) return false;
      return !!sets[m.set];
    }
    if (m.when) {
      if (m.when.endsWith(".cleared")) return !!lv.cleared[m.when.slice(0, -".cleared".length)];
      if (m.when.startsWith("switch:")) return !!lv.got[m.when.slice("switch:".length)];
      return !!lv.got[m.when];
    }
    return true;
  }
  function isZone(m) {
    return m.kind === "hazardZone" || m.kind === "slow";
  }
  function zoneSlowOf(m) {
    if (m.slow != null) return m.slow;
    if (m.speed != null && m.speed <= 1) return m.speed;
    return null;
  }
  function zoneList(sec) {
    const extra = sec && sec.hazards || [];
    return extra.length ? (sec.mechanisms || []).concat(extra) : sec && sec.mechanisms || [];
  }
  function playerZoneSlow(lv, sec, p) {
    let slow = 1;
    for (const m of zoneList(sec)) {
      if (!isZone(m) || !hazardOn(lv, m)) continue;
      const rate = zoneSlowOf(m);
      if (rate == null) continue;
      if (!insideZone(m, p.pos.x, p.pos.z)) continue;
      if (rate < slow) slow = rate;
    }
    return slow;
  }
  function enemyZoneSlow(lv, sec, e) {
    let slow = 1;
    for (const m of sec && sec.mechanisms || []) {
      if (!isZone(m) || !hazardOn(lv, m) || !m.affectsEnemies || m.slow == null) continue;
      if (e.type === "frostHound" && m.tag === "slick") continue;
      if (!insideZone(m, e.pos.x, e.pos.z)) continue;
      if (m.slow < slow) slow = m.slow;
    }
    return slow;
  }
  function publishSlowZones(lv, sec) {
    const zones = [];
    for (const m of zoneList(sec)) {
      if (!isZone(m) || !hazardOn(lv, m) || !(m.navCost > 1) || !m.min || !m.max) continue;
      zones.push({ min: m.min, max: m.max, cost: m.navCost });
    }
    lv.slowZones = zones;
    lv._zonesDirty = false;
  }
  function tickZoneDamage(state, p, m, dt) {
    if (!isZone(m) || !hazardOn(state.level, m)) return;
    if (!insideZone(m, p.pos.x, p.pos.z)) return;
    if (m.dps) damagePlayer(state, p, { base: m.dps * dt, sourceKind: "world", fromPos: { x: m.min && m.min[0] || m.at[0], y: 0, z: m.min && m.min[2] || m.at[2] } });
    if (m.affectsEnemies && m.dps) {
      for (const e of state.enemies) {
        if (e.dead || !insideZone(m, e.pos.x, e.pos.z)) continue;
        e.hp -= m.dps * dt;
        if (e.hp <= 0) {
          e.hp = 0;
          e.dead = true;
        }
      }
    }
  }
  function targetKey(m) {
    if (m.solid) return m.solid;
    if (m.id && m.id.endsWith("-hp")) return m.id.slice(0, -"-hp".length);
    return m.id;
  }
  function matchesTarget(m, solidId) {
    if (!solidId) return false;
    if (m.id === solidId || targetKey(m) === solidId) return true;
    return solidId === `${m.id}-body` || solidId === `${m.id}-hp`;
  }
  function damageLevelSolid(state, solid, hit) {
    const lv = state.level;
    const sec = state._campaignSection || state._v2section;
    if (!lv || !sec || !solid || !solid.id) return false;
    const m = (sec.mechanisms || []).find((item) => item.kind === "target" && matchesTarget(item, solid.id));
    if (!m || scriptShields(state, solid.id)) return false;
    if (!lv.targets) lv.targets = {};
    const rec = lv.targets[m.id] || (lv.targets[m.id] = { hp: m.hp, max: m.hp });
    if (rec.hp <= 0) return true;
    let dmg = hit.base || 0;
    if (hit.sourceKind === "gun" && m.bulletMul != null) dmg *= m.bulletMul;
    if ((hit.isSplash || hit.sourceKind === "world") && m.explosiveMul != null) dmg *= m.explosiveMul;
    if (hit.sourceKind === "spell" && m.spellMul != null) dmg *= m.spellMul;
    if (hit.zone === "weak" && m.weak) dmg *= m.weak;
    rec.hp -= dmg;
    if (rec.hp > 0) return false;
    rec.hp = 0;
    if (!lv.brokenSolids) lv.brokenSolids = {};
    lv.brokenSolids[solid.id] = true;
    if (lv.solids) lv.solids = lv.solids.filter((s) => s.id !== solid.id);
    markPartDestroyed(state, m.id);
    if (targetKey(m) !== m.id) markPartDestroyed(state, targetKey(m));
    return true;
  }
  function tickRising(state, p, m, dt) {
    if (m.kind !== "risingHazard" || !m.min || !m.max) return;
    const lv = state.level;
    if (m.starts && !(lv.fled && lv.fled[m.starts.slice(0, -".fled".length)])) return;
    if (!lv.rise) lv.rise = {};
    const st = lv.rise[m.id] || (lv.rise[m.id] = { y: m.min[1] });
    st.y = Math.min(m.max[1], st.y + (m.rate || 0.18) * dt);
    if (p.pos.x < m.min[0] || p.pos.x > m.max[0] || p.pos.z < m.min[2] || p.pos.z > m.max[2]) return;
    if (p.pos.y < st.y) p.pos.y = st.y;
    if (m.dps && p.pos.y <= st.y + 0.2) damagePlayer(state, p, { base: m.dps * dt, sourceKind: "world", fromPos: { x: p.pos.x, y: st.y, z: p.pos.z } });
  }
  function tickGeyser(state, p, m) {
    if (m.kind !== "geyser" || !m.at || !hazardOn(state.level, m)) return;
    const lv = state.level;
    const period = m.period || 5;
    const phase = ((lv.time + (m.offset || 0)) % period + period) % period;
    const rumble = m.rumble == null ? 1.2 : m.rumble;
    const book3 = lv.mech || (lv.mech = {});
    const st = book3[m.id] || (book3[m.id] = {});
    const warning = rumble > 0 && phase >= period - rumble;
    if (warning && !st.warn) {
      st.warn = true;
      emit(state, "geyser", { id: m.id, phase: "rumble" });
    }
    if (!warning) st.warn = false;
    const near2 = Math.hypot(p.pos.x - m.at[0], p.pos.z - m.at[2]) <= (m.r || 1.6);
    if (phase < 0.45 && near2 && !st.hit) {
      st.hit = true;
      emit(state, "geyser", { id: m.id, phase: "erupt" });
      if (m.damage) damagePlayer(state, p, { base: m.damage, sourceKind: "world", fromPos: { x: m.at[0], y: m.at[1] || 0, z: m.at[2] } });
      if (m.to) {
        p.pos.x = m.to[0];
        p.pos.y = m.to[1] == null ? p.pos.y : m.to[1];
        p.pos.z = m.to[2];
        p.vel.y = Math.max(p.vel.y, 6);
      }
    }
    if (phase >= 0.45) st.hit = false;
  }

  // src/sim/campaign/perception.js
  var blocksSight = (s) => s.sight !== false;
  function hasLOS(state, from, to, max = 80) {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 0.05) return true;
    if (dist > max) return false;
    const solids = activeSolids(state);
    if (!solids) return true;
    const dir = { x: dx / dist, y: dy / dist, z: dz / dist };
    const hit = raySolids(solids, from, dir, dist, blocksSight);
    return hit < 0 || hit > dist - 0.25;
  }
  function capSight(state, range2, uncapped) {
    if (uncapped) return range2;
    if (state.level && state.level.whiteout) return Math.min(range2, state.level.sightCap || 40);
    return range2;
  }
  function inCone(e, target, halfDeg, yaw) {
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const dx = target.pos.x - e.pos.x;
    const dz = target.pos.z - e.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    return dx / d * fx + dz / d * fz >= Math.cos(halfDeg * Math.PI / 180);
  }
  function heardShot(state, dist, hear) {
    for (let i = 0; i < state.events.length; i++) {
      if (state.events[i].type === "shot" && dist <= hear) return true;
    }
    return false;
  }
  function sensePlayer(state, e, target) {
    if (e.ai.alert === "alerted") return true;
    const stealth = e.type === "auditSniper" || e.type === "miningRig" || e.type === "frostHound" || e.ai.alert === "asleep" || e.ai.alert === "idle" || e.ai.alert === "unaware";
    if (!stealth) return true;
    const dx = target.pos.x - e.pos.x, dz = target.pos.z - e.pos.z;
    const dist = Math.hypot(dx, dz);
    const from = { x: e.pos.x, y: e.pos.y + (e.height || 1) * 0.8, z: e.pos.z };
    const to = { x: target.pos.x, y: target.pos.y + 1.2, z: target.pos.z };
    const time = state.level && state.level.time || 0;
    let wake = false;
    if (e.ai.alert === "asleep") {
      wake = heardShot(state, dist, e.ai.hearing || 12);
    } else if (e.type === "frostHound") {
      wake = dist <= 45;
    } else if (e.type === "auditSniper") {
      const yaw = e.yaw + Math.sin(time * Math.PI * 2 / 6) * (30 * Math.PI / 180);
      const los = hasLOS(state, from, to, 140);
      const cone4 = dist <= capSight(state, 140, false) && inCone(e, target, 15, yaw);
      const outside = dist <= capSight(state, 60, false);
      wake = los && (cone4 || outside);
    } else if (e.type === "miningRig") {
      const under = dist < 15 && target.pos.y + 1.2 < e.pos.y - 1;
      wake = !under && dist <= capSight(state, 90, false) && hasLOS(state, from, to, 90);
    } else {
      const yaw = e.yaw;
      wake = dist <= capSight(state, e.ai.sight || 30, false) && inCone(e, target, 60, yaw) && hasLOS(state, from, to, 30);
      if (!wake) wake = heardShot(state, dist, e.ai.hearing || 16);
    }
    if (!wake) return false;
    e.ai.alert = "alerted";
    return true;
  }

  // src/sim/campaign/alarms.js
  function mechanisms(state) {
    const sec = state._v2section;
    return sec && sec.mechanisms || [];
  }
  function alarmOf(state, id) {
    for (const m of mechanisms(state)) if (m.kind === "alarm" && m.id === id) return m;
    return null;
  }
  function hpBook(lv) {
    if (!lv.alarmHp) lv.alarmHp = {};
    return lv.alarmHp;
  }
  function recOf(lv, m) {
    const book3 = hpBook(lv);
    return book3[m.id] || (book3[m.id] = {
      box: m.hp == null ? 40 : m.hp,
      cable: m.cableHp == null ? 20 : m.cableHp,
      lamp: m.lamp == null ? 30 : m.lamp,
      hold: 0
    });
  }
  function alarmCut(lv, id) {
    return !!(lv && lv.alarmsCut && lv.alarmsCut[id]);
  }
  function markCut(state, id) {
    const lv = state.level;
    if (!lv.alarmsCut) lv.alarmsCut = {};
    if (lv.alarmsCut[id]) return;
    lv.alarmsCut[id] = true;
    emit(state, "alarm", { id, cut: true });
  }
  function cablesOf(m) {
    const from = m.at;
    if (!from) return [];
    const ends = [];
    if (m.cableTo) ends.push(m.cableTo);
    for (const c of m.cables || []) ends.push(c);
    return ends.map((to) => ({ a: from, b: to }));
  }
  function raySphere2(o, d, c, r, maxDist) {
    const ox = o.x - c[0], oy = o.y - (c[1] || 0), oz = o.z - c[2];
    const b = ox * d.x + oy * d.y + oz * d.z;
    const c0 = ox * ox + oy * oy + oz * oz - r * r;
    const disc3 = b * b - c0;
    if (disc3 < 0) return -1;
    const t = -b - Math.sqrt(disc3);
    if (t < 0.05 || t > maxDist) return -1;
    return t;
  }
  function rayCable(o, d, a, b, radius, maxDist) {
    const abx = b[0] - a[0], aby = (b[1] || 0) - (a[1] || 0), abz = b[2] - a[2];
    let best = -1;
    const steps = 8;
    for (let i = 0; i <= steps; i++) {
      const u4 = i / steps;
      const c = [a[0] + abx * u4, (a[1] || 0) + aby * u4, a[2] + abz * u4];
      const t = raySphere2(o, d, c, radius, maxDist);
      if (t >= 0 && (best < 0 || t < best)) best = t;
    }
    return best;
  }
  function alarmRay(state, origin, dir, maxDist) {
    const lv = state.level;
    if (!lv) return null;
    let best = null;
    for (const m of mechanisms(state)) {
      if (!m.at) continue;
      if (m.kind === "alarm") {
        const box3 = raySphere2(origin, dir, m.at, 0.8, maxDist);
        if (box3 >= 0 && (!best || box3 < best.t)) best = { t: box3, id: m.id, part: "box", m };
        for (const seg of cablesOf(m)) {
          const t = rayCable(origin, dir, seg.a, seg.b, 0.45, maxDist);
          if (t >= 0 && (!best || t < best.t)) best = { t, id: m.id, part: "cable", m };
        }
      } else if (m.kind === "searchlight" && !m.harmless) {
        const t = raySphere2(origin, dir, m.at, 0.6, maxDist);
        if (t >= 0 && (!best || t < best.t)) best = { t, id: m.id, part: "lamp", m };
      }
    }
    return best;
  }
  function damageAlarm(state, hit, amount) {
    const lv = state.level;
    const rec = recOf(lv, hit.m);
    if (hit.part === "lamp") {
      if (rec.lamp <= 0) return true;
      rec.lamp -= amount;
      if (rec.lamp <= 0) rec.lamp = 0;
      return true;
    }
    if (hit.part === "cable") rec.cable -= amount;
    else rec.box -= amount;
    if (rec.box <= 0 || rec.cable <= 0) {
      rec.box = Math.max(0, rec.box);
      rec.cable = Math.max(0, rec.cable);
      markCut(state, hit.id);
    }
    return true;
  }
  function searchlightYaw(m, time) {
    const span2 = m.sweep > 0 ? Math.sin(time * Math.PI * 2 / m.sweep) * 0.9 : 0;
    return (m.yaw || 0) + span2;
  }
  function onBeam(m, px, pz, time) {
    const yaw = searchlightYaw(m, time);
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const dx = px - m.at[0];
    const dz = pz - m.at[2];
    const along = dx * fx + dz * fz;
    if (along < 0 || along > (m.beam || 120)) return false;
    const ox = dx - fx * along;
    const oz = dz - fz * along;
    return Math.hypot(ox, oz) <= (m.spot || 6);
  }
  function tickAlarms(state, dt) {
    const lv = state.level;
    const list = mechanisms(state);
    let any = false;
    for (let i = 0; i < list.length; i++) {
      if (list[i].kind === "alarm" || list[i].kind === "searchlight") any = true;
    }
    for (const e of state.enemies) if (e.ringsAlarm || e.role === "runner") any = true;
    if (!any) return;
    const p = state.players[state.localPlayerId];
    for (const m of list) {
      if (m.kind !== "searchlight" || m.harmless || !m.alarm || !m.at || !p) continue;
      const rec = recOf(lv, m);
      if (rec.lamp <= 0 || alarmCut(lv, m.alarm)) {
        rec.hold = 0;
        continue;
      }
      if (onBeam(m, p.pos.x, p.pos.z, lv.time || 0)) rec.hold += dt;
      else rec.hold = 0;
      if (rec.hold >= (m.hold || 2)) ringAlarm(state, m.alarm);
    }
    for (const e of state.enemies) {
      if (e.dead || e.type !== "spotterDrone" || !e.ringsAlarm || !p) continue;
      if (alarmCut(lv, e.ringsAlarm)) continue;
      const from = { x: e.pos.x, y: e.pos.y + 0.6, z: e.pos.z };
      const to = { x: p.pos.x, y: p.pos.y + 1.2, z: p.pos.z };
      const dist = Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z);
      const seeing = dist <= 35 && hasLOS(state, from, to, 35);
      if (seeing) e.ai.spotT = (e.ai.spotT || 0) + dt;
      else e.ai.spotT = Math.max(0, (e.ai.spotT || 0) - dt);
      if ((e.ai.spotT || 0) >= 1.5) ringAlarm(state, e.ringsAlarm);
    }
  }
  function runnerSteer(state, e, dt) {
    if (!e || e.role !== "runner" || !e.alarm || e.dead) return null;
    const lv = state.level;
    if (!lv || lv.alarms && lv.alarms[e.alarm] != null) return null;
    const box3 = alarmOf(state, e.alarm);
    if (!box3 || !box3.at) return null;
    const dx = box3.at[0] - e.pos.x;
    const dz = box3.at[2] - e.pos.z;
    const dist = Math.hypot(dx, dz);
    const cut = alarmCut(lv, e.alarm);
    if (dist > 1.8) {
      e.ai.alarmT = 0;
      return { x: dx / (dist || 1), z: dz / (dist || 1) };
    }
    e.ai.alarmT = (e.ai.alarmT || 0) + dt;
    if (cut) return { x: 0, z: 0, wait: e.ai.alarmT < (box3.wonder || 3) };
    if (e.ai.alarmT >= (box3.runner || 1.5)) ringAlarm(state, e.alarm);
    return { x: 0, z: 0, wait: true };
  }

  // src/sim/player.js
  var EMPTY_CMD = { yaw: 0, pitch: 0, moveX: 0, moveZ: 0, held: {}, pressed: {}, slot: -1, wheel: 0, actions: [] };
  function playerInput(state, commands) {
    for (const p of Object.values(state.players)) {
      const c = commands[p.id] || { ...EMPTY_CMD, yaw: p.yaw, pitch: p.pitch };
      p.cmd = c;
      p.yaw = c.yaw;
      p.pitch = clamp(c.pitch, -1.5, 1.5);
      p.zooming = !!c.held.zoom && !p.dead;
    }
  }
  function playerMovement(state, dt) {
    for (const p of Object.values(state.players)) {
      if (p.dead) {
        p.vel.x = p.vel.z = 0;
        continue;
      }
      const c = p.cmd;
      const m = p.move;
      m.slideCd = Math.max(0, m.slideCd - dt);
      m.dashCd = Math.max(0, m.dashCd - dt);
      if (p.stamina == null) {
        p.stamina = 1;
        p.staminaDelay = 0;
        p.staminaLock = false;
        p.grappleCd = 0;
        p.grapple = null;
      }
      const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
      let wx = -sy * c.moveZ + cy * c.moveX;
      let wz = -cy * c.moveZ - sy * c.moveX;
      const wl = Math.hypot(wx, wz);
      if (wl > 1) {
        wx /= wl;
        wz /= wl;
      }
      const canAct = !p.downed;
      const wantSprint = canAct && c.held.sprint && c.moveZ > 0 && !p.zooming && !p.staminaLock && p.stamina > 0;
      let sprinting = wantSprint;
      if (sprinting) {
        p.stamina = Math.max(0, p.stamina - dt / TUNING.staminaSprint);
        p.staminaDelay = TUNING.staminaRegenDelay;
        if (p.stamina <= 0) {
          p.staminaLock = true;
          sprinting = false;
        }
      } else {
        if (p.staminaDelay > 0) p.staminaDelay = Math.max(0, p.staminaDelay - dt);
        else if (p.stamina < 1) p.stamina = Math.min(1, p.stamina + dt / TUNING.staminaRegen);
        if (p.staminaLock && p.stamina >= TUNING.staminaRefill) p.staminaLock = false;
      }
      let maxSpeed = sprinting ? TUNING.sprintSpeed : TUNING.walkSpeed;
      if (p.campaignSpeed) maxSpeed *= p.campaignSpeed;
      if (state.mode === "campaign" && p.hazardSlow != null && p.hazardSlow < 1) maxSpeed *= p.hazardSlow;
      if (p.iceSlow != null && p.iceSlow < 1) maxSpeed *= p.iceSlow;
      if (state.mode === "campaign" && p.scriptSlow != null && p.scriptSlow < 1) maxSpeed *= p.scriptSlow;
      if (p.downed) maxSpeed *= TUNING.downedSpeedMult;
      if (c.pressed.jump) p.jumpBufferT = TUNING.jumpBuffer;
      else p.jumpBufferT = Math.max(0, p.jumpBufferT - dt);
      if (p.onGround) {
        p.coyoteT = TUNING.coyote;
        p.jumpsLeft = 2;
      } else p.coyoteT = Math.max(0, p.coyoteT - dt);
      if (canAct && c.pressed.dash && m.dashCd <= 0) {
        const dl = Math.hypot(wx, wz);
        m.dashDir = dl > 0.1 ? { x: wx / dl, z: wz / dl } : { x: -sy, z: -cy };
        m.mode = "dash";
        m.dashT = TUNING.dashTime;
        m.dashCd = TUNING.dashCd;
        p.invulnT = Math.max(p.invulnT, TUNING.dashInvuln);
        emit(state, "dash", { playerId: p.id });
      }
      const hs = Math.hypot(p.vel.x, p.vel.z);
      const crouch = !!(c.held && c.held.crouch);
      const wantSlide = canAct && p.onGround && m.mode !== "slide" && m.slideCd <= 0 && (c.pressed.slide || crouch && sprinting) && (hs > TUNING.slideMinSpeed || sprinting);
      if (wantSlide) {
        const dirx = hs > 0.4 ? p.vel.x / hs : -Math.sin(p.yaw);
        const dirz = hs > 0.4 ? p.vel.z / hs : -Math.cos(p.yaw);
        const boost = Math.max(hs, TUNING.slideBoost);
        p.vel.x = dirx * boost;
        p.vel.z = dirz * boost;
        m.mode = "slide";
        m.slideT = TUNING.slideTime;
        p.stamina = Math.max(0, p.stamina - TUNING.slideStamina);
        p.staminaDelay = TUNING.staminaRegenDelay;
        if (p.stamina <= 0) p.staminaLock = true;
        emit(state, "slide", { playerId: p.id });
      }
      const hooked = !!p.grapple;
      if (m.mode === "dash") {
        m.dashT -= dt;
        p.vel.x = m.dashDir.x * TUNING.dashSpeed;
        p.vel.z = m.dashDir.z * TUNING.dashSpeed;
        p.vel.y = Math.max(p.vel.y, 0);
        if (m.dashT <= 0) {
          m.mode = "walk";
          p.vel.x *= 0.45;
          p.vel.z *= 0.45;
        }
      } else if (m.mode === "slide" && !hooked) {
        m.slideT -= dt;
        if (wl > 0.2) {
          p.vel.x += wx * 10 * dt;
          p.vel.z += wz * 10 * dt;
        }
        let sp = Math.hypot(p.vel.x, p.vel.z) || 1e-4;
        const solidsNow = activeSolids(state);
        if (solidsNow) {
          const ux = p.vel.x / sp, uz = p.vel.z / sp;
          const here = groundHeight(solidsNow, p.pos.x, p.pos.z, 0.15, p.pos.y + 0.5, 0.8);
          const there = groundHeight(solidsNow, p.pos.x + ux * 0.75, p.pos.z + uz * 0.75, 0.15, p.pos.y + 1.4, 1.4);
          if (here > -1e8 && there > -1e8 && here - there > 0.02) {
            const gain = Math.min(TUNING.slideSlope * dt, (here - there) * 12);
            p.vel.x += ux * gain;
            p.vel.z += uz * gain;
            sp = Math.hypot(p.vel.x, p.vel.z) || 1e-4;
          }
        }
        const next2 = sp + (TUNING.slideCruise - sp) * Math.min(1, TUNING.slideDrag * dt);
        const k = Math.max(0, next2) / sp;
        p.vel.x *= k;
        p.vel.z *= k;
        if (m.slideT <= 0 || next2 < TUNING.walkSpeed * 0.9 || !p.onGround) {
          m.mode = p.onGround ? "walk" : "air";
          m.slideCd = TUNING.slideCd;
        }
      } else if (p.onGround && !hooked) {
        const tx = wx * maxSpeed, tz = wz * maxSpeed;
        const dx = tx - p.vel.x, dz = tz - p.vel.z;
        const dl = Math.hypot(dx, dz);
        const acc = (wl > 0.01 ? TUNING.groundAccel : TUNING.friction * Math.max(hs, 2)) * dt;
        if (dl > 0) {
          const k = Math.min(1, acc / dl);
          p.vel.x += dx * k;
          p.vel.z += dz * k;
        }
        m.mode = sprinting ? "sprint" : "walk";
      } else if (hooked) {
        m.mode = "air";
      } else {
        const cap = Math.max(hs, TUNING.walkSpeed);
        p.vel.x += wx * TUNING.airAccel * dt;
        p.vel.z += wz * TUNING.airAccel * dt;
        const nh = Math.hypot(p.vel.x, p.vel.z);
        if (nh > cap) {
          p.vel.x *= cap / nh;
          p.vel.z *= cap / nh;
        }
        m.mode = "air";
      }
      if (canAct && p.jumpBufferT > 0) {
        if (p.onGround || p.coyoteT > 0) {
          p.vel.y = TUNING.jumpVel;
          p.onGround = false;
          p.coyoteT = 0;
          p.jumpsLeft = 1;
          p.jumpBufferT = 0;
          if (m.mode === "slide") {
            const sp = Math.hypot(p.vel.x, p.vel.z);
            if (sp > 0.1) {
              const boosted = sp * TUNING.slideHopBoost;
              p.vel.x = p.vel.x / sp * boosted;
              p.vel.z = p.vel.z / sp * boosted;
            }
            m.mode = "air";
            m.slideCd = TUNING.slideHopCd;
          }
          emit(state, "jump", { playerId: p.id });
        } else if (p.jumpsLeft > 0) {
          p.vel.y = TUNING.doubleJumpVel;
          p.jumpsLeft = 0;
          p.jumpBufferT = 0;
          emit(state, "doubleJump", { playerId: p.id });
        }
      }
      const seal2 = sealOf(state, p);
      if (m.mode !== "dash") p.vel.y -= TUNING.gravity * dt;
      if (state.mode === "campaign" && state.level && state.level.gravityMult !== 1 && m.mode !== "dash") {
        p.vel.y -= TUNING.gravity * (state.level.gravityMult - 1) * dt;
      }
      if (state.mode === "campaign" && p.jetpack && state.level) {
        const lv = state.level;
        if (lv.fuel == null) lv.fuel = 0;
        const infinite = !!(lv.modifiers && lv.modifiers.fuelInfinite);
        const drop = !p.onGround && (c.pressed.slide || c.held && c.held.slide);
        if (drop) p.vel.y = Math.min(p.vel.y, -16);
        else if (!p.onGround && c.held.jump && (infinite || lv.fuel > 0)) {
          p.vel.y += TUNING.gravity * dt;
          p.vel.y *= Math.max(0, 1 - 8 * dt);
          if (!infinite) lv.fuel = Math.max(0, lv.fuel - 10 * dt);
        }
        if (p.onGround && !infinite && lv.fuel < 100) lv.fuel = Math.min(100, lv.fuel + 25 * dt);
      }
      tickGrapple(state, p, dt);
      p.pos.x += p.vel.x * dt;
      p.pos.y += p.vel.y * dt;
      p.pos.z += p.vel.z * dt;
      const wasAir = !p.onGround;
      const solids = activeSolids(state);
      if (solids) {
        pushHorizontal(p, solids, TUNING.playerRadius, playerHeight(p), STEP_UP);
        const beforeY = p.pos.y;
        snapToGround(p, solids, TUNING.playerRadius, STEP_UP);
        if (wasAir && p.onGround && beforeY - p.pos.y > 0.05 && p.vel.y < -6) {
          emit(state, "land", { playerId: p.id, speed: 6 });
        }
        const hole = voidAt(p.pos, state.level.voids);
        if (hole) {
          const safe = state.level.safePos;
          const useSafe = hole.mode !== "fixed" && safe;
          const dest = useSafe ? [safe.x, safe.y, safe.z] : hole.to;
          if (dest) {
            p.pos.x = dest[0];
            p.pos.y = dest[1];
            p.pos.z = dest[2];
            p.vel.x = p.vel.y = p.vel.z = 0;
            p.onGround = true;
            if (hole.penalty) damagePlayer(state, p, { base: p.maxHp * hole.penalty, sourceKind: "world", fromPos: p.pos });
            if (hole.invuln) p.invulnT = Math.max(p.invulnT || 0, hole.invuln);
            emit(state, "voidRescue", { id: hole.id || "void", penalty: hole.penalty || 0 });
          }
        } else if (p.onGround && state.level.voids) {
          state.level.safePos = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
        }
        if (p.pos.y < abyssY(state.level)) {
          p.hp = 0;
          p.shield = 0;
          p.vel.x = p.vel.y = p.vel.z = 0;
          p.dead = true;
          p.downed = false;
          p.respawnT = TUNING.sandboxRespawn;
          emit(state, "playerFell", { playerId: p.id });
          emit(state, "playerDied", { playerId: p.id });
        }
      } else if (p.pos.y <= 0) {
        p.pos.y = 0;
        if (p.vel.y < 0) {
          if (wasAir && p.vel.y < -6) emit(state, "land", { playerId: p.id, speed: -p.vel.y });
          p.vel.y = 0;
        }
        p.onGround = true;
      } else p.onGround = false;
      if (seal2) clampToRoom(p, seal2);
      if (state.mode === "campaign" && p.jetpack && state.level) {
        const lids = state.level.flyerLids || (state.level.flyerVolume ? [state.level.flyerVolume] : []);
        for (const lid of lids) {
          if (!lid || !lid.max || !lid.min) continue;
          if (p.pos.x < lid.min[0] || p.pos.x > lid.max[0] || p.pos.z < lid.min[2] || p.pos.z > lid.max[2]) continue;
          const cap = lid.max[1] - 2;
          if (p.pos.y > cap) {
            p.pos.y = cap;
            if (p.vel.y > 0) p.vel.y = 0;
          }
        }
      }
      if (state.mode !== "campaign") {
        clampToArena(p, TUNING.playerRadius);
        pushOutOfBoxes(state, p, TUNING.playerRadius);
      }
    }
  }
  function activeGun(p) {
    return p.guns[p.activeSlot];
  }
  function switchSlot(state, p, slot) {
    if (slot === p.activeSlot || !slotUsable(p, slot) || !p.guns[slot]) return;
    p.activeSlot = slot;
    p.reloadT = 0;
    const g = p.guns[slot];
    p.swapT = effectiveGunStats(g, p).swapTime;
    p.fireCd = Math.max(p.fireCd, 0);
    emit(state, "swap", { playerId: p.id, slot });
  }
  function startReload(state, p, g) {
    if (p.reloadT > 0 || g.ammoInMag >= g.stats.magSize) return;
    const free = state.tuning.infiniteAmmo || state.tuning.godMode || hasInfiniteReserve(g);
    if (!free && p.ammo[g.ammoType] <= 0) {
      emit(state, "ammoEmpty", { playerId: p.id });
      return;
    }
    const st = effectiveGunStats(g, p);
    p.reloadT = st.reloadTime;
    emit(state, "reloadStart", { playerId: p.id, slot: p.activeSlot, time: st.reloadTime });
    if (g.wacky === "yeetReload") {
      const eye = eyePos(p);
      const d = dirFromYawPitch(p.yaw, p.pitch + 0.15);
      createProjectile(state, {
        kind: "yeetGun",
        faction: "player",
        ownerId: p.id,
        gunId: g.id,
        sourceKind: "gun",
        pos: { x: eye.x + d.x * 0.6, y: eye.y + d.y * 0.6, z: eye.z + d.z * 0.6 },
        vel: { x: d.x * 20, y: d.y * 20 + 3, z: d.z * 20 },
        radius: 0.3,
        gravity: 18,
        damage: g.stats.damage * 3,
        element: g.element,
        elementChance: 1,
        ttl: 3,
        splash: { radius: 3.5, damage: g.stats.damage * g.stats.pellets * 4 + 40, minFalloff: 0.3, selfMult: 0, knockback: 8 }
      });
    }
  }
  function finishReload(state, p, g) {
    const need = g.stats.magSize - g.ammoInMag;
    const free = state.tuning.infiniteAmmo || state.tuning.godMode || hasInfiniteReserve(g);
    const take = free ? need : Math.min(need, p.ammo[g.ammoType]);
    if (!free) p.ammo[g.ammoType] -= take;
    g.ammoInMag += take;
    emit(state, "reloadEnd", { playerId: p.id, slot: p.activeSlot });
  }
  function coneDir(state, aim, spreadDeg) {
    if (spreadDeg <= 0) return aim;
    const theta = deg(spreadDeg) * Math.sqrt(float(state.rng));
    const phi = float(state.rng) * Math.PI * 2;
    const up = Math.abs(aim.y) < 0.99 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    let rx = aim.y * up.z - aim.z * up.y, ry = aim.z * up.x - aim.x * up.z, rz = aim.x * up.y - aim.y * up.x;
    const rl = Math.hypot(rx, ry, rz);
    rx /= rl;
    ry /= rl;
    rz /= rl;
    const ux = ry * aim.z - rz * aim.y, uy = rz * aim.x - rx * aim.z, uz = rx * aim.y - ry * aim.x;
    const st = Math.sin(theta), ct = Math.cos(theta), cp = Math.cos(phi), sp = Math.sin(phi);
    return { x: aim.x * ct + (rx * cp + ux * sp) * st, y: aim.y * ct + (ry * cp + uy * sp) * st, z: aim.z * ct + (rz * cp + uz * sp) * st };
  }
  function fireHitscan(state, p, g, st, origin, dir, extra = {}) {
    let o = origin;
    const ignore = {};
    const rng = gunRange(g);
    let remaining = Math.min(TUNING.hitscanRange, rng.max);
    if (campaignSolidsOn(state)) {
      const solids = activeSolids(state);
      if (solids) {
        const wall2 = firstSolid(solids, origin, dir, remaining);
        if (wall2 && !damageLevelSolid(state, wall2.solid, { base: st.damage, sourceKind: "gun" })) remaining = wall2.t;
      }
      const alarm2 = alarmRay(state, origin, dir, remaining);
      if (alarm2) {
        damageAlarm(state, alarm2, st.damage);
        remaining = alarm2.t;
      }
    }
    let pierce = st.pierce;
    let end = null;
    for (let i = 0; i <= pierce; i++) {
      const hit = raycastEnemies(state, o, dir, remaining, ignore);
      if (!hit) break;
      const dist = Math.hypot(hit.point.x - origin.x, hit.point.y - origin.y, hit.point.z - origin.z);
      damageEnemy(state, hit.e, {
        sourceId: p.id,
        sourceKind: "gun",
        base: st.damage * (extra.dmgMult || 1) * rangeFalloff(rng, dist),
        element: g.element,
        elementChance: st.elementChance,
        zone: hit.zone,
        critChance: st.critChance,
        critMult: st.critMult,
        canCrit: true,
        pellet: st.pellets > 1,
        point: hit.point,
        gunId: g.id,
        arcane: g.arcane,
        wacky: g.wacky
      });
      ignore[hit.e.id] = true;
      end = hit.point;
      remaining -= hit.t;
      o = { x: hit.point.x + dir.x * 0.05, y: hit.point.y + dir.y * 0.05, z: hit.point.z + dir.z * 0.05 };
      if (i === pierce) break;
    }
    if (!end) {
      const t = rayWorld(origin, dir, Math.min(60, rng.max));
      end = { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t };
      if (origin.y + dir.y * t <= 0.01) emit(state, "impact", { pos: end, element: g.element });
    }
    emit(state, "tracer", { from: origin, to: end, element: g.element, gunType: g.type, mega: !!extra.mega });
  }
  function playerCombat(state, dt) {
    for (const p of Object.values(state.players)) {
      if (p.dead) continue;
      const c = p.cmd;
      if (p.medkitT > 0) {
        p.medkitT -= dt;
        if (p.medkitT <= 0) {
          healPlayer(p, TUNING.medkitHeal);
          emit(state, "pickup", { playerId: p.id, kind: "medkit", amount: TUNING.medkitHeal });
        }
      } else if (c.pressed.medkit && p.medkits > 0 && p.hp < p.maxHp && !p.downed) {
        p.medkits--;
        p.medkitT = TUNING.medkitTime;
        emit(state, "medkitStart", { playerId: p.id });
      }
      if (c.slot >= 0) switchSlot(state, p, c.slot);
      else if (c.wheel) {
        for (let i = 1; i <= SLOT_COUNT; i++) {
          const s = (p.activeSlot + c.wheel * i + SLOT_COUNT * SLOT_COUNT) % SLOT_COUNT;
          if (slotUsable(p, s) && p.guns[s]) {
            switchSlot(state, p, s);
            break;
          }
        }
      }
      const rec = p.recoil;
      const recoverRate = deg(9) * dt * (c.held.fire ? 0.35 : 1);
      rec.pitch = Math.max(0, rec.pitch - recoverRate - rec.pitch * 4 * dt * (c.held.fire ? 0.2 : 1));
      rec.yaw *= Math.max(0, 1 - 6 * dt);
      if (!c.held.fire) rec.heat = Math.max(0, rec.heat - 1.5 * dt);
      const g = activeGun(p);
      if (!g) continue;
      const st = effectiveGunStats(g, p);
      if (p.swapT > 0) {
        p.swapT -= dt;
        continue;
      }
      if (p.reloadT > 0) {
        p.reloadT -= dt;
        if (p.reloadT <= 0) {
          p.reloadT = 0;
          finishReload(state, p, g);
        }
        continue;
      }
      if (c.pressed.reload) {
        startReload(state, p, g);
        continue;
      }
      p.fireCd = Math.max(-0.05, p.fireCd - dt);
      if (!c.held.fire || p.fireCd > 0 || p.medkitT > 0) continue;
      if (g.ammoInMag <= 0) {
        startReload(state, p, g);
        continue;
      }
      p.fireCd += 1 / st.fireRate;
      if (!(st.ammoSaveChance > 0 && float(state.rng) < st.ammoSaveChance) && !state.tuning.infiniteAmmo) g.ammoInMag--;
      p.shotCounter++;
      const mega = g.wacky === "tenthMega" && p.shotCounter % 10 === 0;
      const eye = eyePos(p);
      const aim = dirFromYawPitch(p.yaw + rec.yaw, p.pitch + rec.pitch);
      const muzzle2 = { x: eye.x + aim.x * 0.5, y: eye.y + aim.y * 0.5 - 0.12, z: eye.z + aim.z * 0.5 };
      if (mega) {
        createProjectile(state, {
          kind: "megaBullet",
          ownerId: p.id,
          gunId: g.id,
          pos: muzzle2,
          vel: { x: aim.x * 40, y: aim.y * 40, z: aim.z * 40 },
          radius: 0.6,
          damage: st.damage * st.pellets * 6,
          element: g.element,
          elementChance: 1,
          critMult: st.critMult,
          pierce: 5,
          ttl: 3,
          arcane: g.arcane,
          splash: { radius: 3, damage: st.damage * st.pellets * 3, minFalloff: 0.4, selfMult: 0, knockback: 6 }
        });
      } else if (GUN_TYPES_BY_ID[g.type].projectile === "rubberBullet") {
        const d = coneDir(state, aim, st.spread);
        createProjectile(state, {
          kind: "rubberBullet",
          ownerId: p.id,
          gunId: g.id,
          pos: muzzle2,
          vel: { x: d.x * st.projectileSpeed, y: d.y * st.projectileSpeed + 2.5, z: d.z * st.projectileSpeed },
          radius: 0.24,
          gravity: 14,
          bounces: 1,
          damage: st.damage,
          element: g.element,
          elementChance: st.elementChance,
          critMult: st.critMult,
          critChance: st.critChance,
          ttl: 4,
          arcane: g.arcane,
          wacky: g.wacky,
          splash: { radius: st.splashRadius, damage: st.splashDamage, minFalloff: 0.35, selfMult: 0, knockback: 9 }
        });
      } else if (GUN_TYPES_BY_ID[g.type].projectile === "bigBullet") {
        const d = coneDir(state, aim, st.spread);
        createProjectile(state, {
          kind: "bigBullet",
          ownerId: p.id,
          gunId: g.id,
          pos: muzzle2,
          vel: { x: d.x * st.projectileSpeed, y: d.y * st.projectileSpeed, z: d.z * st.projectileSpeed },
          radius: 0.32,
          gravity: 4,
          damage: st.damage,
          element: g.element,
          elementChance: st.elementChance,
          critMult: st.critMult,
          critChance: st.critChance,
          pierce: st.pierce,
          ttl: 3,
          arcane: g.arcane,
          wacky: g.wacky,
          splash: { radius: st.splashRadius, damage: st.splashDamage, minFalloff: 0.4, selfMult: 0, knockback: 7 }
        });
      } else if (st.projectileSpeed > 0) {
        const d = coneDir(state, aim, st.spread);
        createProjectile(state, {
          kind: "rocket",
          ownerId: p.id,
          gunId: g.id,
          pos: muzzle2,
          vel: { x: d.x * st.projectileSpeed, y: d.y * st.projectileSpeed, z: d.z * st.projectileSpeed },
          radius: 0.2,
          damage: st.damage,
          element: g.element,
          elementChance: st.elementChance,
          critMult: st.critMult,
          ttl: 5,
          arcane: g.arcane,
          wacky: g.wacky,
          splash: { radius: st.splashRadius, damage: st.splashDamage, minFalloff: 0.3, selfMult: 0.35, knockback: 8 }
        });
      } else if (g.wacky === "rubberDuck") {
        for (let i = 0; i < st.pellets; i++) {
          const d = coneDir(state, aim, st.spread + 1);
          createProjectile(state, {
            kind: "duckBullet",
            ownerId: p.id,
            gunId: g.id,
            pos: muzzle2,
            vel: { x: d.x * 45, y: d.y * 45, z: d.z * 45 },
            radius: 0.18,
            gravity: 10,
            damage: st.damage * 1.15,
            element: g.element,
            elementChance: st.elementChance,
            critMult: st.critMult,
            critChance: st.critChance,
            bounces: 3,
            ttl: 3,
            arcane: g.arcane,
            wacky: g.wacky,
            pellet: st.pellets > 1
          });
        }
      } else {
        for (let i = 0; i < st.pellets; i++) fireHitscan(state, p, g, st, eye, coneDir(state, aim, st.spread));
      }
      rec.pitch += deg(st.recoil) * (1 + rec.heat * 0.6);
      rec.yaw += deg(st.recoilYaw) * range(state.rng, -1, 1);
      rec.pitch = Math.min(rec.pitch, deg(25));
      rec.heat = Math.min(1, rec.heat + 0.08);
      emit(state, "shot", { playerId: p.id, gunId: g.id, gunType: g.type, manufacturer: g.manufacturer, element: g.element, mega });
      if (g.ammoInMag <= 0) startReload(state, p, g);
    }
  }
  function playerVitals(state, dt) {
    for (const p of Object.values(state.players)) {
      p.invulnT = Math.max(0, p.invulnT - dt);
      p.lastDamageT += dt;
      p.lifestealBudget = Math.min(4, p.lifestealBudget + 4 * dt);
      p.xpCaps.dmg = Math.max(0, p.xpCaps.dmg - 15 * dt);
      p.xpCaps.weak = Math.max(0, p.xpCaps.weak - 10 * dt);
      const kf = p.buffs.killFrenzy;
      if (kf.stacks > 0) {
        kf.t -= dt;
        if (kf.t <= 0) kf.stacks = 0;
      }
      if (p.dead) {
        p.respawnT -= dt;
        if (state.mode === "sandbox" && p.respawnT <= 0) respawn(state, p);
        continue;
      }
      if (p.downed) {
        p.downedT -= dt;
        if (p.downedT <= 0) {
          p.dead = true;
          p.downed = false;
          p.respawnT = TUNING.sandboxRespawn;
          emit(state, "playerDied", { playerId: p.id });
        }
        continue;
      }
      if (p.shieldDelayT > 0) {
        p.shieldDelayT -= dt;
        if (p.shieldDelayT <= 0 && p.shield < p.maxShield) emit(state, "shieldRegenStart", { playerId: p.id });
      } else if (p.shield < p.maxShield) {
        p.shield = Math.min(p.maxShield, p.shield + TUNING.shieldRegen * (p.perks.quickShield ? TUNING.quickShieldRegenMult : 1) * dt);
      }
      const inAura = p.inAuraT > 0;
      if (p.spells.manaShieldOn) {
        p.mana -= 4 * dt;
        if (p.mana <= 0) {
          p.mana = 0;
          p.spells.manaShieldOn = false;
          emit(state, "manaShieldOff", { playerId: p.id });
        }
      } else if (!inAura) {
        p.mana = Math.min(p.maxMana, p.mana + TUNING.manaRegen * dt);
      }
      if (state.tuning.godMode) {
        p.mana = p.maxMana;
        godTopUp(p);
      }
      if (p.inAuraT > 0) p.inAuraT -= dt;
    }
  }
  function godTopUp(p) {
    if (p.tickets < TUNING.godTickets) p.tickets = TUNING.godTickets;
    for (const k of Object.keys(p.ammoCap)) if (p.ammo[k] < p.ammoCap[k]) p.ammo[k] = p.ammoCap[k];
    if (p.medkits < TUNING.medkitCarry) p.medkits = TUNING.medkitCarry;
  }
  function respawn(state, p) {
    p.dead = false;
    p.downed = false;
    p.hp = p.maxHp;
    p.shield = p.maxShield;
    p.mana = p.maxMana;
    p.pos = { x: 0, y: 0, z: 8 };
    p.prevPos = { ...p.pos };
    p.vel = { x: 0, y: 0, z: 0 };
    p.invulnT = 2;
    p.unkillableUsed = false;
    if (p.downCount != null) delete p.downCount;
    emit(state, "playerRespawn", { playerId: p.id });
  }

  // src/sim/economy.js
  function startCraft(state, p) {
    return fail(state, p, "Crafting is gone");
  }
  function crafting() {
  }
  function salvage(state, p) {
    return fail(state, p, "Crafting is gone");
  }
  function reroll(state, p) {
    return fail(state, p, "Crafting is gone");
  }
  function fail(state, p, reason) {
    emit(state, "actionFailed", { playerId: p.id, reason });
    return false;
  }
  function ensureActiveGun(p) {
    if (p.guns[p.activeSlot]) return;
    const i = p.guns.findIndex((g, idx) => g && slotUsable(p, idx));
    if (i >= 0) p.activeSlot = i;
  }
  function pickupGun(state, p, pickupId) {
    const k = state.pickups.find((x) => x.id === pickupId && !x.dead && x.kind === "gun");
    if (!k) return;
    if (Math.hypot(p.pos.x - k.pos.x, p.pos.z - k.pos.z) > TUNING.gunPickupRadius + 1) return;
    const gun = k.gun;
    const legendary = gun.quality === "legendary";
    let slot = -1;
    if (legendary && !p.guns[LEGENDARY_SLOT]) slot = LEGENDARY_SLOT;
    else for (let i = 0; i < p.unlockedSlots; i++) if (!p.guns[i]) {
      slot = i;
      break;
    }
    if (slot === -1 && legendary) slot = LEGENDARY_SLOT;
    k.dead = true;
    if (slot === -1 || p.guns[slot]) {
      if (slot === -1) slot = p.activeSlot === LEGENDARY_SLOT ? 0 : p.activeSlot;
      const old = p.guns[slot];
      if (old) {
        createPickup(state, { kind: "gun", gun: old, pos: { x: p.pos.x, y: 1, z: p.pos.z }, vel: { x: 0, y: 4, z: 0 }, ttl: TUNING.gunPickupTtl });
        emit(state, "gunDropped", { gunId: old.id, slot });
      }
    }
    p.guns[slot] = gun;
    p.activeSlot = slot;
    p.reloadT = 0;
    p.swapT = 0.3;
    emit(state, "gunPickedUp", { playerId: p.id, gunId: gun.id, slot, quality: gun.quality });
  }
  function dropGun(state, p, slot) {
    const g = p.guns[slot];
    if (!g || p.guns.filter(Boolean).length <= 1) return;
    p.guns[slot] = null;
    createPickup(state, { kind: "gun", gun: g, pos: { x: p.pos.x, y: 1, z: p.pos.z }, vel: { x: -Math.sin(p.yaw) * 3, y: 4, z: -Math.cos(p.yaw) * 3 }, ttl: TUNING.gunPickupTtl });
    ensureActiveGun(p);
    emit(state, "gunDropped", { gunId: g.id, slot });
  }
  function rollShopOffers(state) {
    state.shop.offers = [];
    for (let i = 0; i < SHOP.offerCount; i++) {
      const gun = generateGun({ seed: next(state.rng), level: state.tier, forced: { type: rollGunType(state.rng), quality: rollQuality(state.rng, "shop") } });
      gun.id = nextId(state);
      gun.source = "shop";
      state.shop.offers.push({ id: nextId(state), gun, price: shopPrice(gun, state.tier), sold: false });
    }
  }
  var shopOpen = (state) => state.mode === "sandbox" || state.wave && (state.wave.phase === "intermission" || state.wave.phase === "victory");
  function buyOffer(state, p, offerId) {
    if (!shopOpen(state)) return fail(state, p, "Shop is closed during combat");
    const o = state.shop.offers.find((x) => x.id === offerId);
    if (!o || o.sold) return;
    if (p.tickets < o.price) return fail(state, p, "Not enough tickets");
    p.tickets -= o.price;
    o.sold = true;
    spawnGunPickup(state, o.gun, { x: p.pos.x - Math.sin(p.yaw) * 2, z: p.pos.z - Math.cos(p.yaw) * 2 }, "shop");
    emit(state, "purchase", { playerId: p.id, item: "gun", price: o.price });
  }
  function rerollShop(state, p) {
    if (!shopOpen(state)) return;
    const price = SHOP.rerollBase + SHOP.rerollStep * state.shop.rerolls;
    if (p.tickets < price) return fail(state, p, "Not enough tickets");
    p.tickets -= price;
    state.shop.rerolls++;
    rollShopOffers(state);
    emit(state, "purchase", { playerId: p.id, item: "reroll", price });
  }
  function sellGun(state, p, slot) {
    if (!shopOpen(state)) return fail(state, p, "Shop is closed during combat");
    const g = p.guns[slot];
    if (!g || p.guns.filter(Boolean).length <= 1) return fail(state, p, "Can't sell your last gun");
    const v = sellValue(g);
    p.tickets += v;
    state.run.ticketsEarned += v;
    p.guns[slot] = null;
    ensureActiveGun(p);
    emit(state, "sold", { playerId: p.id, gunId: g.id, value: v });
  }
  function vend(state, p) {
    if (!shopOpen(state)) return;
    if (p.tickets < SHOP.vendPrice) return fail(state, p, "Not enough tickets");
    p.tickets -= SHOP.vendPrice;
    const o = weighted(state.rng, SHOP.vendOutcomes).id;
    const spot = { x: p.pos.x - Math.sin(p.yaw) * 2, z: p.pos.z - Math.cos(p.yaw) * 2 };
    let detail = "";
    if (o === "gun") {
      const gun = generateGun({ seed: next(state.rng), level: state.tier, forced: { type: rollGunType(state.rng), quality: rollQuality(state.rng, "vending") } });
      gun.id = nextId(state);
      spawnGunPickup(state, gun, spot, "vending");
      detail = `${gun.quality} ${gun.type}`;
    } else if (o === "resources") {
      const carried = p.guns.filter((g) => g);
      const t = carried.length ? carried[0].ammoType : "bullets";
      const add3 = TUNING.ammoDrop[t] || 0;
      p.ammo[t] = Math.min(p.ammoCap[t], p.ammo[t] + add3);
      detail = `${add3} ${t}`;
    } else if (o === "jackpot") {
      p.tickets += 60;
      detail = "60 tickets";
    } else {
      healPlayer(p, 1);
      detail = "Rubber Chicken";
    }
    emit(state, "vend", { playerId: p.id, outcome: o, detail });
  }
  function buyUpgrade(state, p, id) {
    if (!shopOpen(state)) return;
    const def = SHOP.upgrades.find((u4) => u4.id === id);
    const up = state.shop.upgrades;
    const rank = id === "slot4" ? up.slot4 ? 1 : 0 : up[id];
    if (!def || rank >= def.prices.length) return fail(state, p, "Maxed out");
    const price = def.prices[rank];
    if (p.tickets < price) return fail(state, p, "Not enough tickets");
    p.tickets -= price;
    if (id === "slot4") {
      up.slot4 = true;
      p.unlockedSlots = 4;
    } else up[id]++;
    applySkillPassives(state, p);
    if (id === "shieldCap") p.shield = p.maxShield;
    emit(state, "purchase", { playerId: p.id, item: id, price });
  }
  function buySupply(state, p, id) {
    if (!shopOpen(state)) return;
    const def = SHOP.supplies.find((s) => s.id === id);
    if (!def) return;
    if (p.tickets < def.price) return fail(state, p, "Not enough tickets");
    if (id === "medkit" && p.medkits >= TUNING.medkitCarry) return fail(state, p, "Medkits full");
    p.tickets -= def.price;
    if (id === "ammoRefill") for (const k of Object.keys(p.ammo)) p.ammo[k] = p.ammoCap[k];
    if (id === "medkit") p.medkits++;
    emit(state, "purchase", { playerId: p.id, item: id, price: def.price });
  }

  // src/sim/waves.js
  function startWaves(state, tier) {
    state.mode = "waves";
    state.tier = tier;
    state.enemies.length = 0;
    state.projectiles.length = 0;
    state.hazards.length = 0;
    state.allies.length = 0;
    state.wave = { index: 0, phase: "pre", t: 0, groupIdx: 0, spawnQueue: [], spawnedCount: 0, killedCount: 0, totalCount: 0, bossIds: [], intermissionT: 0 };
    initWave(state, 0);
    for (const p of Object.values(state.players)) {
      p.unkillableUsed = false;
    }
    emit(state, "modeStart", { mode: "waves", tier });
  }
  function initWave(state, idx) {
    const w = state.wave;
    const cfg = tierWave(idx, state.tier);
    w.index = idx;
    w.phase = "pre";
    w.t = 0;
    w.groupIdx = 0;
    w.spawnQueue = [];
    w.spawnedCount = 0;
    w.killedCount = 0;
    w.totalCount = cfg.groups.reduce((n, g) => n + g.spawns.reduce((m, s) => m + s.count, 0), 0);
    w.bossIds = [];
    if (w.lateIdx != null) delete w.lateIdx;
    emit(state, "wavePre", { waveIndex: idx, name: cfg.name });
  }
  var alive = (state) => state.enemies.filter((e) => !e.dead && !e.boss && e.type !== "dummy").length;
  function pickPoints(state, pattern, n) {
    const p = state.players[state.localPlayerId];
    const pts = state.spawnPoints.map((s, i) => ({ ...s, i, d: Math.hypot(s.x - p.pos.x, s.z - p.pos.z) })).filter((s) => s.d >= 10);
    if (!pts.length) return [state.spawnPoints[0]];
    if (pattern === "cluster") {
      const c = pts[Math.floor(float(state.rng) * pts.length)];
      const N = state.spawnPoints.length;
      return Array.from({ length: n }, (_, k) => state.spawnPoints[(c.i + k % 3 - 1 + N) % N]);
    }
    if (pattern === "spread") {
      pts.sort((a, b) => b.d - a.d);
      const out = [];
      const N = state.spawnPoints.length;
      for (const s of pts) {
        if (out.every((o) => (o.i - s.i + N) % N >= 4 && (s.i - o.i + N) % N >= 4)) out.push(s);
      }
      return Array.from({ length: n }, (_, k) => out[k % out.length]);
    }
    return Array.from({ length: n }, () => pts[Math.floor(float(state.rng) * pts.length)]);
  }
  function waveDirector(state, dt) {
    const w = state.wave;
    if (state.mode !== "waves" || !w) return;
    const cfg = tierWave(w.index, state.tier);
    const p = state.players[state.localPlayerId];
    w.t += dt;
    state.run.time += dt;
    if (p.dead && w.phase !== "defeat" && w.phase !== "victory") {
      w.phase = "defeat";
      w.t = 0;
      const lost = Math.floor(state.run.ticketsEarned * 0.5);
      p.tickets = Math.max(0, p.tickets - lost);
      emit(state, "defeat", { tier: state.tier, ticketsLost: lost });
      return;
    }
    switch (w.phase) {
      case "pre":
        if (w.t >= 3) {
          w.phase = "combat";
          w.t = 0;
          emit(state, "waveStart", { waveIndex: w.index, name: cfg.name });
        }
        break;
      case "combat": {
        while (w.groupIdx < cfg.groups.length) {
          const g = cfg.groups[w.groupIdx];
          const ready = w.t >= g.at || g.aliveBelow != null && alive(state) + w.spawnQueue.length <= g.aliveBelow && w.t >= 2;
          if (!ready) break;
          const list = [];
          for (const s of g.spawns) for (let i = 0; i < s.count; i++) list.push({ type: s.type, elite: i < s.elites });
          const pts = pickPoints(state, g.pattern, list.length);
          list.forEach((it, i) => w.spawnQueue.push({ ...it, delay: i * 0.35, pt: pts[i] }));
          w.groupIdx++;
        }
        for (const q2 of w.spawnQueue) q2.delay -= dt;
        for (let i = 0; i < w.spawnQueue.length; i++) {
          const q2 = w.spawnQueue[i];
          if (q2.delay > 0 || alive(state) >= cfg.maxAlive) continue;
          w.spawnQueue.splice(i--, 1);
          const pos = { x: q2.pt.x + range(state.rng, -0.8, 0.8), z: q2.pt.z + range(state.rng, -0.8, 0.8) };
          createHazard(state, { kind: "spawnPortal", pos: { x: pos.x, y: 0, z: pos.z }, radius: 1.2, ttl: 0.8 });
          createEnemy(state, q2.type, { elite: q2.elite, pos });
          w.spawnedCount++;
        }
        if (w.groupIdx >= cfg.groups.length && !w.spawnQueue.length && alive(state) === 0) {
          if (cfg.boss) {
            w.phase = "bossIntro";
            w.t = 0;
            emit(state, "bossIntro", { types: cfg.boss.types });
          } else {
            w.phase = "cleared";
            w.t = 0;
            clearWave(state);
          }
        }
        break;
      }
      case "bossIntro":
        if (w.t >= cfg.boss.introDelay) {
          const paired = cfg.boss.types.length > 1;
          const away = Math.atan2(-p.pos.x, -p.pos.z) + (Math.hypot(p.pos.x, p.pos.z) < 1 ? Math.PI : 0);
          cfg.boss.types.forEach((type, i) => {
            const ang = away + (paired ? i === 0 ? -0.9 : 0.9 : 0);
            const pos = { x: Math.sin(ang) * 22, z: Math.cos(ang) * 22 };
            const b = createBoss(state, type, { pos, paired });
            w.bossIds.push(b.id);
            emit(state, "bossSpawn", { id: b.id, bossType: type });
          });
          w.phase = "boss";
          w.t = 0;
        }
        break;
      case "boss": {
        const bossCount = state.enemies.filter((e) => !e.dead && w.bossIds.includes(e.id)).length;
        const late = cfg.boss.late || [];
        if ((w.lateIdx || 0) < late.length && bossCount <= 1) {
          const type = late[w.lateIdx || 0];
          w.lateIdx = (w.lateIdx || 0) + 1;
          const away = Math.atan2(-p.pos.x, -p.pos.z) + (Math.hypot(p.pos.x, p.pos.z) < 1 ? Math.PI : 0);
          const b = createBoss(state, type, { pos: { x: Math.sin(away) * 22, z: Math.cos(away) * 22 } });
          b.maxHp = Math.round(b.maxHp * cfg.boss.lateHp);
          b.hp = b.maxHp;
          w.bossIds.push(b.id);
          emit(state, "bossIntro", { types: [type] });
          emit(state, "bossSpawn", { id: b.id, bossType: type });
          break;
        }
        if (bossCount === 0 && alive(state) === 0) {
          w.phase = "cleared";
          w.t = 0;
          clearWave(state);
        }
        break;
      }
      case "cleared":
        if (w.t >= 2) {
          if (w.index >= WAVES.length - 1) {
            w.phase = "victory";
            w.t = 0;
            const tk = Math.round(VICTORY_TICKETS * tierRewardMult(state.tier));
            p.tickets += tk;
            state.run.ticketsEarned += tk;
            const gun = generateGun({ seed: next(state.rng), level: state.tier, forced: { type: rollGunType(state.rng), quality: "legendary" } });
            gun.id = nextId(state);
            spawnGunPickup(state, gun, { x: 0, z: 0 }, "boss");
            rollShopOffers(state);
            emit(state, "victory", { tier: state.tier, tickets: tk });
          } else {
            w.phase = "intermission";
            w.t = 0;
            w.intermissionT = INTERMISSION_TIME;
            rollShopOffers(state);
            for (const pl of Object.values(state.players)) pl.unkillableUsed = false;
            emit(state, "intermissionStart", { waveIndex: w.index });
          }
        }
        break;
      case "intermission":
        w.intermissionT -= dt;
        if (w.intermissionT <= 0 || p.cmd && p.cmd.pressed.skip) {
          emit(state, "intermissionEnd", { waveIndex: w.index });
          initWave(state, w.index + 1);
        }
        break;
    }
  }
  function clearWave(state) {
    const w = state.wave;
    const cfg = tierWave(w.index, state.tier);
    const p = state.players[state.localPlayerId];
    const tk = Math.round(cfg.clearTickets * tierRewardMult(state.tier));
    p.tickets += tk;
    state.run.ticketsEarned += tk;
    emit(state, "waveCleared", { waveIndex: w.index, tickets: tk });
    emit(state, "ticketsGained", { amount: tk, reason: "Wave clear" });
    const spell = nextWaveSpell(p.spellUnlocks, state.tier);
    if (spell) {
      grantSpell(state, p, spell);
      emit(state, "spellUnlocked", { playerId: p.id, spellId: spell });
    }
    for (const pl of Object.values(state.players)) if (pl.downCount != null) delete pl.downCount;
  }

  // src/sim/campaign/weather.js
  function clearWeather(lv) {
    if (lv.whiteout) delete lv.whiteout;
    if (lv.whiteoutWarn != null) delete lv.whiteoutWarn;
    if (lv.sightCap) delete lv.sightCap;
    if (lv.viewCap) delete lv.viewCap;
    if (lv._wx) delete lv._wx;
    if (lv._weatherT != null) delete lv._weatherT;
    if (lv._weatherSec) delete lv._weatherSec;
  }
  function nextWindow(weather, t) {
    const dur = weather.whiteout || 20;
    const period = weather.period || 90;
    const listed = weather.windows || [];
    let on = false;
    let next2 = Infinity;
    for (let i = 0; i < listed.length; i++) {
      const start2 = listed[i][0];
      const end = listed[i][1];
      if (t >= start2 && t < end) on = true;
      if (start2 > t && start2 < next2) next2 = start2;
    }
    const origin = listed.length ? listed[0][0] : 0;
    if (period > 0) {
      const n = Math.floor((t - origin) / period);
      for (let k = Math.max(0, n); k <= n + 2; k++) {
        const start2 = origin + k * period;
        if (t >= start2 && t < start2 + dur) on = true;
        if (start2 > t && start2 < next2) next2 = start2;
      }
    }
    return { on, next: next2 };
  }
  function tickWeather(state, sec, dt) {
    const lv = state.level;
    if (!lv) return;
    const list = sec && sec.mechanisms || [];
    let weather = null;
    for (let i = 0; i < list.length; i++) if (list[i].kind === "weather") {
      weather = list[i];
      break;
    }
    if (!weather) {
      clearWeather(lv);
      return;
    }
    if (lv._weatherSec !== sec.id) {
      lv._weatherSec = sec.id;
      lv._weatherT = 0;
      if (lv._wx) delete lv._wx;
    }
    lv._weatherT += dt;
    const { on, next: next2 } = nextWindow(weather, lv._weatherT);
    const warnFor = weather.warning || 0;
    const soon = !on && next2 < Infinity && next2 - lv._weatherT <= warnFor && next2 - lv._weatherT > 0;
    const phase = on ? "on" : soon ? "warn" : "off";
    if (on) {
      lv.whiteout = true;
      lv.sightCap = weather.sightCap || 40;
      lv.viewCap = weather.viewCap || 40;
      if (lv.whiteoutWarn != null) delete lv.whiteoutWarn;
    } else {
      if (lv.whiteout) delete lv.whiteout;
      if (lv.sightCap) delete lv.sightCap;
      if (lv.viewCap) delete lv.viewCap;
      if (soon) lv.whiteoutWarn = next2 - lv._weatherT;
      else if (lv.whiteoutWarn != null) delete lv.whiteoutWarn;
    }
    if (lv._wx !== phase) {
      const prev = lv._wx;
      lv._wx = phase;
      if (phase === "warn") emit(state, "whiteoutWarn", { id: weather.id, in: next2 - lv._weatherT });
      else if (phase === "on") emit(state, "whiteout", { id: weather.id });
      else if (prev === "on") emit(state, "whiteoutLift", { id: weather.id });
    }
  }

  // src/sim/campaign/sectionMotion.js
  function pointOn(from, to, u4) {
    return {
      x: from[0] + (to[0] - from[0]) * u4,
      y: (from[1] || 0) + ((to[1] || 0) - (from[1] || 0)) * u4,
      z: from[2] + (to[2] - from[2]) * u4
    };
  }
  function lengthOf(from, to) {
    const dy = (to[1] || 0) - (from[1] || 0);
    return Math.hypot(to[0] - from[0], dy, to[2] - from[2]) || 1;
  }
  function near(p, q2, r) {
    return Math.hypot(p.pos.x - q2.x, p.pos.z - q2.z) <= r && Math.abs(p.pos.y - q2.y) < 2.2;
  }
  function rideBook(lv) {
    if (!lv.rides) lv.rides = {};
    return lv.rides;
  }
  function stepPlatform(st, from, to, speed, dt, pause) {
    const len = lengthOf(from, to);
    const prev = pointOn(from, to, st.u);
    if (st.pause > 0) {
      st.pause -= dt;
      return { prev, next: prev };
    }
    st.u += (st.dir || 1) * (speed / len) * dt;
    if (st.u >= 1) {
      st.u = 1;
      st.dir = -1;
      st.pause = pause || 0;
    } else if (st.u <= 0) {
      st.u = 0;
      st.dir = 1;
      st.pause = pause || 0;
    }
    return { prev, next: pointOn(from, to, st.u) };
  }
  function carry(p, prev, next2) {
    if (!near(p, prev, 1.35)) return;
    p.pos.x += next2.x - prev.x;
    p.pos.y = next2.y;
    p.pos.z += next2.z - prev.z;
  }
  function noteSafeGround(state, sec) {
    const v = sec && sec.voidRescue;
    const lv = state.level;
    if (!v) {
      if (lv.safePos && !lv.padSafe) delete lv.safePos;
      return;
    }
    const p = state.players[state.localPlayerId];
    if (!p || p.pos.y < v.y + 2) return;
    lv.safePos = { x: p.pos.x, y: Math.max(0, p.pos.y), z: p.pos.z };
  }
  function tickVoid(state, sec) {
    const v = sec && sec.voidRescue;
    if (!v) return;
    const lv = state.level;
    const p = state.players[state.localPlayerId];
    if (p && p.pos.y < v.y) {
      const back = lv.safePos || { x: sec.start[0], y: sec.start[1] || 0, z: sec.start[2] };
      p.pos.x = back.x;
      p.pos.y = back.y;
      p.pos.z = back.z;
      p.vel.x = 0;
      p.vel.y = 0;
      p.vel.z = 0;
      damagePlayer(state, p, { base: p.maxHp * (v.penalty == null ? 0.25 : v.penalty), sourceKind: "world", fromPos: { x: back.x, y: back.y, z: back.z } });
      emit(state, "voidRescue", { penalty: v.penalty == null ? 0.25 : v.penalty });
    }
    for (const e of state.enemies) {
      if (e.dead || e.pos.y >= v.y) continue;
      e.noAmmoDrop = true;
      e.lastHit = { sourceId: p ? p.id : 0, sourceKind: "world", element: "none" };
      onEnemyKilled(state, e);
    }
  }
  function tickRides(state, sec, dt) {
    const carpets = sec && sec.carpets || [];
    const zips = (sec && sec.links || []).filter((link) => link.kind === "zipline");
    const lv = state.level;
    if (!carpets.length && !zips.length) {
      if (lv.rides) delete lv.rides;
      return;
    }
    const book3 = rideBook(lv);
    const p = state.players[state.localPlayerId];
    if (!p) return;
    for (const c of carpets) {
      if (!c.from || !c.to) continue;
      const st = book3[c.id] || (book3[c.id] = { u: 0, dir: 1, pause: 0, armed: c.mode !== "onTrigger" });
      if (!st.armed) {
        if (near(p, pointOn(c.from, c.to, 0), 1.35)) st.armed = true;
        else continue;
      }
      const pause = c.mode === "onTrigger" ? c.returnAfter == null ? 4 : c.returnAfter : c.pause || 0;
      const moved = stepPlatform(st, c.from, c.to, c.speed || 3, dt, pause);
      if (st.u === 1) st.reached = true;
      carry(p, moved.prev, moved.next);
      if (c.mode === "onTrigger" && st.reached && st.u === 0 && st.pause <= 0) {
        st.armed = false;
        st.reached = false;
      }
    }
    for (const z of zips) {
      if (!z.from || !z.to) continue;
      const st = book3[z.id] || (book3[z.id] = { u: 0, dir: 1, pause: 0, riding: false });
      if (!st.riding) {
        if (near(p, pointOn(z.from, z.to, 0), 1.2)) st.riding = true;
        else continue;
      }
      const len = lengthOf(z.from, z.to);
      const prev = pointOn(z.from, z.to, st.u);
      st.u = Math.min(1, st.u + (z.speed || 16) / len * dt);
      const next2 = pointOn(z.from, z.to, st.u);
      p.pos.x += next2.x - prev.x;
      p.pos.y = next2.y;
      p.pos.z += next2.z - prev.z;
      if (st.u >= 1) {
        st.riding = false;
        st.u = 0;
      }
    }
  }

  // src/sim/campaign/campaign.js
  var snaps = /* @__PURE__ */ new WeakMap();
  function exportCampaignCheckpoints(state, clone2 = structuredClone) {
    const saved = snaps.get(state);
    return saved ? Object.keys(saved).sort().map((id) => ({ id, state: clone2(saved[id]) })) : [];
  }
  function importCampaignCheckpoints(state, entries) {
    const saved = /* @__PURE__ */ Object.create(null);
    for (const entry of entries) saved[entry.id] = structuredClone(entry.state);
    snaps.set(state, saved);
  }
  function startCampaign(state, p, levelId) {
    const rt = getLevelRuntime(levelId || "L01");
    const first = rt.sections[0];
    state.mode = "campaign";
    state.wave = null;
    state.bossFight = null;
    state.testMode = false;
    state.tier = rt.tier || 1;
    const jet = rt.jetpack === true;
    state.level = {
      id: rt.id,
      name: rt.name,
      stage: rt.stage,
      section: first.id,
      parTime: rt.parTime || 0,
      objective: "Move up",
      won: false,
      lost: false,
      transition: null,
      intro: first.intro || null,
      cleared: {},
      spawned: {},
      got: {},
      modifiers: {},
      fuel: jet ? 100 : 0,
      gravityMult: rt.gravityMult || 1,
      time: 0
    };
    p.unlockedSlots = 4;
    clearCampaignSpells(state, p);
    if (rt.startAmmo) {
      for (const k of Object.keys(rt.startAmmo)) p.ammo[k] = rt.startAmmo[k];
    }
    p.jetpack = jet;
    p.campaignSpeed = 1;
    p.pos = { x: first.start[0], y: first.start[1], z: first.start[2] };
    p.prevPos = { ...p.pos };
    p.vel = { x: 0, y: 0, z: 0 };
    p.yaw = first.yaw || 0;
    if (rt.format === "v2") {
      beginV2(state);
      noteV2Section(state, first, rt);
    }
    emit(state, "modeStart", { mode: "campaign", tier: state.tier, level: rt.id });
    if (first.intro) emit(state, "levelCard", { title: first.intro.title, lines: first.intro.lines });
    saveCheckpoint(state, "start");
  }
  function transitionDone(state) {
    const lv = state.level;
    if (!lv || state.mode !== "campaign") return;
    if (lv.transition) {
      lv.section = lv.transition.to;
      lv.transition = null;
      const sec = sectionById(lv.id, lv.section);
      lv.intro = sec && sec.intro ? sec.intro : null;
      if (lv.format === "v2") noteV2Section(state, sec, getLevelRuntime(lv.id));
      if (lv.intro) emit(state, "levelCard", { title: lv.intro.title, lines: lv.intro.lines });
    } else if (lv.intro) lv.intro = null;
  }
  function campaignPre(state, dt) {
    const lv = state.level;
    if (!lv || lv.won || lv.lost) return;
    lv.time += dt;
    if (lv.fuelTimer > 0) {
      lv.fuelTimer -= dt;
      if (lv.fuelTimer <= 0) {
        lv.fuelTimer = 0;
        if (lv.modifiers) lv.modifiers.fuelInfinite = false;
      }
    }
    const p = state.players[state.localPlayerId];
    if (p.padCd > 0) p.padCd -= dt;
    const sec = sectionById(lv.id, lv.section);
    if (!sec) return;
    tickAlarms(state, dt);
    tickWeather(state, sec, dt);
    for (const m of sec.mechanisms || []) {
      touchMechanism(state, p, lv, sec, m, dt);
      tickZoneDamage(state, p, m, dt);
      tickGeyser(state, p, m);
      tickRising(state, p, m, dt);
    }
    for (const g of sec.geysers || []) tickGeyser(state, p, g.kind ? g : { ...g, kind: "geyser" });
    noteSafeGround(state, sec);
    let zoned = false;
    for (const m of sec.mechanisms || []) if (isZone(m)) {
      zoned = true;
      break;
    }
    if (!zoned && sec.hazards && sec.hazards.length) zoned = true;
    if (zoned) {
      state._campaignSection = sec;
      const slow = playerZoneSlow(lv, sec, p);
      if (slow < 1) p.hazardSlow = slow;
      else if (p.hazardSlow != null) delete p.hazardSlow;
      if (lv._zonesDirty || lv._zoneSec !== sec.id) publishSlowZones(lv, sec);
      lv._zoneSec = sec.id;
    } else if (state._campaignSection || lv.slowZones || p.hazardSlow != null || lv._zoneSec) {
      delete state._campaignSection;
      delete lv.slowZones;
      delete lv._zoneSec;
      if (p.hazardSlow != null) delete p.hazardSlow;
    }
    for (const w of sec.weapons || []) {
      if (lv.got[w.id]) continue;
      if (!nearPoint(w.at, p.pos.x, p.pos.y + 1, p.pos.z, 3.2)) continue;
      lv.got[w.id] = true;
      giveWorldGun(state, p, w.gun);
    }
    for (const c of sec.checkpoints || []) {
      if (lv.got[c.id]) continue;
      if (c.when && !flagOn(lv, c.when)) continue;
      if (Math.hypot(p.pos.x - c.at[0], p.pos.z - c.at[2]) > 2.2) continue;
      lv.got[c.id] = true;
      saveCheckpoint(state, c.id);
      emit(state, "checkpoint", { id: c.id });
    }
    if (lv.format === "v2") {
      v2Pre(state, dt);
      return;
    }
    for (const enc of sec.encounters || []) {
      if (lv.spawned[enc.id] || lv.cleared[enc.id]) continue;
      if (!inBox(enc.activate, p.pos.x, p.pos.y, p.pos.z)) continue;
      lv.spawned[enc.id] = true;
      spawnSquad(state, enc);
    }
    lv.objective = objectiveText(lv, sec);
  }
  function hurtEnemiesInHazard(state, p, m, dt) {
    for (const e of state.enemies) {
      if (e.dead || e.type === "gooGlob" || e.type && e.type.startsWith("gooGlob")) continue;
      if (!inBox(m, e.pos.x, e.pos.y, e.pos.z)) continue;
      e.hp -= m.enemyDps * dt;
      if (m.stripsBark && e.ai && e.ai.armour && e.ai.armour !== "stripped") e.ai.armour = "stripped";
      if (e.hp <= 0) {
        e.lastHit = { sourceId: p.id, sourceKind: "world", element: "none" };
        onEnemyKilled(state, e);
      }
    }
  }
  function campaignPost(state, dt) {
    const lv = state.level;
    if (!lv || lv.won || lv.lost) return;
    const motionSec = sectionById(lv.id, lv.section);
    if (motionSec) {
      tickVoid(state, motionSec);
      tickRides(state, motionSec, dt);
    }
    for (const e of state.enemies) {
      if (e.dead || !e.boss || !BOSSES[e.type] || !BOSSES[e.type].campaign) continue;
      tickDuelBoss(state, e, dt);
    }
    if (lv.format === "v2") {
      tickLava(state, state.players[state.localPlayerId], dt);
      v2Post(state, dt);
      const again = state.level;
      if (again && again._rewind) {
        const encounter = again._rewind;
        delete again._rewind;
        if (restoreCheckpoint(state)) emit(state, "lockdownReset", { encounter });
        else {
          state.level.lost = true;
          emit(state, "levelLost", { level: state.level.id });
        }
      }
      return;
    }
    const p = state.players[state.localPlayerId];
    for (const e of state.enemies) {
      if (e.dead || e.type !== "daycare") continue;
      e.ai.nestT = (e.ai.nestT || 1.2) - dt;
      if (e.ai.nestT > 0) continue;
      e.ai.nestT = 2.4;
      const n = state.enemies.filter((o) => !o.dead && o.summoned && o.campaignEnc === e.campaignEnc).length;
      if (n >= 2) continue;
      const baby = createEnemy(state, "midget", { pos: { x: e.pos.x + 1, z: e.pos.z }, summoned: true });
      baby.campaignEnc = e.campaignEnc;
    }
    const rt = getLevelRuntime(lv.id);
    const sec = sectionById(lv.id, lv.section);
    if (sec) {
      for (const enc of sec.encounters) {
        if (!lv.spawned[enc.id] || lv.cleared[enc.id]) continue;
        for (const e of state.enemies) {
          if (e.dead || e.campaignEnc !== enc.id || !enc.fleeAt || !e.boss) continue;
          if (e.hp / e.maxHp <= enc.fleeAt) {
            e.dead = true;
            e.fled = true;
            if (!lv.fled) lv.fled = {};
            lv.fled[enc.id] = true;
            emit(state, "bossEscape", { id: e.id, bossType: e.type });
          }
        }
        const alive2 = state.enemies.some((e) => !e.dead && e.campaignEnc === enc.id);
        if (!alive2) {
          lv.cleared[enc.id] = true;
          emit(state, "encounterClear", { id: enc.id });
        }
      }
    }
    applyModifiers(state, p, dt);
    if (p.dead) {
      lv.lost = true;
      emit(state, "levelLost", { level: lv.id });
      return;
    }
    if (sec && sec.exit && sectionClear(sec, lv) && !lv.transition && inBox(sec.exit, p.pos.x, p.pos.y, p.pos.z)) {
      lv.transition = { to: sec.exit.to, kind: sec.exit.kind, card: sec.exit.card };
      emit(state, "sectionExit", { from: sec.id, to: sec.exit.to });
    }
    if (everyEncounterClear(rt, lv)) {
      lv.won = true;
      lv.objective = "Level clear";
      emit(state, "levelClear", { level: lv.id, time: lv.time, par: lv.parTime });
    } else if (sec) lv.objective = objectiveText(lv, sec);
  }
  function sectionClear(sec, lv) {
    return (sec.encounters || []).every((e) => lv.cleared[e.id]);
  }
  function everyEncounterClear(rt, lv) {
    for (const s of rt.sections) for (const e of s.encounters) if (!lv.cleared[e.id]) return false;
    return rt.sections.length > 0;
  }
  function objectiveText(lv, sec) {
    const enc = (sec.encounters || []).find((e) => !lv.cleared[e.id]);
    if (!enc) return sec.exit ? `Exit: ${sec.name}` : "Level clear";
    if (enc.objective.kind === "boss") return enc.fleeAt ? "Drive it off" : "Defeat the boss";
    return `Clear ${sec.name}`;
  }
  function flagOn(lv, when) {
    if (!when) return true;
    if (when.endsWith(".cleared")) return !!lv.cleared[when.slice(0, -".cleared".length)];
    if (when.endsWith(".fled")) return !!(lv.fled && lv.fled[when.slice(0, -".fled".length)]);
    if (when.endsWith(".destroyed")) return !!(lv.v2 && lv.v2.parts && lv.v2.parts[when.slice(0, -".destroyed".length)]);
    if (when.startsWith("switch:")) return !!lv.got[when.slice("switch:".length)];
    return !!lv.got[when];
  }
  function touchMechanism(state, p, lv, sec, m, dt) {
    const x = p.pos.x, y = p.pos.y, z = p.pos.z;
    if (m.kind === "switch" && !lv.got[m.id] && nearPoint(m.at, x, y + 1, z, 1.5)) tickSwitch(state, p, m, dt);
    if (m.kind === "depot" && m.at && nearPoint(m.at, x, y + 1, z, 2.4)) {
      if (p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + 30 * dt);
      for (const type of Object.keys(p.ammo)) {
        const cap = p.ammoCap[type];
        if (p.ammo[type] < cap) p.ammo[type] = Math.min(cap, p.ammo[type] + 40 * dt);
      }
      for (const g of p.guns) {
        if (g && g.stats && g.ammoInMag < g.stats.magSize) g.ammoInMag = g.stats.magSize;
      }
    }
    if (m.kind === "door" && m.opens && m.opens !== "p.jet.has" && !lv.got[m.id] && flagOn(lv, m.opens)) {
      lv.got[m.id] = true;
      emit(state, "door", { id: m.id, open: true });
    }
    if (m.kind === "jumpPad" && !(p.padCd > 0) && nearPoint(m.at, x, 0, z, m.r || 1.4) && p.onGround) {
      p.vel.y = m.power || 11;
      p.onGround = false;
      p.padCd = 0.7;
      emit(state, "jumpPad", { id: m.id });
    }
    if (m.kind === "hazard" && inBox(m, x, y, z)) {
      if (m.dps) damagePlayer(state, p, { base: m.dps * dt, sourceKind: "world", fromPos: { x: m.min[0], y: 0, z: m.min[2] } });
      if (m.slow) {
        const k = m.slow;
        p.vel.x *= k;
        p.vel.z *= k;
      }
      slowEnemiesInHazard(state, m);
      if (m.enemyDps) hurtEnemiesInHazard(state, p, m, dt);
    }
    if ((m.kind === "jetpack" || m.kind === "fuel") && !lv.got[m.id] && !(m.skipIfOwned && p.jetpack) && nearPoint(m.at, x, y + 1, z, 1.8)) {
      lv.got[m.id] = true;
      p.jetpack = true;
      lv.fuel = Math.max(lv.fuel || 0, m.kind === "fuel" ? 100 : 80);
      emit(state, "jetpack", { id: m.id });
    }
    if (m.kind === "fuelPad" && m.at && nearPoint(m.at, x, y + 1, z, 1.6)) {
      lv.fuel = Math.min(100, (lv.fuel || 0) + 40 * dt);
      if (m.safe) {
        lv.padSafe = true;
        lv.safePos = { x: m.at[0], y: m.at[1] || 0, z: m.at[2] };
      }
    }
    if (m.kind === "power" && !lv.got[m.id] && nearPoint(m.at, x, y + 1, z, 1.8)) {
      lv.got[m.id] = true;
      grantModifier(state, p, m.modifier);
    }
    if (m.kind === "shrine" && !lv.got[m.id] && nearPoint(m.at, x, y + 1, z, 2.2)) {
      lv.got[m.id] = true;
      grantSpell(state, p, m.spell || "gooBolt");
      p.mana = p.maxMana;
      emit(state, "shrine", { id: m.id, spell: m.spell || "gooBolt" });
    }
    if (m.kind === "ammo" && !lv.got[m.id] && nearPoint(m.at, x, y + 1, z, 1.4)) {
      lv.got[m.id] = true;
      createPickup(state, {
        kind: "ammo",
        ammoType: m.ammoType || "bullets",
        amount: m.amount || 60,
        pos: { x: m.at[0], y: (m.at[1] || 0) + 0.4, z: m.at[2] }
      });
    }
    if (m.kind === "chest" && !lv.got[m.id] && flagOn(lv, m.opens) && nearPoint(m.at, x, y + 1, z, 2.2)) {
      lv.got[m.id] = true;
      giveWorldGun(state, p, m.gun || "mg");
    }
    if (m.kind === "secret" && !lv.got[m.id] && nearPoint(m.at, x, y + 1, z, 1.7)) {
      lv.got[m.id] = true;
      if (m.modifier) grantModifier(state, p, m.modifier);
      if (m.tickets) p.tickets += m.tickets;
      if (m.mana) {
        p.maxMana += m.mana;
        p.mana = p.maxMana;
      }
      emit(state, "secret", { id: m.id, modifier: m.modifier || null });
    }
    if (m.kind === "portal" && !lv.got[m.id] && nearPoint(m.at, x, y + 1, z, 1.4)) {
      lv.got[m.id] = true;
      p.pos.x = m.to[0];
      p.pos.z = m.to[2];
      emit(state, "portal", { id: m.id });
    }
    if (m.kind === "zipline" && nearPoint(m.from, x, y + 1, z, 1.6)) {
      p.pos.x += Math.sign(m.to[0] - m.from[0] || 1) * (m.speed || 16) * dt;
      p.pos.y = Math.max(p.pos.y, 0);
    }
    if (m.kind === "rail" && Math.abs(p.pos.z - m.from[2]) < 2 && p.pos.x >= m.from[0] && p.pos.x <= m.to[0]) {
      p.vel.x += (m.speed || 10) * dt * 3;
    }
    if (m.kind === "mover" && m.from && onMover(p, m)) tickMover(state, p, m, dt);
    if (m.kind === "laser" && !lv.got[m.id] && nearPoint(m.at, x, y + 1, z, 1.3)) {
      damagePlayer(state, p, { base: (m.dps || 12) * dt, sourceKind: "world", fromPos: { x: m.at[0], y: m.at[1], z: m.at[2] } });
    }
    if (m.kind === "barrel" && !lv.got[m.id]) {
      const hit = state.enemies.some((e) => e.dead && e.campaignEnc && Math.hypot(e.pos.x - m.at[0], e.pos.z - m.at[2]) < 2.2);
      if (hit || nearPoint(m.at, x, y + 1, z, 1.2) && p.cmd && p.cmd.held && p.cmd.held.fire) {
        detonateBarrel(state, sec, m);
      }
    }
  }
  var MOD_SPEED = { turbo: 1.35, taxSeason: 0.82, redTape: 0.9 };
  var LAVA_TIME = 20;
  var LAVA_DPS = 4;
  function grantModifier(state, p, id) {
    if (!id || state.level.modifiers[id]) return;
    state.level.modifiers[id] = true;
    emit(state, "modifier", { id });
    if (MOD_SPEED[id]) p.campaignSpeed = (p.campaignSpeed || 1) * MOD_SPEED[id];
    if (id === "moonBoots") state.level.gravityMult = 0.6;
    if (id === "fuel") {
      p.jetpack = true;
      state.level.fuel = 100;
      state.level.modifiers.fuelInfinite = true;
      state.level.fuelTimer = 20;
    }
    if (id === "overshield" || id === "ironSproto") {
      p.maxShield += id === "ironSproto" ? 80 : 40;
      p.shield = p.maxShield;
    }
    if (id === "swarmSurge") {
      const enc = Object.keys(state.level.spawned).find((k) => !state.level.cleared[k]);
      for (let i = 0; i < 3; i++) {
        const e = createEnemy(state, "midget", { pos: { x: p.pos.x + 6, z: p.pos.z + i }, summoned: true });
        e.campaignEnc = enc || "surge";
      }
    }
  }
  function applyModifiers(state, p, dt) {
    const mods = state.level.modifiers;
    if (mods.bigHead) {
      for (const e of state.enemies) if (!e.dead) e.bigHeadT = 999;
    }
    tickLava(state, p, dt);
    if (mods.fuelInfinite) state.level.fuel = 100;
  }
  function tickLava(state, p, dt) {
    const lv = state.level, mods = lv.modifiers;
    if (!mods || !mods.floorIsLava) return;
    lv.lavaT = (lv.lavaT == null ? LAVA_TIME : lv.lavaT) - dt;
    if (lv.lavaT <= 0) {
      mods.floorIsLava = false;
      delete lv.lavaT;
    } else if (p.onGround && !p.dead) damagePlayer(state, p, { base: LAVA_DPS * dt, sourceKind: "world", fromPos: p.pos });
  }
  function giveWorldGun(state, p, type) {
    const slot = p.guns.findIndex((g2, i) => !g2 && i < p.unlockedSlots);
    if (slot < 0) return;
    const g = generateGun({
      seed: next(state.rng),
      level: state.tier,
      forced: { type, quality: "common", manufacturer: "reliable", element: "none" }
    });
    g.id = nextId(state);
    g.source = "world";
    p.guns[slot] = g;
    emit(state, "worldGun", { type, slot });
  }
  function spawnSquad(state, enc) {
    const squad6 = enc.squads[0];
    let i = 0;
    for (const u4 of squad6.units) {
      for (let n = 0; n < u4.count; n++) {
        const at2 = squad6.at[i] || squad6.at[squad6.at.length - 1];
        i++;
        const boss2 = BOSSES[u4.type] && BOSSES[u4.type].campaign;
        const e = boss2 ? createBoss(state, u4.type, { pos: { x: at2[0], z: at2[2] } }) : createEnemy(state, u4.type, { pos: { x: at2[0], z: at2[2] } });
        e.campaignEnc = enc.id;
        if (boss2) emit(state, "bossSpawn", { id: e.id, bossType: u4.type });
      }
    }
  }
  function tickDuelBoss(state, e, dt) {
    const def = BOSSES[e.type];
    if (e.boss.stunT > 0) {
      e.boss.stunT -= dt;
      e.vel.x = 0;
      e.vel.z = 0;
      if (e.boss.stunT <= 0 && e.boss.action && e.boss.action.id === "stunned") e.boss.action = { id: "idle", t: 0 };
      return;
    }
    const frac = e.hp / e.maxHp;
    if (!e.boss.scripted) e.boss.phaseIdx = frac <= 0.33 ? 2 : frac <= 0.66 ? 1 : 0;
    const t = livingPlayer(state);
    if (t) {
      const dx = t.pos.x - e.pos.x, dz = t.pos.z - e.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      e.yaw = yawTo(e.pos, t.pos);
      const spd = d > 3.5 ? def.speed : def.speed * 0.25;
      e.vel.x = dx / d * spd;
      e.vel.z = dz / d * spd;
    }
    e.pos.x += e.vel.x * dt;
    e.pos.z += e.vel.z * dt;
    e.ai.atk = (e.ai.atk == null ? 0.8 : e.ai.atk) - dt;
    if (e.ai.atk > 0 || !t) return;
    const scale = e.boss.scripted && e.boss.attackScale ? e.boss.attackScale : 1;
    e.ai.atk = (def.attackEvery || 1.6) * scale;
    const attacks = e.boss.scripted && e.boss.attackList ? e.boss.attackList : def.attacks;
    const roll = e.boss.scripted ? next(state.rng) : float(state.rng);
    const span2 = attacks && attacks.length ? attacks.length : 1;
    const index = e.boss.scripted ? span2 <= 1 ? 0 : roll % span2 : Math.floor(roll * span2);
    const name = attacks[index];
    bossAttack(state, e, def, t, name);
  }
  function livingPlayer(state) {
    for (const p of Object.values(state.players)) if (!p.dead) return p;
    return null;
  }
  function bossAttack(state, e, def, t, name) {
    emit(state, "bossAttack", { id: e.id, bossType: e.type, attack: name });
    const from = { x: e.pos.x, y: e.pos.y + e.height * 0.6, z: e.pos.z };
    const dx = t.pos.x - from.x, dy = t.pos.y + 1.1 - from.y, dz = t.pos.z - from.z;
    const dl = Math.hypot(dx, dy, dz) || 1;
    const shot = (speed, dmg, extra = {}) => createProjectile(state, {
      kind: "bullet",
      faction: "enemy",
      ownerId: e.id,
      sourceKind: "boss",
      pos: { ...from },
      vel: { x: dx / dl * speed, y: dy / dl * speed, z: dz / dl * speed },
      radius: 0.25,
      damage: dmg * e.dmgMult,
      ttl: 3,
      ...extra
    });
    if (name === "summon") {
      const n = state.enemies.filter((o) => !o.dead && o.summoned && o.campaignEnc === e.campaignEnc).length;
      if (n < 3) {
        const m = createEnemy(state, "midget", { pos: { x: e.pos.x + 2, z: e.pos.z }, summoned: true });
        m.campaignEnc = e.campaignEnc;
      }
      return;
    }
    if (name === "carpetSweep") {
      const d = Math.hypot(t.pos.x - e.pos.x, t.pos.z - e.pos.z);
      if (d < 15) damagePlayer(state, t, { base: 14, sourceKind: "boss", fromPos: e.pos });
      return;
    }
    if (name === "slam" || name === "rugSlam") {
      damagePlayer(state, t, { base: 18 * (Math.hypot(t.pos.x - e.pos.x, t.pos.z - e.pos.z) < 4.5 ? 1 : 0), sourceKind: "boss", fromPos: e.pos });
      return;
    }
    if (name === "flash") {
      damagePlayer(state, t, { base: 8, sourceKind: "boss", fromPos: e.pos });
      return;
    }
    if (name === "drone") {
      shot(16, 8, { homing: 1.2, homingSpeed: 16 });
      return;
    }
    if (name === "blast" || name === "cloud" || name === "breath") {
      shot(22, 12, { radius: 0.4 });
      return;
    }
    if (name === "fly") {
      e.pos.y = 1.2;
      return;
    }
    if (name === "pigRain") {
      for (let i = 0; i < 4; i++) shot(18, 6, { homing: 0.4, homingSpeed: 14 });
      return;
    }
    shot(26, 7);
  }
  function bucket(state) {
    let b = snaps.get(state);
    if (!b) {
      b = {};
      snaps.set(state, b);
    }
    return b;
  }
  function saveCheckpoint(state, id) {
    const lv = state.level;
    if (!lv) return;
    lv.checkpoint = id;
    bucket(state)[id] = structuredClone(state);
  }
  function restoreCheckpoint(state) {
    const lv = state.level;
    if (!lv) return false;
    const b = snaps.get(state);
    const snap = b && (b[lv.checkpoint] || b.start);
    if (!snap) return false;
    const tick = state.tick;
    const time = state.time;
    const fresh = structuredClone(snap);
    for (const k of Object.keys(state)) delete state[k];
    Object.assign(state, fresh);
    state.tick = tick;
    state.time = time;
    state.events = [];
    snaps.set(state, b);
    return true;
  }

  // src/sim/actions.js
  function applyActions(state, commands) {
    for (const p of Object.values(state.players)) {
      const c = commands[p.id];
      if (!c) continue;
      if (c.pressed?.interact && p.nearGunPickupId) pickupGun(state, p, p.nearGunPickupId);
      for (const a of c.actions || []) handle(state, p, a);
    }
  }
  function handle(state, p, a) {
    switch (a.type) {
      case "craft":
        return startCraft(state, p, a);
      case "salvage":
        return salvage(state, p, a.slot);
      case "reroll":
        return reroll(state, p, a.slot, a.stat);
      case "pickupGun":
        return pickupGun(state, p, a.pickupId);
      case "dropGun":
        return dropGun(state, p, a.slot);
      case "buy":
        return buyOffer(state, p, a.offerId);
      case "rerollShop":
        return rerollShop(state, p);
      case "sell":
        return sellGun(state, p, a.slot);
      case "vend":
        return vend(state, p);
      case "buyUpgrade":
        return buyUpgrade(state, p, a.id);
      case "buySupply":
        return buySupply(state, p, a.id);
      case "startMode":
        return startMode(state, p, a.mode, a.tier, a);
      case "transitionDone":
        return transitionDone(state);
      case "loadLoadout":
        return loadLoadout(state, p, a);
      case "debug":
        return debugOp(state, p, a.op, a.args || {});
    }
  }
  function startMode(state, p, mode, tier = 1, opts = {}) {
    state.enemies.length = 0;
    state.projectiles.length = 0;
    state.hazards.length = 0;
    state.allies.length = 0;
    state.pickups = state.pickups.filter((k) => k.kind === "gun");
    const real = mode === "waves" || mode === "campaign" || mode === "boss";
    if (real) state.pickups = state.pickups.filter((k) => !SANDBOX_SOURCES.includes(k.gun && k.gun.source));
    state.run = newRunStats();
    if (p.downCount != null) delete p.downCount;
    if (p.dead || p.downed) respawn(state, p);
    p.hp = p.maxHp;
    p.shield = p.maxShield;
    p.mana = p.maxMana;
    p.pos = { x: 0, y: 0, z: 8 };
    p.prevPos = { ...p.pos };
    p.vel = { x: 0, y: 0, z: 0 };
    if (state.mode === "waves" && mode !== "waves") {
      state.pickups = [];
      resetProgress(state, p);
    }
    if (state.testMode && mode !== "test") {
      resetLoadout(state, p);
      state.tuning.infiniteAmmo = false;
      setGodMode(state, p, false);
    }
    if (opts.freshLoadout && real && (state.mode === "sandbox" && !state.testMode || mode === "campaign" && state.mode !== "campaign")) resetLoadout(state, p);
    if (state.bossFight && mode !== "boss" && mode !== "test") resetLoadout(state, p);
    const fromOutside = state.mode !== "waves" && (state.mode !== "sandbox" || state.testMode || !!opts.freshLoadout);
    if (mode === "waves" && fromOutside) {
      state.pickups = [];
      resetProgress(state, p, startingLoadout(p));
    }
    state.testMode = mode === "test";
    state.bossFight = null;
    if (mode === "waves") {
      startWaves(state, tier);
    } else if (mode === "campaign") {
      startCampaign(state, p, opts.level);
    } else if (mode === "boss") {
      startBossFight(state, p, opts.boss, tier);
    } else {
      state.mode = "sandbox";
      state.wave = null;
      state.tier = tier;
      p.unlockedSlots = 4;
      rollShopOffers(state);
      if (mode === "test") giveTestLoadout(state, p);
      else placeSandboxLegendary(state, p, tier);
      emit(state, "modeStart", { mode: state.testMode ? "test" : "sandbox", tier });
    }
    if (state.mode !== "campaign") {
      if (!p.spellUnlocks) p.spellUnlocks = {};
      p.spellUnlocks.gooBolt = true;
      syncSpellbook(state, p);
    }
  }
  function startBossFight(state, p, type, tier) {
    if (!BOSSES[type]) type = Object.keys(BOSSES)[0];
    state.mode = "boss";
    state.wave = null;
    state.tier = tier;
    state.bossFight = { type, over: null, startT: state.time, time: 0 };
    giveAllGuns(state, p);
    for (const k of Object.keys(p.ammoCap)) p.ammo[k] = p.ammoCap[k];
    for (const g of p.guns) if (g) g.ammoInMag = g.stats.magSize;
    const b = createBoss(state, type, { tier, pos: { x: 0, z: -18 } });
    emit(state, "modeStart", { mode: "boss", tier, boss: type });
    emit(state, "bossIntro", { types: [type] });
    emit(state, "bossSpawn", { id: b.id, bossType: type });
  }
  function bossFightDirector(state) {
    const f = state.bossFight;
    if (state.mode !== "boss" || !f || f.over) return;
    const boss2 = state.enemies.find((e) => e.boss && e.type === f.type);
    const p = state.players[state.localPlayerId];
    f.time = state.time - f.startT;
    if (!boss2 || boss2.dead) {
      f.over = "won";
      emit(state, "bossFightOver", { won: true, boss: f.type, time: f.time });
    } else if (p.dead) {
      f.over = "lost";
      emit(state, "bossFightOver", { won: false, boss: f.type, hpLeft: boss2.hp / boss2.maxHp });
    }
  }
  var SANDBOX_SOURCES = ["sandbox", "debug"];
  var SANDBOX_DUCK_POS = { x: 1.5, z: 4.5 };
  function placeSandboxLegendary(state, p, tier) {
    const has = p.guns.some((g) => g && g.type === "duckgun") || state.pickups.some((k2) => !k2.dead && k2.gun && k2.gun.type === "duckgun");
    if (has) return;
    const gun = generateGun({ seed: 53444, level: tier, forced: { type: "duckgun", manufacturer: "blastco", element: "none" } });
    const k = spawnGunPickup(state, gun, SANDBOX_DUCK_POS, "sandbox");
    k.ttl = Infinity;
    k.vel = { x: 0, y: 0, z: 0 };
  }
  var TEST_GUN_TYPES = ["mg", "shotgun", "sniper", "bazooka"];
  function giveTestLoadout(state, p) {
    p.guns = TEST_GUN_TYPES.map((type, i) => {
      const g = generateGun({ seed: 32343 + i, level: state.tier, forced: { type, quality: "common", manufacturer: "reliable", element: "none" } });
      g.id = nextId(state);
      g.source = "test";
      return g;
    });
    p.guns.push(null);
    p.activeSlot = 0;
    p.reloadT = 0;
    p.swapT = 0;
    for (const k of Object.keys(p.ammoCap)) p.ammo[k] = p.ammoCap[k];
    state.tuning.infiniteAmmo = true;
    setGodMode(state, p, true);
    debugOp(state, p, "spawnDummies", {});
  }
  function setGodMode(state, p, on) {
    state.tuning.godMode = !!on;
    syncSpellbook(state, p);
    if (!on) return;
    if (p.dead || p.downed) respawn(state, p);
    p.hp = Math.max(p.hp, Math.min(GOD_HP, p.maxHp));
    p.mana = p.maxMana;
    godTopUp(p);
    giveAllGuns(state, p);
  }
  function giveAllGuns(state, p) {
    p.unlockedSlots = Math.max(p.unlockedSlots, TEST_GUN_TYPES.length);
    const legendary = p.guns[LEGENDARY_SLOT] || null;
    const carried = p.guns.filter((g, i) => g && i !== LEGENDARY_SLOT);
    const active = p.guns[p.activeSlot];
    const guns = TEST_GUN_TYPES.map((type, i) => {
      const own = carried.find((g2) => g2.type === type);
      if (own) return own;
      const g = generateGun({ seed: 24784 + i, level: state.tier, forced: { type, quality: "common", manufacturer: "reliable", element: "none" } });
      g.id = nextId(state);
      g.source = "god";
      return g;
    });
    carried.filter((g) => !guns.includes(g)).forEach((g, i) => spawnGunPickup(state, g, aheadOf(p, 2 + i * 0.8), "drop"));
    p.guns = [...guns, legendary];
    const keep = p.guns.indexOf(active);
    if (keep >= 0) p.activeSlot = keep;
    else {
      p.activeSlot = Math.max(0, guns.findIndex((g) => active && g.type === active.type));
      p.reloadT = 0;
      p.swapT = 0;
    }
  }
  function resetLoadout(state, p) {
    const start2 = generateGun({ seed: 12648430, level: 1, forced: { type: "mg", quality: "common", manufacturer: "reliable", element: "none" } });
    start2.id = nextId(state);
    start2.source = "start";
    p.guns = [start2, null, null, null, null];
    p.activeSlot = 0;
    p.reloadT = 0;
    p.swapT = 0;
    p.ammo = { ...TUNING.startAmmo };
  }
  function startingLoadout(p) {
    return p.guns.every((g, i) => i === 0 ? !!g && g.source === "start" : !g);
  }
  var LOADOUT_MAX_GUNS = 8;
  function loadLoadout(state, p, a) {
    if (state.mode !== "waves" || !a || typeof a !== "object") return;
    for (const id of SKILL_IDS) {
      const src = a.skills && a.skills[id];
      const level = Math.floor(Number(src && src.level));
      if (!(level >= 1 && level <= SKILLS[id].maxLevel)) continue;
      const xp = level >= SKILLS[id].maxLevel ? 0 : Math.min(Math.max(0, Number(src.xp) || 0), xpToNext(id, level, "waves") - 1);
      const sk2 = p.skills[id];
      if (level < sk2.level || level === sk2.level && xp <= sk2.xp) continue;
      sk2.level = level;
      sk2.xp = xp;
      sk2.total = Math.max(sk2.total, Number(src.total) || 0);
    }
    for (const perk of PERKS) if (p.skills[perk.skill].level >= perk.level) p.perks[perk.id] = true;
    applySkillPassives(state, p);
    p.hp = p.maxHp;
    const guns = [];
    for (const spec of Array.isArray(a.guns) ? a.guns.slice(0, LOADOUT_MAX_GUNS) : []) {
      const g = gunFromSpec(state, spec);
      if (g) guns.push({ gun: g, slot: Math.floor(Number(spec.slot)) });
    }
    if (!guns.length) return;
    p.guns = [null, null, null, null, null];
    const spare = [];
    for (const { gun, slot } of guns) {
      const fits = slot === LEGENDARY_SLOT ? gun.quality === "legendary" : slot >= 0 && slot < p.unlockedSlots;
      if (fits && !p.guns[slot]) p.guns[slot] = gun;
      else spare.push(gun);
    }
    spare.forEach((gun, i) => {
      spawnGunPickup(state, gun, aheadOf(p, 2 + i * 0.8), "stash").ttl = Infinity;
    });
    if (!p.guns.some(Boolean)) {
      resetLoadout(state, p);
      return;
    }
    p.activeSlot = Math.max(0, p.guns.findIndex((g, i) => g && i !== LEGENDARY_SLOT));
    if (!p.guns[p.activeSlot]) p.activeSlot = p.guns.findIndex(Boolean);
    p.reloadT = 0;
    p.swapT = 0;
  }
  function gunFromSpec(state, spec) {
    if (!spec || typeof spec !== "object") return null;
    const def = GUN_TYPES_BY_ID[spec.type];
    const level = Math.floor(Number(spec.level));
    if (!def || def.legendaryOnly || !QUALITIES_BY_ID[spec.quality] || !Number.isFinite(spec.seed) || !(level >= 1 && level <= MAX_TIER)) return null;
    const forced = { type: def.id, quality: spec.quality };
    if (MANUFACTURERS_BY_ID[spec.manufacturer]) forced.manufacturer = spec.manufacturer;
    if (ELEMENTS_BY_ID[spec.element]) forced.element = spec.element;
    if (spec.quality === "legendary" && WACKY_BY_ID[spec.wacky] && WACKY_BY_ID[spec.wacky].allowedTypes.includes(def.id)) forced.wacky = spec.wacky;
    if (spec.parts && typeof spec.parts === "object") {
      const parts = {};
      let fitted = 0;
      for (const slot of SLOTS) {
        const id = spec.parts[slot];
        if (id === "stock") parts[slot] = id;
        else if (PARTS_BY_ID[id] && PARTS_BY_ID[id].slot === slot) {
          parts[slot] = id;
          fitted++;
        }
      }
      if (fitted <= QUALITIES_BY_ID[spec.quality].partSlots && Object.keys(parts).length === SLOTS.length) forced.parts = parts;
    }
    const gun = generateGun({ seed: spec.seed >>> 0, level, forced, arcane: !!spec.arcane });
    gun.id = nextId(state);
    gun.source = "stash";
    return gun;
  }
  function resetProgress(state, p, keepGuns = false) {
    if (keepGuns) p.ammo = { ...TUNING.startAmmo };
    else resetLoadout(state, p);
    for (const id of SKILL_IDS) p.skills[id] = { level: 1, xp: 0, total: 0 };
    for (const perk of PERKS) if (perk.level > 1 && p.perks[perk.id]) p.perks[perk.id] = false;
    p.buffs.killFrenzy.stacks = 0;
    p.buffs.killFrenzy.t = 0;
    p.unkillableUsed = false;
    p.spellUnlocks = { gooBolt: true };
    syncSpellbook(state, p);
    applySkillPassives(state, p);
    p.hp = p.maxHp;
    p.shield = p.maxShield;
  }
  function aheadOf(p, d = 10) {
    return { x: p.pos.x - Math.sin(p.yaw) * d, z: p.pos.z - Math.cos(p.yaw) * d };
  }
  function debugOp(state, p, op, args) {
    switch (op) {
      case "spawnEnemy": {
        const n = args.count || 1;
        for (let i = 0; i < n; i++) {
          const pos = aheadOf(p, 10 + i * 1.5);
          pos.x += (i % 3 - 1) * 2;
          const r = Math.hypot(pos.x, pos.z);
          if (r > 27) {
            pos.x *= 27 / r;
            pos.z *= 27 / r;
          }
          createEnemy(state, args.type, { elite: !!args.elite, tier: args.tier || state.tier, pos });
        }
        break;
      }
      case "spawnBoss": {
        const pos = aheadOf(p, 14);
        const r = Math.hypot(pos.x, pos.z);
        if (r > 24) {
          pos.x *= 24 / r;
          pos.z *= 24 / r;
        }
        const b = createBoss(state, args.type, { tier: args.tier || state.tier, pos });
        emit(state, "bossSpawn", { id: b.id, bossType: args.type });
        break;
      }
      case "spawnDummies": {
        for (let i = 0; i < 5; i++) {
          const a = (i - 2) * 0.35;
          createEnemy(state, "dummy", { pos: { x: p.pos.x - Math.sin(p.yaw + a) * 12, z: p.pos.z - Math.cos(p.yaw + a) * 12 } });
        }
        break;
      }
      case "spawnGun": {
        const forced = {};
        forced.type = args.type && args.type !== "random" ? args.type : rollGunType(state.rng);
        forced.quality = args.quality && args.quality !== "random" ? args.quality : rollQuality(state.rng, "enemyGun");
        if (args.element && args.element !== "random") forced.element = args.element;
        if (args.wacky && args.wacky !== "random" && forced.quality === "legendary") forced.wacky = args.wacky;
        const gun = generateGun({ seed: next(state.rng), level: args.level || state.tier, forced });
        gun.id = nextId(state);
        spawnGunPickup(state, gun, aheadOf(p, 3), "debug");
        break;
      }
      case "campaignSection": {
        const rt = getLevelRuntime(state.level.id);
        const sec = rt.sectionById[args.id];
        if (!sec) break;
        state.level.section = sec.id;
        state.level.intro = null;
        state.level.transition = null;
        if (state.level.format === "v2") noteV2Section(state, sec, rt);
        if (args.x != null) {
          p.pos.x = args.x;
          p.pos.y = args.y || 0;
          p.pos.z = args.z || 0;
          p.prevPos = { ...p.pos };
          p.vel = { x: 0, y: 0, z: 0 };
        }
        break;
      }
      case "killAll":
        for (const e of state.enemies) if (!e.dead && e.type !== "dummy") {
          e.lastHit = { sourceId: p.id, sourceKind: "gun" };
          onEnemyKilled(state, e);
        }
        break;
      case "clearEnemies":
        state.enemies.length = 0;
        break;
      case "giveTickets":
        p.tickets += args.amount || 100;
        break;
      case "giveResources":
        break;
      case "giveXp":
        addXp(state, p, args.skill, args.amount || 100);
        break;
      case "levelSkill": {
        const s = p.skills[args.skill];
        if (s && s.level < 10) addXp(state, p, args.skill, (xpToNext(args.skill, s.level, state.mode) - s.xp + 1) / (1 + 0.1 * (state.tier - 1)));
        break;
      }
      case "maxSkills":
        for (const sk2 of SKILL_IDS) for (let i = 0; i < 10; i++) debugOp(state, p, "levelSkill", { skill: sk2 });
        break;
      case "setTier":
        state.tier = Math.max(1, Math.min(10, args.tier | 0));
        break;
      case "refillAmmo":
        for (const k of Object.keys(p.ammo)) p.ammo[k] = p.ammoCap[k];
        for (const g of p.guns) if (g) g.ammoInMag = g.stats.magSize;
        break;
      case "heal":
        p.hp = p.maxHp;
        p.shield = p.maxShield;
        p.mana = p.maxMana;
        if (p.dead || p.downed) respawn(state, p);
        break;
      case "setTuning":
        if (args.key === "godMode") setGodMode(state, p, args.value);
        else state.tuning[args.key] = args.value;
        break;
      case "toggleGod":
        setGodMode(state, p, !state.tuning.godMode);
        break;
      case "setGunStat": {
        const g = p.guns[p.activeSlot];
        if (g && args.key in g.stats) g.stats[args.key] = args.value;
        break;
      }
      case "skipWave":
        if (state.wave) {
          for (const e of state.enemies) if (!e.dead) {
            e.lastHit = { sourceId: p.id, sourceKind: "gun" };
            onEnemyKilled(state, e);
          }
          state.wave.spawnQueue = [];
          state.wave.groupIdx = 99;
        }
        break;
    }
    applySkillPassives(state, p);
  }

  // src/sim/spells.js
  function spells(state, dt) {
    for (const p of Object.values(state.players)) {
      for (const k of Object.keys(p.spells.cd)) p.spells.cd[k] = Math.max(0, p.spells.cd[k] - dt);
      if (p.dead || p.downed) continue;
      const c = p.cmd.pressed;
      const eye = eyePos(p);
      const aim = dirFromYawPitch(p.yaw, p.pitch);
      const can = (id, cost) => {
        if (!p.perks[id]) {
          if (c[id]) emit(state, "spellLocked", { playerId: p.id, spellId: id });
          return false;
        }
        if (p.spells.cd[id] > 0) return false;
        if (p.mana < cost) {
          emit(state, "noMana", { playerId: p.id, spellId: id });
          return false;
        }
        return true;
      };
      const cast = (id, cost) => {
        p.mana -= cost;
        p.spells.cd[id] = SPELLS[id].cd;
        emit(state, "cast", { playerId: p.id, spellId: id, manaCost: cost });
      };
      const magicMult = 1;
      if (c.gooBolt && can("gooBolt", SPELLS.gooBolt.mana)) {
        const s = SPELLS.gooBolt;
        cast("gooBolt", s.mana);
        createProjectile(state, {
          kind: "gooBolt",
          faction: "player",
          ownerId: p.id,
          sourceKind: "spell",
          pos: { x: eye.x + aim.x * 0.6, y: eye.y + aim.y * 0.6 - 0.1, z: eye.z + aim.z * 0.6 },
          vel: { x: aim.x * s.speed, y: aim.y * s.speed, z: aim.z * s.speed },
          radius: 0.3,
          gravity: 3,
          damage: s.damage * magicMult,
          element: "goo",
          elementChance: 1,
          ttl: 3,
          splash: { radius: s.splash, damage: s.damage * 0.6, minFalloff: 0.5, selfMult: 0, knockback: 3 }
        });
      }
      if (c.chainZap && can("chainZap", SPELLS.chainZap.mana)) {
        const s = SPELLS.chainZap;
        const hit = raycastEnemies(state, eye, aim, s.range);
        let first = hit ? hit.e : null;
        if (!first) {
          let best = null, bd = 0.9;
          for (const e of state.enemies) {
            if (e.dead || e.state === "spawning") continue;
            const cc = centerOf(e);
            const dx = cc.x - eye.x, dy = cc.y - eye.y, dz = cc.z - eye.z, dl = Math.hypot(dx, dy, dz);
            if (dl > s.range) continue;
            const dot = (dx * aim.x + dy * aim.y + dz * aim.z) / dl;
            if (dot > bd) {
              bd = dot;
              best = e;
            }
          }
          first = best;
        }
        cast("chainZap", s.mana);
        if (first) {
          const hitSet = {};
          let from = { x: eye.x + aim.x * 0.5, y: eye.y - 0.15, z: eye.z + aim.z * 0.5 };
          let cur = first, dmg = s.damage;
          for (let i = 0; i <= s.chains && cur; i++) {
            hitSet[cur.id] = true;
            const to = centerOf(cur);
            emit(state, "tracer", { from, to, element: "shock", zap: true });
            damageEnemy(state, cur, { sourceId: p.id, sourceKind: "spell", base: dmg, element: "shock", elementChance: 0, zone: "body", noProc: true });
            from = to;
            dmg *= s.falloff;
            cur = nearestEnemy(state, cur.pos, s.chainRange, hitSet);
          }
        } else {
          const t = rayWorld(eye, aim, s.range);
          emit(state, "tracer", { from: eye, to: { x: eye.x + aim.x * t, y: eye.y + aim.y * t, z: eye.z + aim.z * t }, element: "shock", zap: true });
        }
      }
      if (c.swarm && can("swarm", SPELLS.swarm.mana)) {
        cast("swarm", SPELLS.swarm.mana);
        for (let i = 0; i < SPELLS.swarm.count; i++) spawnAlly(state, p, p.pos, "spell");
      }
      if (c.manaShield && p.perks.manaShield && p.spells.cd.manaShield <= 0) {
        if (p.spells.manaShieldOn) {
          p.spells.manaShieldOn = false;
          p.spells.cd.manaShield = SPELLS.manaShield.cd;
          emit(state, "manaShieldOff", { playerId: p.id });
        } else if (can("manaShield", SPELLS.manaShield.mana)) {
          cast("manaShield", SPELLS.manaShield.mana);
          p.spells.manaShieldOn = true;
        }
      } else if (c.manaShield && !p.perks.manaShield) emit(state, "spellLocked", { playerId: p.id, spellId: "manaShield" });
      if (c.meteor) {
        if (!p.perks.meteor) emit(state, "spellLocked", { playerId: p.id, spellId: "meteor" });
        else if (p.spells.cd.meteor <= 0 && p.mana >= p.maxMana - 0.5) {
          const s = SPELLS.meteor;
          const hit = raycastEnemies(state, eye, aim, 60);
          let target;
          if (hit) target = { x: hit.e.pos.x, y: 0, z: hit.e.pos.z };
          else {
            const t = Math.min(rayWorld(eye, aim, 40), 40);
            target = { x: eye.x + aim.x * t, y: 0, z: eye.z + aim.z * t };
          }
          cast("meteor", p.mana);
          createHazard(state, { kind: "meteorMarker", pos: target, radius: s.radius, ttl: s.delay + 0.1, damage: s.damage, ownerId: p.id, data: { delay: s.delay } });
        } else if (p.spells.cd.meteor <= 0) emit(state, "noMana", { playerId: p.id, spellId: "meteor" });
      }
    }
  }

  // src/sim/campaign/nav.js
  var CELL = 1;
  var grids = /* @__PURE__ */ new WeakMap();
  function blocked2(solids, x, z) {
    let floor3 = -Infinity;
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      if (x < s.min[0] || x > s.max[0] || z < s.min[2] || z > s.max[2]) continue;
      const top = surfaceY(s, x, z);
      const thin = s.kind === "ramp" || s.max[1] - s.min[1] <= 0.6;
      if (thin && top > floor3) floor3 = top;
    }
    if (floor3 === -Infinity) {
      const g = groundHeight(solids, x, z, 0.15, 0, 0.5);
      if (g === -Infinity) return true;
      floor3 = g;
    }
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      if (x < s.min[0] || x > s.max[0] || z < s.min[2] || z > s.max[2]) continue;
      const top = surfaceY(s, x, z);
      if (top > floor3 + 0.45 && s.min[1] < floor3 + 1.5) return true;
    }
    return false;
  }
  function key(ix, iz) {
    return `${ix},${iz}`;
  }
  function zoneCostAt(zones, x, z) {
    let cost = 1;
    for (let i = 0; i < zones.length; i++) {
      const zone4 = zones[i];
      if (x < zone4.min[0] || x > zone4.max[0] || z < zone4.min[2] || z > zone4.max[2]) continue;
      if (zone4.cost > cost) cost = zone4.cost;
    }
    return cost;
  }
  function bakeNav(solids, bounds, links = [], cell = CELL, zones = []) {
    const x0 = bounds.min[0], z0 = bounds.min[1];
    const nx = Math.max(1, Math.ceil((bounds.max[0] - x0) / cell));
    const nz = Math.max(1, Math.ceil((bounds.max[1] - z0) / cell));
    const open = /* @__PURE__ */ new Set();
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const x = x0 + (ix + 0.5) * cell, z = z0 + (iz + 0.5) * cell;
        if (!blocked2(solids, x, z)) open.add(key(ix, iz));
      }
    }
    const extra = [];
    for (let i = 0; i < links.length; i++) {
      const a = cellAt(bounds, links[i].from, cell);
      const b = cellAt(bounds, links[i].to, cell);
      if (!a || !b) continue;
      extra.push({ a: key(a.ix, a.iz), b: key(b.ix, b.iz), to: links[i].to, kind: links[i].kind || "link" });
      open.add(key(a.ix, a.iz));
      open.add(key(b.ix, b.iz));
    }
    const cost = /* @__PURE__ */ new Map();
    if (zones.length) {
      for (let iz = 0; iz < nz; iz++) {
        for (let ix = 0; ix < nx; ix++) {
          const x = x0 + (ix + 0.5) * cell, z = z0 + (iz + 0.5) * cell;
          const c = zoneCostAt(zones, x, z);
          if (c > 1) cost.set(key(ix, iz), c);
        }
      }
    }
    return { bounds, cell, nx, nz, open, extra, cost };
  }
  function cellAt(bounds, pos, cell = CELL) {
    const ix = Math.floor((pos.x - bounds.min[0]) / cell);
    const iz = Math.floor(((pos.z != null ? pos.z : pos.y) - bounds.min[1]) / cell);
    return { ix, iz };
  }
  function center(grid, ix, iz) {
    return {
      x: grid.bounds.min[0] + (ix + 0.5) * grid.cell,
      z: grid.bounds.min[1] + (iz + 0.5) * grid.cell
    };
  }
  function navGridFor(state) {
    const solids = activeSolids(state);
    const bounds = state.level && state.level.navBounds;
    if (!solids || !bounds) return null;
    const links = state.level.navLinks || [];
    const zones = state.level.slowZones || [];
    const cached = grids.get(solids);
    if (cached && cached.bounds === bounds && cached.links === links && cached.zones === zones) return cached.grid;
    const grid = bakeNav(solids, bounds, links, CELL, zones);
    grids.set(solids, { bounds, links, zones, grid });
    return grid;
  }
  function nearestOpen(grid, pos) {
    const c = cellAt(grid.bounds, pos, grid.cell);
    if (grid.open.has(key(c.ix, c.iz))) return c;
    let best = null, bd = 1e9;
    for (let iz = 0; iz < grid.nz; iz++) {
      for (let ix = 0; ix < grid.nx; ix++) {
        if (!grid.open.has(key(ix, iz))) continue;
        const p = center(grid, ix, iz);
        const d = (p.x - pos.x) ** 2 + (p.z - pos.z) ** 2;
        if (d < bd) {
          bd = d;
          best = { ix, iz };
        }
      }
    }
    return best;
  }
  function findPath(grid, from, to) {
    if (!grid) return null;
    const a = nearestOpen(grid, from);
    const b = nearestOpen(grid, to);
    if (!a || !b) return null;
    const start2 = key(a.ix, a.iz), goal = key(b.ix, b.iz);
    if (start2 === goal) return [center(grid, a.ix, a.iz)];
    const open = [start2];
    const came = /* @__PURE__ */ new Map();
    const g = /* @__PURE__ */ new Map([[start2, 0]]);
    const seen2 = /* @__PURE__ */ new Set();
    const neigh = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (open.length) {
      let bi = 0, bg = g.get(open[0]) + 0;
      for (let i = 1; i < open.length; i++) {
        const k = open[i];
        const [ix2, iz2] = k.split(",").map(Number);
        const h = Math.abs(ix2 - b.ix) + Math.abs(iz2 - b.iz);
        const f = g.get(k) + h;
        if (f < bg) {
          bg = f;
          bi = i;
        }
      }
      const cur = open.splice(bi, 1)[0];
      if (cur === goal) break;
      if (seen2.has(cur)) continue;
      seen2.add(cur);
      const [ix, iz] = cur.split(",").map(Number);
      for (let n = 0; n < neigh.length; n++) {
        const jx = ix + neigh[n][0], jz = iz + neigh[n][1];
        const nk = key(jx, jz);
        if (!grid.open.has(nk)) continue;
        const ng = g.get(cur) + (grid.cost && grid.cost.get(nk) || 1);
        if (ng < (g.get(nk) ?? 1e9)) {
          g.set(nk, ng);
          came.set(nk, cur);
          open.push(nk);
        }
      }
      for (let n = 0; n < grid.extra.length; n++) {
        const link = grid.extra[n];
        const nk = link.a === cur ? link.b : link.b === cur ? link.a : null;
        if (!nk) continue;
        const ng = g.get(cur) + 2;
        if (ng < (g.get(nk) ?? 1e9)) {
          g.set(nk, ng);
          came.set(nk, cur);
          open.push(nk);
        }
      }
    }
    if (!came.has(goal) && start2 !== goal) return null;
    const cells = [goal];
    let walk = goal;
    while (came.has(walk)) {
      walk = came.get(walk);
      cells.push(walk);
    }
    cells.reverse();
    return cells.map((k) => {
      const [ix, iz] = k.split(",").map(Number);
      return center(grid, ix, iz);
    });
  }
  function navWaypoint(state, from, to) {
    if (!state.level || !state.level.useNav) return null;
    const grid = navGridFor(state);
    const path = findPath(grid, from, to);
    if (!path || path.length < 2) return path && path[0] ? path[0] : null;
    return path[1];
  }
  function clampFlyer(e, volume) {
    if (!volume) return;
    const m = volume.min, M = volume.max;
    if (e.pos.x < m[0]) e.pos.x = m[0];
    if (e.pos.x > M[0]) e.pos.x = M[0];
    if (e.pos.y < m[1]) e.pos.y = m[1];
    if (e.pos.y > M[1]) {
      e.pos.y = M[1];
      if (e.vel.y > 0) e.vel.y = 0;
    }
    if (e.pos.z < m[2]) e.pos.z = m[2];
    if (e.pos.z > M[2]) e.pos.z = M[2];
  }

  // src/sim/enemies.js
  function nearestPlayer(state, pos) {
    let best = null, bd = Infinity;
    for (const p of Object.values(state.players)) {
      if (p.dead) continue;
      const d = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }
  function setState(e, s) {
    e.state = s;
    e.stateT = 0;
  }
  function finite(v, fallback) {
    return Number.isFinite(v) ? v : fallback;
  }
  function weightsOf(def) {
    const w = def && def.weights || {};
    return {
      seek: finite(w.seek, 1),
      sep: finite(w.sep, 1.2),
      wall: finite(w.wall, 2),
      strafe: finite(w.strafe, 0.25)
    };
  }
  function steer(state, e, target, w, invertSeek = false) {
    const seek = !invertSeek && e.ai.navPoint ? e.ai.navPoint : target.pos;
    let sx = seek.x - e.pos.x, sz = seek.z - e.pos.z;
    const sl = Math.hypot(sx, sz) || 1;
    sx /= sl;
    sz /= sl;
    if (invertSeek) {
      sx = -sx;
      sz = -sz;
    }
    let px = 0, pz = 0;
    for (const o of state.enemies) {
      if (o === e || o.dead) continue;
      const dx2 = e.pos.x - o.pos.x, dz2 = e.pos.z - o.pos.z;
      const rr = e.radius * e.scale + o.radius * o.scale + 0.6;
      const d2 = dx2 * dx2 + dz2 * dz2;
      if (d2 < rr * rr) {
        const k = 1 / Math.max(d2, 0.01);
        px += dx2 * k;
        pz += dz2 * k;
      }
    }
    const r = Math.hypot(e.pos.x, e.pos.z);
    let wx = 0, wz = 0;
    if (state.mode !== "campaign" && r > ARENA_R - 3) {
      const k = (r - (ARENA_R - 3)) / 3;
      wx = -e.pos.x / r * k;
      wz = -e.pos.z / r * k;
    }
    const stx = -sz * e.ai.strafeDir, stz = sx * e.ai.strafeDir;
    const weights = weightsOf({ weights: w });
    let dx = weights.seek * sx + weights.sep * px + weights.wall * wx + weights.strafe * stx;
    let dz = weights.seek * sz + weights.sep * pz + weights.wall * wz + weights.strafe * stz;
    const dl = Math.hypot(dx, dz) || 1;
    return { x: dx / dl, z: dz / dl };
  }
  function approachVel(e, desired, speed, accel, dt) {
    const tx = desired.x * speed, tz = desired.z * speed;
    const dx = tx - e.vel.x, dz = tz - e.vel.z;
    const dl = Math.hypot(dx, dz);
    const a = accel * dt;
    if (dl > 0) {
      const k = Math.min(1, a / dl);
      e.vel.x += dx * k;
      e.vel.z += dz * k;
    }
  }
  function faceToward(e, target, maxRate, dt) {
    const want = yawTo(e.pos, target.pos);
    const d = angleWrap(want - e.yaw);
    const step = maxRate * dt;
    e.yaw = angleWrap(e.yaw + Math.max(-step, Math.min(step, d)));
  }
  function enemyGun(state, e, t, gun, dt, canFire, slot = "") {
    const ai = e.ai;
    const K2 = (n) => slot + n;
    if (ai[K2("gunCd")] == null) ai[K2("gunCd")] = range(state.rng, 0.8, gun.cooldownMax);
    if (gun.trackDone && ai[K2("doneT")] != null) ai[K2("doneT")] += dt;
    if (ai[K2("burstLeft")] > 0) {
      ai[K2("burstT")] -= dt;
      if (ai[K2("burstT")] <= 0) {
        ai[K2("burstLeft")]--;
        ai[K2("burstT")] = gun.burstGap;
        if (gun.trackDone && ai[K2("burstLeft")] === 0) ai[K2("doneT")] = 0;
        const sc = e.scale;
        let from;
        if (gun.from) {
          const h = e.height * sc, fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw), rx = Math.cos(e.yaw), rz = -Math.sin(e.yaw);
          const f = gun.from.fwd * h, side = -(gun.from.side || 0) * h;
          from = { x: e.pos.x + fx * f + rx * side, y: e.pos.y + gun.from.up * h, z: e.pos.z + fz * f + rz * side };
        } else from = { x: e.pos.x - Math.sin(e.yaw) * 0.6 * sc, y: e.pos.y + e.height * 0.7 * sc, z: e.pos.z - Math.cos(e.yaw) * 0.6 * sc };
        const dx = t.pos.x - from.x, dy = t.pos.y + 1.1 - from.y, dz = t.pos.z - from.z;
        const dl = Math.hypot(dx, dy, dz) || 1;
        const d2 = cone3(state, { x: dx / dl, y: dy / dl, z: dz / dl }, gun.spread);
        const kind = gun.kind || (gun.small ? "pellet" : "bullet");
        createProjectile(state, {
          kind,
          faction: "enemy",
          ownerId: e.id,
          sourceKind: "enemy",
          pos: from,
          vel: { x: d2.x * gun.speed, y: d2.y * gun.speed, z: d2.z * gun.speed },
          radius: gun.radius || (gun.small ? ENEMY_BULLET_RADIUS * 0.6 : ENEMY_BULLET_RADIUS),
          damage: gun.damage * e.dmgMult,
          ttl: 3
        });
        emit(state, "enemyShot", { id: e.id, enemyType: e.type, pos: from, kind });
      }
      return true;
    }
    if (ai[K2("aimT")] > 0) {
      ai[K2("aimT")] -= dt;
      if (ai[K2("aimT")] <= 0) {
        ai[K2("burstLeft")] = gun.burst;
        ai[K2("burstT")] = 0;
      }
      return true;
    }
    ai[K2("gunCd")] -= dt;
    const d = Math.hypot(t.pos.x - e.pos.x, t.pos.z - e.pos.z);
    if (canFire && ai[K2("gunCd")] <= 0 && d < gun.range && !t.downed) {
      ai[K2("gunCd")] = range(state.rng, gun.cooldownMin, gun.cooldownMax);
      ai[K2("aimT")] = gun.windup;
      emit(state, "enemyAttack", { id: e.id, enemyType: e.type, special: !!slot });
      return true;
    }
    return false;
  }
  function cone3(state, aim, spreadDeg) {
    const th = deg(spreadDeg) * Math.sqrt(float(state.rng));
    const ph = float(state.rng) * Math.PI * 2;
    const up = Math.abs(aim.y) < 0.99 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    let rx = aim.y * up.z - aim.z * up.y, ry = aim.z * up.x - aim.x * up.z, rz = aim.x * up.y - aim.y * up.x;
    const rl = Math.hypot(rx, ry, rz);
    rx /= rl;
    ry /= rl;
    rz /= rl;
    const ux = ry * aim.z - rz * aim.y, uy = rz * aim.x - rx * aim.z, uz = rx * aim.y - ry * aim.x;
    const st = Math.sin(th), ct = Math.cos(th), cp = Math.cos(ph), sp = Math.sin(ph);
    return { x: aim.x * ct + (rx * cp + ux * sp) * st, y: aim.y * ct + (ry * cp + uy * sp) * st, z: aim.z * ct + (rz * cp + uz * sp) * st };
  }
  var BEHAVIORS = {
    midget: {
      update(state, e, t, def, speed, dt) {
        const d = Math.hypot(t.pos.x - e.pos.x, t.pos.z - e.pos.z);
        const range2 = finite(def.range, 1.3);
        const windup = finite(def.windup, 0.25);
        const active = finite(def.active, 0.15);
        const recover = finite(def.recover, 0.45);
        const dash = finite(def.lunge, 4);
        if (e.state === "chase") {
          faceToward(e, t, deg(720), dt);
          approachVel(e, steer(state, e, t, def.weights), speed, finite(def.accel, 40), dt);
          if (d < range2 + e.radius * e.scale + TUNING.playerRadius) {
            setState(e, "attack");
            e.attack = { phase: "windup", t: 0, hasHit: false };
            emit(state, "enemyAttack", { id: e.id, enemyType: e.type });
          }
        } else if (e.state === "attack") {
          const a = e.attack;
          a.t += dt;
          faceToward(e, t, deg(300), dt);
          if (a.phase === "windup") {
            approachVel(e, { x: 0, z: 0 }, 0, 30, dt);
            if (a.t >= windup) {
              a.phase = "active";
              a.t = 0;
            }
          } else if (a.phase === "active") {
            const fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw);
            e.vel.x = fx * dash;
            e.vel.z = fz * dash;
            if (!a.hasHit) {
              const c = { x: e.pos.x + fx * 0.9 * e.scale, y: e.pos.y + 0.8, z: e.pos.z + fz * 0.9 * e.scale };
              let bite = finite(def.damage, 9) * e.dmgMult;
              if (Number.isFinite(def.lunge)) bite = Math.round(bite);
              const hit = hitPlayerSphere(state, c, 0.9 * e.scale, bite, "enemy", e.pos);
              if (hit) {
                a.hasHit = true;
                const kb = finite(def.knockback, 0);
                if (kb > 0) knockPlayer(hit, e.pos, kb, 3);
              }
            }
            if (a.t >= active) {
              a.phase = "recover";
              a.t = 0;
              const patch = def.patch;
              if (patch && !a.patched) {
                a.patched = true;
                const radius = finite(patch.radius, 2.5);
                const pos = { x: e.pos.x, y: 0.05, z: e.pos.z };
                createHazard(state, { kind: "icePatch", pos, radius, ttl: finite(patch.seconds, 6), slow: finite(patch.slow, 0.15) });
                emit(state, "icePatch", { pos, radius });
              }
            }
          } else {
            approachVel(e, { x: 0, z: 0 }, 0, 20, dt);
            if (a.t >= recover) setState(e, "chase");
          }
        }
      }
    },
    obama: {
      update(state, e, t, def, speed, dt) {
        const d = Math.hypot(t.pos.x - e.pos.x, t.pos.z - e.pos.z);
        faceToward(e, t, deg(360), dt);
        const w = weightsOf(def);
        let inv = false;
        const keepMin = finite(def.keepMin, 8);
        const keepMax = finite(def.keepMax, 18);
        if (d < keepMin) inv = true;
        else if (d < keepMax) w.seek = 0.1;
        const shooting = def.gun ? enemyGun(state, e, t, def.gun, dt, true) : false;
        e.ai.shooting = shooting;
        approachVel(e, steer(state, e, t, w, inv), shooting ? speed * 0.35 : speed, finite(def.accel, 22), dt);
      }
    },
    // Two weapons: regular arm-gun bursts, and a charged special (def.special) on its own cooldown. Only one fires
    // at a time; the special gets first call when both are ready. ai.special tells the renderer which is firing.
    gunner: {
      update(state, e, t, def, speed, dt) {
        const d = Math.hypot(t.pos.x - e.pos.x, t.pos.z - e.pos.z);
        faceToward(e, t, deg(300), dt);
        const w = weightsOf(def);
        let inv = false;
        const keepMin = finite(def.keepMin, 8);
        const keepMax = finite(def.keepMax, 18);
        if (d < keepMin) inv = true;
        else if (d < keepMax) w.seek = 0.1;
        const ai = e.ai;
        const regularBusy = ai.aimT > 0 || ai.burstLeft > 0;
        const special = def.special ? enemyGun(state, e, t, def.special, dt, !regularBusy, "sp") : false;
        const regular = special || !def.gun ? false : enemyGun(state, e, t, def.gun, dt, true);
        ai.special = special;
        ai.shooting = special || regular;
        approachVel(e, steer(state, e, t, w, inv), special ? 0 : regular ? speed * 0.35 : speed, finite(def.accel, 16), dt);
      }
    },
    flyingMidget: {
      update(state, e, t, def, speed, dt) {
        const ai = e.ai;
        const span2 = (lo, hi, fallbackLo, fallbackHi) => {
          const a = Number.isFinite(lo) ? lo : fallbackLo;
          const b = Number.isFinite(hi) ? hi : fallbackHi;
          return a <= b ? [a, b] : [b, a];
        };
        ai.jinkT = (Number.isFinite(ai.jinkT) ? ai.jinkT : 0) - dt;
        if (ai.jinkT <= 0) {
          const [jLo, jHi] = span2(def.jinkMin, def.jinkMax, 0.5, 1.2);
          const [aLo, aHi] = span2(def.altMin, def.altMax, 3, 6.5);
          const [oLo, oHi] = span2(def.orbitMin, def.orbitMax, 7, 14);
          ai.jinkT = range(state.rng, jLo, jHi);
          ai.orbitDir = float(state.rng) < 0.5 ? -1 : 1;
          ai.alt = range(state.rng, aLo, aHi);
          ai.orbitR = range(state.rng, oLo, oHi);
        }
        const orbitR = Number.isFinite(ai.orbitR) ? ai.orbitR : 10;
        const orbitDir = ai.orbitDir === -1 ? -1 : 1;
        const alt = Number.isFinite(ai.alt) ? ai.alt : Number.isFinite(e.pos.y) ? e.pos.y : 0;
        const dx = t.pos.x - e.pos.x, dz = t.pos.z - e.pos.z;
        const d = Math.hypot(dx, dz) || 1;
        const nx = dx / d, nz = dz / d;
        const radial = Math.max(-1, Math.min(1, (d - orbitR) / 4));
        let wx = nx * radial + -nz * orbitDir, wz = nz * radial + nx * orbitDir;
        const r = Math.hypot(e.pos.x, e.pos.z);
        if (r > ARENA_R - 4) {
          wx -= e.pos.x / r;
          wz -= e.pos.z / r;
        }
        const wl = Math.hypot(wx, wz) || 1;
        approachVel(e, { x: wx / wl, z: wz / wl }, speed, Number.isFinite(def.accel) ? def.accel : 20, dt);
        if (!Number.isFinite(e.pos.y)) e.pos.y = 0;
        if (!Number.isFinite(e.vel.y)) e.vel.y = 0;
        e.vel.y += ((alt - e.pos.y) * 3 - e.vel.y) * Math.min(1, 4 * dt);
        faceToward(e, t, deg(720), dt);
        ai.shooting = def.gun ? enemyGun(state, e, t, def.gun, dt, true) : false;
      }
    },
    bigObama: {
      update(state, e, t, def, speed, dt) {
        const d = Math.hypot(t.pos.x - e.pos.x, t.pos.z - e.pos.z);
        if (e.state === "chase") {
          faceToward(e, t, deg(finite(def.turnRate, 70)), dt);
          const fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw);
          const shooting = def.gun ? enemyGun(state, e, t, def.gun, dt, d > 5) : false;
          e.ai.shooting = shooting;
          approachVel(e, { x: fx, z: fz }, d > 2 && !shooting ? speed : 0, finite(def.accel, 8), dt);
          const ang = Math.abs(angleWrap(yawTo(e.pos, t.pos) - e.yaw));
          if (!shooting && d < finite(def.range, 3.5) && ang < deg(30)) {
            setState(e, "attack");
            e.attack = { phase: "windup", t: 0, hasHit: false };
            emit(state, "enemyAttack", { id: e.id, enemyType: e.type });
          }
        } else if (e.state === "attack") {
          const a = e.attack;
          a.t += dt;
          approachVel(e, { x: 0, z: 0 }, 0, 20, dt);
          if (a.phase === "windup" && a.t >= finite(def.windup, 0.9)) {
            a.phase = "recover";
            a.t = 0;
            const fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw);
            const c = { x: e.pos.x + fx * 1.2, y: 0, z: e.pos.z + fz * 1.2 };
            const pound = finite(def.poundRadius, 3.2);
            createHazard(state, { kind: "stompRing", pos: { ...c, y: 0.05 }, radius: pound, maxRadius: pound, ttl: 0.4 });
            enemyAoE(state, c, pound, finite(def.damage, 25) * e.dmgMult, "enemy", 1.5);
            emit(state, "pound", { id: e.id, pos: c });
          } else if (a.phase === "recover" && a.t >= finite(def.recover, 1.2)) setState(e, "chase");
        }
      }
    },
    dummy: {
      update(state, e, t, def, speed, dt) {
        if (e.ai.regenT > 0) {
          e.ai.regenT -= dt;
          if (e.ai.regenT <= 0) e.hp = e.maxHp;
        }
      }
    }
  };
  function enemyAI(state, dt) {
    for (const e of state.enemies) {
      if (e.dead || e.boss) continue;
      const def = ENEMIES[e.type];
      e.stateT += dt;
      e.hitFlash = Math.max(0, e.hitFlash - dt);
      if (e.bigHeadT > 0) e.bigHeadT -= dt;
      e.poise = Math.max(0, e.poise - e.poiseMax * 0.5 * dt);
      e.ai.strafeT -= dt;
      if (e.ai.strafeT <= 0) {
        e.ai.strafeT = range(state.rng, 2, 4);
        e.ai.strafeDir *= -1;
      }
      const target = nearestPlayer(state, e.pos);
      if (state.tuning.freezeEnemies || !target) {
        approachVel(e, { x: 0, z: 0 }, 0, 30, dt);
      } else if (e.state === "spawning") {
        if (e.stateT >= 0.8) setState(e, "chase");
      } else if (e.state === "stagger") {
        e.ai.burstLeft = 0;
        e.ai.aimT = 0;
        approachVel(e, { x: 0, z: 0 }, 0, 25, dt);
        if (e.stateT >= finite(def.staggerTime, 0.4)) setState(e, "chase");
      } else if (e.ai.scriptTarget) {
        approachVel(e, { x: 0, z: 0 }, 0, 30, dt);
      } else if (e.ai.buried > 0) {
        e.ai.buried -= dt;
        approachVel(e, { x: 0, z: 0 }, 0, 30, dt);
      } else if (e.ai.alert && e.ai.alert !== "alerted" && !e.ai.charge && !sensePlayer(state, e, target)) {
        approachVel(e, { x: 0, z: 0 }, 0, 30, dt);
      } else {
        if (e.ai.charge) e.ai.alert = "alerted";
        if (state.mode === "campaign" && state.level && state.level.useNav) {
          const far = Math.hypot(target.pos.x - e.pos.x, target.pos.z - e.pos.z);
          e.ai.navPoint = far > 2.5 ? navWaypoint(state, e.pos, target.pos) : null;
        }
        if (e.state === "idle" && e.type !== "dummy") setState(e, "chase");
        const slow = e.status.goo ? 1 - e.status.goo.slow : 1;
        const zone4 = state.mode === "campaign" ? enemyZoneSlow(state.level, state._campaignSection, e) : 1;
        const rush = e.ai.charge ? 1.8 : 1;
        const pace = finite(def.run, finite(def.speed, 5));
        const speed = pace * e.speedMult * slow * zone4 * rush;
        const steer2 = state.mode === "campaign" ? runnerSteer(state, e, dt) : null;
        if (steer2) approachVel(e, steer2, steer2.wait ? 0 : speed, 20, dt);
        else {
          const beh = BEHAVIORS[e.type] || BEHAVIORS[def.behavior];
          beh.update(state, e, target, def, speed, dt);
        }
        if (e.ai.bubble > 0) e.ai.bubble -= dt;
        tickArchetype(state, e, target, dt);
        if (state.mode === "campaign" && e.pos.y < abyssY(state.level)) {
          damageEnemy(state, e, { base: e.maxHp * 100, sourceId: state.localPlayerId, sourceKind: "world", zone: "body" });
          if (!e.dead) {
            e.dead = true;
            e.hp = 0;
          }
        }
        if (e.ai.detonate && !e.dead) {
          const fuse = def.archetype.fuse;
          enemyAoE(state, { x: e.pos.x, y: e.pos.y + def.height * 0.5, z: e.pos.z }, fuse.radius, fuse.damage, "enemy");
          damageEnemy(state, e, { base: e.maxHp * 100, sourceId: 0, sourceKind: "world", zone: "body" });
        }
      }
      if (def.flying) {
        if (e.state === "stagger" || e.state === "spawning") e.vel.y += ((e.state === "spawning" ? 2 : -3) - e.vel.y) * Math.min(1, 5 * dt);
      } else e.vel.y -= 30 * dt;
      e.pos.x += e.vel.x * dt;
      e.pos.y += e.vel.y * dt;
      e.pos.z += e.vel.z * dt;
      const solids = activeSolids(state);
      if (def.ghost) {
        if (state.mode === "campaign" && state.level && state.level.navBounds) {
          const b = state.level.navBounds;
          if (e.pos.x < b.min[0]) e.pos.x = b.min[0];
          if (e.pos.x > b.max[0]) e.pos.x = b.max[0];
          if (e.pos.z < b.min[1]) e.pos.z = b.min[1];
          if (e.pos.z > b.max[1]) e.pos.z = b.max[1];
        }
        if (!def.flying && solids) snapToGround(e, solids, e.radius * e.scale);
      } else if (solids && !def.flying) {
        pushHorizontal(e, solids, e.radius * e.scale, e.height * e.scale);
        snapToGround(e, solids, e.radius * e.scale);
      } else if (def.flying && state.mode === "campaign" && state.level && state.level.flyerLids) {
        for (let i = 0; i < state.level.flyerLids.length; i++) clampFlyer(e, state.level.flyerLids[i]);
      } else if (def.flying && state.mode === "campaign" && state.level && state.level.flyerVolume) {
        clampFlyer(e, state.level.flyerVolume);
      } else {
        const floorY = def.flying ? 0.6 : 0;
        if (e.pos.y <= floorY) {
          e.pos.y = floorY;
          if (e.vel.y < 0) e.vel.y = 0;
        }
      }
      if (e.state !== "chase" && e.state !== "attack") {
        e.vel.x *= Math.max(0, 1 - 4 * dt);
        e.vel.z *= Math.max(0, 1 - 4 * dt);
      }
    }
    resolveOverlaps(state);
  }
  function resolveOverlaps(state) {
    const es = state.enemies;
    for (let i = 0; i < es.length; i++) {
      const a = es[i];
      if (a.dead) continue;
      const ra = entityDef(a).radius * a.scale;
      const ma = a.boss || a.type === "bigObama" ? 5 : 1;
      for (let j = i + 1; j < es.length; j++) {
        const b = es[j];
        if (b.dead) continue;
        if (a.type === "hexAuditor" || b.type === "hexAuditor") continue;
        if (Math.abs(a.pos.y - b.pos.y) > 1.5) continue;
        const rb = entityDef(b).radius * b.scale;
        const mb = b.boss || b.type === "bigObama" ? 5 : 1;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        const min = ra + rb;
        if (d < min && d > 1e-4) {
          const push = min - d;
          const nx = dx / d, nz = dz / d;
          const ka = mb / (ma + mb), kb = ma / (ma + mb);
          a.pos.x -= nx * push * ka;
          a.pos.z -= nz * push * ka;
          b.pos.x += nx * push * kb;
          b.pos.z += nz * push * kb;
        }
      }
      if (a.type !== "hexAuditor") {
        if (state.mode !== "campaign") clampToArena(a, ra);
        pushOutOfBoxes(state, a, ra);
      }
    }
    for (const p of Object.values(state.players)) {
      if (p.dead) continue;
      for (const e of es) {
        if (e.dead || e.type === "hexAuditor") continue;
        const def = entityDef(e);
        if (p.pos.y > e.pos.y + def.height * e.scale) continue;
        const dx = p.pos.x - e.pos.x, dz = p.pos.z - e.pos.z;
        const d = Math.hypot(dx, dz);
        const min = def.radius * e.scale + TUNING.playerRadius;
        if (d < min && d > 1e-4) {
          p.pos.x = e.pos.x + dx / d * min;
          p.pos.z = e.pos.z + dz / d * min;
        }
      }
      if (state.mode !== "campaign") clampToArena(p, TUNING.playerRadius);
    }
  }

  // src/sim/bosses.js
  function start(e, id, data = {}) {
    e.boss.action = { id, t: 0, data };
  }
  function nextAction(state, e, def) {
    const scripted = e.boss.scripted && Array.isArray(e.boss.attackList) && e.boss.attackList.length;
    const pattern = scripted ? e.boss.attackList : def.phases[e.boss.phaseIdx].pattern;
    const id = pattern[e.boss.patternIdx++ % pattern.length];
    start(e, id);
  }
  function bosses(state, dt) {
    for (const e of state.enemies) {
      if (e.dead || !e.boss) continue;
      const def = BOSSES[e.type];
      if (!def || def.campaign) continue;
      e.hitFlash = Math.max(0, e.hitFlash - dt);
      if (e.bigHeadT > 0) e.bigHeadT -= dt;
      const b = e.boss;
      const t = nearestPlayer(state, e.pos);
      const frac = e.hp / e.maxHp;
      const nxt = def.phases[b.phaseIdx + 1];
      if (!b.scripted && nxt && frac <= nxt.hpBelow && !b.transitioning) {
        b.transitioning = true;
        b.invuln = true;
        start(e, "transition", { duration: 2 });
        emit(state, "bossPhase", { id: e.id, bossType: e.type, phaseIdx: b.phaseIdx + 1 });
      }
      if (state.tuning.freezeEnemies || !t) {
        continue;
      }
      const a = b.action;
      a.t += dt;
      const impl = IMPLS[e.type] || (def.ai === "hex" ? HEX : MEGA);
      const done = impl(state, e, a, dt, def, t);
      if (done) {
        if (a.id === "transition") {
          b.phaseIdx++;
          b.transitioning = false;
          b.invuln = false;
          b.patternIdx = 0;
          if (impl === MEGA && b.phaseIdx === 1 && !b.scripted) summonGrunts(state, e);
        }
        nextAction(state, e, def);
      }
      if (e.type === "hexAuditor") {
        while (frac <= b.manaOrbNext && b.manaOrbNext > 0) {
          b.manaOrbNext -= 0.1;
          for (let i = 0; i < 2; i++) {
            const ang = range(state.rng, 0, Math.PI * 2);
            createPickup(state, { kind: "mana", amount: TUNING.manaOrb, pos: { x: e.pos.x, y: e.pos.y, z: e.pos.z }, vel: { x: Math.cos(ang) * 4, y: 3, z: Math.sin(ang) * 4 } });
          }
        }
      }
    }
  }
  function summonGrunts(state, e) {
    const n = state.tier >= 5 ? 10 : 6;
    const pts = (state.spawnPoints || []).slice().sort((p1, p2) => Math.hypot(p1.x - e.pos.x, p1.z - e.pos.z) - Math.hypot(p2.x - e.pos.x, p2.z - e.pos.z));
    if (!pts.length) return;
    for (let i = 0; i < n; i++) {
      const pt = pts[i % 4];
      if (!pt) continue;
      if (i < 4) createHazard(state, { kind: "spawnPortal", pos: { x: pt.x, y: 0, z: pt.z }, radius: 1.2, ttl: 0.8 });
      createEnemy(state, "midget", { pos: { x: pt.x + range(state.rng, -1, 1), z: pt.z + range(state.rng, -1, 1) }, summoned: true });
    }
    emit(state, "bossRoar", { id: e.id });
  }
  function muzzle(e, def, f) {
    const h = def.height, fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw), rx = Math.cos(e.yaw), rz = -Math.sin(e.yaw);
    const fw = f.fwd * h, sd = -(f.side || 0) * h;
    return { x: e.pos.x + fx * fw + rx * sd, y: e.pos.y + f.up * h, z: e.pos.z + fz * fw + rz * sd };
  }
  function MEGA(state, e, a, dt, def, t) {
    const phase = def.phases[e.boss.phaseIdx];
    const spd = def.speed * phase.speedMult * (e.status.goo ? 1 - e.status.goo.slow : 1);
    const faceTo = (rate) => {
      const diff = angleWrap(yawTo(e.pos, t.pos) - e.yaw);
      e.yaw = angleWrap(e.yaw + Math.max(-rate * dt, Math.min(rate * dt, diff)));
    };
    const toward = (s) => {
      faceTo(3.2);
      const dx = t.pos.x - e.pos.x, dz = t.pos.z - e.pos.z, d = Math.hypot(dx, dz) || 1;
      const k = Math.min(1, dt * 4);
      e.vel.x += (dx / d * s - e.vel.x) * k;
      e.vel.z += (dz / d * s - e.vel.z) * k;
    };
    const brake = (rate = 8) => {
      const k = Math.max(0, 1 - dt * rate);
      e.vel.x *= k;
      e.vel.z *= k;
    };
    const integrate = () => {
      e.vel.y -= 30 * dt;
      e.pos.x += e.vel.x * dt;
      e.pos.y += e.vel.y * dt;
      e.pos.z += e.vel.z * dt;
      if (e.pos.y <= 0) {
        e.pos.y = 0;
        e.vel.y = 0;
      }
      if (state.mode === "campaign" && e.boss.arena) return holdInCircle(e, 4);
      const r = Math.hypot(e.pos.x, e.pos.z), maxR = ARENA_R - def.radius;
      if (r > maxR) {
        e.pos.x *= maxR / r;
        e.pos.z *= maxR / r;
        return true;
      }
      return false;
    };
    const contact = () => {
      for (const p of Object.values(state.players)) {
        if (p.dead) continue;
        const d = Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z);
        if (d < def.radius + TUNING.playerRadius + 0.1 && p.pos.y < def.height && (e.ai.contactCd || 0) <= 0) {
          damagePlayer(state, p, { base: def.contactDamage * e.dmgMult, sourceKind: "boss", fromPos: e.pos });
          knockPlayer(p, e.pos, 8, 4);
          e.ai.contactCd = 0.8;
        }
      }
    };
    e.ai.contactCd = (e.ai.contactCd || 0) - dt;
    e.ai.meleeCd = (e.ai.meleeCd || 0) - dt;
    if (def.melee && (a.id === "chase" || a.id === "volley" || a.id === "missiles") && e.ai.meleeCd <= 0 && e.pos.y <= 0.01 && Math.hypot(t.pos.x - e.pos.x, t.pos.z - e.pos.z) < def.radius + def.melee.range) {
      start(e, "melee");
      return false;
    }
    switch (a.id) {
      case "intro":
        brake();
        integrate();
        return a.t > 2;
      case "transition":
        brake();
        integrate();
        return a.t >= 2;
      case "chase":
        toward(spd);
        integrate();
        contact();
        return a.t >= 3;
      case "charge": {
        if (!a.data.dir) {
          const dx = t.pos.x - e.pos.x, dz = t.pos.z - e.pos.z, d = Math.hypot(dx, dz) || 1;
          a.data.dir = { x: dx / d, z: dz / d };
          e.yaw = yawTo(e.pos, t.pos);
          createHazard(state, { kind: "telegraphLine", pos: { x: e.pos.x, y: 0.05, z: e.pos.z }, ttl: 0.8, data: { dir: a.data.dir, len: 30, width: def.radius * 2 } });
          emit(state, "bossTelegraph", { id: e.id, kind: "charge" });
        }
        if (a.t < 0.8) {
          brake();
          integrate();
          return false;
        }
        const cs = def.chargeSpeed * phase.speedMult;
        e.vel.x = a.data.dir.x * cs;
        e.vel.z = a.data.dir.z * cs;
        const hitWall = integrate();
        if (!a.data.hit) {
          for (const p of Object.values(state.players)) {
            if (p.dead) continue;
            if (Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z) < def.radius + TUNING.playerRadius + 0.3 && p.pos.y < def.height) {
              damagePlayer(state, p, { base: def.chargeDamage * e.dmgMult, sourceKind: "boss", fromPos: e.pos });
              knockPlayer(p, e.pos, 12, 6);
              a.data.hit = true;
            }
          }
        }
        if (hitWall) {
          start(e, "stunned");
          emit(state, "bossStunned", { id: e.id, pos: { ...e.pos } });
          return false;
        }
        return a.t >= 2.8;
      }
      case "stunned":
        brake();
        integrate();
        return a.t >= 2;
      case "volley": {
        brake();
        integrate();
        faceTo(4);
        const v = def.volley;
        const waves = v.waves + (e.boss.phaseIdx >= 2 ? 1 : 0);
        if (a.t < 0.5) {
          if (!a.data.tele) {
            a.data.tele = true;
            emit(state, "bossTelegraph", { id: e.id, kind: "volley" });
          }
          return false;
        }
        a.data.fired = a.data.fired || 0;
        while (a.data.fired < waves && a.t >= 0.5 + a.data.fired * v.gap) {
          const from = v.from ? muzzle(e, def, v.from) : { x: e.pos.x - Math.sin(e.yaw) * (def.radius + 0.2), y: v.y || 3.2, z: e.pos.z - Math.cos(e.yaw) * (def.radius + 0.2) };
          const base = Math.atan2(t.pos.x - from.x, t.pos.z - from.z) + (a.data.fired % 2 ? deg(v.fan / v.count / 2) : 0);
          const pitch = Math.atan2(t.pos.y + 1.1 - from.y, Math.hypot(t.pos.x - from.x, t.pos.z - from.z));
          for (let i = 0; i < v.count; i++) {
            const yaw = base + deg(v.fan) * (i / (v.count - 1) - 0.5);
            const dir = { x: Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: Math.cos(yaw) * Math.cos(pitch) };
            createProjectile(state, {
              kind: v.kind || "bullet",
              faction: "enemy",
              ownerId: e.id,
              sourceKind: "boss",
              pos: { ...from },
              vel: { x: dir.x * v.speed, y: dir.y * v.speed, z: dir.z * v.speed },
              radius: v.radius || ENEMY_BULLET_RADIUS * 1.5,
              damage: v.damage * e.dmgMult,
              ttl: 4
            });
          }
          a.data.fired++;
          emit(state, "bossCast", { id: e.id, kind: "volley" });
        }
        return a.t >= 0.5 + waves * v.gap + 0.4;
      }
      case "slam": {
        if (!a.data.hopped) {
          a.data.hopped = true;
          e.vel.y = 10;
          e.vel.x = e.vel.z = 0;
          emit(state, "bossTelegraph", { id: e.id, kind: "slam" });
        }
        integrate();
        const rings2 = e.boss.phaseIdx >= 1 ? 2 : 1;
        a.data.landed = a.data.landed || a.t > 0.3 && e.pos.y <= 0;
        if (a.data.landed) {
          a.data.lt = (a.data.lt || 0) + dt;
          a.data.spawned = a.data.spawned || 0;
          if (a.data.spawned < rings2 && a.data.lt >= a.data.spawned * 0.6) {
            a.data.spawned++;
            createHazard(state, { kind: "shockwave", pos: { x: e.pos.x, y: 0, z: e.pos.z }, radius: def.radius, maxRadius: 22, speed: 10, height: 0.6, ttl: 3, damage: def.slamDamage * e.dmgMult, ownerId: e.id });
            emit(state, "explosion", { pos: { x: e.pos.x, y: 0.2, z: e.pos.z }, radius: 4, element: "none", slam: true });
          }
          return a.data.lt >= 1.6;
        }
        return a.t > 3;
      }
      case "melee": {
        const m = def.melee;
        brake();
        integrate();
        if (!a.data.variant) {
          a.data.variant = m.combo ? m.combo[(e.ai.meleeN = (e.ai.meleeN || 0) + 1) % m.combo.length] : "smash";
        }
        const kick = a.data.variant === "kick" && m.kick;
        const reach = m.range + (kick ? kick.range : 0);
        if (!a.data.tele) {
          a.data.tele = true;
          emit(state, "bossTelegraph", { id: e.id, kind: "melee", variant: a.data.variant });
        }
        if (a.t < m.windup) {
          faceTo(6);
          return false;
        }
        if (!a.data.swung) {
          a.data.swung = true;
          e.ai.meleeCd = m.cd;
          emit(state, "bossCast", { id: e.id, kind: "melee", variant: a.data.variant });
          const fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw);
          for (const p of Object.values(state.players)) {
            if (p.dead) continue;
            const dx = p.pos.x - e.pos.x, dz = p.pos.z - e.pos.z, d = Math.hypot(dx, dz) || 1;
            const inFront = (dx * fx + dz * fz) / d > -0.2;
            if (d < def.radius + reach + TUNING.playerRadius && inFront && p.pos.y < def.height) {
              emit(state, "bossMeleeHit", { id: e.id, playerId: p.id, variant: a.data.variant });
              damagePlayer(state, p, { base: m.damage * (kick ? kick.damage : 1) * e.dmgMult, sourceKind: "boss", fromPos: e.pos });
              knockPlayer(p, e.pos, m.knockback * (kick ? kick.knockback : 1), kick ? 9 : 7);
            }
          }
        }
        return a.t >= m.windup + m.recover;
      }
      case "missiles": {
        const m = def.missiles;
        brake();
        integrate();
        faceTo(4);
        const n = m.count + (e.boss.phaseIdx >= 2 ? 1 : 0);
        if (a.t < 0.6) {
          if (!a.data.tele) {
            a.data.tele = true;
            emit(state, "bossTelegraph", { id: e.id, kind: "missiles" });
          }
          return false;
        }
        a.data.fired = a.data.fired || 0;
        while (a.data.fired < n && a.t >= 0.6 + a.data.fired * m.gap) {
          const side = a.data.fired % 2 ? 1 : -1;
          if (m.kind === "tyre") {
            const from = muzzle(e, def, { ...m.from, side: -side * m.from.side });
            const sx = (float(state.rng) - 0.5) * 2 * m.scatter, sz = (float(state.rng) - 0.5) * 2 * m.scatter;
            const T = m.flight + a.data.fired * 0.05, g = m.gravity;
            const tx = t.pos.x + t.vel.x * T * 0.5 + sx, tz = t.pos.z + t.vel.z * T * 0.5 + sz;
            createProjectile(state, {
              kind: "tyre",
              faction: "enemy",
              ownerId: e.id,
              sourceKind: "boss",
              pos: from,
              vel: { x: (tx - from.x) / T, y: (0 - from.y + 0.5 * g * T * T) / T, z: (tz - from.z) / T },
              gravity: g,
              bounces: m.bounces,
              radius: 0.7,
              damage: m.damage * e.dmgMult,
              ttl: m.ttl,
              splash: { radius: m.splash, damage: m.damage * e.dmgMult }
            });
            a.data.fired++;
            emit(state, "bossCast", { id: e.id, kind: "tyre" });
            continue;
          }
          const rx = Math.cos(e.yaw) * side * def.radius * 0.7, rz = -Math.sin(e.yaw) * side * def.radius * 0.7;
          const fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw);
          createProjectile(state, {
            kind: "missile",
            faction: "enemy",
            ownerId: e.id,
            sourceKind: "boss",
            pos: { x: e.pos.x + rx, y: m.y, z: e.pos.z + rz },
            vel: { x: fx * m.speed * 0.5 + rx * 1.5, y: m.speed * 0.6, z: fz * m.speed * 0.5 + rz * 1.5 },
            radius: 0.5,
            damage: m.damage * e.dmgMult,
            homing: m.homing,
            homingSpeed: m.speed,
            ttl: m.ttl,
            splash: { radius: m.splash, damage: m.damage * e.dmgMult }
          });
          a.data.fired++;
          emit(state, "bossCast", { id: e.id, kind: "missiles" });
        }
        return a.t >= 0.6 + n * m.gap + 0.5;
      }
      case "summon": {
        brake();
        integrate();
        if (!a.data.done) {
          a.data.done = true;
          const alive2 = state.enemies.filter((o) => !o.dead && o.summoned).length;
          if (!e.boss.scripted && alive2 < 10) summonGrunts(state, e);
        }
        return a.t > 1.2;
      }
    }
    return true;
  }
  function orb(state, e, dir, speed, kind = "orb", homing = 0, ttl = 6) {
    const def = BOSSES.hexAuditor;
    createProjectile(state, {
      kind,
      faction: "enemy",
      ownerId: e.id,
      sourceKind: "boss",
      pos: { x: e.pos.x + dir.x * 1.5, y: e.pos.y + dir.y * 1.5, z: e.pos.z + dir.z * 1.5 },
      vel: { x: dir.x * speed, y: dir.y * speed, z: dir.z * speed },
      radius: 0.35,
      damage: (kind === "taxBolt" ? def.taxDamage : def.orbDamage) * e.dmgMult,
      homing,
      ttl
    });
  }
  function holdInCircle(e, margin) {
    const c = e.boss && e.boss.arena;
    if (!c) return false;
    const ax = e.pos.x - c.x, az = e.pos.z - c.z;
    const ar = Math.hypot(ax, az);
    const limit = Math.max(1, (c.radius || 30) - margin);
    if (ar > limit) {
      e.pos.x = c.x + ax / ar * limit;
      e.pos.z = c.z + az / ar * limit;
      return true;
    }
    return false;
  }
  function aimDir(e, t, yawOff = 0) {
    const dx = t.pos.x - e.pos.x, dy = t.pos.y + 1.2 - e.pos.y, dz = t.pos.z - e.pos.z;
    const h = Math.hypot(dx, dz) || 1;
    const yaw = Math.atan2(dx, dz) + yawOff;
    const pitch = Math.atan2(dy, h);
    return { x: Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: Math.cos(yaw) * Math.cos(pitch) };
  }
  function HEX(state, e, a, dt, def, t) {
    const b = e.boss;
    const p3 = b.phaseIdx >= 2;
    const megaAlive = b.paired && state.enemies.some((o) => !o.dead && o.type === "megaSproto");
    const cdMult = megaAlive ? 1.2 : 1;
    b.weakAngle += deg(p3 ? 200 : 120) * dt;
    const hoverY = def.hoverY + 0.25 * Math.sin(state.time * 2);
    e.pos.y += (hoverY - e.pos.y) * Math.min(1, 5 * dt);
    if (a.id !== "teleport") {
      const dx = e.pos.x - t.pos.x, dz = e.pos.z - t.pos.z, d = Math.hypot(dx, dz) || 1;
      const goal = { x: t.pos.x + dx / d * 12, z: t.pos.z + dz / d * 12 };
      const gx = goal.x - e.pos.x, gz = goal.z - e.pos.z, gl = Math.hypot(gx, gz);
      const sp = def.speed * (e.status.goo ? 1 - e.status.goo.slow : 1);
      if (gl > 0.5) {
        e.pos.x += gx / gl * Math.min(gl, sp * dt);
        e.pos.z += gz / gl * Math.min(gl, sp * dt);
      }
      if (state.mode !== "campaign") {
        const r = Math.hypot(e.pos.x, e.pos.z);
        if (r > ARENA_R - 4) {
          e.pos.x *= (ARENA_R - 4) / r;
          e.pos.z *= (ARENA_R - 4) / r;
        }
      } else holdInCircle(e, 4);
      e.yaw = yawTo(e.pos, t.pos);
    }
    const auraR = p3 ? def.auraRadiusP3 : def.auraRadius;
    for (const p of Object.values(state.players)) {
      if (p.dead) continue;
      if (Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z) < auraR) {
        p.mana = Math.max(0, p.mana - def.auraDrain * dt);
        p.inAuraT = 0.2;
      }
    }
    e.ai.auraR = auraR;
    switch (a.id) {
      case "intro":
        return a.t > 2;
      case "transition":
        return a.t >= a.data.duration;
      case "drift":
        return a.t > 2.5 * cdMult;
      case "ring": {
        if (!a.data.fired) {
          a.data.fired = true;
          const n = 16, off = range(state.rng, 0, Math.PI);
          const dirToP = aimDir(e, t);
          for (let i = 0; i < n; i++) {
            const ang = off + i / n * Math.PI * 2;
            orb(state, e, { x: Math.sin(ang), y: dirToP.y * 0.8, z: Math.cos(ang) }, 8);
          }
          emit(state, "bossCast", { id: e.id, kind: "ring" });
        }
        return a.t > 1.6 * cdMult;
      }
      case "fan": {
        if (!a.data.fired) {
          a.data.fired = true;
          for (let i = -2; i <= 2; i++) orb(state, e, aimDir(e, t, deg(10) * i), 10);
          emit(state, "bossCast", { id: e.id, kind: "fan" });
        }
        return a.t > 1.2 * cdMult;
      }
      case "spiral":
      case "spiralRing": {
        a.data.acc = (a.data.acc || 0) + dt * 10;
        const base = a.t * deg(90);
        const dy = aimDir(e, t).y * 0.8;
        while (a.data.acc >= 1) {
          a.data.acc -= 1;
          for (let k = 0; k < 3; k++) {
            const ang = base + k / 3 * Math.PI * 2;
            orb(state, e, { x: Math.sin(ang), y: dy, z: Math.cos(ang) }, 7);
          }
        }
        if (a.id === "spiralRing" && !a.data.ring && a.t > 1.2) {
          a.data.ring = true;
          for (let i = 0; i < 16; i++) {
            const ang = i / 16 * Math.PI * 2;
            orb(state, e, { x: Math.sin(ang), y: dy, z: Math.cos(ang) }, 8);
          }
        }
        return a.t > 3 * cdMult;
      }
      case "taxBolts": {
        if (!a.data.fired) {
          a.data.fired = true;
          for (let i = -1; i <= 1; i++) orb(state, e, aimDir(e, t, deg(35) * i), 6, "taxBolt", 1.2, 6);
          emit(state, "bossCast", { id: e.id, kind: "tax" });
        }
        return a.t > 1.5 * cdMult;
      }
      case "teleport": {
        if (a.t < 0.6) {
          b.invuln = true;
          b.fade = 1 - a.t / 0.6;
          return false;
        }
        if (!a.data.moved) {
          a.data.moved = true;
          for (let tries = 0; tries < 10; tries++) {
            const ang = range(state.rng, 0, Math.PI * 2), r = range(state.rng, 12, 30);
            const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
            if (Math.hypot(x - t.pos.x, z - t.pos.z) >= 8 || tries === 9) {
              e.pos.x = x;
              e.pos.z = z;
              e.prevPos.x = x;
              e.prevPos.z = z;
              break;
            }
          }
          emit(state, "bossTeleport", { id: e.id, pos: { ...e.pos } });
        }
        b.fade = Math.min(1, (a.t - 0.6) / 0.4);
        if (a.t >= 1) {
          b.invuln = b.transitioning;
          b.fade = 1;
          return true;
        }
        return false;
      }
    }
    return true;
  }
  function headPos(e, def) {
    const fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw);
    const hb = def.hitboxes[0];
    return { x: e.pos.x + fx * hb.z, y: e.pos.y + hb.y, z: e.pos.z + fz * hb.z };
  }
  function DRAGON(state, e, a, dt, def, t) {
    const phase = def.phases[e.boss.phaseIdx];
    const sp = def.speed * (phase.speedMult || 1) * (e.status.goo ? 1 - e.status.goo.slow : 1);
    const d = Math.hypot(t.pos.x - e.pos.x, t.pos.z - e.pos.z);
    const turn = (rate) => {
      const want = yawTo(e.pos, t.pos);
      const diff = angleWrap(want - e.yaw);
      e.yaw = angleWrap(e.yaw + Math.max(-rate * dt, Math.min(rate * dt, diff)));
    };
    const move = (speed) => {
      const fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw);
      e.vel.x = fx * speed;
      e.vel.z = fz * speed;
      e.pos.x += e.vel.x * dt;
      e.pos.z += e.vel.z * dt;
      const r = Math.hypot(e.pos.x, e.pos.z), maxR = ARENA_R - def.radius - 1;
      if (r > maxR) {
        e.pos.x *= maxR / r;
        e.pos.z *= maxR / r;
      }
    };
    e.ai.moving = false;
    switch (a.id) {
      case "intro":
        turn(1.5);
        return a.t > 2.2;
      case "transition":
        turn(2);
        return a.t >= 2;
      case "stalk": {
        turn(2.2);
        if (d > 11) {
          move(sp);
          e.ai.moving = true;
        } else if (d < 6) {
          move(-sp * 0.6);
          e.ai.moving = true;
        }
        return a.t > 2.4;
      }
      case "breath": {
        const b = def.breath;
        const dur = b.duration * (e.boss.phaseIdx >= 2 ? 1.4 : 1);
        if (a.t < b.telegraph) {
          turn(3);
          if (!a.data.tele) {
            a.data.tele = true;
            emit(state, "bossTelegraph", { id: e.id, kind: "breath" });
          }
          a.data.base = e.yaw;
          return false;
        }
        const k = Math.min(1, (a.t - b.telegraph) / dur);
        e.yaw = angleWrap(a.data.base + deg(b.sweep) * (k - 0.5) * (a.data.dir || (a.data.dir = float(state.rng) < 0.5 ? -1 : 1)));
        a.data.acc = (a.data.acc || 0) + dt;
        const h = headPos(e, def);
        const pitch = Math.atan2(t.pos.y + 0.9 - h.y, Math.max(1, d));
        while (a.data.acc >= b.rate) {
          a.data.acc -= b.rate;
          const yaw = e.yaw + range(state.rng, -0.06, 0.06);
          const dir = { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
          createProjectile(state, {
            kind: "flame",
            faction: "enemy",
            ownerId: e.id,
            sourceKind: "boss",
            pos: { ...h },
            vel: { x: dir.x * b.speed, y: dir.y * b.speed, z: dir.z * b.speed },
            radius: 0.45,
            damage: b.damage * e.dmgMult,
            ttl: 1.4,
            element: "fire"
          });
        }
        return a.t >= b.telegraph + dur;
      }
      case "fireballs": {
        const f = def.fireball;
        turn(2.5);
        a.data.n = a.data.n || 0;
        while (a.data.n < f.count && a.t >= 0.4 + a.data.n * 0.45) {
          const h = headPos(e, def);
          const T = f.flight, g = 14;
          const tx = t.pos.x + t.vel.x * 0.35 * a.data.n, tz = t.pos.z + t.vel.z * 0.35 * a.data.n;
          createProjectile(state, {
            kind: "fireball",
            faction: "enemy",
            ownerId: e.id,
            sourceKind: "boss",
            pos: { ...h },
            vel: { x: (tx - h.x) / T, y: (t.pos.y - h.y + 0.5 * g * T * T) / T, z: (tz - h.z) / T },
            gravity: g,
            radius: 0.6,
            damage: f.damage * e.dmgMult,
            ttl: 3,
            element: "fire",
            splash: { radius: f.splash, damage: f.damage * e.dmgMult }
          });
          a.data.n++;
          emit(state, "bossCast", { id: e.id, kind: "fireball" });
        }
        return a.t > 0.4 + f.count * 0.45 + 0.3;
      }
      case "fly": {
        const f = def.fly;
        const dur = f.duration * (e.boss.phaseIdx >= 2 ? 1.3 : 1);
        const ease = (k2) => k2 * k2 * (3 - 2 * k2);
        e.ai.moving = true;
        if (a.t < f.rise) {
          e.pos.y = f.height * ease(a.t / f.rise);
          turn(1.5);
          move(sp * 0.8);
          if (!a.data.tele) {
            a.data.tele = true;
            emit(state, "bossTelegraph", { id: e.id, kind: "takeoff" });
          }
          return false;
        }
        if (a.t < f.rise + dur) {
          if (a.data.dir === void 0) a.data.dir = float(state.rng) < 0.5 ? -1 : 1;
          const ft = a.t - f.rise;
          const sw = Math.max(0, 1 - Math.abs(ft - f.swoopAt) / (f.swoopTime / 2));
          const swoop = sw * sw * (3 - 2 * sw);
          const radius = (f.radius + Math.sin(ft * 0.7) * f.radiusSwing) * (1 - 0.85 * swoop);
          const ang = Math.atan2(e.pos.x - t.pos.x, e.pos.z - t.pos.z) + a.data.dir * (f.speed * (1 + 0.4 * swoop) / Math.max(4, radius)) * dt;
          const tx = t.pos.x + Math.sin(ang) * radius, tz = t.pos.z + Math.cos(ang) * radius;
          const want = Math.atan2(-(tx - e.pos.x), -(tz - e.pos.z));
          e.yaw = angleWrap(e.yaw + Math.max(-3.5 * dt, Math.min(3.5 * dt, angleWrap(want - e.yaw))));
          const spd = Math.min(f.speed * (1 + 0.4 * swoop), Math.hypot(tx - e.pos.x, tz - e.pos.z) / dt);
          move(spd);
          const cruise = f.height + Math.sin(ft * 0.9) * f.heightSwing;
          e.pos.y = cruise + (f.swoopHeight - cruise) * swoop;
          a.data.shot = a.data.shot ?? f.shotEvery * 0.5;
          if (a.t - f.rise >= a.data.shot) {
            a.data.shot += f.shotEvery;
            const fb = def.fireball, h = headPos(e, def), T = 0.9, g = 14;
            createProjectile(state, {
              kind: "fireball",
              faction: "enemy",
              ownerId: e.id,
              sourceKind: "boss",
              pos: { ...h },
              vel: { x: (t.pos.x - h.x) / T, y: (t.pos.y - h.y + 0.5 * g * T * T) / T, z: (t.pos.z - h.z) / T },
              gravity: g,
              radius: 0.6,
              damage: fb.damage * e.dmgMult,
              ttl: 3,
              element: "fire",
              splash: { radius: fb.splash, damage: fb.damage * e.dmgMult }
            });
            emit(state, "bossCast", { id: e.id, kind: "fireball" });
          }
          return false;
        }
        const k = (a.t - f.rise - dur) / f.land;
        turn(2);
        move(sp * 0.6 * (1 - k));
        e.pos.y = f.height * (1 - ease(Math.min(1, k)));
        if (k >= 1) {
          e.pos.y = 0;
          emit(state, "pound", { id: e.id, pos: { ...e.pos } });
          return true;
        }
        return false;
      }
      case "tailSwipe": {
        const tl = def.tail;
        if (d > tl.radius + 3 && !a.data.started) return true;
        a.data.started = true;
        if (a.t < tl.windup) {
          if (!a.data.tele) {
            a.data.tele = true;
            emit(state, "bossTelegraph", { id: e.id, kind: "tail" });
          }
          return false;
        }
        if (!a.data.hit) {
          a.data.hit = true;
          createHazard(state, { kind: "stompRing", pos: { x: e.pos.x, y: 0.05, z: e.pos.z }, radius: tl.radius, maxRadius: tl.radius, ttl: 0.45 });
          for (const p of Object.values(state.players)) {
            if (p.dead || p.pos.y > 1.6) continue;
            if (Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z) < tl.radius) {
              damagePlayer(state, p, { base: tl.damage * e.dmgMult, sourceKind: "boss", fromPos: e.pos });
              knockPlayer(p, e.pos, 14, 6);
            }
          }
          emit(state, "pound", { id: e.id, pos: { ...e.pos } });
        }
        return a.t > tl.windup + 0.6;
      }
      case "summon": {
        if (!a.data.done) {
          a.data.done = true;
          const alive2 = state.enemies.filter((o) => !o.dead && o.summoned).length;
          if (alive2 < 8) summonGrunts(state, e);
        }
        return a.t > 1.2;
      }
    }
    return true;
  }
  var IMPLS = { megaSproto: MEGA, hexAuditor: HEX, dragon: DRAGON };

  // src/sim/world.js
  function projectiles(state, dt) {
    for (const p of state.projectiles) {
      if (p.dead) continue;
      p.vel.y -= p.gravity * dt;
      if (p.homing > 0) {
        const tgt = p.faction === "enemy" ? Object.values(state.players).find((pl) => !pl.dead) : null;
        if (tgt) {
          const dx = tgt.pos.x - p.pos.x, dy = tgt.pos.y + 1.1 - p.pos.y, dz = tgt.pos.z - p.pos.z;
          const dl = Math.hypot(dx, dy, dz) || 1;
          let sp = Math.hypot(p.vel.x, p.vel.y, p.vel.z) || 1;
          if (p.homingSpeed) sp += (p.homingSpeed - sp) * Math.min(1, dt * 2);
          const k = Math.min(1, p.homing * dt);
          p.vel.x += (dx / dl * sp - p.vel.x) * k;
          p.vel.y += (dy / dl * sp - p.vel.y) * k;
          p.vel.z += (dz / dl * sp - p.vel.z) * k;
        }
      }
      const len = Math.hypot(p.vel.x, p.vel.y, p.vel.z) * dt;
      const dir = len > 0 ? { x: p.vel.x * dt / len, y: p.vel.y * dt / len, z: p.vel.z * dt / len } : { x: 0, y: 0, z: 1 };
      const shotSolids = activeSolids(state);
      if (shotSolids && len > 0) {
        const wall2 = raySolids(shotSolids, p.pos, dir, len);
        if (wall2 >= 0) {
          p.pos = { x: p.pos.x + dir.x * wall2, y: p.pos.y + dir.y * wall2, z: p.pos.z + dir.z * wall2 };
          detonate(state, p);
          continue;
        }
      }
      const end = { x: p.pos.x + p.vel.x * dt, y: p.pos.y + p.vel.y * dt, z: p.pos.z + p.vel.z * dt };
      let consumed = false;
      if (p.faction === "player") {
        const hit = raycastEnemies(state, p.pos, dir, len + p.radius, p.hitIds);
        if (hit) {
          damageEnemy(state, hit.e, {
            sourceId: p.ownerId,
            sourceKind: p.sourceKind,
            base: p.damage,
            element: p.element,
            elementChance: p.elementChance,
            zone: hit.zone,
            critMult: p.critMult,
            critChance: p.critChance,
            canCrit: p.kind === "duckBullet" || p.kind === "megaBullet" || p.kind === "bigBullet" || p.kind === "rubberBullet",
            point: hit.point,
            gunId: p.gunId,
            arcane: p.arcane,
            wacky: p.wacky,
            pellet: !!p.pellet
          });
          p.hitIds[hit.e.id] = true;
          if (p.splash) explode(
            state,
            hit.point,
            p.splash,
            p.ownerId,
            p.element,
            p.sourceKind === "spell" ? "spell" : "splash",
            false,
            { elementChance: p.sourceKind === "spell" ? 1 : p.elementChance, arcane: p.arcane, wacky: p.wacky }
          );
          if (p.pierce > 0) p.pierce--;
          else if (p.kind === "duckBullet" && p.bounces > 0) {
            p.bounces--;
            p.vel.x *= -0.6;
            p.vel.z *= -0.6;
            p.vel.y = Math.abs(p.vel.y) + 4;
            emit(state, "duckBounce", { pos: hit.point });
          } else {
            p.dead = true;
            consumed = true;
          }
        }
      } else {
        for (const pl of Object.values(state.players)) {
          if (pl.dead) continue;
          if (sphereHitsPlayer(end, p.radius, pl)) {
            if (p.splash) {
              enemyAoE(state, end, p.splash.radius, p.splash.damage, p.sourceKind);
              emitEnemyBlast(state, p, end);
            } else damagePlayer(state, pl, { base: p.damage, sourceKind: p.sourceKind, fromPos: p.pos });
            p.dead = true;
            consumed = true;
            break;
          }
        }
      }
      if (consumed) continue;
      p.pos = end;
      if (p.pos.y <= 0) {
        if (p.bounces > 0) {
          p.bounces--;
          p.pos.y = 0.01;
          p.vel.y = Math.abs(p.vel.y) * 0.7;
          const duck = p.kind === "duckBullet" || p.kind === "rubberBullet";
          emit(state, duck ? "duckBounce" : "bounce", { pos: { ...p.pos }, kind: p.kind });
          if (p.kind === "rubberBullet") {
            p.vel.x *= 0.4;
            p.vel.z *= 0.4;
            p.vel.y *= 0.7;
            p.ttl = Math.min(p.ttl, 0.35);
          }
        } else {
          detonate(state, p);
          continue;
        }
      }
      const r = Math.hypot(p.pos.x, p.pos.z);
      if (state.mode !== "campaign" && r > ARENA_R + (p.faction === "enemy" ? 2 : 0)) {
        if (p.bounces > 0) {
          p.bounces--;
          const nx = p.pos.x / r, nz = p.pos.z / r;
          const vr = p.vel.x * nx + p.vel.z * nz;
          p.vel.x -= 2 * vr * nx;
          p.vel.z -= 2 * vr * nz;
        } else {
          detonate(state, p);
          continue;
        }
      }
      p.ttl -= dt;
      if (p.ttl <= 0) detonate(state, p);
    }
  }
  function detonate(state, p) {
    p.dead = true;
    if (!p.splash) {
      if (p.faction === "player") emit(state, "impact", { pos: { ...p.pos }, element: p.element });
      return;
    }
    if (p.faction === "player") {
      explode(
        state,
        { ...p.pos, y: Math.max(0.2, p.pos.y) },
        p.splash,
        p.ownerId,
        p.element,
        p.sourceKind === "spell" ? "spell" : "splash",
        false,
        { elementChance: p.sourceKind === "spell" ? 1 : p.elementChance, arcane: p.arcane, wacky: p.wacky }
      );
    } else {
      enemyAoE(state, p.pos, p.splash.radius, p.splash.damage, p.sourceKind, p.pos.y + 1.8);
      emitEnemyBlast(state, p, p.pos);
    }
  }
  function emitEnemyBlast(state, p, pos) {
    if (p.kind === "missile" || p.kind === "tyre") emit(state, "explosion", { pos: { x: pos.x, y: Math.max(0.3, pos.y), z: pos.z }, radius: p.splash.radius, element: "none", enemy: true });
    else emit(state, "splat", { pos: { ...pos }, element: p.element });
  }
  function tickIce(state) {
    let live = false;
    for (let i = 0; i < state.hazards.length; i++) {
      const h = state.hazards[i];
      if (!h.dead && h.kind === "icePatch") live = true;
    }
    const players = Object.values(state.players);
    let sticky = false;
    if (!live) {
      for (let i = 0; i < players.length; i++) if (players[i].iceSlow != null) sticky = true;
      if (!sticky) return;
    }
    for (let i = 0; i < players.length; i++) if (players[i].iceSlow != null) delete players[i].iceSlow;
    if (!live) return;
    for (let i = 0; i < state.hazards.length; i++) {
      const h = state.hazards[i];
      if (h.dead || h.kind !== "icePatch") continue;
      for (let p = 0; p < players.length; p++) {
        const pl = players[p];
        if (pl.dead) continue;
        if (Math.hypot(pl.pos.x - h.pos.x, pl.pos.z - h.pos.z) < h.radius + 0.4) pl.iceSlow = h.slow == null ? 0.15 : h.slow;
      }
    }
  }
  function hazards(state, dt) {
    for (const h of state.hazards) {
      if (h.dead) continue;
      h.t += dt;
      if (h.kind === "shockwave") {
        h.radius += h.speed * dt;
        for (const p of Object.values(state.players)) {
          if (p.dead || h.hitIds[p.id]) continue;
          const d = Math.hypot(p.pos.x - h.pos.x, p.pos.z - h.pos.z);
          if (Math.abs(d - h.radius) < 0.5 + TUNING.playerRadius && p.pos.y < h.height) {
            h.hitIds[p.id] = true;
            damagePlayer(state, p, { base: h.damage, sourceKind: "boss", fromPos: h.pos });
          }
        }
        if (h.radius >= h.maxRadius) h.dead = true;
      } else if (h.kind === "meteorMarker") {
        if (h.t >= h.data.delay) {
          h.dead = true;
          explode(state, { ...h.pos, y: 0.3 }, { radius: h.radius, damage: h.damage, minFalloff: 0.5, selfMult: 0, knockback: 14 }, h.ownerId, "fire", "spell", false, { elementChance: 1 });
          emit(state, "meteorImpact", { pos: { ...h.pos } });
        }
      }
      if (h.t >= h.ttl && h.kind !== "shockwave") h.dead = true;
    }
    tickIce(state);
  }
  function statusEffects(state, dt) {
    for (const e of state.enemies) {
      if (e.dead) continue;
      const s = e.status;
      if (s.burn) {
        s.burn.t -= dt;
        s.burnTick += dt;
        if (s.burnTick >= 0.5) {
          s.burnTick -= 0.5;
          damageEnemy(state, e, { sourceId: s.burn.sourceId, sourceKind: "dot", base: s.burn.dps * 0.5, element: "fire", zone: "body", noProc: true, canCrit: false });
        }
        if (s.burn && s.burn.t <= 0) s.burn = null;
      }
      if (s.goo) {
        s.goo.t -= dt;
        if (s.goo.t <= 0) s.goo = null;
      }
    }
  }
  function pickups(state, dt) {
    const p = state.players[state.localPlayerId];
    const intermission = state.wave && state.wave.phase === "intermission";
    p.nearGunPickupId = null;
    let nearD = TUNING.gunPickupRadius;
    for (const k of state.pickups) {
      if (k.dead) continue;
      k.age += dt;
      k.ttl -= dt;
      if (k.ttl <= 0) {
        k.dead = true;
        continue;
      }
      const dx = p.pos.x - k.pos.x, dy = p.pos.y + 0.8 - k.pos.y, dz = p.pos.z - k.pos.z;
      const d = Math.hypot(dx, dy, dz);
      if (k.kind === "gun") {
        k.vel.y -= 18 * dt;
        k.pos.x += k.vel.x * dt;
        k.pos.y += k.vel.y * dt;
        k.pos.z += k.vel.z * dt;
        const dropSolids = activeSolids(state);
        const floor3 = dropSolids ? Math.max(0.6, groundHeight(dropSolids, k.pos.x, k.pos.z, 0.2, k.pos.y, 2) + 0.3) : 0.6;
        if (k.pos.y < floor3) {
          k.pos.y = floor3;
          k.vel.y = 0;
          k.vel.x *= 0.85;
          k.vel.z *= 0.85;
        }
        clampR(k);
        if (!p.dead && d < nearD) {
          nearD = d;
          p.nearGunPickupId = k.id;
        }
        continue;
      }
      const wants = wantsPickup(p, k);
      if (!p.dead && wants && (d < TUNING.magnetRadius || k.magnetized || intermission && k.age > 0.5)) k.magnetized = true;
      if (k.magnetized && wants && !p.dead) {
        const sp = Math.min(30, Math.hypot(k.vel.x, k.vel.y, k.vel.z) + TUNING.magnetAccel * dt);
        k.vel.x = dx / d * sp;
        k.vel.y = dy / d * sp;
        k.vel.z = dz / d * sp;
      } else {
        k.magnetized = false;
        k.vel.y -= 18 * dt;
        k.vel.x *= Math.max(0, 1 - 1.5 * dt);
        k.vel.z *= Math.max(0, 1 - 1.5 * dt);
      }
      k.pos.x += k.vel.x * dt;
      k.pos.y += k.vel.y * dt;
      k.pos.z += k.vel.z * dt;
      if (k.pos.y < 0.3) {
        k.pos.y = 0.3;
        k.vel.y = Math.abs(k.vel.y) * 0.3;
      }
      clampR(k);
      if (d < TUNING.collectRadius && wants && !p.dead) collect(state, p, k);
    }
  }
  function clampR(k) {
    const r = Math.hypot(k.pos.x, k.pos.z);
    if (r > ARENA_R - 0.5) {
      k.pos.x *= (ARENA_R - 0.5) / r;
      k.pos.z *= (ARENA_R - 0.5) / r;
      k.vel.x = k.vel.z = 0;
    }
  }
  function wantsPickup(p, k) {
    switch (k.kind) {
      case "health":
        return p.hp < p.maxHp;
      case "bigHealth":
        return p.hp < p.maxHp || p.shield < p.maxShield;
      case "mana":
        return p.mana < p.maxMana;
      case "ammo":
        return p.ammo[k.ammoType] < p.ammoCap[k.ammoType];
      default:
        return true;
    }
  }
  function collect(state, p, k) {
    k.dead = true;
    switch (k.kind) {
      case "health":
        healPlayer(p, Math.max(k.amount, p.maxHp * 0.2));
        break;
      case "bigHealth":
        healPlayer(p, k.amount);
        p.shield = p.maxShield;
        break;
      case "mana":
        p.mana = Math.min(p.maxMana, p.mana + k.amount);
        break;
      case "ammo":
        p.ammo[k.ammoType] = Math.min(p.ammoCap[k.ammoType], p.ammo[k.ammoType] + k.amount);
        break;
      case "resource":
        break;
      case "tickets":
        p.tickets += k.amount;
        state.run.ticketsEarned += k.amount;
        break;
    }
    emit(state, "pickup", { playerId: p.id, kind: k.kind, amount: k.amount, resId: k.resId, ammoType: k.ammoType, pos: { ...k.pos } });
  }
  function allies(state, dt) {
    for (const a of state.allies) {
      if (a.dead) continue;
      a.ttl -= dt;
      if (a.ttl <= 0) {
        a.dead = true;
        emit(state, "allyPoof", { pos: { ...a.pos } });
        continue;
      }
      const t = nearestEnemy(state, a.pos, 40);
      const owner = state.players[a.ownerId];
      let goal = t ? t.pos : owner ? owner.pos : a.pos;
      const dx = goal.x - a.pos.x, dz = goal.z - a.pos.z, d = Math.hypot(dx, dz) || 1;
      const want = t ? d > ALLY.range * 0.6 ? ALLY.speed : 0 : d > 3 ? ALLY.speed : 0;
      a.vel.x += (dx / d * want - a.vel.x) * Math.min(1, 8 * dt);
      a.vel.z += (dz / d * want - a.vel.z) * Math.min(1, 8 * dt);
      a.pos.x += a.vel.x * dt;
      a.pos.z += a.vel.z * dt;
      a.pos.y = Math.abs(Math.sin((state.time + a.id) * 9)) * 0.35;
      a.yaw = Math.atan2(-dx, -dz);
      a.fireCd -= dt;
      if (t && a.fireCd <= 0 && d < ALLY.range) {
        a.fireCd = ALLY.fireCd;
        const c = centerOf(t);
        const from = { x: a.pos.x, y: 0.6, z: a.pos.z };
        const ddx = c.x - from.x, ddy = c.y - from.y, ddz = c.z - from.z, dl = Math.hypot(ddx, ddy, ddz) || 1;
        createProjectile(state, {
          kind: "gooBolt",
          faction: "player",
          ownerId: a.ownerId,
          sourceKind: a.sourceKind === "spell" ? "spell" : "gun",
          pos: from,
          vel: { x: ddx / dl * 22, y: ddy / dl * 22, z: ddz / dl * 22 },
          radius: 0.2,
          damage: a.damage * 0.4,
          ttl: 2,
          splash: { radius: a.splashRadius, damage: a.damage * 0.6, minFalloff: 0.5, selfMult: 0, knockback: 2 },
          element: "none",
          ally: true
        });
        emit(state, "allyShot", { pos: from });
      }
    }
  }
  function cleanup(state) {
    for (const key2 of ["enemies", "projectiles", "pickups", "hazards", "allies"]) {
      const arr = state[key2];
      let w = 0;
      for (let i = 0; i < arr.length; i++) {
        const it = arr[i];
        const keep = key2 === "enemies" ? !(it.dead && (it.deadT = (it.deadT || 0) + 1) > 1) : !it.dead;
        if (keep) arr[w++] = it;
      }
      arr.length = w;
    }
    if (state.projectiles.length > 600) state.projectiles.splice(0, state.projectiles.length - 600);
  }
  function snapshotPrev(state) {
    for (const p of Object.values(state.players)) {
      p.prevPos.x = p.pos.x;
      p.prevPos.y = p.pos.y;
      p.prevPos.z = p.pos.z;
    }
    for (const key2 of ["enemies", "projectiles", "pickups", "allies"]) {
      for (const e of state[key2]) {
        e.prevPos.x = e.pos.x;
        e.prevPos.y = e.pos.y;
        e.prevPos.z = e.pos.z;
      }
    }
  }

  // src/sim/campaign/scriptSnap.js
  function q(n) {
    return Math.round(n * 1e4) / 1e4;
  }
  function snapBody(o) {
    if (!o || !o.pos) return;
    o.pos.x = q(o.pos.x);
    o.pos.y = q(o.pos.y);
    o.pos.z = q(o.pos.z);
    if (o.prevPos) {
      o.prevPos.x = q(o.prevPos.x);
      o.prevPos.y = q(o.prevPos.y);
      o.prevPos.z = q(o.prevPos.z);
    }
    if (o.vel) {
      o.vel.x = q(o.vel.x);
      o.vel.y = q(o.vel.y);
      o.vel.z = q(o.vel.z);
    }
  }
  function snapScripted(state) {
    if (!state || state.mode !== "campaign" || !state.level || !state.level.scripts) return;
    const sec = state._v2section;
    if (!sec) return;
    let multi = false;
    for (const enc of sec.encounters || []) {
      if (enc.script && enc.script.parts && enc.script.parts.length > 1) multi = true;
    }
    if (!multi) return;
    const players = state.players ? Object.keys(state.players) : [];
    for (let i = 0; i < players.length; i++) snapBody(state.players[players[i]]);
    const enemies = state.enemies || [];
    for (let i = 0; i < enemies.length; i++) snapBody(enemies[i]);
    const shots = state.projectiles || [];
    for (let i = 0; i < shots.length; i++) snapBody(shots[i]);
  }

  // src/sim/simulate.js
  var DT = 1 / 60;
  function simulate(state, commands, dt = DT) {
    state.events.length = 0;
    state.tick++;
    state.time += dt;
    snapshotPrev(state);
    playerInput(state, commands);
    applyActions(state, commands);
    if (state.mode === "campaign") campaignPre(state, dt);
    playerMovement(state, dt);
    playerCombat(state, dt);
    spells(state, dt);
    allies(state, dt);
    waveDirector(state, dt);
    bossFightDirector(state);
    enemyAI(state, dt);
    bosses(state, dt);
    hazards(state, dt);
    projectiles(state, dt);
    statusEffects(state, dt);
    playerVitals(state, dt);
    pickups(state, dt);
    crafting(state, dt);
    progression(state);
    if (state.mode === "campaign") campaignPost(state, dt);
    snapScripted(state);
    cleanup(state);
  }

  // src/sim/hash.js
  function stableStringify(value) {
    if (value === null) return "null";
    const t = typeof value;
    if (t === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
    if (t === "string" || t === "boolean") return JSON.stringify(value);
    if (t !== "object") return "null";
    if (Array.isArray(value)) {
      let s5 = "[";
      for (let i = 0; i < value.length; i++) {
        if (i) s5 += ",";
        s5 += stableStringify(value[i]);
      }
      return s5 + "]";
    }
    const keys2 = Object.keys(value).sort();
    let s = "{";
    let n = 0;
    for (const k of keys2) {
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
    const keys2 = Object.keys(value);
    for (let i = 0; i < keys2.length; i++) {
      if (keys2[i] === "events") continue;
      out[keys2[i]] = quantizeForHash(value[keys2[i]]);
    }
    return out;
  }
  function verifyStateHash(state) {
    return fnv1a(stableStringify(quantizeForHash(state)));
  }

  // src/sim/campaign/kiteAim.js
  function livingBosses(state) {
    const out = [];
    for (let i = 0; i < state.enemies.length; i++) {
      const e = state.enemies[i];
      if (e.boss && !e.dead && !e.fled) out.push(e);
    }
    return out;
  }
  function aimYaw(from, to) {
    return Math.atan2(-(to.x - from.x), -(to.z - from.z));
  }
  function worldMove(yaw, wx, wz) {
    const sy = Math.sin(yaw);
    const cy = Math.cos(yaw);
    const len = Math.hypot(wx, wz) || 1;
    return {
      moveZ: Math.max(-1, Math.min(1, (wx * -sy + wz * -cy) / len)),
      moveX: Math.max(-1, Math.min(1, (wx * cy - wz * sy) / len))
    };
  }
  function kiteCommand(state, mode) {
    const p = state.players[state.localPlayerId];
    const exchange = state.level && state.level.section === "SB";
    if (exchange && (p.pos.x < 1136 || p.pos.y < -0.5)) {
      const home = { x: 1160, z: 60 };
      const yaw2 = aimYaw(p.pos, home);
      const mv = worldMove(yaw2, home.x - p.pos.x, home.z - p.pos.z);
      return {
        yaw: yaw2,
        pitch: 0,
        moveX: mv.moveX,
        moveZ: mv.moveZ,
        held: { sprint: true },
        pressed: {},
        slot: -1,
        wheel: 0,
        actions: []
      };
    }
    const live = livingBosses(state);
    if (!live.length) {
      return { yaw: -Math.PI / 2, pitch: 0, moveX: 0, moveZ: 1, held: { sprint: true }, pressed: {}, slot: -1, wheel: 0, actions: [] };
    }
    const shielded = exchange && live.every((e) => e.boss && e.boss.invuln);
    const pool = [];
    if (shielded) {
      for (let i = 0; i < state.enemies.length; i++) {
        const e = state.enemies[i];
        if (!e.dead && !e.fled && !e.boss && e.partId) pool.push(e);
      }
    }
    const choices = pool.length ? pool : live;
    let target = choices[0];
    let best = Infinity;
    const focusWeak = exchange && !pool.length && live.length >= 2;
    for (let i = 0; i < choices.length; i++) {
      const e = choices[i];
      const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      const score = focusWeak && e.maxHp ? d + e.hp / e.maxHp * 30 : d;
      if (score < best) {
        best = score;
        target = e;
      }
    }
    best = Math.hypot(target.pos.x - p.pos.x, target.pos.z - p.pos.z);
    if (mode === "fail") {
      if (best > 4.5) {
        return { yaw: aimYaw(p.pos, target.pos), pitch: 0, moveX: 0, moveZ: 1, held: { sprint: true }, pressed: {}, slot: -1, wheel: 0, actions: [] };
      }
      return { yaw: aimYaw(p.pos, target.pos), pitch: 0, moveX: 0, moveZ: 0, held: {}, pressed: {}, slot: -1, wheel: 0, actions: [] };
    }
    const eye = p.pos.y + 1.6;
    const aimY = target.pos.y + (target.height || 1.6) * 0.55;
    let pitch = Math.atan2(aimY - eye, Math.max(0.2, best)) - p.recoil.pitch;
    if (pitch > 1.45) pitch = 1.45;
    if (pitch < -1.45) pitch = -1.45;
    const refills = !!(target.boss && target.boss.scriptHold);
    const assist = mode === "assisted" && !refills && target.hp < 80;
    let moveZ = 0;
    let moveX = 0;
    let yaw = aimYaw(p.pos, target.pos);
    const off = exchange && (p.pos.y < -0.2 || p.pos.z < 52 || p.pos.z > 70 || p.pos.x > 1170 || p.pos.x < 1146);
    if (off) {
      yaw = aimYaw(p.pos, { x: 1158, z: 62 });
      const mv = worldMove(yaw, 1158 - p.pos.x, 62 - p.pos.z);
      moveX = mv.moveX;
      moveZ = mv.moveZ;
    } else if (exchange) {
      const dx = target.pos.x - p.pos.x;
      const dz = target.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      const lv = state.level;
      if (p.pos.x > 1164) lv._sweep = -1;
      else if (p.pos.x < 1152) lv._sweep = 1;
      else if (!lv._sweep) lv._sweep = 1;
      let wx = -dz / d * lv._sweep;
      let wz = dx / d * lv._sweep;
      if (best > 20) {
        wx += dx / d;
        wz += dz / d;
      } else if (best < 12) {
        wx -= dx / d;
        wz -= dz / d;
      }
      const mv = worldMove(yaw, wx, wz);
      moveX = mv.moveX;
      moveZ = mv.moveZ;
    } else if (best > 18) moveZ = 1;
    else if (best < 9) moveZ = -1;
    const pressed = {};
    const finishing = exchange && live.some((e) => e.boss && !e.boss.scriptHold && e.hp < 90);
    const nearEdge = target.pos && (target.pos.y < 0.2 || target.pos.z < 50 || target.pos.z > 70 || target.pos.x < 1142 || target.pos.x > 1172);
    if (assist || exchange && !finishing && !nearEdge && p.mana >= 15) pressed.gooBolt = true;
    if (!assist && p.hp < (exchange ? 70 : 45) && p.medkits > 0 && !p.downed) pressed.medkit = true;
    return {
      yaw,
      pitch,
      moveX,
      moveZ,
      held: { fire: !assist, sprint: best > 18 && !exchange },
      pressed,
      slot: -1,
      wheel: 0,
      actions: []
    };
  }

  // src/sim/campaign/kiteProbe.js
  var ATTACKS = ["bolt", "blast", "rugSlam"];
  function kiteLevel() {
    return makeV2Level({
      id: "kite-probe",
      name: "Kite",
      sections: [{
        id: "S",
        start: [8, 0, 8],
        geometry: [box({ id: "floor", at: [16, -0.25, 16], size: [48, 0.5, 48] })],
        encounters: [{
          id: "kite",
          activate: { min: [0, -4, 0], max: [40, 8, 40] },
          squads: [{
            id: "boss",
            trigger: { type: "onEnter" },
            at: [[16, 0, 16]],
            units: [{ type: "sahil", count: 1 }]
          }],
          script: {
            parts: [
              { id: "p1", hp: 1500, attacks: ATTACKS },
              { id: "p2", hp: 1500, attacks: ATTACKS },
              { id: "p3", hp: 1500, attacks: ATTACKS }
            ]
          }
        }]
      }]
    });
  }
  function bossOf2(state) {
    for (let i = 0; i < state.enemies.length; i++) {
      const e = state.enemies[i];
      if (e.boss && e.type === "sahil") return e;
    }
    return null;
  }
  function runSahilKiteProbe(seed = 7, mode = "success", maxFrames = 3600) {
    installLevel(kiteLevel());
    const state = createGameState({ seed });
    const p = state.players[state.localPlayerId];
    startCampaign(state, p, "kite-probe");
    grantSpell(state, p, "gooBolt");
    state.tuning.infiniteAmmo = true;
    const frames = maxFrames > 0 ? maxFrames : 3600;
    for (let i = 0; i < frames; i++) {
      const cmd = kiteCommand(state, mode);
      const dx = 16 - p.pos.x, dz = 16 - p.pos.z;
      if (dx * dx + dz * dz > 14 * 14) {
        cmd.yaw = Math.atan2(-dx, -dz);
        cmd.moveZ = 1;
        cmd.held.sprint = true;
      }
      simulate(state, { [p.id]: cmd });
    }
    const boss2 = bossOf2(state);
    const book3 = state.level && state.level.scripts && state.level.scripts.kite;
    return {
      seed,
      mode,
      tick: state.tick,
      hash: verifyStateHash(state),
      playerDead: !!p.dead,
      bossDead: !boss2 || !!boss2.dead,
      bossHp: boss2 ? boss2.hp : 0,
      part: book3 ? book3.part : 0
    };
  }

  // src/data/serverManifest.js
  var CANONICAL_BOSSES = [
    {
      id: "sahil",
      duelId: "sahil",
      levelId: "L02",
      encounterId: "S4-E4",
      parts: ["sahil"]
    },
    {
      id: "obama",
      duelId: "obama",
      levelId: "L04",
      // SB-BOSS is the payable fight. The corridor level still calls it S3-E3,
      // so a tree without SB-BOSS keeps issuing that encounter.
      encounterId: "SB-BOSS",
      legacyEncounterId: "S3-E3",
      parts: ["obamaDuo", "midgetDuo"],
      countAs: 1
    },
    {
      id: "broccoli",
      duelId: "broccoli",
      levelId: "L06",
      encounterId: "S4-E4",
      parts: ["broccoli"]
    },
    {
      // Shooter's glowie is not Duel's agent, and glowieAgent is a regular enemy.
      id: "glowie",
      duelId: null,
      distinctFrom: ["agent", "glowieAgent"],
      levelId: "L08",
      encounterId: "S4-E4",
      parts: ["glowie"]
    },
    {
      id: "tinubu",
      duelId: "tinubu",
      levelId: "L10",
      encounterId: "S3-E3",
      parts: ["tinubu"]
    }
  ];
  var BY_ID = Object.fromEntries(CANONICAL_BOSSES.map((b) => [b.id, b]));
  function bossById(id) {
    return BY_ID[id] || null;
  }
  function rejectedBossReason(id) {
    if (id === "agent" || id === "glowieAgent") return "glowie_not_agent";
    if (id === "obamaDuo" || id === "midgetDuo") return "obama_is_one";
    return null;
  }
  function resolveCanonicalEncounter(boss2) {
    const ids = [boss2.encounterId, boss2.legacyEncounterId];
    for (let i = 0; i < ids.length; i++) {
      if (!ids[i]) continue;
      const found = findEncounter(boss2.levelId, ids[i]);
      if (found) return found;
    }
    return null;
  }
  function findEncounter(levelId, encounterId) {
    const level = CAMPAIGN_LEVELS.find((l) => l.id === levelId);
    if (!level) return null;
    for (const section of level.sections) {
      const encounter = (section.encounters || []).find((e) => e.id === encounterId);
      if (encounter) return { level, section, encounter };
    }
    return null;
  }
  function sameParts(units2, parts) {
    for (let i = 0; i < parts.length; i++) {
      const got = units2.filter((u4) => u4.type === parts[i]);
      if (got.length !== 1 || got[0].count !== 1) return false;
    }
    return parts.length > 0;
  }
  function assertCanonicalManifest() {
    for (const boss2 of CANONICAL_BOSSES) {
      const found = resolveCanonicalEncounter(boss2);
      if (!found) throw new Error(`missing canonical encounter ${boss2.id}`);
      if (found.encounter.fleeAt) throw new Error(`${boss2.id} encounter flees and cannot pay`);
      const units2 = [];
      for (const squad6 of found.encounter.squads || []) {
        for (const u4 of squad6.units || []) units2.push(u4);
      }
      if (!sameParts(units2, boss2.parts)) throw new Error(`${boss2.id} parts drifted`);
      for (let i = 0; i < boss2.parts.length; i++) {
        const part = boss2.parts[i];
        if (!DUEL_BOSSES[part] || DUEL_BOSSES[part].id !== part) throw new Error(`${boss2.id} part ${part} drifted`);
      }
      if (boss2.id === "glowie" && (DUEL_BOSSES.agent || DUEL_BOSSES.glowieAgent)) {
        throw new Error("glowie collided with a Duel agent id");
      }
      if ((boss2.countAs || 1) !== 1) throw new Error(`${boss2.id} must count as one boss`);
    }
  }
  function gunBalance(g) {
    return {
      id: g.id,
      ammoType: g.ammoType,
      bossOnly: !!g.bossOnly,
      legendaryOnly: !!g.legendaryOnly,
      infiniteReserve: !!g.infiniteReserve,
      beam: !!g.beam,
      projectile: g.projectile || null,
      range: g.range || null,
      base: g.base
    };
  }
  function encounterFacts(boss2) {
    const found = resolveCanonicalEncounter(boss2);
    const units2 = [];
    for (const squad6 of found.encounter.squads) {
      for (const u4 of squad6.units) units2.push({ type: u4.type, count: u4.count });
    }
    return {
      id: boss2.id,
      duelId: boss2.duelId,
      distinctFrom: boss2.distinctFrom || [],
      levelId: boss2.levelId,
      encounterId: found.encounter.id,
      sectionStart: found.section.start,
      fleeAt: found.encounter.fleeAt || 0,
      units: units2,
      hp: boss2.parts.map((part) => ({ part, hp: DUEL_BOSSES[part] ? DUEL_BOSSES[part].hp : null }))
    };
  }
  function contentBody(protocolVersion) {
    return {
      protocol: protocolVersion,
      bosses: CANONICAL_BOSSES,
      encounters: CANONICAL_BOSSES.map(encounterFacts),
      guns: GUN_TYPES.map(gunBalance),
      qualities: QUALITIES.map((q2) => ({
        id: q2.id,
        damageMult: q2.damageMult,
        magMult: q2.magMult,
        reloadMult: q2.reloadMult,
        spreadMult: q2.spreadMult
      })),
      manufacturers: MANUFACTURERS.map((m) => ({ id: m.id, mods: m.mods, add: m.add, alwaysElement: !!m.alwaysElement })),
      parts: PARTS.map((p) => ({ id: p.id, mods: p.mods, add: p.add })),
      elements: ELEMENTS.map((e) => ({ id: e.id, proc: e.proc || null })),
      spells: SPELLS,
      tuning: TUNING
    };
  }
  function contentFingerprint(protocolVersion) {
    return fnv1a(stableStringify(contentBody(protocolVersion)));
  }
  assertCanonicalManifest();

  // src/server/protocol.js
  var PROTOCOL_VERSION = 1;
  var LIMITS = Object.freeze({
    maxSegmentFrames: 60 * 60 * 8,
    maxSegments: 24,
    maxTotalFrames: 60 * 60 * 45,
    maxSegmentText: 7e5,
    maxTotalText: 2 * 1024 * 1024,
    maxActionsPerSegment: 32,
    maxCpuMs: 15e3,
    maxStepMeters: 15,
    maxIdLength: 80
  });
  var BUTTONS = Object.freeze([
    "fire",
    "zoom",
    "sprint",
    "jump",
    "dash",
    "slide",
    "reload",
    "interact",
    "medkit",
    "skip",
    "gooBolt",
    "chainZap",
    "swarm",
    "manaShield",
    "meteor",
    "grapple"
  ]);
  var FRAME_BYTES = 12;
  var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var B64_REV = new Int16Array(128);
  B64_REV.fill(-1);
  for (let i = 0; i < B64.length; i++) B64_REV[B64.charCodeAt(i)] = i;
  var HOSTILE = {
    state: "bad_checkpoint",
    checkpoint: "bad_checkpoint",
    checkpointState: "bad_checkpoint",
    resume: "bad_checkpoint",
    snapshot: "bad_checkpoint",
    profile: "injected_inventory",
    loot: "injected_inventory",
    inventory: "injected_inventory",
    guns: "injected_inventory",
    loadout: "injected_inventory",
    ammo: "injected_inventory",
    resources: "injected_inventory",
    dt: "accelerated",
    timeScale: "accelerated",
    accel: "accelerated",
    skipTicks: "accelerated",
    godMode: "god_mode",
    god: "god_mode",
    tuning: "god_mode",
    debug: "debug",
    pos: "teleport",
    teleport: "teleport",
    position: "teleport"
  };
  function hostileKey(key2) {
    if (key2 === "__proto__" || key2 === "constructor" || key2 === "prototype") return "malformed";
    return HOSTILE[key2] || null;
  }
  function inspectValue(value, depth = 0) {
    if (depth > 12) return "malformed";
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return "nan";
      return null;
    }
    if (value == null || typeof value !== "object") return null;
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const hit = inspectValue(value[i], depth + 1);
        if (hit) return hit;
      }
      return null;
    }
    const keys2 = Object.keys(value);
    for (let i = 0; i < keys2.length; i++) {
      const why = hostileKey(keys2[i]);
      if (why) return why;
      const hit = inspectValue(value[keys2[i]], depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  function dequantizeCommand(q2) {
    const held = {};
    const pressed = {};
    for (let i = 0; i < BUTTONS.length; i++) {
      if (q2.held & 1 << i) held[BUTTONS[i]] = true;
      if (q2.pressed & 1 << i) pressed[BUTTONS[i]] = true;
    }
    const cmd = {
      yaw: q2.yaw / 32767 * Math.PI,
      pitch: q2.pitch / 32767 * 1.5,
      moveX: q2.moveX / 127,
      moveZ: q2.moveZ / 127,
      held,
      pressed,
      slot: q2.slot,
      wheel: q2.wheel,
      actions: []
    };
    if (q2.action === 1) cmd.actions.push({ type: "transitionDone" });
    return cmd;
  }
  function i16(lo, hi) {
    const n = lo | hi << 8;
    return n >= 32768 ? n - 65536 : n;
  }
  function i8(n) {
    return n >= 128 ? n - 256 : n;
  }
  function b64Value(ch) {
    if (ch === "=") return -2;
    const c = ch.charCodeAt(0);
    if (c > 127) return -1;
    return B64_REV[c];
  }
  function b64ToBytes(text) {
    if (typeof text !== "string" || text.length === 0 || text.length % 4 !== 0) return null;
    const out = [];
    for (let i = 0; i < text.length; i += 4) {
      const v0 = b64Value(text[i]);
      const v1 = b64Value(text[i + 1]);
      const v2 = b64Value(text[i + 2]);
      const v3 = b64Value(text[i + 3]);
      if (v0 < 0 || v1 < 0) return null;
      if (v2 === -1 || v3 === -1) return null;
      if (v2 === -2 && v3 !== -2) return null;
      const n = v0 << 18 | v1 << 12 | (v2 < 0 ? 0 : v2) << 6 | (v3 < 0 ? 0 : v3);
      out.push(n >>> 16 & 255);
      if (v2 !== -2) out.push(n >>> 8 & 255);
      if (v3 !== -2) out.push(n & 255);
    }
    return out;
  }
  function decodeFrames(text, n, actions) {
    if (typeof text !== "string") return { error: "malformed" };
    if (text.length > LIMITS.maxSegmentText) return { error: "oversized" };
    const bytes = b64ToBytes(text);
    if (!bytes || bytes.length !== n * FRAME_BYTES) return { error: "malformed" };
    const actionAt = /* @__PURE__ */ new Map();
    if (actions) {
      if (!Array.isArray(actions) || actions.length > LIMITS.maxActionsPerSegment) return { error: "malformed" };
      for (let i = 0; i < actions.length; i++) {
        const row = actions[i];
        if (!Array.isArray(row) || row.length !== 2) return { error: "malformed" };
        const [at2, id] = row;
        if (typeof at2 !== "number" || !Number.isInteger(at2)) return { error: "malformed" };
        if (at2 < 0) return { error: "negative" };
        if (at2 >= n) return { error: "malformed" };
        if (id === 2 || id === 3) return { error: id === 3 ? "god_mode" : "debug" };
        if (id !== 1) return { error: "debug" };
        if (actionAt.has(at2)) return { error: "malformed" };
        actionAt.set(at2, 1);
      }
    }
    const commands = new Array(n);
    for (let i = 0; i < n; i++) {
      const o = i * FRAME_BYTES;
      const q2 = {
        yaw: i16(bytes[o], bytes[o + 1]),
        pitch: i16(bytes[o + 2], bytes[o + 3]),
        moveX: i8(bytes[o + 4]),
        moveZ: i8(bytes[o + 5]),
        held: bytes[o + 6] | bytes[o + 7] << 8,
        pressed: bytes[o + 8] | bytes[o + 9] << 8,
        slot: i8(bytes[o + 10]),
        wheel: i8(bytes[o + 11]),
        action: actionAt.get(i) || 0
      };
      if (q2.yaw < -32767 || q2.yaw > 32767 || q2.pitch < -32767 || q2.pitch > 32767) return { error: "malformed" };
      if (q2.moveX < -127 || q2.moveX > 127 || q2.moveZ < -127 || q2.moveZ > 127) return { error: "malformed" };
      if (q2.slot < -1 || q2.slot > 4 || q2.wheel < -4 || q2.wheel > 4) return { error: "malformed" };
      if (q2.held > 65535 || q2.pressed > 65535) return { error: "malformed" };
      commands[i] = dequantizeCommand(q2);
    }
    return { commands };
  }
  var LOG_KEYS = ["v", "binding", "segments"];
  var BIND_KEYS = ["accountId", "sessionId", "day", "runId"];
  var SEG_KEYS = ["i", "from", "tick0", "n", "frames", "actions"];
  function exactKeys(obj, allowed) {
    const keys2 = Object.keys(obj);
    if (keys2.length !== allowed.length) return false;
    for (let i = 0; i < allowed.length; i++) if (keys2.indexOf(allowed[i]) < 0) return false;
    return true;
  }
  function validDay(s) {
    if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const y = Number(s.slice(0, 4));
    const m = Number(s.slice(5, 7));
    const d = Number(s.slice(8, 10));
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }
  function validId(s) {
    return typeof s === "string" && s.length <= LIMITS.maxIdLength && /^[A-Za-z0-9_.:@|-]+$/.test(s);
  }
  function bindingHash(binding) {
    return fnv1a(stableStringify({
      accountId: binding.accountId,
      sessionId: binding.sessionId,
      day: binding.day,
      runId: binding.runId
    }));
  }
  function logDigest(log) {
    const segments = (log.segments || []).map((s) => ({
      i: s.i,
      from: s.from,
      tick0: s.tick0,
      n: s.n,
      frames: s.frames,
      actions: s.actions || []
    }));
    return fnv1a(stableStringify({ v: log.v, binding: log.binding, segments }));
  }
  function preflightLog(log) {
    if (!log || typeof log !== "object" || Array.isArray(log)) return "malformed";
    const hostile = inspectValue(log);
    if (hostile) return hostile;
    if (!exactKeys(log, LOG_KEYS)) return "malformed";
    if (log.v !== PROTOCOL_VERSION) return "unsupported_version";
    if (!log.binding || typeof log.binding !== "object" || !exactKeys(log.binding, BIND_KEYS)) return "malformed";
    if (!validId(log.binding.accountId) || !validId(log.binding.sessionId) || !validId(log.binding.runId)) return "malformed";
    if (!validDay(log.binding.day)) return "malformed";
    if (!Array.isArray(log.segments) || log.segments.length < 1 || log.segments.length > LIMITS.maxSegments) {
      return "malformed";
    }
    let text = 0;
    let frames = 0;
    for (let i = 0; i < log.segments.length; i++) {
      const seg = log.segments[i];
      if (!seg || typeof seg !== "object" || Array.isArray(seg)) return "malformed";
      const keys2 = Object.keys(seg);
      for (let k = 0; k < keys2.length; k++) if (SEG_KEYS.indexOf(keys2[k]) < 0) return "malformed";
      if (!("i" in seg) || !("from" in seg) || !("tick0" in seg) || !("n" in seg) || !("frames" in seg)) return "malformed";
      if (typeof seg.i !== "number" || !Number.isInteger(seg.i) || seg.i !== i) return seg.i < 0 ? "negative" : "malformed";
      if (typeof seg.tick0 !== "number" || !Number.isInteger(seg.tick0)) return "malformed";
      if (seg.tick0 < 0 || seg.n < 0) return "negative";
      if (typeof seg.n !== "number" || !Number.isInteger(seg.n) || seg.n < 1) return "malformed";
      if (seg.n > LIMITS.maxSegmentFrames) return "oversized";
      if (typeof seg.frames !== "string") return Array.isArray(seg.frames) ? frameArrayReason(seg.frames) : "malformed";
      if (seg.frames.length > LIMITS.maxSegmentText) return "oversized";
      if (seg.from != null && (typeof seg.from !== "string" || !/^[0-9a-f]{8}$/.test(seg.from))) return "bad_checkpoint";
      text += seg.frames.length;
      frames += seg.n;
      if (i > 0) {
        const prev = log.segments[i - 1];
        if (seg.tick0 !== prev.tick0 + prev.n) return "accelerated";
        if (seg.from == null) return "bad_checkpoint";
      } else if (seg.tick0 !== 0 && seg.from == null) return "accelerated";
    }
    if (text > LIMITS.maxTotalText || frames > LIMITS.maxTotalFrames) return "oversized";
    return null;
  }
  function frameArrayReason(frames) {
    for (let i = 0; i < frames.length; i++) {
      const hit = inspectValue(frames[i]);
      if (hit) return hit;
    }
    return "malformed";
  }
  function movementDelta(prev, next2) {
    if (!prev || !next2) return "malformed";
    const dx = next2.x - prev.x;
    const dy = next2.y - prev.y;
    const dz = next2.z - prev.z;
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz)) return "nan";
    if (Math.hypot(dx, dy, dz) > LIMITS.maxStepMeters) return "teleport";
    return null;
  }

  // src/server/runContract.js
  var SOURCE_COMMIT = "2215995f40d999f31336815296e1e7b7726f932a";
  var ECONOMY = Object.freeze({
    mintsTickets: false,
    ticketsMintedByArtifact: 0,
    payoutAuthority: "server",
    wagerTransfersUncapped: true,
    wagerMayCreateTickets: false
  });
  var LOADOUT = "canonical-start";
  function reject(reason) {
    return {
      ok: false,
      reason,
      eligible: false,
      ticketsMinted: 0,
      ranked: false
    };
  }
  function canonicalLoadoutOk(state) {
    const p = state.players[state.localPlayerId];
    if (!p || p.tickets !== 0 || p.unlockedSlots !== 4) return false;
    if (p.resources) {
      const names = Object.keys(p.resources);
      for (let i = 0; i < names.length; i++) if (p.resources[names[i]] !== 0) return false;
    }
    if (!p.skills.health || p.skills.health.level !== 1 || !p.skills.gunslinger || p.skills.gunslinger.level !== 1) return false;
    if (p.skills.magic || p.skills.crafting) return false;
    if (!p.perks.gooBolt || p.perks.craftT1 || p.perks.swarm || p.perks.meteor) return false;
    const guns = p.guns.filter(Boolean);
    if (guns.length !== 1) return false;
    const g = guns[0];
    return g.type === "mg" && g.quality === "common" && g.manufacturer === "reliable" && g.element === "none" && g.source === "start" && !g.wacky;
  }
  function buildIssuedState(issuance) {
    const boss2 = bossById(issuance.canonicalBoss);
    const state = createGameState({ seed: issuance.seed, mode: "sandbox" });
    const p = state.players[state.localPlayerId];
    startCampaign(state, p, boss2.levelId);
    const section = sectionById(boss2.levelId, issuance.sectionId);
    state.level.section = section.id;
    state.level.intro = null;
    state.level.transition = null;
    state.level.won = false;
    state.level.lost = false;
    if (state.level.format === "v2") noteV2Section(state, section, getLevelRuntime(boss2.levelId));
    p.pos = { x: section.start[0], y: section.start[1], z: section.start[2] };
    p.prevPos = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
    p.vel = { x: 0, y: 0, z: 0 };
    p.yaw = section.yaw || 0;
    p.pitch = 0;
    state.mode = "campaign";
    grantSpell(state, p, "gooBolt");
    state.tuning = {
      godMode: false,
      enemyHpMult: 1,
      enemyDmgMult: 1,
      unlockAllRecipes: false,
      infiniteAmmo: false,
      freezeEnemies: false
    };
    return state;
  }
  function buildIssuance(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return reject("malformed");
    const hostile = inspectValue(input);
    if (hostile) return reject(hostile);
    if (input.v != null && input.v !== PROTOCOL_VERSION) return reject("unsupported_version");
    if (input.protocol != null && input.protocol !== PROTOCOL_VERSION) return reject("unsupported_version");
    if (input.loadout != null && input.loadout !== LOADOUT) return reject("injected_inventory");
    if ("profile" in input || "guns" in input || "loot" in input || "inventory" in input) return reject("injected_inventory");
    if ("checkpoint" in input || "state" in input) return reject("bad_checkpoint");
    const alias = rejectedBossReason(input.canonicalBoss);
    if (alias) return reject(alias);
    const boss2 = bossById(input.canonicalBoss);
    if (!boss2) return reject("unknown_boss");
    if (!validId(input.accountId) || !validId(input.sessionId) || !validId(input.runId)) return reject("malformed");
    if (!validDay(input.day)) return reject("malformed");
    if (typeof input.seed !== "number" || !Number.isInteger(input.seed) || input.seed < 1 || input.seed > 4294967295) {
      return reject(input.seed < 0 ? "negative" : "malformed");
    }
    const found = resolveCanonicalEncounter(boss2);
    if (!found) return reject("malformed");
    const issuance = {
      v: PROTOCOL_VERSION,
      protocol: PROTOCOL_VERSION,
      runId: input.runId,
      accountId: input.accountId,
      sessionId: input.sessionId,
      day: input.day,
      seed: input.seed,
      levelId: boss2.levelId,
      sectionId: found.section.id,
      encounterId: found.encounter.id,
      canonicalBoss: boss2.id,
      parts: boss2.parts.slice(),
      countAs: 1,
      loadout: LOADOUT,
      contentFingerprint: contentFingerprint(PROTOCOL_VERSION),
      maxFrames: LIMITS.maxTotalFrames,
      duelId: boss2.duelId,
      distinctFrom: boss2.distinctFrom || []
    };
    const state = buildIssuedState(issuance);
    if (!canonicalLoadoutOk(state)) return reject("injected_inventory");
    issuance.initialStateHash = verifyStateHash(state);
    return { ok: true, issuance, ticketsMinted: 0 };
  }

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
    for (let at2 = 0; at2 < bytes.length; at2 += 64) {
      for (let i = 0; i < 16; i++) {
        const j = at2 + i * 4;
        w[i] = bytes[j] << 24 | bytes[j + 1] << 16 | bytes[j + 2] << 8 | bytes[j + 3] | 0;
      }
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ w[i - 15] >>> 3;
        const s12 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ w[i - 2] >>> 10;
        w[i] = w[i - 16] + s0 + w[i - 7] + s12 | 0;
      }
      let [a, b, c, d, e, f, g, k] = h;
      for (let i = 0; i < 64; i++) {
        const S15 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = e & f ^ ~e & g;
        const t1 = k + S15 + ch + K[i] + w[i] | 0;
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

  // src/server/checkpoint.js
  var CHECKPOINT_VERSION = 1;
  var CHECKPOINT_LIMITS = Object.freeze({ bytes: 16 * 1024 * 1024, depth: 64, nodes: 1e6, array: 1e5, string: 16384, checkpoints: 64 });
  var forbidden = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype"]);
  var fail2 = () => {
    throw new Error("bad_private_checkpoint");
  };
  var integer = (n) => Number.isSafeInteger(n) && n >= 0;
  function boundedCheckpointJSON(value, exporting = false, limits = CHECKPOINT_LIMITS) {
    const ancestors = /* @__PURE__ */ new Set();
    let nodes = 0;
    let bytes = 0;
    function add3(n) {
      bytes += n;
      if (bytes > limits.bytes) fail2();
    }
    function textSize(s) {
      if (s.length > limits.string) fail2();
      const json = JSON.stringify(s);
      let n = 0;
      for (let i = 0; i < json.length; i++) {
        const c = json.charCodeAt(i);
        if (c < 128) n++;
        else if (c < 2048) n += 2;
        else if (c >= 55296 && c <= 56319) {
          n += 4;
          i++;
        } else n += 3;
      }
      return n;
    }
    function walk(v, depth) {
      if (++nodes > limits.nodes || depth > limits.depth) fail2();
      if (v === null) {
        add3(4);
        return null;
      }
      if (typeof v === "string") {
        add3(textSize(v));
        return v;
      }
      if (typeof v === "boolean") {
        add3(v ? 4 : 5);
        return v;
      }
      if (typeof v === "number") {
        if (!Number.isFinite(v)) fail2();
        add3(JSON.stringify(v).length);
        return v;
      }
      if (typeof v !== "object" || ancestors.has(v)) fail2();
      const proto = Object.getPrototypeOf(v);
      if (Array.isArray(v) ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) fail2();
      if (Object.getOwnPropertySymbols(v).length) fail2();
      ancestors.add(v);
      let result;
      if (Array.isArray(v)) {
        if (v.length > limits.array || Object.keys(v).length !== v.length || Object.getOwnPropertyNames(v).length !== v.length + 1) fail2();
        add3(2 + Math.max(0, v.length - 1));
        result = [];
        for (let i = 0; i < v.length; i++) {
          const descriptor = Object.getOwnPropertyDescriptor(v, String(i));
          if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) fail2();
          result.push(walk(descriptor.value, depth + 1));
        }
      } else {
        result = {};
        add3(2);
        let count = 0;
        for (const key2 of Object.getOwnPropertyNames(v)) {
          if (forbidden.has(key2)) fail2();
          const descriptor = Object.getOwnPropertyDescriptor(v, key2);
          if (!descriptor.enumerable || !("value" in descriptor)) fail2();
          if (exporting && descriptor.value === void 0) continue;
          add3(textSize(key2) + 1 + (count++ ? 1 : 0));
          result[key2] = walk(descriptor.value, depth + 1);
        }
      }
      ancestors.delete(v);
      return result;
    }
    return walk(value, 0);
  }
  var project = boundedCheckpointJSON;
  function keys(value, expected) {
    if (!value || Array.isArray(value) || typeof value !== "object") fail2();
    const actual = Object.keys(value).sort();
    const wanted = expected.slice().sort();
    if (actual.length !== wanted.length || actual.some((key2, i) => key2 !== wanted[i])) fail2();
  }
  function manifestOk(manifest) {
    keys(manifest, ["artifact", "sourceCommit", "sha256", "contentFingerprint", "protocol"]);
    if (manifest.artifact !== "shooter-sim" || manifest.protocol !== 1 || typeof manifest.sourceCommit !== "string" || typeof manifest.contentFingerprint !== "string" || typeof manifest.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(manifest.sha256) || !/^[0-9a-f]{40}$/.test(manifest.sourceCommit) || !/^[0-9a-f]{8}$/.test(manifest.contentFingerprint)) fail2();
  }
  function bindingOk(binding) {
    keys(binding, ["accountId", "sessionId", "day", "runId"]);
    for (const key2 of Object.keys(binding)) if (typeof binding[key2] !== "string" || !binding[key2].length || binding[key2].length > 256) fail2();
  }
  function stateOk(state) {
    if (!state || state.version !== 1 || !integer(state.tick) || !Number.isFinite(state.time) || state.time < 0 || !integer(state.nextId) || !integer(state.localPlayerId) || !integer(state.seed) || state.seed > 4294967295 || typeof state.mode !== "string" || !state.mode.length) fail2();
    keys(state.rng, ["a", "b", "c", "d"]);
    for (const word of Object.values(state.rng)) if (!Number.isInteger(word) || word < -2147483648 || word > 4294967295) fail2();
    if (!state.players || Array.isArray(state.players) || typeof state.players !== "object" || !state.players[state.localPlayerId]) fail2();
    for (const [id, player] of Object.entries(state.players)) {
      if (String(player?.id) !== id || player.kind !== "player") fail2();
      for (const name of ["pos", "prevPos", "vel"]) {
        if (!player[name] || !["x", "y", "z"].every((axis) => Number.isFinite(player[name][axis]))) fail2();
      }
    }
    if (state.mode === "campaign" && !state.level) fail2();
    if (state.level) {
      if (typeof state.level.id !== "string" || typeof state.level.section !== "string") fail2();
      const runtime = getLevelRuntime(state.level.id);
      if (runtime.id !== state.level.id || !runtime.sections.some((section) => section.id === state.level.section)) fail2();
    }
    const ids = /* @__PURE__ */ new Set();
    const entities = Object.values(state.players);
    for (const name of ["enemies", "allies", "projectiles", "pickups", "hazards"]) {
      if (!Array.isArray(state[name])) fail2();
      for (const entity of state[name]) entities.push(entity);
    }
    for (const entity of entities) {
      if (!entity || !integer(entity.id) || entity.id >= state.nextId || ids.has(entity.id)) fail2();
      ids.add(entity.id);
    }
  }
  function validate(body) {
    keys(body, ["v", "manifest", "binding", "state", "campaignCheckpoints", "parts", "counters"]);
    if (body.v !== CHECKPOINT_VERSION) fail2();
    manifestOk(body.manifest);
    bindingOk(body.binding);
    stateOk(body.state);
    keys(body.counters, ["frames", "segments"]);
    if (!integer(body.counters.frames) || !integer(body.counters.segments)) fail2();
    if (!body.parts || Array.isArray(body.parts) || typeof body.parts !== "object") fail2();
    const partTypes = new Set(CANONICAL_BOSSES.flatMap((boss2) => boss2.parts));
    for (const [type, part] of Object.entries(body.parts)) {
      if (!partTypes.has(type)) fail2();
      keys(part, ["type", "spawned", "dead", "fled", "sourceKind", "sourceId"]);
      if (part.type !== type || typeof part.spawned !== "boolean" || typeof part.dead !== "boolean" || typeof part.fled !== "boolean" || part.sourceKind !== null && typeof part.sourceKind !== "string" || part.sourceId !== null && !integer(part.sourceId)) fail2();
    }
    if (!Array.isArray(body.campaignCheckpoints) || body.campaignCheckpoints.length > CHECKPOINT_LIMITS.checkpoints) fail2();
    let allowed = /* @__PURE__ */ new Set();
    if (body.state.level) {
      const runtime = getLevelRuntime(body.state.level.id);
      if (runtime.id !== body.state.level.id) fail2();
      allowed = /* @__PURE__ */ new Set(["start", ...runtime.sections.flatMap((sec) => (sec.checkpoints || []).map((cp) => cp.id))]);
    }
    const seen2 = /* @__PURE__ */ new Set();
    for (const entry of body.campaignCheckpoints) {
      keys(entry, ["id", "state"]);
      if (typeof entry.id !== "string" || !allowed.has(entry.id) || seen2.has(entry.id)) fail2();
      seen2.add(entry.id);
      stateOk(entry.state);
      if (entry.state.seed !== body.state.seed || entry.state.localPlayerId !== body.state.localPlayerId || entry.state.tick > body.state.tick || entry.state.level?.id !== body.state.level?.id || entry.state.level?.checkpoint !== entry.id) fail2();
      if ("campaignCheckpoints" in entry.state || "privateCheckpoint" in entry.state) fail2();
    }
    if (body.state.mode === "campaign" && (!seen2.has("start") || !seen2.has(body.state.level.checkpoint))) fail2();
  }
  function privateHash(body) {
    return fnv1a(stableStringify(body));
  }
  function createPrivateCheckpoint(state, { manifest, binding, parts = {}, counters }) {
    const body = project({
      v: CHECKPOINT_VERSION,
      manifest,
      binding,
      state,
      // Borrow trusted references only for the bounded projection below: do not
      // allocate a deep clone before checking the aggregate traversal budget.
      campaignCheckpoints: exportCampaignCheckpoints(state, (value) => value),
      parts,
      counters: counters === void 0 ? { frames: 0, segments: 0 } : counters
    }, true);
    if (counters === void 0) body.counters.frames = body.state?.tick;
    validate(body);
    const envelope = { ...body, privateHash: privateHash(body) };
    return project(envelope);
  }
  function restorePrivateCheckpoint(envelope, { manifest, binding }) {
    const copy = project(envelope);
    keys(copy, ["v", "manifest", "binding", "state", "campaignCheckpoints", "parts", "counters", "privateHash"]);
    const { privateHash: digest, ...body } = copy;
    validate(body);
    const expectedManifest = project(manifest), expectedBinding = project(binding);
    manifestOk(expectedManifest);
    bindingOk(expectedBinding);
    if (stableStringify(body.manifest) !== stableStringify(expectedManifest) || stableStringify(body.binding) !== stableStringify(expectedBinding) || typeof digest !== "string" || digest !== privateHash(body)) fail2();
    importCampaignCheckpoints(body.state, body.campaignCheckpoints);
    return { state: body.state, parts: body.parts, counters: body.counters };
  }

  // src/server/incremental.js
  var UPLOAD_PROTOCOL_VERSION = 2;
  var REPLAY_API_VERSION = 2;
  var INCREMENTAL_CHECKPOINT_SCHEMA_VERSION = 2;
  var INCREMENTAL_LIMITS = Object.freeze({
    batchFramesTextBytes: 2097152,
    runFramesTextBytes: 67108864,
    bodyBytes: 2162688,
    batchFrames: 28800,
    runFrames: 162e3,
    batches: 4096,
    batchActions: 32,
    runActions: 131072,
    depth: 12,
    idLength: 80
  });
  var PRIVATE_LIMITS = { ...CHECKPOINT_LIMITS, string: INCREMENTAL_LIMITS.batchFramesTextBytes };
  var WIRE_LIMITS = { ...CHECKPOINT_LIMITS, bytes: INCREMENTAL_LIMITS.bodyBytes, depth: INCREMENTAL_LIMITS.depth, string: INCREMENTAL_LIMITS.batchFramesTextBytes, array: 32, nodes: 1024 };
  var int2 = (n) => Number.isSafeInteger(n) && n >= 0;
  function bad(reason) {
    const error = new Error(reason);
    error.reason = reason;
    throw error;
  }
  function exact(object, names) {
    if (!object || typeof object !== "object" || Array.isArray(object)) bad("malformed");
    const keys2 = Object.keys(object).sort(), expected = names.slice().sort();
    if (keys2.length !== expected.length || keys2.some((key2, i) => key2 !== expected[i])) bad("malformed");
  }
  var equal = (a, b) => stableStringify(a) === stableStringify(b);
  var bindingOf = (issuance) => ({ accountId: issuance.accountId, sessionId: issuance.sessionId, day: issuance.day, runId: issuance.runId });
  function clone(value) {
    return boundedCheckpointJSON(value, false, PRIVATE_LIMITS);
  }
  function resultError(reason) {
    return { publicResult: { version: REPLAY_API_VERSION, status: "invalid", reason, retryable: false, eligible: false, ranked: false, ticketsMinted: 0 }, privateCheckpoint: null };
  }
  function guard(operation) {
    try {
      return operation();
    } catch (error) {
      if (!error.operationalReason && (error.reason || error.message === "bad_private_checkpoint")) return resultError(error.reason || "bad_private_checkpoint");
      return { publicResult: {
        version: REPLAY_API_VERSION,
        status: "pending_retryable",
        reason: error.operationalReason || "execution_failure",
        retryable: true,
        eligible: false,
        ranked: false,
        ticketsMinted: 0
      }, privateCheckpoint: null };
    }
  }
  function replayBatchDigest(batch) {
    return sha256Hex(stableStringify(batch));
  }
  function decodeReplayBatch(text) {
    if (typeof text !== "string") bad("malformed");
    if (utf8Bytes2(text) > INCREMENTAL_LIMITS.bodyBytes) bad("oversized");
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      bad("malformed");
    }
    let batch;
    try {
      batch = boundedCheckpointJSON(parsed, false, WIRE_LIMITS);
    } catch {
      bad("malformed");
    }
    const hostile = inspectValue(batch);
    if (hostile) bad(hostile);
    exact(batch, ["protocol", "runId", "sequence", "tick0", "n", "frames", "actions"]);
    if (batch.protocol !== UPLOAD_PROTOCOL_VERSION) bad("unsupported_version");
    if (!validId(batch.runId) || !/^[\x21-\x7e]+$/.test(batch.runId) || batch.runId.length > 80) bad("malformed");
    if (!int2(batch.sequence) || !int2(batch.tick0) || !int2(batch.n) || batch.n < 1) bad("malformed");
    if (batch.n > INCREMENTAL_LIMITS.batchFrames || typeof batch.frames !== "string" || batch.frames.length > INCREMENTAL_LIMITS.batchFramesTextBytes) bad("oversized");
    if (batch.frames.length !== batch.n * 16 || !/^[A-Za-z0-9+/]+$/.test(batch.frames)) bad("malformed");
    if (!Array.isArray(batch.actions) || batch.actions.length > INCREMENTAL_LIMITS.batchActions) bad("oversized");
    let previous = -1;
    for (const action of batch.actions) {
      if (!Array.isArray(action) || action.length !== 2 || !int2(action[0]) || action[0] <= previous || action[0] >= batch.n || action[1] !== 1) bad("malformed");
      previous = action[0];
    }
    const decoded = decodeFrames(batch.frames, batch.n, batch.actions);
    if (decoded.error) bad(decoded.error);
    return { batch, commands: decoded.commands };
  }
  function utf8Bytes2(text) {
    let n = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c < 128) n++;
      else if (c < 2048) n += 2;
      else if (c >= 55296 && c <= 56319 && i + 1 < text.length && text.charCodeAt(i + 1) >= 56320 && text.charCodeAt(i + 1) <= 57343) {
        n += 4;
        i++;
      } else n += 3;
    }
    return n;
  }
  function original(ctx) {
    if (!ctx || !ctx.issuance || !ctx.manifest) bad("malformed");
    const issuance = clone(ctx.issuance), manifest = clone(ctx.manifest);
    const binding = bindingOf(issuance);
    const built = buildIssuance({ ...binding, canonicalBoss: issuance.canonicalBoss, seed: issuance.seed });
    if (!built.ok || !equal(built.issuance, issuance)) bad("bad_issuance");
    if (manifest.contentFingerprint !== issuance.contentFingerprint || manifest.contentFingerprint !== contentFingerprint(1)) bad("fingerprint_mismatch");
    return { issuance, manifest, binding };
  }
  function checkAccounting(a, snapshot, pending, terminal, issuance, validatePendingWire = true) {
    let commands = null;
    exact(a, ["acceptedFrames", "verifiedFrames", "simFrames", "framesTextBytes", "verifiedFramesTextBytes", "actions", "verifiedActions", "batches", "verifiedBatches"]);
    if (Object.values(a).some((n) => !int2(n))) bad("bad_private_checkpoint");
    if (a.acceptedFrames > Math.min(issuance.maxFrames, INCREMENTAL_LIMITS.runFrames) || a.framesTextBytes > INCREMENTAL_LIMITS.runFramesTextBytes || a.actions > INCREMENTAL_LIMITS.runActions || a.batches > INCREMENTAL_LIMITS.batches || a.verifiedFrames > a.acceptedFrames || a.verifiedFramesTextBytes > a.framesTextBytes || a.verifiedActions > a.actions || a.verifiedBatches > a.batches || a.simFrames !== snapshot.state.tick || a.simFrames > a.verifiedFrames || a.framesTextBytes !== a.acceptedFrames * 16 || a.verifiedFramesTextBytes !== a.verifiedFrames * 16 || a.actions > a.acceptedFrames || a.verifiedActions > a.verifiedFrames || a.actions > a.batches * INCREMENTAL_LIMITS.batchActions || a.batches > a.acceptedFrames || a.verifiedBatches > a.verifiedFrames || a.acceptedFrames > a.batches * INCREMENTAL_LIMITS.batchFrames || snapshot.counters.frames !== a.verifiedFrames || snapshot.counters.segments !== a.verifiedBatches) bad("bad_private_checkpoint");
    const classified = classify(snapshot.parts, bossById(issuance.canonicalBoss), snapshot.state.players[snapshot.state.localPlayerId].dead, snapshot.state.localPlayerId);
    if (!terminal && (a.simFrames !== a.verifiedFrames || classified.outcome !== "incomplete")) bad("bad_private_checkpoint");
    if (terminal) {
      exact(terminal, ["outcome", "reason", "eligible", "ranked", "canonicalCount", "parts", "stateHash", "simTick", "inputFrame"]);
      if (!["clear", "assisted", "fail"].includes(terminal.outcome) || terminal.simTick !== a.simFrames || terminal.inputFrame !== terminal.simTick || terminal.stateHash !== verifyStateHash(snapshot.state)) bad("bad_private_checkpoint");
      const expected = classified;
      if (!equal(terminal.parts, expected.parts) || terminal.outcome !== expected.outcome || terminal.reason !== expected.reason || terminal.eligible !== expected.eligible || terminal.ranked !== (expected.outcome === "clear") || terminal.canonicalCount !== (["clear", "assisted"].includes(expected.outcome) ? 1 : 0)) bad("bad_private_checkpoint");
    }
    if (pending) {
      exact(pending, ["batch", "cursor", "sha256"]);
      const decoded = validatePendingWire ? decodeReplayBatch(JSON.stringify(pending.batch)) : null;
      const batch = decoded ? decoded.batch : pending.batch;
      commands = decoded ? decoded.commands : null;
      if (!int2(pending.cursor) || pending.cursor >= batch.n || validatePendingWire && pending.sha256 !== replayBatchDigest(batch) || batch.runId !== issuance.runId || batch.sequence !== a.batches - 1 || batch.tick0 + batch.n !== a.acceptedFrames || batch.tick0 + pending.cursor !== a.verifiedFrames || batch.tick0 > a.verifiedBatches * INCREMENTAL_LIMITS.batchFrames || a.verifiedBatches !== a.batches - 1) bad("bad_private_checkpoint");
      const unverifiedActions = batch.actions.filter((action) => action[0] >= pending.cursor).length;
      if (a.framesTextBytes - a.verifiedFramesTextBytes !== (batch.n - pending.cursor) * 16 || a.actions - a.verifiedActions !== unverifiedActions) bad("bad_private_checkpoint");
    } else if (a.acceptedFrames !== a.verifiedFrames || a.framesTextBytes !== a.verifiedFramesTextBytes || a.actions !== a.verifiedActions || a.batches !== a.verifiedBatches) bad("bad_private_checkpoint");
    return commands;
  }
  function save(state, parts, metadata, origin) {
    try {
      const body = {
        v: INCREMENTAL_CHECKPOINT_SCHEMA_VERSION,
        issuance: origin.issuance,
        snapshot: createPrivateCheckpoint(state, {
          manifest: origin.manifest,
          binding: origin.binding,
          parts,
          counters: { frames: metadata.accounting.verifiedFrames, segments: metadata.accounting.verifiedBatches }
        }),
        accounting: metadata.accounting,
        pending: metadata.pending,
        firstTerminal: metadata.firstTerminal
      };
      checkAccounting(body.accounting, { state, parts, counters: body.snapshot.counters }, body.pending, body.firstTerminal, origin.issuance, false);
      const copy = clone(body);
      return { ...copy, privateHash: fnv1a(stableStringify(copy)) };
    } catch {
      const error = new Error("checkpoint_export_failure");
      error.operationalReason = "checkpoint_export_failure";
      throw error;
    }
  }
  function load(checkpoint, origin) {
    const copy = clone(checkpoint);
    exact(copy, ["v", "issuance", "snapshot", "accounting", "pending", "firstTerminal", "privateHash"]);
    const { privateHash: privateHash2, ...body } = copy;
    if (body.v !== INCREMENTAL_CHECKPOINT_SCHEMA_VERSION || privateHash2 !== fnv1a(stableStringify(body)) || !equal(body.issuance, origin.issuance)) bad("bad_private_checkpoint");
    const restored = restorePrivateCheckpoint(body.snapshot, { manifest: origin.manifest, binding: origin.binding });
    const cheat = runtimeCheat(restored.state) || inventoryCheat(restored.state);
    if (cheat) bad(cheat);
    const commands = checkAccounting(body.accounting, restored, body.pending, body.firstTerminal, origin.issuance);
    return { ...body, state: restored.state, parts: restored.parts, commands };
  }
  function response(checkpoint, status, reason, retryable = false) {
    const a = checkpoint.accounting, terminal = checkpoint.firstTerminal;
    return { privateCheckpoint: checkpoint, publicResult: {
      version: REPLAY_API_VERSION,
      status,
      reason,
      retryable,
      ticketsMinted: 0,
      eligible: !!terminal?.eligible,
      ranked: !!terminal?.ranked,
      acceptedInputTick: a.acceptedFrames,
      verifiedInputTick: a.verifiedFrames,
      simulationTick: a.simFrames,
      acceptedBatches: a.batches,
      verifiedBatches: a.verifiedBatches,
      framesTextBytes: a.framesTextBytes,
      verifiedFramesTextBytes: a.verifiedFramesTextBytes,
      actions: a.actions,
      verifiedActions: a.verifiedActions,
      terminal: terminal ? clone(terminal) : null
    } };
  }
  function beginIncrementalReplay(ctx) {
    return guard(() => {
      const origin = original(ctx), state = buildIssuedState(origin.issuance);
      if (!canonicalLoadoutOk(state) || verifyStateHash(state) !== origin.issuance.initialStateHash) bad("bad_start");
      const parts = {};
      noteParts(parts, state, bossById(origin.issuance.canonicalBoss));
      const accounting = { acceptedFrames: 0, verifiedFrames: 0, simFrames: 0, framesTextBytes: 0, verifiedFramesTextBytes: 0, actions: 0, verifiedActions: 0, batches: 0, verifiedBatches: 0 };
      return response(save(state, parts, { accounting, pending: null, firstTerminal: null }, origin), "verified", "ready");
    });
  }
  function acceptReplayBatch(text, checkpoint, ctx) {
    return guard(() => {
      const origin = original(ctx), current = load(checkpoint, origin);
      if (current.pending) bad("pending_batch");
      const { batch } = decodeReplayBatch(text), a = current.accounting;
      if (batch.runId !== origin.issuance.runId) bad("rebind");
      if (batch.sequence !== a.batches || batch.tick0 !== a.acceptedFrames) bad("history_conflict");
      const accepted = clone(ctx.accepted);
      exact(accepted, ["runId", "sequence", "tick0", "n", "sha256", "binding", "acceptedBeforeTerminal"]);
      if (accepted.runId !== batch.runId || accepted.sequence !== batch.sequence || accepted.tick0 !== batch.tick0 || accepted.n !== batch.n || accepted.sha256 !== replayBatchDigest(batch) || !equal(accepted.binding, origin.binding) || typeof accepted.acceptedBeforeTerminal !== "boolean") bad("bad_accepted_record");
      if (current.firstTerminal && !accepted.acceptedBeforeTerminal) bad("terminal_closed");
      if (a.acceptedFrames + batch.n > Math.min(origin.issuance.maxFrames, INCREMENTAL_LIMITS.runFrames) || a.framesTextBytes + batch.frames.length > INCREMENTAL_LIMITS.runFramesTextBytes || a.actions + batch.actions.length > INCREMENTAL_LIMITS.runActions || a.batches + 1 > INCREMENTAL_LIMITS.batches) bad("oversized");
      a.acceptedFrames += batch.n;
      a.framesTextBytes += batch.frames.length;
      a.actions += batch.actions.length;
      a.batches++;
      const pending = { batch, cursor: 0, sha256: accepted.sha256 };
      return response(save(current.state, current.parts, { ...current, pending }, origin), "received", "accepted");
    });
  }
  function stepReplaySlice(checkpoint, ctx) {
    return guard(() => {
      const clock = typeof ctx?.clock === "function" ? ctx.clock : () => Date.now();
      const started = clock();
      const origin = original(ctx), current = load(checkpoint, origin);
      const work = ctx.maxWorkFrames;
      if (!int2(work) || work < 1 || work > INCREMENTAL_LIMITS.batchFrames) bad("bad_work_limit");
      if (!current.pending) return response(checkpoint, current.firstTerminal ? "terminal_verified" : "verified", "idle");
      const pending = current.pending;
      const commands = current.commands;
      const boss2 = bossById(origin.issuance.canonicalBoss), playerId = current.state.localPlayerId;
      let timedOut = false, count = 0;
      while (pending.cursor < pending.batch.n && count < work) {
        if (clock() - started >= LIMITS.maxCpuMs) {
          timedOut = true;
          break;
        }
        const index = pending.cursor;
        if (!current.firstTerminal) {
          const before = { ...current.state.players[playerId].pos };
          simulate(current.state, { [playerId]: commands[index] });
          const moved = movementDelta(before, current.state.players[playerId].pos);
          if (moved && !checkpointRestored(current.state)) bad(moved);
          const cheat = runtimeCheat(current.state) || inventoryCheat(current.state);
          if (cheat) bad(cheat);
          noteParts(current.parts, current.state, boss2);
          const end = classify(current.parts, boss2, current.state.players[playerId].dead, playerId);
          current.accounting.simFrames = current.state.tick;
          if (end.outcome !== "incomplete") current.firstTerminal = {
            ...end,
            ranked: end.outcome === "clear",
            canonicalCount: ["clear", "assisted"].includes(end.outcome) ? 1 : 0,
            stateHash: verifyStateHash(current.state),
            simTick: current.state.tick,
            inputFrame: current.accounting.verifiedFrames + 1
          };
        }
        pending.cursor++;
        count++;
        current.accounting.verifiedFrames++;
        current.accounting.verifiedFramesTextBytes += 16;
        if (pending.batch.actions.some((action) => action[0] === index)) current.accounting.verifiedActions++;
      }
      if (pending.cursor === pending.batch.n) {
        current.pending = null;
        current.accounting.verifiedBatches++;
      }
      const next2 = save(current.state, current.parts, current, origin);
      return response(
        next2,
        timedOut ? "pending_retryable" : current.pending ? "received" : current.firstTerminal ? "terminal_verified" : "verified",
        timedOut ? "execution_timeout" : current.pending ? "slice_complete" : current.firstTerminal?.reason || "boss_alive",
        timedOut
      );
    });
  }
  function publicReplayJSON(workerResult) {
    const p = workerResult.publicResult;
    const out = {};
    for (const key2 of [
      "version",
      "status",
      "reason",
      "retryable",
      "eligible",
      "ranked",
      "ticketsMinted",
      "acceptedInputTick",
      "verifiedInputTick",
      "simulationTick",
      "acceptedBatches",
      "verifiedBatches",
      "framesTextBytes",
      "verifiedFramesTextBytes",
      "actions",
      "verifiedActions"
    ]) if (p[key2] !== void 0) out[key2] = p[key2];
    if (p.terminal) {
      out.terminal = {};
      for (const key2 of ["outcome", "reason", "eligible", "ranked", "canonicalCount", "stateHash", "simTick", "inputFrame"]) out.terminal[key2] = p.terminal[key2];
    } else out.terminal = null;
    return JSON.stringify(out);
  }

  // src/server/verify.js
  function pureClone(value) {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) {
      const arr = new Array(value.length);
      for (let i = 0; i < value.length; i++) arr[i] = pureClone(value[i]);
      return arr;
    }
    const out = {};
    const keys2 = Object.keys(value);
    for (let i = 0; i < keys2.length; i++) out[keys2[i]] = pureClone(value[keys2[i]]);
    return out;
  }
  if (typeof globalThis !== "undefined" && globalThis.__SPROTO_VERIFY_BUNDLE) {
    globalThis.structuredClone = pureClone;
  }
  function fail3(reason, extra = {}) {
    return {
      ok: false,
      reason,
      eligible: false,
      ranked: false,
      ticketsMinted: 0,
      outcome: "rejected",
      canonicalBoss: null,
      canonicalCount: 0,
      protocol: PROTOCOL_VERSION,
      ...extra
    };
  }
  function clockOf(ctx) {
    if (ctx && typeof ctx.clock === "function") return ctx.clock;
    return () => Date.now();
  }
  function seen(list, value) {
    return Array.isArray(list) && list.indexOf(value) >= 0;
  }
  function checkpointOf(state, seen2) {
    return {
      hash: verifyStateHash(state),
      tick: state.tick,
      state: pureClone(state),
      parts: pureClone(seen2)
    };
  }
  function publicReceipt(receipt) {
    const out = { ...receipt };
    if (out.checkpoint) {
      out.checkpoint = { hash: out.checkpoint.hash, tick: out.checkpoint.tick, parts: out.checkpoint.parts };
    }
    return out;
  }
  function verifyRun(log, ctx) {
    const started = clockOf(ctx)();
    const pre = preflightLog(log);
    if (pre) return fail3(pre);
    if (!ctx || typeof ctx !== "object" || !ctx.issuance) return fail3("malformed");
    const issuance = ctx.issuance;
    if (issuance.v !== PROTOCOL_VERSION || issuance.protocol !== PROTOCOL_VERSION) return fail3("unsupported_version");
    const boss2 = bossById(issuance.canonicalBoss);
    if (!boss2) return fail3(rejectedOrUnknown(issuance.canonicalBoss));
    const callerAccount = ctx.accountId != null ? ctx.accountId : issuance.accountId;
    const callerSession = ctx.sessionId != null ? ctx.sessionId : issuance.sessionId;
    const callerDay = ctx.day != null ? ctx.day : issuance.day;
    const binding = log.binding;
    if (callerAccount !== issuance.accountId || binding.accountId !== issuance.accountId || callerSession !== issuance.sessionId || binding.sessionId !== issuance.sessionId || callerDay !== issuance.day || binding.day !== issuance.day || binding.runId !== issuance.runId) {
      return fail3("rebind", { canonicalBoss: boss2.id });
    }
    const digest = logDigest(log);
    if (seen(ctx.seenDigests, digest)) return fail3("reused_log", { logDigest: digest, canonicalBoss: boss2.id });
    if (seen(ctx.seenRunIds, issuance.runId)) return fail3("reused_run", { logDigest: digest, canonicalBoss: boss2.id });
    const liveFingerprint = contentFingerprint(PROTOCOL_VERSION);
    if (issuance.contentFingerprint !== liveFingerprint) return fail3("fingerprint_mismatch", { logDigest: digest });
    let state;
    let tickBase = 0;
    if (ctx.resume) {
      if (!ctx.resume.state || ctx.resume.hash !== verifyStateHash(ctx.resume.state)) return fail3("bad_checkpoint", { logDigest: digest });
      if (log.segments[0].from !== ctx.resume.hash || log.segments[0].tick0 !== ctx.resume.tick) {
        return fail3("bad_checkpoint", { logDigest: digest });
      }
      const cheat = runtimeCheat(ctx.resume.state) || inventoryCheat(ctx.resume.state);
      if (cheat) return fail3(cheat, { logDigest: digest });
      state = pureClone(ctx.resume.state);
      if (verifyStateHash(state) !== ctx.resume.hash) return fail3("bad_checkpoint", { logDigest: digest });
      tickBase = ctx.resume.tick;
    } else {
      if (log.segments[0].from != null || log.segments[0].tick0 !== 0) return fail3("bad_checkpoint", { logDigest: digest });
      state = buildIssuedState(issuance);
      if (!canonicalLoadoutOk(state)) return fail3("injected_inventory", { logDigest: digest });
      if (issuance.initialStateHash !== verifyStateHash(state)) return fail3("bad_start", { logDigest: digest });
    }
    const now = clockOf(ctx);
    let total = 0;
    const playerId = state.localPlayerId;
    const seenParts = {};
    if (ctx.resume && ctx.resume.parts) {
      for (let i = 0; i < boss2.parts.length; i++) {
        const type = boss2.parts[i];
        if (ctx.resume.parts[type]) seenParts[type] = pureClone(ctx.resume.parts[type]);
      }
    }
    noteParts(seenParts, state, boss2);
    for (let s = 0; s < log.segments.length; s++) {
      const seg = log.segments[s];
      if (s > 0 && seg.from !== verifyStateHash(state)) return fail3("bad_checkpoint", { logDigest: digest, tick: state.tick });
      if (seg.tick0 !== state.tick) return fail3(s === 0 ? "bad_checkpoint" : "accelerated", { logDigest: digest, tick: state.tick });
      if (total + seg.n > (issuance.maxFrames || LIMITS.maxTotalFrames)) return fail3("oversized", { logDigest: digest });
      const decoded = decodeFrames(seg.frames, seg.n, seg.actions || []);
      if (decoded.error) return fail3(decoded.error, { logDigest: digest, tick: state.tick });
      for (let f = 0; f < decoded.commands.length; f++) {
        if ((f & 63) === 0 && now() - started > LIMITS.maxCpuMs) return fail3("cpu_budget", { logDigest: digest, tick: state.tick });
        const before = { x: state.players[playerId].pos.x, y: state.players[playerId].pos.y, z: state.players[playerId].pos.z };
        simulate(state, { [playerId]: decoded.commands[f] });
        const moved = movementDelta(before, state.players[playerId].pos);
        if (moved && !checkpointRestored(state)) return fail3(moved, { logDigest: digest, tick: state.tick });
        const cheat = runtimeCheat(state) || inventoryCheat(state);
        if (cheat) return fail3(cheat, { logDigest: digest, tick: state.tick });
        noteParts(seenParts, state, boss2);
        total++;
      }
    }
    if (state.tick !== tickBase + total) return fail3("accelerated", { logDigest: digest, tick: state.tick });
    const end = classify(seenParts, boss2, state.players[playerId].dead, playerId);
    const checkpoint = checkpointOf(state, seenParts);
    return {
      ok: true,
      reason: end.reason,
      outcome: end.outcome,
      eligible: end.eligible,
      ranked: end.outcome === "clear",
      ticketsMinted: 0,
      canonicalBoss: boss2.id,
      canonicalCount: end.outcome === "clear" || end.outcome === "assisted" ? 1 : 0,
      parts: end.parts,
      duelId: boss2.duelId,
      distinctFrom: boss2.distinctFrom || [],
      stateHash: checkpoint.hash,
      tick: state.tick,
      frames: total,
      protocol: PROTOCOL_VERSION,
      contentFingerprint: liveFingerprint,
      sourceCommit: /^0{40}$/.test(SOURCE_COMMIT) ? null : SOURCE_COMMIT,
      logDigest: digest,
      bindingHash: bindingHash(binding),
      checkpoint,
      cpuMs: now() - started,
      economy: ECONOMY
    };
  }
  function rejectedOrUnknown(id) {
    if (id === "agent" || id === "glowieAgent") return "glowie_not_agent";
    if (id === "obamaDuo" || id === "midgetDuo") return "obama_is_one";
    return "unknown_boss";
  }
  function verifyRunJSON(text) {
    if (typeof text !== "string") return JSON.stringify(fail3("malformed"));
    if (/[[,:]\s*-?(?:NaN|Infinity)\b/.test(text)) return JSON.stringify(fail3("nan"));
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return JSON.stringify(fail3("malformed"));
    }
    if (Array.isArray(body)) {
      const out = [];
      for (let i = 0; i < body.length; i++) out.push(publicReceipt(verifyRun(body[i].log, body[i].ctx)));
      return JSON.stringify(out);
    }
    return JSON.stringify(publicReceipt(verifyRun(body.log, body.ctx)));
  }
  function runKiteProbeJSON(text) {
    let body = {};
    if (typeof text === "string" && text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = {};
      }
    }
    return JSON.stringify(runSahilKiteProbe(body.seed, body.mode, body.maxFrames));
  }
  function contentFingerprintOf() {
    return contentFingerprint(PROTOCOL_VERSION);
  }
  return __toCommonJS(verify_exports);
})();
globalThis.SprotoShooterSim = SprotoShooterSim;
