interface ParamBag {
  [key: string]: string | number | boolean;
}

type EffectValue = string | number | boolean | ParamBag;

interface EffectPart {
  key: string;
  value: EffectValue;
  /** Cosmetic parts stay on in Ranked. Gameplay parts do not, except in People's Bitcoin. */
  kind: "cosmetic" | "gameplay";
}

interface MatrixRow {
  id: string;
  game: string;
  slot: string;
  relic: string;
  parts: EffectPart[];
}

interface Loadout {
  [slot: string]: string | null;
}

namespace HubEffects {
  var RELIC_GAME: { [relic: string]: string } = {
    hpos10i_core: "hpos10i",
    genesis_shard: "peoples-bitcoin",
    cones_tip: "nobu",
    tinubu_crown: "sproto",
  };

  // §2 effect ids and param names. Relic effects never change Tickets, flags, or boards.
  // There is no ticket_multiplier. Ranked keeps the staff id and bolt color; only the params are gameplay.
  var MATRIX: MatrixRow[] = [
    {
      id: "nobu_clown_collar",
      game: "nobu",
      slot: "neck",
      relic: "hpos10i_core",
      parts: [
        { key: "collar", value: "nobu_clown_collar", kind: "cosmetic" },
        {
          key: "air_dash",
          kind: "gameplay",
          value: { charges_per_jump: 1, distance_m: 3, dash_time_s: 0.18, vel_y: 0 },
        },
      ],
    },
    {
      id: "pb_summon_speed_sproto",
      game: "peoples-bitcoin",
      slot: "summon",
      relic: "hpos10i_core",
      parts: [
        { key: "summon", value: "pb_summon_speed_sproto", kind: "cosmetic" },
        { key: "summon_run_regen", kind: "gameplay", value: { run_regen_mult: 1.25 } },
      ],
    },
    {
      id: "duel_staff_momentum",
      game: "sproto",
      slot: "staff",
      relic: "hpos10i_core",
      parts: [
        { key: "staff", value: "duel_staff_momentum", kind: "cosmetic" },
        { key: "bolt_color", value: 0x3fe6ff, kind: "cosmetic" },
        {
          key: "blink_dash",
          kind: "gameplay",
          value: {
            dist_m: 6,
            travel_s: 0.08,
            iframes_s: 0.28,
            cooldown_s: 4,
            trail_dps: 10,
            trail_s: 1.5,
            trail_width_m: 1.2,
          },
        },
      ],
    },
    {
      id: "hpos_skin_golden_sproto",
      game: "hpos10i",
      slot: "body",
      relic: "genesis_shard",
      parts: [
        { key: "skin", value: "hpos_skin_golden_sproto", kind: "cosmetic" },
        { key: "extra_life_per_act", kind: "gameplay", value: { lives_per_act: 1 } },
      ],
    },
    {
      id: "nobu_golden_collar",
      game: "nobu",
      slot: "neck",
      relic: "genesis_shard",
      parts: [
        { key: "collar", value: "nobu_golden_collar", kind: "cosmetic" },
        {
          key: "damage_guard",
          kind: "gameplay",
          value: { guard_charges: 1, invuln_s: 1.7, knockback: 6 },
        },
      ],
    },
    {
      id: "duel_staff_moonward",
      game: "sproto",
      slot: "staff",
      relic: "genesis_shard",
      parts: [
        { key: "staff", value: "duel_staff_moonward", kind: "cosmetic" },
        { key: "bolt_color", value: 0xcfe3ff, kind: "cosmetic" },
        { key: "bolt_damage_mult", value: 1.5, kind: "gameplay" },
      ],
    },
    {
      id: "hpos_skin_nobu",
      game: "hpos10i",
      slot: "body",
      relic: "cones_tip",
      parts: [
        { key: "skin", value: "hpos_skin_nobu", kind: "cosmetic" },
        { key: "move_speed_mult", value: 1.05, kind: "gameplay" },
      ],
    },
    {
      id: "pb_summon_nobu",
      game: "peoples-bitcoin",
      slot: "summon",
      relic: "cones_tip",
      parts: [
        { key: "summon", value: "pb_summon_nobu", kind: "cosmetic" },
        {
          key: "summon_fetch",
          kind: "gameplay",
          value: { fetch_radius_tiles: 8, fetch_every_ticks: 3 },
        },
      ],
    },
    {
      id: "duel_staff_nobu",
      game: "sproto",
      slot: "staff",
      relic: "cones_tip",
      parts: [
        { key: "staff", value: "duel_staff_nobu", kind: "cosmetic" },
        { key: "bolt_color", value: 0xfff1a8, kind: "cosmetic" },
        { key: "bolt_knockback", value: 6, kind: "gameplay" },
      ],
    },
    {
      id: "pb_summon_duelist_sproto",
      game: "peoples-bitcoin",
      slot: "summon",
      relic: "tinubu_crown",
      parts: [
        { key: "summon", value: "pb_summon_duelist_sproto", kind: "cosmetic" },
        {
          key: "summon_stun",
          kind: "gameplay",
          value: { stun_ticks: 2, stun_cooldown_ticks: 10 },
        },
      ],
    },
    {
      id: "nobu_wizard_hat",
      game: "nobu",
      slot: "head",
      relic: "tinubu_crown",
      parts: [
        { key: "hat", value: "nobu_wizard_hat", kind: "cosmetic" },
        {
          key: "spell_bark",
          kind: "gameplay",
          value: {
            range_m: 9,
            cone_dot: 0.4,
            cooldown_s: 0.7,
            y_tol_m: 2.5,
            rings: 4,
            ring_step_m: 2.2,
            color: 0xa66bff,
            skip_bosses: true,
            unlock_mega_bark: true,
          },
        },
      ],
    },
    {
      id: "hpos_cape_duelist",
      game: "hpos10i",
      slot: "back",
      relic: "tinubu_crown",
      parts: [
        { key: "cape", value: "hpos_cape_duelist", kind: "cosmetic" },
        {
          key: "time_focus",
          kind: "gameplay",
          value: { time_scale: 0.5, duration_s: 3, uses_per_level: 1 },
        },
      ],
    },
  ];

