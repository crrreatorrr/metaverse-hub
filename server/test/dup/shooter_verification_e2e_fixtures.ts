// Trusted CI fixtures only. Public callers never supply a seed or private state.
// These helpers issue/append/finish/observe; they NEVER replay or submit results.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import type { GameLogin } from './harness';

type Obj = Record<string, unknown>;
export type CorpusCase = Readonly<{
  id: string; boss: string; seed: number; frames: number; framesTextBytes: number;
  actions: number; fixtureSha256: string; legacyInputEnvelopeSha256: string;
  legacyObservation: Obj; requiredExecution: string[];
}>;
type CorpusIndex = { schema: number; corpusSourceCommit: string; approvedManifest: Obj; cases: CorpusCase[] };
export type FrozenTrace = Readonly<{ definition: CorpusCase; frames: string; actions: readonly (readonly number[])[] }>;
export type PublicBatch = Readonly<{ protocol: 2; runId: string; sequence: number; tick0: number; n: number; frames: string; actions: readonly (readonly number[])[] }>;
export type TrustedActor = Readonly<{
  login: GameLogin; runId: string; key: string; issuance: Obj; issueAck: Obj; trace: FrozenTrace;
  fixture: Readonly<{ kind: 'trusted_ci_server_fixture'; ageMs: number; issuedAt: string; uploadDeadline: string }>;
}>;
const SHA = '797029721efe6124b718d84349cd255cd52529d3105b2da1d33e97da8d734aa9';
const SOURCE = '05f7a0a245af921fc65a99588564175c19658e38';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const index = JSON.parse(readFileSync(new URL('../fixtures/shooter-integration-corpus.json', import.meta.url), 'utf8')) as CorpusIndex;
assert.equal(index.schema, 1);
assert.equal(index.corpusSourceCommit, SOURCE);
assert.equal(index.approvedManifest.sha256, SHA);
assert.equal(index.approvedManifest.sourceCommit, SOURCE);
assert.equal(index.cases.length, 12);
export const integrationManifest = Object.freeze({ ...index.approvedManifest });
export const integrationCases = Object.freeze(index.cases.map(row => Object.freeze(row)));
const hash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
const literal = (value: string): string => "'" + value.replace(/'/g, "''") + "'";
const object = (value: unknown): Obj => value as Obj;

function fixtureGuard(): void {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'trusted SQL fixture setup runs only in GitHub Actions');
  assert.ok(['integration', 'benchmark'].includes(process.env.HUB_SHOOTER_FIXTURE || ''), 'explicit disposable fixture profile required');
}
export function loadFrozenTrace(caseId: string): FrozenTrace {
  const definition = integrationCases.find(row => row.id === caseId);
  assert.ok(definition, 'case must belong to the reviewed twelve-trace corpus');
  const directory = process.env.SHOOTER_CORPUS_DIR || process.env.SHOOTER_CORPUS;
  assert.ok(directory, 'explicit approved-source corpus checkout required');
  const bytes = readFileSync(join(directory, caseId + '.json'));
  assert.ok(bytes.byteLength <= 4194304, 'bounded fixture file');
  assert.equal(hash(bytes), definition.fixtureSha256, 'execute stored approved bytes, never regenerated bot choices');
  const sample = object(JSON.parse(bytes.toString('utf8')));
  assert.equal(sample.inputSha256, definition.legacyInputEnvelopeSha256);
  assert.equal(object(sample.issuance).seed, definition.seed);
  assert.equal(object(sample.issuance).canonicalBoss, definition.boss);
  const segments = object(sample.log).segments as Obj[];
  assert.ok(Array.isArray(segments) && segments.length > 0 && segments.length <= 40);
  let cursor = 0;
  const texts: string[] = [], actions: (readonly number[])[] = [];
  for (const segment of segments) {
    assert.equal(segment.tick0, cursor);
    assert.ok(Number.isSafeInteger(segment.n) && Number(segment.n) > 0);
    const n = Number(segment.n), text = String(segment.frames);
    assert.equal(text.length, n * 16);
    assert.match(text, /^[A-Za-z0-9+/]+$/);
    assert.equal(Buffer.from(text, 'base64').toString('base64'), text);
    const values = segment.actions as number[][];
    assert.ok(Array.isArray(values));
    let previous = -1;
    for (const action of values) {
      assert.equal(action.length, 2);
      assert.ok(Number.isSafeInteger(action[0]) && action[0]! > previous && action[0]! < n);
      assert.equal(action[1], 1);
      actions.push(Object.freeze([cursor + action[0]!, 1])); previous = action[0]!;
    }
    texts.push(text); cursor += n;
  }
  const frames = texts.join('');
  assert.equal(cursor, definition.frames);
  assert.equal(Buffer.byteLength(frames), definition.framesTextBytes);
  assert.equal(actions.length, definition.actions);
  return Object.freeze({ definition, frames, actions: Object.freeze(actions) });
}

