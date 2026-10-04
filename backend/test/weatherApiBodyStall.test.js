const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Phase 11.2 W5 - CHARACTERIZATION ONLY (no remediation).
//
// weatherApiService.fetchWithRetry arms an 8 s AbortController timer, but clears it as soon as the
// response HEADERS arrive (`clearTimeout(timeout)` right after `await fetchFn(...)`), then awaits
// `response.json()` with no timer at all. These tests record what that does today. They assert the
// CURRENT behaviour, so when W5 is fixed the "CURRENT BEHAVIOUR" assertions are expected to flip.
//
// Time is virtual (node:test mock timers on setTimeout only), so nothing here waits 8 s, and a
// promise that never settles is observed through a bounded virtual-time loop instead of being awaited
// (a true hang can never hang the runner). The single real-socket test uses real timers and a bounded
// wall-clock wait against a localhost-only server; no external network and no env/credentials are used.
//
// W5_SERVICE_PATH lets the same assertions run against a scratch-copy mutation of the service
// (sensitivity check); it defaults to the real module.

const servicePath = process.env.W5_SERVICE_PATH || '../src/services/weatherApiService';
const weatherApiService = require(servicePath);
const { runWeatherApiIngestion } = require('../src/controllers/weatherController');
const { registerSource, getSource } = require('../src/services/dataSourceRegistry');

const { fetchWithRetry, getCurrentWeather } = weatherApiService;
const GUWAHATI = { lat: 26.1445, lng: 91.7362 };
const FIXTURE = {
  location: { name: 'Guwahati', region: 'Assam', country: 'India', lat: 26.14, lon: 91.73 },
  current: { last_updated_epoch: 1758528600, temp_c: 28.4, condition: { text: 'Moderate rain', code: 1189 }, wind_kph: 12, wind_degree: 180, precip_mm: 42.6, humidity: 88 },
};

const abortError = () => Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
const flush = async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setImmediate(r)); };

function withKey(fn) {
  const had = Object.prototype.hasOwnProperty.call(process.env, 'WEATHERAPI_API_KEY');
  const old = process.env.WEATHERAPI_API_KEY;
  process.env.WEATHERAPI_API_KEY = 'test-key-not-real';
  return fn().finally(() => { if (had) process.env.WEATHERAPI_API_KEY = old; else delete process.env.WEATHERAPI_API_KEY; });
}

// Drives virtual time in small steps (so timers armed by retries are seen) until the promise settles
// or maxVirtualMs elapses. Returns what a caller would have observed.
async function observe(t, promise, maxVirtualMs, stepMs = 100) {
  let state = { settled: false };
  promise.then((value) => { state = { settled: true, value }; }, (error) => { state = { settled: true, error }; });
  let elapsed = 0;
  await flush();
  while (!state.settled && elapsed < maxVirtualMs) {
    t.mock.timers.tick(stepMs);
    elapsed += stepMs;
    await flush();
  }
  return { ...state, atVirtualMs: state.settled ? elapsed : null, observedVirtualMs: elapsed };
}

// fetchFn factory. `behaviour(callIndex, signal)` returns the fake Response (or throws).
function makeFetch(behaviour) {
  const rec = { calls: 0, signals: [] };
  const fetchFn = async (_url, opts) => {
    const i = rec.calls;
    rec.calls += 1;
    rec.signals.push(opts.signal);
    return behaviour(i, opts.signal);
  };
  return { fetchFn, rec };
}

const okBody = () => ({ ok: true, status: 200, json: async () => FIXTURE });
// Body whose json() never resolves. honorSignal=true models real undici, which rejects a body read when
// the request's AbortSignal fires; false models a body that ignores the signal entirely.
const stalledBody = (signal, honorSignal) => ({
  ok: true,
  status: 200,
  json: () => new Promise((_res, rej) => { if (honorSignal) signal.addEventListener('abort', () => rej(abortError())); }),
});

test('W5-A1 CURRENT BEHAVIOUR: headers arrive, json() never resolves (ignores signal) -> HANGS, no timeout, 1 attempt', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { fetchFn, rec } = makeFetch((_i, signal) => stalledBody(signal, false));
  const r = await observe(t, fetchWithRetry('http://x', { fetchFn }), 60_000);
  assert.equal(r.settled, false, 'still pending after 60 s of virtual time (7.5x the 8 s timeout)');
  assert.equal(rec.calls, 1, 'no retry: the stall never produces an error to retry on');
  assert.equal(rec.signals[0].aborted, false, 'the timeout never fired: the timer was cleared at headers');
});

