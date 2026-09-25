const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeIncident, analyzeWithFallback, analyzeWithRealAI, validateParsedAiResponse } = require('../src/services/aiService');

function fakeAnthropicResponse({ status = 200, body } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function validAnthropicBody({ classification = 'LANDSLIDE', severity = 'HIGH', confidence = 0.9, summary = 'A landslide was reported.', rationale = 'Description mentions a landslide.' } = {}) {
  return {
    content: [{ type: 'text', text: JSON.stringify({ classification, severity, confidence, summary, rationale }) }],
  };
}

// --- 1. Deterministic fallback classification ---

test('fallback classifies HIGH severity from a high-severity keyword and includes a rationale citing it', () => {
  const result = analyzeWithFallback({ type: 'LANDSLIDE', description: 'Severe landslide, road collapsed' });
  assert.equal(result.classification, 'LANDSLIDE');
  assert.equal(result.severity, 'HIGH');
  assert.ok(result.confidence > 0.9);
  assert.match(result.rationale, /severe|collapsed/);
  assert.equal(result.source, 'DEMO_FALLBACK');
});

test('fallback classifies MEDIUM severity from a moderate keyword', () => {
  const result = analyzeWithFallback({ type: 'ROAD_DAMAGE', description: 'Large pothole causing slow traffic' });
  assert.equal(result.severity, 'MEDIUM');
  assert.equal(result.confidence, 0.82);
});

test('fallback classifies LOW severity when no keyword matches but a description exists', () => {
  const result = analyzeWithFallback({ type: 'OTHER', description: 'Something unusual on the road' });
  assert.equal(result.severity, 'LOW');
  assert.equal(result.classification, 'UNCLASSIFIED_HAZARD');
});

test('an unrecognized incident type falls back to UNCLASSIFIED_HAZARD, never invented', () => {
  const result = analyzeWithFallback({ type: 'SOMETHING_NEW', description: '' });
  assert.equal(result.classification, 'UNCLASSIFIED_HAZARD');
});

// --- 7. Empty incident description ---

test('an empty description infers severity from incident type alone with reduced confidence', () => {
  const flood = analyzeWithFallback({ type: 'FLOOD', description: '' });
  assert.equal(flood.severity, 'HIGH');
  assert.equal(flood.confidence, 0.6);
  assert.match(flood.rationale, /no description/i);

  const other = analyzeWithFallback({ type: 'ACCIDENT', description: '' });
  assert.equal(other.severity, 'MEDIUM');
});

// --- provenance/mode labeling + new Phase 5 fields ---

test('fallback output is always explicitly labeled DEMO_FALLBACK, never AI, and carries model/generatedAt/rationale', () => {
  const result = analyzeWithFallback({ type: 'FLOOD', description: 'minor flood' });
  assert.equal(result.source, 'DEMO_FALLBACK');
  assert.equal(result.model, 'heuristic-keyword-v1');
  assert.ok(result.generatedAt instanceof Date);
  assert.ok(typeof result.rationale === 'string' && result.rationale.length > 0);
});

// --- 2. AI provider success ---

test('analyzeIncident uses the real AI path when configured and the provider returns a valid response', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
  try {
    const fetchFn = async () => fakeAnthropicResponse({ body: validAnthropicBody() });
    const result = await analyzeIncident({ type: 'LANDSLIDE', description: 'road blocked' }, { fetchFn });
    assert.equal(result.source, 'REAL_AI');
    assert.equal(result.classification, 'LANDSLIDE');
    assert.equal(result.severity, 'HIGH');
    assert.equal(result.confidence, 0.9);
    assert.equal(result.model, 'claude-sonnet-4-6');
    assert.ok(result.generatedAt instanceof Date);
    assert.equal(result.rationale, 'Description mentions a landslide.');
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
  }
});

test('analyzeIncident uses the deterministic fallback when no API key is configured at all', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const fetchFn = async () => { throw new Error('should never be called without a key'); };
  const result = await analyzeIncident({ type: 'ROAD_DAMAGE', description: 'pothole' }, { fetchFn });
  assert.equal(result.source, 'DEMO_FALLBACK');
});

// --- 3. AI provider unavailable (network error / 5xx) ---

