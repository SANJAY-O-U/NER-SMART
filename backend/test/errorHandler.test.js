const test = require('node:test');
const assert = require('node:assert/strict');
const { errorHandler, notFound } = require('../src/utils/errorHandler');

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

function fakeRes() {
  return {
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
}

const silentConsoleError = () => {}; // keep test output clean; errorHandler always logs server-side

test('errorHandler returns a generic message for a 5xx error in production', async () => {
  await withEnv({ NODE_ENV: 'production' }, async () => {
    const originalError = console.error;
    console.error = silentConsoleError;
    try {
      const err = new Error('MongoServerError: connection to 10.0.0.5:27017 failed, credentials xyz');
      const res = fakeRes();
      errorHandler(err, {}, res, () => {});
      assert.equal(res.statusCode, 500);
      assert.equal(res.body.error, 'Internal server error');
      assert.doesNotMatch(JSON.stringify(res.body), /10\.0\.0\.5|credentials/);
    } finally {
      console.error = originalError;
    }
  });
});

test('errorHandler returns the real message for a 5xx error outside production', async () => {
  await withEnv({ NODE_ENV: '' }, async () => {
    const originalError = console.error;
    console.error = silentConsoleError;
    try {
      const err = new Error('something broke internally');
      const res = fakeRes();
      errorHandler(err, {}, res, () => {});
      assert.equal(res.statusCode, 500);
      assert.equal(res.body.error, 'something broke internally');
    } finally {
      console.error = originalError;
    }
  });
});

test('errorHandler always returns the real message for a 4xx error, in every environment', async () => {
  await withEnv({ NODE_ENV: 'production' }, async () => {
    const originalError = console.error;
    console.error = silentConsoleError;
    try {
      const err = Object.assign(new Error('roadId must be a valid id'), { status: 422 });
      const res = fakeRes();
      errorHandler(err, {}, res, () => {});
      assert.equal(res.statusCode, 422);
      assert.equal(res.body.error, 'roadId must be a valid id');
    } finally {
      console.error = originalError;
    }
  });
});

test('errorHandler falls back to a generic 500 message when the error has none, in production', async () => {
  await withEnv({ NODE_ENV: 'production' }, async () => {
    const originalError = console.error;
    console.error = silentConsoleError;
    try {
      const res = fakeRes();
      errorHandler({}, {}, res, () => {});
      assert.equal(res.statusCode, 500);
      assert.equal(res.body.error, 'Internal server error');
    } finally {
      console.error = originalError;
    }
  });
});

test('notFound returns a 404 with the requested URL', () => {
  const res = fakeRes();
  notFound({ originalUrl: '/api/does-not-exist' }, res);
  assert.equal(res.statusCode, 404);
  assert.match(res.body.error, /\/api\/does-not-exist/);
});