test('W5-A2 CURRENT BEHAVIOUR: even a body that WOULD honor the abort signal hangs, because the signal is never aborted', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { fetchFn, rec } = makeFetch((_i, signal) => stalledBody(signal, true));
  const r = await observe(t, fetchWithRetry('http://x', { fetchFn }), 60_000);
  assert.equal(r.settled, false);
  assert.equal(rec.calls, 1);
  assert.equal(rec.signals[0].aborted, false);
});

test('W5-A3 CONTROL: a stall BEFORE headers is protected - aborts at 8 s, retries once, returns "timeout" at 16 s (2 attempts)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { fetchFn, rec } = makeFetch((_i, signal) => new Promise((_res, rej) => signal.addEventListener('abort', () => rej(abortError()))));
  const r = await observe(t, fetchWithRetry('http://x', { fetchFn }), 60_000);
  assert.equal(r.settled, true);
  assert.deepEqual(r.value, { ok: false, status: 0, body: null, error: 'timeout' });
  assert.equal(rec.calls, 2);
  assert.equal(r.atVirtualMs, 16_000, 'two full 8 s windows');
});

test('W5-B1 CURRENT BEHAVIOUR: headers OK, json() rejects on both attempts -> 2 attempts, resolves { ok:false, status:0, error:<message> } (never throws)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { fetchFn, rec } = makeFetch(() => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected end of JSON input'); } }));
  const r = await observe(t, fetchWithRetry('http://x', { fetchFn }), 60_000);
  assert.equal(r.settled, true);
  assert.deepEqual(r.value, { ok: false, status: 0, body: null, error: 'Unexpected end of JSON input' });
  assert.equal(rec.calls, 2, 'a body-read/parse failure IS retried once (catch has no error-type check)');
  assert.equal(r.atVirtualMs, 0, 'immediate - no timer involved');
});

test('W5-B2 CURRENT BEHAVIOUR: json() rejects on the first attempt, succeeds on the retry -> LIVE after 2 attempts', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { fetchFn, rec } = makeFetch((i) => ({ ok: true, status: 200, json: async () => { if (i === 0) throw new Error('terminated'); return FIXTURE; } }));
  const r = await observe(t, withKey(() => getCurrentWeather(GUWAHATI.lat, GUWAHATI.lng, { fetchFn })), 60_000);
  assert.equal(r.value.status, 'LIVE');
  assert.equal(rec.calls, 2);
});

test('W5-B3 CURRENT BEHAVIOUR: a body rejection named AbortError is reported as "timeout" even though no timeout happened', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { fetchFn, rec } = makeFetch(() => ({ ok: true, status: 200, json: async () => { throw abortError(); } }));
  const r = await observe(t, fetchWithRetry('http://x', { fetchFn }), 60_000);
  assert.equal(r.value.error, 'timeout');
  assert.equal(rec.calls, 2);
});

test('W5-C1 CURRENT BEHAVIOUR: body takes 9 s (> 8 s timeout) -> NOT aborted, completes successfully at 9 s; the 8 s timeout does not cover the body', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { fetchFn, rec } = makeFetch((_i, signal) => ({
    ok: true,
    status: 200,
    json: () => new Promise((res, rej) => {
      signal.addEventListener('abort', () => rej(abortError()));
      setTimeout(() => res(FIXTURE), 9_000);
    }),
  }));
  const r = await observe(t, fetchWithRetry('http://x', { fetchFn }), 60_000);
  assert.equal(r.settled, true);
  assert.equal(r.value.ok, true);
  assert.equal(r.atVirtualMs, 9_000);
  assert.equal(rec.calls, 1);
  assert.equal(rec.signals[0].aborted, false);
});

test('W5-C2 CURRENT BEHAVIOUR: headers at 7.9 s then a body that never ends -> total time is unbounded (the 8 s window ends at headers)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { fetchFn, rec } = makeFetch((_i, signal) => new Promise((res) => setTimeout(() => res(stalledBody(signal, true)), 7_900)));
  const r = await observe(t, fetchWithRetry('http://x', { fetchFn }), 120_000);
  assert.equal(r.settled, false, 'still pending at 120 s');
  assert.equal(rec.calls, 1);
});

test('W5-E1 CURRENT BEHAVIOUR (caller): getCurrentWeather on a body stall never returns - not UNAVAILABLE, not stale, not a throw', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { fetchFn } = makeFetch((_i, signal) => stalledBody(signal, true));
  const r = await observe(t, withKey(() => getCurrentWeather(GUWAHATI.lat, GUWAHATI.lng, { fetchFn })), 60_000);
  assert.equal(r.settled, false);
});

test('W5-E2 CURRENT BEHAVIOUR (caller): getCurrentWeather on two body rejections returns { status:UNAVAILABLE, observation:null, error:<message> } (does not throw, no stale data)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { fetchFn } = makeFetch(() => ({ ok: true, status: 200, json: async () => { throw new Error('Unexpected end of JSON input'); } }));
  const r = await observe(t, withKey(() => getCurrentWeather(GUWAHATI.lat, GUWAHATI.lng, { fetchFn })), 60_000);
  assert.deepEqual(r.value, { status: 'UNAVAILABLE', observation: null, error: 'Unexpected end of JSON input' });
});

