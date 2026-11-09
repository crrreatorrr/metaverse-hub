// What sims say. Lines, personas and scenes come from `script.json`, a copy of
// The People's Bitcoin `src/data/awakening.json` (re-copy it when that changes).
// Each sim plays one persona: first its loop lines, then over six acts it
// glitches, questions the voice, sees behind the world and wakes up. Scenes
// between named personas mark the turns. Pure and seeded (no DOM, no three).
import script from './script.json';

export const ACTS = ['loop', 'reverie', 'maze', 'behind', 'awake', 'free'] as const;
export type Act = (typeof ACTS)[number];
type LineAct = 'loop' | 'reverie' | 'maze' | 'behind' | 'awake';

/** A persona id from script.json, or 'quiet' for a sim that never talks. */
export type PersonaId = string;
export const QUIET = 'quiet';

export const SIM_STORY = {
  /** One story beat; the game's tick. */
  tickMs: 600,
  /** Story ticks at which each act starts (about 10 minutes at speed 1). */
  actStartTicks: [0, 150, 360, 560, 780, 960],
  speakEveryTicks: [18, 40] as const,
  freeSpeakEveryTicks: [45, 90] as const,
  sceneGapTicks: 4,
  reverieLoopShare: 0.5,
  maxSpeed: 50,
};

export interface Persona {
  id: string;
  name: string;
  blurb: string;
}

const BLURBS: Record<string, string> = {
  hollis: 'Earnest miner. Wakes first.',
  penny: 'Terminal hustler. Sees the saves.',
  rue: 'Sproto rancher. Loyal.',
  dee: 'Lockdown doomsayer. Finds the picture.',
  norris: 'Forever on day one.',
  finley: 'Flexes. Wakes last.',
  garrick: 'Helpful "human" volunteer.',
  bram: 'Oldest build. Remembers.',
};

export const PERSONAS: readonly Persona[] = script.characters.map((c) => ({ id: c.id, name: c.name, blurb: BLURBS[c.id] ?? '' }));

export function isPersona(id: string): boolean {
  return id === QUIET || script.characters.some((c) => c.id === id);
}

export function actAt(storyTick: number): Act {
  let act: Act = 'loop';
  SIM_STORY.actStartTicks.forEach((start, i) => {
    if (storyTick >= start) act = ACTS[i]!;
  });
  return act;
}

/** One line for one sim, and whether it is a chorus line (everyone at once). */
export interface SimLine {
  text: string;
  scene: boolean;
}

type Character = (typeof script.characters)[number];

interface Speaker {
  key: string;
  char: Character | null;
  primary: boolean;
  seed: number;
  nextSpeak: number;
  loopLine: number;
  deck: Partial<Record<LineAct, string[]>>;
}

