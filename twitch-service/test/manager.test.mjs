import test from 'node:test';
import assert from 'node:assert/strict';
import {ConnectionManager,hash} from '../src/manager.mjs';
import {FirebaseStore} from '../src/firebase-store.mjs';
import {MemoryDatabase,settle,room} from './fixtures.mjs';
function fixture() {
  const key = 'a'.repeat(64), db = new MemoryDatabase({rooms:{ROAR80:{...room(),twitchControlHash:hash(key)},ROAR81:{...room(),twitchControlHash:hash(key)}}});
  const vault = {records:{},list(){return Object.values(this.records);},get(code){return this.records[code];},async set(code,record){this.records[code]=record;},async delete(code){delete this.records[code];}};
  const sockets = [], api = {validate:async()=>{},refresh:async()=>({accessToken:'renewed',refreshToken:'renewed-refresh',expiresAt:Date.now()+3600000}),subscribe:async()=>{}};
  const manager = new ConnectionManager({store:new FirebaseStore(db),vault,api,socketFactory:options=>{const socket = {options,started:false,stopped:false,start(){this.started=true;options.onStatus('connected');},stop(){this.stopped=true;}};sockets.push(socket);return socket;}});
  return {key,db,vault,sockets,api,manager};
}
test('room capability authenticates host; one channel belongs to one room and controls remain private', async () => {
  const {key,db,vault,sockets,manager} = fixture();
  try {
    await manager.verifyOwner('ROAR80',key); await assert.rejects(manager.verifyOwner('ROAR80','c'.repeat(64)),/fresh lobby/);
    const first = await manager.connect('ROAR80',hash(key),{accessToken:'token',refreshToken:'refresh',expiresAt:Date.now()+3600000},{id:'42',login:'streamer'});
    assert.equal(db.read('twitch/ROAR80/connection').channel,'streamer'); assert(!JSON.stringify(db.data.twitch).includes(first.controlToken));
    await assert.rejects(manager.disconnect('ROAR80','wrong'),/host device/);
    const second = await manager.connect('ROAR81',hash(key),{accessToken:'token',refreshToken:'refresh',expiresAt:Date.now()+3600000},{id:'42',login:'streamer'});
    assert.equal(sockets[0].stopped,true); assert.equal(vault.get('ROAR80'),undefined); assert.equal(db.read('twitch/ROAR80/connection').status,'disconnected');
    await manager.disconnect('ROAR81',second.controlToken); assert.equal(sockets[1].stopped,true);
  } finally {await manager.close();}
});
test('game completion flushes accepted votes, rejects later chat and clears authorization', async () => {
  const {key,db,vault,sockets,manager} = fixture();
  try {
    await manager.connect('ROAR80',hash(key),{accessToken:'token',refreshToken:'refresh',expiresAt:Date.now()+3600000},{id:'42',login:'streamer'});
    sockets[0].options.onChat({text:'!smash',userId:'10',sentAt:new Date().toISOString(),messageId:'one'});
    db.put('rooms/ROAR80/state','done'); await settle(); await manager.chain;
    assert.equal(db.read('twitch/ROAR80/rounds/1').smash,1); assert.equal(db.read('twitch/ROAR80/connection').status,'ended'); assert.equal(vault.get('ROAR80'),undefined);
    sockets[0].options.onChat({text:'!pass',userId:'11',sentAt:new Date().toISOString(),messageId:'two'}); assert.equal(db.read('twitch/ROAR80/rounds/1').total,1);
  } finally {await manager.close();}
});
test('normal shutdown preserves encrypted records; restart restores deduplication and coalesces refreshes', async () => {
  const {key,db,vault,api,manager} = fixture(); let refreshes = 0; const original = api.refresh; api.refresh = async record => {refreshes++; await settle(); return original(record);};
  await manager.connect('ROAR80',hash(key),{accessToken:'token',refreshToken:'refresh',expiresAt:Date.now()+3600000},{id:'42',login:'streamer'});
  const record = vault.get('ROAR80'); record.expiresAt = 0; await Promise.all([manager.token(record),manager.token(record)]); assert.equal(refreshes,1);
  await manager.close(); assert.equal(vault.get('ROAR80').accessToken,'renewed'); await manager.restore(); assert.equal(manager.active.size,1); assert.equal(db.read('twitch/ROAR80/connection').status,'connected'); await manager.close();
});