let builder: vm.Context | null = null;
function buildCanonical(input: Obj): Obj {
  if (!builder) {
    const bytes = readFileSync(new URL(`../../../services/shooter-verifier/artifacts/${SHA}/shooter-sim.js`, import.meta.url));
    assert.equal(hash(bytes), SHA);
    builder = vm.createContext({}); vm.runInContext(bytes.toString('utf8'), builder);
    assert.equal(vm.runInContext('SprotoShooterSim.SOURCE_COMMIT', builder), SOURCE);
  }
  builder.input = JSON.stringify(input);
  try {
    const result = object(JSON.parse(vm.runInContext('JSON.stringify(SprotoShooterSim.buildIssuance(JSON.parse(input)))', builder) as string));
    assert.equal(result.ok, true); assert.equal(result.ticketsMinted, 0);
    return object(result.issuance);
  } finally { delete builder.input; }
}
export function buildCanonicalFixtureIssuance(input: Obj): Obj {
  fixtureGuard();
  return buildCanonical(input);
}

export async function prepareTrustedActor(caseId: string, login: GameLogin, options: { runId?: string; key?: string; ageMs?: number } = {}): Promise<TrustedActor> {
  fixtureGuard();
  const { psqlAsync } = await import('./harness');
  const trace = loadFrozenTrace(caseId), runId = options.runId === undefined ? randomUUID() : options.runId, key = options.key === undefined ? 'e2e:' + runId : options.key, ageMs = options.ageMs === undefined ? 0 : options.ageMs;
  assert.match(login.hub.userId, UUID); assert.match(login.sessionId, UUID); assert.match(runId, UUID);
  assert.match(key, /^[A-Za-z0-9_.:@|-]{1,80}$/);
  assert.ok(Number.isSafeInteger(ageMs) && ageMs >= 0 && ageMs <= 1200000);
  const day = await psqlAsync("SELECT to_char((clock_timestamp() AT TIME ZONE 'UTC')::date,'YYYY-MM-DD')");
  const issuance = buildCanonical({ accountId: login.hub.userId, sessionId: login.sessionId, runId, day, canonicalBoss: trace.definition.boss, seed: trace.definition.seed });
  await psqlAsync(`INSERT INTO game.shooter_verification_cohort(user_id) VALUES('${login.hub.userId}') ON CONFLICT DO NOTHING`);
  const issueAck = object(JSON.parse(await psqlAsync(`SELECT game.issue_shooter_verification_run('${login.hub.userId}','${login.sessionId}',${literal(key)},'${runId}',${literal(day)},${literal(trace.definition.boss)},${trace.definition.seed},${literal(JSON.stringify(issuance))})::text`)));
  assert.equal(issueAck.state, 'issued', JSON.stringify(issueAck)); assert.equal(issueAck.runId, runId);
  assert.deepEqual(issueAck.manifest, integrationManifest);
  assert.deepEqual(issueAck.issuance, issuance);
  if (ageMs) {
    // Explicit internal fixture clock-age, never used in the actual UI lane.
    // Keep the database deadline exactly45minutes after its synthetic issuance.
    await psqlAsync(`UPDATE game.shooter_verification_run SET issued_at=issued_at-make_interval(secs=>${ageMs / 1000}),upload_deadline=upload_deadline-make_interval(secs=>${ageMs / 1000}) WHERE run_id='${runId}'`);
  }
  const clocks = object(JSON.parse(await psqlAsync(`SELECT jsonb_build_object('issuedAt',issued_at,'uploadDeadline',upload_deadline)::text FROM game.shooter_verification_run WHERE run_id='${runId}'`)));
  return Object.freeze({ login, runId, key, issuance, issueAck, trace, fixture: Object.freeze({ kind: 'trusted_ci_server_fixture' as const, ageMs, issuedAt: String(clocks.issuedAt), uploadDeadline: String(clocks.uploadDeadline) }) });
}

