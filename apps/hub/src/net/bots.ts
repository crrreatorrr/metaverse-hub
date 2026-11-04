// Dev only (?bots=N): fake remotes fed straight into the RemoteWorld, so the
// renderer can be profiled at 100 players without a server. Never imported in
// production (main.ts guards the dynamic import with import.meta.env.DEV).
import { encodePose, type PoseRow, type RosterEntry } from './protocol';
import type { RemoteWorld } from './remoteWorld';

const CHARACTERS = ['wizard', 'sahil', 'agent', 'tinubu', 'broccoli'];

export function startBots(world: RemoteWorld, count: number, now: () => number = () => performance.now()): () => void {
  const n = Math.max(1, Math.min(99, Math.floor(count)));
  const roster: RosterEntry[] = [];
  const seeds: { r: number; a: number; w: number; cx: number; cz: number }[] = [];
  for (let i = 0; i < n; i += 1) {
    roster.push({ s: i + 1, u: `bot-${i}`, n: `bot${i}`, c: CHARACTERS[i % CHARACTERS.length]!, st: 'sproto', pt: '', r: i % 5 === 0 ? ['cones_tip'] : [], g: '', away: false });
    seeds.push({ r: 4 + (i % 9) * 3.5, a: (i / n) * Math.PI * 2, w: 0.25 + (i % 7) * 0.05, cx: 0, cz: 30 });
  }
  const rows = (t: number): PoseRow[] =>
    seeds.map((b, i) => {
      const a = b.a + t * b.w;
      const x = b.cx + Math.cos(a) * b.r;
      const z = b.cz + Math.sin(a) * b.r;
      const pose = encodePose(x, 1.775, z, -a, i % 4 === 0 ? 0 : 1);
      return [i + 1, ...pose] as PoseRow;
    });
  world.applySnapshot({ t: 0, you: 0, shard: 0, roster, p: rows(0) }, now());
  const timer = window.setInterval(() => {
    world.applyDelta({ t: 0, p: rows(now() / 1000) }, now());
  }, 100);
  return () => window.clearInterval(timer);
}
