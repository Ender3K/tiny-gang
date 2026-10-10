const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function app(load){
  const calls=[],timers=new Map();let timerId=0;
  const room={code:'TEST42',state:'playing',currentSlide:1,slidesUrl:'deck',imageCacheVersion:'v1',
    slidePageIds:['p1','p2','p3','p4'],timer:{enabled:true,status:'running',remainingMs:20000}};
  const context=vm.createContext({AbortController,nextSlidePreloadRetry:null,connected:true,me:{code:room.code},
    roomEntryRevision:1,_latestRoom:room,getSlideId:()=> 'deck',remainingMs:t=>t.remainingMs,
    setTimeout(callback,ms){timers.set(++timerId,{callback,ms});return timerId;},clearTimeout:id=>timers.delete(id),
    async fetchSlideImageDataUrl(url,pageId,version,priority){
      const call={url,pageId,version,priority};calls.push(call);
      return load(call,calls.filter(c=>c.pageId===pageId).length);
    }});
  vm.runInContext(html.slice(html.indexOf('function waitForAppsScriptRetry('),html.indexOf('async function requestAppsScript(')),context);
  vm.runInContext(html.slice(html.indexOf('async function prefetchSlide('),html.indexOf('function prepareLobbySlides(')),context);
  return {context,room,calls,timers,start:()=>context.preloadGameSlides(context._latestRoom),async retry(){
    assert.equal(timers.size,1);const [id,timer]=[...timers][0];assert(timer.ms>=1500 && timer.ms<2500);
    timers.delete(id);timer.callback();await tick();
  }};
}

const failNextOnce=(call,attempt)=>{
  if(call.pageId==='p2' && attempt===1) throw new Error('Temporary network failure');
  return 'image:'+call.pageId;
};

test('successful preloads keep two slides ahead and schedule no retry',async()=>{
  const a=app(call=>'image:'+call.pageId);a.start();await tick();
  assert.deepEqual(a.calls.map(c=>c.pageId),['p2','p3']);
  assert.deepEqual(a.calls.map(c=>c.priority),[1,2]);assert.equal(a.timers.size,0);
});

test('only the nearest failed preload retries once after a randomized delay',async()=>{
  const a=app(failNextOnce);a.start();await tick();assert.equal(a.calls.length,2);
  await a.retry();assert.deepEqual(a.calls.map(c=>c.pageId),['p2','p3','p2']);
  assert.equal(a.calls[2].priority,1);assert.equal(a.timers.size,0);assert.equal(a.context.nextSlidePreloadRetry,null);
});

test('a persistent preload failure stops after its single retry',async()=>{
  const a=app(()=>{throw new Error('Still unavailable')});a.start();await tick();await a.retry();
  assert.deepEqual(a.calls.map(c=>c.pageId),['p2','p3','p2']);assert.equal(a.timers.size,0);
});

test('cancelling a pending retry clears its timer and sends no request',async()=>{
  const a=app(failNextOnce);a.start();await tick();assert.equal(a.timers.size,1);
  a.context.cancelNextSlidePreloadRetry();await tick();assert.equal(a.timers.size,0);assert.equal(a.calls.length,2);
});

test('advancing cancels the previous wait and preloads the new next two slides',async()=>{
  const a=app(failNextOnce);a.start();await tick();const old=a.context.nextSlidePreloadRetry;
  a.room.currentSlide=2;a.start();await tick();
  assert.equal(old.signal.aborted,true);assert.deepEqual(a.calls.map(c=>c.pageId),['p2','p3','p3','p4']);
  assert.equal(a.timers.size,0);
});

test('room, round, deck, session and connection changes prevent a stale retry',async()=>{
  const changes=[
    a=>{a.room.state='done'},a=>{a.room.currentSlide=2},a=>{a.context.me.code='OTHER'},
    a=>{a.context._latestRoom=null},a=>{a.context.roomEntryRevision++},
    a=>{a.room.imageCacheVersion='v2'},a=>{a.room.slidePageIds[1]='replacement'},
    a=>{a.room.nextRoomCode='REMATCH'},a=>{a.context.connected=false},a=>{a.context.me.spectator=true}
  ];
  for(const change of changes){
    const a=app(failNextOnce);a.start();await tick();change(a);await a.retry();
    assert.equal(a.calls.length,2);assert.equal(a.timers.size,0);
  }
});

test('a failure delivered after leaving the room does not even schedule a retry',async()=>{
  let rejectNext;const a=app(call=>call.pageId==='p2' ? new Promise((resolve,reject)=>{rejectNext=reject}) : 'image');
  a.start();a.context.cancelNextSlidePreloadRetry();rejectNext(new Error('cancelled'));await tick();
  assert.equal(a.timers.size,0);assert.equal(a.calls.length,2);
});

test('a nearly expired countdown skips the retry, while pausing allows preparation',async()=>{
  const expiring=app(failNextOnce);expiring.start();await tick();expiring.room.timer.remainingMs=2000;
  await expiring.retry();assert.equal(expiring.calls.length,2);
  const paused=app(failNextOnce);paused.room.timer.paused=true;paused.room.timer.remainingMs=2000;
  paused.start();await tick();await paused.retry();assert.equal(paused.calls.length,3);
});

test('the final slide starts no preloads or retry timer',async()=>{
  const a=app(()=>assert.fail('no next slide'));a.room.currentSlide=4;a.start();await tick();
  assert.equal(a.calls.length,0);assert.equal(a.timers.size,0);
});