// ---- W5-F: the polling pass (runWeatherApiIngestion is what the scheduler runs) ----

const LOCS = [{ lat: 26.1445, lng: 91.7362, label: 'loc1' }, { lat: 26.1445, lng: 91.7362, label: 'loc2' }, { lat: 26.1445, lng: 91.7362, label: 'loc3' }];

test('W5-F1 CURRENT BEHAVIOUR: a body-REJECT at one location does not abort the pass - other locations continue (persisted 2/3, 4 provider attempts)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  // call order: loc1 -> 0 ; loc2 -> 1,2 (initial + retry, both reject) ; loc3 -> 3
  const { fetchFn, rec } = makeFetch((i) => ({ ok: true, status: 200, json: async () => { if (i === 1 || i === 2) throw new Error('Unexpected end of JSON input'); return FIXTURE; } }));
  const persisted = [];
  const r = await observe(t, withKey(() => runWeatherApiIngestion(LOCS, { fetchFn, persistFn: async (o) => { persisted.push(o); } })), 60_000);
  assert.equal(r.settled, true);
  assert.equal(r.value.status, 'LIVE');
  assert.equal(r.value.persisted, 2);
  assert.equal(r.value.total, 3);
  assert.deepEqual(r.value.errors, [{ location: 'loc2', reason: 'Unexpected end of JSON input' }]);
  assert.equal(rec.calls, 4);
  assert.equal(persisted.length, 2);
});

test('W5-F2 CURRENT BEHAVIOUR: a body-STALL at location 2 blocks the whole pass - location 3 is never fetched, nothing after it is persisted, registry never updated', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  registerSource('WEATHERAPI_WEATHER', { status: 'LIVE', source: 'prior pass', coverage: '3/3 polled location(s)', confidence: 0.7, error: null });
  const before = JSON.stringify(getSource('WEATHERAPI_WEATHER'));
  const { fetchFn, rec } = makeFetch((i, signal) => (i === 1 ? stalledBody(signal, true) : okBody()));
  const persisted = [];
  const r = await observe(t, withKey(() => runWeatherApiIngestion(LOCS, { fetchFn, persistFn: async (o) => { persisted.push(o); } })), 120_000);
  assert.equal(r.settled, false, 'the pass is still pending after 120 s');
  assert.equal(rec.calls, 2, 'loc1 fetched, loc2 fetched and stalled; loc3 never attempted');
  assert.equal(persisted.length, 1, 'only loc1 persisted');
  assert.equal(JSON.stringify(getSource('WEATHERAPI_WEATHER')), before, 'registry still shows the prior pass as-is (no error, no update)');
  registerSource('WEATHERAPI_WEATHER', { status: 'UNAVAILABLE', source: 'test cleanup', coverage: null, confidence: null, error: 'cleanup' });
});

// ---- Real HTTP over localhost: does a real fetch/undici body stall end by itself at 8 s? ----

test('W5-A4 CURRENT BEHAVIOUR (real fetch + localhost server): headers sent, body stalls -> still pending at 9.5 s real time; only the connection drop ends it, then the retry runs', { timeout: 30_000 }, async () => {
  const sockets = new Set();
  let requests = 0;
  const server = http.createServer((req, res) => {
    requests += 1;
    if (requests === 1) {
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': '5000' });
      res.write('{"loc'); // headers + a partial body, then silence
    } else {
      const body = JSON.stringify(FIXTURE);
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
      res.end(body);
    }
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/current.json`;
  try {
    const started = Date.now();
    let state = { settled: false };
    const p = fetchWithRetry(url, { fetchFn: (u, o) => fetch(u, o) });
    p.then((value) => { state = { settled: true, value }; });
    await new Promise((r) => setTimeout(r, 9_500));
    assert.equal(state.settled, false, 'real undici body read is still pending past the 8 s REQUEST_TIMEOUT_MS');
    assert.equal(requests, 1, 'one provider attempt so far');
    assert.ok(Date.now() - started >= 9_400);
    // Unstick it the only way that works today: drop the TCP connection from the provider side.
    for (const s of sockets) s.destroy();
    await new Promise((r) => setTimeout(r, 1_000));
    assert.equal(state.settled, true, 'after the connection drop the body read rejects and the catch path runs');
    assert.equal(state.value.ok, true, 'the retry (attempt 2) got the valid response');
    assert.equal(requests, 2);
  } finally {
    for (const s of sockets) s.destroy();
    await new Promise((r) => server.close(r));
  }
});
