const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8');
function service(extra = {}) {
  const context = vm.createContext({ContentService:{MimeType:{JSON:'json',JAVASCRIPT:'js'},createTextOutput(body){return {body,setMimeType(mime){this.mime=mime;return this}}}},...extra});
  vm.runInContext(source, context);
  return context;
}
const parsed = notes => JSON.parse(JSON.stringify(service().parseSlideNoteTimings(notes)));

test('single-slide timing does not leak onto later slides',()=>{
  assert.deepEqual(parsed(['intro','#10','']).durations, {'2':10});
});
test('ranges include both boundary slides and return to default afterwards',()=>{
  assert.deepEqual(parsed(['','#10<','','#>','']).durations, {'2':10,'3':10,'4':10});
});
test('a one-slide override inside a range leaves the range intact',()=>{
  assert.deepEqual(parsed(['#10<','#20','','#>','']).durations, {'1':10,'2':20,'3':10,'4':10});
});
test('multiple ranges and inline notes resolve in deck order',()=>{
  assert.deepEqual(parsed(['Explain this slide\n#8<\n','','#>','','#30<','#>']).durations, {'1':8,'2':8,'3':8,'5':30,'6':30});
});
test('ordinary hashtags, decimals and embedded text are not timing markers',()=>{
  assert.deepEqual(parsed(['#topic','id#10','#10abc','#10.5','#10<text']).durations, {});
});
test('invalid durations do not end or overwrite an active range',()=>{
  const result=parsed(['#10<','#0','#3601','#>']);
  assert.deepEqual(result.durations, {'1':10,'2':10,'3':10,'4':10});
  assert.equal(result.warnings.length,2);
});
test('whole-number duration limits are supported',()=>{
  assert.deepEqual(parsed(['#1','#3600']).durations, {'1':1,'2':3600});
});
test('unmatched end and unclosed ranges have deterministic outcomes and warnings',()=>{
  const result=parsed(['#>','#10<','']);
  assert.deepEqual(result.durations, {'2':10,'3':10});
  assert.equal(result.warnings.length,2);
});
test('new ranges replace previous ranges; multiple markers use the first',()=>{
  const result=parsed(['#10<','#20<','#30 #40','#>','']);
  assert.deepEqual(result.durations, {'1':10,'2':20,'3':30,'4':20});
  assert.equal(result.warnings.length,2);
});
test('metadata reads speaker notes and returns timings without exposing notes',()=>{
  const notes=['Private introduction','#10<','Private explanation','#>',''];
  const context=service({SlidesApp:{openById(){return{getSlides(){return notes.map((note,i)=>({getObjectId(){return 's'+(i+1)},getNotesPage(){return{getSpeakerNotesShape(){return {getText(){return{asString(){return note}}}}}}}}))}}}}});
  const response=context.doGet({parameter:{action:'meta',presentationId:'test',callback:'testCallback'}});
  assert.equal(response.mime,'js');
  const data=JSON.parse(response.body.slice('testCallback('.length,-1));
  assert.equal(data.timingVersion,1);
  assert.deepEqual(data.slidePageIds,['s1','s2','s3','s4','s5']);
  assert.deepEqual(data.slideDurations,{'2':10,'3':10,'4':10});
  assert(!response.body.includes('Private'));
});
test('slides without a speaker-notes shape use defaults',()=>{
  const context=service({SlidesApp:{openById(){return{getSlides(){return [{getObjectId(){return 's1'},getNotesPage(){return{getSpeakerNotesShape(){return null}}}}]}}}}});
  const data=JSON.parse(context.doGet({parameter:{presentationId:'test'}}).body);
  assert.deepEqual(data.slideDurations,{});
  assert.equal(data.totalSlides,1);
});
