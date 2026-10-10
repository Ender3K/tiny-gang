const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function queue(){const context=vm.createContext({AbortController});vm.runInContext(html.slice(html.indexOf('function createSlideImageQueue('),html.indexOf('function slideCacheKey(')),context);return context.createSlideImageQueue(2)}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function held(key,events,releases){return signal=>new Promise((resolve,reject)=>{events.push(key);releases[key]=resolve;const abort=()=>reject(new Error('aborted'));if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true})})}
test('current slides interrupt a background load and preserve the two-load limit',async()=>{
  const q=queue(),events=[],releases={};
  const a=q.add('a',2,held('a',events,releases));const b=q.add('b',2,held('b',events,releases));
  const bg=q.add('background',2,held('background',events,releases));const current=q.add('current',0,held('current',events,releases));
  await tick();assert.deepEqual(events,['a','b','current']);
  // The interrupted preload keeps its promise and resumes when a slot opens.
  releases.b();await b;await tick();assert.deepEqual(events,['a','b','current','background']);
  releases.current();await current;await tick();assert.deepEqual(events,['a','b','current','background','a']);
  releases.a();releases.background();await Promise.all([a,bg]);
});
test('a queued prefetch is promoted when it becomes the current slide; obsolete prefetches are removed',async()=>{
  const q=queue(),events=[],releases={};const a=q.add('a',2,held('a',events,releases));const b=q.add('b',2,held('b',events,releases));
  const future=q.add('future',2,held('future',events,releases));const next=q.add('next',2,held('next',events,releases));const obsolete=q.add('old',2,()=>assert.fail('obsolete load ran'));
  const removed=assert.rejects(obsolete,/no longer needed/);q.promote('next',0);q.prune(new Set(['a','b','future','next']));await removed;
  await tick();assert.equal(events[2],'next');releases.b();await b;await tick();
  releases.next();await next;await tick();releases.a();releases.future();await Promise.all([a,future]);
});

test('promoting a running preload protects it from interruption',async()=>{
  const q=queue(),events=[],releases={};
  const current=q.add('next',2,held('next',events,releases));
  const background=q.add('background',2,held('background',events,releases));
  await tick();q.promote('next',0);
  const other=q.add('other',0,held('other',events,releases));await tick();
  assert.deepEqual(events,['next','background','other']);
  releases.next();await current;await tick();assert.deepEqual(events,['next','background','other','background']);
  releases.other();releases.background();await Promise.all([other,background]);
});

test('pruning aborts obsolete running work without restarting it',async()=>{
  const q=queue(),events=[],releases={};
  const old=q.add('old',0,held('old',events,releases)),keep=q.add('keep',2,held('keep',events,releases));
  const rejected=assert.rejects(old,/aborted/);await tick();q.prune(new Set(['keep','current']));
  const current=q.add('current',0,held('current',events,releases));await rejected;await tick();
  assert.deepEqual(events,['old','keep','current']);releases.keep();releases.current();await Promise.all([keep,current]);
});

test('a preload interrupted just before becoming current still completes its original promise',async()=>{
  const q=queue(),events=[],releases={};
  const next=q.add('next',2,held('next',events,releases)),other=q.add('other',2,held('other',events,releases));
  await tick();const current=q.add('current',0,held('current',events,releases));q.promote('next',0);
  await tick();assert.deepEqual(events,['next','other','current','next']);
  // Two foreground loads remain; the second background task was interrupted.
  releases.next();releases.current();await Promise.all([next,current]);await tick();
  releases.other();await other;assert.equal(events.filter(key=>key==='other').length,2);
});
test('leaving a room cancels queued work and aborts running loads',async()=>{
  const q=queue();const signals=[];const run=signal=>new Promise((resolve,reject)=>{signals.push(signal);signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true})});
  const a=q.add('a',0,run);const b=q.add('b',2,run);const c=q.add('queued',2,()=>assert.fail('cancelled job ran'));
  const checks=[assert.rejects(a,/aborted/),assert.rejects(b,/aborted/),assert.rejects(c,/no longer needed/)];await tick();q.reset();await Promise.all(checks);assert(signals.every(signal=>signal.aborted));await tick();assert.equal(await q.add('new',0,()=> 'ready'),'ready');
});
