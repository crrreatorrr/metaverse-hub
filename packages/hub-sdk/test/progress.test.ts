import assert from 'node:assert/strict';
import {
  HubSdkError,
  SAVE_MAX_BYTES,
  createProgressStore,
  hubVisitStarting,
  memoryKeyValue,
  type KeyValue,
  type ProgressCloud,
  type ProgressModel,
  type SaveResult,
} from '../src/index';

type Save = { cleared: string[]; best: number };

const model: ProgressModel<Save> = {
  empty: () => ({ cleared: [], best: 0 }),
  normalize(raw) {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Save>;
    return {
      cleared: Array.isArray(r.cleared) ? [...new Set(r.cleared.filter((x): x is string => typeof x === 'string'))].sort() : [],
      best: typeof r.best === 'number' && Number.isFinite(r.best) ? r.best : 0,
    };
  },
  merge: (a, b) => ({ cleared: [...new Set([...a.cleared, ...b.cleared])].sort(), best: Math.max(a.best, b.best) }),
};

/** One player's cloud save on a fake server shared by every "device". */
class FakeServer {
  saves = new Map<string, SaveResult>();
  writes = 0;
  failNext = 0;
  clock = 1000;
  for(playerId: string): ProgressCloud {
    return {
      loadSave: async () => {
        if (this.failNext > 0) {
          this.failNext -= 1;
          throw new HubSdkError('network', 'offline');
        }
        return this.saves.get(playerId) ?? { data: null, updatedAt: 0 };
      },
      writeSave: async (data) => {
        this.writes += 1;
        const saved = { data: JSON.parse(JSON.stringify(data)) as Record<string, unknown>, updatedAt: ++this.clock };
        this.saves.set(playerId, saved);
        return saved;
      },
    };
  }
}

const clear = (id: string) => (s: Save): Save => ({ ...s, cleared: [...s.cleared, id] });
const cleared = (s: { get(): Save }) => s.get().cleared.join(',');
const store = (storage: KeyValue | null, extra: object = {}) =>
  createProgressStore({ key: 'game-progress', model, storage, pushDelayMs: 0, retryDelayMs: 60_000, ...extra });

