import { RELICS } from '../../core/relics';
import { GAME_LIST, relicOfGame } from '../../game-list';

/** Only games with a relic grant post jobs. Keep the conditions in sync with the Games menu. */
export const RELIC_JOBS = GAME_LIST.flatMap(game => {
  const relic = RELICS.find(item => item.id === relicOfGame(game.id));
  return relic ? [{ game, relic }] : [];
});
