// Hub item gates. checkGate is fail-closed. profile.get carries unlocked bools only.
// The live grant, pending medal, and init() contract are in server/test/dup/hub_gate.ts.
import assert from 'node:assert/strict';
import { loadModule, plain } from './harness';

const USER = '11111111-1111-4111-8111-111111111111';
const HATCHERY = [
  'arc_the_remote',
  'duel_time_spirit_potion',
  'pb_space_goggles',
  'hub_v_coin',
  'hub_life_medal',
  'quantum_cell',
] as const;

interface GateFixture {
  gateId: string;
  actionType: string;
  target: string;
  requireAll: boolean;
  required: string[];
  hint: string | null;
  enabled: boolean;
}

interface GateCheck {
  ok: boolean;
  missing: string[];
}

interface ClientGate {
  gateId: string;
  unlocked: boolean;
  actionType: string;
  target: string | null;
  lockedHintPool: string | null;
}

interface ProfileBody {
  items?: string[];
  gates?: ClientGate[];
  [key: string]: unknown;
}

const mod = loadModule();
const HubGate = mod.global.HubGate as {
  GATE_LOCKED: string;
  checkGate(nk: unknown, userId: string, gateId: string): GateCheck;
  forClient(nk: unknown, userId: string): { items: string[]; gates: ClientGate[] };
  resolveTarget(actionType: string, target: string): string | null;
};
const HubSchema = mod.global.HubSchema as { all(): { id: string; statements: string[] }[] };

function gate(row: Omit<GateFixture, 'requireAll' | 'hint' | 'enabled'> & Partial<GateFixture>): GateFixture {
  return {
    requireAll: true,
    hint: null,
    enabled: true,
    ...row,
  };
}

const SEEDED: GateFixture[] = [
  gate({ gateId: 'hub_arcade_vcoin_game', actionType: 'session', target: 'vcoin', required: ['hub_v_coin'] }),
  gate({ gateId: 'hub_hatchery', actionType: 'portal', target: 'hatchery', required: [...HATCHERY] }),
  gate({ gateId: 'hub_quantum_door', actionType: 'zone', target: 'quantum_door', required: ['quantum_cell'] }),
];

type Mode = 'ok' | 'throw' | 'empty' | 'bad';
const world: { owned: string[]; gates: GateFixture[]; mode: Mode } = {
  owned: [],
  gates: SEEDED.map((row) => ({ ...row, required: [...row.required] })),
  mode: 'ok',
};

function answer(sql: string): Record<string, unknown>[] {
  if (sql.includes('owned_item_ids') || sql.includes('FROM game.hub_gate')) {
    if (world.mode === 'throw') throw new Error('db down');
    if (world.mode === 'empty') return [];
    if (world.mode === 'bad') return [{ result: '{not json' }];
    return [{ result: JSON.stringify({ owned: world.owned, gates: world.gates }) }];
  }
  if (sql.includes('extract(epoch')) return [{ ms: '1700000000000' }];
  if (sql.includes('verse_wallet')) return [{ result: JSON.stringify({ balance: 0, earned: [] }) }];
  if (sql.includes('to_char')) return [{ result: '2026-11-05T00:00:00Z' }];
  if (sql.includes('count(*)')) return [{ result: '0' }];
  if (sql.includes('AS result')) return [{ result: '[]' }];
  return [];
}

mod.nk.onSql(() => true, (_args, sql) => answer(sql));

function setAccount(email: string | null): void {
  if (email === null) mod.nk.accounts.delete(USER);
  else mod.nk.accounts.set(USER, { email, user: { userId: USER, username: 'player' } });
}

function check(gateId: string, userId = USER): GateCheck {
  return plain(HubGate.checkGate(mod.nk, userId, gateId));
}

function profile(): ProfileBody {
  return mod.call<ProfileBody>('profile.get', { userId: USER, vars: { scope: 'hub' } }, {});
}

const FORBIDDEN_KEYS = new Set([
  'missing',
  'required',
  'requiredItemIds',
  'required_item_ids',
  'requiredItems',
  'missingItems',
]);

function assertNoLeak(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoLeak(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    assert.equal(FORBIDDEN_KEYS.has(key), false, `client payload has ${path}.${key}`);
    assertNoLeak(child, `${path}.${key}`);
  }
}

function migration(id: string): string {
  const found = HubSchema.all().find((row) => row.id === id);
  assert.ok(found, `migration ${id} is not registered`);
  return found.statements.join('\n');
}

function use(owned: string[], gates: GateFixture[] = SEEDED): void {
  world.mode = 'ok';
  world.owned = [...owned];
  world.gates = gates.map((row) => ({ ...row, required: [...row.required] }));
  setAccount('player@example.com');
}

