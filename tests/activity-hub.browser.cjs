const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const documents=new Map(['index.html','smash-or-pass.html','origin-workshop.html','assets/qrcode.min.js'].map(name=>[name,fs.readFileSync(path.join(root,name))]));
const auth=`export const browserLocalPersistence={};export async function setPersistence(){};export function getAuth(){return{currentUser:{uid:'hub-fixture'},authStateReady:async()=>{}}};export async function signInAnonymously(){return{user:{uid:'hub-fixture'}}};export function onAuthStateChanged(a,cb){cb(a.currentUser);return()=>{}};`;
const database=`const snap=value=>({exists:()=>value!==null,val:()=>value});export function getDatabase(){return{}};export function ref(db,path=''){return path};export async function get(){return snap(null)};export async function set(){};export async function update(){};export async function runTransaction(){return{committed:false,snapshot:snap(null)}};export function onValue(path,cb){queueMicrotask(()=>cb(snap(path==='.info/connected'?true:path==='.info/serverTimeOffset'?0:null)));return()=>{}};`;
(async()=>{
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost'),prefix='/tiny-gang/';
  if(!url.pathname.startsWith(prefix)){res.writeHead(404);res.end();return;}
  const name=url.pathname.slice(prefix.length)||'index.html',body=documents.get(name);
  if(!body){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':'text/html; charset=utf-8');res.end(body);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}/tiny-gang/`;
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:1400,height:1000},acceptDownloads:true}),requests=[],errors=[];
  await context.route('**/*',route=>{
   const url=new URL(route.request().url());requests.push(url.href);
   if(url.origin===new URL(base).origin)return route.continue();
   if(url.hostname==='www.gstatic.com'&&url.pathname.endsWith('firebase-app.js'))return route.fulfill({contentType:'text/javascript',body:'export function initializeApp(){return {}}'});
   if(url.hostname==='www.gstatic.com'&&url.pathname.endsWith('firebase-auth.js'))return route.fulfill({contentType:'text/javascript',body:auth});
   if(url.hostname==='www.gstatic.com'&&url.pathname.endsWith('firebase-database.js'))return route.fulfill({contentType:'text/javascript',body:database});
   return route.abort();
  });
  await context.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.__copied=text}}));
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);assert.equal(await page.title(),'Tiny Gang');assert.equal(await page.locator('.activity').count(),2);assert(!requests.some(url=>url.includes('firebase')||url.includes('script.google.com')));
  await page.screenshot({path:'/tmp/tiny-gang-hub-desktop.png',fullPage:true});
  await page.keyboard.press('Tab');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'Open Smash or Pass');
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'Open Origin Builder');await page.keyboard.press('Enter');
  await page.waitForURL(base+'origin-workshop.html');assert.equal(await page.locator('.trait').count(),129);assert.equal(await page.locator('.example-card').count(),16);assert(!requests.some(url=>url.includes('firebase')||url.includes('script.google.com')));
  await page.locator('#origin-name').fill('Hub wanderer');await page.locator('[data-group="Cosmetics"]').click();await page.locator('#od-A06').check();await page.locator('#od-style-A06').selectOption('Mermaid tail (in water)');await page.locator('#od-detail-A06').fill('Blue scales');
  await page.locator('[data-group="Vision"]').click();await page.locator('#od-D39').check();await page.locator('#od-S04').check();assert.equal(await page.locator('[data-refund]').textContent(),'0.0 / 6');assert.equal(await page.locator('[data-total]').textContent(),'9.0');
  await page.locator('#copy-build').click();const copy=await page.evaluate(()=>window.__copied);assert(copy.includes('No refund'));assert(copy.includes('Mermaid tail (in water); Blue scales'));
  const pending=page.waitForEvent('download');await page.locator('#download-build').click();const download=await pending,json=JSON.parse(fs.readFileSync(await download.path(),'utf8'));assert(json.traits.some(t=>t.id==='A06'&&t.detail==='Blue scales'));assert(json.traits.some(t=>t.id==='D39'));
  await page.locator('.tiny-gang-home').click();await page.waitForURL(base);await page.getByRole('link',{name:'Open Origin Builder',exact:true}).click();assert.equal(await page.locator('#origin-name').inputValue(),'Hub wanderer');assert.equal(await page.locator('[data-total]').textContent(),'9.0');
  await page.locator('[data-group="Cosmetics"]').click();assert.equal(await page.locator('#od-detail-A06').inputValue(),'Blue scales');
  await page.locator('.tiny-gang-home').click();await page.getByRole('link',{name:'Open Smash or Pass',exact:true}).click();await page.waitForURL(base+'smash-or-pass.html');await page.waitForFunction(()=>dbReady);assert(await page.locator('#entry').isVisible());await page.locator('#entryModeSwitch').click();assert(await page.locator('#hostPanel').isVisible());await page.getByRole('link',{name:'Back to Tiny Gang',exact:true}).click();await page.waitForURL(base);
  for(const suffix of ['?room=NOVA42','#invite='+'a'.repeat(64),'?room=NOVA42&spectator=1','index.html?room=NOVA42&extra=kept#invite='+'b'.repeat(64)]){
   const incoming=new URL(suffix.startsWith('index.html')?suffix:base+suffix,base),expected=new URL('smash-or-pass.html',base);expected.search=incoming.search;expected.hash=incoming.hash;
   await page.goto(incoming.href);await page.waitForURL(expected.href);await page.waitForFunction(()=>dbReady);assert.equal(page.url(),expected.href);
  }
  await page.goto(base+'?utm_source=discord');assert.equal(await page.title(),'Tiny Gang');
  for(const width of [390,320]){
   await page.setViewportSize({width,height:1000});
   for(const file of ['index.html','smash-or-pass.html','origin-workshop.html']){await page.goto(base+file);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false,file+' overflow at '+width);}
  }
  await page.goto(base);await page.screenshot({path:'/tmp/tiny-gang-hub-mobile.png',fullPage:true});assert.deepEqual(errors,[]);
  console.log('Activity hub passed: both activities, keyboard access, GitHub Pages subpaths, legacy room/private/spectator invites, offline builder services, draft recovery, downloads, vision refunds and 320px mobile layout.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
