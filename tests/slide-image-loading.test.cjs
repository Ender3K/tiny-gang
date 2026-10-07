const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function app(implementation,failImage){
  let now=1000000;const calls=[];
  class Image {set src(value){queueMicrotask(()=>{if(failImage?.(value)){this.onerror?.()}else this.onload?.()})}}
  const context=vm.createContext({AbortController,Image,Date:{now:()=>now},APPS_SCRIPT_WEBAPP_URL:'https://example.com/exec',slideImageCache:{},slideImagePromises:{},getSlideId:()=> 'deck',async requestAppsScript(url,signal){calls.push({url,signal});return implementation(calls.length,url)}});
  vm.runInContext(html.slice(html.indexOf('function createSlideImageQueue('),html.indexOf('// ── Timer config')),context);context.slideImageQueue=context.createSlideImageQueue(2);
  return{context,calls,advance:ms=>{now+=ms},get:(version='snapshot')=>context.fetchSlideImageDataUrl('https://docs.google.com/presentation/d/deck','page',version)};
}
test('browser loads and decodes a shared image once, then reuses it on game start',async()=>{
  const a=app(()=>({ok:true,imageUrl:'https://images.example/page',expiresAt:2000000}));
  assert.equal(await a.get(),'https://images.example/page');assert.equal(await a.get(),'https://images.example/page');assert.equal(a.calls.length,1);
  assert(a.calls[0].url.includes('format=url'));assert(a.calls[0].url.includes('cacheVersion=snapshot'));
});
test('expired URLs and a new lobby snapshot fetch again',async()=>{
  const a=app(count=>({ok:true,imageUrl:'https://images.example/'+count,expiresAt:2000000+count*1000000}));
  await a.get();await a.get('new-snapshot');assert.equal(a.calls.length,2);a.advance(3000000);await a.get();assert.equal(a.calls.length,3);
});
test('older Apps Script deployments still load and cache base64 images',async()=>{
  const data='data:image/png;base64,dGVzdA==';const a=app(()=>({ok:true,dataUrl:data}));assert.equal(await a.get(),data);a.advance(3600000);assert.equal(await a.get(),data);assert.equal(a.calls.length,1);
});
test('an image URL that fails to load is refreshed once before showing an error',async()=>{
  const a=app(count=>({ok:true,imageUrl:'https://images.example/'+count,expiresAt:2000000}),url=>url.endsWith('/1'));
  assert.equal(await a.get(),'https://images.example/2');assert.equal(a.calls.length,2);assert(a.calls[1].url.includes('refresh=1'));
  const failed=app(()=>({ok:true,imageUrl:'https://images.example/broken',expiresAt:2000000}),()=>true);
  await assert.rejects(failed.get(),/Could not load slide image/);assert.equal(failed.calls.length,2);
});
