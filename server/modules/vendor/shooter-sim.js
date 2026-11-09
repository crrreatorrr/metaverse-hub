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
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/server/verify.js
  var verify_exports = {};
  __export(verify_exports, {
    ECONOMY: () => ECONOMY,
    LIMITS: () => LIMITS,
    PROTOCOL_VERSION: () => PROTOCOL_VERSION,
    SOURCE_COMMIT: () => SOURCE_COMMIT,
    bossById: () => bossById,
    buildIssuance: () => buildIssuance,
    contentFingerprintOf: () => contentFingerprintOf,
    pureClone: () => pureClone,
    verifyRun: () => verifyRun,
    verifyRunJSON: () => verifyRunJSON
  });

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
      { kind: "bossGun", chance: 1, table: "boss" },
      // a Ray Gun or Big Bullets
      { kind: "tickets", min: 60, max: 60, chance: 1 }
    ],
    moleMonster: [
      { kind: "resource", resId: "scrap", min: 25, max: 25, chance: 1 },
      { kind: "resource", resId: "bossCore", min: 1, max: 1, chance: 1, noScale: true },
      { kind: "bigHealth", count: 2, chance: 1 },
      { kind: "ammo", count: 3, chance: 1 },
      { kind: "gun", count: 2, chance: 1, table: "boss" },
      { kind: "bossGun", chance: 1, table: "boss" },
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
      { kind: "bossGun", chance: 1, table: "boss" },
      // a Ray Gun or Big Bullets
      { kind: "tickets", min: 60, max: 60, chance: 1 }
    ],
    monster: [
      { kind: "resource", resId: "scrap", min: 25, max: 25, chance: 1 },
      { kind: "resource", resId: "bossCore", min: 1, max: 1, chance: 1, noScale: true },
      { kind: "bigHealth", count: 2, chance: 1 },
      { kind: "ammo", count: 3, chance: 1 },
      { kind: "gun", count: 2, chance: 1, table: "boss" },
      { kind: "bossGun", chance: 1, table: "boss" },
      // a Ray Gun or Big Bullets
      { kind: "tickets", min: 60, max: 60, chance: 1 }
    ],
    sprotoBeast: [
      { kind: "resource", resId: "scrap", min: 25, max: 25, chance: 1 },
      { kind: "resource", resId: "bossCore", min: 1, max: 1, chance: 1, noScale: true },
      { kind: "bigHealth", count: 2, chance: 1 },
      { kind: "ammo", count: 3, chance: 1 },
      { kind: "gun", count: 2, chance: 1, table: "boss" },
      { kind: "bossGun", chance: 1, table: "boss" },
      // a Ray Gun or Big Bullets
      { kind: "tickets", min: 60, max: 60, chance: 1 }
    ],
    dragon: [
      { kind: "resource", resId: "scrap", min: 20, max: 20, chance: 1 },
      { kind: "resource", resId: "bossCore", min: 1, max: 1, chance: 1, noScale: true },
      { kind: "bigHealth", count: 2, chance: 1 },
      { kind: "ammo", count: 3, chance: 1 },
      { kind: "gun", count: 1, chance: 1, table: "boss" },
      { kind: "bossGun", chance: 1, table: "boss" },
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
      { kind: "bossGun", chance: 1, table: "boss" },
      // a Ray Gun or Big Bullets
      { kind: "tickets", min: 60, max: 60, chance: 1 }
    ]
  };
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

  // src/data/skills.js
  var SKILLS = {
    health: { id: "health", name: "Health", icon: "\u2764", color: "#ff4d6d", xpBase: 100, xpGrowth: 1.45, maxLevel: 10 },
    gunslinger: { id: "gunslinger", name: "Gunslinger", icon: "\u{1F3AF}", color: "#ffcc33", xpBase: 120, xpGrowth: 1.45, maxLevel: 10 },
    magic: { id: "magic", name: "Magic", icon: "\u{1F52E}", color: "#9b6bff", xpBase: 80, xpGrowth: 1.45, maxLevel: 10 },
    crafting: { id: "crafting", name: "Crafting", icon: "\u{1F528}", color: "#4fd1c5", xpBase: 100, xpGrowth: 1.45, maxLevel: 10 }
  };
  var SKILL_IDS = ["health", "gunslinger", "magic", "crafting"];
  var XP = {
    health: { kill: 10, perDamage: 0.2, damageCapPerSec: 15, orb: 3, medkit: 5, bigOrb: 10, physicalBoss: 200 },
    gunslinger: { gunKill: 10, critKill: 5, weakKill: 5, weakHit: 1, weakHitCapPerSec: 10, physicalBoss: 200 },
    magic: { cast: { gooBolt: 3, chainZap: 6, swarm: 10, manaShield: 4, meteor: 25 }, per20Absorbed: 1, spellKill: 8, magicBoss: 200 }
  };
  var PERKS = [
    { id: "quickShield", skill: "health", level: 3, name: "Quick Shield", desc: "Shield recharges sooner and faster." },
    { id: "lifesteal", skill: "health", level: 6, name: "Lifesteal", desc: "Heal 2% of damage you deal (max 4 HP/s)." },
    { id: "unkillable", skill: "health", level: 10, name: "Unkillable Sproto", desc: "Once per wave, survive a lethal hit at 1 HP + 3s invulnerable." },
    { id: "fastHands", skill: "gunslinger", level: 3, name: "Fast Hands", desc: "Weapon swaps take 0.2s." },
    { id: "deadeye", skill: "gunslinger", level: 6, name: "Deadeye", desc: "+0.5 weak-spot crit multiplier." },
    { id: "bottomlessMags", skill: "gunslinger", level: 8, name: "Bottomless Mags", desc: "15% chance shots use no ammo." },
    { id: "killFrenzy", skill: "gunslinger", level: 10, name: "Kill Frenzy", desc: "Kills stack +4% fire rate, +3% damage (max 10, 4s)." },
    { id: "gooBolt", skill: "magic", level: 1, name: "Goo Bolt [Q]", desc: "Sticky slowing bolt." },
    { id: "chainZap", skill: "magic", level: 3, name: "Chain Zap [E]", desc: "Lightning that jumps between enemies." },
    { id: "swarm", skill: "magic", level: 6, name: "Sproto Swarm [Z]", desc: "Summon 5 mini Sprotos for 8s." },
    { id: "manaShield", skill: "magic", level: 8, name: "Mana Shield [X]", desc: "Toggle: mana absorbs 60% of damage." },
    { id: "meteor", skill: "magic", level: 10, name: "Meteor Bonk [T]", desc: "Ultimate. Full mana. Giant meteor." },
    { id: "craftT1", skill: "crafting", level: 1, name: "T1 Recipes", desc: "Craft Common guns, ammo and medkits." },
    { id: "craftT2", skill: "crafting", level: 3, name: "T2 Recipes", desc: "Craft Uncommon guns." },
    { id: "craftT3", skill: "crafting", level: 5, name: "T3 Recipes", desc: "Craft Rare guns and choose the element." },
    { id: "craftT4", skill: "crafting", level: 7, name: "T4 Recipes", desc: "Craft Epic guns and choose a part." },
    { id: "salvage", skill: "crafting", level: 8, name: "Salvage", desc: "Break guns down into resources." },
    { id: "craftT5", skill: "crafting", level: 10, name: "Master Forger", desc: "Craft Legendaries and reroll stats." }
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
  var xpToNext = (skillId, level) => {
    const s = SKILLS[skillId];
    return Math.round(s.xpBase * Math.pow(s.xpGrowth, level - 1));
  };

  // src/sim/events.js
  function emit(state, type, payload = {}) {
    state.events.push({ ...payload, type, tick: state.tick });
  }

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
    boomMidget: dress("midget", { name: "Boom Midget", hp: 34, color: 16733491 }),
    riotMidget: dress("midget", { name: "Riot Midget", hp: 58, speed: 5.4, color: 8954048 }),
    sewerMidget: dress("midget", { name: "Sewer Midget", hp: 36, color: 6989903 }),
    floretSprout: dress("midget", { name: "Floret Sprout", hp: 48, speed: 6.2, color: 7003962 }),
    hexAcolyte: dress("obama", { name: "Hex Acolyte", hp: 64, color: 4116366, model: "sahil" }),
    glowieAgent: dress("obama", { name: "Glowie Agent", hp: 70, color: 9357567, model: "sahil" }),
    auditSniper: dress("obama", {
      name: "Audit Sniper",
      hp: 55,
      color: 13162751,
      model: "obama",
      gun: { damage: 8, burst: 1, burstGap: 0.2, cooldownMin: 1.6, cooldownMax: 2.4, spread: 1.5, speed: 40, range: 48, windup: 0.35 }
    }),
    miningRig: dress("bigObama", { name: "Mining Rig", hp: 140, speed: 1.4, color: 10134706, model: "obama" }),
    daycare: dress("midget", { name: "Daycare Nest", hp: 80, speed: 2.2, color: 16757922 }),
    bitbug: dress("flyingMidget", { name: "Bitbug", hp: 18, color: 11566335, model: "midget" }),
    jetObama: dress("flyingMidget", { name: "Jet Obama", hp: 55, color: 8377166, model: "obama", stage: 2 }),
    balloonMidget: dress("flyingMidget", { name: "Balloon Midget", hp: 28, color: 16747220, model: "midget" }),
    miniTinubu: dress("midget", { name: "Mini Tinubu", hp: 90, speed: 6.4, color: 16738877, model: "tinubu", radius: 0.55, height: 1.8 })
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
  var tierEnemyMult = (t) => Math.pow(1.15, t - 1);
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
  var REROLLABLE = ["damage", "fireRate", "spread", "reloadTime", "critMult", "elementChance"];
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
    const q = QUALITIES_BY_ID[quality];
    const parts = { barrel: "stock", grip: "stock", mag: "stock", scope: "stock" };
    for (let i = 0; i < q.partSlots; i++) {
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
    s.damage *= q.damageMult * lm;
    if (s.splashDamage) s.splashDamage *= q.damageMult * lm;
    s.magSize = s.magSize * q.magMult;
    s.reloadTime *= q.reloadMult;
    s.spread *= q.spreadMult;
    s.adsSpread *= q.spreadMult;
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
  function regenerate(gun, extra = {}) {
    const g = generateGun({
      seed: gun.seed,
      level: gun.level,
      forced: { type: gun.type, quality: gun.quality, manufacturer: gun.manufacturer, element: gun.element, wacky: gun.wacky, parts: gun.parts },
      arcane: gun.arcane,
      rerolls: extra.rerolls ?? gun.rerolls
    });
    return { ...g, id: gun.id, source: gun.source, ammoInMag: Math.min(gun.ammoInMag, g.stats.magSize) };
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
    const q = QUALITIES_BY_ID[gun.quality];
    return Math.round(SHOP.sellBase * q.sellMult * SHOP.typePremium[gun.type] * (1 + 0.1 * (gun.level - 1)));
  }
  function shopPrice(gun, tier) {
    const q = QUALITIES_BY_ID[gun.quality];
    return Math.round(SHOP.basePrice[gun.type] * q.priceMult * (1 + 0.15 * (tier - 1)));
  }
  function salvageYield(gun) {
    const q = QUALITIES_BY_ID[gun.quality].idx;
    const t = GUN_TYPES_BY_ID[gun.type];
    const m = t.legendaryOnly ? 3 : t.bossOnly ? 2.5 : gun.type === "bazooka" ? 1.5 : 1;
    const y = {
      scrap: Math.round((5 + 6 * q + gun.level) * m),
      springs: Math.round(2 * q * m),
      goo: gun.element !== "none" ? Math.round(3 * m) : 0,
      plating: q >= 3 ? Math.round(5 * m) : 0
    };
    return Object.fromEntries(Object.entries(y).filter(([, v]) => v > 0));
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
    for (const b of TUNING.weaponBoxes) {
      state.weaponBoxes.push({ id: nextId(state), pos: { x: b.x, y: 0, z: b.z }, radius: TUNING.boxRadius, interactRadius: TUNING.boxInteractRadius, glow: false, craft: null });
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
      xpGained: { health: 0, gunslinger: 0, magic: 0, crafting: 0 },
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
      resources: { scrap: 0, springs: 0, goo: 0, plating: 0, bossCore: 0, manaCrystal: 0 },
      tickets: 0,
      skills: { health: sk(), gunslinger: sk(), magic: sk(), crafting: sk() },
      perks: {},
      spells: { cd: { gooBolt: 0, chainZap: 0, swarm: 0, manaShield: 0, meteor: 0 }, manaShieldOn: false },
      buffs: { killFrenzy: { stacks: 0, t: 0 } },
      lastDamageT: 99,
      lifestealBudget: 4,
      xpCaps: { dmg: 0, weak: 0 },
      interactBoxId: null,
      nearGunPickupId: null
    };
    for (const perk of PERKS) if (perk.level === 1) p.perks[perk.id] = true;
    return p;
  }
  var sk = () => ({ level: 1, xp: 0, total: 0 });
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
    e.maxHp = Math.round(def.hp * tm * (elite ? ELITE.hpMult : 1) * state.tuning.enemyHpMult);
    e.hp = e.maxHp;
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
    e.maxHp = Math.round(def.hp * tm * (paired ? 0.85 : 1) * state.tuning.enemyHpMult);
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

  // src/sim/drops.js
  function rollQuality(rng, tableId, shift = 0) {
    const w = QUALITY_TABLES[tableId];
    const q = weighted(rng, QUALITIES.map((qq, i) => ({ id: qq.id, idx: i, weight: w[i] })));
    return QUALITIES[Math.min(4, q.idx + shift)].id;
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
    for (const entry of table) {
      let chance = entry.chance;
      if (entry.kind === "gun" && ctx.elite) chance = Math.min(0.6, chance * ELITE.gunMult);
      if (ctx.summoned && entry.kind === "gun") chance *= 0.25;
      const roll = float(rng);
      if (roll >= chance) continue;
      const count = entry.count || 1;
      for (let c = 0; c < count; c++) {
        switch (entry.kind) {
          case "resource": {
            const base = int(rng, entry.min, entry.max);
            const amt = entry.noScale ? base : Math.round(base * tierM * eliteM);
            out.push({ kind: "resource", resId: entry.resId, amount: amt });
            break;
          }
          case "tickets": {
            const base = int(rng, entry.min, entry.max);
            out.push({ kind: "tickets", amount: Math.round(base * tierM * eliteM) });
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
            const shift = ctx.elite && float(rng) < 0.5 ? 1 : 0;
            const quality = rollQuality(rng, entry.table, shift);
            const type = rollGunType(rng);
            out.push({ kind: "gun", type, quality, seed: next(rng), level: ctx.tier || 1 });
            break;
          }
          case "bossGun": {
            const type = BOSS_GUN_TYPES[Math.min(BOSS_GUN_TYPES.length - 1, Math.floor(float(rng) * BOSS_GUN_TYPES.length))];
            const quality = rollQuality(rng, entry.table, 1);
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

  // src/data/recipes.js
  var QUAL = ["common", "uncommon", "rare", "epic", "legendary"];
  var LEVEL_REQ = [1, 3, 5, 7, 10];
  var XP2 = [60, 120, 200, 320, 500];
  var OPTS = [
    { chooseElement: false, choosePart: false, arcane: false, wacky: false },
    { chooseElement: false, choosePart: false, arcane: false, wacky: false },
    { chooseElement: true, choosePart: false, arcane: true, wacky: false },
    { chooseElement: true, choosePart: true, arcane: true, wacky: false },
    { chooseElement: true, choosePart: true, arcane: true, wacky: true }
  ];
  var COSTS = {
    mg: [[20], [40, 10], [60, 20, 10], [100, 30, 0, 15], [150, 40, 0, 0, 2]],
    shotgun: [[30, 0, 5], [55, 12, 5], [80, 20, 15], [125, 30, 0, 20], [180, 45, 0, 0, 2]],
    sniper: [[30, 5], [55, 15], [80, 25, 10], [125, 35, 0, 20], [180, 50, 0, 0, 2]],
    bazooka: [[40, 0, 0, 5, 1], [70, 15, 0, 8, 1], [100, 20, 15, 10, 1], [150, 35, 0, 25, 1], [220, 50, 0, 30, 3]]
  };
  var KEYS = ["scrap", "springs", "goo", "plating", "bossCore"];
  var toCost = (arr) => Object.fromEntries(arr.map((v, i) => [KEYS[i], v]).filter(([, v]) => v > 0));
  var GUN_RECIPES = [];
  for (const type of Object.keys(COSTS)) {
    for (let t = 0; t < 5; t++) {
      GUN_RECIPES.push({
        id: `${type}_t${t + 1}`,
        category: "gun",
        gunType: type,
        tier: t + 1,
        quality: QUAL[t],
        cost: toCost(COSTS[type][t]),
        craftingLevel: LEVEL_REQ[t],
        craftTime: 1.5,
        xp: XP2[t],
        options: OPTS[t]
      });
    }
  }
  var ITEM_RECIPES = [
    { id: "ammo_bullets", category: "ammo", name: "Bullets \xD745", ammoType: "bullets", amount: 45, cost: { scrap: 5 }, craftingLevel: 1, craftTime: 0.5, xp: 8 },
    { id: "ammo_shells", category: "ammo", name: "Shells \xD78", ammoType: "shells", amount: 8, cost: { scrap: 8 }, craftingLevel: 1, craftTime: 0.5, xp: 8 },
    { id: "ammo_sniper", category: "ammo", name: "Sniper rounds \xD75", ammoType: "sniper", amount: 5, cost: { scrap: 10 }, craftingLevel: 1, craftTime: 0.5, xp: 8 },
    { id: "ammo_rockets", category: "ammo", name: "Rockets \xD72", ammoType: "rockets", amount: 2, cost: { scrap: 15, plating: 2 }, craftingLevel: 1, craftTime: 0.5, xp: 8 },
    { id: "medkit", category: "item", name: "Medkit", cost: { scrap: 10, goo: 5 }, craftingLevel: 1, craftTime: 0.8, xp: 10 }
  ];
  var ARCANE_COST = { manaCrystal: 1 };
  var REROLL_COST = { scrap: 40, goo: 10 };
  var REROLL_LEVEL = 10;
  var SALVAGE_LEVEL = 8;
  var SALVAGE_XP = 15;
  var REROLL_XP = 30;
  var RECIPES = [...GUN_RECIPES, ...ITEM_RECIPES];
  var RECIPES_BY_ID = Object.fromEntries(RECIPES.map((r) => [r.id, r]));

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
    while (s.level < SKILLS[skillId].maxLevel && s.xp >= xpToNext(skillId, s.level)) {
      s.xp -= xpToNext(skillId, s.level);
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
    const h = p.skills.health.level, m = p.skills.magic.level;
    const newMaxHp = Math.round(TUNING.maxHp * (1 + 0.08 * (h - 1)));
    if (newMaxHp !== p.maxHp) {
      p.hp += newMaxHp - p.maxHp;
      p.maxHp = newMaxHp;
    }
    const newMana = TUNING.maxMana + 15 * (m - 1);
    if (newMana !== p.maxMana) {
      p.mana += newMana - p.maxMana;
      p.maxMana = newMana;
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
          if (ev.sourceKind === "spell") addXp(state, p, "magic", XP.magic.spellKill * em);
          if (ev.bossTag === "physical") {
            addXp(state, p, "health", XP.health.physicalBoss);
            addXp(state, p, "gunslinger", XP.gunslinger.physicalBoss);
          }
          if (ev.bossTag === "magic") addXp(state, p, "magic", XP.magic.magicBoss);
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
          if (ev.absorbed > 0) addXp(state, p, "magic", ev.absorbed / 20 * XP.magic.per20Absorbed);
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
        case "cast": {
          const p = state.players[ev.playerId];
          if (p) addXp(state, p, "magic", XP.magic.cast[ev.spellId] || 0);
          break;
        }
        case "craftComplete": {
          const p = state.players[ev.playerId];
          const r = RECIPES_BY_ID[ev.recipeId];
          if (p && r) addXp(state, p, "crafting", r.xp);
          break;
        }
        case "salvage": {
          const p = state.players[ev.playerId];
          if (p) addXp(state, p, "crafting", SALVAGE_XP);
          break;
        }
        case "reroll": {
          const p = state.players[ev.playerId];
          if (p) addXp(state, p, "crafting", REROLL_XP);
          break;
        }
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
      if (hb.onlyWhen && !(e.boss && e.boss.action.id === hb.onlyWhen)) continue;
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

  // src/sim/combat.js
  function healPlayer(p, amount) {
    if (p.dead) return 0;
    const before = p.hp;
    p.hp = Math.min(p.maxHp, p.hp + amount);
    return p.hp - before;
  }
  function damageEnemy(state, e, hit) {
    if (e.dead || e.state === "spawning" || e.boss && e.boss.invuln) return 0;
    let dmg = hit.base;
    const p = state.players[hit.sourceId];
    if (p) {
      if (hit.sourceKind === "spell") dmg *= 1 + 0.08 * (p.skills.magic.level - 1);
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
    const el = hit.element || "none";
    if (el !== "none") {
      if (e.affinity.weak === el) dmg *= 1.5;
      if (e.affinity.resist === el) dmg *= 0.5;
    }
    dmg = Math.max(1, Math.round(dmg));
    if (e.type === "dummy" && state.tuning.dummyInfinite) e.hp = e.maxHp + dmg;
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
    const p = state.players[state.localPlayerId];
    const ctx = { elite: e.elite, tier: e.tier, playerGunTypes: p.guns.filter((g) => g && !GUN_TYPES_BY_ID[g.type].bossOnly).map((g) => g.ammoType), summoned: e.summoned, boss: !!e.boss };
    const specs = rollDrops(state.rng, e.type, ctx);
    spawnDrops(state, specs, centerOf(e));
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
    p.downedT = TUNING.secondWindTime;
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
      const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
      let wx = -sy * c.moveZ + cy * c.moveX;
      let wz = -cy * c.moveZ - sy * c.moveX;
      const wl = Math.hypot(wx, wz);
      if (wl > 1) {
        wx /= wl;
        wz /= wl;
      }
      const canAct = !p.downed;
      const sprinting = canAct && c.held.sprint && c.moveZ > 0 && !p.zooming;
      let maxSpeed = sprinting ? TUNING.sprintSpeed : TUNING.walkSpeed;
      if (p.campaignSpeed) maxSpeed *= p.campaignSpeed;
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
      if (canAct && c.pressed.slide && p.onGround && m.mode !== "slide" && m.slideCd <= 0 && hs > TUNING.slideMinSpeed) {
        m.mode = "slide";
        m.slideT = TUNING.slideTime;
        p.vel.x = p.vel.x / hs * TUNING.slideBoost;
        p.vel.z = p.vel.z / hs * TUNING.slideBoost;
        emit(state, "slide", { playerId: p.id });
      }
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
      } else if (m.mode === "slide") {
        m.slideT -= dt;
        const sp = Math.hypot(p.vel.x, p.vel.z);
        const target = TUNING.walkSpeed + (TUNING.slideBoost - TUNING.walkSpeed) * Math.max(0, m.slideT / TUNING.slideTime);
        if (sp > 0.01) {
          p.vel.x *= target / sp;
          p.vel.z *= target / sp;
        }
        if (m.slideT <= 0 || !p.onGround) {
          m.mode = "walk";
          m.slideCd = TUNING.slideCd;
        }
      } else if (p.onGround) {
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
            m.mode = "air";
            m.slideCd = TUNING.slideCd;
          }
          emit(state, "jump", { playerId: p.id });
        } else if (p.jumpsLeft > 0) {
          p.vel.y = TUNING.doubleJumpVel;
          p.jumpsLeft = 0;
          p.jumpBufferT = 0;
          emit(state, "doubleJump", { playerId: p.id });
        }
      }
      if (m.mode !== "dash") p.vel.y -= TUNING.gravity * dt;
      if (state.mode === "campaign" && state.level && state.level.gravityMult !== 1 && m.mode !== "dash") {
        p.vel.y -= TUNING.gravity * (state.level.gravityMult - 1) * dt;
      }
      if (state.mode === "campaign" && p.jetpack && c.held.jump && !p.onGround && state.level && state.level.fuel > 0) {
        p.vel.y += 28 * dt;
        if (p.vel.y > 12) p.vel.y = 12;
        if (!state.level.modifiers.fuelInfinite) state.level.fuel = Math.max(0, state.level.fuel - 18 * dt);
      }
      p.pos.x += p.vel.x * dt;
      p.pos.y += p.vel.y * dt;
      p.pos.z += p.vel.z * dt;
      const wasAir = !p.onGround;
      if (p.pos.y <= 0) {
        p.pos.y = 0;
        if (p.vel.y < 0) {
          if (wasAir && p.vel.y < -6) emit(state, "land", { playerId: p.id, speed: -p.vel.y });
          p.vel.y = 0;
        }
        p.onGround = true;
      } else p.onGround = false;
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
        p.mana = Math.min(p.maxMana, p.mana + (TUNING.manaRegen + (p.skills.magic.level - 1)) * dt);
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
    for (const k of Object.keys(p.resources)) if (p.resources[k] < TUNING.godResources) p.resources[k] = TUNING.godResources;
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
    emit(state, "playerRespawn", { playerId: p.id });
  }

  // src/sim/economy.js
  var canAfford = (res, cost) => Object.entries(cost).every(([k, v]) => (res[k] || 0) >= v);
  var pay = (res, cost) => {
    for (const [k, v] of Object.entries(cost)) res[k] -= v;
  };
  var mergeCost = (a, b) => {
    const o = { ...a };
    for (const [k, v] of Object.entries(b)) o[k] = (o[k] || 0) + v;
    return o;
  };
  function recipeUnlocked(state, p, r) {
    return state.tuning.unlockAllRecipes || p.skills.crafting.level >= r.craftingLevel;
  }
  function nearBox(state, p) {
    for (const b of state.weaponBoxes) if (Math.hypot(p.pos.x - b.pos.x, p.pos.z - b.pos.z) <= b.interactRadius) return b;
    return null;
  }
  function validateCraft(state, p, a) {
    const r = RECIPES_BY_ID[a.recipeId];
    if (!r) return "Unknown recipe";
    const box2 = state.weaponBoxes.find((b) => b.id === a.boxId);
    if (!box2 || Math.hypot(p.pos.x - box2.pos.x, p.pos.z - box2.pos.z) > box2.interactRadius + 0.5) return "Too far from the Weapon Box";
    if (box2.craft) return "Box is busy";
    if (!recipeUnlocked(state, p, r)) return `Needs Crafting Lv ${r.craftingLevel}`;
    let cost = r.cost;
    if (a.choice?.arcane) cost = mergeCost(cost, ARCANE_COST);
    if (!canAfford(p.resources, cost)) return "Not enough resources";
    if (r.category === "ammo" && p.ammo[r.ammoType] >= p.ammoCap[r.ammoType]) return "Ammo full";
    if (r.id === "medkit" && p.medkits >= TUNING.medkitCarry) return "Medkits full";
    return null;
  }
  function startCraft(state, p, a) {
    const err = validateCraft(state, p, a);
    if (err) {
      emit(state, "actionFailed", { playerId: p.id, reason: err });
      return false;
    }
    const r = RECIPES_BY_ID[a.recipeId];
    const box2 = state.weaponBoxes.find((b) => b.id === a.boxId);
    let cost = r.cost;
    if (a.choice?.arcane) cost = mergeCost(cost, ARCANE_COST);
    pay(p.resources, cost);
    box2.craft = { recipeId: r.id, playerId: p.id, choice: a.choice || {}, t: 0, duration: r.craftTime, seed: next(state.rng) };
    emit(state, "craftStart", { boxId: box2.id, recipeId: r.id, playerId: p.id });
    return true;
  }
  function crafting(state, dt) {
    const intermission = state.wave && state.wave.phase === "intermission";
    for (const box2 of state.weaponBoxes) {
      box2.glow = intermission || state.mode === "sandbox";
      const c = box2.craft;
      if (!c) continue;
      c.t += dt;
      if (c.t < c.duration) continue;
      box2.craft = null;
      const p = state.players[c.playerId];
      const r = RECIPES_BY_ID[c.recipeId];
      let gunId = null;
      if (r.category === "gun") {
        const forced = { type: r.gunType, quality: r.quality };
        if (r.options.chooseElement && c.choice.element) forced.element = c.choice.element;
        if (r.options.choosePart && c.choice.part) forced.part = c.choice.part;
        const gun = generateGun({ seed: c.seed, level: state.tier, forced, arcane: !!(r.options.arcane && c.choice.arcane) });
        gun.id = nextId(state);
        gun.source = "craft";
        gunId = gun.id;
        spawnGunPickup(state, gun, { x: box2.pos.x * 0.9, z: box2.pos.z }, "craft");
      } else if (r.category === "ammo") {
        p.ammo[r.ammoType] = Math.min(p.ammoCap[r.ammoType], p.ammo[r.ammoType] + r.amount);
      } else if (r.id === "medkit") {
        p.medkits = Math.min(TUNING.medkitCarry, p.medkits + 1);
      }
      state.run.crafts++;
      emit(state, "craftComplete", { boxId: box2.id, recipeId: r.id, playerId: p.id, gunId, category: r.category, pos: { ...box2.pos } });
    }
  }
  function salvage(state, p, slot) {
    if (!(state.tuning.unlockAllRecipes || p.skills.crafting.level >= SALVAGE_LEVEL)) return fail(state, p, `Salvage needs Crafting Lv ${SALVAGE_LEVEL}`);
    if (!nearBox(state, p)) return fail(state, p, "Stand at a Weapon Box");
    const g = p.guns[slot];
    if (!g) return;
    if (p.guns.filter(Boolean).length <= 1) return fail(state, p, "Can't salvage your last gun");
    const y = salvageYield(g);
    for (const [k, v] of Object.entries(y)) p.resources[k] += v;
    p.guns[slot] = null;
    ensureActiveGun(p);
    emit(state, "salvage", { playerId: p.id, gunId: g.id, yield: y });
  }
  function reroll(state, p, slot, stat) {
    if (!(state.tuning.unlockAllRecipes || p.skills.crafting.level >= REROLL_LEVEL)) return fail(state, p, `Reroll needs Crafting Lv ${REROLL_LEVEL}`);
    if (!nearBox(state, p)) return fail(state, p, "Stand at a Weapon Box");
    const g = p.guns[slot];
    if (!g || !REROLLABLE.includes(stat)) return;
    let cost = REROLL_COST;
    if (g.quality === "legendary") cost = mergeCost(cost, { manaCrystal: 1 });
    if (!canAfford(p.resources, cost)) return fail(state, p, "Not enough resources");
    pay(p.resources, cost);
    const rerolls = g.rerolls.filter((r) => r.stat !== stat).concat([{ stat, salt: next(state.rng) }]);
    p.guns[slot] = regenerate(g, { rerolls });
    emit(state, "reroll", { playerId: p.id, gunId: g.id, stat });
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
      p.resources.scrap += 20;
      const spec = ["springs", "goo", "plating"][Math.floor(float(state.rng) * 3)];
      p.resources[spec] += 8;
      detail = `20 Scrap + 8 ${spec}`;
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
    const def = SHOP.upgrades.find((u) => u.id === id);
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
    const cfg = WAVES[idx];
    w.index = idx;
    w.phase = "pre";
    w.t = 0;
    w.groupIdx = 0;
    w.spawnQueue = [];
    w.spawnedCount = 0;
    w.killedCount = 0;
    w.totalCount = cfg.groups.reduce((n, g) => n + g.spawns.reduce((m, s) => m + s.count, 0), 0);
    w.bossIds = [];
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
    const cfg = WAVES[w.index];
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
        for (const q of w.spawnQueue) q.delay -= dt;
        for (let i = 0; i < w.spawnQueue.length; i++) {
          const q = w.spawnQueue[i];
          if (q.delay > 0 || alive(state) >= cfg.maxAlive) continue;
          w.spawnQueue.splice(i--, 1);
          const pos = { x: q.pt.x + range(state.rng, -0.8, 0.8), z: q.pt.z + range(state.rng, -0.8, 0.8) };
          createHazard(state, { kind: "spawnPortal", pos: { x: pos.x, y: 0, z: pos.z }, radius: 1.2, ttl: 0.8 });
          createEnemy(state, q.type, { elite: q.elite, pos });
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
        const bossesAlive = state.enemies.some((e) => !e.dead && w.bossIds.includes(e.id));
        if (!bossesAlive && alive(state) === 0) {
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
    const cfg = WAVES[w.index];
    const p = state.players[state.localPlayerId];
    const tk = Math.round(cfg.clearTickets * tierRewardMult(state.tier));
    p.tickets += tk;
    state.run.ticketsEarned += tk;
    emit(state, "waveCleared", { waveIndex: w.index, tickets: tk });
    emit(state, "ticketsGained", { amount: tk, reason: "Wave clear" });
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
  function box({ id, at, size, yaw = 0, mat = "stone", tag } = {}) {
    return { kind: "box", id, at: at.slice(), size: size.slice(), yaw, mat, tag };
  }

  // src/data/levels/assemble.js
  function shiftAt(at, dx) {
    return [at[0] + dx, at[1], at[2]];
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
      const mechanisms = (s.mechanisms || []).map((m) => placeMech(m, s, x0, width2));
      if (s.secret) {
        mechanisms.push({ kind: "secret", id: `${s.id}-secret`, at: [x0 + s.secret.x, 1, width2 * 0.72], modifier: s.secret.modifier });
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
        mechanisms,
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
    const at = [];
    const units = [];
    let n = 0;
    for (const [type, count] of e.units) {
      units.push({ type, count });
      for (let k = 0; k < count; k++) at.push([x + 7, 0, width / 2 - 3 + n++ % 6 * 1.25]);
    }
    return {
      id: `${sid}-${e.id}`,
      space: e.space || "corridor",
      zone: { min: [x - 8, -2, 1], max: [x + 16, 14, width - 1] },
      activate: { min: [x - 4, -1, 1.2], max: [x + 3, 6, width - 1.2] },
      objective: { kind: e.objective || "clearAll" },
      maxAlive: e.maxAlive || 12,
      fleeAt: e.fleeAt || 0,
      squads: [{ delay: 0, units, at }]
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

  // src/data/levels/campaign.js
  var card = (title, lines) => ({ title, lines });
  var L01 = makeLevel({
    id: "L01",
    name: "Sproto Landing",
    stage: "city",
    tier: 1,
    parTime: 10 * 60,
    sections: [
      {
        id: "S1",
        name: "Drop Zone",
        length: 48,
        encounters: [{ id: "E1", x: 16, space: "corridor", units: [["midget", 4]] }],
        weapons: [{ id: "sg-alley", x: 30, gun: "shotgun", why: "E2 mall corridors" }],
        mechanisms: [
          { kind: "door", id: "mall-door", x: 34, opens: "E1.cleared" },
          { kind: "switch", id: "gate-switch", x: 12, opens: "side-door" },
          { kind: "door", id: "side-door", x: 14, opens: "switch:gate-switch" },
          { kind: "barrel", id: "barrel-1", x: 22 }
        ],
        checkpoints: [{ id: "cp1", x: 36, when: "E1.cleared" }],
        secret: { x: 10, modifier: "bigHead" },
        cover: [{ x: 20, h: 1.2 }]
      },
      {
        id: "S2",
        name: "Mall",
        length: 48,
        transition: "seamless",
        encounters: [{ id: "E2", x: 16, space: "interior", units: [["obama", 2], ["flyingMidget", 2]] }],
        mechanisms: [
          { kind: "jumpPad", id: "lift-pad", x: 12, power: 10 },
          { kind: "mover", id: "parking-lift", x: 28 }
        ],
        checkpoints: [{ id: "cp2", x: 34, when: "E2.cleared" }],
        cover: [{ x: 22, h: 1.4 }]
      },
      {
        id: "S3",
        name: "Gate Plaza",
        length: 48,
        intro: card("Gate Plaza", ["A Big Bitcoin Obama is counting the take.", "The gate does not open until he drops it."]),
        encounters: [{ id: "E3", x: 16, space: "arena", units: [["bigObama", 1]] }],
        checkpoints: [{ id: "cp3", x: 8, when: "E3.cleared" }]
      }
    ]
  });
  var L02 = makeLevel({
    id: "L02",
    name: "The Grand Bazaar",
    stage: "desert",
    tier: 2,
    parTime: 18 * 60,
    sections: [
      {
        id: "S1",
        name: "Souk Alleys",
        length: 50,
        floor: "sand",
        encounters: [{ id: "E1", x: 16, space: "corridor", units: [["riotMidget", 3], ["obama", 2]] }],
        weapons: [{ id: "sg-souk", x: 28, gun: "shotgun", why: "phalanx in the alleys" }],
        mechanisms: [
          { kind: "hazard", id: "quicksand", x: 24, slow: 0.45, dps: 0 },
          { kind: "barrel", id: "spice-barrel", x: 20 }
        ],
        secret: { x: 8, modifier: "confetti" }
      },
      {
        id: "S2",
        name: "Dune Sea",
        length: 52,
        floor: "sand",
        intro: card("Into the Dunes", ["The souk was the easy part.", "Sahil's caravan route crosses the Dune Sea."]),
        encounters: [{ id: "E2", x: 18, space: "field", units: [["boomMidget", 4]] }],
        mechanisms: [
          { kind: "jumpPad", id: "sand-geyser", x: 12, power: 12 },
          { kind: "carpet", id: "carpet-1", x: 30 },
          { kind: "power", id: "overshield", x: 36, modifier: "overshield" }
        ]
      },
      {
        id: "S3",
        name: "Canyon Rim",
        length: 50,
        floor: "sand",
        encounters: [{ id: "E3", x: 16, space: "ledge", units: [["hexAcolyte", 3]] }],
        weapons: [{ id: "sn-rim", x: 30, gun: "sniper", why: "acolytes across the rim" }],
        mechanisms: [{ kind: "zipline", id: "clothesline", x: 22 }]
      },
      {
        id: "S4",
        name: "Bazaar Gate",
        length: 48,
        intro: card("The Grand Bazaar", ["Sahil the RugMaster.", "He sells the floor out from under you."]),
        encounters: [{ id: "E4", x: 16, space: "arena", objective: "boss", units: [["sahil", 1]] }],
        weapons: [{ id: "bz-sahil", x: 10, gun: "bazooka", why: "Sahil at the gate" }]
      }
    ]
  });
  var L03 = makeLevel({
    id: "L03",
    name: "The Vegetable Grove",
    stage: "grove",
    tier: 3,
    parTime: 18 * 60,
    sections: [
      {
        id: "S1",
        name: "Crop Fields",
        length: 52,
        floor: "dirt",
        encounters: [{ id: "E1", x: 18, space: "field", units: [["floretSprout", 3]] }],
        weapons: [{ id: "sn-field", x: 10, gun: "sniper", why: "sprouts across the furrows" }],
        mechanisms: [{ kind: "jumpPad", id: "mushroom", x: 28, power: 11 }],
        secret: { x: 8, modifier: "floorIsLava" }
      },
      {
        id: "S2",
        name: "Hedge Maze",
        length: 52,
        floor: "hedge",
        encounters: [{ id: "E2", x: 16, space: "corridor", units: [["sewerMidget", 4], ["daycare", 1]] }],
        weapons: [
          { id: "mg-maze", x: 26, gun: "mg", why: "burrowers in the hedges" },
          { id: "sg-maze", x: 30, gun: "shotgun", why: "close hedges" }
        ],
        mechanisms: [{ kind: "bridge", id: "vine-bridge", x: 34 }, { kind: "power", id: "turbo", x: 12, modifier: "turbo" }],
        cover: [{ x: 20, h: 1.6, z: 8 }, { x: 22, h: 1.6, z: 14 }]
      },
      {
        id: "S3",
        name: "Greenhouses",
        length: 46,
        floor: "dirt",
        encounters: [{ id: "E3", x: 16, space: "interior", units: [["floretSprout", 2], ["midget", 3]] }],
        mechanisms: [{ kind: "hazard", id: "runoff", x: 24, dps: 10 }, { kind: "door", id: "airlock", x: 34, opens: "E3.cleared" }]
      },
      {
        id: "S4",
        name: "The Patch",
        length: 46,
        intro: card("Something Smells Green", ["The Floret Lord is only a sprout.", "He will not stay for the whole fight."]),
        encounters: [{ id: "E4", x: 16, space: "arena", objective: "boss", fleeAt: 0.5, units: [["broccoli", 1]] }],
        weapons: [{ id: "bz-nest", x: 10, gun: "bazooka", why: "the sprout in the patch" }]
      }
    ]
  });
  var L04 = makeLevel({
    id: "L04",
    name: "The Blockchain Void",
    stage: "void",
    tier: 4,
    parTime: 18 * 60,
    jetpack: "pickup",
    sections: [
      {
        id: "S1",
        name: "Candle Forest",
        length: 52,
        floor: "metal",
        encounters: [{ id: "E1", x: 18, space: "sky", units: [["bitbug", 5]] }],
        weapons: [{ id: "mg-bugs", x: 28, gun: "mg", why: "bitbug flocks" }],
        mechanisms: [
          { kind: "jetpack", id: "jetpack-1", x: 12 },
          { kind: "jumpPad", id: "updraft", x: 22, power: 14 }
        ],
        secret: { x: 8, modifier: "moonBoots" }
      },
      {
        id: "S2",
        name: "Mine Field",
        length: 52,
        floor: "metal",
        intro: card("Liquidity", ["Bitcoin Obama pumps the price. The Midget dumps it.", "You ride the chart."]),
        encounters: [{ id: "E2", x: 16, space: "sky", units: [["jetObama", 2], ["balloonMidget", 3]] }],
        weapons: [{ id: "sn-mine", x: 30, gun: "sniper", why: "jet Obamas between candles" }],
        mechanisms: [
          { kind: "fuel", id: "fuel-1", x: 12 },
          { kind: "hazard", id: "gravity-well", x: 24, slow: 0.4, dps: 0 },
          { kind: "power", id: "infinite-fuel", x: 36, modifier: "fuel" }
        ]
      },
      {
        id: "S3",
        name: "The Exchange",
        length: 50,
        intro: card("The Blockchain Void", ["The Pump and Dump Duo.", "One counts. One flies."]),
        encounters: [{ id: "E3", x: 16, space: "arena", objective: "boss", units: [["obamaDuo", 1], ["midgetDuo", 1]] }],
        weapons: [{ id: "bz-duo", x: 10, gun: "bazooka", why: "the duo on the exchange floor" }]
      }
    ]
  });
  var L05 = makeLevel({
    id: "L05",
    name: "Frostspire Black Site",
    stage: "glacier",
    tier: 5,
    parTime: 18 * 60,
    sections: [
      {
        id: "S1",
        name: "Snowfield",
        length: 54,
        floor: "ice",
        encounters: [{ id: "E1", x: 18, space: "field", units: [["auditSniper", 2], ["miningRig", 1]] }],
        weapons: [
          { id: "sn-snow", x: 10, gun: "sniper", why: "snipers on the snowfield" },
          { id: "bz-turret", x: 14, gun: "bazooka", why: "mining rig turret" }
        ],
        mechanisms: [{ kind: "hazard", id: "ice-slick", x: 26, slow: 0.2, dps: 0 }],
        secret: { x: 8, modifier: "taxSeason" }
      },
      {
        id: "S2",
        name: "Bunkers",
        length: 48,
        floor: "ice",
        encounters: [{ id: "E2", x: 16, space: "interior", units: [["glowieAgent", 4]] }],
        mechanisms: [
          { kind: "switch", id: "generator", x: 12, opens: "shield-gate" },
          { kind: "door", id: "shield-gate", x: 34, opens: "switch:generator" }
        ]
      },
      {
        id: "S3",
        name: "Frost Halls",
        length: 48,
        floor: "ice",
        encounters: [{ id: "E3", x: 16, space: "hold", units: [["glowieAgent", 2], ["auditSniper", 2]] }],
        weapons: [{ id: "sg-hall", x: 28, gun: "shotgun", why: "frost halls" }],
        mechanisms: [{ kind: "hazard", id: "drone-strike", x: 22, dps: 6 }]
      }
    ]
  });
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
        intro: card("Los Angeles", ["Broccoli Head owns the night.", "The clouds are not weather."]),
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
        intro: card("MELTDOWN", ["Reactors at 300%.", "Tinubu calls this a controlled burn. Run."]),
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
        intro: card("Government Office", ["Glowie has a badge and a flashbang.", "Look away."]),
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
        intro: card("Descent", ["The plains were the map.", "The dead keep the other one."]),
        encounters: [{ id: "E2", x: 16, space: "interior", units: [["hexAcolyte", 3], ["sewerMidget", 3]] }],
        weapons: [{ id: "sg-cata", x: 28, gun: "shotgun", why: "catacomb standee" }]
      },
      {
        id: "S3",
        name: "Moon Gate",
        length: 50,
        intro: card("The Moon Gate", ["Two Big Obamas. One key.", "Something older is waking up."]),
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
        intro: card("Hellfire Caldera", ["Tinubu the Unshackled Demon.", "This is the audit."]),
        encounters: [{ id: "E3", x: 16, space: "arena", objective: "boss", units: [["tinubu", 1]] }]
      },
      {
        id: "S4",
        name: "Eruption",
        length: 46,
        floor: "rock",
        intro: card("ERUPTION", ["The Demon is down. The volcano disagrees.", "Fly."]),
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
    const key = String(id);
    if (cache.has(key)) return cache.get(key);
    const data = getLevelData(key);
    const sectionById2 = {};
    for (const s of data.sections || []) sectionById2[s.id] = s;
    const rt = { ...data, sectionById: sectionById2 };
    cache.set(key, rt);
    cache.set(data.id, rt);
    return rt;
  }
  function sectionById(levelId, sectionId) {
    const rt = getLevelRuntime(levelId);
    return rt.sectionById[sectionId] || rt.sections[0] || null;
  }
  function inBox(box2, x, y, z) {
    if (!box2) return false;
    const y0 = box2.min ? box2.min[1] : -1e9;
    const y1 = box2.max ? box2.max[1] : 1e9;
    const min = box2.min || box2;
    const max = box2.max || box2;
    if (box2.min) return x >= box2.min[0] && x <= box2.max[0] && y >= y0 && y <= y1 && z >= box2.min[2] && z <= box2.max[2];
    return x >= min[0] && x <= max[0] && z >= min[2] && z <= max[2];
  }
  function nearPoint(at, x, y, z, r) {
    if (!at) return false;
    const dx = x - at[0], dy = y - (at[1] || 0), dz = z - at[2];
    return dx * dx + dy * dy + dz * dz <= r * r;
  }

  // src/sim/campaign/campaign.js
  var snaps = /* @__PURE__ */ new WeakMap();
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
    p.jetpack = jet;
    p.campaignSpeed = 1;
    p.pos = { x: first.start[0], y: first.start[1], z: first.start[2] };
    p.prevPos = { ...p.pos };
    p.vel = { x: 0, y: 0, z: 0 };
    p.yaw = first.yaw || 0;
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
      if (lv.intro) emit(state, "levelCard", { title: lv.intro.title, lines: lv.intro.lines });
    } else if (lv.intro) lv.intro = null;
  }
  function campaignPre(state, dt) {
    const lv = state.level;
    if (!lv || lv.won || lv.lost) return;
    lv.time += dt;
    const p = state.players[state.localPlayerId];
    if (p.padCd > 0) p.padCd -= dt;
    const sec = sectionById(lv.id, lv.section);
    if (!sec) return;
    for (const m of sec.mechanisms || []) touchMechanism(state, p, lv, sec, m, dt);
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
    for (const enc of sec.encounters || []) {
      if (lv.spawned[enc.id] || lv.cleared[enc.id]) continue;
      if (!inBox(enc.activate, p.pos.x, p.pos.y, p.pos.z)) continue;
      lv.spawned[enc.id] = true;
      spawnSquad(state, enc);
    }
    lv.objective = objectiveText(lv, sec);
  }
  function campaignPost(state, dt) {
    const lv = state.level;
    if (!lv || lv.won || lv.lost) return;
    const p = state.players[state.localPlayerId];
    for (const e of state.enemies) {
      if (e.dead || !e.boss || !BOSSES[e.type] || !BOSSES[e.type].campaign) continue;
      tickDuelBoss(state, e, dt);
    }
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
    if (when.startsWith("switch:")) return !!lv.got[when.slice("switch:".length)];
    return !!lv.got[when];
  }
  function touchMechanism(state, p, lv, sec, m, dt) {
    const x = p.pos.x, y = p.pos.y, z = p.pos.z;
    if (m.kind === "switch" && !lv.got[m.id] && nearPoint(m.at, x, y + 1, z, 1.5)) {
      lv.got[m.id] = true;
      emit(state, "switch", { id: m.id });
    }
    if (m.kind === "door" && !lv.got[m.id] && flagOn(lv, m.opens)) {
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
    }
    if ((m.kind === "jetpack" || m.kind === "fuel") && !lv.got[m.id] && nearPoint(m.at, x, y + 1, z, 1.8)) {
      lv.got[m.id] = true;
      p.jetpack = true;
      lv.fuel = Math.max(lv.fuel, m.kind === "fuel" ? 100 : 80);
      emit(state, "jetpack", { id: m.id });
    }
    if (m.kind === "power" && !lv.got[m.id] && nearPoint(m.at, x, y + 1, z, 1.8)) {
      lv.got[m.id] = true;
      grantModifier(state, p, m.modifier);
    }
    if (m.kind === "secret" && !lv.got[m.id] && nearPoint(m.at, x, y + 1, z, 1.7)) {
      lv.got[m.id] = true;
      grantModifier(state, p, m.modifier);
      emit(state, "secret", { id: m.id, modifier: m.modifier });
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
    if (m.kind === "mover" && Math.abs(p.pos.x - m.from[0]) < 1.6) {
      p.vel.x += (m.speed || 2) * dt;
    }
    if (m.kind === "laser" && !lv.got[m.id] && nearPoint(m.at, x, y + 1, z, 1.3)) {
      damagePlayer(state, p, { base: (m.dps || 12) * dt, sourceKind: "world", fromPos: { x: m.at[0], y: m.at[1], z: m.at[2] } });
    }
    if (m.kind === "barrel" && !lv.got[m.id]) {
      const hit = state.enemies.some((e) => e.dead && e.campaignEnc && Math.hypot(e.pos.x - m.at[0], e.pos.z - m.at[2]) < 2.2);
      if (hit || nearPoint(m.at, x, y + 1, z, 1.2) && p.cmd && p.cmd.held && p.cmd.held.fire) {
        lv.got[m.id] = true;
        emit(state, "barrel", { id: m.id, pos: { x: m.at[0], y: m.at[1], z: m.at[2] } });
      }
    }
  }
  var MOD_SPEED = { turbo: 1.35, taxSeason: 0.82, redTape: 0.9 };
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
    if (mods.floorIsLava) damagePlayer(state, p, { base: 6 * dt, sourceKind: "world", fromPos: p.pos });
    if (mods.fuelInfinite) state.level.fuel = 100;
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
    const squad = enc.squads[0];
    let i = 0;
    for (const u of squad.units) {
      for (let n = 0; n < u.count; n++) {
        const at = squad.at[i] || squad.at[squad.at.length - 1];
        i++;
        const boss2 = BOSSES[u.type] && BOSSES[u.type].campaign;
        const e = boss2 ? createBoss(state, u.type, { pos: { x: at[0], z: at[2] } }) : createEnemy(state, u.type, { pos: { x: at[0], z: at[2] } });
        e.campaignEnc = enc.id;
        if (boss2) emit(state, "bossSpawn", { id: e.id, bossType: u.type });
      }
    }
  }
  function tickDuelBoss(state, e, dt) {
    const def = BOSSES[e.type];
    const frac = e.hp / e.maxHp;
    e.boss.phaseIdx = frac <= 0.33 ? 2 : frac <= 0.66 ? 1 : 0;
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
    e.ai.atk = def.attackEvery || 1.6;
    const name = def.attacks[Math.floor(float(state.rng) * def.attacks.length)];
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
    bucket(state)[id] = structuredClone(state);
    lv.checkpoint = id;
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
    state.run = newRunStats();
    if (p.dead || p.downed) respawn(state, p);
    p.hp = p.maxHp;
    p.shield = p.maxShield;
    p.mana = p.maxMana;
    p.pos = { x: 0, y: 0, z: 8 };
    p.prevPos = { ...p.pos };
    p.vel = { x: 0, y: 0, z: 0 };
    if (state.testMode && mode !== "test") {
      resetLoadout(state, p);
      state.tuning.infiniteAmmo = false;
      setGodMode(state, p, false);
    }
    if (state.bossFight && mode !== "boss" && mode !== "test") resetLoadout(state, p);
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
    for (const id of SPELL_IDS) p.perks[id] = on || p.skills[PERKS_BY_ID[id].skill].level >= PERKS_BY_ID[id].level;
    if (!p.perks.manaShield) p.spells.manaShieldOn = false;
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
        for (const k of RES_IDS) p.resources[k] += k === "bossCore" || k === "manaCrystal" ? 3 : args.amount || 100;
        break;
      case "giveXp":
        addXp(state, p, args.skill, args.amount || 100);
        break;
      case "levelSkill": {
        const s = p.skills[args.skill];
        if (s.level < 10) addXp(state, p, args.skill, (xpToNext(args.skill, s.level) - s.xp + 1) / (1 + 0.1 * (state.tier - 1)));
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
  function steer(state, e, target, w, invertSeek = false) {
    let sx = target.pos.x - e.pos.x, sz = target.pos.z - e.pos.z;
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
    let dx = w.seek * sx + w.sep * px + w.wall * wx + w.strafe * stx;
    let dz = w.seek * sz + w.sep * pz + w.wall * wz + w.strafe * stz;
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
    const K = (n) => slot + n;
    if (ai[K("gunCd")] == null) ai[K("gunCd")] = range(state.rng, 0.8, gun.cooldownMax);
    if (gun.trackDone && ai[K("doneT")] != null) ai[K("doneT")] += dt;
    if (ai[K("burstLeft")] > 0) {
      ai[K("burstT")] -= dt;
      if (ai[K("burstT")] <= 0) {
        ai[K("burstLeft")]--;
        ai[K("burstT")] = gun.burstGap;
        if (gun.trackDone && ai[K("burstLeft")] === 0) ai[K("doneT")] = 0;
        const sc = e.scale;
        let from;
        if (gun.from) {
          const h = e.height * sc, fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw), rx = Math.cos(e.yaw), rz = -Math.sin(e.yaw);
          const f = gun.from.fwd * h, side = -(gun.from.side || 0) * h;
          from = { x: e.pos.x + fx * f + rx * side, y: e.pos.y + gun.from.up * h, z: e.pos.z + fz * f + rz * side };
        } else from = { x: e.pos.x - Math.sin(e.yaw) * 0.6 * sc, y: e.pos.y + e.height * 0.7 * sc, z: e.pos.z - Math.cos(e.yaw) * 0.6 * sc };
        const dx = t.pos.x - from.x, dy = t.pos.y + 1.1 - from.y, dz = t.pos.z - from.z;
        const dl = Math.hypot(dx, dy, dz) || 1;
        const d2 = cone(state, { x: dx / dl, y: dy / dl, z: dz / dl }, gun.spread);
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
    if (ai[K("aimT")] > 0) {
      ai[K("aimT")] -= dt;
      if (ai[K("aimT")] <= 0) {
        ai[K("burstLeft")] = gun.burst;
        ai[K("burstT")] = 0;
      }
      return true;
    }
    ai[K("gunCd")] -= dt;
    const d = Math.hypot(t.pos.x - e.pos.x, t.pos.z - e.pos.z);
    if (canFire && ai[K("gunCd")] <= 0 && d < gun.range && !t.downed) {
      ai[K("gunCd")] = range(state.rng, gun.cooldownMin, gun.cooldownMax);
      ai[K("aimT")] = gun.windup;
      emit(state, "enemyAttack", { id: e.id, enemyType: e.type, special: !!slot });
      return true;
    }
    return false;
  }
  function cone(state, aim, spreadDeg) {
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
        if (e.state === "chase") {
          faceToward(e, t, deg(720), dt);
          approachVel(e, steer(state, e, t, def.weights), speed, def.accel, dt);
          if (d < def.range + e.radius * e.scale + TUNING.playerRadius) {
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
            if (a.t >= def.windup) {
              a.phase = "active";
              a.t = 0;
            }
          } else if (a.phase === "active") {
            const fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw);
            e.vel.x = fx * 4;
            e.vel.z = fz * 4;
            if (!a.hasHit) {
              const c = { x: e.pos.x + fx * 0.9 * e.scale, y: e.pos.y + 0.8, z: e.pos.z + fz * 0.9 * e.scale };
              if (hitPlayerSphere(state, c, 0.9 * e.scale, def.damage * e.dmgMult, "enemy", e.pos)) a.hasHit = true;
            }
            if (a.t >= def.active) {
              a.phase = "recover";
              a.t = 0;
            }
          } else {
            approachVel(e, { x: 0, z: 0 }, 0, 20, dt);
            if (a.t >= def.recover) setState(e, "chase");
          }
        }
      }
    },
    obama: {
      update(state, e, t, def, speed, dt) {
        const d = Math.hypot(t.pos.x - e.pos.x, t.pos.z - e.pos.z);
        faceToward(e, t, deg(360), dt);
        const w = { ...def.weights };
        let inv = false;
        if (d < def.keepMin) inv = true;
        else if (d < def.keepMax) w.seek = 0.1;
        const shooting = enemyGun(state, e, t, def.gun, dt, true);
        e.ai.shooting = shooting;
        approachVel(e, steer(state, e, t, w, inv), shooting ? speed * 0.35 : speed, def.accel, dt);
      }
    },
    // Two weapons: regular arm-gun bursts, and a charged special (def.special) on its own cooldown. Only one fires
    // at a time; the special gets first call when both are ready. ai.special tells the renderer which is firing.
    gunner: {
      update(state, e, t, def, speed, dt) {
        const d = Math.hypot(t.pos.x - e.pos.x, t.pos.z - e.pos.z);
        faceToward(e, t, deg(300), dt);
        const w = { ...def.weights };
        let inv = false;
        if (d < def.keepMin) inv = true;
        else if (d < def.keepMax) w.seek = 0.1;
        const ai = e.ai;
        const regularBusy = ai.aimT > 0 || ai.burstLeft > 0;
        const special = enemyGun(state, e, t, def.special, dt, !regularBusy, "sp");
        const regular = special ? false : enemyGun(state, e, t, def.gun, dt, true);
        ai.special = special;
        ai.shooting = special || regular;
        approachVel(e, steer(state, e, t, w, inv), special ? 0 : regular ? speed * 0.35 : speed, def.accel, dt);
      }
    },
    flyingMidget: {
      update(state, e, t, def, speed, dt) {
        const ai = e.ai;
        ai.jinkT = (ai.jinkT ?? 0) - dt;
        if (ai.jinkT <= 0) {
          ai.jinkT = range(state.rng, def.jinkMin, def.jinkMax);
          ai.orbitDir = float(state.rng) < 0.5 ? -1 : 1;
          ai.alt = range(state.rng, def.altMin, def.altMax);
          ai.orbitR = range(state.rng, def.orbitMin, def.orbitMax);
        }
        const dx = t.pos.x - e.pos.x, dz = t.pos.z - e.pos.z;
        const d = Math.hypot(dx, dz) || 1;
        const nx = dx / d, nz = dz / d;
        const radial = Math.max(-1, Math.min(1, (d - ai.orbitR) / 4));
        let wx = nx * radial + -nz * ai.orbitDir, wz = nz * radial + nx * ai.orbitDir;
        const r = Math.hypot(e.pos.x, e.pos.z);
        if (r > ARENA_R - 4) {
          wx -= e.pos.x / r;
          wz -= e.pos.z / r;
        }
        const wl = Math.hypot(wx, wz) || 1;
        approachVel(e, { x: wx / wl, z: wz / wl }, speed, def.accel, dt);
        e.vel.y += ((ai.alt - e.pos.y) * 3 - e.vel.y) * Math.min(1, 4 * dt);
        faceToward(e, t, deg(720), dt);
        ai.shooting = enemyGun(state, e, t, def.gun, dt, true);
      }
    },
    bigObama: {
      update(state, e, t, def, speed, dt) {
        const d = Math.hypot(t.pos.x - e.pos.x, t.pos.z - e.pos.z);
        if (e.state === "chase") {
          faceToward(e, t, deg(def.turnRate), dt);
          const fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw);
          const shooting = enemyGun(state, e, t, def.gun, dt, d > 5);
          e.ai.shooting = shooting;
          approachVel(e, { x: fx, z: fz }, d > 2 && !shooting ? speed : 0, def.accel, dt);
          const ang = Math.abs(angleWrap(yawTo(e.pos, t.pos) - e.yaw));
          if (!shooting && d < def.range && ang < deg(30)) {
            setState(e, "attack");
            e.attack = { phase: "windup", t: 0, hasHit: false };
            emit(state, "enemyAttack", { id: e.id, enemyType: e.type });
          }
        } else if (e.state === "attack") {
          const a = e.attack;
          a.t += dt;
          approachVel(e, { x: 0, z: 0 }, 0, 20, dt);
          if (a.phase === "windup" && a.t >= def.windup) {
            a.phase = "recover";
            a.t = 0;
            const fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw);
            const c = { x: e.pos.x + fx * 1.2, y: 0, z: e.pos.z + fz * 1.2 };
            createHazard(state, { kind: "stompRing", pos: { ...c, y: 0.05 }, radius: def.poundRadius, maxRadius: def.poundRadius, ttl: 0.4 });
            enemyAoE(state, c, def.poundRadius, def.damage * e.dmgMult, "enemy", 1.5);
            emit(state, "pound", { id: e.id, pos: c });
          } else if (a.phase === "recover" && a.t >= def.recover) setState(e, "chase");
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
        if (e.stateT >= def.staggerTime) setState(e, "chase");
      } else {
        if (e.state === "idle" && e.type !== "dummy") setState(e, "chase");
        const slow = e.status.goo ? 1 - e.status.goo.slow : 1;
        const beh = BEHAVIORS[e.type] || BEHAVIORS[def.behavior];
        beh.update(state, e, target, def, def.speed * e.speedMult * slow, dt);
      }
      if (def.flying) {
        if (e.state === "stagger" || e.state === "spawning") e.vel.y += ((e.state === "spawning" ? 2 : -3) - e.vel.y) * Math.min(1, 5 * dt);
      } else e.vel.y -= 30 * dt;
      e.pos.x += e.vel.x * dt;
      e.pos.y += e.vel.y * dt;
      e.pos.z += e.vel.z * dt;
      const floorY = def.flying ? 0.6 : 0;
      if (e.pos.y <= floorY) {
        e.pos.y = floorY;
        if (e.vel.y < 0) e.vel.y = 0;
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
    const phase = def.phases[e.boss.phaseIdx];
    const id = phase.pattern[e.boss.patternIdx++ % phase.pattern.length];
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
      if (nxt && frac <= nxt.hpBelow && !b.transitioning) {
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
          if (impl === MEGA && b.phaseIdx === 1) summonGrunts(state, e);
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
    const pts = state.spawnPoints.slice().sort((p1, p2) => Math.hypot(p1.x - e.pos.x, p1.z - e.pos.z) - Math.hypot(p2.x - e.pos.x, p2.z - e.pos.z));
    for (let i = 0; i < n; i++) {
      const pt = pts[i % 4];
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
        const rings = e.boss.phaseIdx >= 1 ? 2 : 1;
        a.data.landed = a.data.landed || a.t > 0.3 && e.pos.y <= 0;
        if (a.data.landed) {
          a.data.lt = (a.data.lt || 0) + dt;
          a.data.spawned = a.data.spawned || 0;
          if (a.data.spawned < rings && a.data.lt >= a.data.spawned * 0.6) {
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
          if (alive2 < 10) summonGrunts(state, e);
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
      const r = Math.hypot(e.pos.x, e.pos.z);
      if (r > ARENA_R - 4) {
        e.pos.x *= (ARENA_R - 4) / r;
        e.pos.z *= (ARENA_R - 4) / r;
      }
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
        if (k.pos.y < 0.6) {
          k.pos.y = 0.6;
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
        p.resources[k.resId] += k.amount;
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
    for (const key of ["enemies", "projectiles", "pickups", "hazards", "allies"]) {
      const arr = state[key];
      let w = 0;
      for (let i = 0; i < arr.length; i++) {
        const it = arr[i];
        const keep = key === "enemies" ? !(it.dead && (it.deadT = (it.deadT || 0) + 1) > 1) : !it.dead;
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
    for (const key of ["enemies", "projectiles", "pickups", "allies"]) {
      for (const e of state[key]) {
        e.prevPos.x = e.pos.x;
        e.prevPos.y = e.pos.y;
        e.prevPos.z = e.pos.z;
      }
    }
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
      encounterId: "S3-E3",
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
  function findEncounter(levelId, encounterId) {
    const level = CAMPAIGN_LEVELS.find((l) => l.id === levelId);
    if (!level) return null;
    for (const section of level.sections) {
      const encounter = (section.encounters || []).find((e) => e.id === encounterId);
      if (encounter) return { level, section, encounter };
    }
    return null;
  }
  function sameParts(units, parts) {
    const got = units.map((u) => u.type).slice().sort();
    const want = parts.slice().sort();
    if (got.length !== want.length) return false;
    for (let i = 0; i < got.length; i++) if (got[i] !== want[i]) return false;
    return units.every((u) => u.count === 1);
  }
  function assertCanonicalManifest() {
    for (const boss2 of CANONICAL_BOSSES) {
      const found = findEncounter(boss2.levelId, boss2.encounterId);
      if (!found) throw new Error(`missing canonical encounter ${boss2.id}`);
      if (found.encounter.fleeAt) throw new Error(`${boss2.id} encounter flees and cannot pay`);
      const units = [];
      for (const squad of found.encounter.squads || []) {
        for (const u of squad.units || []) units.push(u);
      }
      if (!sameParts(units, boss2.parts)) throw new Error(`${boss2.id} parts drifted`);
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
    const found = findEncounter(boss2.levelId, boss2.encounterId);
    const units = [];
    for (const squad of found.encounter.squads) {
      for (const u of squad.units) units.push({ type: u.type, count: u.count });
    }
    return {
      id: boss2.id,
      duelId: boss2.duelId,
      distinctFrom: boss2.distinctFrom || [],
      levelId: boss2.levelId,
      encounterId: boss2.encounterId,
      sectionStart: found.section.start,
      fleeAt: found.encounter.fleeAt || 0,
      units,
      hp: boss2.parts.map((part) => ({ part, hp: DUEL_BOSSES[part] ? DUEL_BOSSES[part].hp : null }))
    };
  }
  function contentBody(protocolVersion) {
    return {
      protocol: protocolVersion,
      bosses: CANONICAL_BOSSES,
      encounters: CANONICAL_BOSSES.map(encounterFacts),
      guns: GUN_TYPES.map(gunBalance),
      qualities: QUALITIES.map((q) => ({
        id: q.id,
        damageMult: q.damageMult,
        magMult: q.magMult,
        reloadMult: q.reloadMult,
        spreadMult: q.spreadMult
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
    "meteor"
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
  function hostileKey(key) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") return "malformed";
    return HOSTILE[key] || null;
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
    const keys = Object.keys(value);
    for (let i = 0; i < keys.length; i++) {
      const why = hostileKey(keys[i]);
      if (why) return why;
      const hit = inspectValue(value[keys[i]], depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  function dequantizeCommand(q) {
    const held = {};
    const pressed = {};
    for (let i = 0; i < BUTTONS.length; i++) {
      if (q.held & 1 << i) held[BUTTONS[i]] = true;
      if (q.pressed & 1 << i) pressed[BUTTONS[i]] = true;
    }
    const cmd = {
      yaw: q.yaw / 32767 * Math.PI,
      pitch: q.pitch / 32767 * 1.5,
      moveX: q.moveX / 127,
      moveZ: q.moveZ / 127,
      held,
      pressed,
      slot: q.slot,
      wheel: q.wheel,
      actions: []
    };
    if (q.action === 1) cmd.actions.push({ type: "transitionDone" });
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
        const [at, id] = row;
        if (typeof at !== "number" || !Number.isInteger(at)) return { error: "malformed" };
        if (at < 0) return { error: "negative" };
        if (at >= n) return { error: "malformed" };
        if (id === 2 || id === 3) return { error: id === 3 ? "god_mode" : "debug" };
        if (id !== 1) return { error: "debug" };
        if (actionAt.has(at)) return { error: "malformed" };
        actionAt.set(at, 1);
      }
    }
    const commands = new Array(n);
    for (let i = 0; i < n; i++) {
      const o = i * FRAME_BYTES;
      const q = {
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
      if (q.yaw < -32767 || q.yaw > 32767 || q.pitch < -32767 || q.pitch > 32767) return { error: "malformed" };
      if (q.moveX < -127 || q.moveX > 127 || q.moveZ < -127 || q.moveZ > 127) return { error: "malformed" };
      if (q.slot < -1 || q.slot > 4 || q.wheel < -4 || q.wheel > 4) return { error: "malformed" };
      if (q.held > 32767 || q.pressed > 32767) return { error: "malformed" };
      commands[i] = dequantizeCommand(q);
    }
    return { commands };
  }
  var LOG_KEYS = ["v", "binding", "segments"];
  var BIND_KEYS = ["accountId", "sessionId", "day", "runId"];
  var SEG_KEYS = ["i", "from", "tick0", "n", "frames", "actions"];
  function exactKeys(obj, allowed) {
    const keys = Object.keys(obj);
    if (keys.length !== allowed.length) return false;
    for (let i = 0; i < allowed.length; i++) if (keys.indexOf(allowed[i]) < 0) return false;
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
      const keys = Object.keys(seg);
      for (let k = 0; k < keys.length; k++) if (SEG_KEYS.indexOf(keys[k]) < 0) return "malformed";
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
  var SOURCE_COMMIT = "acafce3a39046d8117f29f068b3a57358fa89f77";
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
    const resources = p.resources || {};
    const names = Object.keys(resources);
    for (let i = 0; i < names.length; i++) if (resources[names[i]] !== 0) return false;
    if (p.skills.health.level !== 1 || p.skills.magic.level !== 1) return false;
    if (!p.perks.gooBolt || !p.perks.craftT1 || p.perks.swarm || p.perks.meteor) return false;
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
    p.pos = { x: section.start[0], y: section.start[1], z: section.start[2] };
    p.prevPos = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
    p.vel = { x: 0, y: 0, z: 0 };
    p.yaw = section.yaw || 0;
    p.pitch = 0;
    state.mode = "campaign";
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
    const found = findEncounter(boss2.levelId, boss2.encounterId);
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
      encounterId: boss2.encounterId,
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

  // src/server/verify.js
  function pureClone(value) {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) {
      const arr = new Array(value.length);
      for (let i = 0; i < value.length; i++) arr[i] = pureClone(value[i]);
      return arr;
    }
    const out = {};
    const keys = Object.keys(value);
    for (let i = 0; i < keys.length; i++) out[keys[i]] = pureClone(value[keys[i]]);
    return out;
  }
  if (typeof globalThis !== "undefined" && globalThis.__SPROTO_VERIFY_BUNDLE) {
    globalThis.structuredClone = pureClone;
  }
  function fail2(reason, extra = {}) {
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
    if (pre) return fail2(pre);
    if (!ctx || typeof ctx !== "object" || !ctx.issuance) return fail2("malformed");
    const issuance = ctx.issuance;
    if (issuance.v !== PROTOCOL_VERSION || issuance.protocol !== PROTOCOL_VERSION) return fail2("unsupported_version");
    const boss2 = bossById(issuance.canonicalBoss);
    if (!boss2) return fail2(rejectedOrUnknown(issuance.canonicalBoss));
    const callerAccount = ctx.accountId != null ? ctx.accountId : issuance.accountId;
    const callerSession = ctx.sessionId != null ? ctx.sessionId : issuance.sessionId;
    const callerDay = ctx.day != null ? ctx.day : issuance.day;
    const binding = log.binding;
    if (callerAccount !== issuance.accountId || binding.accountId !== issuance.accountId || callerSession !== issuance.sessionId || binding.sessionId !== issuance.sessionId || callerDay !== issuance.day || binding.day !== issuance.day || binding.runId !== issuance.runId) {
      return fail2("rebind", { canonicalBoss: boss2.id });
    }
    const digest = logDigest(log);
    if (seen(ctx.seenDigests, digest)) return fail2("reused_log", { logDigest: digest, canonicalBoss: boss2.id });
    if (seen(ctx.seenRunIds, issuance.runId)) return fail2("reused_run", { logDigest: digest, canonicalBoss: boss2.id });
    const liveFingerprint = contentFingerprint(PROTOCOL_VERSION);
    if (issuance.contentFingerprint !== liveFingerprint) return fail2("fingerprint_mismatch", { logDigest: digest });
    let state;
    let tickBase = 0;
    if (ctx.resume) {
      if (!ctx.resume.state || ctx.resume.hash !== verifyStateHash(ctx.resume.state)) return fail2("bad_checkpoint", { logDigest: digest });
      if (log.segments[0].from !== ctx.resume.hash || log.segments[0].tick0 !== ctx.resume.tick) {
        return fail2("bad_checkpoint", { logDigest: digest });
      }
      const cheat = runtimeCheat(ctx.resume.state) || inventoryCheat(ctx.resume.state);
      if (cheat) return fail2(cheat, { logDigest: digest });
      state = pureClone(ctx.resume.state);
      if (verifyStateHash(state) !== ctx.resume.hash) return fail2("bad_checkpoint", { logDigest: digest });
      tickBase = ctx.resume.tick;
    } else {
      if (log.segments[0].from != null || log.segments[0].tick0 !== 0) return fail2("bad_checkpoint", { logDigest: digest });
      state = buildIssuedState(issuance);
      if (!canonicalLoadoutOk(state)) return fail2("injected_inventory", { logDigest: digest });
      if (issuance.initialStateHash !== verifyStateHash(state)) return fail2("bad_start", { logDigest: digest });
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
      if (s > 0 && seg.from !== verifyStateHash(state)) return fail2("bad_checkpoint", { logDigest: digest, tick: state.tick });
      if (seg.tick0 !== state.tick) return fail2(s === 0 ? "bad_checkpoint" : "accelerated", { logDigest: digest, tick: state.tick });
      if (total + seg.n > (issuance.maxFrames || LIMITS.maxTotalFrames)) return fail2("oversized", { logDigest: digest });
      const decoded = decodeFrames(seg.frames, seg.n, seg.actions || []);
      if (decoded.error) return fail2(decoded.error, { logDigest: digest, tick: state.tick });
      for (let f = 0; f < decoded.commands.length; f++) {
        if ((f & 63) === 0 && now() - started > LIMITS.maxCpuMs) return fail2("cpu_budget", { logDigest: digest, tick: state.tick });
        const before = { x: state.players[playerId].pos.x, y: state.players[playerId].pos.y, z: state.players[playerId].pos.z };
        simulate(state, { [playerId]: decoded.commands[f] });
        const moved = movementDelta(before, state.players[playerId].pos);
        if (moved) return fail2(moved, { logDigest: digest, tick: state.tick });
        const cheat = runtimeCheat(state) || inventoryCheat(state);
        if (cheat) return fail2(cheat, { logDigest: digest, tick: state.tick });
        noteParts(seenParts, state, boss2);
        total++;
      }
    }
    if (state.tick !== tickBase + total) return fail2("accelerated", { logDigest: digest, tick: state.tick });
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
    if (typeof text !== "string") return JSON.stringify(fail2("malformed"));
    if (/[[,:]\s*-?(?:NaN|Infinity)\b/.test(text)) return JSON.stringify(fail2("nan"));
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return JSON.stringify(fail2("malformed"));
    }
    if (Array.isArray(body)) {
      const out = [];
      for (let i = 0; i < body.length; i++) out.push(publicReceipt(verifyRun(body[i].log, body[i].ctx)));
      return JSON.stringify(out);
    }
    return JSON.stringify(publicReceipt(verifyRun(body.log, body.ctx)));
  }
  function contentFingerprintOf() {
    return contentFingerprint(PROTOCOL_VERSION);
  }
  return __toCommonJS(verify_exports);
})();
globalThis.SprotoShooterSim = SprotoShooterSim;
