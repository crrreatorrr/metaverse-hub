import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { GatewayClient, gatewayURL } from '../src/gateway-client.mjs';
const auth={workerId:'worker-test',keyId:'key1',token:'a'.repeat(43),accountToken:'test-account-jwt'};
async function server(handler,secure=false) {
  const s=secure?https.createServer({key:readFileSync(process.env.TEST_TLS_KEY),cert:readFileSync(process.env.TEST_TLS_CERT)},handler):http.createServer(handler);
  s.listen(0,'127.0.0.1');await once(s,'listening');
  return {s,url:`${secure?'https':'http'}://127.0.0.1:${s.address().port}`};
}
test('plainHTTP is literal loopback only; URLs cannot embed credential/query/fragment',()=>{
  for(const url of ['http://127.1:7350','http://2130706433:7350','http://0x7f000001:7350','http://localhost:7350','http://example.com','http://127.0.0.1.example.com','https://user:pass@example.com','https://example.com?secret=1','https://example.com/#x'])assert.throws(()=>gatewayURL(url),/unsafe_gateway_url/);
  assert.equal(gatewayURL('https://private.example').protocol,'https:');assert.equal(gatewayURL('http://[::1]:7350').protocol,'http:');
});
test('scoped client sends ordinaryJWT +exactserviceenvelope and retains explicitrequestID across retries',async()=>{
  const seen=[];const {s,url}=await server(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;seen.push({url:req.url,authorization:req.headers.authorization,body:JSON.parse(text)});res.setHeader('content-type','application/json');res.end('{"state":"pending_retryable"}');});
  try{const c=new GatewayClient({url,...auth});assert.ok(!JSON.stringify(c).includes(auth.token));assert.ok(!JSON.stringify(c).includes(auth.accountToken));await c.claim('same-request');await c.claim('same-request');
    assert.equal((await c.claim()).reason,'bad_gateway_request');assert.equal(seen.length,2);assert.deepEqual(seen[0],seen[1]);assert.equal(seen[0].authorization,'Bearer test-account-jwt');assert.equal(seen[0].body.requestId,'same-request');assert.deepEqual(seen[0].body.body,{});
    assert.equal((await c.request('pay',{})).reason,'bad_gateway_request');assert.equal((await c.result({}, {x:'x'.repeat(21*1024*1024)})).reason,'request_oversized');assert.equal(seen.length,2);
  }finally{s.close();}
});
test('redirects never forward credentials and oversize/deadline errors stay operational',async()=>{
  let forwarded=0;const target=await server((_q,r)=>{forwarded++;r.end('{}');});
  const origin=await server((req,res)=>{if(req.url.includes('claim')){res.writeHead(302,{location:target.url});res.end();}else if(req.url.includes('renew')){res.writeHead(200,{'content-length':21*1024*1024});res.end('x');}else{setTimeout(()=>res.end('{}'),300);}});
  try{const c=new GatewayClient({url:origin.url,...auth,timeoutMs:100});assert.equal((await c.claim('redirect-or-tls-test')).reason,'gateway_unavailable');assert.equal(forwarded,0);
    assert.equal((await c.renew({jobId:'job',fence:1,expectedRevision:0})).reason,'response_oversized');
    assert.equal((await c.retry({jobId:'job',fence:1,expectedRevision:0},'worker_crash')).reason,'gateway_unavailable');
  }finally{origin.s.close();target.s.close();}
});
test('cross-host TLS uses normal certificate validation; self-signed certificate is refused',{skip:!process.env.TEST_TLS_KEY},async()=>{
  const {s,url}=await server((_q,res)=>res.end('{}'),true);
  try{const c=new GatewayClient({url,...auth});assert.equal((await c.claim('redirect-or-tls-test')).reason,'gateway_unavailable');}finally{s.close();}
});
test('historical claim must renew exact live fence before replay; no implicit rebind',async()=>{
  const c=new GatewayClient({url:'http://127.0.0.1:7350',...auth});let executes=0;
  const pool={execute:async()=>{executes++;return {};}};
  assert.equal((await c.replayClaim({state:'leased',leaseUntil:'invalid-date',claim:{},work:{}},pool)).reason,'stale_claim');
  c.renew=async()=>({state:'stale'});
  assert.equal((await c.replayClaim({state:'leased',leaseUntil:new Date(Date.now()+1000).toISOString(),claim:{},work:{}},pool)).reason,'stale_claim');assert.equal(executes,0);
});
