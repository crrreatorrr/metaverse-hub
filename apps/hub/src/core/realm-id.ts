/** Pure realm identifiers, usable by wire code and Node tests without loading the renderer. */
export const REALM_IDS = ['plaza', 'sandbox'] as const;
export type RealmId = (typeof REALM_IDS)[number];
