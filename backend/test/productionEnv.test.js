const test = require('node:test');
const assert = require('node:assert');
const { validateProductionEnv } = require('../src/config/productionEnv');

const VALID = {
  NODE_ENV: 'production',
  APP_MODE: 'production',
  PORT: '8080',
  MONGO_URI: 'mongodb+srv://example',
  NER_API_KEY: 'k',
  NER_ALLOWED_ORIGINS: 'https://dashboard.example.org',
  WEATHER_PROVIDER: 'weatherapi',
  WEATHERAPI_API_KEY: 'w',
};

test('a complete production env has no errors', () => {
  assert.deepStrictEqual(validateProductionEnv(VALID).errors, []);
});

for (const name of ['MONGO_URI', 'NER_API_KEY', 'NER_ALLOWED_ORIGINS', 'WEATHER_PROVIDER']) {
  test(`missing ${name} is an error`, () => {
    const { errors } = validateProductionEnv({ ...VALID, [name]: '' });
    assert.ok(errors.some((e) => e.startsWith(name)), errors.join('; '));
  });
}

test('WEATHERAPI_API_KEY required when weatherapi is active', () => {
  const { errors } = validateProductionEnv({ ...VALID, WEATHERAPI_API_KEY: '  ' });
  assert.ok(errors.some((e) => e.includes('WEATHERAPI_API_KEY')));
});

test('WEATHERAPI_API_KEY not required when imd is active (IMD_API_KEY is)', () => {
  const { errors } = validateProductionEnv({ ...VALID, WEATHER_PROVIDER: 'imd', WEATHERAPI_API_KEY: '' });
  assert.ok(!errors.some((e) => e.includes('WEATHERAPI_API_KEY')));
  assert.ok(errors.some((e) => e.includes('IMD_API_KEY')));
});

test('unknown weather provider is an error', () => {
  assert.ok(validateProductionEnv({ ...VALID, WEATHER_PROVIDER: 'foo' }).errors.length > 0);
});

test('wildcard CORS origin is rejected in production', () => {
  assert.ok(validateProductionEnv({ ...VALID, NER_ALLOWED_ORIGINS: '*' }).errors.some((e) => e.includes('wildcard')));
});

test('non-numeric PORT is an error', () => {
  assert.ok(validateProductionEnv({ ...VALID, PORT: 'abc' }).errors.some((e) => e.startsWith('PORT')));
});

test('SACHET and ANTHROPIC_API_KEY are never required', () => {
  const { errors, warnings } = validateProductionEnv({ ...VALID, ANTHROPIC_API_KEY: '' });
  assert.deepStrictEqual(errors, []);
  assert.ok(warnings.some((w) => w.includes('DEMO_FALLBACK')));
});

test('APP_MODE=demo in production produces a warning, not an error', () => {
  const { errors, warnings } = validateProductionEnv({ ...VALID, APP_MODE: 'demo' });
  assert.deepStrictEqual(errors, []);
  assert.ok(warnings.some((w) => w.includes('APP_MODE=demo')));
});

test('messages never contain configured secret values', () => {
  const secretEnv = { ...VALID, NER_API_KEY: 'SUPERSECRET123', MONGO_URI: 'mongodb+srv://user:PASSWORD@h', WEATHERAPI_API_KEY: '', NER_ALLOWED_ORIGINS: '*' };
  const { errors, warnings } = validateProductionEnv(secretEnv);
  const all = [...errors, ...warnings].join('\n');
  assert.ok(!all.includes('SUPERSECRET123'));
  assert.ok(!all.includes('PASSWORD'));
});
