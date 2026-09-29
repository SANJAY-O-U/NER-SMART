const test = require('node:test');
const assert = require('node:assert/strict');
const {
  analyzeIncident,
  analyzeWithGemini,
  resolveAiProvider,
  DEFAULT_GEMINI_MODEL,
  GEMINI_REQUEST_TIMEOUT_MS,
} = require('../src/services/aiService');
const { buildIncidentEvidence } = require('../src/services/accessibilityEvidence');
const { computeAccessibilityFromEvidence } = require('../src/services/accessibilityEngine');

// Phase 10.2: Gemini provider + AI_PROVIDER selection. Network-free — every
// provider call goes through an injected fetchFn. Fake keys only.

const AI_VARS = ['AI_PROVIDER', 'GEMINI_API_KEY', 'GEMINI_MODEL', 'ANTHROPIC_API_KEY'];
const FAKE_GEMINI_KEY = 'gemini-test-key-not-real-123';
const FAKE_ANTHROPIC_KEY = 'anthropic-test-key-not-real-456';

/** Runs fn with exactly the given AI env vars set (others removed), then restores. */
async function withEnv(vars, fn) {
  const saved = Object.fromEntries(AI_VARS.map((k) => [k, process.env[k]]));
  for (const k of AI_VARS) delete process.env[k];
  Object.assign(process.env, vars);
  try {
    return await fn();
  } finally {
    for (const k of AI_VARS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

function fakeResponse({ status = 200, body = {} } = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const VALID_FIELDS = {
  classification: 'LANDSLIDE',
  severity: 'HIGH',
  confidence: 0.87,
  summary: 'Rocks and soil on the carriageway.',
  rationale: 'Description reports debris obstructing a lane.',
};

function geminiBody({ fields = VALID_FIELDS, text, finishReason = 'STOP' } = {}) {
  return {
    candidates: [{ content: { role: 'model', parts: [{ text: text ?? JSON.stringify(fields) }] }, finishReason }],
  };
}

/** A fetchFn that records calls and returns the given response. */
function recordingFetch(response) {
  const calls = [];
  const fn = async (url, options) => {
    calls.push({ url, options });
    if (typeof response === 'function') return response();
    return response;
  };
  return { fn, calls };
}

const INPUT = { type: 'LANDSLIDE', description: 'Large rocks fell onto the carriageway after heavy rain.' };
const GEMINI_ENV = { AI_PROVIDER: 'gemini', GEMINI_API_KEY: FAKE_GEMINI_KEY };

function assertFallback(result) {
  assert.equal(result.source, 'DEMO_FALLBACK');
  assert.equal(result.model, 'heuristic-keyword-v1');
}

// --- A. success ---------------------------------------------------------

test('A. Gemini success returns the normalized REAL_AI result with the configured model', async () => {
  await withEnv({ ...GEMINI_ENV, GEMINI_MODEL: 'gemini-custom-model' }, async () => {
    const { fn } = recordingFetch(fakeResponse({ body: geminiBody() }));
    const r = await analyzeIncident(INPUT, { fetchFn: fn });
    assert.equal(r.source, 'REAL_AI');
    assert.equal(r.model, 'gemini-custom-model');
    assert.equal(r.classification, 'LANDSLIDE');
    assert.equal(r.severity, 'HIGH');
    assert.equal(r.confidence, 0.87);
    assert.equal(r.summary, VALID_FIELDS.summary);
    assert.equal(r.rationale, VALID_FIELDS.rationale);
    assert.ok(r.generatedAt instanceof Date);
    assert.deepEqual(Object.keys(r).sort(), ['classification', 'confidence', 'generatedAt', 'model', 'rationale', 'severity', 'source', 'summary']);
  });
});

test('A2. GEMINI_MODEL unset or blank uses the documented default model', async () => {
  for (const GEMINI_MODEL of [undefined, '   ']) {
    await withEnv({ ...GEMINI_ENV, ...(GEMINI_MODEL === undefined ? {} : { GEMINI_MODEL }) }, async () => {
      const { fn } = recordingFetch(fakeResponse({ body: geminiBody() }));
      const r = await analyzeIncident(INPUT, { fetchFn: fn });
      assert.equal(r.model, DEFAULT_GEMINI_MODEL);
      assert.equal(DEFAULT_GEMINI_MODEL, 'gemini-3.5-flash-lite');
    });
  }
});

// --- B. request correctness --------------------------------------------

test('B. request uses generateContent, x-goog-api-key header, key never in the URL, structured JSON schema', async () => {
  await withEnv(GEMINI_ENV, async () => {
    const { fn, calls } = recordingFetch(fakeResponse({ body: geminiBody() }));
    await analyzeIncident(INPUT, { fetchFn: fn });
    assert.equal(calls.length, 1);
    const { url, options } = calls[0];

    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
    assert.ok(!url.includes(FAKE_GEMINI_KEY), 'key must never be in the URL');
    assert.ok(!/[?&]key=/.test(url));
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['x-goog-api-key'], FAKE_GEMINI_KEY);
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.ok(!('x-api-key' in options.headers) && !('Authorization' in options.headers));
    assert.ok(options.signal, 'request is abortable (timeout)');

    const body = JSON.parse(options.body);
    assert.ok(!options.body.includes(FAKE_GEMINI_KEY), 'key must never be in the body');
    assert.match(body.contents[0].parts[0].text, /incident type "LANDSLIDE"/);
    assert.match(body.contents[0].parts[0].text, /Large rocks fell onto the carriageway/);
    const cfg = body.generationConfig;
    assert.equal(cfg.responseMimeType, 'application/json');
    assert.deepEqual(cfg.responseSchema.properties.severity.enum, ['LOW', 'MEDIUM', 'HIGH']);
    assert.equal(cfg.responseSchema.properties.confidence.type, 'NUMBER');
    assert.equal(cfg.responseSchema.properties.confidence.minimum, 0);
    assert.equal(cfg.responseSchema.properties.confidence.maximum, 1);
    assert.deepEqual([...cfg.responseSchema.required].sort(), ['classification', 'confidence', 'rationale', 'severity', 'summary']);
  });
});

// --- B2-B3. Phase 10.3.2 latency hardening ------------------------------

test('B2. request sets generationConfig.thinkingConfig.thinkingLevel = "minimal", other config unchanged', async () => {
  await withEnv(GEMINI_ENV, async () => {
    const { fn, calls } = recordingFetch(fakeResponse({ body: geminiBody() }));
    await analyzeIncident(INPUT, { fetchFn: fn });
    const cfg = JSON.parse(calls[0].options.body).generationConfig;
    assert.deepEqual(cfg.thinkingConfig, { thinkingLevel: 'minimal' });
    assert.equal(cfg.maxOutputTokens, 1024);
    assert.deepEqual(Object.keys(cfg).sort(), ['maxOutputTokens', 'responseMimeType', 'responseSchema', 'thinkingConfig']);
  });
});

/** A fetchFn that never resolves on its own; it rejects only when its signal aborts. */
function hangingFetch() {
  const state = { called: null, signal: null };
  state.called = new Promise((resolveCalled) => {
    state.fn = (url, options) => {
      state.signal = options.signal;
      resolveCalled();
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    };
  });
  return state;
}

test('B3. Gemini timeout is 10s (below the 15s Flutter POST timeout): pending at 9.999s, aborted at 10s, then falls back', async (t) => {
  assert.equal(GEMINI_REQUEST_TIMEOUT_MS, 10000);
  assert.ok(GEMINI_REQUEST_TIMEOUT_MS < 15000, 'must stay below flutter_app api_service.dart POST timeout');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await withEnv(GEMINI_ENV, async () => {
    const h = hangingFetch();
    const pending = analyzeIncident(INPUT, { fetchFn: h.fn });
    await h.called;
    t.mock.timers.tick(9999);
    assert.equal(h.signal.aborted, false, 'must not abort before 10s');
    t.mock.timers.tick(1);
    assert.equal(h.signal.aborted, true);
    assertFallback(await pending);
  });
});

test('B4. Anthropic keeps the shared 8s timeout (unchanged)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await withEnv({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY }, async () => {
    const h = hangingFetch();
    const pending = analyzeIncident(INPUT, { fetchFn: h.fn });
    await h.called;
    t.mock.timers.tick(7999);
    assert.equal(h.signal.aborted, false);
    t.mock.timers.tick(1);
    assert.equal(h.signal.aborted, true);
    assertFallback(await pending);
  });
});

