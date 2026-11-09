// Sims: characters you add from the menu (Sims tab) that walk the plaza and
// talk. They live on this screen only: they join the RemoteWorld next to the
// real players (so remotes.ts draws them), never the server, and their lines
// go to your chat log and overhead bubbles, never the chat channel.
// Pure apart from the timer: tests drive `tick` directly.
import { ANIMS, encodePose, type PoseRow, type RosterEntry } from '../net/protocol';
import type { RemoteWorld } from '../net/remoteWorld';
import { SimDirector, SIM_STORY, type Act, type PersonaId } from './director';

export interface SimSpec {
  id: string;
  name: string;
  /** A CharacterId from config.ts. */
  character: string;
  persona: PersonaId;
}

export const MAX_SIMS = 24;
/** Sims use slots far above the server's (1–100) so the two never meet. */
const SLOT_BASE = 10_000;
const STEP_MS = 100;
const STAND_Y = 1.775;
const WALK_SPEED = 1.6;

export const SIM_AREA = {
  /** Open plaza around the fountain the dev bots also use. */
  cx: 0,
  cz: 30,
  rMin: 6,
  rMax: 22,
  /** The maze act drifts out to the edge of the open plaza. */
  rEdge: 27,
  /** The awake act gathers them in a ring this wide. */
  rGather: 4,
};

const ANIM = (name: (typeof ANIMS)[number]) => ANIMS.indexOf(name);

export function simUserId(id: string): string {
  return `sim:${id}`;
}

export function isSimUser(userId: string): boolean {
  return userId.startsWith('sim:');
}

interface Walker {
  spec: SimSpec;
  slot: number;
  userId: string;
  x: number;
  z: number;
  yaw: number;
  anim: number;
  animUntil: number;
  target: { x: number; z: number } | null;
  pauseUntil: number;
  route: { x: number; z: number }[];
  routeAt: number;
  act: Act;
  random: () => number;
}

export interface SimsOptions {
  world: RemoteWorld;
  /** A sim said something: log it and show the bubble. */
  onLine(userId: string, name: string, text: string): void;
  now?: () => number;
  /** false: no timer; the caller calls tick() (tests). */
  autoRun?: boolean;
  speed?: number;
  seed?: number;
}

export interface Sims {
  readonly director: SimDirector;
  set(list: readonly SimSpec[]): void;
  setSpeed(speed: number): void;
  restart(): void;
  /** Advance by `ms` of wall time. */
  tick(ms: number): void;
  /** Where a sim stands, for tests. */
  positionOf(id: string): { x: number; z: number; anim: number } | null;
  /** The story act of the cast (the first talking sim), for the menu. */
  act(): Act;
  dispose(): void;
}

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pointIn(random: () => number, rMin: number, rMax: number): { x: number; z: number } {
  const a = random() * Math.PI * 2;
  const r = rMin + random() * (rMax - rMin);
  return { x: SIM_AREA.cx + Math.cos(a) * r, z: SIM_AREA.cz + Math.sin(a) * r };
}

