const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const src=page=>'https://lh7-us.googleusercontent.com/'+page;
const shared=(page='p1',changes={})=>({src:src(page),expiresAt:2200000,pageId:page,cacheVersion:'v1',...changes});
function app({host=false,images,failImage,imageHook,service,writeError=false}={}){
  let now=1000000,timerId=0;const timers=new Map(),calls=[],writes=[],signals=[],imageInstances=[];
  const room={code:'TEST42',hostId:'host',state:'playing',currentSlide:1,slidesUrl:'deck',imageCacheVersion:'v1',slidePageIds:['p1','p2','p3','p4'],timer:{paused:true,remainingMs:12345},players:{host:{id:'host'},player:{id:'player'}}};
  if(images)room.sharedSlideImages=images;
  const math=Object.create(Math);math.random=()=>0;
  const context=vm.createContext({URL,AbortController,Math:math,Date:{now:()=>now},connected:true,roomEntryRevision:1,
    me:{id:host?'host':'player',isMaster:host,code:room.code},_latestRoom:room,myKey:()=>host?'host':'player',
    APPS_SCRIPT_WEBAPP_URL:'https://example.com/exec',slideImageCache:{},slideImagePromises:{},getSlideId:url=>url==='other'?'other':'deck',
    setTimeout(callback,ms){timers.set(++timerId,{callback,due:now+ms});return timerId;},clearTimeout:id=>timers.delete(id),
    Image:class {constructor(){imageInstances.push(this);}set src(value){this.source=value;if(value && !imageHook?.(value,this))queueMicrotask(()=>failImage?.(value)?this.onerror?.():this.onload?.());}},
    async requestAppsScript(url,signal){calls.push(url);signals.push(signal);if(service)return service(url,signal,calls.length);const page=new URL(url).searchParams.get('pageId');return{ok:true,imageUrl:src('direct-'+page),expiresAt:2200000};},
    window:{_db:{},_ref:(_db,path)=>path,async _transaction(path,fn){
      if(writeError)throw new Error('Permission denied');
      const value=fn(room.sharedSlideImages || null);
      if(value){room.sharedSlideImages=value;writes.push({path,value});}
      return{committed:!!value};
    }}
  });
  vm.runInContext(html.slice(html.indexOf('function createSlideImageQueue('),html.indexOf('async function prefetchSlide(')),context);
  context.slideImageQueue=context.createSlideImageQueue(2);
  return{context,room,calls,writes,timers,signals,imageInstances,details:()=>JSON.parse(context.getSlideLoadingDetails()),get:(page='p1',priority=0)=>context.fetchSlideImageDataUrl('deck',page,'v1',priority),async advance(ms){
    const target=now+ms;await tick();
    while(true){const next=[...timers].sort((a,b)=>a[1].due-b[1].due).find(([,t])=>t.due<=target);if(!next)break;
      const[id,timer]=next;now=timer.due;timers.delete(id);timer.callback();await tick();}
    now=target;await tick();
  }};
}

test('players and refreshed browsers decode the room URL without a slide-service request',async()=>{
  for(let refresh=0;refresh<2;refresh++){
    const a=app({images:{1:shared()}});assert.equal(await a.get(),src('p1'));
    assert.equal(a.calls.length,0);assert.equal(a.writes.length,0);assert.equal(a.timers.size,0);
  }
});

function stalledService(signal){
  return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{const error=new Error('cancelled');error.name='AbortError';reject(error);},{once:true}));
}

test('a late host URL recovers a stalled fallback, cancels its request, and clears every timer',async()=>{
  const a=app({service:(_url,signal)=>stalledService(signal)}),loading=a.get();
  await a.advance(5000);assert.equal(a.calls.length,1);assert.equal(a.signals[0].aborted,false);
  a.room.sharedSlideImages={1:shared()};await a.advance(250);
  assert.equal(await loading,src('p1'));assert.equal(a.signals[0].aborted,true);
  assert.equal(a.timers.size,0);assert.equal(Object.keys(a.context.slideImagePromises).length,0);
  const record=a.details().loads.at(-1);assert.equal(record.status,'loaded');assert.equal(record.source,'late-room-share');
  assert(record.events.some(e=>e.stage==='service' && e.outcome==='cancelled'));
  assert(record.events.some(e=>e.stage==='late-shared-image' && e.outcome==='ok'));
  await a.advance(60000);assert.equal(a.calls.length,1);
});

test('a successful fallback stops watching and ignores later host publications',async()=>{
  let complete;const a=app({service:()=>new Promise(resolve=>{complete=resolve})}),loading=a.get();
  await a.advance(2000);complete({ok:true,imageUrl:src('direct-p1'),expiresAt:2200000});await tick();
  assert.equal(await loading,src('direct-p1'));assert.equal(a.timers.size,0);
  a.room.sharedSlideImages={1:shared()};await a.advance(10000);
  assert.equal(a.imageInstances.length,1);assert.equal(a.details().loads.at(-1).source,'service');
});

