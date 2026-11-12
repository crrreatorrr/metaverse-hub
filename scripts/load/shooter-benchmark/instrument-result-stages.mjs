// Explicit Actions build instrumentation, never an ordinary source/build path.
import { createHash } from 'node:crypto';
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PREFIX, STAGES, MAX_MARKERS } from './result-stage-schema.mjs';

const INTERNAL = 'server/modules/src/games/shooter_verification_internal.ts';
const COMMIT = 'server/modules/src/games/shooter_verification_commit.ts';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const refuse = () => { throw new Error('ci_result_stage_instrumentation_refused'); };
function exactOnce(source, anchor, replacement) {
  const at = source.indexOf(anchor);
  if (at < 0 || source.indexOf(anchor, at + anchor.length) !== -1) refuse();
  return source.slice(0, at) + replacement + source.slice(at + anchor.length);
}
export function requireTraceCI(env) {
  if (env.GITHUB_ACTIONS !== 'true' || env.HUB_SHOOTER_FIXTURE !== 'benchmark' || env.SHOOTER_BENCHMARK_RESULT_TRACE !== '1') refuse();
}
export function instrumentResultSources({ internal, commit }) {
  if (typeof internal !== 'string' || typeof commit !== 'string' || internal.includes(PREFIX) || commit.includes('__resultStage')) refuse();
  const originals = { internal, commit };
  const signature = '  export function call(ctx: nkruntime.Context,_logger: nkruntime.Logger,nk: nkruntime.Nakama,payload: string,op: string): string {\n';
  const marker = `${signature}    // CI-BUILD-ONLY: no business data enters this bounded marker.\n` +
    `    var __resultStageTag="",__resultStageStarted=Date.now(),__resultStageCount=0;\n` +
    `    if (op==="result") { try { __resultStageTag=nk.sha256Hash(nk.uuidv4()); } catch (_traceError) { /* metadata only */ } }\n` +
    `    function __resultStage(stage: string): void {\n` +
    `      try {\n` +
    `        if (op!=="result" || !/^[a-f0-9]{64}$/.test(__resultStageTag) || __resultStageCount>=${MAX_MARKERS} || ${JSON.stringify(STAGES)}.indexOf(stage)<0) return;\n` +
    `        var observed=Date.now();\n` +
    `        if (!isFinite(__resultStageStarted) || Math.floor(__resultStageStarted)!==__resultStageStarted || __resultStageStarted<0 || __resultStageStarted>9007199254740991\n` +
    `          || !isFinite(observed) || Math.floor(observed)!==observed || observed<0 || observed>9007199254740991) return;\n` +
    `        __resultStageCount++;\n` +
    `        _logger.info(${JSON.stringify(PREFIX + '|')}+__resultStageTag+"|"+stage+"|"+__resultStageStarted+"|"+observed);\n` +
    `      } catch (_traceError) { /* Logging never changes the business result. */ }\n` +
    `    }\n    __resultStage("rpc_enter");\n    try {\n`;
  internal = exactOnce(internal, signature, marker);
  for (const [anchor, stage] of [
    ['    var pre=ShooterRewards.queryJson(nk,"SELECT game.shooter_verification_gateway_preflight($1::uuid)::text AS result",[ctx.userId]);', 'preflight_done'],
    ['    try { parsed=JSON.parse(payload); } catch (_e) { return fail("invalid","malformed"); }', 'payload_decoded'],
    ['    if (!auth.authorized) return fail("authorization_denied","unauthorized");', 'authorized'],
    ['    if (!bounded(parsed.body) || !bodyOk(op,parsed.body)) return fail("invalid","malformed");', 'body_checked'],
    ['    var digest=nk.sha256Hash(op+"\\n"+stable(parsed.body));', 'digest_ready'],
  ]) internal = exactOnce(internal, anchor, `${anchor}\n    __resultStage(${JSON.stringify(stage)});`);
  const validation = '    if (op==="result" && !ShooterVerificationCommit.valid(nk,parsed.body)) return fail("pending_retryable","bad_worker_checkpoint");';
  internal = exactOnce(internal, validation, '    if (op==="result" && !ShooterVerificationCommit.valid(nk,parsed.body,__resultStage)) return fail("pending_retryable","bad_worker_checkpoint");\n    __resultStage("checkpoint_validated");');
  const query = '    var result=ShooterRewards.queryJson(nk,"SELECT game.shooter_verification_internal($1::uuid,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text,$8::jsonb)::text AS result",\n      [ctx.userId,parsed.workerId,parsed.keyId,hash,op,parsed.requestId,digest,JSON.stringify(parsed.body)]);';
  internal = exactOnce(internal, query, '    var __resultStageBodyJson=JSON.stringify(parsed.body);\n    __resultStage("sql_arguments_ready");\n' + query.replace('JSON.stringify(parsed.body)', '__resultStageBodyJson') + '\n    __resultStage("committed");');
  const payment = '      ShooterVerificationSettlement.afterResult(ctx,_logger,nk,parsed.workerId,parsed.keyId,hash,parsed.requestId,result);\n    }';
  internal = exactOnce(internal, payment, payment + '\n    __resultStage("payment_done");');
  const end = '    return JSON.stringify(result);\n  }\n  export function safe';
  internal = exactOnce(internal, end, '    var __resultStageResponse=JSON.stringify(result);\n    __resultStage("response_serialized");\n    return __resultStageResponse;\n    } finally { __resultStage("call_exit"); }\n  }\n  export function safe');
  commit = exactOnce(commit, '  export function valid(nk: nkruntime.Nakama, raw: unknown): boolean {', '  export function valid(nk: nkruntime.Nakama, raw: unknown, __resultStage?: (stage: string) => void): boolean {');
  for (const [anchor, target, name] of [
    ['      if (c.v !== 2) return false; hash(c);', 'hash(c);', 'envelope'],
    ['      if (snap.v !== 1) return false; hash(snap); state(snap.state, issuance); replaySafe(object(snap.state));', 'hash(snap);', 'snapshot'],
  ]) commit = exactOnce(commit, anchor, anchor.replace(target, `if (__resultStage) __resultStage("checkpoint_${name}_hash_begin"); ${target} if (__resultStage) __resultStage("checkpoint_${name}_hash_done");`));
  return { internal, commit, sources: [
    { path: INTERNAL, originalSha256: sha256(originals.internal), instrumentedSha256: sha256(internal) },
    { path: COMMIT, originalSha256: sha256(originals.commit), instrumentedSha256: sha256(commit) },
  ] };
}
function noSymlinks(path) {
  let current = path;
  for (;;) { if (lstatSync(current).isSymbolicLink()) refuse();const parent = dirname(current);if (parent === current) return;current = parent; }
}
function readSource(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const stat = fstatSync(fd);if (!stat.isFile() || stat.nlink !== 1) refuse();return readFileSync(fd, 'utf8'); }
  finally { closeSync(fd); }
}
export function main(args = process.argv.slice(2), env = process.env) {
  requireTraceCI(env);
  if (args.length !== 2 || args[0] !== '--manifest' || typeof env.RUNNER_TEMP !== 'string' || !isAbsolute(env.RUNNER_TEMP)) refuse();
  const temp = resolve(env.RUNNER_TEMP), output = resolve(args[1]);
  if (output !== join(temp, 'shooter-result-stage-manifest.json')) refuse();
  noSymlinks(temp);
  const internalPath = join(ROOT, INTERNAL), commitPath = join(ROOT, COMMIT);
  noSymlinks(internalPath);noSymlinks(commitPath);
  // BOTH complete transforms/anchor checks happen before any write.
  const transformed = instrumentResultSources({ internal: readSource(internalPath), commit: readSource(commitPath) });
  const manifest = { version: 1, kind: 'ci_result_stage_instrumentation', instrumenterSha256: sha256(readFileSync(fileURLToPath(import.meta.url))), sources: transformed.sources };
  let fd, complete = false;
  try {
    fd = openSync(output, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    for (const [path, source] of [[internalPath, transformed.internal], [commitPath, transformed.commit]]) {
      const sourceFd = openSync(path, constants.O_WRONLY | constants.O_TRUNC | constants.O_NOFOLLOW);
      try { writeFileSync(sourceFd, source); } finally { closeSync(sourceFd); }
    }
    writeFileSync(fd, JSON.stringify(manifest) + '\n');complete = true;
  } finally { if (fd !== undefined) { closeSync(fd);if (!complete) unlinkSync(output); } }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main();console.log('ci_result_stage_instrumentation_ready'); }
  catch { console.error('ci_result_stage_instrumentation_refused');process.exitCode = 1; }
}