// Registered migrations. 0036 stays free. 0037 still calls the relic claim and the day cap.
{
  const ids = plain(HubSchema.all().map((row) => row.id));
  assert.ok(ids.includes('0034_hub_gate'));
  assert.ok(ids.includes('0035_hub_v_coin'));
  assert.ok(ids.includes('0037_hub_life_medal'));
  assert.equal(ids.some((id) => id.startsWith('0036_')), false);
  const gateSql = migration('0034_hub_gate');
  assert.match(gateSql, /'hub_arcade_vcoin_game', 'session', 'vcoin', ARRAY\['hub_v_coin'\]/);
  assert.match(gateSql, /'hub_quantum_door', 'zone', 'quantum_door', ARRAY\['quantum_cell'\]/);
  assert.match(gateSql, /'hub_hatchery'/);
  for (const id of HATCHERY) assert.match(gateSql, new RegExp(id));
  assert.equal(gateSql.includes('hub_arcade_v_cabinet'), false);
  const coin = migration('0035_hub_v_coin');
  assert.match(coin, /'peoples-bitcoin', 'pb\.quest_complete', 'hub_v_coin', '\{"questId":"quest_way_out"\}'/);
  assert.match(coin, /pb_space_goggles/);
  assert.match(coin, /claim_event_relic/);
  assert.match(coin, /boss:' \|\| p_game_id/);
  assert.equal(coin.includes('hpos10i.boss_defeated'), false);
  const medal = migration('0037_hub_life_medal');
  assert.match(medal, /'hpos10i', 'hpos10i\.boss_defeated', 'hub_life_medal', '\{"boss":"deathbot"\}'/);
  assert.match(medal, /grant_hold = EXCLUDED\.grant_hold/);
  assert.match(medal, /item_owned_pending/);
  assert.match(medal, /pb_space_goggles/);
  assert.match(medal, /claim_event_relic/);
  assert.match(medal, /boss:' \|\| p_game_id/);
  assert.match(medal, /hpos10i\.boss_defeated/);
  assert.equal(medal.includes('SET grant_hold = false'), false);
  const hold = migration('0033_hold_client_relic_grants');
  for (const fragment of [
    'tidebreaker_belt',
    'hpos10i_core',
    'genesis_shard',
    'pet_honk_sproto',
    'pet_spiral_sproto',
    'pet_moon_sproto',
    'pet_sproto_pup',
    'promote_pending_grant',
    'item_owned_pending',
    'relic_claim_pending',
  ]) {
    assert.ok(hold.includes(fragment), `0033 dropped ${fragment}`);
  }
}

assert.equal(HubGate.GATE_LOCKED, 'GATE_LOCKED');
assert.equal(HubGate.resolveTarget('portal', 'hatchery'), 'hatchery');
assert.equal(HubGate.resolveTarget('portal', 'https://evil.example/hatchery'), null);
assert.equal(HubGate.resolveTarget('portal', 'hatchery/extra'), null);
assert.equal(HubGate.resolveTarget('zone', 'quantum_door'), 'quantum_door');
assert.equal(HubGate.resolveTarget('session', 'vcoin'), 'vcoin');
assert.equal(HubGate.resolveTarget('interact', 'hatchery'), null);
assert.equal(HubGate.resolveTarget('portal', ''), null);

// Fail-closed: unknown id, missing row, empty read, bad payload, db error, guest lookup error.
{
  use([...HATCHERY]);
  assert.deepEqual(check('hub_does_not_exist'), { ok: false, missing: [] });
  assert.deepEqual(check('hub_arcade_v_cabinet'), { ok: false, missing: [] });
  assert.deepEqual(check('v-cabinet'), { ok: false, missing: [] });
  assert.deepEqual(check('hub_hatchery', 'not-a-uuid'), { ok: false, missing: [] });
  assert.deepEqual(check('hub_hatchery', ''), { ok: false, missing: [] });
  assert.deepEqual(check('x'.repeat(81)), { ok: false, missing: [] });

  world.mode = 'empty';
  assert.deepEqual(check('hub_hatchery'), { ok: false, missing: [] });
  world.mode = 'bad';
  assert.deepEqual(check('hub_hatchery'), { ok: false, missing: [] });
  world.mode = 'throw';
  assert.deepEqual(check('hub_hatchery'), { ok: false, missing: [] });
  const locked = profile();
  assert.deepEqual(locked.items, []);
  assert.deepEqual(locked.gates, []);
  assertNoLeak(locked);
  world.mode = 'ok';

  const original = mod.nk.accountGetId;
  mod.nk.accountGetId = () => {
    throw new Error('account down');
  };
  try {
    assert.deepEqual(check('hub_hatchery'), { ok: false, missing: [] });
  } finally {
    mod.nk.accountGetId = original;
  }
}

// Disabled, empty requirements, and a URL target stay locked and do not list items.
{
  use([...HATCHERY], SEEDED.map((row) => (row.gateId === 'hub_hatchery' ? { ...row, enabled: false } : row)));
  assert.deepEqual(check('hub_hatchery'), { ok: false, missing: [] });
  const hidden = profile();
  assert.equal(hidden.gates?.some((row) => row.gateId === 'hub_hatchery'), false);
  assertNoLeak(hidden);

  use([...HATCHERY], [gate({ gateId: 'qa_empty', actionType: 'session', target: 'vcoin', required: [] })]);
  assert.deepEqual(check('qa_empty'), { ok: false, missing: [] });

  use([...HATCHERY], [gate({
    gateId: 'qa_url',
    actionType: 'portal',
    target: 'https://evil.example/hatchery',
    required: ['hub_v_coin'],
  })]);
  assert.deepEqual(check('qa_url'), { ok: false, missing: [] });
  const urlProfile = profile();
  assert.equal(urlProfile.gates?.[0]?.target, null);
  assert.equal(urlProfile.gates?.[0]?.unlocked, false);
  assert.equal(JSON.stringify(urlProfile).includes('https://'), false);
  assertNoLeak(urlProfile);
}

// Guest and starters do not open the hatchery. A claimed account with all six does.
{
  use([...HATCHERY, 'duel_staff_sproto']);
  setAccount(null);
  assert.deepEqual(check('hub_hatchery'), { ok: false, missing: [] });
  assert.deepEqual(check('hub_arcade_vcoin_game'), { ok: false, missing: [] });
  assert.deepEqual(check('hub_quantum_door'), { ok: false, missing: [] });
  const guest = profile();
  assert.ok(guest.gates?.every((row) => row.unlocked === false));
  assert.deepEqual(guest.items, [...HATCHERY, 'duel_staff_sproto'].sort());
  assertNoLeak(guest);

  use(['duel_staff_sproto']);
  const starters = check('hub_hatchery');
  assert.equal(starters.ok, false);
  assert.deepEqual(starters.missing, [...HATCHERY].sort());
  const starterProfile = profile();
  assert.ok(starterProfile.gates?.every((row) => row.unlocked === false));
  assertNoLeak(starterProfile);

  use([...HATCHERY]);
  assert.deepEqual(check('hub_hatchery'), { ok: true, missing: [] });
  assert.deepEqual(check('hub_arcade_vcoin_game'), { ok: true, missing: [] });
  assert.deepEqual(check('hub_quantum_door'), { ok: true, missing: [] });
  const open = profile();
  assert.ok(open.gates?.every((row) => row.unlocked === true));
  assertNoLeak(open);
}

// Each five-of-six stays closed. Arcade and the quantum door follow their own item.
{
  for (const omit of HATCHERY) {
    use(HATCHERY.filter((id) => id !== omit));
    const hatch = check('hub_hatchery');
    assert.equal(hatch.ok, false, omit);
    assert.deepEqual(hatch.missing, [omit]);
    const body = profile();
    assert.equal(body.gates?.find((row) => row.gateId === 'hub_hatchery')?.unlocked, false, omit);
    assert.equal(body.gates?.find((row) => row.gateId === 'hub_arcade_vcoin_game')?.unlocked, omit !== 'hub_v_coin', omit);
    assert.equal(body.gates?.find((row) => row.gateId === 'hub_quantum_door')?.unlocked, omit !== 'quantum_cell', omit);
    assert.equal(body.items?.includes(omit), false, omit);
    assertNoLeak(body);
    const shown = plain(HubGate.forClient(mod.nk, USER));
    assert.deepEqual(body.items, shown.items);
    assert.deepEqual(body.gates, shown.gates);
    for (const row of body.gates ?? []) {
      assert.equal(row.unlocked, check(row.gateId).ok, `${omit} ${row.gateId}`);
      assert.deepEqual(Object.keys(row).sort(), ['actionType', 'gateId', 'lockedHintPool', 'target', 'unlocked']);
    }
  }
}

// require_all false: one of two opens, none stays closed. The check itself only reads.
{
  const anyOne = gate({
    gateId: 'qa_any_one',
    actionType: 'session',
    target: 'vcoin',
    requireAll: false,
    required: ['qa_alpha', 'qa_beta'],
  });
  use(['qa_alpha'], [anyOne]);
  assert.deepEqual(check('qa_any_one'), { ok: true, missing: [] });
  use([], [anyOne]);
  const none = check('qa_any_one');
  assert.equal(none.ok, false);
  assert.deepEqual(none.missing, ['qa_alpha', 'qa_beta']);
  use(['qa_alpha', 'qa_beta'], [anyOne]);
  assert.equal(check('qa_any_one').ok, true);

  use([...HATCHERY]);
  const before = mod.nk.sqlCalls.length;
  check('hub_hatchery');
  plain(HubGate.forClient(mod.nk, USER));
  const added = mod.nk.sqlCalls.slice(before);
  assert.ok(added.length >= 2);
  assert.ok(added.every((call) => call.kind === 'query'));
  assert.ok(added.every((call) => !/\b(insert|update|delete|grant|revoke)\b/i.test(call.sql)));
}

console.log('hub gate tests ok');
