/**
 * What the plaza says about the Verse store and about grants the server parks (plan item A3).
 * Pure data: the menu, Sprotel's talk panel and the tests read the same constants, so the
 * promises on screen cannot drift from the seed in docs/m7-server-prep.md and
 * server/modules/src/store.ts (`RAW_CATALOG`).
 */

/** Store seed prices in Verse, for the two pets the menu and Sprotel name. */
export const STORE_PET_PRICES = {
  pet_hopium_sproto: 300,
  pet_coom_sproto: 500,
} as const;

export type StorePetId = keyof typeof STORE_PET_PRICES;

export function storePriceLine(id: StorePetId): string {
  return `Store: ${STORE_PET_PRICES[id]} Verse`;
}

/**
 * Relics and pets whose rule has `grant_hold = true` on the server: the qualifying clear is
 * recorded in a pending table and gives the player nothing yet.
 */
export const HELD_RELIC_IDS: readonly string[] = ['genesis_shard', 'tidebreaker_belt'];
export const HELD_PET_IDS: readonly string[] = ['pet_honk_sproto', 'pet_spiral_sproto', 'pet_moon_sproto', 'pet_sproto_pup'];

export const HELD_BADGE = 'Not awarded yet';
export const HELD_NOTE = 'Clearing this is recorded. The Relic arrives when grants open.';
export const HELD_PET_NOTE = 'Earning this is recorded. The pet arrives when grants open.';

/** Badge for a Relic or pet card: owned wins, then the pending text, then Locked. */
export function grantBadge(id: string, owned: boolean, ownedText = 'Owned'): string {
  if (owned) return ownedText;
  return HELD_RELIC_IDS.includes(id) || HELD_PET_IDS.includes(id) ? HELD_BADGE : 'Locked';
}

export function isHeld(id: string): boolean {
  return HELD_RELIC_IDS.includes(id) || HELD_PET_IDS.includes(id);
}
