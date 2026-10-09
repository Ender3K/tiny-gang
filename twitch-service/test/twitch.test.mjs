import test from 'node:test';
import assert from 'node:assert/strict';
import {EventSubConnection,TwitchApi,validSocketUrl} from '../src/twitch.mjs';
import {FakeSocket,manualTimers,settle,welcome,notification} from './fixtures.mjs';
test('welcome subscribes once; server-directed migration keeps subscriptions and votes', async () => {
  FakeSocket.sockets = []; const timers = manualTimers(), subscriptions = [], votes = [], statuses = [];
  const connection = new EventSubConnection({WebSocketImpl:FakeSocket,timers,getRecord:()=>({channelId:'42'}),subscribe:async id=>subscriptions.push(id),onChat:vote=>votes.push(vote),onStatus:status=>statuses.push(status),onRevoked:()=>{}});
  connection.start(); const first = FakeSocket.sockets[0]; first.sendFixture(welcome('one')); await settle();
  first.sendFixture(welcome('one')); first.sendFixture(notification('!smash')); assert.equal(votes.length,1);
  first.sendFixture({metadata:{message_type:'session_reconnect'},payload:{session:{reconnect_url:'wss://eventsub.wss.twitch.tv/ws?session=two'}}});
  const second = FakeSocket.sockets[1]; assert.equal(first.closed,false); second.sendFixture(welcome('two')); await settle();
  assert.equal(first.closed,true); assert.deepEqual(subscriptions,['one']); second.sendFixture(notification('!pass')); assert.equal(votes.length,2);
  connection.stop(); assert.equal(timers.pending.size,0); assert.equal(statuses.at(-1),'connected');
});
test('unexpected disconnect backs off, re-subscribes; revocation stops retrying', async () => {
  FakeSocket.sockets = []; const timers = manualTimers(), subscriptions = []; let revoked = 0;
  const connection = new EventSubConnection({WebSocketImpl:FakeSocket,timers,random:()=>0,getRecord:()=>({channelId:'42'}),subscribe:async id=>subscriptions.push(id),onChat:()=>{},onStatus:()=>{},onRevoked:()=>revoked++});
  connection.start(); FakeSocket.sockets[0].sendFixture(welcome('one')); await settle(); FakeSocket.sockets[0].close();
  timers.run(1000); FakeSocket.sockets[1].sendFixture(welcome('two')); await settle(); assert.deepEqual(subscriptions,['one','two']);
  FakeSocket.sockets[1].sendFixture({metadata:{message_type:'revocation'},payload:{}}); await settle(); assert.equal(revoked,1); assert.equal(timers.pending.size,0);
  assert.equal(validSocketUrl('wss://evil.example/ws'),false); assert.equal(validSocketUrl('https://eventsub.wss.twitch.tv/ws'),false);
});
test('silent sockets trigger watchdog and foreign channel events are ignored', async () => {
  FakeSocket.sockets = []; const timers = manualTimers(); let count = 0;
  const connection = new EventSubConnection({WebSocketImpl:FakeSocket,timers,random:()=>0,getRecord:()=>({channelId:'42'}),subscribe:async()=>{},onChat:()=>count++,onStatus:()=>{},onRevoked:()=>{}});
  connection.start(); timers.run(15000); assert.equal(FakeSocket.sockets[0].closed,true); timers.run(1000);
  const socket = FakeSocket.sockets[1]; socket.sendFixture(welcome('new')); await settle(); const event = notification('!smash'); event.payload.event.broadcaster_user_id = '43'; socket.sendFixture(event); assert.equal(count,0); connection.stop();
});
test('Helix subscription uses the authenticated channel owner and minimal chat scope', async () => {
  const calls = [], api = new TwitchApi({clientId:'client',clientSecret:'secret',redirectUri:'https://service.example/auth/twitch/callback'},async (url, options) => {calls.push({url,options});return {ok:true,json:async()=>({data:[]})};});
  const url = new URL(api.authorizeUrl('state')); assert.equal(url.searchParams.get('scope'),'user:read:chat');
  await api.subscribe({accessToken:'private-token',channelId:'42'},'session');
  assert.deepEqual(JSON.parse(calls[0].options.body),{type:'channel.chat.message',version:'1',condition:{broadcaster_user_id:'42',user_id:'42'},transport:{method:'websocket',session_id:'session'}});
});
