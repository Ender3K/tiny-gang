const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const section=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));
function app(extra={}){
 const c=vm.createContext({roomEntryRevision:0,roomNow:()=>1000,isSlideUnrated:(r,s)=>r.slideVotingDisabled?.[s]===true || !!r.vetoed?.[s],playedSlides:r=>Object.keys(r.rounds||{}).map(Number),...extra});
 vm.runInContext(section('// Audience data never enters','function getPlayerStats('),c);Object.assign(c,extra);return c;
}
const room=()=>({state:'playing',currentSlide:1,totalSlides:3,rounds:{1:{}},timer:{slide:1,status:'running',enabled:true,paused:false,dueAt:2000,remainingMs:1000}});
test('audience eligibility rejects preparation, expired deadlines, stale slides, ended/missing rooms and rematch redirects',()=>{
 const c=app(),r=room();assert(c.audienceEligible(r,1));
 for(const mutate of [r=>r.timer.status='loading',r=>r.timer.dueAt=1000,r=>r.currentSlide=2,r=>r.timer.slide=2,r=>r.state='done',r=>r.state='waiting',r=>delete r.rounds[1],r=>delete r.timer,r=>r.nextRoomCode='NEXT']){const r=room();mutate(r);assert.equal(c.audienceEligible(r,1),false);}
 assert.equal(c.audienceEligible(null,1),false);
});
test('paused rounds freeze their remaining time and permit voting; zero remaining stays closed; disabled timers still wait for preparation',()=>{
 const c=app(),r=room();Object.assign(r.timer,{paused:true,dueAt:null});assert(c.audienceEligible(r,1,999999));r.timer.remainingMs=0;assert.equal(c.audienceEligible(r,1),false);
 Object.assign(r.timer,{enabled:false,paused:false});assert(c.audienceEligible(r,1));r.timer.status='loading';assert.equal(c.audienceEligible(r,1),false);
});
test('notes and manual vetoes close audience voting and omit stale choices from tallies and results',()=>{
 const c=app();for(const flag of ['slideVotingDisabled','vetoed']){const r=room();r[flag]={1:true};assert.equal(c.audienceEligible(r,1),false);assert.deepEqual({...c.audienceTotals(r,{1:{a:'smash'}},1)},{smash:0,pass:0});assert(c.audienceBreakdown(r,{1:{a:'smash'}}).includes('Unrated'));}
});
test('audience tallies accept only Smash/Pass, count only played slides, and do not mutate room/player votes',()=>{
 const c=app(),r=room(),votes={1:{a:'smash',b:'pass',c:'supersmash'},3:{d:'smash'}};const before=JSON.stringify({r,votes});
 assert.deepEqual({...c.audienceTotals(r,votes,1)},{smash:1,pass:1});assert(!c.audienceBreakdown(r,votes).includes('Slide 3'));assert.equal(JSON.stringify({r,votes}),before);
});
test('atomic first vote preserves a previously accepted choice; refresh recovery uses its snapshot',async()=>{
 let stored=null;const writes=[];const c=app({me:{spectator:true,code:'TEST'},connected:true,audienceReady:true,audiencePending:false,deviceId:'browser',_latestRoom:room(),_latestAudienceVotes:{},renderSpectator(){},showToast(){},window:{_ref:(_,path)=>path,_transaction:async(path,fn,options)=>{assert.equal(options.applyLocally,false);const next=fn(stored);if(next!==undefined){stored=next;writes.push(path);}return{snapshot:{val:()=>stored}};}}});
 await c.castAudienceVote('smash');assert.equal(stored,'smash');assert.equal(c._latestAudienceVotes[1].browser,'smash');assert.deepEqual(writes,['audienceVotes/TEST/1/browser']);
 // An empty cache in a second tab/refresh still cannot overwrite the server vote.
 c._latestAudienceVotes={};await c.castAudienceVote('pass');assert.equal(c._latestAudienceVotes[1].browser,'smash');assert.equal(writes.length,1);
});
test('rejected writes never display acceptance and can be retried; spectators cannot cast Double Down',async()=>{
 let calls=0;const c=app({me:{spectator:true,code:'TEST'},connected:true,audienceReady:true,audiencePending:false,deviceId:'browser',_latestRoom:room(),_latestAudienceVotes:{},renderSpectator(){},showToast(){},window:{_ref:()=>null,_transaction:async()=>{calls++;throw Error('permission denied')}}});
 await c.castAudienceVote('supersmash');assert.equal(calls,0);await c.castAudienceVote('pass');assert.equal(calls,1);assert.equal(c._latestAudienceVotes[1],undefined);assert.equal(c.audiencePending,false);
 c.connected=false;await c.castAudienceVote('smash');assert.equal(calls,1);c.connected=true;c.audienceReady=false;await c.castAudienceVote('smash');assert.equal(calls,1);
});
test('a pending previous-room vote cannot leak into the rematch',async()=>{
 let finish;const c=app({me:{spectator:true,code:'TEST'},connected:true,audienceReady:true,audiencePending:false,deviceId:'browser',_latestRoom:room(),_latestAudienceVotes:{},renderSpectator(){},showToast(){},window:{_ref:()=>null,_transaction:()=>new Promise(resolve=>finish=resolve)}});
 const pending=c.castAudienceVote('smash');c.me.code='NEXT';c._latestAudienceVotes={};finish({snapshot:{val:()=> 'smash'}});await pending;assert.equal(c._latestAudienceVotes[1],undefined);
});