// --- B5. Phase 10.3.9 sanitized failure logging -------------------------

/** Runs fn with console.warn captured; returns { result, warnings }. */
async function captureWarnings(fn) {
  const warnings = [];
  const orig = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    return { result: await fn(), warnings };
  } finally {
    console.warn = orig;
  }
}

const SECRET_DESCRIPTION = 'UNIQUE-DRIVER-TEXT-7f3a road near km 42';
const RAW_PROVIDER_MARKER = 'RAW-PROVIDER-BODY-9c1e';

const LOG_CASES = [
  ['http 503', () => fakeResponse({ status: 503, body: { error: { code: 503, status: 'UNAVAILABLE', message: RAW_PROVIDER_MARKER } } }), 'http_error', 503],
  ['http 401', () => fakeResponse({ status: 401, body: { error: { message: RAW_PROVIDER_MARKER } } }), 'http_error', 401],
  ['http 429', () => fakeResponse({ status: 429, body: { error: { message: RAW_PROVIDER_MARKER } } }), 'http_error', 429],
  ['timeout', () => { throw Object.assign(new Error(RAW_PROVIDER_MARKER), { name: 'AbortError' }); }, 'timeout', null],
  ['network', () => { throw new Error(`getaddrinfo ENOTFOUND ${RAW_PROVIDER_MARKER}`); }, 'network_error', null],
  ['prompt blocked', () => fakeResponse({ body: { promptFeedback: { blockReason: 'SAFETY' } } }), 'blocked', 200],
  ['finish SAFETY', () => fakeResponse({ body: geminiBody({ finishReason: 'SAFETY' }) }), 'blocked', 200],
  ['finish MAX_TOKENS', () => fakeResponse({ body: geminiBody({ finishReason: 'MAX_TOKENS' }) }), 'invalid_response', 200],
  ['no candidates', () => fakeResponse({ body: { candidates: [] } }), 'invalid_response', 200],
  ['empty text', () => fakeResponse({ body: geminiBody({ text: '  ' }) }), 'invalid_response', 200],
  ['malformed JSON', () => fakeResponse({ body: geminiBody({ text: `{${RAW_PROVIDER_MARKER}` }) }), 'parse_error', 200],
  ['invalid fields', () => fakeResponse({ body: geminiBody({ fields: { ...VALID_FIELDS, severity: RAW_PROVIDER_MARKER } }) }), 'invalid_response', 200],
  ['non-JSON body', () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError(RAW_PROVIDER_MARKER); } }), 'invalid_response', 200],
];

