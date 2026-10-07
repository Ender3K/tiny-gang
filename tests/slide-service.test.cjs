const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const response = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  async json() { return data; }
});

function request(implementation, retry = false) {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const source = html.slice(html.indexOf('async function fetchAppsScript('), html.indexOf('async function fetchSlidePageIdsViaAppsScript('));
  const calls = [];
  const timers = new Map();
  let timerId = 0;
  const context = vm.createContext({
    AbortController,
    async fetch(url, options) {
      const call = {url, options};
      calls.push(call);
      return implementation(call, calls.length);
    },
    setTimeout(callback, ms) { timers.set(++timerId, {callback, ms}); return timerId; },
    clearTimeout(id) { timers.delete(id); }
  });
  vm.runInContext(source, context);
  const url = 'https://example.com/exec?action=meta&presentationId=test';
  const promise = retry ? context.requestAppsScript(url) : context.fetchAppsScript(url);
  return {calls, timers, promise};
}

function expire(r) {
  const [id, timer] = [...r.timers][0];
  r.timers.delete(id);
  timer.callback();
}

function abortRejection(signal) {
  return new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => {
      const error = new Error('Aborted');
      error.name = 'AbortError';
      reject(error);
    }, {once: true});
  });
}

test('slide requests omit Google cookies, follow redirects, bypass cached redirects and return JSON', async () => {
  const data = {ok: true, totalSlides: 2};
  const r = request(() => response(data));
  assert.equal(await r.promise, data);
  assert.equal(r.calls.length, 1);
  const {url, options} = r.calls[0];
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('action'), 'meta');
  assert.equal(parsed.searchParams.get('presentationId'), 'test');
  assert(parsed.searchParams.has('_request'));
  assert.equal(parsed.searchParams.has('callback'), false);
  assert.equal(options.credentials, 'omit');
  assert.equal(options.redirect, 'follow');
  assert.equal(options.cache, 'no-store');
  assert.equal(options.headers, undefined);
  assert.equal(options.signal.aborted, false);
  assert.equal(r.timers.size, 0);
});

test('a temporary network failure retries with a fresh URL', async () => {
  const r = request((call, attempt) => {
    if(attempt === 1) throw new TypeError('Failed to fetch');
    return response({ok: true});
  }, true);
  assert.equal((await r.promise).ok, true);
  assert.equal(r.calls.length, 2);
  assert.notEqual(r.calls[0].url, r.calls[1].url);
  assert.equal(r.timers.size, 0);
});

test('a transient HTTP 404 retries while permanent access errors retain the HTTP status', async () => {
  const r = request((call, attempt) => response({ok: true}, attempt === 1 ? 404 : 200), true);
  assert.equal((await r.promise).ok, true);
  assert.equal(r.calls.length, 2);
  const forbidden = request(() => response(null, 403), true);
  await assert.rejects(forbidden.promise, /HTTP 403/);
  assert.equal(forbidden.calls.length, 1);
  assert.equal(forbidden.timers.size, 0);
});

test('persistent network failures stop after two attempts and explain what to check', async () => {
  const r = request(() => { throw new TypeError('Failed to fetch'); }, true);
  await assert.rejects(r.promise, /deployment URL and set access to Anyone/);
  assert.equal(r.calls.length, 2);
  assert.equal(r.timers.size, 0);
});

test('HTML and unexpected JSON responses produce an immediate useful error', async () => {
  const html = request(() => ({ok: true, status: 200, async json() { throw new SyntaxError('Unexpected token <'); }}), true);
  await assert.rejects(html.promise, /unexpected response/);
  assert.equal(html.calls.length, 2);
  assert.equal(html.timers.size, 0);
  const unexpected = request(() => response({message: 'Not slide data'}));
  await assert.rejects(unexpected.promise, /unexpected response/);
  assert.equal(unexpected.timers.size, 0);
});

test('a timeout aborts the actual request without retrying', async () => {
  const r = request(({options}) => abortRejection(options.signal), true);
  const rejected = assert.rejects(r.promise, /timed out/);
  assert.equal([...r.timers.values()][0].ms, 75000);
  expire(r);
  await rejected;
  assert.equal(r.calls[0].options.signal.aborted, true);
  assert.equal(r.calls.length, 1);
  assert.equal(r.timers.size, 0);
});

test('the timeout also applies while downloading the JSON body', async () => {
  let bodyStarted;
  const started = new Promise(resolve => { bodyStarted = resolve; });
  const r = request(({options}) => ({ok: true, status: 200, json() {
    const body = abortRejection(options.signal);
    bodyStarted();
    return body;
  }}), true);
  const rejected = assert.rejects(r.promise, /timed out/);
  await started;
  expire(r);
  await rejected;
  assert.equal(r.calls.length, 1);
  assert.equal(r.timers.size, 0);
});

test('script errors are returned without retrying or hiding the original error', async () => {
  const data = {ok: false, error: 'No access to presentation'};
  const r = request(() => response(data), true);
  assert.equal(await r.promise, data);
  assert.equal(r.calls.length, 1);
  assert.equal(r.timers.size, 0);
});
