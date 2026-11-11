// Feedback transport and limits (src/feedback.ts). The window itself needs a browser and is
// exercised from apps/hub; here: the mock SDK round trip, standalone refusal, and meta trimming.
import assert from 'node:assert/strict';
import { FEEDBACK_META_MAX, HubSdkError, createHubSdk, feedbackTransportFromSdk, fitFeedbackMeta, installFeedback, mintMockTicket, type FeedbackSubmission, type HubSdk, type HubSdkEnv } from '../src/index';

function memory(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

const note: FeedbackSubmission = { categories: ['too_hard'], note: 'boss two', image: '', clientTime: '2026-11-11T10:00:00.000Z', source: 'manual', meta: { level: 'L3' } };

const NOW = 1_800_000_000_000;
function env(hash: string, local = memory()): HubSdkEnv {
  let h = hash;
  return { hubUrl: '/hub/', local, session: memory(), now: () => NOW, readHash: () => h, writeHash: (next) => { h = next; }, assign: () => {}, releasePointer: () => {}, clearBeforeUnload: () => {} };
}

// Standalone: no session, so no feedback.
{
  const transport = feedbackTransportFromSdk(createHubSdk(env('')));
  assert.deepEqual(await transport.access(), { ok: false, reason: 'standalone' });
  await assert.rejects(transport.submit(note), (e: unknown) => e instanceof HubSdkError && e.code === 'standalone');
}

// Mock SDK with a redeemed ticket: notes get ids and keep the player name.
{
  const local = memory();
  const ticket = await mintMockTicket({ game: 'nobu', playerId: 'player-1', ranked: false, now: NOW, ttlSeconds: 60 });
  const sdk = createHubSdk(env(`#t=${ticket}`, local));
  await sdk.init('nobu');
  const transport = feedbackTransportFromSdk(sdk);
  assert.deepEqual(await transport.access(), { ok: true, username: 'player-1' });
  assert.deepEqual(await transport.submit(note), { id: 'MOCK-0001' });
  assert.deepEqual(await transport.submit({ ...note, image: 'data:image/jpeg;base64,AAAA' }), { id: 'MOCK-0002' });
  await assert.rejects(transport.submit({ ...note, categories: [], note: ' ' }), (e: unknown) => e instanceof HubSdkError && e.code === 'empty');
  const stored = JSON.parse(local.getItem('hub:feedback:nobu') ?? '[]') as { id: string; username: string; image: string }[];
  assert.deepEqual(stored.map((n) => [n.id, n.username, n.image]), [['MOCK-0001', 'player-1', ''], ['MOCK-0002', 'player-1', '(image)']]);
}

// An SDK double without the optional methods behaves like standalone.
{
  const transport = feedbackTransportFromSdk({} as HubSdk);
  assert.deepEqual(await transport.access(), { ok: false, reason: 'standalone' });
  await assert.rejects(transport.submit(note), (e: unknown) => e instanceof HubSdkError && e.code === 'standalone');
}

// Meta is trimmed under the server cap, dropping the bulkiest parts first.
{
  const big = {
    level: 'L3',
    position: { x: 1, y: 2 },
    breadcrumbs: Array.from({ length: 24 }, (_, i) => ({ t: i, type: 'event', data: { text: 'x'.repeat(600) } })),
    errors: Array.from({ length: 10 }, (_, i) => ({ message: `e${i}`, stack: 's'.repeat(600) })),
    extra: { blob: 'y'.repeat(9000) },
  };
  const fitted = fitFeedbackMeta(big);
  assert.ok(JSON.stringify(fitted).length <= FEEDBACK_META_MAX);
  assert.equal(fitted.level, 'L3');
  assert.deepEqual(fitted.position, { x: 1, y: 2 });
  assert.deepEqual(fitFeedbackMeta({ level: 'a' }), { level: 'a' });
}

// Outside a browser the installer is a no-op.
{
  const handle = installFeedback({ title: 'Test', transport: feedbackTransportFromSdk({} as HubSdk) });
  handle.breadcrumb('x');
  handle.open();
  assert.equal(handle.isOpen(), false);
  handle.dispose();
}

console.log('feedback sdk ok');
