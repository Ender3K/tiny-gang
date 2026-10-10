// Exercise the real Auth + RTDB rules engines. Never contact production.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const databaseHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
for (const host of [databaseHost, authHost]) {
  if (!host || !/^127\.0\.0\.1:\d+$/.test(host)) throw Error('Run against local Auth and Database emulators only.');
}
const namespace = 'demo-tiny-gang-default-rtdb';
const admin = {token:'owner'};
async function request(key, method='GET', value, user=null, extra={}) {
  return fetch(`http://${databaseHost}/${key}.json?ns=${namespace}${user && user.token !== 'owner' ? '&auth='+encodeURIComponent(user.token) : ''}`, {
    method, headers:{'content-type':'application/json', ...(user?.token === 'owner' ? {Authorization:'Bearer owner'} : {}), ...extra},
    ...(value === undefined ? {} : {body:JSON.stringify(value)})
  });
}
async function ok(response) { assert.equal(response.status,200,await response.text()); }
async function denied(response) { assert.equal(response.status,401,await response.text()); }
async function anonymous() {
  const response = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fixture`, {
    method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({returnSecureToken:true})
  });
  const data = await response.json(); assert.equal(response.status,200,JSON.stringify(data));
  return {uid:data.localId, token:data.idToken};
}
(async()=>{
  await ok(await request('.settings/rules','PUT',JSON.parse(fs.readFileSync(path.join(__dirname,'../firebase/database.rules.json'),'utf8')),admin));
  const [host,player,viewer,attacker] = await Promise.all(Array.from({length:4},anonymous));
  const profile = (user,name='Player',slide=1) => ({id:user.uid,name,color:'av1',active:true,joinedSlide:slide});
  const fresh = () => ({securityVersion:2,code:'FIXTURE',hostId:host.uid,hostName:'Host',participantAccess:'code',state:'playing',currentSlide:1,totalSlides:3,
    players:{[host.uid]:profile(host,'Host'),[player.uid]:profile(player)},
    rounds:{1:{openedAt:Date.now(),eligible:{[host.uid]:true,[player.uid]:true}}},
    timer:{slide:1,status:'running',enabled:true,paused:false,remainingMs:60000,dueAt:Date.now()+60000,duration:60,revision:1}});
  async function seed(room=fresh(),extra={}) { await ok(await request('','PUT',{rooms:{FIXTURE:room},...extra},admin)); }
  const vote = (user=viewer,value='smash',slide=1,uid=user.uid) => request(`audienceVotes/FIXTURE/${slide}/${uid}`,'PUT',value,user);
  const playerVote = (user=player,value='smash',slide=1,uid=user.uid) => request(`votes/FIXTURE/${slide}/${uid}`,'PUT',value,user);
  await seed();
  for(const key of ['', 'rooms', 'votes', 'roomInvites', 'joinProofs', 'unrelated']) await denied(await request(key,'GET',undefined,viewer));
  for(const key of ['rooms/FIXTURE','votes/FIXTURE','ddused/FIXTURE','audienceVotes/FIXTURE']) {
    await denied(await request(key)); await ok(await request(key,'GET',undefined,viewer));
  }
  await denied(await request('rooms/FIXTURE/state','PUT','done'));
  await denied(await request('rooms/FIXTURE/state','PUT','done',attacker));
  await denied(await request('rooms/FIXTURE/hostId','PUT',attacker.uid,attacker));
  await denied(await request('rooms/FIXTURE','PUT',fresh(),player));
  await denied(await request('rooms/FIXTURE','DELETE',undefined,player));
  await denied(await request('rooms','DELETE',undefined,host));
  await denied(await request('rooms/FIXTURE/players/'+host.uid,'PATCH',{active:false,kicked:true},player));
  await denied(await request('','PATCH',{'rooms/FIXTURE/state':'done','rooms/FIXTURE/hostId':attacker.uid},attacker));
  await ok(await request('rooms/FIXTURE','PATCH',{lockJoins:true},host));
  await denied(await request('rooms/FIXTURE','PATCH',{hostId:attacker.uid},host));
  console.log('Anonymous requests, collection reads, host takeover, other-player edits, ancestor deletes and root bypasses rejected');

  const beforeImages=await (await request('rooms/FIXTURE','GET',undefined,host)).json();
  const images={1:{pageId:'p1',cacheVersion:'v1',src:'https://lh7-us.googleusercontent.com/fixture',expiresAt:Date.now()+1200000}};
  await ok(await request('rooms/FIXTURE/sharedSlideImages','PUT',images,host));
  for(const user of [player,viewer,attacker]){
    // RTDB serializes dense numeric keys as an array, including a null at zero.
    assert.deepEqual(await (await request('rooms/FIXTURE/sharedSlideImages','GET',undefined,user)).json(),[null,images[1]]);
    await denied(await request('rooms/FIXTURE/sharedSlideImages','PUT',images,user));
  }
  const afterImages=await (await request('rooms/FIXTURE','GET',undefined,host)).json();
  delete afterImages.sharedSlideImages;assert.deepEqual(afterImages,beforeImages);
  console.log('Existing rules let only the host publish shared image URLs; players can read them without changing game data');

  const newRoom={...fresh(),code:'NEWROOM',state:'waiting',currentSlide:1,players:{[host.uid]:profile(host,'Host')}};
  delete newRoom.rounds; delete newRoom.timer;
  await ok(await request('rooms/NEWROOM','PUT',newRoom,host));
  await denied(await request('rooms/NEWROOM','PUT',{...newRoom,hostId:attacker.uid,players:{[attacker.uid]:profile(attacker)}},attacker));
  await denied(await request('rooms/BADROOM','PUT',{...newRoom,code:'BADROOM',hostId:host.uid},attacker));
  await denied(await request('rooms/BADROOM','PUT',{...newRoom,code:'BADROOM',securityVersion:1},host));
  console.log('Room creation binds immutable ownership to Firebase UID; collisions cannot overwrite an existing room');

  const join = (user=attacker,changes={}) => request('rooms/FIXTURE/players/'+user.uid,'PUT',{...profile(user,'Guest'),...changes},user);
  await seed(); await ok(await join());
  await denied(await request('rooms/FIXTURE/players/'+host.uid,'PUT',profile(host),attacker));
  await denied(await join(attacker,{id:host.uid}));
  await denied(await join(attacker,{kicked:false}));
  await denied(await join(attacker,{extra:'injected'}));
  await denied(await join(attacker,{joinedSlide:0}));
  await denied(await request('rooms/FIXTURE/rounds/2/eligible/'+attacker.uid,'PUT',true,attacker));
  await denied(await request('rooms/FIXTURE/rounds/1/eligible/'+host.uid,'PUT',true,attacker));
  await ok(await request('rooms/FIXTURE/rounds/1/eligible/'+attacker.uid,'PUT',true,attacker));
  await ok(await request('rooms/FIXTURE/players/'+attacker.uid,'PATCH',{active:false,leftSlide:1},attacker));
  await ok(await join());
  await ok(await request('rooms/FIXTURE/players/'+attacker.uid,'PATCH',{active:false,kicked:true,leftSlide:1},host));
  await denied(await join()); await denied(await playerVote(attacker));
  for(const mutate of [r=>r.lockJoins=true,r=>r.state='done',r=>r.nextRoomCode='NEXTROOM']) {
    const r=fresh();mutate(r);await seed(r);await denied(await join());
  }
  // A new player and their current-round eligibility can be added atomically,
  // without granting writes to any other part of the room.
  await seed();await ok(await request('','PATCH',{
    ['rooms/FIXTURE/players/'+attacker.uid]:profile(attacker,'Late'),
    ['rooms/FIXTURE/rounds/1/eligible/'+attacker.uid]:true
  },attacker)); await ok(await playerVote(attacker));
  const inactive=fresh();inactive.players[player.uid].active=false;
  await seed(inactive);await ok(await request('rooms/FIXTURE','PUT',{...inactive,state:'done'},host));
  // Historical eligible snapshots must survive leaves and kicks during host transactions.
  console.log('Own-profile updates and late joins work; impersonation, field injection, locked/ended joins and kicked-player return rejected');

  const token='a'.repeat(64), rotated='b'.repeat(64);
  const privateRoom=fresh();privateRoom.state='waiting';privateRoom.participantAccess='invite';privateRoom.participantInviteHash='c'.repeat(64);
  await seed(privateRoom,{roomInvites:{FIXTURE:token}});
  await denied(await request('roomInvites/FIXTURE','GET',undefined,viewer));
  assert.equal(await (await request('roomInvites/FIXTURE','GET',undefined,host)).json(),token);
  await denied(await request('roomInvites/FIXTURE','PUT',rotated,attacker));
  await denied(await join());
  await denied(await request('joinProofs/FIXTURE/'+attacker.uid,'PUT',privateRoom.participantInviteHash,attacker));
  await denied(await request('joinProofs/FIXTURE/'+attacker.uid,'PUT','0'.repeat(64),attacker));
  await denied(await request('joinProofs/FIXTURE/'+player.uid,'PUT',token,attacker));
  await ok(await request('joinProofs/FIXTURE/'+attacker.uid,'PUT',token,attacker));
  await denied(await request('joinProofs/FIXTURE/'+attacker.uid,'GET',undefined,viewer));
  await ok(await request('roomInvites/FIXTURE','PUT',rotated,host));
  await denied(await join()); // Even a previously accepted proof is stale after rotation.
  await ok(await request('joinProofs/FIXTURE/'+attacker.uid,'PUT',rotated,attacker));
  await ok(await join());
  await ok(await request('rooms/FIXTURE','PATCH',{state:'playing'},host));
  await denied(await request('roomInvites/FIXTURE','PUT',token,host));
  await denied(await request('rooms/FIXTURE','PATCH',{participantAccess:'code'},host));
  console.log('Private invitation proofs are enforced by Firebase; public hashes, foreign proofs, stale proofs and spectator reads rejected');

  await seed();await ok(await playerVote());
  await denied(await playerVote(player,'pass'));await denied(await playerVote(player,null));
  await denied(await playerVote(attacker));await denied(await playerVote(attacker,'smash',1,player.uid));
  await denied(await request('votes/FIXTURE','PUT',{},host));
  await denied(await request('votes/FIXTURE/1/'+player.uid+'/nested','PUT','pass',player));
  await denied(await request('','PATCH',{['votes/FIXTURE/1/'+player.uid]:'pass'},host));
  await seed();await denied(await playerVote(player,'supersmash'));
  await denied(await request('ddused/FIXTURE/'+player.uid,'PUT',1,player));
  await denied(await request('','PATCH',{
    ['votes/FIXTURE/1/'+player.uid]:'supersmash',['ddused/FIXTURE/'+player.uid]:2
  },player));
  await ok(await request('','PATCH',{
    ['votes/FIXTURE/1/'+player.uid]:'supersmash',['ddused/FIXTURE/'+player.uid]:1
  },player));
  assert.equal(await (await request('ddused/FIXTURE/'+player.uid,'GET',undefined,player)).json(),1);
  for(const value of [null,false,2]) await denied(await request('ddused/FIXTURE/'+player.uid,'PUT',value,player));
  const second=fresh();second.currentSlide=2;second.rounds[2]={eligible:{[player.uid]:true}};second.timer.slide=2;
  await ok(await request('rooms/FIXTURE','PUT',second,host));
  await denied(await request('','PATCH',{
    ['votes/FIXTURE/2/'+player.uid]:'supersmash',['ddused/FIXTURE/'+player.uid]:2
  },player));await denied(await playerVote(player,'supersmash',2));
  await ok(await playerVote(player,'pass',2));
  console.log('Player votes are own-UID, eligible, immutable; Double Down requires one atomic vote/marker pair and cannot be reused');

  await seed();await ok(await vote());await denied(await vote());await denied(await vote(viewer,'pass'));await denied(await vote(viewer,null));
  await denied(await vote(attacker,'smash',1,viewer.uid));await denied(await vote(attacker,'supersmash'));await denied(await vote(attacker,{choice:'smash'}));
  await denied(await request('audienceVotes/FIXTURE','PUT',{},host));
  for(const [name,mutate] of [
    ['preparing',r=>r.timer.status='loading'],['expired',r=>r.timer.dueAt=Date.now()-1],['deadline missing',r=>delete r.timer.dueAt],
    ['advanced',r=>r.currentSlide=2],['timer slide stale',r=>r.timer.slide=2],['notes !',r=>r.slideVotingDisabled={1:true}],['veto',r=>r.vetoed={1:true}],
    ['ended',r=>r.state='done'],['waiting',r=>r.state='waiting'],['unopened round',r=>r.rounds={}],['no timer',r=>delete r.timer],
    ['redirected',r=>r.nextRoomCode='NEXTROOM'],['paused at zero',r=>Object.assign(r.timer,{paused:true,remainingMs:0,dueAt:null})]
  ]) {const r=fresh();mutate(r);await seed(r);await denied(await vote());await denied(await playerVote());}
  await seed();await denied(await vote(viewer,'smash',2));await denied(await playerVote(player,'smash',2));
  for(const patch of [{enabled:false,dueAt:null},{paused:true,dueAt:null,remainingMs:1000}]) {
    const r=fresh();Object.assign(r.timer,patch);await seed(r);await ok(await vote());await ok(await playerVote());
  }
  console.log('Audience and player rules reject stale/expired/unrated/preparing rounds; untimed and paused rounds remain supported');

  await seed();const leaf='audienceVotes/FIXTURE/1/'+viewer.uid;
  const before=await request(leaf,'GET',undefined,viewer,{'X-Firebase-ETag':'true'});const etag=before.headers.get('etag');assert(etag);
  const raced=await Promise.all(['smash','pass'].map(value=>request(leaf,'PUT',value,viewer,{'if-match':etag})));
  assert.equal(raced.filter(r=>r.status===200).length,1);assert.equal(raced.filter(r=>r.status===412 || r.status===401).length,1);
  for(const mutate of [r=>r.currentSlide=2,r=>r.timer.dueAt=Date.now()-1,r=>r.state='done',r=>r.vetoed={1:true}]) {
    await seed();const read=await request(leaf,'GET',undefined,viewer,{'X-Firebase-ETag':'true'});const tag=read.headers.get('etag');
    const r=fresh();mutate(r);await ok(await request('rooms/FIXTURE','PUT',r,host));
    await denied(await request(leaf,'PUT','smash',viewer,{'if-match':tag}));
  }
  console.log('Real concurrent ETag transactions have one winner; stale commits are rejected against server state');

  const legacy=fresh();delete legacy.securityVersion;await seed(legacy);
  await denied(await request('rooms/FIXTURE/securityVersion','PUT',2,host));
  await denied(await request('rooms/FIXTURE','PUT',fresh(),host));
  await denied(await join());await denied(await vote());await denied(await playerVote());
  console.log('Legacy room ownership cannot be claimed through old browser IDs or a security-version upgrade');
})().catch(error=>{console.error(error);process.exitCode=1});
