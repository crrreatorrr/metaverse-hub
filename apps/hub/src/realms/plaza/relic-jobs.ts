import type { RelicId } from '@metaverse/hub-sdk';
import { RELICS, RELIC_INFO } from '../../core/relics';
import { GAME_LIST, relicOfGame } from '../../game-list';

// Columns in the woodcut illustration strip.
const CUT: Record<RelicId, number> = {
  hpos10i_core: 0, cones_tip: 1, genesis_shard: 2, tinubu_crown: 3,
  dragon_scale: 4, breakwater_coin: 5, tidebreaker_belt: 6, marina_anchor: 7,
};

export const RELIC_JOBS = GAME_LIST.flatMap(game => {
  const relic = RELICS.find(item => item.id === relicOfGame(game.id));
  return relic ? [{ game, relic, how: RELIC_INFO[relic.id].how, cut: CUT[relic.id] }] : [];
});
