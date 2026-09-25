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
 * Startup hook for server.js. No-op outside NODE_ENV=production.
 * Exits the process (code 1) with a clear, value-free message on failure.
 */
function assertProductionEnv(env = process.env) {
  if (env.NODE_ENV !== 'production') return;

  const { errors, warnings } = validateProductionEnv(env);
  for (const w of warnings) console.warn(`[CONFIG] warning: ${w}`);
  if (errors.length > 0) {
    console.error('[CONFIG] Production startup aborted — fix the following environment variables:');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log('[CONFIG] production environment validated');
}

module.exports = { validateProductionEnv, assertProductionEnv };