for (const [label, respond, category, status] of LOG_CASES) {
  test(`B5. ${label}: exactly one sanitized warning (failure=${category}${status ? `, status=${status}` : ''}), fallback unchanged`, async () => {
    await withEnv({ ...GEMINI_ENV, GEMINI_MODEL: 'gemini-3.6-flash' }, async () => {
      let calls = 0;
      const fn = async () => { calls += 1; return respond(); };
      const { result, warnings } = await captureWarnings(() =>
        analyzeIncident({ type: 'LANDSLIDE', description: SECRET_DESCRIPTION }, { fetchFn: fn })
      );

      assertFallback(result);
      assert.equal(calls, 1); // still no retry
      assert.equal(warnings.length, 1);
      const expected = `[AI] provider=gemini model=gemini-3.6-flash failure=${category}${status ? ` status=${status}` : ''} — using DEMO_FALLBACK`;
      assert.equal(warnings[0], expected);
      for (const forbidden of [FAKE_GEMINI_KEY, SECRET_DESCRIPTION, RAW_PROVIDER_MARKER, 'x-goog-api-key', 'generationConfig', 'road-incident triage']) {
        assert.ok(!warnings[0].includes(forbidden), `log must not contain ${forbidden}`);
      }
    });
  });
}

test('B5. a successful Gemini call and a missing key both log nothing', async () => {
  await withEnv(GEMINI_ENV, async () => {
    const { fn } = recordingFetch(fakeResponse({ body: geminiBody() }));
    const { result, warnings } = await captureWarnings(() => analyzeIncident(INPUT, { fetchFn: fn }));
    assert.equal(result.source, 'REAL_AI');
    assert.equal(warnings.length, 0);
  });
  await withEnv({ AI_PROVIDER: 'gemini' }, async () => {
    const { warnings } = await captureWarnings(() => analyzeIncident(INPUT, { fetchFn: neverCalled().fn }));
    assert.equal(warnings.length, 0);
  });
});

