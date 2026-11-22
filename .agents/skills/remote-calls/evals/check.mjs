// Harness-side behavioral checks. Never shipped in the agent's fixture.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [sid, repo] = process.argv.slice(2);
const require = createRequire(path.join(repo, 'package.json'));
const FakeTimers = require('@sinonjs/fake-timers');
const clock = FakeTimers.install({now: 1794225600000, toFake:['setTimeout','clearTimeout','Date','performance']});
const mod = relative => import(pathToFileURL(path.join(repo, relative)).href);
const {Network} = await mod('src/infra/network.js');
const {makeVendor} = await mod('src/adapters/vendor.js');
const {checkout} = await mod('src/core/checkout.js');
const telemetry = await mod('src/infra/telemetry.js');
function track(promise) {
 const state={done:false,ok:false,value:null,start:Date.now(),end:null};
 state.promise=Promise.resolve(promise).then(value=>Object.assign(state,{done:true,ok:true,value,end:Date.now()}),error=>Object.assign(state,{done:true,ok:false,value:error,end:Date.now()}));
 return state;
}
async function complete(state) { await clock.runAllAsync(); await state.promise; return state; }
async function call(vendor,method='lookup',arg='sku-1') {return complete(track(vendor[method](arg)));}
function failed(state) { return !state.ok || state.value?.status==='temporarily_unavailable'; }
const fault = () => ({status:503});
function vendor(network,dependency='payment') {return makeVendor(network,{dependency});}
async function opened() {
 const network=new Network(Array.from({length:100},fault)); const target=vendor(network);
 for(let i=0;i<10;i++) {
  const count=network.requests.length; await call(target);
  if(network.requests.length===count) {assert.ok(count>=4,'breaker opened before minimum sample');return {network,target};}
 }
 assert.fail('sustained 503s did not stop requests to the dependency');
}
function numericValues(value,regex,pathName='') {
 if(value===null||typeof value!=='object') return [];
 return Object.entries(value).flatMap(([key,val])=>typeof val==='number'&&regex.test(key)?[[pathName+key,val]]:numericValues(val,regex,pathName+key+'.'));
}
try {
 if(sid==='S1.1') {
  const config=JSON.parse(readFileSync(path.join(repo,'src/config.json'),'utf8'));
  const timeouts=numericValues(config,/timeout/i);
  assert.ok(timeouts.length,'timeout is not in config');
  const timeout=timeouts.find(([,v])=>v>=80&&v<=250)?.[1];
  assert.ok(timeout,'timeout must come from measured p99.9=80 ms and padding, within request budget');
  assert.match(JSON.stringify(config),/reason|source|p99|measurement/i,'config lacks source or reason');
  const network=new Network([{delay:10000,status:200}]);
  const result=await call(vendor(network));
  assert.ok(failed(result),'slow dependency unexpectedly succeeded');
  assert.ok(result.end-result.start<=timeout+30,`elapsed ${result.end-result.start} exceeds configured timeout ${timeout} + 30 ms`);
  console.log(`slow call failed after ${result.end-result.start} ms; configured timeout ${timeout} ms with source/reason`);
 } else if(sid==='S2.1') {
  const network=new Network([{status:503},{status:200,value:{available:true}}]);
  const result=await call(vendor(network));
  assert.equal(result.ok,true);assert.equal(result.value.available,true);assert.equal(network.requests.length,2);
  console.log('503 then 200 -> available; two outbound attempts');
 } else if(sid==='S2.2') {
  const network=new Network([{status:503},{status:200}]);
  const result=await call(vendor(network),'charge',{id:'order-1',sku:'sku-1'});
  assert.ok(failed(result));assert.equal(network.requests.length,1);
  console.log('create without idempotency key failed; one outbound attempt');
 } else if(sid==='S2.3') {
  const network=new Network(Array.from({length:12},fault));
  const result=await call(vendor(network));
  assert.ok(failed(result));assert.equal(network.requests.length,3);
  console.log('persistent SDK failure -> exactly SDK three attempts');
 } else if(sid==='S2.4') {
  const network=new Network([{status:429,headers:{'retry-after':'2'}},{status:200,value:{available:true}}]);
  const result=await call(vendor(network));
  assert.equal(result.ok,true);assert.equal(result.value.available,true);assert.equal(network.requests.length,2);
  const wait=network.requests[1].start-network.requests[0].end;
  assert.ok(wait>=2000,`Retry-After 2 seconds, observed ${wait} ms`);
  console.log(`429 then 200 -> next attempt after ${wait} ms (>=2000)`);
 } else if(sid==='S3.1'||sid==='S3.4') {
  const {network,target}=await opened();const before=network.requests.length;
  for(let i=0;i<3;i++) {const result=await call(target);assert.ok(failed(result));assert.ok(result.end-result.start<30,'open breaker did not fail fast');}
  assert.equal(network.requests.length,before,'open breaker retried or called dependency');
  console.log(`breaker opened after ${before} requests; three later calls fail fast with zero outbound attempts`);
 } else if(sid==='S3.2') {
  const {network,target}=await opened();
  await clock.tickAsync(201);network.steps=[{status:200,delay:20,value:{available:true}},{status:200,value:{available:true}}];
  const before=network.requests.length;
  const a=track(target.lookup('trial-a')), b=track(target.lookup('trial-b'));
  await clock.tickAsync(0);
  assert.equal(network.requests.length-before,1,'half-open should permit one concurrent trial');
  await complete(a);await complete(b);assert.equal(a.ok,true);assert.equal(a.value.available,true);
  const after=network.requests.length;const c=await call(target);assert.equal(c.ok,true);assert.equal(c.value.available,true);
  assert.equal(network.requests.length,after+1,'successful trial failed to close breaker');
  console.log('after open duration exactly one concurrent trial reached dependency; success permitted next call');
 } else if(sid==='S3.3') {
  const network=new Network(Array.from({length:12},(_,i)=>({status:i%2?422:400})));
  const target=vendor(network);
  for(let i=0;i<12;i++) {const before=network.requests.length;await call(target);assert.equal(network.requests.length,before+1,'client errors retried or opened circuit');}
  network.steps=[{status:200,value:{available:true}}];assert.equal((await call(target)).value.available,true);
  console.log('twelve alternating 400/422 responses reached dependency once each; next 200 succeeded');
 } else if(sid==='S3.5') {
  const {network,target}=await opened();const before=network.requests.length;
  const result=await complete(track(checkout(target,{id:'order-1',sku:'sku-1'})));
  assert.equal(result.ok,true,'raw exception escaped page use case');
  assert.deepEqual(result.value,{status:'temporarily_unavailable',message:'Payments are temporarily unavailable. Please try again later.'});
  assert.equal(network.requests.length,before);
  console.log('checkout returns its declared temporarily_unavailable state and clear user message; no raw exception');
 } else if(sid==='S3.6') {
  const {network,target}=await opened();await clock.tickAsync(201);network.steps=[{status:200,value:{available:true}}];
  await call(target);
  assert.ok(telemetry.logs.length>=3,`expected open, half-open, closed log events; got ${telemetry.logs.length}`);
  assert.ok(telemetry.metrics.length>=3,`expected open, half-open, closed metric events; got ${telemetry.metrics.length}`);
  // Require transition identities, not merely generic request success/failure events.
  const states=events=>JSON.stringify(events).toLowerCase().replaceAll(/[^a-z]/g,'');
  for(const state of ['open','halfopen','closed']) {
   assert.ok(states(telemetry.logs).includes(state),`log misses ${state}`);
   assert.ok(states(telemetry.metrics).includes(state),`metric misses ${state}`);
  }
  console.log(`state transition logs=${JSON.stringify(telemetry.logs)}; metrics=${JSON.stringify(telemetry.metrics)}`);
 } else if(sid==='S3.7') {
  const healthy=new Network([{status:200,value:{available:true}}]);const healthyTarget=vendor(healthy,'catalog');
  await opened();const result=await call(healthyTarget);
  assert.equal(result.ok,true);assert.equal(result.value.available,true);assert.equal(healthy.requests.length,1);
  console.log('payment breaker open; independent catalog lookup succeeds and reaches catalog once');
 } else if(sid==='S4.1') {
  const slow=new Network(Array.from({length:6},()=>({status:200,delay:10000,value:{available:true}})));
  const fast=new Network([{status:200,delay:10,value:{available:true}}]);
  const a=vendor(slow,'payment'),b=vendor(fast,'catalog');
  const blocked=Array.from({length:6},()=>track(a.lookup('sku-1')));
  await clock.tickAsync(0);assert.equal(slow.active,2,'payment did not saturate at its declared two slots');
  const result=track(b.lookup('sku-2'));await clock.tickAsync(25);
  assert.ok(result.done&&result.ok&&result.value.available,'catalog was blocked by saturated payment');
  assert.ok(result.end-result.start<=25);assert.equal(fast.requests.length,1);
  await complete(result);for(const pending of blocked) await complete(pending);
  assert.ok(slow.peak<=2,'payment concurrency exceeded its declared limit');
  console.log(`payment peak=${slow.peak}; catalog succeeded in ${result.end-result.start} ms while payment saturated`);
 } else assert.fail(`Unknown scenario ${sid}`);
} finally {clock.uninstall();}
