import type { ParsedChat } from './chat';

/**
 * Emotes (plan item E1, the no-art version): keys 1, 2 and 3 send `wave`, `dance` or `cheer` to the
 * shard (server/modules/src/hub_match.ts relays them, one per second per player) and everyone in
 * range sees a short animated line over that player's head. Avatar clips can replace the line later.
 */
export const EMOTES = [
  { id: 'wave', code: 'Digit1', line: { color: 'cyan', effect: 'wave', text: '~ waves ~' } },
  { id: 'dance', code: 'Digit2', line: { color: 'purple', effect: 'wave2', text: '~ dances ~' } },
  { id: 'cheer', code: 'Digit3', line: { color: 'yellow', effect: 'shake', text: 'Woo!' } },
] as const satisfies readonly { id: string; code: string; line: ParsedChat }[];

export type EmoteId = (typeof EMOTES)[number]['id'];

/** The server drops a second emote inside a second (EMOTE_EVERY_TICKS = 10 at 10 Hz); do the same here. */
export const EMOTE_COOLDOWN_MS = 1000;

export function emoteForKey(code: string): EmoteId | null {
  return EMOTES.find((emote) => emote.code === code)?.id ?? null;
}

export function emoteLine(id: string): ParsedChat | null {
  return EMOTES.find((emote) => emote.id === id)?.line ?? null;
}

export function canEmote(lastAt: number, now: number): boolean {
  return now - lastAt >= EMOTE_COOLDOWN_MS;
}