test('B5. an unsafe GEMINI_MODEL value is sanitized in the log', async () => {
  await withEnv({ ...GEMINI_ENV, GEMINI_MODEL: 'bad model\n[AI] forged line' }, async () => {
    const { fn } = recordingFetch(fakeResponse({ status: 500 }));
    const { warnings } = await captureWarnings(() => analyzeIncident(INPUT, { fetchFn: fn }));
    assert.equal(warnings.length, 1);
    assert.ok(!warnings[0].includes('\n'));
    assert.match(warnings[0], /^\[AI\] provider=gemini model=[\w.-]+ failure=http_error status=500 — using DEMO_FALLBACK$/);
  });
});

// --- C-F. HTTP failures -------------------------------------------------

for (const [label, status] of [['C. 401', 401], ['D. 403', 403], ['E. 429', 429], ['F. 500', 500], ['F2. 503', 503]]) {
  test(`${label} from Gemini falls back to DEMO_FALLBACK`, async () => {
    await withEnv(GEMINI_ENV, async () => {
      const { fn, calls } = recordingFetch(fakeResponse({ status, body: { error: { code: status } } }));
      assertFallback(await analyzeIncident(INPUT, { fetchFn: fn }));
      assert.equal(calls.length, 1); // one attempt, no inline retry
    });
  });
}

// --- G-H. timeout / network --------------------------------------------

test('G. timeout (AbortError) falls back', async () => {
  await withEnv(GEMINI_ENV, async () => {
    const fn = async () => { throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }); };
    assertFallback(await analyzeIncident(INPUT, { fetchFn: fn }));
  });
});

test('H. network error falls back', async () => {
  await withEnv(GEMINI_ENV, async () => {
    const fn = async () => { throw new Error('getaddrinfo ENOTFOUND generativelanguage.googleapis.com'); };
    assertFallback(await analyzeIncident(INPUT, { fetchFn: fn }));
  });
});

// --- I-J. empty / blocked / non-STOP responses --------------------------

test('I. empty or structurally incomplete responses fall back', async () => {
  const bodies = [
    {},
    { candidates: [] },
    { candidates: [{ finishReason: 'STOP' }] },
    { candidates: [{ content: {}, finishReason: 'STOP' }] },
    { candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] },
    { candidates: [{ content: { parts: [{ text: '   ' }] }, finishReason: 'STOP' }] },
    { promptFeedback: { blockReason: 'SAFETY' } },
  ];
  await withEnv(GEMINI_ENV, async () => {
    for (const body of bodies) {
      const { fn } = recordingFetch(fakeResponse({ body }));
      assertFallback(await analyzeIncident(INPUT, { fetchFn: fn }));
    }
  });
});

test('J. safety-blocked or truncated (non-STOP) responses fall back even if text parses', async () => {
  await withEnv(GEMINI_ENV, async () => {
    for (const finishReason of ['SAFETY', 'MAX_TOKENS', 'RECITATION', 'OTHER']) {
      const { fn } = recordingFetch(fakeResponse({ body: geminiBody({ finishReason }) }));
      assertFallback(await analyzeIncident(INPUT, { fetchFn: fn }));
    }
    // finishReason absent entirely (built explicitly — a default parameter would substitute 'STOP')
    const noReason = { candidates: [{ content: { parts: [{ text: JSON.stringify(VALID_FIELDS) }] } }] };
    const { fn } = recordingFetch(fakeResponse({ body: noReason }));
    assertFallback(await analyzeIncident(INPUT, { fetchFn: fn }));
  });
});

// --- K-N. content validation (reuses validateParsedAiResponse) ----------

test('K. malformed JSON falls back', async () => {
  await withEnv(GEMINI_ENV, async () => {
    for (const text of ['not json', '{"classification": "LANDSLIDE",', '```json\n{oops}\n```']) {
      const { fn } = recordingFetch(fakeResponse({ body: geminiBody({ text }) }));
      assertFallback(await analyzeIncident(INPUT, { fetchFn: fn }));
    }
  });
});