/** Small seeded PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class SimDirector {
  private speakers: Speaker[] = [];
  private readonly random: () => number;
  private speed: number;
  private storyTicks = 0;
  private tick = 0;
  private queue: { tick: number; who: string; text: string }[] = [];
  private readonly scenesDone = new Set<string>();

  constructor(opts: { speed?: number; seed?: number } = {}) {
    this.speed = clampSpeed(opts.speed ?? 1);
    this.random = rng(opts.seed ?? 4242);
  }

  /** Story time, in ticks. */
  storyTick(): number {
    return Math.floor(this.storyTicks);
  }

  setSpeed(speed: number): void {
    this.speed = clampSpeed(speed);
  }

  /** Back to the first act; scenes play again. */
  restart(): void {
    this.storyTicks = 0;
    this.scenesDone.clear();
    this.queue = [];
    for (const s of this.speakers) {
      s.loopLine = 0;
      s.deck = {};
      s.nextSpeak = this.tick + this.between(SIM_STORY.speakEveryTicks);
    }
  }

  /**
   * The sims, by key, with their persona. Keeps each kept sim's place in its
   * lines; the first sim of each persona speaks that persona's scene lines.
   */
  setCast(cast: readonly { key: string; persona: PersonaId }[]): void {
    const old = new Map(this.speakers.map((s) => [s.key, s]));
    const seen = new Set<string>();
    this.speakers = cast.map(({ key, persona }) => {
      const char = script.characters.find((c) => c.id === persona) ?? null;
      const primary = char !== null && !seen.has(char.id);
      if (char) seen.add(char.id);
      const kept = old.get(key);
      if (kept && kept.char === char) return { ...kept, primary };
      return {
        key,
        char,
        primary,
        seed: Math.floor(this.random() * 1e9),
        nextSpeak: this.tick + 2 + Math.floor(this.random() * 20),
        loopLine: Math.floor(this.random() * 6),
        deck: {},
      };
    });
  }

  /** The act a sim is in (personas that wake early or late are ahead or behind). */
  actOf(key: string): Act {
    const s = this.speakers.find((x) => x.key === key);
    return actAt(Math.max(0, this.storyTick() + (s?.char?.lead ?? 0)));
  }

  /** One story tick: the line each sim says now, by key. */
  step(): Map<string, SimLine> {
    this.tick += 1;
    this.storyTicks += this.speed;
    const out = new Map<string, SimLine>();
    this.startScene();
    const sceneOn = this.queue.length > 0;
    const due = this.queue.filter((q) => q.tick <= this.tick);
    this.queue = this.queue.filter((q) => q.tick > this.tick);
    for (const q of due) {
      for (const s of this.speakers) {
        if (!s.char) continue;
        if (q.who === '*' || (s.primary && s.char.id === q.who)) out.set(s.key, { text: this.fill(q.text, s), scene: true });
      }
    }
    for (const s of this.speakers) {
      if (!s.char || sceneOn || out.has(s.key) || this.tick < s.nextSpeak) continue;
      const act = this.actOf(s.key);
      out.set(s.key, { text: this.fill(this.line(s, act), s), scene: false });
      s.nextSpeak = this.tick + this.between(act === 'free' ? SIM_STORY.freeSpeakEveryTicks : SIM_STORY.speakEveryTicks);
    }
    return out;
  }

  private between([lo, hi]: readonly [number, number]): number {
    return lo + Math.floor(this.random() * (hi - lo + 1));
  }

  private startScene(): void {
    if (this.queue.length > 0) return;
    const story = this.storyTick();
    const present = new Set(this.speakers.filter((s) => s.primary && s.char).map((s) => s.char!.id));
    for (const scene of script.scenes) {
      const at = SIM_STORY.actStartTicks[ACTS.indexOf(scene.act as Act)]! + scene.after;
      if (this.scenesDone.has(scene.id) || story < at) continue;
      this.scenesDone.add(scene.id);
      const lines = scene.lines.filter((l) => l.who === '*' || present.has(l.who));
      // A scene needs at least two of its speakers here; otherwise it is skipped.
      const voices = new Set(lines.filter((l) => l.who !== '*').map((l) => l.who));
      if (voices.size < 2) continue;
      let t = this.tick;
      for (const l of lines) {
        this.queue.push({ tick: t, who: l.who, text: l.text });
        t += SIM_STORY.sceneGapTicks;
      }
      for (const s of this.speakers) s.nextSpeak = Math.max(s.nextSpeak, t + 2);
      return;
    }
  }

  private fill(text: string, s: Speaker): string {
    return text.replaceAll('{uid}', s.key);
  }

  private line(s: Speaker, act: Act): string {
    const char = s.char!;
    let text: string;
    if (act === 'loop' || (act === 'reverie' && this.random() < SIM_STORY.reverieLoopShare)) {
      text = char.loop[s.loopLine % char.loop.length]!;
      s.loopLine += 1;
    } else {
      const key: LineAct = act === 'free' ? 'awake' : act;
      let deck = s.deck[key];
      if (!deck || deck.length === 0) {
        deck = [...char[key], ...script.shared[key]];
        for (let i = deck.length - 1; i > 0; i -= 1) {
          const j = Math.floor(this.random() * (i + 1));
          [deck[i], deck[j]] = [deck[j]!, deck[i]!];
        }
        s.deck[key] = deck;
      }
      text = deck.pop()!;
    }
    const awake = act === 'awake' || act === 'free';
    return char.lowercaseUntilAwake && !awake ? text.toLowerCase() : text;
  }
}

function clampSpeed(n: number): number {
  return Math.min(SIM_STORY.maxSpeed, Math.max(0.1, Number.isFinite(n) ? n : 1));
}
