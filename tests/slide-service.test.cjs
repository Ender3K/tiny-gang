const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function request(retry = false) {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const source = html.slice(html.indexOf('function jsonp('), html.indexOf('async function fetchSlidePageIdsViaAppsScript('));
  const timers = new Map();
  let timerId = 0;
  let script;
  const head = {
    appendChild(element) { script = element; element.parentNode = head; },
    removeChild(element) { element.parentNode = null; }
  };
  const context = vm.createContext({
    window: {},
    document: {head, createElement() { return {}; }},
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); }
  });
  vm.runInContext(source, context);
  const url = 'https://example.com/exec?action=meta';
  const promise = retry ? context.requestAppsScript(url) : context.jsonp(url, 75000);
  return {context, timers, promise,
    get script() { return script; },
    get callback() { return new URL(script.src).searchParams.get('callback'); }
  };
}

test('valid JSONP resolves and cleans up its callback, script and timeout', async () => {
  const r = request();
  const data = {ok: true, totalSlides: 2};
  r.context.window[r.callback](data);
  assert.equal(await r.promise, data);
  assert.equal(r.timers.size, 0);
  assert.equal(r.script.parentNode, null);
  assert.equal(r.context.window[r.callback], undefined);
  r.script.onload();
});

test('a failed script load explains which deployment settings to check', async () => {
  const r = request();
  const rejected = assert.rejects(r.promise, /deployment URL and set access to Anyone/);
  r.script.onerror();
  await rejected;
  assert.equal(r.timers.size, 0);
  assert.equal(r.script.parentNode, null);
  assert.equal(r.context.window[r.callback], undefined);
});

test('a loaded response without JSONP rejects immediately instead of waiting for timeout', async () => {
  const r = request();
  const rejected = assert.rejects(r.promise, /unexpected response/);
  r.script.onload();
  await rejected;
  assert.equal(r.timers.size, 0);
  assert.equal(r.script.parentNode, null);
});

test('a timed-out request tolerates a late callback and then removes it', async () => {
  const r = request();
  const rejected = assert.rejects(r.promise, /timed out/);
  const [id, timeout] = [...r.timers][0];
  r.timers.delete(id);
  timeout();
  await rejected;
  assert.doesNotThrow(() => r.context.window[r.callback]({ok: true}));
  r.script.onload();
  assert.equal(r.context.window[r.callback], undefined);
  assert.equal(r.script.parentNode, null);
});

test('a temporary load failure retries once with a new callback and resolves', async () => {
  const r = request(true);
  const firstScript = r.script;
  const firstCallback = r.callback;
  firstScript.onerror();
  await Promise.resolve();
  assert.notEqual(r.script, firstScript);
  assert.notEqual(r.callback, firstCallback);
  assert.equal(r.context.window[firstCallback], undefined);
  r.context.window[r.callback]({ok: true});
  assert.equal((await r.promise).ok, true);
  assert.equal(r.timers.size, 0);
});

test('a persistent load failure stops after the second attempt', async () => {
  const r = request(true);
  const rejected = assert.rejects(r.promise, /Could not reach the slide service/);
  r.script.onerror();
  await Promise.resolve();
  const secondScript = r.script;
  secondScript.onerror();
  await rejected;
  assert.equal(r.script, secondScript);
  assert.equal(r.timers.size, 0);
});

test('timeouts are not retried and service error responses remain available to callers', async () => {
  const timedOut = request(true);
  const firstScript = timedOut.script;
  const rejected = assert.rejects(timedOut.promise, /timed out/);
  const [id, timeout] = [...timedOut.timers][0];
  timedOut.timers.delete(id);
  timeout();
  await rejected;
  assert.equal(timedOut.script, firstScript);

  const scriptError = request(true);
  const response = {ok: false, error: 'No access to presentation'};
  scriptError.context.window[scriptError.callback](response);
  assert.equal(await scriptError.promise, response);
  assert.equal(scriptError.timers.size, 0);
});
