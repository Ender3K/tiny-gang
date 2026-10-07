const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function queue(){const context=vm.createContext({AbortController});vm.runInContext(html.slice(html.indexOf('function createSlideImageQueue('),html.indexOf('function slideCacheKey(')),context);return context.createSlideImageQueue(2)}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function held(key,events,releases){return()=>new Promise(resolve=>{events.push(key);releases[key]=resolve})}
test('at most two loads run, and current slides go ahead of queued background slides',async()=>{
  const q=queue(),events=[],releases={};
  const a=q.add('a',2,held('a',events,releases));const b=q.add('b',2,held('b',events,releases));
  const bg=q.add('background',2,held('background',events,releases));const current=q.add('current',0,held('current',events,releases));
  await tick();assert.deepEqual(events,['a','b']);releases.a();await a;await tick();assert.deepEqual(events,['a','b','current']);
  releases.b();await b;await tick();assert.deepEqual(events,['a','b','current','background']);releases.current();releases.background();await Promise.all([current,bg]);
});
test('a queued prefetch is promoted when it becomes the current slide; obsolete prefetches are removed',async()=>{
  const q=queue(),events=[],releases={};const a=q.add('a',2,held('a',events,releases));const b=q.add('b',2,held('b',events,releases));
  const future=q.add('future',2,held('future',events,releases));const next=q.add('next',2,held('next',events,releases));const obsolete=q.add('old',2,()=>assert.fail('obsolete load ran'));
  const removed=assert.rejects(obsolete,/no longer needed/);q.promote('next',0);q.prune(new Set(['a','b','future','next']));await removed;
  await tick();releases.a();await a;await tick();assert.equal(events[2],'next');releases.b();await b;await tick();releases.next();releases.future();await Promise.all([next,future]);
});
test('leaving a room cancels queued work and aborts running loads',async()=>{
  const q=queue();const signals=[];const run=signal=>new Promise((resolve,reject)=>{signals.push(signal);signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true})});
  const a=q.add('a',0,run);const b=q.add('b',2,run);const c=q.add('queued',2,()=>assert.fail('cancelled job ran'));
  const checks=[assert.rejects(a,/aborted/),assert.rejects(b,/aborted/),assert.rejects(c,/no longer needed/)];await tick();q.reset();await Promise.all(checks);assert(signals.every(signal=>signal.aborted));await tick();assert.equal(await q.add('new',0,()=> 'ready'),'ready');
});
