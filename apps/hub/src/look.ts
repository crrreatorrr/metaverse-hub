import { isRelicId, type RelicId } from '@metaverse/hub-sdk';
import { DEFAULT_CHARACTER, isCharacterId, type CharacterId } from './config';

/**
 * How the player's avatar looks. Stored on this device only; there is no
 * server slot for appearance yet.
 */
export interface AvatarLook {
  v: 1;
  /** Which body. See `CHARACTERS`. */
  character: CharacterId;
  preset: string;
  /** Shown in front of chat lines. Blank means the guest id. */
  name: string;
  /** Multiplied into the robe texture. White is the original. */
  tint: string;
  glow: string;
  /** 0 to 1. */
  glowStrength: number;
  /** 0.9 to 1.1 of the fitted body. */
  height: number;
  /** Ring at the feet. Each one needs that Relic. */
  aura: RelicId | 'none';
}

export interface LookPreset {
  id: string;
  label: string;
  blurb: string;
  tint: string;
  glow: string;
  glowStrength: number;
}

export const LOOK_PRESETS: readonly LookPreset[] = [
  { id: 'classic', label: 'Original', blurb: 'No tint, as the model arrived.', tint: '#ffffff', glow: '#000000', glowStrength: 0 },
  { id: 'shadow', label: 'Shadow Mage', blurb: 'Dark robes, faint violet.', tint: '#6d6a8c', glow: '#5b3cff', glowStrength: 0.12 },
  { id: 'ember', label: 'Ember', blurb: 'Warm and a little singed.', tint: '#ffb08a', glow: '#ff5a1f', glowStrength: 0.14 },
  { id: 'frost', label: 'Frost', blurb: 'Cold blue, slight shimmer.', tint: '#b4e4ff', glow: '#3de1ff', glowStrength: 0.14 },
  { id: 'verdant', label: 'Verdant', blurb: 'Green Hill colours.', tint: '#b8ffb0', glow: '#39ff6a', glowStrength: 0.1 },
  { id: 'neon', label: 'Neon', blurb: 'Plaza pink, full glow.', tint: '#ffc4ec', glow: '#ff2ea6', glowStrength: 0.28 },
];

export const MIN_HEIGHT = 0.9;
export const MAX_HEIGHT = 1.1;

const STORAGE_KEY = 'hub.look.v1';
const HEX = /^#[0-9a-f]{6}$/i;

export function defaultLook(): AvatarLook {
  const base = LOOK_PRESETS[0];
  return {
    v: 1,
    character: DEFAULT_CHARACTER,
    preset: base.id,
    name: '',
    tint: base.tint,
    glow: base.glow,
    glowStrength: base.glowStrength,
    height: 1,
    aura: 'none',
  };
}

export function applyPreset(look: AvatarLook, preset: LookPreset): AvatarLook {
  return { ...look, preset: preset.id, tint: preset.tint, glow: preset.glow, glowStrength: preset.glowStrength };
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
  if (typeof value.preset === 'string') look.preset = value.preset;
  if (typeof value.name === 'string') look.name = cleanName(value.name).trim();
  if (typeof value.tint === 'string' && HEX.test(value.tint)) look.tint = value.tint.toLowerCase();
  if (typeof value.glow === 'string' && HEX.test(value.glow)) look.glow = value.glow.toLowerCase();
  if (typeof value.glowStrength === 'number' && Number.isFinite(value.glowStrength)) {
    look.glowStrength = Math.min(1, Math.max(0, value.glowStrength));
  }
  if (typeof value.height === 'number' && Number.isFinite(value.height)) {
    look.height = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, value.height));
  }
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
