const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
function section(a,b){return html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)))}
function app(room){
 const c=vm.createContext({Date:{now:()=>10000},serverOffset:0,connected:true,advancing:false,me:{id:'a',name:'A',code:'TEST',isMaster:true},_latestRoom:room,roomRef:()=>null,showToast(){},window:{_transaction:async(ref,fn)=>{const next=fn(room);if(next)Object.assign(room,next);return {committed:!!next}}},setInterval(){},clearInterval(){},timerState:{enabled:true,slideReady:true},document:{getElementById:()=>({checked:true})}});
 vm.runInContext([section('function isValidSlideDuration(', 'function normalizeSlideDurations('),section('function getSlideTimerConfig(', 'function createSlideImageQueue('),section('function getPlayers(', 'let serverOffset='),section('function newRound(', 'async function enterExistingRoom('),section('function roomNow(', 'function storageRead('),section('function remainingMs(', 'async function armSharedTimer('),section('async function masterNext(', 'async function masterEnd(')].join('\n'),c);
 return c;
}
const room=()=>({state:'playing',totalSlides:3,currentSlide:1,players:{a:{id:'a',name:'A'},b:{id:'b',name:'B',active:false}},timerEnabled:true,timerDuration:20,slideDurations:{2:10},rounds:{1:{eligible:{a:true,b:true}}},timer:{slide:1,status:'running',enabled:true,duration:20,dueAt:15000,remainingMs:20000,revision:1}});
test('pause, extend and resume update one deadline and protect stale automatic advance',async()=>{
 const r=room(),c=app(r);await c.changeSharedTimer('pause');assert.equal(r.timer.remainingMs,5000);assert.equal(r.timer.dueAt,null);assert.equal(r.timer.paused,true);
 await c.changeSharedTimer('extend',10);assert.equal(r.timer.remainingMs,15000);
 await c.changeSharedTimer('pause');assert.equal(r.timer.dueAt,25000);assert.equal(r.timer.paused,false);
 await c.masterNext(1,1);assert.equal(r.currentSlide,1);
 r.timer.dueAt=9999;await c.masterNext(1,r.timer.revision);assert.equal(r.currentSlide,2);assert.equal(r.timer.duration,10);assert.equal(r.timer.dueAt,null);
 assert.deepEqual(JSON.parse(JSON.stringify(r.rounds[2].eligible)),{a:true});
});
test('duplicate host advances cannot skip a slide; finishing retains only opened rounds',async()=>{
 const r=room(),c=app(r);await c.masterNext(1);await c.masterNext(1);assert.equal(r.currentSlide,2);
 await c.masterNext(2);await c.masterNext(3);assert.equal(r.state,'done');assert.equal(r.endedAt,10000);assert.equal(Object.keys(r.rounds).length,3);
});


test('joining keeps Firebase room data subscribed until its transaction finishes',async()=>{
 let active=false;
 const c=vm.createContext({roomRef:code=>code,window:{
  _onValue(ref,cb){active=true;Promise.resolve().then(()=>cb({exists:()=>true}));return()=>{active=false}},
  async _transaction(ref,apply){assert.equal(active,true);return apply({code:ref})}
 }});
 vm.runInContext('async function transactLoadedRoom'+section('async function transactLoadedRoom','async function reserveRoom').split('async function transactLoadedRoom')[1],c);
 assert.equal(await c.transactLoadedRoom('TEST',r=>r.code),'TEST');assert.equal(active,false);
});

test('resume restores membership and Double Down through subscriptions without blocking one-off reads',async()=>{
 const held=new Set();
 const r={state:'waiting',hostId:'a',players:{b:{id:'b',name:'B',active:true}},timerDuration:30};
 let entered=false,saved=false;
 const c=vm.createContext({me:{id:'b',name:'B'},myKey:()=> 'b',roomRef:()=> 'room',stopListeners(){},stopSlideTimer(){},saveSession(){saved=true},enterWaiting(){entered=true;assert(held.has('room'))},window:{_db:{},_ref:()=> 'dd',_get(){throw new Error('one-off read must not run')},_onValue(ref,cb){held.add(ref);Promise.resolve().then(()=>cb({exists:()=>true,val:()=>ref==='room'?r:true}));return()=>held.delete(ref)}}});
 vm.runInContext(section('function firstSubscribedValue(', 'async function resumeSession('),c);
 await c.enterExistingRoom('TEST');assert.equal(entered,true);assert.equal(saved,true);assert.equal(c.myDoubleDownUsed,true);assert.equal(c.timerCfg.duration,30);assert.equal(c.me.isMaster,false);assert.equal(held.size,0);
});
