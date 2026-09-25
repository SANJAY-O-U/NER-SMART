const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { getMongoDatabaseName, validateProductionDatabase } = require('../src/config/productionEnv');
const { describeConnection } = require('../src/config/db');

// Phase 8B.1: with APP_MODE=production, MONGO_URI must name a database
// explicitly and it must not be `test` (the driver's silent default).

const SECRET_USER = 'dbuserXYZ';
const SECRET_PW = 'S3cretPassw0rd';
const uri = (dbPart) => `mongodb+srv://${SECRET_USER}:${SECRET_PW}@cluster0.abcde.mongodb.net${dbPart}`;

test('getMongoDatabaseName reads only the database path segment', () => {
  assert.strictEqual(getMongoDatabaseName(uri('/?appName=Cluster0')), '');
  assert.strictEqual(getMongoDatabaseName(uri('')), '');
  assert.strictEqual(getMongoDatabaseName(uri('/ner-smart-prod?appName=Cluster0')), 'ner-smart-prod');
  assert.strictEqual(getMongoDatabaseName(uri('/test')), 'test');
  assert.strictEqual(getMongoDatabaseName('mongodb://u:p%40ss@h1:27017,h2:27017/db1?replicaSet=rs0'), 'db1');
  assert.strictEqual(getMongoDatabaseName('mongodb://localhost:27017/ner_dev'), 'ner_dev');
  assert.strictEqual(getMongoDatabaseName('https://example.com/db'), null);
  assert.strictEqual(getMongoDatabaseName(undefined), null);
});

test('production rejects a URI with no database name', () => {
  const errors = validateProductionDatabase({ APP_MODE: 'production', MONGO_URI: uri('/?appName=Cluster0') });
  assert.strictEqual(errors.length, 1);
  assert.match(errors[0], /must name its database explicitly/);
});

test('production rejects the "test" database (any case)', () => {
  for (const name of ['test', 'TEST']) {
    const errors = validateProductionDatabase({ APP_MODE: 'production', MONGO_URI: uri(`/${name}?appName=Cluster0`) });
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0], /must not use the "test" database/);
  }
});

test('production accepts an explicit non-test database', () => {
  assert.deepStrictEqual(validateProductionDatabase({ APP_MODE: 'production', MONGO_URI: uri('/ner-smart-prod?appName=Cluster0') }), []);
});

test('demo / unset / other modes are never restricted (test DB allowed locally)', () => {
  for (const mode of ['demo', undefined, 'development']) {
    assert.deepStrictEqual(validateProductionDatabase({ APP_MODE: mode, MONGO_URI: uri('/?appName=Cluster0') }), []);
    assert.deepStrictEqual(validateProductionDatabase({ APP_MODE: mode, MONGO_URI: uri('/test') }), []);
  }
});

test('non-mongodb URI is rejected in production', () => {
  assert.match(validateProductionDatabase({ APP_MODE: 'production', MONGO_URI: 'postgres://x/y' })[0], /mongodb:\/\//);
});

test('guard messages never contain credentials or the URI', () => {
  const all = [uri('/?appName=Cluster0'), uri('/test'), 'mongodb+srv://u:p@x.net/?a=1']
    .flatMap((u) => validateProductionDatabase({ APP_MODE: 'production', MONGO_URI: u }))
    .join('\n');
  assert.ok(!all.includes(SECRET_USER));
  assert.ok(!all.includes(SECRET_PW));
  assert.ok(!all.includes('cluster0.abcde'));
});

test('describeConnection logs host and selected database only', () => {
  assert.strictEqual(
    describeConnection({ host: 'ac-abc-shard-00-01.abcde.mongodb.net', name: 'ner-smart-prod' }),
    'MongoDB connected: ac-abc-shard-00-01.abcde.mongodb.net / ner-smart-prod'
  );
  assert.strictEqual(describeConnection({ host: 'h', name: 'test' }), 'MongoDB connected: h / test');
  assert.strictEqual(describeConnection({}), 'MongoDB connected: unknown-host / unknown-database');
});

// Real startup path: server.js must abort before connecting, scheduling or
// listening. MONGO_URI points at a closed local port with fake credentials.
const SERVER = path.join(__dirname, '..', 'src', 'server.js');
function startServer(mongoUri) {
  return spawnSync(process.execPath, [SERVER], {
    env: {
      ...process.env,
      APP_MODE: 'production',
      NODE_ENV: '',
      PORT: '0',
      MONGO_URI: mongoUri,
      SACHET_POLL_INTERVAL_MINUTES: '0',
      WEATHER_POLL_INTERVAL_MINUTES: '0',
    },
    encoding: 'utf8',
    timeout: 20000,
  });
}

for (const [label, u] of [['no database', `mongodb://${SECRET_USER}:${SECRET_PW}@127.0.0.1:1/?appName=x`], ['test database', `mongodb://${SECRET_USER}:${SECRET_PW}@127.0.0.1:1/test`]]) {
  test(`server startup aborts in production with ${label}, before connecting or listening`, () => {
    const r = startServer(u);
    const out = r.stdout + r.stderr;
    assert.strictEqual(r.status, 1);
    assert.match(out, /Production startup aborted/);
    assert.doesNotMatch(out, /MongoDB connected|MongoDB connection error|backend running|auto-polling/);
    assert.ok(!out.includes(SECRET_PW) && !out.includes(SECRET_USER), 'no credentials in output');
  });
}
