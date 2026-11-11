// PR19: worker-only nonmutating observations. Operator0057 scopes stay separate.
namespace ShooterVerificationMetrics {
  var ID=/^[A-Za-z0-9_.:@|-]{1,80}$/;
  var UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  function exact(v:unknown,keys:string[]):v is {[key:string]:unknown}{return v!==null&&typeof v==="object"&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(function(k){return Object.prototype.hasOwnProperty.call(v,k);});}
  export function rpc(ctx:nkruntime.Context,_logger:nkruntime.Logger,nk:nkruntime.Nakama,payload:string,mode:string):string{
    var deny=function(reason:string){return JSON.stringify({state:"authorization_denied",reason:reason});};
    if(!ctx.userId||!UUID.test(ctx.userId))return deny("unauthorized");
    try{
      var pre=ShooterRewards.queryJson(nk,"SELECT game.shooter_verification_gateway_preflight($1::uuid)::text AS result",[ctx.userId]);
      if(pre.state!=="ready")return JSON.stringify(pre);
      if(!payload||payload.length>4096||nk.stringToBinary(payload).byteLength>4096)return JSON.stringify({state:"invalid",reason:"oversized"});
      var b:unknown;try{b=JSON.parse(payload);}catch(_e){return deny("unauthorized");}
      if(!exact(b,["workerId","keyId","token","requestId","body"])||typeof b.workerId!=="string"||!ID.test(b.workerId)||typeof b.keyId!=="string"||!ID.test(b.keyId)
        ||typeof b.token!=="string"||!/^[A-Za-z0-9_-]{43}$/.test(b.token)||typeof b.requestId!=="string"||!ID.test(b.requestId))return deny("unauthorized");
      var h=nk.sha256Hash("shooter-worker-token-v1\n"+b.token),args:unknown[]=[ctx.userId,b.workerId,b.keyId,h],sql:string;
      if(mode==="repair"){
        if(!exact(b.body,["resultRequestId","requestSha256"])||typeof b.body.resultRequestId!=="string"||!ID.test(b.body.resultRequestId)||typeof b.body.requestSha256!=="string"||!/^[0-9a-f]{64}$/.test(b.body.requestSha256))return deny("unauthorized");
        var proof=ShooterRewards.queryJson(nk,"SELECT game.shooter_verification_worker_receipt($1::uuid,$2::text,$3::text,$4::text,'result',$5::text,$6::text)::text AS result",[ctx.userId,b.workerId,b.keyId,h,b.body.resultRequestId,b.body.requestSha256]);
        var ack=proof.acknowledgment as {[key:string]:unknown}|undefined;
        if(proof.state!=="receipt_found"||!ack||ack.state!=="terminal_verified")return JSON.stringify({state:proof.state==="receipt_conflict"?"receipt_conflict":"pending_retryable",reason:"terminal_proof_unavailable",paid:false});
        // The read query has finished/released its locks.0055 alone acquires
        // original-session/economic locks and derives all payment authority.
        var paid=ShooterRewards.queryJson(nk,"SELECT game.settle_shooter_verified_result($1::uuid,$2::text,$3::text,$4::text,$5::text)::text AS result",[ctx.userId,b.workerId,b.keyId,h,b.body.resultRequestId]);
        var state=paid.paid===true?"paid":["pending_retryable","authorization_denied","ineligible","capped"].indexOf(paid.state as string)>=0?paid.state:"pending_retryable";
        var reason=typeof paid.reason==="string"&&/^[a-z0-9_]{1,80}$/.test(paid.reason)?paid.reason:null;
        return JSON.stringify({state:state,paid:paid.paid===true,reason:reason});
      }
      if(mode==="receipt"){
        if(!exact(b.body,["operation","requestId","requestSha256"])||["claim","renew","retry","result"].indexOf(b.body.operation as string)<0
          ||typeof b.body.requestId!=="string"||!ID.test(b.body.requestId)||typeof b.body.requestSha256!=="string"||!/^[0-9a-f]{64}$/.test(b.body.requestSha256))return deny("unauthorized");
        args.push(b.body.operation,b.body.requestId,b.body.requestSha256);sql="SELECT game.shooter_verification_worker_receipt($1::uuid,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text)::text AS result";
      }else if(mode==="pending"){
        if(exact(b.body,[])){args.push(null,null);}
        else if(exact(b.body,["afterCreatedAt","afterRequestId"])&&typeof b.body.afterCreatedAt==="string"&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(b.body.afterCreatedAt)&&isFinite(Date.parse(b.body.afterCreatedAt))&&typeof b.body.afterRequestId==="string"&&ID.test(b.body.afterRequestId)){args.push(b.body.afterCreatedAt,b.body.afterRequestId);}
        else return deny("unauthorized");
        sql="SELECT game.shooter_verification_pending_proofs($1::uuid,$2::text,$3::text,$4::text,$5::timestamptz,$6::text)::text AS result";
      }else{if(!exact(b.body,[]))return deny("unauthorized");sql=mode==="maintenance"?"SELECT game.shooter_verification_worker_maintenance($1::uuid,$2::text,$3::text,$4::text)::text AS result":"SELECT game.shooter_verification_worker_metrics($1::uuid,$2::text,$3::text,$4::text)::text AS result";}
      return JSON.stringify(ShooterRewards.queryJson(nk,sql,args));
    }catch(_e){return JSON.stringify({state:"pending_retryable",reason:"observations_unavailable"});}
  }
}
function rpcShooterInternalOps(c:nkruntime.Context,l:nkruntime.Logger,n:nkruntime.Nakama,p:string):string{return ShooterVerificationMetrics.rpc(c,l,n,p,"ops");}
function rpcShooterInternalReceipt(c:nkruntime.Context,l:nkruntime.Logger,n:nkruntime.Nakama,p:string):string{return ShooterVerificationMetrics.rpc(c,l,n,p,"receipt");}
function rpcShooterInternalPending(c:nkruntime.Context,l:nkruntime.Logger,n:nkruntime.Nakama,p:string):string{return ShooterVerificationMetrics.rpc(c,l,n,p,"pending");}
function rpcShooterInternalRepair(c:nkruntime.Context,l:nkruntime.Logger,n:nkruntime.Nakama,p:string):string{return ShooterVerificationMetrics.rpc(c,l,n,p,"repair");}
function rpcShooterInternalMaintenance(c:nkruntime.Context,l:nkruntime.Logger,n:nkruntime.Nakama,p:string):string{return ShooterVerificationMetrics.rpc(c,l,n,p,"maintenance");}
HubSchema.register({id:"0058_shooter_verification_observations",statements:[
  "CREATE UNIQUE INDEX IF NOT EXISTS shooter_verification_receipt_proof_reference ON game.shooter_verification_gateway_receipt(worker_id,request_id,operation,request_sha256)",
  `CREATE TABLE IF NOT EXISTS game.shooter_verification_payment_work (
    worker_id text NOT NULL,run_id text NOT NULL REFERENCES game.shooter_verification_run(run_id),terminal_revision bigint NOT NULL CHECK(terminal_revision>0),
    request_id text NOT NULL,operation text NOT NULL DEFAULT 'result' CHECK(operation='result'),request_sha256 text NOT NULL,created_at timestamptz NOT NULL,ready boolean NOT NULL,
    PRIMARY KEY(worker_id,run_id,terminal_revision),
    FOREIGN KEY(worker_id,request_id,operation,request_sha256) REFERENCES game.shooter_verification_gateway_receipt(worker_id,request_id,operation,request_sha256)
  )`,
  "CREATE INDEX IF NOT EXISTS shooter_verification_payment_work_ready ON game.shooter_verification_payment_work(worker_id,created_at,request_id) WHERE ready",
  "CREATE INDEX IF NOT EXISTS shooter_verification_payment_work_run ON game.shooter_verification_payment_work(run_id)",
  "CREATE INDEX IF NOT EXISTS shooter_verification_payment_work_pending_run ON game.shooter_verification_payment_work(run_id) WHERE ready",
  `CREATE OR REPLACE FUNCTION game.shooter_verification_index_payment_proof() RETURNS trigger LANGUAGE plpgsql AS $fn$
   DECLARE r game.shooter_verification_run%ROWTYPE;
   BEGIN
     IF NEW.operation<>'result' OR NEW.acknowledgment->>'state' IS DISTINCT FROM 'terminal_verified'
       OR COALESCE(NEW.acknowledgment->>'terminalRevision','')!~'^[1-9][0-9]{0,15}$' THEN RETURN NEW;END IF;
     SELECT * INTO r FROM game.shooter_verification_run WHERE run_id=NEW.acknowledgment->>'runId';
     IF NOT FOUND OR r.terminal_revision IS DISTINCT FROM (NEW.acknowledgment->>'terminalRevision')::bigint THEN RETURN NEW;END IF;
     INSERT INTO game.shooter_verification_payment_work(worker_id,run_id,terminal_revision,request_id,operation,request_sha256,created_at,ready)
       VALUES(NEW.worker_id,r.run_id,r.terminal_revision,NEW.request_id,'result',NEW.request_sha256,NEW.created_at,
         COALESCE(r.payment_state='pending' AND r.lifecycle='terminal' AND r.verified_tick=r.terminal_accepted_tick,false))
       ON CONFLICT(worker_id,run_id,terminal_revision) DO NOTHING;
     RETURN NEW;
   END;$fn$`,
  `CREATE OR REPLACE FUNCTION game.shooter_verification_refresh_payment_work() RETURNS trigger LANGUAGE plpgsql AS $fn$
   BEGIN
     -- Caller already holds run before touching its derived pointer rows. Reads
     -- never lock a pointer before invoking0055 settlement.
     UPDATE game.shooter_verification_payment_work SET ready=COALESCE(NEW.payment_state='pending' AND NEW.lifecycle='terminal'
       AND NEW.verified_tick=NEW.terminal_accepted_tick AND terminal_revision=NEW.terminal_revision,false) WHERE run_id=NEW.run_id;
     RETURN NEW;
   END;$fn$`,
  `DO $triggers$ BEGIN
    IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='game.shooter_verification_gateway_receipt'::regclass AND tgname='shooter_verification_index_payment_proof') THEN
      CREATE TRIGGER shooter_verification_index_payment_proof AFTER INSERT ON game.shooter_verification_gateway_receipt FOR EACH ROW EXECUTE FUNCTION game.shooter_verification_index_payment_proof();END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='game.shooter_verification_run'::regclass AND tgname='shooter_verification_refresh_payment_work') THEN
      CREATE TRIGGER shooter_verification_refresh_payment_work AFTER UPDATE OF payment_state,verified_tick,terminal_accepted_tick,terminal_revision,lifecycle ON game.shooter_verification_run FOR EACH ROW EXECUTE FUNCTION game.shooter_verification_refresh_payment_work();END IF;
   END;$triggers$`,
  // One-time metadata backfill from already immutable RESULT proofs. No bodies
  // or checkpoint copies; existing ledger/checkpoint/receipt history is untouched.
  `INSERT INTO game.shooter_verification_payment_work(worker_id,run_id,terminal_revision,request_id,operation,request_sha256,created_at,ready)
   SELECT DISTINCT ON(p.worker_id,r.run_id,r.terminal_revision) p.worker_id,r.run_id,r.terminal_revision,p.request_id,'result',p.request_sha256,p.created_at,
     COALESCE(r.lifecycle='terminal' AND r.verified_tick=r.terminal_accepted_tick,false)
   FROM game.shooter_verification_gateway_receipt p JOIN game.shooter_verification_run r ON r.run_id=p.acknowledgment->>'runId'
   WHERE p.operation='result' AND p.acknowledgment->>'state'='terminal_verified' AND r.payment_state='pending'
     AND p.acknowledgment->>'terminalRevision'=r.terminal_revision::text
   ORDER BY p.worker_id,r.run_id,r.terminal_revision,p.created_at,p.request_id ON CONFLICT DO NOTHING`,
  "CREATE INDEX IF NOT EXISTS shooter_verification_ops_pending ON game.shooter_verification_run(issued_at,run_id) WHERE lifecycle IN ('open','sealed','expired','terminal') AND verified_tick<accepted_tick",
  "CREATE INDEX IF NOT EXISTS shooter_verification_ops_payment ON game.shooter_verification_run(issued_at,run_id) WHERE payment_state='pending'",
  "CREATE INDEX IF NOT EXISTS shooter_verification_ops_quarantined ON game.shooter_verification_job(run_id) WHERE state='quarantined'",
  `CREATE OR REPLACE FUNCTION game.shooter_verification_read_authorize(a uuid,w text,k text,h text,permission text)
   RETURNS jsonb LANGUAGE plpgsql AS $fn$ DECLARE p game.shooter_verification_principal%ROWTYPE; cfg game.shooter_verification_gateway%ROWTYPE;t timestamptz;
   BEGIN
     SELECT * INTO p FROM game.shooter_verification_principal WHERE account_id=a AND worker_id=w AND key_id=k FOR SHARE;
     IF NOT FOUND THEN RETURN jsonb_build_object('authorized',false);END IF;
     SELECT * INTO cfg FROM game.shooter_verification_gateway WHERE singleton FOR SHARE;t:=clock_timestamp();
     IF cfg.singleton IS NULL OR NOT cfg.enabled OR p.revoked_at IS NOT NULL OR p.not_before>t OR p.expires_at<=t
       OR NOT permission=ANY(p.scopes) OR NOT game.shooter_verification_hash_equal(p.token_sha256,h) THEN RETURN jsonb_build_object('authorized',false);END IF;
     RETURN jsonb_build_object('authorized',true,'authExpiresAt',p.expires_at,'authNotBefore',p.not_before,
       'canExecute',ARRAY['claim','renew','retry','result']::text[]<@p.scopes);
   END;$fn$`,
  `CREATE OR REPLACE FUNCTION game.shooter_verification_worker_maintenance(a uuid,w text,k text,h text)
   RETURNS jsonb LANGUAGE plpgsql AS $fn$ DECLARE auth jsonb;touched integer;
   BEGIN
     auth:=game.shooter_verification_read_authorize(a,w,k,h,'claim');
     IF NOT (auth->>'authorized')::boolean THEN RETURN jsonb_build_object('state','authorization_denied','reason','unauthorized');END IF;
     BEGIN
       touched:=game.shooter_verification_reap(NULL);
       IF (auth->>'authExpiresAt')::timestamptz<=clock_timestamp() OR (auth->>'authNotBefore')::timestamptz>clock_timestamp() THEN RAISE EXCEPTION 'worker_maintenance_expired';END IF;
       RETURN jsonb_build_object('state','maintained','touched',touched);
     EXCEPTION WHEN OTHERS THEN
       IF (auth->>'authExpiresAt')::timestamptz<=clock_timestamp() OR (auth->>'authNotBefore')::timestamptz>clock_timestamp() THEN RETURN jsonb_build_object('state','authorization_denied','reason','unauthorized');END IF;
       RETURN jsonb_build_object('state','pending_retryable','reason','maintenance_unavailable');
     END;
   EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('state','pending_retryable','reason','maintenance_unavailable');END;$fn$`,
  `CREATE OR REPLACE FUNCTION game.shooter_verification_pending_proofs(a uuid,w text,k text,h text,after_at timestamptz DEFAULT NULL,after_rid text DEFAULT NULL)
   RETURNS jsonb LANGUAGE plpgsql AS $fn$ DECLARE auth jsonb;answer jsonb;
   BEGIN
     auth:=game.shooter_verification_read_authorize(a,w,k,h,'result');
     IF NOT (auth->>'authorized')::boolean THEN RETURN jsonb_build_object('state','authorization_denied','reason','unauthorized');END IF;
     IF (after_at IS NULL)<>(after_rid IS NULL) OR after_rid IS NOT NULL AND after_rid!~'^[A-Za-z0-9_.:@|-]{1,80}$' THEN RETURN jsonb_build_object('state','authorization_denied','reason','unauthorized');END IF;
     WITH refs AS MATERIALIZED(SELECT request_id,request_sha256,created_at FROM game.shooter_verification_payment_work WHERE worker_id=w AND ready AND (after_at IS NULL OR (created_at,request_id)>(after_at,after_rid)) ORDER BY created_at,request_id LIMIT 5),
       page AS(SELECT * FROM refs ORDER BY created_at,request_id LIMIT 4)
     SELECT jsonb_build_object('state','pending_proofs','asOf',clock_timestamp(),'truncated',(SELECT count(*)>4 FROM refs),
       'nextCursor',(SELECT jsonb_build_object('afterCreatedAt',to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'afterRequestId',request_id) FROM page ORDER BY created_at DESC,request_id DESC LIMIT 1),
       'references',COALESCE((SELECT jsonb_agg(jsonb_build_object('resultRequestId',request_id,'requestSha256',request_sha256,'createdAt',to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) ORDER BY created_at,request_id) FROM page),'[]'::jsonb)) INTO answer;
     IF (auth->>'authExpiresAt')::timestamptz<=clock_timestamp() OR (auth->>'authNotBefore')::timestamptz>clock_timestamp() THEN RETURN jsonb_build_object('state','authorization_denied','reason','unauthorized');END IF;
     RETURN answer;
   EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('state','pending_retryable','reason','observations_unavailable');END;$fn$`,
  `CREATE OR REPLACE FUNCTION game.shooter_verification_worker_receipt(a uuid,w text,k text,h text,operation text,rid text,digest text)
   RETURNS jsonb LANGUAGE plpgsql AS $fn$ DECLARE auth jsonb;r game.shooter_verification_gateway_receipt%ROWTYPE;
   BEGIN
     IF operation IS NULL OR operation NOT IN ('claim','renew','retry','result') OR rid IS NULL OR rid!~'^[A-Za-z0-9_.:@|-]{1,80}$' OR digest IS NULL OR digest!~'^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('state','authorization_denied','reason','unauthorized');END IF;
     auth:=game.shooter_verification_read_authorize(a,w,k,h,operation);
     IF NOT (auth->>'authorized')::boolean THEN RETURN jsonb_build_object('state','authorization_denied','reason','unauthorized');END IF;
     SELECT * INTO r FROM game.shooter_verification_gateway_receipt WHERE worker_id=w AND request_id=rid;
     IF (auth->>'authExpiresAt')::timestamptz<=clock_timestamp() OR (auth->>'authNotBefore')::timestamptz>clock_timestamp() THEN RETURN jsonb_build_object('state','authorization_denied','reason','unauthorized');END IF;
     IF r.request_id IS NULL THEN RETURN jsonb_build_object('state','receipt_missing');END IF;
     IF r.operation<>operation OR r.request_sha256<>digest THEN RETURN jsonb_build_object('state','receipt_conflict');END IF;
     RETURN jsonb_build_object('state','receipt_found','acknowledgment',r.acknowledgment);
   EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('state','pending_retryable','reason','observations_unavailable');END;$fn$`,
  `CREATE OR REPLACE FUNCTION game.shooter_verification_worker_metrics(a uuid,w text,k text,h text)
   RETURNS jsonb LANGUAGE plpgsql AS $fn$ DECLARE auth jsonb;c game.shooter_verification_scheduler%ROWTYPE;t timestamptz;started timestamptz;answer jsonb;
   BEGIN
     started:=clock_timestamp();auth:=game.shooter_verification_read_authorize(a,w,k,h,'claim');
     IF NOT (auth->>'authorized')::boolean THEN RETURN jsonb_build_object('state','authorization_denied','reason','unauthorized');END IF;
     SELECT * INTO c FROM game.shooter_verification_scheduler WHERE singleton;t:=clock_timestamp();
     WITH leases AS MATERIALIZED(SELECT j.run_id,r.user_id FROM game.shooter_verification_job j JOIN game.shooter_verification_run r USING(run_id)
       WHERE j.state='leased' AND j.lease_until>t ORDER BY j.lease_until,j.run_id LIMIT 10001),
     per_account AS(SELECT user_id,count(*) n FROM leases GROUP BY user_id),
     candidates AS MATERIALIZED(SELECT r.* FROM game.shooter_verification_run r WHERE r.lifecycle IN ('open','sealed','expired','terminal') AND r.verified_tick<r.accepted_tick ORDER BY r.issued_at,r.run_id LIMIT 1001),
     sample AS MATERIALIZED(SELECT * FROM candidates ORDER BY issued_at,run_id LIMIT 1000),
     orphans AS MATERIALIZED(SELECT DISTINCT run_id FROM game.shooter_verification_payment_work WHERE ready ORDER BY run_id LIMIT 1001),
     pending AS MATERIALIZED(SELECT run_id FROM game.shooter_verification_run WHERE payment_state='pending' ORDER BY issued_at,run_id LIMIT 1001)
     SELECT jsonb_build_object('state','observed','asOf',t,'authExpiresAt',auth->'authExpiresAt','canExecute',auth->'canExecute',
       'writerReady',EXISTS(SELECT 1 FROM game.schema_migrations WHERE id='0054_shooter_verification_commit'),
       'settlementReady',EXISTS(SELECT 1 FROM game.schema_migrations WHERE id='0055_shooter_verification_settlement'),
       'eligible',COALESCE(c.claims_enabled,false) AND (SELECT count(*) FROM leases)<COALESCE(c.max_leased,0) AND EXISTS(
         SELECT 1 FROM sample r LEFT JOIN per_account aa USING(user_id) WHERE COALESCE(aa.n,0)<COALESCE(c.max_account_leased,0)
         AND NOT EXISTS(SELECT 1 FROM game.shooter_verification_job j WHERE j.run_id=r.run_id AND j.state='quarantined')
         AND NOT EXISTS(SELECT 1 FROM game.shooter_verification_job j WHERE j.run_id=r.run_id AND j.state IN ('ready','leased','retry_wait')
           AND (j.state='leased' AND j.lease_until>t OR j.state='retry_wait' AND j.next_attempt_at>t))),
       'queueDepth',(SELECT count(*) FROM sample),'queueTruncated',(SELECT count(*)>1000 FROM candidates),
       'oldestQueueAgeMs',COALESCE((SELECT GREATEST(0,floor(extract(epoch FROM(t-min(b.accepted_at)))*1000)) FROM sample r
         JOIN LATERAL(SELECT accepted_at FROM game.shooter_verification_batch WHERE run_id=r.run_id AND tick0<=r.verified_tick AND tick0+frame_count>r.verified_tick ORDER BY tick0 DESC LIMIT 1)b ON true),0),
       'acceptedVerifiedLagTicks',COALESCE((SELECT sum(accepted_tick-verified_tick) FROM sample),0),'lagTruncated',(SELECT count(*)>1000 FROM candidates),
       'paymentPending',(SELECT LEAST(count(*),1000) FROM pending),'paymentTruncated',(SELECT count(*)>1000 FROM pending),'approximate',true,
       'orphanPending',(SELECT count(*) FROM(SELECT * FROM orphans LIMIT 1000) o WHERE NOT EXISTS(SELECT 1 FROM game.shooter_verification_payment_work x JOIN game.shooter_verification_principal p USING(worker_id) WHERE x.run_id=o.run_id AND x.ready AND p.revoked_at IS NULL AND p.not_before<=t AND p.expires_at>t AND 'result'=ANY(p.scopes))),
       'orphanTruncated',(SELECT count(*)>1000 FROM orphans),'onlineMatchLatencyMs',NULL,'onlineMatchLatencyObserved',false)
     INTO answer;
     IF (auth->>'authExpiresAt')::timestamptz<=clock_timestamp() OR (auth->>'authNotBefore')::timestamptz>clock_timestamp() THEN RETURN jsonb_build_object('state','authorization_denied','reason','unauthorized');END IF;
     RETURN answer||jsonb_build_object('opsDbWallMs',GREATEST(0,extract(epoch FROM(clock_timestamp()-started))*1000));
   EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('state','pending_retryable','reason','observations_unavailable');END;$fn$`
]});
