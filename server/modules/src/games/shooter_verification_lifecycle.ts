// Protocol selection is exclusively server-side. This namespace never replays
// inputs or awards tickets; historical key retries return the original version.
namespace ShooterVerificationLifecycle {
  var UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function fail(state:string,reason:string):string { return JSON.stringify({state:state,reason:reason}); }
  export function reap(nk:nkruntime.Nakama,user:string|null):void {
    nk.sqlQuery("SELECT game.shooter_verification_reap($1::uuid) AS touched",[user]);
  }
  export function issue(nk:nkruntime.Nakama,user:string,sid:string,key:string,runId:string,day:string,boss:string,seed:number,issuance:string,exactRequest:boolean):{[key:string]:unknown}|null {
    var rows=nk.sqlQuery(`SELECT 1 AS selected WHERE EXISTS(SELECT 1 FROM game.shooter_verification_cohort WHERE user_id=$1::uuid)
      OR EXISTS(SELECT 1 FROM game.shooter_run old JOIN game.shooter_verification_run r USING(run_id)
        WHERE old.user_id=$1::uuid AND old.idem_key=$2::text)`,[user,key]);
    if (!rows || !rows.length) return null;
    if (!exactRequest) return {state:"invalid",reason:"malformed"};
    // Separate transaction: do not carry session/run locks into quota locks.
    reap(nk,user);
    return ShooterRewards.queryJson(nk,"SELECT game.issue_shooter_verification_run($1::uuid,$2::uuid,$3::text,$4::text,$5::date,$6::text,$7::bigint,$8::text)::text AS result",
      [user,sid,key,runId,day,boss,seed,issuance]);
  }
  export function finish(ctx:nkruntime.Context,_logger:nkruntime.Logger,nk:nkruntime.Nakama,payload:string):string {
    var vars=ctx.vars;
    if (!ctx.userId || !UUID.test(ctx.userId) || !vars || vars.scope!=="game" || vars.game!=="sproto-shooter" || !vars.sid || !UUID.test(vars.sid))
      return fail("authorization_denied","not_game_session");
    if (!payload || payload.length>4096 || nk.stringToBinary(payload).byteLength>4096) return fail("invalid","oversized");
    var key="sh:v2:finish:"+ctx.userId; var now=Date.now(); var raw=nk.localcacheGet(key); var parts=typeof raw==="string"?raw.split(":"):[];
    var start=Number(parts[0]); var count=Number(parts[1]);
    if (!start || now-start>=60000) { start=now; count=0; }
    if (count>=60) return fail("pending_retryable","rate_limited");
    nk.localcachePut(key,String(start)+":"+String(count+1),60);
    var b:{[key:string]:unknown};
    try { b=JSON.parse(payload) as {[key:string]:unknown}; } catch (_e) { return fail("invalid","malformed"); }
    if (!b || typeof b!=="object" || Array.isArray(b) || Object.keys(b).sort().join(",")!=="lastSequence,lastTick,protocol,runId"
      || b.protocol!==2 || typeof b.runId!=="string" || !UUID.test(b.runId)
      || typeof b.lastSequence!=="number" || Math.floor(b.lastSequence)!==b.lastSequence || b.lastSequence< -1 || b.lastSequence>4095
      || typeof b.lastTick!=="number" || Math.floor(b.lastTick)!==b.lastTick || b.lastTick<0 || b.lastTick>162000
      || (b.lastSequence===-1)!==(b.lastTick===0)) return fail("invalid","malformed");
    var result=ShooterRewards.queryJson(nk,"SELECT game.shooter_verification_finish($1::uuid,$2::uuid,$3::text,$4::int,$5::int)::text AS result",
      [ctx.userId,vars.sid,b.runId,b.lastSequence,b.lastTick]);
    if (result.state==="sealed") HubFault.apply(ctx,nk,ctx.userId,"shooter.finish.after_commit");
    return JSON.stringify(result);
  }
}
function rpcShooterRunFinish(c:nkruntime.Context,l:nkruntime.Logger,n:nkruntime.Nakama,p:string):string {
  return guard(ShooterVerificationLifecycle.finish,c,l,n,p);
}
