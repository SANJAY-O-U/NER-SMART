/**
 * Production Environment Validation (Phase 7A — deployment preparation)
 * ------------------------------------------------------------------------
 * When NODE_ENV=production, the server refuses to start unless every
 * mandatory variable is present. Error messages name the missing
 * VARIABLES only — never their values — so nothing secret can end up in
 * platform logs.
 *
 * Outside production nothing changes: local development keeps its
 * existing lenient defaults (connectDB still exits on a missing MONGO_URI,
 * the API key gate still fails closed, etc.).
 *
 * Deliberately NOT required:
 *   - SACHET: public NDMA feed, credential-free by design.
 *   - ANTHROPIC_API_KEY: optional; without it AI stays DEMO_FALLBACK.
 *   - IMD_*: future provider, only needed when WEATHER_PROVIDER=imd.
 */

const SUPPORTED_WEATHER_PROVIDERS = ['weatherapi', 'imd'];

function isBlank(value) {
  return typeof value !== 'string' || value.trim() === '';
}

/**
 * Pure and directly testable.
 * @param {object} [env] - defaults to process.env, injectable for tests.
 * @returns {{ errors: string[], warnings: string[] }}
 */
function validateProductionEnv(env = process.env) {
  const errors = [];
  const warnings = [];

  for (const name of ['MONGO_URI', 'NER_API_KEY', 'NER_ALLOWED_ORIGINS']) {
    if (isBlank(env[name])) errors.push(`${name} is required in production`);
  }

  if (!isBlank(env.NER_ALLOWED_ORIGINS)) {
    const origins = env.NER_ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
    if (origins.includes('*')) {
      errors.push('NER_ALLOWED_ORIGINS must list explicit origins in production (wildcard "*" is not allowed)');
    }
    if (origins.some((o) => o.startsWith('http://'))) {
      warnings.push('NER_ALLOWED_ORIGINS contains a non-HTTPS origin');
    }
  }

  const provider = isBlank(env.WEATHER_PROVIDER) ? '' : env.WEATHER_PROVIDER.trim().toLowerCase();
  if (!provider) {
    errors.push(`WEATHER_PROVIDER is required in production (one of: ${SUPPORTED_WEATHER_PROVIDERS.join(', ')})`);
  } else if (!SUPPORTED_WEATHER_PROVIDERS.includes(provider)) {
    errors.push(`WEATHER_PROVIDER must be one of: ${SUPPORTED_WEATHER_PROVIDERS.join(', ')}`);
  } else if (provider === 'weatherapi' && isBlank(env.WEATHERAPI_API_KEY)) {
    errors.push('WEATHERAPI_API_KEY is required when WEATHER_PROVIDER=weatherapi');
  } else if (provider === 'imd' && isBlank(env.IMD_API_KEY)) {
    errors.push('IMD_API_KEY is required when WEATHER_PROVIDER=imd');
  }

  if (!isBlank(env.PORT) && !/^\d+$/.test(env.PORT.trim())) {
    errors.push('PORT must be a numeric port when set');
  }

  if (env.APP_MODE === 'demo') {
    warnings.push('APP_MODE=demo in production — demo reset and landslide simulation are ENABLED');
  }
  if (isBlank(env.ANTHROPIC_API_KEY)) {
    warnings.push('ANTHROPIC_API_KEY not set — AI analysis will run as DEMO_FALLBACK');
  }

  return { errors, warnings };
}

/**
 * Phase 8B.1: extracts the database name from a MongoDB connection string
 * WITHOUT exposing credentials — only the path segment after the host is
 * read. Returns '' when the URI names no database (the driver would then
 * silently fall back to `test`). Returns null when the value is not a
 * mongodb:// or mongodb+srv:// URI at all.
 */
function getMongoDatabaseName(uri) {
  if (typeof uri !== 'string') return null;
  const match = uri.trim().match(/^mongodb(?:\+srv)?:\/\/(.*)$/);
  if (!match) return null;
  const withoutQuery = match[1].split('?')[0];
  // Credentials (user:password@) precede the LAST '@' of the authority;
  // a URL-encoded password never contains a raw '@' or '/'.
  const afterCredentials = withoutQuery.slice(withoutQuery.lastIndexOf('@') + 1);
  const slash = afterCredentials.indexOf('/');
  if (slash === -1) return '';
  try {
    return decodeURIComponent(afterCredentials.slice(slash + 1));
  } catch {
    return afterCredentials.slice(slash + 1);
  }
}

/**
 * Phase 8B.1: with APP_MODE=production, MONGO_URI must name its database
 * explicitly, and that database must not be `test` (the driver default,
 * i.e. the shared database this project is migrating away from). Demo and
 * local modes are unaffected. Messages never include the URI itself.
 * @returns {string[]} errors (empty when valid or not in production mode)
 */
function validateProductionDatabase(env = process.env) {
  if (env.APP_MODE !== 'production') return [];
  if (isBlank(env.MONGO_URI)) return []; // reported by validateProductionEnv / connectDB

  const dbName = getMongoDatabaseName(env.MONGO_URI);
  if (dbName === null) {
    return ['MONGO_URI must be a mongodb:// or mongodb+srv:// connection string'];
  }
  if (dbName === '') {
    return [
      'MONGO_URI must name its database explicitly when APP_MODE=production ' +
        '(mongodb+srv://<user>:<password>@<cluster>/<database>?...) — without one the driver falls back to "test"',
    ];
  }
  if (dbName.toLowerCase() === 'test') {
    return ['MONGO_URI must not use the "test" database when APP_MODE=production — use a dedicated production database'];
  }
  return [];
}

/**
 * Startup hook for server.js — runs before connecting to MongoDB or
 * starting any scheduler. Exits the process (code 1) with a clear,
 * value-free message on failure.
 *   - NODE_ENV=production: full production variable validation.
 *   - APP_MODE=production: explicit, non-`test` database name required.
 */
function assertProductionEnv(env = process.env) {
  const nodeProduction = env.NODE_ENV === 'production';
  const appProduction = env.APP_MODE === 'production';
  if (!nodeProduction && !appProduction) return;

  const errors = [];
  const warnings = [];
  if (nodeProduction) {
    const result = validateProductionEnv(env);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }
  errors.push(...validateProductionDatabase(env));

  for (const w of warnings) console.warn(`[CONFIG] warning: ${w}`);
  if (errors.length > 0) {
    console.error('[CONFIG] Production startup aborted — fix the following environment variables:');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log('[CONFIG] production environment validated');
}

module.exports = { validateProductionEnv, validateProductionDatabase, getMongoDatabaseName, assertProductionEnv };
