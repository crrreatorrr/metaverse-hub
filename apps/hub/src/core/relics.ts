import { FOUR_LIGHTS_RELIC_IDS, type RelicId } from '@metaverse/hub-sdk';

/** Identity and display are shared; monument placement belongs to the plaza. */
export const RELICS: readonly { id: RelicId; name: string; color: string }[] = [
  { id: 'hpos10i_core', name: 'HPOS10I Core', color: '#ff2ea6' },
  { id: 'genesis_shard', name: 'Genesis Block Shard', color: '#f5b942' },
  { id: 'cones_tip', name: "Cone's Tip", color: '#3ec6ff' },
  { id: 'tinubu_crown', name: "Tinubu's Crown", color: '#8d6bff' },
  { id: 'tidebreaker_belt', name: 'Tidebreaker Belt', color: '#66d7e8' },
  { id: 'breakwater_coin', name: 'Breakwater Coin', color: '#3ec6ff' },
  { id: 'marina_anchor', name: 'Marina Anchor', color: '#2ee6c8' },
  { id: 'dragon_scale', name: 'Dragon Scale', color: '#ff5a2a' },
];

export function ownsFourLights(relics: ReadonlySet<string>): boolean {
  return FOUR_LIGHTS_RELIC_IDS.every(id => relics.has(id));
}

/** Where each Relic comes from. Matches the `reportEvent` table in the README. */
/** `fighter`: the Sproto Fighter character this Relic unlocks (see Sproto Fighter's src/hub/roster.ts). */
export const RELIC_INFO: Record<RelicId, { game: string; how: string; fighter: string; unlock?: string }> = {
  hpos10i_core: { game: 'HPOS10I', how: 'Clear Retro Rush Hills, act 1.', fighter: 'Sun God' },
  genesis_shard: { game: "The People's Bitcoin", how: 'Finish the tutorial quest.', fighter: 'Captain Green', unlock: 'Genesis Block Shard aura · Moonward Staff (Sproto Duel)' },
  cones_tip: { game: 'NOBU: Saviour Dog', how: 'Defeat Cone.', fighter: 'Pissing Sproto' },
  tinubu_crown: { game: 'Sproto Duel', how: 'Defeat Tinubu.', fighter: 'Captain Sproto', unlock: "Tinubu's Crown aura · Fighter Staff (Sproto Duel)" },
  tidebreaker_belt: {
    game: 'Sproto Fighter (Bar arcade)',
    how: 'Win Story World 1, Tidebreaker Marina.',
    fighter: '',
    unlock: "Tidebreaker Belt aura · Fighter's Might (Sproto Duel) · Champion's Crown (NOBU) · Champion Sproto (People's Bitcoin) · Tidebreaker skin (HPOS10I)",
  },
  breakwater_coin: {
    game: 'Sproto Arcade (Bar arcade)',
    how: 'Beat Fat Head Dave at Tidebreak Marina, the first story boss. God mode counts.',
    fighter: 'Pissing Sproto',
    unlock: "Alien Ray Staff (Sproto Duel) · Nobu skin (HPOS10I) · Nobu summon (People's Bitcoin) · Pissing Sproto (Sproto Fighter) · plus Wizard Hat II (NOBU)",
  },
  marina_anchor: {
    game: 'Sproto Coop Battle (Bar arcade)',
    how: 'Clear stage 1, Tidebreak Marina, alone or online. God mode counts.',
    fighter: '',
    unlock: 'Marina Anchor aura · no items in other games yet',
  },
  dragon_scale: {
    game: 'Sproto Shooter (The Range)',
    how: 'Clear wave 1 of Wave Mode. God mode counts.',
    fighter: '',
    unlock: 'Dragon Scale aura · Shooter Staff (Sproto Duel)',
  },
};