export function createSims(options: SimsOptions): Sims {
  const world = options.world;
  const now = options.now ?? (() => performance.now());
  const director = new SimDirector({ speed: options.speed, seed: options.seed });
  const master = seeded(options.seed ?? 99);
  const walkers = new Map<string, Walker>();
  let nextSlot = SLOT_BASE;
  let elapsed = 0;
  let storyMs = 0;
  let fixing = false;

  const entry = (w: Walker): RosterEntry => ({
    s: w.slot,
    u: w.userId,
    n: w.spec.name,
    c: w.spec.character,
    st: 'sproto',
    pt: '',
    r: [],
    g: '',
    away: false,
  });

  // A server snapshot replaces the roster: put the sims back.
  const unsubscribe = world.onRoster(() => {
    if (fixing) return;
    const missing = [...walkers.values()].filter((w) => world.players.get(w.slot)?.userId !== w.userId);
    if (missing.length === 0) return;
    fixing = true;
    world.applyRoster({ add: missing.map(entry) });
    fixing = false;
    pushPoses();
  });

  function pushPoses(): void {
    if (walkers.size === 0) return;
    const rows: PoseRow[] = [...walkers.values()].map((w) => [w.slot, ...encodePose(w.x, STAND_Y, w.z, w.yaw, w.anim)] as PoseRow);
    world.applyDelta({ t: 0, p: rows }, now());
  }

  function play(w: Walker, anim: number, ms: number): void {
    w.anim = anim;
    w.animUntil = elapsed + ms;
  }

  function choose(w: Walker, act: Act, index: number, count: number): void {
    const r = w.random;
    switch (act) {
      case 'loop':
      case 'reverie': {
        // The same few points, in the same order, every loop.
        w.routeAt = (w.routeAt + 1) % w.route.length;
        w.target = w.route[w.routeAt]!;
        w.pauseUntil = elapsed + (act === 'reverie' && r() < 0.3 ? 4000 : 1500);
        return;
      }
      case 'maze':
        w.target = r() < 0.4 ? pointIn(r, SIM_AREA.rEdge - 1, SIM_AREA.rEdge) : pointIn(r, SIM_AREA.rMin, SIM_AREA.rMax);
        w.pauseUntil = elapsed + 1000 + r() * 3000;
        return;
      case 'behind':
        // Mostly standing still, staring.
        w.target = r() < 0.3 ? pointIn(r, SIM_AREA.rMin, SIM_AREA.rMax) : null;
        w.pauseUntil = elapsed + 4000 + r() * 6000;
        return;
      case 'awake': {
        const a = (index / Math.max(1, count)) * Math.PI * 2;
        w.target = { x: SIM_AREA.cx + Math.cos(a) * SIM_AREA.rGather, z: SIM_AREA.cz + Math.sin(a) * SIM_AREA.rGather };
        w.pauseUntil = elapsed + 3000;
        return;
      }
      case 'free':
        w.target = pointIn(r, SIM_AREA.rMin, SIM_AREA.rMax);
        w.pauseUntil = elapsed + 2000 + r() * 6000;
        return;
    }
  }

  function move(w: Walker, dtMs: number, index: number, count: number): void {
    const act = director.actOf(w.userId);
    if (act !== w.act) {
      w.act = act;
      // Waking up: drop whatever they were doing and head for the ring now.
      if (act === 'awake') {
        w.target = null;
        w.pauseUntil = elapsed;
      }
    }
    if (!w.target && elapsed >= w.pauseUntil) choose(w, act, index, count);
    if (elapsed >= w.animUntil && w.anim !== ANIM('walk')) w.anim = ANIM('idle');
    if (!w.target) {
      if (w.anim === ANIM('walk')) w.anim = ANIM('idle');
      return;
    }
    const dx = w.target.x - w.x;
    const dz = w.target.z - w.z;
    const dist = Math.hypot(dx, dz);
    const step = (WALK_SPEED * dtMs) / 1000;
    if (dist <= step) {
      w.x = w.target.x;
      w.z = w.target.z;
      w.target = null;
      w.anim = ANIM('idle');
      return;
    }
    w.x += (dx / dist) * step;
    w.z += (dz / dist) * step;
    // Hub yaw 0 faces -Z.
    w.yaw = Math.atan2(-dx, -dz);
    w.anim = ANIM('walk');
  }

  function add(spec: SimSpec): Walker {
    const random = seeded(Math.floor(master() * 1e9));
    const start = pointIn(random, SIM_AREA.rMin, SIM_AREA.rMax);
    const route = [0, 1, 2, 3].map(() => pointIn(random, SIM_AREA.rMin, SIM_AREA.rMax));
    return {
      spec,
      slot: nextSlot++,
      userId: simUserId(spec.id),
      x: start.x,
      z: start.z,
      yaw: random() * Math.PI * 2,
      anim: ANIM('idle'),
      animUntil: 0,
      target: null,
      pauseUntil: random() * 2000,
      route,
      routeAt: 0,
      act: 'loop',
      random,
    };
  }

  function say(lines: ReturnType<SimDirector['step']>): void {
    for (const [userId, line] of lines) {
      const w = [...walkers.values()].find((x) => x.userId === userId);
      if (!w) continue;
      options.onLine(userId, w.spec.name, line.text);
      // Scene lines get a gesture; the closing chorus a cheer.
      if (line.scene) play(w, line.text.includes('remembers') ? ANIM('cheer') : ANIM('wave'), 2000);
    }
  }

  const sims: Sims = {
    director,
    set(list) {
      const keep = list.slice(0, MAX_SIMS);
      const ids = new Set(keep.map((s) => s.id));
      const gone = [...walkers.values()].filter((w) => !ids.has(w.spec.id));
      for (const w of gone) walkers.delete(w.spec.id);
      const changed: RosterEntry[] = [];
      for (const spec of keep) {
        const w = walkers.get(spec.id);
        if (w) {
          if (w.spec.name !== spec.name || w.spec.character !== spec.character || w.spec.persona !== spec.persona) {
            w.spec = { ...spec };
            changed.push(entry(w));
          }
        } else {
          const fresh = add({ ...spec });
          walkers.set(spec.id, fresh);
          changed.push(entry(fresh));
        }
      }
      director.setCast(keep.map((s) => ({ key: simUserId(s.id), persona: s.persona })));
      fixing = true;
      world.applyRoster({ add: changed, del: gone.map((w) => w.slot) });
      fixing = false;
      pushPoses();
    },
    setSpeed(speed) {
      director.setSpeed(speed);
    },
    restart() {
      director.restart();
    },
    tick(ms) {
      let left = ms;
      while (left > 0) {
        const dt = Math.min(STEP_MS, left);
        left -= dt;
        elapsed += dt;
        storyMs += dt;
        const list = [...walkers.values()];
        list.forEach((w, i) => move(w, dt, i, list.length));
        while (storyMs >= SIM_STORY.tickMs) {
          storyMs -= SIM_STORY.tickMs;
          say(director.step());
        }
      }
      pushPoses();
    },
    positionOf(id) {
      const w = walkers.get(id);
      return w ? { x: w.x, z: w.z, anim: w.anim } : null;
    },
    act() {
      const first = [...walkers.values()][0];
      return first ? director.actOf(first.userId) : 'loop';
    },
    dispose() {
      if (timer) window.clearInterval(timer);
      unsubscribe();
      const slots = [...walkers.values()].map((w) => w.slot);
      walkers.clear();
      if (slots.length) world.applyRoster({ del: slots });
    },
  };

  let last = now();
  const timer = options.autoRun === false
    ? 0
    : window.setInterval(() => {
        const t = now();
        // A background tab throttles timers: never jump more than 2 s.
        sims.tick(Math.min(2000, t - last));
        last = t;
      }, STEP_MS);

  return sims;
}
