interface EffectDef {
  key: string;
  value: string | number | boolean;
  kind: string;
}

namespace HubEffects {
  var RELIC_GAME: { [relic: string]: string } = {
    hpos10i_core: "hpos10i",
    genesis_shard: "peoples-bitcoin",
    cones_tip: "nobu",
    tinubu_crown: "sproto",
  };

  var MATRIX: { [relic: string]: { [game: string]: EffectDef[] } } = {
    hpos10i_core: {
      nobu: [
        { key: "collar", value: "clown_nose", kind: "cosmetic" },
        { key: "air_dash_charges", value: 1, kind: "gameplay" },
        { key: "air_dash_distance_m", value: 3, kind: "gameplay" },
      ],
      "peoples-bitcoin": [
        { key: "summon", value: "speed_sproto", kind: "summon" },
        { key: "run_energy_regen", value: 1.25, kind: "gameplay" },
      ],
      sproto: [
        { key: "staff", value: "momentum", kind: "gameplay" },
        { key: "blink_dist_m", value: 6, kind: "gameplay" },
        { key: "blink_cooldown_s", value: 4, kind: "gameplay" },
        { key: "trail_dps", value: 10, kind: "gameplay" },
        { key: "trail_s", value: 1.5, kind: "gameplay" },
      ],
    },
    genesis_shard: {
      hpos10i: [
        { key: "skin", value: "golden_sproto", kind: "cosmetic" },
        { key: "ticket_multiplier", value: 2, kind: "gameplay" },
      ],
      nobu: [
        { key: "collar", value: "golden", kind: "cosmetic" },
        { key: "damage_taken_multiplier", value: 0.5, kind: "gameplay" },
      ],
      sproto: [
        { key: "staff", value: "moonward", kind: "gameplay" },
        { key: "coom_bolt_damage_multiplier", value: 1.5, kind: "gameplay" },
      ],
    },
    cones_tip: {
      hpos10i: [
        { key: "skin", value: "nobu", kind: "cosmetic" },
        { key: "move_speed_multiplier", value: 1.05, kind: "gameplay" },
      ],
      "peoples-bitcoin": [
        { key: "summon", value: "nobu", kind: "summon" },
        { key: "fetch_radius_m", value: 8, kind: "gameplay" },
      ],
      sproto: [
        { key: "staff", value: "nobu", kind: "gameplay" },
        { key: "bark_knockback", value: 6, kind: "gameplay" },
      ],
    },
    tinubu_crown: {
      "peoples-bitcoin": [
        { key: "summon", value: "duelist_sproto", kind: "summon" },
        { key: "stun_s", value: 1.5, kind: "gameplay" },
        { key: "stun_cooldown_s", value: 6, kind: "gameplay" },
      ],
      nobu: [
        { key: "hat", value: "wizard", kind: "cosmetic" },
        { key: "spell_bark_range_m", value: 8, kind: "gameplay" },
        { key: "spell_bark_cooldown_s", value: 5, kind: "gameplay" },
        { key: "spell_bark_stun_s", value: 1, kind: "gameplay" },
      ],
      hpos10i: [
        { key: "cape", value: "duelist", kind: "cosmetic" },
        { key: "time_scale", value: 0.5, kind: "gameplay" },
        { key: "time_focus_s", value: 3, kind: "gameplay" },
        { key: "time_focus_uses", value: 1, kind: "gameplay" },
      ],
    },
  };

  export function resolve(
    game: string,
    relics: string[],
    ranked: boolean,
  ): { [key: string]: string | number | boolean } {
    var out: { [key: string]: string | number | boolean } = {};
    for (var i = 0; i < relics.length; i++) {
      var relic = relics[i];
      if (RELIC_GAME[relic] === game) continue;
      var row = MATRIX[relic];
      if (!row) continue;
      var effects = row[game];
      if (!effects) continue;
      for (var j = 0; j < effects.length; j++) {
        var effect = effects[j];
        if (ranked && effect.kind === "gameplay") continue;
        out[effect.key] = effect.value;
      }
    }
    return out;
  }

  export function gameForRelic(relic: string): string {
    return RELIC_GAME[relic] || "";
  }
}
