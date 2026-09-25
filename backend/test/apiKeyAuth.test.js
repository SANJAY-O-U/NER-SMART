const test = require('node:test');
const assert = require('node:assert/strict');
const { apiKeyAuth, isValidApiKey } = require('../src/middleware/apiKeyAuth');

function withEnv(vars, fn) {
  const original = {};
  for (const key of Object.keys(vars)) original[key] = process.env[key];
  Object.assign(process.env, vars);
  return fn().finally(() => {
    for (const key of Object.keys(vars)) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });
}

function fakeReqRes(providedKey) {
  const req = { get: (header) => (header.toLowerCase() === 'x-api-key' ? providedKey : undefined) };
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  return { req, res };
}

// --- isValidApiKey (pure) ---

test('isValidApiKey rejects when NER_API_KEY is not configured (fails closed)', async () => {
  await withEnv({ NER_API_KEY: '' }, async () => {
    assert.equal(isValidApiKey('anything'), false);
    assert.equal(isValidApiKey(undefined), false);
  });
});

test('isValidApiKey rejects a missing provided key', async () => {
  await withEnv({ NER_API_KEY: 'real-secret' }, async () => {
    assert.equal(isValidApiKey(undefined), false);
    assert.equal(isValidApiKey(''), false);
  });
});

test('isValidApiKey rejects an incorrect provided key', async () => {
  await withEnv({ NER_API_KEY: 'real-secret' }, async () => {
    assert.equal(isValidApiKey('wrong-secret'), false);
  });
});

test('isValidApiKey accepts an exact match', async () => {
  await withEnv({ NER_API_KEY: 'real-secret' }, async () => {
    assert.equal(isValidApiKey('real-secret'), true);
  });
});

// --- apiKeyAuth middleware ---

test('apiKeyAuth returns 401 when the header is missing', async () => {
  await withEnv({ NER_API_KEY: 'real-secret' }, async () => {
    const { req, res } = fakeReqRes(undefined);
    let nextCalled = false;
    apiKeyAuth(req, res, () => {
      nextCalled = true;
    });
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.success, false);
    assert.equal(nextCalled, false);
  });
});

test('apiKeyAuth returns 401 when the header is present but wrong', async () => {
  await withEnv({ NER_API_KEY: 'real-secret' }, async () => {
    const { req, res } = fakeReqRes('not-the-secret');
    let nextCalled = false;
    apiKeyAuth(req, res, () => {
      nextCalled = true;
    });
    assert.equal(res.statusCode, 401);
    assert.equal(nextCalled, false);
  });
});

test('apiKeyAuth calls next() and never touches res when the key is correct', async () => {
  await withEnv({ NER_API_KEY: 'real-secret' }, async () => {
    const { req, res } = fakeReqRes('real-secret');
    let nextCalled = false;
    apiKeyAuth(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, null);
  });
});

test('apiKeyAuth never echoes the configured or provided key in its response body', async () => {
  await withEnv({ NER_API_KEY: 'super-secret-ner-key-12345' }, async () => {
    const { req, res } = fakeReqRes('a-wrong-guess-super-secret-ner-key');
    apiKeyAuth(req, res, () => {});
    const serialized = JSON.stringify(res.body);
    assert.doesNotMatch(serialized, /super-secret-ner-key-12345/);
  });
});
