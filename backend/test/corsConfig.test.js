const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCorsOptions, parseAllowedOrigins } = require('../src/middleware/corsConfig');

test('parseAllowedOrigins splits and trims a comma-separated list', () => {
  assert.deepEqual(parseAllowedOrigins('http://a.com, http://b.com,http://c.com'), [
    'http://a.com',
    'http://b.com',
    'http://c.com',
  ]);
});

test('parseAllowedOrigins returns an empty list for unset/empty input', () => {
  assert.deepEqual(parseAllowedOrigins(undefined), []);
  assert.deepEqual(parseAllowedOrigins(''), []);
});

test('buildCorsOptions allows a configured origin', () => {
  const options = buildCorsOptions('http://localhost:5173');
  let result;
  options.origin('http://localhost:5173', (err, allow) => {
    result = { err, allow };
  });
  assert.equal(result.err, null);
  assert.equal(result.allow, true);
});

test('buildCorsOptions rejects an unconfigured origin with a 403-flagged error', () => {
  const options = buildCorsOptions('http://localhost:5173');
  let result;
  options.origin('http://evil.example', (err, allow) => {
    result = { err, allow };
  });
  assert.ok(result.err instanceof Error);
  assert.equal(result.err.status, 403);
  assert.equal(result.allow, undefined);
});

test('buildCorsOptions allows requests with no Origin header (non-browser callers)', () => {
  const options = buildCorsOptions('http://localhost:5173');
  let result;
  options.origin(undefined, (err, allow) => {
    result = { err, allow };
  });
  assert.equal(result.err, null);
  assert.equal(result.allow, true);
});

test('buildCorsOptions rejects every browser origin when no allowlist is configured (fails closed)', () => {
  const options = buildCorsOptions('');
  let result;
  options.origin('http://localhost:5173', (err, allow) => {
    result = { err, allow };
  });
  assert.ok(result.err instanceof Error);
  assert.equal(result.err.status, 403);
});