test('analyzeIncident falls back safely when the real AI provider is unreachable', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
  try {
    const fetchFn = async () => { throw new Error('ECONNREFUSED'); };
    const result = await analyzeIncident({ type: 'FLOOD', description: 'severe flood' }, { fetchFn });
    assert.equal(result.source, 'DEMO_FALLBACK');
    assert.equal(result.severity, 'HIGH'); // fallback still does its job correctly
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
  }
});

test('analyzeIncident falls back safely when the real AI provider returns a 5xx', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
  try {
    const fetchFn = async () => fakeAnthropicResponse({ status: 503, body: {} });
    const result = await analyzeIncident({ type: 'ACCIDENT', description: '' }, { fetchFn });
    assert.equal(result.source, 'DEMO_FALLBACK');
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
  }
});

// --- 4. AI timeout ---

test('analyzeIncident falls back safely when the real AI provider times out', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
  try {
    // Same convention as weatherApiIngestion.test.js/weatherIngestion.test.js:
    // simulate the AbortController firing (what a real 8s timeout produces)
    // directly, rather than waiting out a real timer in the test suite.
    const fetchFn = async () => {
      throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    };
    const result = await analyzeIncident({ type: 'LANDSLIDE', description: 'severe landslide' }, { fetchFn });
    assert.equal(result.source, 'DEMO_FALLBACK');
    assert.equal(result.severity, 'HIGH'); // fallback still does its job correctly
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
  }
});

// --- 5. Malformed AI response ---

test('a non-JSON AI response body is rejected, falling back safely', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
  try {
    const fetchFn = async () => fakeAnthropicResponse({ body: { content: [{ type: 'text', text: 'not json at all' }] } });
    const result = await analyzeIncident({ type: 'FLOOD', description: 'flood' }, { fetchFn });
    assert.equal(result.source, 'DEMO_FALLBACK');
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
  }
});

test('an AI response missing required fields is rejected, falling back safely', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
  try {
    const fetchFn = async () => fakeAnthropicResponse({ body: { content: [{ type: 'text', text: JSON.stringify({ summary: 'only a summary' }) }] } });
    const result = await analyzeIncident({ type: 'FLOOD', description: 'flood' }, { fetchFn });
    assert.equal(result.source, 'DEMO_FALLBACK');
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
  }
});

test('an AI response with an invalid severity value (not LOW/MEDIUM/HIGH) is rejected, never persisted as-is', () => {
  assert.equal(validateParsedAiResponse({ classification: 'FLOOD', severity: 'CRITICAL', confidence: 0.9 }), false);
});

test('an AI response with a missing content block is rejected, falling back safely', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
  try {
    const fetchFn = async () => fakeAnthropicResponse({ body: {} });
    const result = await analyzeWithRealAI({ type: 'FLOOD', description: 'flood' }, { fetchFn });
    assert.equal(result, null);
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
  }
});

// --- 6. Low / out-of-range confidence ---

test('validateParsedAiResponse rejects confidence outside 0-1', () => {
  assert.equal(validateParsedAiResponse({ classification: 'FLOOD', severity: 'LOW', confidence: 1.5 }), false);
  assert.equal(validateParsedAiResponse({ classification: 'FLOOD', severity: 'LOW', confidence: -0.1 }), false);
  assert.equal(validateParsedAiResponse({ classification: 'FLOOD', severity: 'LOW', confidence: NaN }), false);
});

test('a low but valid AI confidence is preserved as-is, not rounded up or discarded', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
  try {
    const fetchFn = async () => fakeAnthropicResponse({ body: validAnthropicBody({ severity: 'LOW', confidence: 0.12 }) });
    const result = await analyzeIncident({ type: 'OTHER', description: 'unclear report' }, { fetchFn });
    assert.equal(result.source, 'REAL_AI');
    assert.equal(result.confidence, 0.12);
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
  }
});

// --- 8. Summary generation never invents facts ---

test('fallback summary is built only from the supplied description, truncated, never inventing details', () => {
  const longDescription = 'A'.repeat(300);
  const result = analyzeWithFallback({ type: 'ROAD_DAMAGE', description: longDescription });
  assert.ok(result.summary.length < longDescription.length + 50);
  assert.ok(!/casualt|death|injur|authorit/i.test(result.summary) || longDescription.toLowerCase().includes('death'));
});
