/**
 * APP_MODE helpers — dependency-free so any entry point (HTTP controllers,
 * the seed CLI) can share them without circular requires.
 */

/**
 * Pure predicate — Phase 7F allowlist. Demo-only operations (demo reset,
 * landslide simulation, the seed CLI) require APP_MODE to be EXACTLY
 * 'demo'; unset, misspelled or any other value is rejected.
 */
function isDemoResetAllowed(appMode) {
  return appMode === 'demo';
}

module.exports = { isDemoResetAllowed };
