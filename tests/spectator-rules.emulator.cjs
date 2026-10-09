// REST fixtures exercise the actual RTDB rules engine, including ETag transactions.
// Refuse to run against anything except the loopback emulator and demo namespace.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const host=process.env.FIREBASE_DATABASE_EMULATOR_HOST;
if(!host || !/^127\.0\.0\.1:\d+$/.test(host))throw Error('Run with the local Firebase database emulator.');
const namespace='demo-tiny-gang-default-rtdb';
async function request(key,method='GET',value,admin=false,extra={}){
 return fetch(`http://${host}/${key}.json?ns=${namespace}`,{method,headers:{'content-type':'application/json',...(admin?{Authorization:'Bearer owner'}:{}),...extra},...(value===undefined?{}:{body:JSON.stringify(value)})});
}
const fresh=()=>({code:'FIXTURE',state:'playing',currentSlide:1,totalSlides:3,players:{host:{id:'host',name:'Host',active:true}},rounds:{1:{openedAt:Date.now(),eligible:{host:true}}},timer:{slide:1,status:'running',enabled:true,paused:false,remainingMs:60000,dueAt:Date.now()+60000,duration:60,revision:1}});
async function seed(room=fresh()) {assert.equal((await request('', 'PUT',{rooms:{FIXTURE:room}},true)).status,200);}
async function vote(id='browser',value='smash',slide=1){return request(`audienceVotes/FIXTURE/${slide}/${id}`,'PUT',value);}
async function denied(response){assert.equal(response.status,401,await response.text());}
(async()=>{
 assert.equal((await request('.settings/rules','PUT',JSON.parse(fs.readFileSync(path.join(__dirname,'../firebase/database.rules.json'),'utf8')),true)).status,200);
 await seed();assert.equal((await vote()).status,200);await denied(await vote());await denied(await vote('browser','pass'));await denied(await vote('browser',null));
 assert.equal(await (await request('audienceVotes/FIXTURE/1/browser')).json(),'smash');
 await denied(await vote('bad','supersmash'));await denied(await vote('bad',{choice:'smash'}));await denied(await request('audienceVotes/FIXTURE/1/browser/nested','PUT','pass'));await denied(await request('audienceVotes/FIXTURE','PUT',{}));
 console.log('Rules enforce scalar Smash/Pass and immutable first votes, including deletes and ancestor overwrites');
 for(const [name,mutate]of [
  ['preparing',r=>r.timer.status='loading'],['expired',r=>r.timer.dueAt=Date.now()-1],['deadline missing',r=>delete r.timer.dueAt],['advanced',r=>r.currentSlide=2],['timer slide stale',r=>r.timer.slide=2],['notes !',r=>r.slideVotingDisabled={1:true}],['veto',r=>r.vetoed={1:true}],['ended',r=>r.state='done'],['waiting',r=>r.state='waiting'],['unopened round',r=>r.rounds={}],['no timer',r=>delete r.timer],['rematch redirected',r=>r.nextRoomCode='NEXT'],['paused at zero',r=>Object.assign(r.timer,{paused:true,remainingMs:0,dueAt:null})]]){
  const r=fresh();mutate(r);await seed(r);await denied(await vote());
 }
 await seed();await denied(await vote('future','smash',2));await request('','PUT',{},true);await denied(await vote());
 console.log('Rules reject preparation, expiry, stale/future slides, notes, vetoes, endings, missing rooms and rematch redirects');
 for(const patch of [{enabled:false,dueAt:null},{paused:true,dueAt:null,remainingMs:1000}]){const r=fresh();Object.assign(r.timer,patch);await seed(r);assert.equal((await vote()).status,200);}
 console.log('Rules preserve untimed and paused voting behavior');
 // Two clients observe the same null leaf. Only one compare-and-set can commit.
 await seed();const leaf='audienceVotes/FIXTURE/1/shared';const initial=await request(leaf,'GET',undefined,false,{'X-Firebase-ETag':'true'});assert.equal(await initial.json(),null);const etag=initial.headers.get('etag');assert(etag);
 const raced=await Promise.all(['smash','pass'].map(choice=>request(leaf,'PUT',choice,false,{'if-match':etag})));assert.equal(raced.filter(r=>r.status===200).length,1);assert.equal(raced.filter(r=>r.status===412 || r.status===401).length,1);
 const accepted=await (await request(leaf)).json();assert(['smash','pass'].includes(accepted));
 // Server checks at commit defeat stale clients, even with a valid old ETag.
 for(const mutate of [r=>r.currentSlide=2,r=>r.timer.dueAt=Date.now()-1,r=>r.state='done',r=>r.vetoed={1:true}]){
  await seed();const before=await request(leaf,'GET',undefined,false,{'X-Firebase-ETag':'true'});const oldTag=before.headers.get('etag');const r=fresh();mutate(r);await request('rooms/FIXTURE','PUT',r,true);await denied(await request(leaf,'PUT','smash',false,{'if-match':oldTag}));
 }
 console.log('Real ETag races preserve one winner; stale commits reject after slide, deadline, ending and veto changes');
 // Existing unauthenticated game access still supports reservations/room transactions,
 // player writes at the root, Double Down, reads, rematch links and image URL sharing.
 await seed();assert.equal((await request('rooms/NEWROOM','PUT',{state:'waiting',players:{host:{name:'Host'}}})).status,200);
 assert.equal((await request('rooms/FIXTURE/players/player','PUT',{id:'player',name:'Player'})).status,200);
 assert.equal((await request('','PATCH',{'votes/FIXTURE/1/player':'supersmash','ddused/FIXTURE/player':true})).status,200);
 assert.equal((await request('rooms/FIXTURE','PATCH',{nextRoomCode:'NEWROOM',slideImageCache:{s1:{url:'fixture'}}})).status,200);
 for(const key of ['rooms/FIXTURE','votes/FIXTURE','ddused/FIXTURE','audienceVotes/FIXTURE'])assert.equal((await request(key)).status,200);
 await denied(await request('','PATCH',{'audienceVotes/FIXTURE/1/new':'smash'}));await denied(await request('unrelated','PUT',true));
 console.log('Existing room/player/Double Down/root multi-path access preserved; audience ancestor/root bypasses denied');
})().catch(e=>{console.error(e);process.exitCode=1});
