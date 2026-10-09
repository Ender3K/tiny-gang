import test from 'node:test';
import assert from 'node:assert/strict';
import {parseVote,eligibleChatVote,VoteCollector} from '../src/votes.mjs';
import {FirebaseStore} from '../src/firebase-store.mjs';
import {MemoryDatabase,room} from './fixtures.mjs';
test('commands are exact, case insensitive and optionally bound to a slide', () => {
  assert.deepEqual(parseVote(' !SMASH 12 '),{choice:'smash',slide:12});
  assert.deepEqual(parseVote('!pass'),{choice:'pass',slide:null});
  for (const text of ['smash','!smash hello','!pass 0','!smash 1 !pass','!passion','hello !pass']) assert.equal(parseVote(text),null);
});
test('closed, loading, stale, unrated, vetoed and wrong-slide messages cannot vote', () => {
  const now = 1700000000000, current = room(now), message = {text:'!smash',userId:'10',sentAt:new Date(now).toISOString()};
  assert.equal(eligibleChatVote(current,message,now).slide,1);
  for (const change of [{state:'waiting'},{slideVotingDisabled:{1:true}},{vetoed:{1:true}},{timer:{status:'loading'}},{timer:{status:'running',enabled:true,dueAt:now}}]) assert.equal(eligibleChatVote({...current,...change},message,now),null);
  for (const change of [{text:'!pass 2'},{userId:'name'},{sentAt:'invalid'},{sentAt:new Date(now-2000).toISOString()},{sentAt:new Date(now+10000).toISOString()}]) assert.equal(eligibleChatVote(current,{...message,...change},now),null);
  assert.equal(eligibleChatVote({...current,timer:{status:'running',enabled:true,paused:true,dueAt:now-1}},message,now).choice,'smash');
});
test('account deduplication survives batches, reconnects and restarts; IDs stay private', async () => {
  const now = Date.now(), db = new MemoryDatabase(), store = new FirebaseStore(db); let current = room(now);
  const create = () => new VoteCollector({store,roomCode:'ROAR80',getRoom:()=>current,now:()=>now});
  let collector = create();
  const message = (userId,text,messageId) => ({userId,text,messageId,sentAt:new Date(now).toISOString()});
  collector.receive(message('10','!smash','a')); collector.receive(message('10','!pass','b')); collector.receive(message('11','!pass','c'));
  assert.equal(collector.receive(message('12','!pass','c')),false);
  await collector.stop();
  collector = create(); collector.receive(message('10','!pass','d')); await collector.stop();
  assert.deepEqual(db.read('twitch/ROAR80/rounds/1'),{openedAt:now-1000,smash:1,pass:1,total:2});
  assert.deepEqual(db.read('twitchPrivate/ROAR80/1').voters,{'10':'smash','11':'pass'});
  current = {...current,currentSlide:2,rounds:{2:{openedAt:now-100}}};
  collector = create(); collector.receive(message('10','!pass','e')); await collector.stop(); assert.equal(db.read('twitch/ROAR80/rounds/2').pass,1);
  db.put('twitch/ROAR80/rounds/1',null); await store.recoverVotes('ROAR80'); assert.equal(db.read('twitch/ROAR80/rounds/1').total,2);
  await store.recordVotes('ROAR80',1,now+10,{'99':'smash'}); assert.equal(db.read('twitch/ROAR80/rounds/1').total,2);
});
test('transient storage failure retries idempotently', async () => {
  const now = Date.now(); let calls = 0;
  const collector = new VoteCollector({roomCode:'ROAR80',getRoom:()=>room(now),store:{recordVotes:async () => {if (++calls === 1) throw new Error('temporary');}}});
  collector.receive({text:'!smash',userId:'10',sentAt:new Date(now).toISOString()}); await collector.stop(); assert.equal(calls,2);
});
