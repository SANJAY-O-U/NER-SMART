/**
 * Data Source Registry — FOUNDATION ONLY (Phase 1)
 * -------------------------------------------------
 * A minimal, in-memory registry that tracks the status of each external
 * data source the platform depends on. Phase 1 registers exactly one
 * source (the imported road network); later phases (weather, alerts)
 * will register their own entries the same way.
 *
 * This is intentionally NOT persisted to MongoDB and NOT exposed as a
 * full dashboard panel yet — Phase 1 only needs the structure to exist
 * and be queryable via one small endpoint, per the mission doc's
 * "foundation now, full panel later" instruction.
 *
 * In-memory means this resets on server restart. That's acceptable for
 * Phase 1 (road network status is set once at import time and rarely
 * changes); if later phases need durability, persist to a small
 * DataSource collection instead of changing this interface.
 */

const STATUSES = ['LIVE', 'STALE', 'CACHED', 'UNAVAILABLE', 'DEMO'];

const registry = new Map();

/**
 * Register or update a data source's status.
 * @param {string} name - unique source key, e.g. "NER_ROAD_NETWORK"
 * @param {object} entry
 * @param {'LIVE'|'STALE'|'CACHED'|'UNAVAILABLE'|'DEMO'} entry.status
 * @param {string} entry.source - human-readable source description
 * @param {string} [entry.coverage]
 * @param {number} [entry.confidence] - 0-1
 * @param {Date} [entry.lastUpdated]
 */
function registerSource(name, entry) {
  if (!STATUSES.includes(entry.status)) {
    throw new Error(`Invalid data source status: ${entry.status}`);
  }
  registry.set(name, {
    name,
    ...entry,
    lastUpdated: entry.lastUpdated || new Date(),
  });
}

function getSource(name) {
  return registry.get(name) || null;
}

function listSources() {
  return Array.from(registry.values());
}

module.exports = { registerSource, getSource, listSources, STATUSES };
