import { FOUR_LIGHTS_RELIC_IDS, type RelicId } from '@metaverse/hub-sdk';

/** Identity and display are shared; monument placement belongs to the plaza. */
export const RELICS: readonly { id: RelicId; name: string; color: string }[] = [
  { id: 'hpos10i_core', name: 'HPOS10I Core', color: '#ff2ea6' },
  { id: 'genesis_shard', name: 'Genesis Block Shard', color: '#f5b942' },
  { id: 'cones_tip', name: "Cone's Tip", color: '#3ec6ff' },
  { id: 'tinubu_crown', name: "Tinubu's Crown", color: '#8d6bff' },
  { id: 'tidebreaker_belt', name: 'Tidebreaker Belt', color: '#66d7e8' },
  { id: 'breakwater_coin', name: 'Breakwater Coin', color: '#3ec6ff' },
];

export function ownsFourLights(relics: ReadonlySet<string>): boolean {
  return FOUR_LIGHTS_RELIC_IDS.every(id => relics.has(id));
}