test('an invalid late host image cannot discard a successful service response',async()=>{
  let complete;const a=app({failImage:url=>url===src('bad'),service:()=>new Promise(resolve=>{complete=resolve})}),loading=a.get();
  await a.advance(2000);a.room.sharedSlideImages={1:shared('p1',{src:src('bad')})};await a.advance(1000);
  assert.equal(a.imageInstances.filter(i=>i.source===src('bad')).length,1);
  complete({ok:true,imageUrl:src('direct-p1'),expiresAt:2200000});await tick();
  assert.equal(await loading,src('direct-p1'));assert.equal(a.timers.size,0);assert.equal(a.calls.length,1);
});

test('a fresh late host URL can recover after an earlier shared URL failed',async()=>{
  const a=app({failImage:url=>url===src('bad'),service:(_url,signal)=>stalledService(signal)}),loading=a.get();
  await a.advance(2000);a.room.sharedSlideImages={1:shared('p1',{src:src('bad')})};await a.advance(250);
  a.room.sharedSlideImages[1]=shared();await a.advance(250);
  assert.equal(await loading,src('p1'));assert.equal(a.calls.length,1);assert.equal(a.timers.size,0);
});

test('a late host image also recovers a stalled service-image download',async()=>{
  const a=app({imageHook:url=>url===src('direct-p1')}),loading=a.get();await a.advance(2000);
  assert.equal(a.imageInstances[0].source,src('direct-p1'));
  a.room.sharedSlideImages={1:shared()};await a.advance(250);
  assert.equal(await loading,src('p1'));assert.equal(a.imageInstances[0].source,'');assert.equal(a.timers.size,0);
});

test('an already-downloading host image can finish after the service fails',async()=>{
  let fail;const a=app({imageHook:()=>true,service:()=>new Promise((_resolve,reject)=>{fail=reject})}),loading=a.get();
  await a.advance(2000);a.room.sharedSlideImages={1:shared()};await a.advance(250);
  fail(new Error('The slide service returned HTTP 503.'));await tick();
  assert.equal(a.imageInstances[0].source,src('p1'));a.imageInstances[0].onload();
  assert.equal(await loading,src('p1'));assert.equal(a.timers.size,0);
});

test('if both sources fail, preserve the service error and stop watching',async()=>{
  let fail;const a=app({imageHook:()=>true,service:()=>new Promise((_resolve,reject)=>{fail=reject})}),loading=a.get();
  const rejected=assert.rejects(loading,/HTTP 503/);
  await a.advance(2000);a.room.sharedSlideImages={1:shared()};await a.advance(250);
  fail(new Error('The slide service returned HTTP 503.'));await tick();a.imageInstances[0].onerror();await rejected;
  assert.equal(a.timers.size,0);assert.equal(a.details().loads.at(-1).failure,'http_503');
});

test('leaving during recovery aborts the service, the shared image, and its watcher',async()=>{
  const a=app({imageHook:()=>true,service:(_url,signal)=>stalledService(signal)}),loading=a.get(),rejected=assert.rejects(loading,/cancelled/);
  await a.advance(2000);a.room.sharedSlideImages={1:shared()};await a.advance(250);
  a.context.slideImageQueue.reset();await rejected;await tick();
  assert.equal(a.signals[0].aborted,true);assert.equal(a.imageInstances[0].source,'');assert.equal(a.timers.size,0);
  assert.equal(a.details().loads.at(-1).status,'cancelled');
});

test('a service failure without an available host image does not wait until the overall deadline',async()=>{
  const a=app({service:()=>{throw new Error('Provider HTTP 403')}}),loading=a.get(),rejected=assert.rejects(loading,/HTTP 403/);
  await a.advance(2000);await rejected;assert.equal(a.timers.size,0);assert.equal(a.calls.length,1);
});

test('the overall deadline still bounds recovery when neither source completes',async()=>{
  const a=app({service:(_url,signal)=>stalledService(signal)}),loading=a.get(),rejected=assert.rejects(loading,/timed out/);
  await a.advance(57000);await rejected;assert.equal(a.signals[0].aborted,true);assert.equal(a.timers.size,0);
  assert.equal(a.details().loads.at(-1).failure,'timeout');
});

test('late entries from another deck snapshot or page cannot win recovery',async()=>{
  const a=app({service:(_url,signal)=>stalledService(signal)}),loading=a.get();await a.advance(2000);
  for(const changes of [{cacheVersion:'old'},{pageId:'p2'},{expiresAt:1000000},{src:'https://example.com/p1'}]){
    a.room.sharedSlideImages={1:shared('p1',changes)};await a.advance(250);
  }
  assert.equal(a.imageInstances.length,0);a.room.sharedSlideImages={1:shared()};await a.advance(250);
  assert.equal(await loading,src('p1'));assert.equal(a.timers.size,0);
});