test('L. missing required fields fall back', async () => {
  await withEnv(GEMINI_ENV, async () => {
    for (const missing of ['classification', 'severity', 'confidence']) {
      const fields = { ...VALID_FIELDS };
      delete fields[missing];
      const { fn } = recordingFetch(fakeResponse({ body: geminiBody({ fields }) }));
      assertFallback(await analyzeIncident(INPUT, { fetchFn: fn }));
    }
  });
});

test('M. invalid severity falls back', async () => {
  await withEnv(GEMINI_ENV, async () => {
    for (const severity of ['CRITICAL', 'high', '', null]) {
      const { fn } = recordingFetch(fakeResponse({ body: geminiBody({ fields: { ...VALID_FIELDS, severity } }) }));
      assertFallback(await analyzeIncident(INPUT, { fetchFn: fn }));
    }
  });
});

test('N. invalid confidence falls back', async () => {
  await withEnv(GEMINI_ENV, async () => {
    // Values the EXISTING shared validator rejects. (It coerces with Number(),
    // so null/true/"0.5" are accepted as 0/1/0.5 — pre-existing behavior of
    // validateParsedAiResponse, shared with the Anthropic path, unchanged here.)
    for (const confidence of [1.5, -0.1, 'abc', undefined]) {
      const { fn } = recordingFetch(fakeResponse({ body: geminiBody({ fields: { ...VALID_FIELDS, confidence } }) }));
      assertFallback(await analyzeIncident(INPUT, { fetchFn: fn }));
    }
  });
});

test('N2. fenced JSON (```json ... ```) is accepted like the Anthropic path', async () => {
  await withEnv(GEMINI_ENV, async () => {
    const text = '```json\n' + JSON.stringify(VALID_FIELDS) + '\n```';
    const { fn } = recordingFetch(fakeResponse({ body: geminiBody({ text }) }));
    assert.equal((await analyzeIncident(INPUT, { fetchFn: fn })).source, 'REAL_AI');
  });
});

// --- O-S. provider selection --------------------------------------------

function neverCalled() {
  const calls = [];
  return { calls, fn: async (url) => { calls.push(url); throw new Error('network must not be called'); } };
}

test('O. AI_PROVIDER=gemini without GEMINI_API_KEY: no network call, fallback', async () => {
  await withEnv({ AI_PROVIDER: 'gemini', ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY }, async () => {
    const { fn, calls } = neverCalled();
    assertFallback(await analyzeIncident(INPUT, { fetchFn: fn }));
    assert.equal(calls.length, 0); // does NOT silently switch to Anthropic either
  });
});

test('P. AI_PROVIDER=fallback: no network call even when keys exist', async () => {
  await withEnv({ AI_PROVIDER: 'fallback', GEMINI_API_KEY: FAKE_GEMINI_KEY, ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY }, async () => {
    const { fn, calls } = neverCalled();
    assertFallback(await analyzeIncident(INPUT, { fetchFn: fn }));
    assert.equal(calls.length, 0);
  });
});

function anthropicBody() {
  return { content: [{ type: 'text', text: JSON.stringify(VALID_FIELDS) }] };
}

test('Q. AI_PROVIDER=anthropic uses the existing Anthropic path (not Gemini)', async () => {
  await withEnv({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY, GEMINI_API_KEY: FAKE_GEMINI_KEY }, async () => {
    const { fn, calls } = recordingFetch(fakeResponse({ body: anthropicBody() }));
    const r = await analyzeIncident(INPUT, { fetchFn: fn });
    assert.equal(r.source, 'REAL_AI');
    assert.equal(r.model, 'claude-sonnet-4-6');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
  });
});

test('Q2. AI_PROVIDER=anthropic without ANTHROPIC_API_KEY: no network call, fallback', async () => {
  await withEnv({ AI_PROVIDER: 'anthropic', GEMINI_API_KEY: FAKE_GEMINI_KEY }, async () => {
    const { fn, calls } = neverCalled();
    assertFallback(await analyzeIncident(INPUT, { fetchFn: fn }));
    assert.equal(calls.length, 0);
  });
});

