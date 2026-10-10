const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const src=page=>'https://lh7-us.googleusercontent.com/'+page;
const shared=(page='p1',changes={})=>({src:src(page),expiresAt:2200000,pageId:page,cacheVersion:'v1',...changes});
function app({host=false,images,failImage,writeError=false}={}){
  let now=1000000,timerId=0;const timers=new Map(),calls=[],writes=[];
  const room={code:'TEST42',hostId:'host',state:'playing',currentSlide:1,slidesUrl:'deck',imageCacheVersion:'v1',slidePageIds:['p1','p2','p3','p4'],timer:{paused:true,remainingMs:12345},players:{host:{id:'host'},player:{id:'player'}}};
  if(images)room.sharedSlideImages=images;
  const math=Object.create(Math);math.random=()=>0;
  const context=vm.createContext({URL,AbortController,Math:math,Date:{now:()=>now},connected:true,roomEntryRevision:1,
    me:{id:host?'host':'player',isMaster:host,code:room.code},_latestRoom:room,myKey:()=>host?'host':'player',
    APPS_SCRIPT_WEBAPP_URL:'https://example.com/exec',slideImageCache:{},slideImagePromises:{},getSlideId:url=>url==='other'?'other':'deck',
    setTimeout(callback,ms){timers.set(++timerId,{callback,due:now+ms});return timerId;},clearTimeout:id=>timers.delete(id),
    Image:class {set src(value){if(value)queueMicrotask(()=>failImage?.(value)?this.onerror?.():this.onload?.());}},
    async requestAppsScript(url){calls.push(url);const page=new URL(url).searchParams.get('pageId');return{ok:true,imageUrl:src('direct-'+page),expiresAt:2200000};},
    window:{_db:{},_ref:(_db,path)=>path,async _transaction(path,fn){
      if(writeError)throw new Error('Permission denied');
      const value=fn(room.sharedSlideImages || null);
      if(value){room.sharedSlideImages=value;writes.push({path,value});}
      return{committed:!!value};
    }}
  });
  vm.runInContext(html.slice(html.indexOf('function createSlideImageQueue('),html.indexOf('async function prefetchSlide(')),context);
  context.slideImageQueue=context.createSlideImageQueue(2);
  return{context,room,calls,writes,timers,get:(page='p1',priority=0)=>context.fetchSlideImageDataUrl('deck',page,'v1',priority),async advance(ms){
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
