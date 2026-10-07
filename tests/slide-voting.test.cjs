const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const section = (start, end) => html.slice(html.indexOf(start), html.indexOf(end, html.indexOf(start)));
function app(extra = {}) {
  const context = vm.createContext({
    getPlayers: room => Object.values(room.players || {}),
    safeKey: name => name,
    ...extra
  });
  vm.runInContext([
    section('function normalizeSlideVotingDisabled(', 'function isValidSlideDuration('),
    section('function getPlayers(', 'let serverOffset='),
    section('function getSmashTotals(', 'function renderSmashBoard('),
    section('function getPlayerStats(', 'function renderHallOfFameShame('),
    section('async function castVote(', 'async function masterNext('),
    section('async function castDoubleDown(', 'function updateDoubleDownUI(')
  ].join('\n'), context);
  return context;
}

test('metadata accepts only true flags for real slide numbers; old rooms still allow voting', () => {
  const context = app();
  assert.deepEqual(JSON.parse(JSON.stringify(context.normalizeSlideVotingDisabled({'1': true, '2': 'true', '3': 1, '4': false, '5': true}, 4))), {'1': true});
  assert.equal(context.isSlideUnrated({}, 1), false);
  assert.equal(context.isSlideUnrated({slideVotingDisabled: [null, true]}, 1), true);
});

test('notes and veto flags overlap without counting an unrated slide twice', () => {
  const room = {totalSlides: 5, slideVotingDisabled: {'1': true, '3': true}, vetoed: {'3': true, '4': true, '99': true}};
  assert.equal(app().getUnratedSlideCount(room), 3);
});

test('stale votes on disabled slides never affect totals, personal scores or awards', () => {
  const room = {totalSlides: 5, players: {Alice: {name: 'Alice'}, Bob: {name: 'Bob'}}, slideVotingDisabled: {'1': true, '3': true}, vetoed: {'3': true, '4': true}};
  const votes = {
    1: {Alice: 'supersmash', Bob: 'smash'},
    2: {Alice: 'smash', Bob: 'pass'},
    3: {Alice: 'smash', Bob: 'smash'},
    4: {Alice: 'smash', Bob: 'smash'},
    5: {Alice: 'pass', Bob: 'smash'}
  };
  const context = app();
  const totals = context.getSmashTotals(room, votes);
  assert.equal(totals.find(p => p.name === 'Alice').smashes, 1);
  assert.equal(totals.find(p => p.name === 'Bob').smashes, 1);
  const stats = context.getPlayerStats(room.players.Alice, room, votes);
  assert.equal(stats.smashes, 1);
  assert.equal(stats.passes, 1);
  assert.equal(stats.supersmashes, 0);
  assert.equal(stats.skipped, 0); // Unrated slides are never missed votes.
  assert.equal(context.getContrarianPlayer(Object.values(room.players), room, votes), null);
});

test('vote handlers refuse disabled slides and leave Double Down available for the next slide', async () => {
  const room = {state: 'playing', currentSlide: 1, players:{Alice:{name:'Alice'}}, slideVotingDisabled: {'1': true}};
  const writes = [];
  const context = app({
    window: {_get: async () => ({exists: () => true, val: () => room}), _update: async (ref, value) => writes.push({ref, value}), _ref: (db, ref) => ref},
    me: {name: 'Alice', code: 'TEST'},
    myVotedSlides: {}, myDoubleDownUsed: false, votePending:false, connected:true, _latestRoom:room,
    roomRef: () => 'room', voteRef: (code, slide) => 'votes/' + slide,
    markVotedUI() {}, updateDoubleDownUI() {}, showToast() {}, spawnReaction() {}
  });
  await context.castVote('smash');
  await context.castVote('pass');
  await context.castDoubleDown();
  assert.equal(writes.length, 0);
  assert.equal(context.myDoubleDownUsed, false);
  assert.equal(context.myVotedSlides[1], undefined);
  room.currentSlide = 2;
  await context.castDoubleDown();
  assert.equal(context.myDoubleDownUsed, true);
  assert.equal(context.myVotedSlides[2], 'supersmash');
  assert.equal(writes.length, 1);
});


test('early endings and late joins only count played eligible rounds; Double Down adds points, not choices',()=>{
 const room={totalSlides:100,currentSlide:3,players:{a:{id:'a',name:'A'},b:{id:'b',name:'B'}},rounds:{1:{eligible:{a:true}},2:{eligible:{a:true,b:true}},3:{eligible:{a:true,b:true}}}};
 const votes={1:{a:'supersmash',b:'smash'},2:{a:'pass',b:'pass'}};
 const c=app(); const a=c.getPlayerStats(room.players.a,room,votes),b=c.getPlayerStats(room.players.b,room,votes);
 assert.equal(a.smashPct,50); assert.equal(a.smashPoints,2); assert.equal(a.voted,2); assert.equal(a.skipped,1);
 assert.equal(b.eligibleRounds,2);assert.equal(b.skipped,1);assert.equal(b.smashes,0);
 assert.equal(c.getPairComparison(room,votes,room.players.a,room.players.b).total,1);
});
test('highlights require real turnout and exclude unrated and unplayed slides',()=>{
 const room={totalSlides:50,currentSlide:3,players:{a:{name:'a'},b:{name:'b'},c:{name:'c'}}};
 const c=app(),results=c.getSlideResults(room,{1:{a:'smash'},2:{a:'supersmash',b:'pass'},3:{a:'pass',b:'pass',c:'pass'},45:{a:'smash'}});
 assert.equal(results.length,3);assert.equal(results[0].qualified,false);assert.equal(results[1].qualified,true);assert.equal(results[1].total,2);assert.equal(results[1].bonus,1);
});

test('a rejected optimistic vote can be retried without consuming Double Down',async()=>{
 const room={state:'playing',currentSlide:1,players:{Alice:{name:'Alice'}}};
 const voted={},buttons=[{disabled:true},{disabled:true},{disabled:true}];
 const c=app({me:{name:'Alice',code:'TEST'},myVotedSlides:voted,myDoubleDownUsed:false,votePending:false,connected:true,_latestRoom:room,
  roomRef:()=>null,window:{_ref:()=>null,_get:async()=>({exists:()=>true,val:()=>room}),_update:async()=>{voted[1]='supersmash';throw new Error('permission denied')}},
  document:{getElementById:()=>({className:''}),querySelectorAll:()=>buttons},showToast(){},spawnReaction(){},updateDoubleDownUI(){},markVotedUI(){}});
 await c.castDoubleDown();assert.equal(voted[1],undefined);assert.equal(c.myDoubleDownUsed,false);assert.equal(c.votePending,false);assert(buttons.every(b=>!b.disabled));
});
