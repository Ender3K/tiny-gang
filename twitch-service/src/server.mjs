import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {initializeApp, cert} from 'firebase-admin/app';
import {getDatabase} from 'firebase-admin/database';
import {readConfig} from './config.mjs';
import {TokenVault} from './vault.mjs';
import {FirebaseStore} from './firebase-store.mjs';
import {TwitchApi, TwitchError} from './twitch.mjs';
import {ConnectionManager, secret} from './manager.mjs';

async function body(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > 4096) throw new TwitchError('Request too large.', 413);
  }
  try { return JSON.parse(text); } catch { throw new TwitchError('Invalid JSON request.', 400); }
}
export function createServer({config, manager, api, now = Date.now}) {
  const states = new Map(), attempts = new Map();
  const server = http.createServer(async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    const json = (status, data) => {res.writeHead(status, {'content-type':'application/json'}); res.end(JSON.stringify(data));};
    try {
      const url = new URL(req.url, config.publicUrl);
      if (req.method === 'GET' && url.pathname === '/health') return json(200, {ok:true});
      if (url.pathname === '/auth/twitch/callback' && req.method === 'GET') {
        const state = states.get(url.searchParams.get('state')); states.delete(url.searchParams.get('state'));
        if (!state || state.expires < now()) throw new TwitchError('Login expired. Close this window and connect again.', 400);
        let result = {type:'tiny-gang-twitch', roomCode:state.code, attemptId:state.attemptId};
        try {
          if (url.searchParams.has('error') || !url.searchParams.get('code')) throw new TwitchError('Twitch login was cancelled.');
          const tokens = await api.exchange(url.searchParams.get('code'));
          await api.validate(tokens);
          const user = await api.user(tokens);
          result = {...result, ok:true, ...await manager.connect(state.code, state.ownerHash, tokens, user)};
        } catch (error) { result = {...result, ok:false, error:error instanceof TwitchError ? error.message : 'Connection failed. Please try again.'}; }
        const nonce = secret();
        const payload = JSON.stringify(result).replace(/</g, '\\u003c');
        res.setHeader('content-security-policy', `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`);
        res.writeHead(200, {'content-type':'text/html; charset=utf-8'});
        return res.end(`<!doctype html><title>Twitch connection</title><p>${result.ok ? 'Connected! You can close this window.' : 'Could not connect. Return to the game and try again.'}</p><script nonce="${nonce}">if(window.opener){window.opener.postMessage(${payload},${JSON.stringify(state.origin)});window.close();}</script>`);
      }
      if (!['/api/connect/begin','/api/disconnect'].includes(url.pathname)) return json(404, {error:'Not found.'});
      const origin = req.headers.origin;
      if (!config.origins.includes(origin)) throw new TwitchError('This game origin is not allowed by the service.', 403);
      res.setHeader('access-control-allow-origin', origin); res.setHeader('vary','Origin');
      if (req.method === 'OPTIONS') {
        res.setHeader('access-control-allow-methods','POST'); res.setHeader('access-control-allow-headers','Content-Type'); res.writeHead(204); return res.end();
      }
      if (req.method !== 'POST') throw new TwitchError('Use POST.', 405);
      if (!req.headers['content-type']?.startsWith('application/json')) throw new TwitchError('Use JSON.', 415);
      for (const [key, item] of attempts) if (item.until <= now()) attempts.delete(key);
      for (const [key, item] of states) if (item.expires <= now()) states.delete(key);
      const address = req.socket.remoteAddress || 'unknown', item = attempts.get(address) || {count:0,until:now()+60000};
      if (++item.count > 30 || attempts.size > 10000 || states.size >= 1000) throw new TwitchError('Too many attempts. Wait a minute and retry.', 429);
      attempts.set(address,item);
      const data = await body(req);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new TwitchError('Use a JSON object.', 400);
      if (url.pathname === '/api/disconnect') {
        await manager.disconnect(data.roomCode, data.controlToken); return json(200, {ok:true});
      }
      const room = await manager.verifyOwner(data.roomCode, data.hostKey);
      if (!/^[a-f0-9]{32}$/.test(data.attemptId || '')) throw new TwitchError('Invalid connection attempt.', 400);
      const state = secret();
      states.set(state, {code:data.roomCode, ownerHash:room.twitchControlHash, attemptId:data.attemptId, origin, expires:now()+600000});
      return json(200, {authorizationUrl:api.authorizeUrl(state)});
    } catch (error) {
      if (!res.headersSent) json(error instanceof TwitchError ? error.status : 500, {error:error instanceof TwitchError ? error.message : 'The service could not complete this request. Try again.'});
      else res.end();
    }
  });
  server.requestTimeout = 20000; server.headersTimeout = 10000;
  return server;
}
async function main() {
  const config = readConfig();
  const app = initializeApp({credential:cert(config.serviceAccount), databaseURL:config.databaseUrl});
  const store = new FirebaseStore(getDatabase(app));
  const vault = await new TokenVault(config.vaultPath, config.encryptionKey).load();
  const api = new TwitchApi(config), manager = new ConnectionManager({store,vault,api});
  await manager.restore();
  const server = createServer({config,manager,api});
  server.listen(config.port, config.host, () => console.log('Twitch vote service ready.'));
  for (const signal of ['SIGTERM','SIGINT']) process.once(signal, async () => {
    server.close(); await manager.close(); process.exit(0);
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {console.error(error instanceof TwitchError ? error.message : 'Service startup failed. Check the environment configuration, token disk and Firebase access.'); process.exitCode = 1;});
}
