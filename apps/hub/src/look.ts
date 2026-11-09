import { isRelicId, type RelicId } from '@metaverse/hub-sdk';
import { DEFAULT_CHARACTER, DEFAULT_STAFF, isCharacterId, isStaffId, type CharacterId, type StaffId } from './config';

/**
 * How the player's avatar looks. Stored on this device only; there is no
 * server slot for appearance yet.
 */
export interface AvatarLook {
  v: 1;
  /** Which body. See `CHARACTERS`. */
  character: CharacterId;
  /** Held in the right hand. See `STAFFS`. */
  staff: StaffId;
  /** Shown in front of chat lines. Blank means the guest id. */
  name: string;
  /** Ring at the feet. Each one needs that Relic. */
  aura: RelicId | 'none';
}

const STORAGE_KEY = 'hub.look.v1';

/**
 * Stored looks from before the Edit avatar trim may still carry `preset`, `tint`, `glow`, `glowStrength` and
 * `height`. `parseLook` drops them, so every avatar shows its model as shipped, at its fitted size.
 */
export function defaultLook(): AvatarLook {
  return { v: 1, character: DEFAULT_CHARACTER, staff: DEFAULT_STAFF, name: '', aura: 'none' };
}

/** Max 12 visible characters, letters, digits, space, dash and underscore, like a RuneScape name. */
export function cleanName(value: string): string {
  return value.replace(/[^\p{L}\p{N} _-]/gu, '').replace(/\s+/g, ' ').trimStart().slice(0, 12);
}

export function parseLook(raw: unknown): AvatarLook {
  const look = defaultLook();
  if (!raw || typeof raw !== 'object') return look;
  const value = raw as Record<string, unknown>;
  if (typeof value.character === 'string' && isCharacterId(value.character)) look.character = value.character;
  if (typeof value.staff === 'string' && isStaffId(value.staff)) look.staff = value.staff;
  if (typeof value.name === 'string') look.name = cleanName(value.name).trim();
  if (typeof value.aura === 'string' && isRelicId(value.aura)) look.aura = value.aura;
  return look;
}

export function loadLook(): AvatarLook {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored ? parseLook(JSON.parse(stored)) : defaultLook();
  } catch {
    return defaultLook();
  }
}

export function saveLook(look: AvatarLook): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(look));
  } catch {
    // Private mode or a full quota. The look still applies for this visit.
  }
}