async function run(): Promise<void> {
  // Play outside the hub stays in the device copy and survives a reload.
  {
    const kv = memoryKeyValue();
    const a = store(kv);
    assert.equal(a.owner().kind, 'device');
    a.update(clear('l1'));
    assert.equal(cleared(store(kv)), 'l1');
    assert.equal(kv.getItem('game-progress@p1'), null);
  }

  // Device progress never reaches an account, and accounts never see each other's progress.
  {
    const kv = memoryKeyValue();
    const server = new FakeServer();
    const s = store(kv);
    s.update(clear('device-only'));
    await s.attach(server.for('alice'), 'alice');
    assert.deepEqual(s.owner(), { kind: 'account', playerId: 'alice' });
    assert.equal(cleared(s), '');
    s.update(clear('alice-1'));
    await s.flush();
    assert.deepEqual(server.saves.get('alice')?.data, { cleared: ['alice-1'], best: 0 });

    await s.attach(server.for('bob'), 'bob');
    assert.equal(cleared(s), '', 'a new account starts empty on a device another account used');
    assert.equal(server.saves.has('bob'), false, 'an empty account writes no cloud save');

    s.release();
    assert.equal(cleared(s), 'device-only');
    await s.attach(server.for('alice'), 'alice');
    assert.equal(cleared(s), 'alice-1');
  }

  // Progress follows the account to another device, and both devices' wins are kept.
  {
    const server = new FakeServer();
    const laptop = store(memoryKeyValue());
    const phone = store(memoryKeyValue());
    await laptop.attach(server.for('alice'), 'alice');
    laptop.update(clear('l1'));
    await laptop.flush();

    await phone.attach(server.for('alice'), 'alice');
    assert.equal(cleared(phone), 'l1', 'a second device loads the cloud save');
    phone.update(clear('l2'));
    phone.update((s) => ({ ...s, best: 50 }));
    await phone.flush();

    // The laptop earned l3 offline, without seeing the phone's l2.
    laptop.update(clear('l3'));
    await laptop.flush();
    assert.equal(cleared(laptop), 'l1,l2,l3');
    assert.deepEqual(server.saves.get('alice')?.data, { cleared: ['l1', 'l2', 'l3'], best: 50 });
    await phone.attach(server.for('alice'), 'alice');
    assert.equal(cleared(phone), 'l1,l2,l3');
  }

  // A push that overlapped another device's write is repaired by the next push from the device that lost.
  {
    const server = new FakeServer();
    const a = store(memoryKeyValue());
    const b = store(memoryKeyValue());
    await a.attach(server.for('p'), 'p');
    await b.attach(server.for('p'), 'p');
    a.update(clear('a1'));
    b.update(clear('b1'));
    await Promise.all([a.flush(), b.flush()]);
    await a.flush();
    await b.flush();
    const both = (server.saves.get('p')?.data as Save).cleared.join(',');
    assert.equal(both, 'a1,b1');
  }

  // Progress only advances: an update that drops something does not erase it.
  {
    const s = store(memoryKeyValue());
    s.update(clear('l1'));
    s.update(() => ({ cleared: [], best: 0 }));
    assert.equal(cleared(s), 'l1');
  }

  // A hub visit that is still starting keeps progress in memory, then gives it to whoever owns the visit.
  {
    const kv = memoryKeyValue();
    const server = new FakeServer();
    const s = store(kv);
    s.update(clear('device'));
    s.hold();
    assert.equal(s.owner().kind, 'pending');
    assert.equal(cleared(s), '', 'a starting visit does not show device progress');
    s.update(clear('early'));
    assert.equal(cleared(store(kv)), 'device', 'pending progress is not written to the device copy');
    await s.attach(server.for('alice'), 'alice');
    assert.equal(cleared(s), 'early');
    assert.deepEqual((server.saves.get('alice')?.data as Save).cleared, ['early']);

    s.hold();
    s.update(clear('standalone'));
    s.release();
    assert.equal(cleared(s), 'device,standalone');
  }

  // Offline: the push fails, is marked unsynced, and goes out on the next attach after a reload.
  {
    const kv = memoryKeyValue();
    const server = new FakeServer();
    const errors: unknown[] = [];
    const s = store(kv, { onError: (e: unknown) => errors.push(e) });
    await s.attach(server.for('alice'), 'alice');
    server.failNext = 1;
    s.update(clear('offline-win'));
    await s.flush();
    assert.equal(s.sync(), 'offline');
    assert.equal(errors.length, 1);
    assert.equal(kv.getItem('game-progress@alice:unsynced'), '1');
    assert.equal(server.saves.has('alice'), false);

    const reloaded = store(kv);
    await reloaded.attach(server.for('alice'), 'alice');
    assert.equal(reloaded.sync(), 'synced');
    assert.deepEqual((server.saves.get('alice')?.data as Save).cleared, ['offline-win']);
    assert.equal(kv.getItem('game-progress@alice:unsynced'), null);
    s.release(); // stops the retry timer
  }

  // A save over the limit stops syncing with status error and is still kept on the device.
  {
    const server = new FakeServer();
    const s = store(memoryKeyValue());
    await s.attach(server.for('alice'), 'alice');
    s.update(clear('x'.repeat(SAVE_MAX_BYTES)));
    await s.flush();
    assert.equal(s.sync(), 'error');
    assert.equal(cleared(s).length, SAVE_MAX_BYTES);
    s.release();
  }

  // toCloud / fromCloud carry a compact form.
  {
    const server = new FakeServer();
    const compact = createProgressStore({
      key: 'c',
      storage: memoryKeyValue(),
      pushDelayMs: 0,
      model: { ...model, toCloud: (v) => ({ c: v.cleared.join('|'), b: v.best }), fromCloud: (d) => ({ cleared: String(d.c || '').split('|').filter(Boolean), best: d.b }) },
    });
    await compact.attach(server.for('p'), 'p');
    compact.update(clear('l1'));
    compact.update(clear('l2'));
    await compact.flush();
    assert.deepEqual(server.saves.get('p')?.data, { c: 'l1|l2', b: 0 });
    const other = createProgressStore({ key: 'c', storage: memoryKeyValue(), model: { ...model, fromCloud: (d) => ({ cleared: String(d.c).split('|'), best: d.b }) } });
    await other.attach(server.for('p'), 'p');
    assert.equal(cleared(other), 'l1,l2');
  }

  // Switching account while a push is in flight never writes the old account's progress to the new one.
  {
    const server = new FakeServer();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: ProgressCloud = {
      loadSave: async () => {
        await gate;
        return { data: { cleared: ['from-alice-cloud'], best: 0 }, updatedAt: 1 };
      },
      writeSave: async (data) => ({ data, updatedAt: 2 }),
    };
    const s = store(memoryKeyValue());
    const pending = s.attach(slow, 'alice');
    const bob = s.attach(server.for('bob'), 'bob');
    release();
    await pending;
    await bob;
    assert.equal(cleared(s), '');
    assert.deepEqual(s.owner(), { kind: 'account', playerId: 'bob' });
  }

  // Other tabs: refresh picks up their progress; watches names only the current copy's key.
  {
    const kv = memoryKeyValue();
    const tab1 = store(kv);
    const tab2 = store(kv);
    tab2.update(clear('t2'));
    assert.ok(tab1.watches('game-progress'));
    assert.ok(!tab1.watches('game-progress@alice'));
    tab1.refresh();
    assert.equal(cleared(tab1), 't2');
    tab1.update(clear('t1'));
    assert.equal(cleared(store(kv)), 't1,t2');
  }

  // Legacy keys merge into the device copy only.
  {
    const kv = memoryKeyValue();
    kv.setItem('old-key', JSON.stringify({ cleared: ['legacy'] }));
    const s = store(kv, { readLegacy: (k: KeyValue) => JSON.parse(k.getItem('old-key') || 'null') });
    assert.equal(cleared(s), 'legacy');
    await s.attach(new FakeServer().for('alice'), 'alice');
    assert.equal(cleared(s), '');
  }

  // No storage: progress lasts for the visit and reports it.
  {
    const s = store(null);
    s.update(clear('l1'));
    assert.equal(s.persistent(), false);
    assert.equal(cleared(s), 'l1');
  }

  // hubVisitStarting: a portal ticket or a live session for this game.
  {
    const session = memoryKeyValue();
    assert.equal(hubVisitStarting('sproto-fighter', '', session), false);
    assert.equal(hubVisitStarting('sproto-fighter', '#t=abc', session), true);
    session.setItem('hub:nobu:session', '{}');
    assert.equal(hubVisitStarting('sproto-fighter', '', session), false);
    session.setItem('hub:sproto-fighter:session', '{}');
    assert.equal(hubVisitStarting('sproto-fighter', '', session), true);
  }

  console.log('progress tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
