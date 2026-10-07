const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const source=fs.readFileSync(path.join(__dirname,'../apps-script/Code.gs'),'utf8');
function service(){
  const entries=new Map();const calls=[];let now=1000000;let lockRecheck=null;let status=200;let releases=0;
  const context=vm.createContext({
    Date:{now:()=>now},
    Utilities:{DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(algorithm,value)=>[...crypto.createHash(algorithm).update(value).digest()],getUuid:()=> 'snapshot'},
    ContentService:{MimeType:{JSON:'json',JAVASCRIPT:'js'},createTextOutput:body=>({body,setMimeType(){return this}})},
    CacheService:{getScriptCache:()=>({get:key=>entries.get(key)?.value||null,put:(key,value,ttl)=>entries.set(key,{value,ttl})})},
    LockService:{getScriptLock:()=>({waitLock(){if(lockRecheck)lockRecheck()},releaseLock(){releases++}})},
    ScriptApp:{getOAuthToken:()=> 'test-token'},
    UrlFetchApp:{fetch(url,options){calls.push({url,options});return{getResponseCode:()=>status,getContentText:()=>JSON.stringify({contentUrl:'https://images.example/slide-'+calls.length+'.png'})}}}
  });vm.runInContext(source,context);
  return{context,entries,calls,get releases(){return releases},advance:ms=>{now+=ms},onLock:fn=>{lockRecheck=fn},fail:()=>{status=403}};
}
test('players in the same lobby reuse one thumbnail URL without a second render',()=>{
  const s=service();const first=s.context.getSharedSlideImage('deck','page','room-version');
  const second=s.context.getSharedSlideImage('deck','page','room-version');
  assert.equal(first.imageUrl,second.imageUrl);assert.equal(s.calls.length,1);assert.equal(s.releases,1);
  assert(s.calls[0].url.includes('/pages/page/thumbnail?thumbnailProperties.thumbnailSize=LARGE'));
  assert.equal([...s.entries.values()][0].ttl,1200);
  assert([...s.entries.values()][0].value.length<1000);
});
test('a new lobby snapshot, expiry or forced refresh gets a fresh URL',()=>{
  const s=service();const a=s.context.getSharedSlideImage('deck','page','room-one');
  assert.notEqual(s.context.getSharedSlideImage('deck','page','room-two').imageUrl,a.imageUrl);
  s.advance(20*60*1000);assert.notEqual(s.context.getSharedSlideImage('deck','page','room-one').imageUrl,a.imageUrl);
  s.context.getSharedSlideImage('deck','page','room-one',true);assert.equal(s.calls.length,4);
});
test('a player waiting for the cache lock rechecks the result rendered by another player',()=>{
  const s=service();s.context.getSharedSlideImage('deck','page','version');
  const [key,entry]=[...s.entries][0];s.entries.delete(key);
  s.onLock(()=>s.entries.set(key,entry));
  assert.equal(s.context.getSharedSlideImage('deck','page','version').ok,true);
  assert.equal(s.calls.length,1);assert.equal(s.releases,2);
});
test('failed thumbnail generation releases the lock and never caches the failure',()=>{
  const s=service();s.fail();assert.throws(()=>s.context.getSharedSlideImage('deck','page','version'),/HTTP 403/);
  assert.equal(s.entries.size,0);assert.equal(s.releases,1);
  const result=JSON.parse(s.context.doGet({parameter:{action:'image',presentationId:'deck',pageId:'page',format:'url',cacheVersion:'version'}}).body);
  assert.equal(result.ok,false);assert(result.error.includes('Google Slides API'));
});