test('diagnostics are bounded and omit room, account, deck, URL, and provider-error secrets',async()=>{
  const secret='SECRET_TOKEN';const a=app({service:()=>({ok:false,error:'Provider HTTP 500 '+secret+' https://example.com/private'})});
  const loading=a.get(),rejected=assert.rejects(loading,/SECRET_TOKEN/);await a.advance(2000);await rejected;
  const details=a.context.getSlideLoadingDetails();for(const value of [secret,'https://','TEST42','cacheVersion','hostId','pageId'])assert(!details.includes(value));
  const failed=a.details().loads.at(-1);assert.equal(failed.failure,'http_500');assert(failed.events.some(e=>e.stage==='service' && e.outcome==='failed'));
  a.context.requestAppsScript=async()=>({ok:true,imageUrl:src('direct-p1'),expiresAt:2200000});
  const retry=a.get();await a.advance(2000);await retry;
  for(let i=0;i<30;i++)await a.get();assert.equal(a.details().loads.length,20);
  assert(a.details().loads.every(r=>r.status==='loaded' && r.elapsedMs>=0));
});

test('a refreshed host also reuses its previously published URL without a service request',async()=>{
  const a=app({host:true,images:{1:shared()}});assert.equal(await a.get(),src('p1'));
  assert.equal(a.calls.length,0);assert.equal(a.writes.length,0);
});

test('Firebase numeric-key array snapshots are reused without redundant publication',async()=>{
  const a=app({host:true,images:[null,shared()]});assert.equal(await a.get(),src('p1'));
  await a.get();assert.equal(a.calls.length,0);assert.equal(a.writes.length,0);
});

test('the host publishes verified URLs, merges concurrent exports, and keeps only current plus two ahead',async()=>{
  const a=app({host:true,images:{9:shared('old')}}),before=structuredClone(a.room);
  await Promise.all([a.get(),a.get('p2',1),a.get('p3',2)]);await tick();
  assert.deepEqual(Object.keys(a.room.sharedSlideImages),['1','2','3']);
  assert(a.writes.every(w=>w.path==='rooms/TEST42/sharedSlideImages'));
  const after=structuredClone(a.room);delete after.sharedSlideImages;delete before.sharedSlideImages;assert.deepEqual(after,before);
  a.room.currentSlide=2;await a.get('p4',2);assert.deepEqual(Object.keys(a.room.sharedSlideImages),['2','3','4']);
  const count=a.writes.length;await a.get('p4');assert.equal(a.writes.length,count);
});

test('absent sharing on an older host falls back within three seconds',async()=>{
  const a=app(),loading=a.get();await tick();assert.equal(a.calls.length,0);
  await a.advance(2000);assert.equal(await loading,src('direct-p1'));assert.equal(a.calls.length,1);assert.equal(a.timers.size,0);
});

test('expired, wrong-page, wrong-version and non-Google entries fall back instead of being displayed',async()=>{
  for(const changes of [{expiresAt:1000000},{pageId:'p2'},{cacheVersion:'old'},{src:'http://lh7-us.googleusercontent.com/p1'},{src:'https://example.com/p1'}]){
    const a=app({images:{1:shared('p1',changes)}}),loading=a.get();await a.advance(2000);
    assert.equal(await loading,src('direct-p1'));assert.equal(a.calls.length,1);
  }
});

test('a background preload can reuse a host result published after 28 seconds',async()=>{
  const a=app({images:{1:shared()}}),loading=a.get('p2',1);
  await a.advance(28000);assert.equal(a.calls.length,0);a.room.sharedSlideImages[2]=shared('p2');
  await a.advance(250);assert.equal(await loading,src('p2'));assert.equal(a.calls.length,0);assert.equal(a.timers.size,0);
});

test('promoting a waiting preload to the visible slide shortens its fallback wait',async()=>{
  const a=app({images:{1:shared()}}),loading=a.get('p2',1);await a.advance(3000);
  const visible=a.get('p2',0);await a.advance(250);assert.equal(await loading,src('direct-p2'));
  assert.equal(await visible,src('direct-p2'));assert.equal(a.calls.length,1);
});

test('unavailable shared images recover through the slide service',async()=>{
  const a=app({images:{1:shared('broken')},failImage:url=>url===src('broken')});
  // The shared record still belongs to the current page.
  a.room.sharedSlideImages[1].pageId='p1';
  assert.equal(await a.get(),src('direct-p1'));assert.equal(a.calls.length,1);assert.equal(a.timers.size,0);
});

test('leaving cancels a sharing wait without sending a fallback request',async()=>{
  const a=app(),loading=a.get(),rejected=assert.rejects(loading,/cancelled/);await tick();
  a.context.slideImageQueue.reset();await rejected;assert.equal(a.calls.length,0);assert.equal(a.timers.size,0);
});

test('a failed publication cannot block the host image',async()=>{
  const a=app({host:true,writeError:true});assert.equal(await a.get(),src('direct-p1'));await tick();assert.equal(a.writes.length,0);
});

test('a stale host completion cannot publish into a different room, deck, or ended game',async()=>{
  for(const change of [a=>{a.context.roomEntryRevision++},a=>{a.context.me.code='OTHER'},a=>{a.room.imageCacheVersion='old'},a=>{a.room.state='done'},a=>{a.room.currentSlide=4}]){
    const a=app({host:true});const original=a.context.window._transaction;
    a.context.window._transaction=async(path,fn)=>{change(a);return original(path,fn)};
    assert.equal(await a.get(),src('direct-p1'));assert.equal(a.writes.length,0);
  }
});