test('R. AI_PROVIDER unset keeps pre-10.2 behavior (Anthropic if its key is set, never Gemini)', async () => {
  await withEnv({ ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY, GEMINI_API_KEY: FAKE_GEMINI_KEY }, async () => {
    const { fn, calls } = recordingFetch(fakeResponse({ body: anthropicBody() }));
    const r = await analyzeIncident(INPUT, { fetchFn: fn });
    assert.equal(r.model, 'claude-sonnet-4-6');
    assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
  });
  await withEnv({ GEMINI_API_KEY: FAKE_GEMINI_KEY }, async () => {
    const { fn, calls } = neverCalled();
    assertFallback(await analyzeIncident(INPUT, { fetchFn: fn }));
    assert.equal(calls.length, 0); // a Gemini key alone never opts in
  });
});

test('S. unknown AI_PROVIDER: fallback, no network call, safe warning without credentials', async () => {
  await withEnv({ AI_PROVIDER: 'openai', GEMINI_API_KEY: FAKE_GEMINI_KEY, ANTHROPIC_API_KEY: FAKE_ANTHROPIC_KEY }, async () => {
    const { fn, calls } = neverCalled();
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      assertFallback(await analyzeIncident(INPUT, { fetchFn: fn }));
    } finally {
      console.warn = origWarn;
    }
    assert.equal(calls.length, 0);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /unknown AI_PROVIDER "openai"/);
    assert.ok(!warnings[0].includes(FAKE_GEMINI_KEY) && !warnings[0].includes(FAKE_ANTHROPIC_KEY));
  });
});

test('resolveAiProvider: values, case-insensitivity and backward compatibility', () => {
  assert.deepEqual(resolveAiProvider({ AI_PROVIDER: 'Gemini' }), { provider: 'gemini', unknown: false });
  assert.deepEqual(resolveAiProvider({ AI_PROVIDER: ' ANTHROPIC ' }), { provider: 'anthropic', unknown: false });
  assert.deepEqual(resolveAiProvider({ AI_PROVIDER: 'fallback' }), { provider: 'fallback', unknown: false });
  assert.deepEqual(resolveAiProvider({}), { provider: 'fallback', unknown: false });
  assert.deepEqual(resolveAiProvider({ ANTHROPIC_API_KEY: 'x' }), { provider: 'anthropic', unknown: false });
  assert.deepEqual(resolveAiProvider({ AI_PROVIDER: '', ANTHROPIC_API_KEY: 'x' }), { provider: 'anthropic', unknown: false });
  assert.deepEqual(resolveAiProvider({ AI_PROVIDER: 'gpt' }), { provider: 'fallback', unknown: true });
});

test('analyzeWithGemini never calls the network without GEMINI_API_KEY', async () => {
  await withEnv({ AI_PROVIDER: 'gemini' }, async () => {
    const { fn, calls } = neverCalled();
    assert.equal(await analyzeWithGemini(INPUT, { fetchFn: fn }), null);
    assert.equal(calls.length, 0);
  });
});

// --- firewall: a Gemini HIGH recommendation cannot change accessibility --

test('firewall: a real Gemini HIGH result on a LOW incident still yields LOW evidence (-10) and no forced state', async () => {
  await withEnv(GEMINI_ENV, async () => {
    const { fn } = recordingFetch(fakeResponse({ body: geminiBody({ fields: { ...VALID_FIELDS, severity: 'HIGH', confidence: 0.99, classification: 'ROAD BLOCKED - IMPASSABLE' } }) }));
    const aiResult = await analyzeIncident(INPUT, { fetchFn: fn });
    assert.equal(aiResult.source, 'REAL_AI');
    assert.equal(aiResult.severity, 'HIGH');

    const now = new Date();
    const incident = { type: 'LANDSLIDE', severity: 'LOW', status: 'AI_ANALYSED', roadMatchConfidence: 'HIGH', timestamp: now, aiResult };
    const evidence = buildIncidentEvidence([incident], { now, classifyIncidentFreshness: () => 'LIVE' });
    assert.equal(evidence[0].riskContribution, 20); // LOW, not the AI's HIGH (75)

    const acc = computeAccessibilityFromEvidence(evidence, { now });
    assert.equal(acc.state, 'OPEN'); // never RESTRICTED/BLOCKED from AI
    assert.equal(acc.accessibilityScore, 90); // 100 - 20 * 0.5
    assert.equal(incident.severity, 'LOW'); // untouched
  });
});
