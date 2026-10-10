const {chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
const root=require('node:path').resolve(__dirname,'..');
const html=fs.readFileSync(root+'/index.html','utf8');
const deck={ok:true,totalSlides:8,slidePageIds:Array.from({length:8},(_,i)=>'s'+(i+1)),slideDurations:{1:20,5:10},slideVotingDisabled:{5:true},timingVersion:1,notesRulesVersion:1,imageCacheVersion:'fixture'};
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#272730"/><text x="800" y="450" fill="white" text-anchor="middle" font-size="60">Results test slide</text></svg>';
const image={ok:true,dataUrl:'data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64')};
const authModule=`
export const browserLocalPersistence={};
export async function setPersistence(){}
export function getAuth(){return{currentUser:JSON.parse(localStorage.getItem('fixture-auth') || 'null'),authStateReady:async()=>{}}}
export async function signInAnonymously(auth){const user={uid:crypto.randomUUID()};localStorage.setItem('fixture-auth',JSON.stringify(user));auth.currentUser=user;return{user}}
export function onAuthStateChanged(auth,cb){cb(auth.currentUser);return()=>{}}
`;
const moduleSource=`
const listeners=new Set();function snapshot(value){return{exists:()=>value!==null,val:()=>value}}
window.__notify=async()=>{for(const item of [...listeners]){const value=await window.testRead(item.path);if(listeners.has(item))item.cb(snapshot(value))}};
export function getDatabase(){return {}}export function ref(db,path=''){return path}
export async function get(path){return snapshot(await window.testRead(path))}
export async function set(path,value){return window.testWrite(path,value,false)}
export async function update(path,value){return window.testWrite(path,value,true)}
export async function runTransaction(path,fn){const value=await window.testRead(path),next=fn(value);if(next===undefined)return{committed:false,snapshot:snapshot(value)};await window.testWrite(path,next,false);return{committed:true,snapshot:snapshot(next)}}
export function onValue(path,cb){const item={path,cb};listeners.add(item);window.testRead(path).then(value=>{if(listeners.has(item))cb(snapshot(value))});return()=>listeners.delete(item)}
`;
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),headless:true,args:['--no-sandbox']}),pages=[],state={rooms:{},votes:{},ddused:{},'.info':{connected:true,serverTimeOffset:0}},errors=[];
 const read=path=>path.split('/').filter(Boolean).reduce((obj,k)=>obj?.[k],state)??null;
 const put=(path,value)=>{const parts=path.split('/').filter(Boolean),key=parts.pop();let obj=state;for(const p of parts)obj=obj[p]??={};if(value===null)delete obj[key];else obj[key]=value;};
 const notify=()=>Promise.all(pages.filter(p=>!p.isClosed()).map(p=>p.evaluate(()=>window.__notify?.())));
 async function page(width){ const p=await browser.newPage({viewport:{width,height:900}});pages.push(p);p.setDefaultTimeout(12000);p.on('pageerror',e=>errors.push(e.message));
  await p.exposeFunction('testRead',path=>structuredClone(read(path)));
  await p.exposeFunction('testWrite',async(path,value,update)=>{if(update){for(const[k,v]of Object.entries(value))put((path?path+'/':'')+k,v)}else put(path,value);await notify();});
  await p.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='127.0.0.1'){if(u.pathname.startsWith('/assets/'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(root+u.pathname)});return route.fulfill({contentType:'text/html',body:html});}if(u.pathname.endsWith('firebase-app.js'))return route.fulfill({contentType:'text/javascript',body:'export function initializeApp(){return {}}'});if(u.pathname.endsWith('firebase-auth.js'))return route.fulfill({contentType:'text/javascript',body:authModule});if(u.pathname.endsWith('firebase-database.js'))return route.fulfill({contentType:'text/javascript',body:moduleSource});if(u.hostname==='script.google.com')return route.fulfill({contentType:'application/json',body:JSON.stringify(u.searchParams.get('action')==='image'?image:deck),headers:{'access-control-allow-origin':'*'}});return route.abort();});return p;
 }
 try {
 // A failed SDK download has a usable recovery screen and retry action.
 const startup=await page(390);let failSDK=true;
 await startup.route('**/firebase-app.js',route=>failSDK?route.abort():route.fallback());
 await startup.goto('http://127.0.0.1:8000/');await startup.locator('#cfgScreen').waitFor({state:'visible'});
 assert((await startup.locator('#cfgWarn').innerText()).includes('Firebase Connection Failed'));failSDK=false;
 await startup.getByRole('button',{name:'Retry connection',exact:true}).click();await startup.waitForFunction(()=>dbReady);await startup.close();
 const host=await page(1440);await host.goto('http://127.0.0.1:8000/');await host.waitForFunction(()=>dbReady);await host.locator('#entryModeSwitch').click();await host.locator('#hostName').fill('Host');await host.locator('#slidesUrl').fill('https://docs.google.com/presentation/d/fixture/edit');await host.getByRole('button',{name:'Create lobby',exact:true}).click();await host.locator('#waiting').waitFor({state:'visible'});const code=await host.locator('#displayCode').innerText();
 await host.evaluate(()=>{timerCfg={enabled:true,duration:30};document.getElementById('lateJoinEnabled').checked=false;persistWaitingSettings()});
 await host.locator('#lobbyCodePrivacy').click();assert.equal(await host.locator('#displayCode').innerText(),'••••••');await host.getByRole('button',{name:'Show QR code',exact:true}).click();assert.equal(await host.locator('#joinQR canvas').count(),0);assert.equal(await host.locator('#joinQR').isVisible(),false);assert.equal(await host.locator('#shareLink').getAttribute('type'),'password');assert(!(await host.locator('#shareDialog').innerText()).includes(code));await host.locator('#shareDialog .dialog-close').click();
 await host.reload();await host.waitForFunction(()=>_latestRoom?.state==='waiting');assert.equal(await host.evaluate(()=>timerCfg.duration),30);assert.equal(await host.locator('#lateJoinEnabled').isChecked(),false);await host.locator('#lateJoinEnabled').check();
 assert.equal(await host.locator('#displayCode').innerText(),'••••••');await host.locator('#lobbyCodePrivacy').click();assert.equal(await host.locator('#displayCode').innerText(),code);
 await host.getByRole('button',{name:'Show QR code',exact:true}).click();assert.equal(await host.locator('#joinQR canvas').count(),1);assert((await host.locator('#shareLink').inputValue()).includes('?room='+code));await host.locator('#shareDialog .dialog-close').click();
 const player=await page(390);await player.goto('http://127.0.0.1:8000/?room='+code);await player.waitForFunction(()=>dbReady);await player.waitForFunction(code=>document.getElementById('joinCode').value===code,code);await player.locator('#joinName').fill('Player');await player.getByRole('button',{name:'Join game',exact:true}).click();await player.locator('#waiting').waitFor({state:'visible'});
 assert.equal(await player.locator('#displayCode').innerText(),code);assert.equal(await player.locator('#lobbyCodePrivacy').isVisible(),false);
 // A failed next-slide preload recovers during the current round, before advance.
 await player.waitForFunction(()=>!!slideImageCache[slideCacheKey(_latestRoom.slidesUrl,'s2',_latestRoom.imageCacheVersion)]);
 await player.evaluate(()=>{delete slideImageCache[slideCacheKey(_latestRoom.slidesUrl,'s2',_latestRoom.imageCacheVersion)];});
 let nextPreloadAttempts=0;
 await player.route('https://script.google.com/**',route=>{
  const u=new URL(route.request().url());
  if(u.searchParams.get('action')==='image' && u.searchParams.get('pageId')==='s2'){
   nextPreloadAttempts++;
   if(nextPreloadAttempts===1)return route.fulfill({status:503,contentType:'application/json',body:'{}',headers:{'access-control-allow-origin':'*'}});
  }
  return route.fallback();
 });
 // A failed host image keeps the shared clock waiting; retry recovers the round.
 await host.evaluate(()=>{const original=fetchSlideImageDataUrl;fetchSlideImageDataUrl=async()=>{fetchSlideImageDataUrl=original;throw Error('Temporary image failure');};});
 await host.locator('#startBtn').click();await host.locator('#slideError').waitFor({state:'visible'});assert.equal(await host.evaluate(()=>_latestRoom.timer.status),'loading');
 assert.equal(await host.locator('#slideErrorHint').innerText(),'Temporary image failure');
 await host.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copiedLoadingDetails=text;}}}));
 await host.locator('#copySlideLoadError').click();
 const failedDetails=JSON.parse(await host.evaluate(()=>window.__copiedLoadingDetails));
 assert(failedDetails.loads.some(r=>r.kind==='display' && r.status==='failed'));
 assert(!JSON.stringify(failedDetails).includes('Temporary image failure'));
 await host.setViewportSize({width:390,height:900});await host.screenshot({path:'/tmp/tiny-gang-error-diagnostics-mobile.png',fullPage:true});
 assert.equal(await host.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await host.setViewportSize({width:1440,height:900});
 await host.getByRole('button',{name:'Retry slide',exact:true}).click();for(const p of [host,player])await p.waitForFunction(()=>lastSlide===1 && timerState.slideReady && _latestRoom.timer.status==='running');
 await player.waitForFunction(()=>!!slideImageCache[slideCacheKey(_latestRoom.slidesUrl,'s2',_latestRoom.imageCacheVersion)]);
 assert.equal(nextPreloadAttempts,2);assert.equal(await player.evaluate(()=>lastSlide),1);
 await host.locator('#gameCodePrivacy').click();assert.equal(await host.locator('#gameCodePrivacy').innerText(),'Show join code');assert.equal(await player.locator('#gameCodePrivacy').isVisible(),false);
 assert.equal(await host.evaluate(()=>_latestRoom.timer.dueAt),await player.evaluate(()=>_latestRoom.timer.dueAt));
 await host.evaluate(()=>toggleTimerPause());await player.waitForFunction(()=>timerState.paused);assert.equal(await player.locator('#timerDisplay').innerText(),await host.locator('#timerDisplay').innerText());
 const beforeExtend=await host.evaluate(()=>_latestRoom.timer.remainingMs);
 await host.evaluate(()=>extendTimer(10));await player.waitForFunction(expected=>_latestRoom.timer.remainingMs===expected,beforeExtend+10000);assert.equal(await player.locator('#timerDisplay').innerText(),await host.locator('#timerDisplay').innerText());
 await host.evaluate(()=>castVote('smash'));await player.evaluate(()=>castDoubleDown());
 const id=await player.evaluate(()=>myKey());assert.equal(state.ddused[code][id],1);
 // Refresh must finish the current image before competing background requests.
 let releaseCurrent,holdCurrent=true;const reloadRequests=[],currentGate=new Promise(resolve=>{releaseCurrent=resolve});
 await player.route('https://script.google.com/**',async route=>{
  const u=new URL(route.request().url()),pageId=u.searchParams.get('pageId');
  if(holdCurrent && u.searchParams.get('action')==='image'){
   reloadRequests.push(pageId);if(pageId==='s1')await currentGate;
  }
  return route.fallback();
 });
 const requestedCurrent=player.waitForRequest(request=>new URL(request.url()).searchParams.get('pageId')==='s1');
 await player.reload();await requestedCurrent;await player.waitForFunction(()=>_latestRoom?.state==='playing' && myDoubleDownUsed);
 await player.waitForFunction(()=>Object.keys(slideImagePromises).length===1);
 assert.deepEqual(reloadRequests,['s1']);assert.equal(await player.locator('#slideLoader').isVisible(),true);
 assert.equal(await player.evaluate(()=>myKey()),id);assert.equal(await player.locator('#game .vbtn-smash').isDisabled(),true);assert.equal(await player.evaluate(()=>timerState.paused),true);
 holdCurrent=false;releaseCurrent();await player.waitForFunction(()=>timerState.slideReady && !!slideImageCache[slideCacheKey(_latestRoom.slidesUrl,'s2',_latestRoom.imageCacheVersion)]);
 // A denied clipboard still gives the player selectable details without
 // changing the paused round or their accepted Double Down vote.
 await player.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('Clipboard unavailable');}}}));
 await player.locator('#copySlideLoadDetails').click();await player.locator('#slideLoadingDetails').waitFor({state:'visible'});
 const manualDetails=JSON.parse(await player.locator('#slideLoadingDetailsText').inputValue());assert(manualDetails.loads.some(r=>r.status==='loaded'));
 await player.screenshot({path:'/tmp/tiny-gang-loading-details-mobile.png',fullPage:true});
 assert.equal(await player.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await player.locator('#slideLoadingDetails .dialog-close').click();assert.equal(await player.evaluate(()=>timerState.paused),true);assert.equal(state.ddused[code][id],1);
 console.log('Failed next-slide preload recovery, QR join, stable identity, shared pause/extend and refresh resume passed');
 for(let slide=2;slide<=4;slide++){
  await host.evaluate(()=>masterNext());for(const p of [host,player])await p.waitForFunction(slide=>lastSlide===slide && timerState.slideReady,slide);
  await host.evaluate(()=>castVote('smash'));await player.evaluate(slide=>castVote(slide===3?'smash':'pass'),slide);
 }
 const late=await page(390);await late.goto('http://127.0.0.1:8000/?room='+code);await late.waitForFunction(()=>dbReady);await late.locator('#joinName').fill('Late');await late.getByRole('button',{name:'Join game',exact:true}).click();await late.locator('#game').waitFor({state:'visible'});await late.evaluate(()=>castVote('pass'));
 // Results must work even when a one-off votes read never returns.
 for(const p of [host,player,late])await p.evaluate(()=>{const original=window._get;window._get=ref=>ref.startsWith('votes/')?new Promise(()=>{}):original(ref);});
 host.once('dialog',d=>d.accept());await host.evaluate(()=>masterEnd());for(const p of [host,player,late])await p.locator('#results').waitFor({state:'visible'});
 assert((await host.locator('#resSub').innerText()).includes('4/8 slides played'));assert.equal(await host.locator('#hallSection .highlight-card').count(),5);assert((await player.locator('#personalRecap').innerText()).includes('Slide 1'));assert((await late.locator('#personalRecap').innerText()).includes('1 eligible rounds'));
 const stats=await player.evaluate(()=>getPlayerStats(getPlayers(_latestRoom).find(p=>playerKey(p)===myKey()),_latestRoom,_latestVotes));assert.equal(stats.smashPct,50);assert.equal(stats.skipped,0);assert.equal(stats.smashPoints,3);
 await host.locator('#hallSection .highlight-card').first().click();await host.locator('#detailImage').waitFor({state:'visible'});assert((await host.locator('#detailVotes').innerText()).includes('Double Down'));await host.locator('#slideDetail .dialog-close').click();
 await host.screenshot({path:'/tmp/tiny-gang-results-upgrade.png',fullPage:true});await player.screenshot({path:'/tmp/tiny-gang-results-mobile.png',fullPage:true});assert.equal(await player.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 const csv=await host.evaluate(()=>new Promise(resolve=>{const B=Blob;window.Blob=class extends B{constructor(parts,opts){super(parts,opts);resolve(parts.join(''))}};downloadResults(_latestRoom,_latestVotes);window.Blob=B;}));assert(csv.includes('Played Slides,4'));assert(csv.includes('1,rated,2,0,1,smash,supersmash,not eligible'));assert(!csv.includes('8,rated'));
 console.log('Early-end statistics, late-join eligibility, clickable highlights, personal recaps, CSV and mobile layout passed');
 // Late delivery of an accepted final vote must also update visible results.
 const hostId=await host.evaluate(()=>myKey());put(`votes/${code}/4/${hostId}`,'pass');await notify();
 for(const p of [host,player,late]){
  await p.waitForFunction(({code,id})=>_latestRoom?.code===code && _latestVotes[4]?.[id]==='pass',{code,id:hostId});
  assert.equal(await p.locator('#resultsSmashBoard .smash-row').filter({hasText:'Host'}).locator('.smash-count').innerText(),'3🔥');
 }
 put(`votes/${code}/4/${hostId}`,'smash');await notify();
 await host.locator('#rematchBtn').click();for(const p of [host,player,late])await p.waitForFunction(old=>me.code!==old && _latestRoom?.state==='waiting',code);
 assert.equal(await host.locator('#displayCode').innerText(),'••••••');assert.equal(await host.locator('#lobbyCodePrivacy').getAttribute('aria-pressed'),'true');
 const next=await host.evaluate(()=>me.code);assert.equal(await player.evaluate(()=>me.code),next);assert.equal(await host.evaluate(()=>me.isMaster),true);assert.equal(await player.evaluate(()=>myDoubleDownUsed),false);assert.equal(Object.keys(state.rooms[next].players).length,3);await host.locator('#startBtn').click();await host.waitForFunction(()=>lastSlide===1 && _latestRoom.timer.status==='running');
 const deadline=state.rooms[next].timer.dueAt;put(`rooms/${next}/timer/dueAt`,Date.now()+500);await notify();await host.waitForFunction(()=>lastSlide===2);await player.waitForFunction(()=>lastSlide===2);
 // Finish the round's startup transaction before deleting its room; the mock
 // transaction adapter does not implement Firebase's conflict retries.
 for(const p of [host,player])await p.waitForFunction(()=>lastSlide===2 && timerState.slideReady && _latestRoom.timer.status==='running');
 put(`rooms/${next}`,null);await notify();for(const p of [host,player,late]){await p.locator('#entry').waitFor({state:'visible'});assert.equal(await p.evaluate(()=>timerState.intervalId),null);assert.equal(await p.evaluate(()=>me.code),'');}
 assert.deepEqual(errors,[]);console.log('SDK retry, live results without blocking reads, deleted-room recovery, group rematch and automatic shared timer advance passed');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
