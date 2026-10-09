const {chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
const root=require('node:path').resolve(__dirname,'..');
const html=fs.readFileSync(root+'/index.html','utf8');
const deck={ok:true,totalSlides:3,slidePageIds:['s1','s2','s3'],slideDurations:{},slideVotingDisabled:{2:true},timingVersion:1,notesRulesVersion:1,imageCacheVersion:'fixture'};
const image={ok:true,dataUrl:'data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="purple"/></svg>').toString('base64')};
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
 const {createServer}=await import('../twitch-service/src/server.mjs'),{ConnectionManager}=await import('../twitch-service/src/manager.mjs'),{FirebaseStore}=await import('../twitch-service/src/firebase-store.mjs'),{EventSubConnection}=await import('../twitch-service/src/twitch.mjs'),{MemoryDatabase,FakeSocket,welcome,notification}=await import('../twitch-service/test/fixtures.mjs');
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']}),pages=[],errors=[];
 const db=new MemoryDatabase({rooms:{},votes:{},ddused:{},'.info':{connected:true,serverTimeOffset:0}});
 const notify=()=>Promise.all(pages.filter(p=>!p.isClosed()).map(p=>p.evaluate(()=>window.__notify?.()).catch(()=>{})));
 const originalPut=db.put.bind(db);db.put=(path,value)=>{originalPut(path,value);void notify();};
 const vault={records:{},list(){return Object.values(this.records)},get(code){return this.records[code]},async set(code,record){this.records[code]=record},async delete(code){delete this.records[code]}};
 const api={authorizeUrl:state=>'https://id.twitch.tv/oauth2/authorize?state='+state,exchange:async()=>({accessToken:'fixture-private-access',refreshToken:'fixture-private-refresh',expiresAt:Date.now()+3600000}),validate:async()=>{},user:async()=>({id:'42',login:'fixture_streamer'}),subscribe:async()=>{}};
 const manager=new ConnectionManager({store:new FirebaseStore(db),vault,api,socketFactory:options=>{
  const connection=new EventSubConnection({...options,WebSocketImpl:FakeSocket}),start=connection.start.bind(connection);
  connection.start=()=>{start();setImmediate(()=>FakeSocket.sockets.at(-1).sendFixture(welcome('fixture-session')))};return connection;
 }});
 const config={publicUrl:'http://127.0.0.1',origins:['http://127.0.0.1:8000']},server=createServer({config,manager,api});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const serviceOrigin='http://127.0.0.1:'+server.address().port;config.publicUrl=serviceOrigin;
 const keepalive=setInterval(()=>{for(const socket of FakeSocket.sockets)if(!socket.closed)socket.sendFixture({metadata:{message_type:'session_keepalive'}})},2000);
 async function page(width){const p=await browser.newPage({viewport:{width,height:900}});pages.push(p);p.setDefaultTimeout(12000);p.on('pageerror',e=>errors.push(e.message));
  await p.exposeFunction('testRead',path=>db.read(path));await p.exposeFunction('testWrite',async(path,value,update)=>{if(update){for(const[k,v]of Object.entries(value))db.put((path?path+'/':'')+k,v)}else db.put(path,value);await notify()});
  // Bridge local HTTP through Node: the cloud browser blocks direct loopback requests.
  // Responses (including CORS and CSP) still come from the real service.
  const route=async route=>{const u=new URL(route.request().url());if(u.origin===serviceOrigin){const request=route.request(),response=await fetch(request.url(),{method:request.method(),headers:await request.allHeaders(),body:request.postData() || undefined});return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});}if(u.hostname==='id.twitch.tv')return route.fulfill({status:302,headers:{location:serviceOrigin+'/auth/twitch/callback?code=fixture&state='+u.searchParams.get('state')}});if(u.hostname==='127.0.0.1'){if(u.pathname.startsWith('/assets/'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(root+u.pathname)});return route.fulfill({contentType:'text/html',body:html})}if(u.pathname.endsWith('firebase-app.js'))return route.fulfill({contentType:'text/javascript',body:'export function initializeApp(){return {}}'});if(u.pathname.endsWith('firebase-database.js'))return route.fulfill({contentType:'text/javascript',body:moduleSource});if(u.hostname==='script.google.com')return route.fulfill({contentType:'application/json',body:JSON.stringify(u.searchParams.get('action')==='image'?image:deck),headers:{'access-control-allow-origin':'*'}});return route.abort();};
  await p.context().route('**/*',route);return p;
 }
 try{
 const host=await page(1440);await host.goto('http://127.0.0.1:8000/');await host.waitForFunction(()=>dbReady);await host.locator('#entryModeSwitch').click();await host.locator('#hostName').fill('Host');await host.locator('#slidesUrl').fill('https://docs.google.com/presentation/d/fixture/edit');await host.getByRole('button',{name:'Create lobby',exact:true}).click();await host.locator('#waiting').waitFor({state:'visible'});const code=await host.locator('#displayCode').innerText(); console.log('Twitch test: lobby created');
 assert.match(db.read('rooms/'+code).twitchControlHash,/^[a-f0-9]{64}$/);assert(!JSON.stringify(db.read('rooms/'+code)).includes(await host.evaluate(code=>JSON.parse(localStorage.getItem('sop-twitch-owner-'+code)),code)));
 await host.locator('#twitchWaiting button').click();await host.locator('#twitchServiceUrl').fill(serviceOrigin);await host.locator('#twitchConnect').click();await host.waitForFunction(()=>document.getElementById('twitchSetupStatus').textContent.startsWith('Connected to')).catch(async error=>{console.log('Setup status:',await host.locator('#twitchSetupStatus').innerText());console.log('Popup pages:',host.context().pages().map(p=>p.url()));throw error;});await host.locator('#twitchDisconnect').click();await host.waitForFunction(()=>document.getElementById('twitchSetupStatus').textContent==='Twitch disconnected.');assert.equal(db.read('twitch/'+code+'/connection').status,'disconnected');await host.locator('#twitchConnect').click();await host.waitForFunction(()=>document.getElementById('twitchSetupStatus').textContent.startsWith('Connected to'));await host.locator('.twitch-dialog .dialog-close').click();
 console.log('Twitch test: OAuth connected'); assert.equal(db.read('twitch/'+code+'/connection').channel,'fixture_streamer');assert(!JSON.stringify(db.data.twitch).includes('fixture-private'));
 const player=await page(390);await player.goto('http://127.0.0.1:8000/?room='+code);await player.waitForFunction(()=>dbReady);await player.locator('#joinName').fill('Player');await player.getByRole('button',{name:'Join game',exact:true}).click();await player.locator('#waiting').waitFor({state:'visible'});await player.locator('#twitchWaiting').waitFor({state:'visible'});assert.equal(await player.locator('#twitchWaiting button').count(),0);
 await host.locator('#startBtn').click();for(const p of[host,player])await p.waitForFunction(()=>lastSlide===1 && timerState.slideReady && _latestRoom.timer.status==='running');
 console.log('Twitch test: game started'); const chat=(text,userId='10',timestamp=Date.now(),id=Math.random().toString())=>FakeSocket.sockets.at(-1).sendFixture(notification(text,userId,timestamp,id));
 chat('!smash','10',Date.now(),'one');chat('!pass','10',Date.now(),'two');chat('!pass 1','11');chat('!smash 2','12');chat('!smash','13',db.read('rooms/'+code+'/rounds/1/openedAt')-1);
 for(const p of[host,player])await p.waitForFunction(()=>document.querySelector('#twitchGame [data-twitch-tally]').textContent.includes('2 votes'));
 assert.equal(db.read('twitch/'+code+'/rounds/1').smash,1);assert.equal(db.read('twitch/'+code+'/rounds/1').pass,1);assert.equal(db.read('votes/'+code),null);
 console.log('Twitch test: votes received'); await host.reload();await host.waitForFunction(()=>_latestRoom?.state==='playing' && timerState.slideReady);assert((await host.locator('#twitchGame').innerText()).includes('2 votes'));
 console.log('Twitch test: advance'); await host.evaluate(()=>masterNext());for(const p of[host,player])await p.waitForFunction(()=>lastSlide===2 && timerState.slideReady);chat('!smash','14');await new Promise(resolve=>setTimeout(resolve,350));assert.equal(db.read('twitch/'+code+'/rounds/2'),null);assert((await player.locator('#twitchGame').innerText()).includes('Voting disabled'));
 console.log('Twitch test: advance'); await host.evaluate(()=>masterNext());await host.waitForFunction(()=>lastSlide===3 && _latestRoom.timer.status==='running');chat('!pass 1','15');chat('!pass 3','10');await player.waitForFunction(()=>document.querySelector('#twitchGame [data-twitch-tally]').textContent.includes('1 vote'));
 assert.equal(await player.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await player.screenshot({path:'/tmp/tiny-gang-twitch-mobile.png',fullPage:true});
 console.log('Twitch test: finish'); host.once('dialog',d=>d.accept());await host.evaluate(()=>masterEnd());for(const p of[host,player])await p.locator('#results').waitFor({state:'visible'});await player.waitForFunction(()=>document.getElementById('twitchResults').textContent.includes('3 chat votes'));assert((await player.locator('#twitchResults').innerText()).includes('1 smash · 2 pass'));
 await manager.chain;assert.equal(vault.get(code),undefined);assert.equal(db.read('twitch/'+code+'/connection').status,'ended');assert.deepEqual(errors,[]);
 console.log('Twitch OAuth popup, host-only controls, separate shared tallies, account deduplication, refresh, late messages, ! slides, stream-delay slide numbers, results and mobile layout passed');
 }catch(error){console.error('Twitch browser check failed:',error);throw error;}finally{clearInterval(keepalive);await manager.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
