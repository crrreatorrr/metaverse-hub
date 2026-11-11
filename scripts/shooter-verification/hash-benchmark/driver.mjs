// Actions-only private fixture generation and actual Goja executable driver.
// No checkpoint, canonical string, token or raw child error is printed/uploaded.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const own = fileURLToPath(new URL('./', import.meta.url));
const names = ['empty','ascii','all_utf16_units','unpaired_surrogates','astral_combining_nul','canonical_edges','checkpoint_envelope','checkpoint_snapshot'];
const revision = 'v0.0.0-20260906210903-70ad66ec7ce4';
const sha = value => createHash('sha256').update(value).digest('hex');
const refuse = () => { throw new Error('benchmark_failed'); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const duration = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 90000;
const childStages = ['gate','input','compile','invoke','output','deadline'];
const childReasons = ['refused','version_refused','input_bound','input_shape','runtime_failed','parity_fnv','parity_canonical','parity_serialization','output_bound','deadline','panic'];
function childFailure(error) {
  try {
    const raw = error && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'stdout')?.value : null;
    if ((!Buffer.isBuffer(raw) && typeof raw !== 'string') || Buffer.byteLength(raw) > 262144) return null;
    const value = JSON.parse(raw.toString());
    if (!exact(value, ['version','state','stage','case','reason']) || value.version !== 1 || value.state !== 'failed'
      || !childStages.includes(value.stage) || ![...names,'none'].includes(value.case) || !childReasons.includes(value.reason)) return null;
    return { version: 1, state: 'failed', stage: value.stage, case: value.case, reason: value.reason };
  } catch { return null; }
}
function extract(source, begin, end) {
  if (source.split(begin).length !== 2 || source.split(end).length !== 2) refuse();
  const start = source.indexOf(begin), stop = source.indexOf(end);
  if (stop <= start) refuse(); return source.slice(start, stop);
}
function projectResult(value, expectations) {
  if (!exact(value, ['version','state','goVersion','gojaRevision','clock','coldScope','warmRepetitions','cases']) || value.version !== 1 || value.state !== 'passed'
    || value.goVersion !== 'go1.27.1' || value.gojaRevision !== revision || value.clock !== 'host_monotonic_wall_inside_Goja_no_CPU_claim'
    || value.coldScope !== 'fresh_Goja_runtime_per_case; first_function_invocation; excludes_parse_compile_and_no_process_cold_claim' || value.warmRepetitions !== 2
    || !Array.isArray(value.cases) || value.cases.length !== names.length) refuse();
  const cases = value.cases.map((row, index) => {
    const expected = expectations[index];
    if (!exact(row, ['name','kind','codeUnits','canonicalSHA','serialization','variants']) || row.name !== names[index] || row.kind !== expected.kind
      || row.codeUnits !== expected.codeUnits || row.canonicalSHA !== expected.expectedCanonicalSHA || !Array.isArray(row.variants) || row.variants.length !== 3) refuse();
    const timing = input => {
      if (!exact(input, ['coldMs','warmMs']) || !duration(input.coldMs) || !Array.isArray(input.warmMs) || input.warmMs.length !== 2 || !input.warmMs.every(duration)) refuse();
      return { coldMs: input.coldMs, warmMs: [...input.warmMs] };
    };
    const serialization = expected.kind === 'canonical' ? timing(row.serialization) : row.serialization === null ? null : refuse();
    const variants = row.variants.map((variant, number) => {
      if (!exact(variant, ['variant','hash','coldMs','warmMs']) || variant.variant !== ['original','cached_imul_length','shift_add_mod32'][number] || variant.hash !== expected.expectedHash) refuse();
      return { variant: variant.variant, hash: variant.hash, ...timing({ coldMs: variant.coldMs, warmMs: variant.warmMs }) };
    });
    return { name: names[index], kind: expected.kind, codeUnits: expected.codeUnits, canonicalSHA: expected.expectedCanonicalSHA, serialization, variants };
  });
  return { version: 1, state: 'passed', goVersion: 'go1.27.1', gojaRevision: revision, clock: value.clock, coldScope: value.coldScope, warmRepetitions: 2, cases };
}