  function assertMatrix(): void {
    var seen: { [id: string]: boolean } = {};
    var relics = ["hpos10i_core", "genesis_shard", "cones_tip", "tinubu_crown"];
    var count: { [relic: string]: number } = {};
    if (MATRIX.length !== 12) throw new Error("matrix_count");
    for (var i = 0; i < MATRIX.length; i++) {
      var row = MATRIX[i];
      if (seen[row.id]) throw new Error("duplicate_item");
      seen[row.id] = true;
      if (!RELIC_GAME[row.relic] || RELIC_GAME[row.relic] === row.game) throw new Error("relic_in_own_game");
      count[row.relic] = (count[row.relic] || 0) + 1;
      for (var p = 0; p < row.parts.length; p++) {
        if (row.parts[p].key.indexOf("ticket") >= 0) throw new Error("ticket_effect");
      }
    }
    for (var r = 0; r < relics.length; r++) {
      if (count[relics[r]] !== 3) throw new Error("matrix_count");
    }
  }
  assertMatrix();

  function byId(id: string): MatrixRow | null {
    for (var i = 0; i < MATRIX.length; i++) if (MATRIX[i].id === id) return MATRIX[i];
    return null;
  }

  function owns(owned: string[], row: MatrixRow): boolean {
    for (var i = 0; i < owned.length; i++) {
      if (owned[i] === row.relic || owned[i] === row.id) return true;
    }
    return false;
  }

  function isLoadout(value: Loadout | string[]): value is Loadout {
    return !!value && typeof value === "object" && Object.prototype.toString.call(value) !== "[object Array]";
  }

  function apply(
    owned: string[],
    loadout: Loadout,
    ranked: boolean,
    game: string,
  ): { [key: string]: EffectValue } {
    var out: { [key: string]: EffectValue } = {};
    var keepGameplay = !ranked || game === "peoples-bitcoin";
    var slots = Object.keys(loadout);
    for (var s = 0; s < slots.length; s++) {
      var itemId = loadout[slots[s]];
      if (typeof itemId !== "string" || !itemId) continue;
      var row = byId(itemId);
      if (!row || row.game !== game || row.slot !== slots[s] || !owns(owned, row)) continue;
      for (var p = 0; p < row.parts.length; p++) {
        var part = row.parts[p];
        if (part.kind === "gameplay" && !keepGameplay) continue;
        out[part.key] = part.value;
      }
    }
    return out;
  }

  /**
   * Equipped items only. `owned` is relic ids or item ids. An empty loadout
   * resolves nothing, which is the portal.enter path until loadout/<game> is wired.
   * The live caller still uses the 3-argument form; #12, #13, and #25 edit that
   * file, so this overload supplies the empty loadout for it.
   */
  export function resolve(game: string, relics: string[], ranked: boolean): { [key: string]: EffectValue };
  export function resolve(
    owned: string[],
    loadout: Loadout,
    ranked: boolean,
    game: string,
  ): { [key: string]: EffectValue };
  export function resolve(
    ownedOrGame: string | string[],
    loadoutOrRelics: Loadout | string[],
    ranked: boolean,
    game?: string,
  ): { [key: string]: EffectValue } {
    if (typeof ownedOrGame === "string") {
      var relics = Object.prototype.toString.call(loadoutOrRelics) === "[object Array]" ? loadoutOrRelics as string[] : [];
      return apply(relics, {}, ranked, ownedOrGame);
    }
    var loadout = isLoadout(loadoutOrRelics) ? loadoutOrRelics : {};
    return apply(ownedOrGame, loadout, ranked, game || "");
  }

  export function gameForRelic(relic: string): string {
    return RELIC_GAME[relic] || "";
  }
}