export function reboundBatches(actor: TrustedActor, batchFrames = 28800): readonly PublicBatch[] {
  assert.ok(Number.isSafeInteger(batchFrames) && batchFrames >= 1 && batchFrames <= 28800);
  assert.ok(Math.ceil(actor.trace.definition.frames / batchFrames) <= 4096);
  const batches: PublicBatch[] = [];
  for (let tick0 = 0; tick0 < actor.trace.definition.frames; tick0 += batchFrames) {
    const n = Math.min(batchFrames, actor.trace.definition.frames - tick0);
    const actions = actor.trace.actions.filter(action => action[0]! >= tick0 && action[0]! < tick0 + n).map(action => Object.freeze([action[0]! - tick0, action[1]!]));
    batches.push(Object.freeze({ protocol: 2, runId: actor.runId, sequence: batches.length, tick0, n, frames: actor.trace.frames.slice(tick0 * 16, (tick0 + n) * 16), actions: Object.freeze(actions) }));
  }
  assert.equal(batches.reduce((total, batch) => total + batch.n, 0), actor.trace.definition.frames);
  return Object.freeze(batches);
}
export function appendDigest(batch: PublicBatch): string {
  return hash(JSON.stringify({ actions: batch.actions, frames: batch.frames, n: batch.n, protocol: 2, runId: batch.runId, sequence: batch.sequence, tick0: batch.tick0 }));
}
export async function appendActor(actor: TrustedActor, batchFrames = 28800): Promise<readonly PublicBatch[]> {
  const { call } = await import('./harness');
  const batches = reboundBatches(actor, batchFrames);
  // For multi-batch full frozen input, the caller pauses the worker until every
  // batch is accepted. Never shorten a trace after an early terminal latch.
  for (const body of batches) {
    const ack = object((await call('shooter.run.append', body, actor.login.gameToken)).body);
    assert.equal(ack.state, 'received', JSON.stringify(ack)); assert.equal(ack.digest, appendDigest(body));
    assert.equal(ack.acceptedSequence, body.sequence); assert.equal(ack.acceptedTick, body.tick0 + body.n);
  }
  return batches;
}
export async function finishActor(actor: TrustedActor, lastSequence: number, lastTick = actor.trace.definition.frames): Promise<Obj> {
  const { call } = await import('./harness');
  const ack = object((await call('shooter.run.finish', { protocol: 2, runId: actor.runId, lastSequence, lastTick }, actor.login.gameToken)).body);
  assert.equal(ack.state, 'sealed', JSON.stringify(ack)); assert.equal(ack.runId, actor.runId);
  assert.equal(ack.lastSequence, lastSequence); assert.equal(ack.lastTick, lastTick);
  return ack;
}
export async function observeActor(actor: TrustedActor): Promise<Obj> {
  const { call } = await import('./harness');
  const status = object((await call('shooter.run.status', { runId: actor.runId }, actor.login.hub.token)).body);
  assert.equal(status.protocol, 2); assert.equal(status.runId, actor.runId);
  return status;
}