let privateDirectory, phase = 'validate', activeCase = 'none';
try {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.HUB_SHOOTER_FIXTURE !== 'benchmark' || process.env.SHOOTER_CHECKPOINT_HASH_BENCHMARK !== '1') refuse();
  const temp = process.env.RUNNER_TEMP;
  if (!temp || !isAbsolute(temp) || process.argv.length !== 3 || resolve(process.argv[2]) !== join(resolve(temp), 'shooter-checkpoint-hash')) refuse();
  privateDirectory = mkdtempSync(join(temp, 'shooter-hash-private-')); chmodSync(privateDirectory, 0o700);
  phase = 'extract_helpers';
  const production = readFileSync(join(root, 'server/modules/src/games/shooter_verification_commit.ts'), 'utf8');
  if (Buffer.byteLength(production) > 131072) refuse();
  const originalTS = extract(production, '  function stable(v: Value): string {', '  function hash(v: ObjectValue): void {')
    + extract(production, '  function fnv(encoded: string): string {', '  function quantized(v: Value): Value {');
  // Pure diagnostic type stripping only. The actual server compiler remains ES5;
  // these extracted helpers already use only var/function/ES5 expression syntax.
  const transpiled = ts.transpileModule(originalTS, { compilerOptions: { target: ts.ScriptTarget.ES2015, module: ts.ModuleKind.None }, reportDiagnostics: true });
  if (transpiled.diagnostics?.length) refuse();
  const originalJS = transpiled.outputText;
  const template = readFileSync(join(own, 'benchmark.js'), 'utf8');
  if (template.split('/* ORIGINAL_FUNCTIONS */').length !== 2) refuse();
  const source = template.replace('/* ORIGINAL_FUNCTIONS */', originalJS);
  if (Buffer.byteLength(source) > 131072) refuse();
  const sourcePath = join(privateDirectory, 'comparison.js'); writeFileSync(sourcePath, source, { mode: 0o600, flag: 'wx' });
  phase = 'generate_fixture';
  const generated = execFileSync(process.execPath, [join(root, 'services/shooter-verifier/test/late-checkpoint.mjs')], {
    input: JSON.stringify({ accountId: '00000000-0000-4000-8000-000000000001', sessionId: '00000000-0000-4000-8000-000000000002', runId: '00000000-0000-4000-8000-000000000003', day: '2026-11-11' }),
    env: { NODE_ENV: 'test' }, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024, stdio: ['pipe','pipe','pipe'],
  });
  const late = JSON.parse(generated), cp = late.checkpoint;
  if (!cp || cp.accounting?.verifiedFrames !== 22000 || late.batch?.n !== 24000 || late.checkpointBytes <= 262144) refuse();
  phase = 'build_cases';
  // Match production hash(v): exclude privateHash ONLY on the root envelope.
  const omitHash = value => Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'privateHash'));
  let allUnits = ''; for (let index = 0; index < 65536; index += 1024) allUnits += String.fromCharCode(...Array.from({ length: 1024 }, (_, offset) => index + offset));
  const raw = [
    { name: names[0], kind: 'text', value: '' },
    { name: names[1], kind: 'text', value: 'ASCII\u0000private-hash-regression\n'.repeat(8192) },
    { name: names[2], kind: 'text', value: allUnits },
    { name: names[3], kind: 'text', value: '\ud800x\udfff\ud801\ud802\udc00\udbff' },
    { name: names[4], kind: 'text', value: 'A\u0000\u{1f680}e\u0301\u2028\u2029\u{1f4a9}' },
    { name: names[5], kind: 'canonical', value: { '\uffff': '\ud800', '10': -0, '2': 2, a: [null, true, false, '\u0000'], '\ud800': '\udfff', '\u{1f680}': 'e\u0301' } },
    { name: names[6], kind: 'canonical', value: omitHash(cp) },
    { name: names[7], kind: 'canonical', value: omitHash(cp.snapshot) },
  ];
  const context = vm.createContext({}); vm.runInContext(originalJS, context, { timeout: 10000 });
  const expectations = [], cases = raw.map(row => {
    phase = 'expected_hash'; activeCase = row.name;
    context.value = row.value;
    const canonical = row.kind === 'text' ? row.value : vm.runInContext('stable(value)', context, { timeout: 10000 });
    context.canonical = canonical;
    const expectedHash = vm.runInContext('fnv(canonical)', context, { timeout: 10000 });
    phase = 'checkpoint_control';
    if ((row.name === 'checkpoint_envelope' && expectedHash !== cp.privateHash)
      || (row.name === 'checkpoint_snapshot' && expectedHash !== cp.snapshot.privateHash)) refuse();
    const expectedCanonicalSHA = row.kind === 'canonical' ? sha(canonical) : null;
    expectations.push({ kind: row.kind, codeUnits: canonical.length, expectedHash, expectedCanonicalSHA });
    return { ...row, expectedHash, expectedCanonicalSHA };
  });
  const input = JSON.stringify({ version: 1, cases });
  if (Buffer.byteLength(input) > 16 * 1024 * 1024) refuse();
  // Private file permits inspection only inside this disposable runner and is
  // removed in finally. It is never selected by any artifact glob.
  writeFileSync(join(privateDirectory, 'input.json'), input, { mode: 0o600, flag: 'wx' });
  phase = 'goja_process'; activeCase = 'none';
  const result = execFileSync(process.argv[2], [sourcePath], { input, encoding: 'utf8', timeout: 95000, maxBuffer: 262144, stdio: ['pipe','pipe','pipe'] });
  phase = 'project_report';
  const report = { ...projectResult(JSON.parse(result), expectations), authority: 'ci_advisory_actual_Goja_no_capacity_or_speedup_guarantee',
    provenance: { nakamaVersion: '3.41.0', gojaModule: revision, productionSourceSHA256: sha(production), extractedFunctionsSHA256: sha(originalJS), fixtureSourceSHA256: sha(source),
      approvedArtifactSHA256: '797029721efe6124b718d84349cd255cd52529d3105b2da1d33e97da8d734aa9', fullFrozenFrames: 24000, predecessorFrames: 22000 },
    methodology: { canonical: 'exact_production_stable; object_sorted_UTF16_keys_and_JSON_stringify; root_privateHash_omitted_only', fnv: 'UTF16_code_units; fixed_original_then_cached_then_shift_order; cold1_warm2_each',
      exclusions: 'input_generation_parse_compile_SHA_and_JSON_output_outside_timed_functions; source_build_and_process_cold_not_measured; actual_Nakama_integration_still_required' } };
  const text = JSON.stringify(report);
  if (Buffer.byteLength(text) > 262144) refuse();
  phase = 'write_report';
  const directory = join(root, 'ci-artifacts/checkpoint-hash'); mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'report.json'), text + '\n', { mode: 0o600 });
  console.log(text);
} catch (error) {
  // Even execFileSync errors embed stdin/stdout/stderr: never print them.
  try {
    const directory = join(root, 'ci-artifacts/checkpoint-hash'); mkdirSync(directory, { recursive: true });
    const failure = { version: 1, state: 'failed', reason: 'benchmark_failed', phase, case: activeCase,
      childFailure: phase === 'goja_process' ? childFailure(error) : null };
    writeFileSync(join(directory, 'report.json'), JSON.stringify(failure) + '\n', { mode: 0o600 });
  } catch { /* Filesystem failures do not expose raw child diagnostics. */ }
  console.error('checkpoint_hash_benchmark_failed'); process.exitCode = 1;
} finally {
  if (privateDirectory) {
    try { rmSync(privateDirectory, { recursive: true, force: true }); }
    catch { console.error('checkpoint_hash_cleanup_failed'); process.exitCode = 1; }
  }
}
