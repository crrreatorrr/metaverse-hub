import type { RealmId } from '../core/realm-id';
// Plaza wire format, kept in sync with server/modules/src/hub_match.ts (a unit test
// compares the constants against the built server module). Pure: no DOM, no three.

export const OP = {
  POSE: 1,
  SNAPSHOT: 2,
  DELTA: 3,
  ROSTER: 4,
  PROFILE: 5,
  EMOTE: 6,
  TRAVEL: 7,
} as const;

export const TICK_RATE = 10;
export const MAX_PLAYERS = 100;
export const ANIMS = ['idle', 'walk', 'run', 'jump', 'wave', 'dance', 'cheer'] as const;
export type AnimName = (typeof ANIMS)[number];
export const EMOTES = ['wave', 'dance', 'cheer'] as const;

/** [slot, xCm, yCm, zCm, yaw8, anim] */
export type PoseRow = [number, number, number, number, number, number];

export interface RosterEntry {
  s: number;
  u: string;
  n: string;
  c: string;
  st: string;
  pt: string;
  r: string[];
  g: string;
  away: boolean;
}

export interface Snapshot { t: number; you: number; shard: number; roster: RosterEntry[]; p: PoseRow[] }
export interface Delta { t: number; p: PoseRow[] }
export interface RosterChange { add?: RosterEntry[]; del?: number[]; upd?: RosterEntry[] }
export interface EmoteEvent { s: number; e: string }

export interface Pose { x: number; y: number; z: number; yaw: number; anim: number }

const TAU = Math.PI * 2;

export function yawToByte(yaw: number): number {
  const wrapped = ((yaw % TAU) + TAU) % TAU;
  return Math.round((wrapped / TAU) * 256) & 255;
}

export function byteToYaw(byte: number): number {
  return ((byte & 255) / 256) * TAU;
}

export function animIndex(name: string): number {
  const i = (ANIMS as readonly string[]).indexOf(name);
  return i < 0 ? 0 : i;
}

/** Metres + radians → the 5-int POSE body. */
export function encodePose(x: number, y: number, z: number, yaw: number, anim: number): [number, number, number, number, number] {
  return [Math.round(x * 100), Math.round(y * 100), Math.round(z * 100), yawToByte(yaw), Math.max(0, Math.min(ANIMS.length - 1, anim | 0))];
}

export function samePose(a: readonly number[] | null, b: readonly number[]): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/** A row in metres and radians. */
export function decodeRow(row: PoseRow): { slot: number } & Pose {
  return { slot: row[0], x: row[1] / 100, y: row[2] / 100, z: row[3] / 100, yaw: byteToYaw(row[4]), anim: row[5] };
}

/** Same zones as the server: plaza above −50 m, the club interior below −250 m. */
export function zoneOf(yMetres: number, realm: RealmId = 'plaza'): 'plaza' | 'bar' | 'void' | 'sandbox' {
  if (realm === 'sandbox') return 'sandbox';
  if (yMetres > -50) return 'plaza';
  if (yMetres < -250) return 'bar';
  return 'void';
}

function isRow(v: unknown): v is PoseRow {
  return Array.isArray(v) && v.length === 6 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
}

function isEntry(v: unknown): v is RosterEntry {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  return typeof e.s === 'number' && typeof e.u === 'string' && typeof e.n === 'string';
}

function entry(v: RosterEntry): RosterEntry {
  return {
    s: v.s,
    u: v.u,
    n: v.n,
    c: typeof v.c === 'string' ? v.c : '',
    st: typeof v.st === 'string' ? v.st : '',
    pt: typeof v.pt === 'string' ? v.pt : '',
    r: Array.isArray(v.r) ? v.r.filter((x): x is string => typeof x === 'string') : [],
    g: typeof v.g === 'string' ? v.g : '',
    away: v.away === true,
  };
}

export function parseSnapshot(raw: unknown): Snapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.you !== 'number' || !Array.isArray(s.roster) || !Array.isArray(s.p)) return null;
  return {
    t: typeof s.t === 'number' ? s.t : 0,
    you: s.you,
    shard: typeof s.shard === 'number' ? s.shard : 1,
    roster: s.roster.filter(isEntry).map(entry),
    p: s.p.filter(isRow),
  };
}

export function parseDelta(raw: unknown): Delta | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  if (!Array.isArray(d.p)) return null;
  return { t: typeof d.t === 'number' ? d.t : 0, p: d.p.filter(isRow) };
}

export function parseRoster(raw: unknown): RosterChange | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const out: RosterChange = {};
  if (Array.isArray(r.add)) out.add = r.add.filter(isEntry).map(entry);
  if (Array.isArray(r.upd)) out.upd = r.upd.filter(isEntry).map(entry);
  if (Array.isArray(r.del)) out.del = r.del.filter((n): n is number => typeof n === 'number');
  return out;
}
