// Actual Firebase SDK + anonymous Auth + database rules, with fixture slides.
// Both Firebase services must be loopback emulators in the demo project.
const {chromium}=require('playwright');
const http=require('node:http');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const databaseHost=process.env.FIREBASE_DATABASE_EMULATOR_HOST,authHost=process.env.FIREBASE_AUTH_EMULATOR_HOST;
for(const host of [databaseHost,authHost]) if(!host || !/^127\.0\.0\.1:\d+$/.test(host)) throw Error('Local Auth and Database emulators required.');
const root=path.resolve(__dirname,'..'),namespace='demo-tiny-gang-default-rtdb';
const source=fs.readFileSync(path.join(root,'index.html'),'utf8');
// Emulator-only connections are injected into the served fixture, never the app.
const html=source
 .replace(/const firebaseConfig = \{[\s\S]*?\n    \};/,`const firebaseConfig={apiKey:'fixture',authDomain:'demo-tiny-gang.firebaseapp.com',projectId:'demo-tiny-gang',databaseURL:'https://${namespace}.firebaseio.com'};`)
 .replace('const auth = getAuth(app);',`const auth = getAuth(app); const {connectAuthEmulator}=await import('https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js');connectAuthEmulator(auth,'http://${authHost}',{disableWarnings:true});`)
 .replace('const db = getDatabase(app);',`const db = getDatabase(app);const {connectDatabaseEmulator}=await import('https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js');connectDatabaseEmulator(db,'127.0.0.1',${Number(databaseHost.split(':')[1])});`);
