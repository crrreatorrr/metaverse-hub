// Scoped service-only RPCs. Ordinary JWT vars and the broad runtime HTTP key
// confer no service authority. Application logs exclude private inputs; runtime
// driver/connection argument logging remains an explicit deployment gate.
namespace ShooterVerificationInternal {
  var ID = /^[A-Za-z0-9_.:@|-]{1,80}$/;
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  var MANIFEST: { [key: string]: unknown } = { artifact: "shooter-sim", sourceCommit: "7db4fc4f93333f3977da2159771a060f344b6ea0",
    sha256: "ab175aae2000991fae582e7c2ee0c1fea952488e89a6888b96eda9c7e0ee2e1e", protocol: 1, contentFingerprint: "73c6eb0f",
    uploadProtocol: 2, replayApiVersion: 2, checkpointSchema: 2, economyPolicy: 1 };
  function object(v: unknown): v is { [key: string]: unknown } { return v !== null && typeof v === "object" && !Array.isArray(v); }
  function exact(v: unknown, keys: string[]): v is { [key: string]: unknown } {
    return object(v) && Object.keys(v).length === keys.length && keys.every(function(k) { return Object.prototype.hasOwnProperty.call(v,k); });
  }
  function integer(v: unknown): v is number { return typeof v === "number" && isFinite(v) && Math.floor(v) === v && v >= 0 && v <= 9007199254740991; }
  function fail(state: string, reason: string): string { return JSON.stringify({ state:state, reason:reason }); }
  function bounded(root: unknown): boolean {
    var nodes=0;
    function walk(v: unknown, depth: number): boolean {
      if (++nodes>1000000 || depth>64) return false;
      if (v===null || typeof v==="boolean") return true;
      if (typeof v==="number") return isFinite(v);
      if (typeof v==="string") return v.length<=2097152;
      if (!object(v) && !Array.isArray(v)) return false;
      var keys=Object.keys(v as object);
      if (keys.length>100000) return false;
      for (var i=0;i<keys.length;i++) if (!walk((v as {[key:string]:unknown})[keys[i]],depth+1)) return false;
      return true;
    }
    return walk(root,0);
  }
  function stable(v: unknown): string {
    if (v===null || typeof v!=="object") return JSON.stringify(v);
    if (Array.isArray(v)) return "["+v.map(stable).join(",")+"]";
    var obj=v as {[key:string]:unknown};
    return "{"+Object.keys(obj).sort().map(function(k) { return JSON.stringify(k)+":"+stable(obj[k]); }).join(",")+"}";
  }
  function claim(v: unknown): boolean {
    if (!exact(v,["jobId","runId","accountId","sessionId","inputSha256","fence","initialRevision","expectedRevision","tick0","tickEnd","continuationTick"])) return false;
    if (["jobId","runId","accountId","sessionId"].some(function(k) { return typeof v[k]!=="string" || !UUID.test(v[k] as string); })
      || typeof v.inputSha256!=="string" || !/^[0-9a-f]{64}$/.test(v.inputSha256)) return false;
    if (["fence","initialRevision","expectedRevision","tick0","tickEnd","continuationTick"].some(function(k) { return !integer(v[k]); })) return false;
    return (v.fence as number)>0 && (v.expectedRevision as number)>=(v.initialRevision as number)
      && (v.tick0 as number)<=(v.continuationTick as number) && (v.continuationTick as number)<(v.tickEnd as number) && (v.tickEnd as number)<=162000;
  }
  function publicResult(v: unknown): boolean {
    if (!object(v)) return false;
    var keys=["version","status","reason","retryable","eligible","ranked","ticketsMinted","acceptedInputTick","verifiedInputTick","simulationTick","acceptedBatches","verifiedBatches","framesTextBytes","verifiedFramesTextBytes","actions","verifiedActions","terminal"];
    if (Object.keys(v).some(function(k) { return keys.indexOf(k)<0; }) || v.version!==2 || v.ticketsMinted!==0
      || typeof v.reason!=="string" || !/^[a-z0-9_]{1,80}$/.test(v.reason)
      || ["invalid","pending_retryable","received","verified","terminal_verified"].indexOf(v.status as string)<0
      || ["retryable","eligible","ranked"].some(function(k) { return typeof v[k]!=="boolean"; })) return false;
    if (keys.slice(7,16).some(function(k) { return v[k]!==undefined && !integer(v[k]); })) return false;
    if (v.terminal!==null && v.terminal!==undefined) {
      if (!exact(v.terminal,["outcome","reason","eligible","ranked","canonicalCount","stateHash","simTick","inputFrame"])) return false;
    }
    return true;
  }
  function bodyOk(op: string,b: unknown): boolean {
    if (op==="claim") return exact(b,[]);
    if (op==="renew" || op==="retry") {
      if (!exact(b,op==="renew"?["jobId","fence","expectedRevision"]:["jobId","fence","expectedRevision","reason"]) || typeof b.jobId!=="string" || !UUID.test(b.jobId)
        || !integer(b.fence) || b.fence<1 || !integer(b.expectedRevision)) return false;
      return op==="renew" || ["execution_timeout","worker_crash","artifact_unavailable","checkpoint_export_failure","database_issue"].indexOf(b.reason as string)>=0;
    }
    if (!exact(b,["manifest","result"]) || !exact(b.manifest,Object.keys(MANIFEST))
      || Object.keys(MANIFEST).some(function(k) { return (b.manifest as {[key:string]:unknown})[k]!==MANIFEST[k]; })
      || !exact(b.result,["kind","binding","privateCheckpoint","publicResult"]) || b.result.kind!=="replayed" || !claim(b.result.binding) || !publicResult(b.result.publicResult)) return false;
    var cp=b.result.privateCheckpoint;
    // Cheap transport/schema checks only. PR11 owns authoritative full checkpoint
    // validation and monotonic counters; PR10 never advances from these fields.
    return cp===null || (exact(cp,["v","issuance","snapshot","accounting","pending","firstTerminal","privateHash"]) && cp.v===2);
  }
  export function call(ctx: nkruntime.Context,_logger: nkruntime.Logger,nk: nkruntime.Nakama,payload: string,op: string): string {
    if (!ctx.userId || !UUID.test(ctx.userId)) return fail("authorization_denied","unauthorized");
    // Account allowlist BEFORE JSON parse; not an authorization substitute.
    var pre=ShooterRewards.queryJson(nk,"SELECT game.shooter_verification_gateway_preflight($1::uuid)::text AS result",[ctx.userId]);
    if (pre.state!=="ready") return JSON.stringify(pre);
    var max=op==="result"?20971520:4096;
    if (!payload || payload.length>max || nk.stringToBinary(payload).byteLength>max) return fail("invalid","oversized");
    var parsed: unknown;
    try { parsed=JSON.parse(payload); } catch (_e) { return fail("invalid","malformed"); }
    if (!exact(parsed,["workerId","keyId","token","requestId","body"]) || typeof parsed.workerId!=="string" || !ID.test(parsed.workerId)
      || typeof parsed.keyId!=="string" || !ID.test(parsed.keyId) || typeof parsed.requestId!=="string" || !ID.test(parsed.requestId)
      || typeof parsed.token!=="string" || !/^[A-Za-z0-9_-]{43}$/.test(parsed.token)) return fail("authorization_denied","unauthorized");
    var hash=nk.sha256Hash("shooter-worker-token-v1\n"+parsed.token);
    var auth=ShooterRewards.queryJson(nk,`SELECT jsonb_build_object('authorized',EXISTS(SELECT 1 FROM game.shooter_verification_principal
      WHERE account_id=$1::uuid AND worker_id=$2::text AND key_id=$3::text AND revoked_at IS NULL
      AND not_before<=clock_timestamp() AND expires_at>clock_timestamp() AND $5::text=ANY(scopes)
      AND game.shooter_verification_hash_equal(token_sha256,$4::text)))::text AS result`,[ctx.userId,parsed.workerId,parsed.keyId,hash,op]);
    if (!auth.authorized) return fail("authorization_denied","unauthorized");
    if (!bounded(parsed.body) || !bodyOk(op,parsed.body)) return fail("invalid","malformed");
    if (op==="result" && !ShooterVerificationCommit.valid(nk,parsed.body)) return fail("pending_retryable","bad_worker_checkpoint");
    if (op==="result") HubFault.apply(ctx,nk,ctx.userId,"shooter.worker.before_commit");
    var digest=nk.sha256Hash(op+"\n"+stable(parsed.body));
    var result=ShooterRewards.queryJson(nk,"SELECT game.shooter_verification_internal($1::uuid,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text,$8::jsonb)::text AS result",
      [ctx.userId,parsed.workerId,parsed.keyId,hash,op,parsed.requestId,digest,JSON.stringify(parsed.body)]);
    if (op==="result") HubFault.apply(ctx,nk,ctx.userId,"shooter.worker.after_commit");
    if (op==="claim" && result.state==="leased") {
      var projection=ShooterRewards.queryJson(nk,"SELECT game.shooter_verification_private_response($1::uuid,$2::text,$3::text,$4::text,$5::text,$6::text)::text AS result",
        [ctx.userId,parsed.workerId,parsed.keyId,hash,parsed.requestId,digest]);
      // The immutable acknowledgment is historical. Only this separately
      // authorized, live-fence projection may add transient private work.
      result.work=projection.work===undefined?null:projection.work;
      result.workState=typeof projection.workState==="string"?projection.workState:"pending_retryable";
      result.workReason=typeof projection.workReason==="string"?projection.workReason:null;
    }
    // The first SQL query has returned and COMMITTED. Payment is a separate
    // transaction; its economic/session locks never nest under checkpoint locks.
    if (op==="result" && typeof ShooterVerificationSettlement!=="undefined") {
      ShooterVerificationSettlement.afterResult(ctx,_logger,nk,parsed.workerId,parsed.keyId,hash,parsed.requestId,result);
    }
    // Independent derived lifecycle maintenance after the scoped transaction has
    // committed; never nest session/run locks under gateway/scheduler locks.
    if (op==="claim" && (result.state==="leased" || result.reason==="no_capacity_or_ready_work")) {
      try { ShooterVerificationLifecycle.reap(nk,null); }
      catch (_e) { _logger.error("shooter lifecycle maintenance operational failure"); }
    }
    return JSON.stringify(result);
  }
  export function safe(ctx: nkruntime.Context,logger: nkruntime.Logger,nk: nkruntime.Nakama,payload: string,op: string): string {
    try { return call(ctx,logger,nk,payload,op); } catch (_e) {
      // SQL/transport exceptions may contain private parameters. Never stringify.
      logger.error("shooter worker gateway operational failure");
      return fail("pending_retryable","gateway_unavailable");
    }
  }
}
function rpcShooterInternalClaim(c:nkruntime.Context,l:nkruntime.Logger,n:nkruntime.Nakama,p:string):string { return ShooterVerificationInternal.safe(c,l,n,p,"claim"); }
function rpcShooterInternalRenew(c:nkruntime.Context,l:nkruntime.Logger,n:nkruntime.Nakama,p:string):string { return ShooterVerificationInternal.safe(c,l,n,p,"renew"); }
function rpcShooterInternalRetry(c:nkruntime.Context,l:nkruntime.Logger,n:nkruntime.Nakama,p:string):string { return ShooterVerificationInternal.safe(c,l,n,p,"retry"); }
function rpcShooterInternalResult(c:nkruntime.Context,l:nkruntime.Logger,n:nkruntime.Nakama,p:string):string { return ShooterVerificationInternal.safe(c,l,n,p,"result"); }
