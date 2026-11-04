// Plaza load bots: N guest sockets join the plaza through hub.join and walk at
// 10 Hz; prints per-bot download/upload KB/s (p50/p95/max) and shard spread.
//   npm run load:plaza -- --bots 100 --seconds 60 --url http://127.0.0.1:7350 [--server-key <key>]
// Budget (docs/realtime.md): p95 down ≤ 16 KB/s, hard cap 40 KB/s, up ≤ 1 KB/s.
import { createRealtime, type HubRealtime } from '../../packages/hub-sdk/src/index.ts';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const URL_BASE = arg('url', process.env.NAKAMA_URL ?? 'http://127.0.0.1:7350').replace(/\/$/, '');
const SERVER_KEY = arg('server-key', process.env.NAKAMA_SERVER_KEY ?? 'defaultkey');
const BOTS = Number(arg('bots', '100'));
const SECONDS = Number(arg('seconds', '60'));
const MOVING = Number(arg('moving', '0.3'));

async function guestToken(): Promise<string> {
  const res = await fetch(`${URL_BASE}/v2/account/authenticate/device?create=true`, {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`${SERVER_KEY}:`)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: `load-${crypto.randomUUID()}` }),
  });
  const body = (await res.json()) as { token?: string };
  if (!body.token) throw new Error(`auth failed ${res.status}`);
  return body.token;
}

/** Counts bytes on the wire by wrapping the global WebSocket. */
function countingSocket(stats: { down: number; up: number }) {
  const Base = globalThis.WebSocket;
  return class extends Base {
    constructor(url: string) {
      super(url);
      this.addEventListener('message', (e) => {
        stats.down += typeof e.data === 'string' ? Buffer.byteLength(e.data) : (e.data as ArrayBuffer).byteLength ?? 0;
      });
    }
    send(data: string) {
      stats.up += Buffer.byteLength(data);
      super.send(data);
    }
  } as unknown as new (url: string) => WebSocket;
}

interface Bot { rt: HubRealtime; stats: { down: number; up: number }; shard: number; timer?: ReturnType<typeof setInterval> }

function pct(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

const bots: Bot[] = [];
console.log(`starting ${BOTS} bots against ${URL_BASE}`);
for (let i = 0; i < BOTS; i += 1) {
  const stats = { down: 0, up: 0 };
  const token = await guestToken();
  const rt = createRealtime({ serverUrl: URL_BASE, getToken: () => token, WebSocketImpl: countingSocket(stats), reconnect: false });
  await rt.connect();
  const placed = await rt.rpc<{ matchId: string; shard: number }>('hub.join', {});
  const match = await rt.joinMatch({ matchId: placed.matchId });
  const bot: Bot = { rt, stats, shard: placed.shard };
  let a = Math.random() * Math.PI * 2;
  const r = 5 + Math.random() * 30;
  const moving = Math.random() < MOVING;
  let t = 0;
  bot.timer = setInterval(() => {
    t += 1;
    if (moving) a += 0.02;
    // Moving bots send every tick; idle bots only the 1 Hz keepalive.
    if (!moving && t % 10 !== 0) return;
    match.send(1, [Math.round(Math.cos(a) * r * 100), 178, Math.round((30 + Math.sin(a) * r) * 100), Math.round(((a % (Math.PI * 2)) / (Math.PI * 2)) * 256) & 255, moving ? 1 : 0]);
  }, 100);
  bots.push(bot);
}
console.log('all bots in; measuring');
for (const b of bots) {
  b.stats.down = 0;
  b.stats.up = 0;
}
await new Promise((resolve) => setTimeout(resolve, SECONDS * 1000));
const down = bots.map((b) => b.stats.down / 1024 / SECONDS);
const up = bots.map((b) => b.stats.up / 1024 / SECONDS);
const shards = new Map<number, number>();
for (const b of bots) shards.set(b.shard, (shards.get(b.shard) ?? 0) + 1);
console.log(`down KB/s p50 ${pct(down, 50).toFixed(2)} p95 ${pct(down, 95).toFixed(2)} max ${Math.max(...down).toFixed(2)}`);
console.log(`up   KB/s p50 ${pct(up, 50).toFixed(2)} p95 ${pct(up, 95).toFixed(2)} max ${Math.max(...up).toFixed(2)}`);
console.log(`shards ${[...shards.entries()].map(([s, n]) => `${s}:${n}`).join(' ')}`);
for (const b of bots) {
  clearInterval(b.timer);
  b.rt.disconnect();
}
process.exit(0);