const deck={ok:true,totalSlides:3,slidePageIds:['s1','s2','s3'],slideDurations:{},slideVotingDisabled:{},timingVersion:1,notesRulesVersion:1,imageCacheVersion:'secure-fixture'};
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><rect width="800" height="450" fill="#272730"/></svg>';
const image=pageId=>({ok:true,imageUrl:'https://lh7-us.googleusercontent.com/fixture/'+pageId,expiresAt:Date.now()+1200000});
async function rest(key,method='GET',value,token='owner'){
 return fetch(`http://${databaseHost}/${key}.json?ns=${namespace}${token && token !== 'owner' ? '&auth='+encodeURIComponent(token) : ''}`,{method,headers:{'content-type':'application/json',...(token==='owner'?{Authorization:'Bearer owner'}:{})},...(value===undefined?{}:{body:JSON.stringify(value)})});
}
async function accepted(response){assert.equal(response.status,200,await response.text());}
async function denied(response){assert.equal(response.status,401,await response.text());}
(async()=>{
 await accepted(await rest('','PUT',{}));
 // Download only the official public SDK, then serve it locally to the browser.
 const sdk=new Map();
 for(const name of ['app','auth','database']){
  const url=`https://www.gstatic.com/firebasejs/12.10.0/firebase-${name}.js`,res=await fetch(url);assert(res.ok);sdk.set(url,await res.text());
 }
 const site=http.createServer((req,res)=>{
  if(new URL(req.url,'http://127.0.0.1').pathname==='/assets/qrcode.min.js'){
   res.setHeader('content-type','text/javascript');res.end(fs.readFileSync(path.join(root,'assets/qrcode.min.js')));return;
  }
  res.setHeader('content-type','text/html');res.end(html);
 });
 await new Promise(resolve=>site.listen(0,'127.0.0.1',resolve));
 const baseURL=`http://127.0.0.1:${site.address().port}`;
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),headless:true,args:['--no-sandbox']});
 const errors=[],blocked=[],slideServiceCalls=new Map();
 async function page(){
  const p=await browser.newPage({viewport:{width:1000,height:900}});p.setDefaultTimeout(18000);p.on('pageerror',e=>errors.push(e.message));p.on('requestfailed',r=>{const u=new URL(r.url());blocked.push({url:u.origin+u.pathname,error:r.failure()?.errorText});});
  slideServiceCalls.set(p,[]);
  await p.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.origin===baseURL)return route.continue();
   if(url.host===databaseHost || url.host===authHost)return route.continue();
   if(sdk.has(url.href))return route.fulfill({contentType:'text/javascript',body:sdk.get(url.href),headers:{'access-control-allow-origin':'*'}});
   if(url.hostname==='lh7-us.googleusercontent.com')return route.fulfill({contentType:'image/svg+xml',body:svg});
   if(url.hostname==='script.google.com'){
    const isImage=url.searchParams.get('action')==='image';if(isImage)slideServiceCalls.get(p).push(url.searchParams.get('pageId'));
    return route.fulfill({contentType:'application/json',body:JSON.stringify(isImage?image(url.searchParams.get('pageId')):deck),headers:{'access-control-allow-origin':'*'}});
   }
   blocked.push(url.origin+url.pathname);return route.abort(); // Never allow production Firebase or unknown backends.
  });
  return p;
 }
 async function token(p){return p.evaluate(async()=>{const {getAuth}=await import('https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js');return getAuth().currentUser.getIdToken();});}
 const lobby=async p=>p.locator('#waiting').waitFor({state:'visible'});
 try{
  const host=await page();await host.goto(baseURL+'/');try{await host.waitForFunction(()=>dbReady);}catch(error){console.error({startup:await host.evaluate(()=>window._fbError),blocked,errors});throw error;}
  assert.equal(await host.locator('input[type=password]').count(),0);
  await host.locator('#entryModeSwitch').click();await host.locator('#hostName').fill('Host');await host.locator('#slidesUrl').fill('https://docs.google.com/presentation/d/fixture/edit');
  await host.getByRole('button',{name:'Create lobby',exact:true}).click();await lobby(host);
  await host.waitForFunction(()=>!!_latestRoom.sharedSlideImages?.[2]);
  const code=await host.evaluate(()=>me.code),hostId=await host.evaluate(()=>deviceId),saved=await host.evaluate(()=>storageRead('sop-session'));
  const player=await page();await player.goto(baseURL+'/');await player.waitForFunction(()=>dbReady);
  // Copying the host's old device/session identifiers never gives host access.
  await player.evaluate(({hostId,saved})=>{localStorage.setItem('sop-device',JSON.stringify(hostId));localStorage.setItem('sop-session',JSON.stringify(saved));},{hostId,saved});
  await player.goto(baseURL+'/?room='+code);await player.waitForFunction(()=>dbReady && document.getElementById('resumeStatus').hidden);
  const playerId=await player.evaluate(()=>deviceId);assert.notEqual(playerId,hostId);assert.equal(await player.evaluate(()=>me.isMaster),false);
  await player.locator('#joinName').fill('Player');await player.getByRole('button',{name:'Join game',exact:true}).click();await lobby(player);
  const playerToken=await token(player);
  await denied(await rest(`rooms/${code}/hostId`,'PUT',playerId,playerToken));
  await denied(await rest(`rooms/${code}/state`,'PUT','done',playerToken));
  await denied(await rest(`rooms/${code}/players/${hostId}`,'PATCH',{kicked:true},playerToken));
  const hostRequestsBeforeRefresh=slideServiceCalls.get(host).length;
  await host.reload();await host.waitForFunction(()=>_latestRoom?.state==='waiting' && document.getElementById('slidePrepStatus').textContent==='First two slides ready.');assert.equal(await host.evaluate(()=>deviceId),hostId);assert.equal(await host.evaluate(()=>me.isMaster),true);
  assert.equal(slideServiceCalls.get(host).length,hostRequestsBeforeRefresh);
  await host.locator('#startBtn').click();for(const p of [host,player])await p.waitForFunction(()=>_latestRoom?.timer?.status==='running' && timerState.slideReady);
  await player.evaluate(()=>castDoubleDown());await player.waitForFunction(()=>myDoubleDownUsed && myVotedSlides[1]==='supersmash');
  await player.reload();await player.waitForFunction(()=>timerState.slideReady && myDoubleDownUsed && myVotedSlides[1]==='supersmash');
  assert.equal(slideServiceCalls.get(player).length,0);
  assert.equal(await (await rest(`ddused/${code}/${playerId}`)).json(),1);
  await denied(await rest(`votes/${code}/1/${hostId}`,'PUT','smash',playerToken));
  await denied(await rest(`votes/${code}/1/${playerId}`,'PUT','pass',playerToken));
  const viewer=await page();await viewer.goto(`${baseURL}/?room=${code}&spectator=1`);await viewer.waitForFunction(()=>audienceReady && _latestRoom?.timer?.status==='running');
  const viewerId=await viewer.evaluate(()=>deviceId),viewerToken=await token(viewer);
  await viewer.locator('#spectatorPass').click();await viewer.waitForFunction(()=>document.getElementById('spectatorStatus').textContent.includes('Vote accepted'));
  await denied(await rest(`audienceVotes/${code}/1/invented-id`,'PUT','smash',viewerToken));
  await viewer.reload();await viewer.waitForFunction(()=>audienceReady);assert.equal(await viewer.evaluate(()=>deviceId),viewerId);assert(await viewer.locator('#spectatorSmash').isDisabled());
  // A real late join writes just its profile and eligibility, not the whole room.
  const late=await page();await late.goto(`${baseURL}/?room=${code}`);await late.waitForFunction(()=>dbReady);await late.locator('#joinName').fill('Late');await late.getByRole('button',{name:'Join game',exact:true}).click();await late.locator('#game').waitFor({state:'visible'});
  await late.waitForFunction(()=>timerState.slideReady);await late.evaluate(()=>castVote('pass'));await late.waitForFunction(()=>myVotedSlides[1]==='pass');
  await host.evaluate(()=>masterNext());await player.waitForFunction(()=>_latestRoom?.currentSlide===2 && _latestRoom.timer.status==='running');
  await denied(await rest('', 'PATCH',{[`votes/${code}/2/${playerId}`]:'supersmash',[`ddused/${code}/${playerId}`]:2},playerToken));
  await player.evaluate(()=>castVote('smash'));await player.waitForFunction(()=>myVotedSlides[2]==='smash');
  host.once('dialog',d=>d.accept());await host.evaluate(()=>masterEnd());await host.locator('#results').waitFor({state:'visible'});
  await host.locator('#rematchBtn').click();for(const p of [host,player,late,viewer])await p.waitForFunction(old=>me.code!==old && _latestRoom?.state==='waiting',code);
  await player.waitForFunction(()=>!myDoubleDownUsed);
  console.log('Real SDK: silent auth, copied-session rejection, host refresh, host-only controls, player/Double Down votes, spectators, late joins and rematches passed');

  await host.evaluate(()=>goHome());await host.locator('#entryModeSwitch').click();await host.locator('#hostName').fill('Private host');await host.locator('#slidesUrl').fill('https://docs.google.com/presentation/d/fixture/edit');await host.locator('#participantAccess').selectOption('invite');await host.getByRole('button',{name:'Create lobby',exact:true}).click();await lobby(host);
  const privateCode=await host.evaluate(()=>me.code),invite=await host.evaluate(()=>participantLink());
  await denied(await rest(`roomInvites/${privateCode}`,'GET',undefined,viewerToken));
  const guest=await page();await guest.goto(invite);await guest.waitForFunction(()=>dbReady);const guestId=await guest.evaluate(()=>deviceId),guestToken=await token(guest);
  const profile={id:guestId,name:'Guest',color:'av1',active:true,joinedSlide:1};
  await denied(await rest(`rooms/${privateCode}/players/${guestId}`,'PUT',profile,guestToken));
  await denied(await rest(`joinProofs/${privateCode}/${guestId}`,'PUT',await host.evaluate(()=>_latestRoom.participantInviteHash),guestToken));
  await guest.locator('#joinName').fill('Guest');await guest.getByRole('button',{name:'Join game',exact:true}).click();await lobby(guest);
  await denied(await rest(`joinProofs/${privateCode}/${guestId}`,'GET',undefined,viewerToken));
  assert.equal(new URL(guest.url()).hash,'');
  await host.reload();await host.waitForFunction(()=>_latestRoom?.state==='waiting');assert.equal(await host.evaluate(()=>participantLink()),invite);
  await host.locator('#lobbyParticipantAccess').selectOption('code');await host.waitForFunction(()=>_latestRoom.participantAccess==='code' && !document.getElementById('lobbyParticipantAccess').disabled);
  await host.locator('#lobbyParticipantAccess').selectOption('invite');await host.waitForFunction(()=>_latestRoom.participantAccess==='invite' && !document.getElementById('lobbyParticipantAccess').disabled);
  const rotated=await host.evaluate(()=>participantLink());assert.notEqual(rotated,invite);
  await host.locator('#startBtn').click();await guest.waitForFunction(()=>_latestRoom?.timer?.status==='running');await guest.evaluate(()=>castVote('smash'));await guest.waitForFunction(()=>myVotedSlides[1]==='smash');
  host.once('dialog',d=>d.accept());await host.evaluate(()=>masterEnd());await host.locator('#results').waitFor({state:'visible'});await host.locator('#rematchBtn').click();
  for(const p of [host,guest])await p.waitForFunction(old=>me.code!==old && _latestRoom?.state==='waiting',privateCode);
  assert.equal(new URL(await host.evaluate(()=>participantLink())).hash,new URL(rotated).hash);
  await guest.reload();await guest.waitForFunction(()=>_latestRoom?.state==='waiting');
  // Copying the host's name does not confer a crown or hide the kick control.
  await accepted(await rest(`rooms/${await host.evaluate(()=>me.code)}/players/${guestId}`,'PATCH',{name:'Private host'},guestToken));
  await host.waitForFunction(id=>_latestRoom.players[id].name==='Private host',guestId);
  assert.equal(await host.locator('.player-chip.is-master').count(),1);
  await host.locator('#startBtn').click();await host.waitForFunction(()=>_latestRoom?.timer?.status==='running');
  await host.locator(`.kick-btn[data-kick-player="${guestId}"]`).click();await guest.locator('#entry').waitFor({state:'visible'});
  await host.evaluate(()=>masterNext());await host.waitForFunction(()=>_latestRoom?.currentSlide===2);
  await denied(await rest(`rooms/${await host.evaluate(()=>me.code)}/players/${guestId}`,'PUT',profile,guestToken));
  assert.deepEqual(errors,[]);
  console.log('Real SDK: private invite proof, secret privacy, host-token recovery, rotation, invited votes, private rematch and kicked-player denial passed');
 }finally{await browser.close();await new Promise(resolve=>site.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1});
