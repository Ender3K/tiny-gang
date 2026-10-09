import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from '../src/server.mjs';
import {hash} from '../src/manager.mjs';
import {TwitchError} from '../src/twitch.mjs';
test('OAuth is origin restricted, room bound and one use; private Twitch tokens never reach the browser', async () => {
  const key = 'a'.repeat(64), attempts = [], config = {publicUrl:'http://127.0.0.1',origins:['https://ender3k.github.io']};
  const manager = {verifyOwner:async (code, proof) => {if (code !== 'ROAR80' || proof !== key) throw new TwitchError('Forbidden',403);return {twitchControlHash:hash(key)};},
    connect:async (...args) => {attempts.push(args);return {controlToken:'b'.repeat(64),channel:'streamer'};},
    disconnect:async (code,token) => {if (token !== 'b'.repeat(64)) throw new TwitchError('Forbidden',403);}};
  const api = {authorizeUrl:state=>'https://id.twitch.tv/oauth2/authorize?state='+state,exchange:async()=>({accessToken:'private-access',refreshToken:'private-refresh'}),validate:async()=>{},user:async()=>({id:'42',login:'streamer'})};
  const server = createServer({config,manager,api}); await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); const base = 'http://127.0.0.1:'+server.address().port;
  const request = (path, data, origin = config.origins[0]) => fetch(base+path,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(data)});
  try {
    assert.equal((await request('/api/connect/begin',{},'https://evil.example')).status,403);
    assert.equal((await request('/api/connect/begin',{roomCode:'ROAR80',hostKey:'wrong'})).status,403);
    const login = await request('/api/connect/begin',{roomCode:'ROAR80',hostKey:key,attemptId:'c'.repeat(32)});
    assert.equal(login.headers.get('access-control-allow-origin'),config.origins[0]);
    const state = new URL((await login.json()).authorizationUrl).searchParams.get('state');
    const callback = await fetch(base+'/auth/twitch/callback?state='+state+'&code=fixture'); const html = await callback.text();
    assert.equal(callback.status,200); assert(html.includes('postMessage')); assert(html.includes(config.origins[0])); assert(!html.includes('private-access')); assert(!html.includes('private-refresh')); assert(callback.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
    assert.equal(attempts[0][1],hash(key)); assert.equal(attempts[0][2].accessToken,'private-access');
    assert.equal((await fetch(base+'/auth/twitch/callback?state='+state+'&code=fixture')).status,400);
    assert.equal((await request('/api/disconnect',{roomCode:'ROAR80',controlToken:'wrong'})).status,403);
    assert.equal((await request('/api/disconnect',{roomCode:'ROAR80',controlToken:'b'.repeat(64)})).status,200);
  } finally {await new Promise(resolve=>server.close(resolve));}
});
