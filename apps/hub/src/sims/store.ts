// The sims you added, and the story speed, kept on this browser.
import { CHARACTERS, isCharacterId } from '../config';
import { isPersona, PERSONAS, QUIET } from './director';
import { MAX_SIMS, type SimSpec } from './sims';

const KEY = 'hub:sims:v1';

export interface SimSettings {
  list: SimSpec[];
  speed: number;
}

export const SIM_SPEEDS = [1, 2, 5, 20] as const;

/** Letters, digits, space, _ and -; at most 12 characters (like player names). */
export function cleanSimName(raw: string): string {
  return raw.replace(/[^A-Za-z0-9 _-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12);
}

export function validSims(value: unknown): SimSpec[] {
  if (!Array.isArray(value)) return [];
  const out: SimSpec[] = [];
  const ids = new Set<string>();
  for (const raw of value as Partial<SimSpec>[]) {
    if (!raw || typeof raw.id !== 'string' || ids.has(raw.id) || !/^[a-z0-9-]{1,24}$/.test(raw.id)) continue;
    const character = typeof raw.character === 'string' && isCharacterId(raw.character) ? raw.character : CHARACTERS[0].id;
    const persona = typeof raw.persona === 'string' && isPersona(raw.persona) ? raw.persona : QUIET;
    const name = cleanSimName(typeof raw.name === 'string' ? raw.name : '') || defaultSimName(persona, character);
    ids.add(raw.id);
    out.push({ id: raw.id, name, character, persona });
    if (out.length >= MAX_SIMS) break;
  }
  return out;
}

export function defaultSimName(persona: string, character: string): string {
  const p = PERSONAS.find((x) => x.id === persona);
  if (p) return p.name;
  return cleanSimName(CHARACTERS.find((c) => c.id === character)?.label ?? 'Sim') || 'Sim';
}

export function loadSims(): SimSettings {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<SimSettings> | null;
    const speed = Number(parsed?.speed);
    return { list: validSims(parsed?.list), speed: (SIM_SPEEDS as readonly number[]).includes(speed) ? speed : 1 };
  } catch {
    return { list: [], speed: 1 };
  }
}

export function saveSims(settings: SimSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Storage blocked: the sims still work for this visit.
  }
}

export function newSimId(): string {
  return Math.random().toString(36).slice(2, 10);
}
