/**
 * Phase 8B.3.1 — isolated production database migration (test -> ner-smart-prod).
 *
 * DRY RUN IS THE DEFAULT. A dry run opens both connections and performs
 * READ-ONLY commands only (connectionStatus, listCollections, listIndexes,
 * countDocuments, find). Writing requires BOTH:
 *     --execute --confirm-target=ner-smart-prod
 *
 * Connection strings are never passed on the command line. They are read
 * from environment variables named by:
 *     --source-uri-env=NAME   (default SOURCE_MONGO_URI; must select `test`)
 *     --target-uri-env=NAME   (default TARGET_MONGO_URI; must select `ner-smart-prod`)
 * e.g. from backend/:
 *     node --env-file=.env --env-file=.env.verify scripts/migrateToIsolatedDb.js \
 *          --source-uri-env=MONGO_URI --target-uri-env=NER_PROD_MONGO_URI
 *
 * Guarantees (see test/migrateToIsolatedDb.test.js):
 *   - hardcoded allowlist; excluded collections are never read, copied or created
 *   - documents are copied unchanged, original _id preserved, no transformation
 *   - the source is only ever read; the target only ever receives createIndex
 *     and insertMany (ordered) — there is no drop/delete/update/upsert path
 *   - execute refuses a target that already holds migrated data (no overwrite)
 *   - fail-fast: the first error aborts the run
 *   - no URI, username, password or host is ever printed
 *
 * Uses the native driver (not Mongoose models) so no autoIndex side effects.
 */

const crypto = require('node:crypto');
const { MongoClient, BSON } = require('mongodb');

const SOURCE_DB = 'test';
const TARGET_DB = 'ner-smart-prod';
const BATCH_SIZE = 500;

/** Collections copied, in dependency order (roads first: other data may reference road _ids). */
const MIGRATE = Object.freeze([
  Object.freeze({
    name: 'roads',
    filter: Object.freeze({ source: { $ne: null } }), // imported roads only; excludes the 5 demo roads (source: null)
    expectedCount: 260,
    indexes: Object.freeze([{ name: 'geometry_2dsphere', key: { geometry: '2dsphere' } }]),
  }),
  Object.freeze({
    name: 'weatherobservations',
    filter: Object.freeze({}),
    expectedCount: null, // snapshot-dependent: source ingestion is still active
    indexes: Object.freeze([
      { name: 'location_2dsphere', key: { location: '2dsphere' } },
      {
        name: 'source_1_sourceRecordId_1_observedAt_1',
        key: { source: 1, sourceRecordId: 1, observedAt: 1 },
        unique: true,
        partialFilterExpression: { sourceRecordId: { $type: 'string' } },
      },
    ]),
  }),
  Object.freeze({
    name: 'disasteralerts',
    filter: Object.freeze({}),
    expectedCount: null, // snapshot-dependent: source ingestion is still active
    indexes: Object.freeze([{ name: 'identifier_1', key: { identifier: 1 }, unique: true }]),
  }),
  Object.freeze({ name: 'warehouses', filter: Object.freeze({}), expectedCount: 3, indexes: Object.freeze([]) }),
  Object.freeze({ name: 'hospitals', filter: Object.freeze({}), expectedCount: 3, indexes: Object.freeze([]) }),
]);

/** Never read, copied or created by this script. */
const EXCLUDE = Object.freeze(['incidents', 'alerts', 'shipments', 'vehicles']);

const PRESERVE_IDS = true;
const ALLOWED_FLAGS = new Set(['--dry-run', '--execute', '--confirm-target', '--source-uri-env', '--target-uri-env']);

// ---------------------------------------------------------------------------
// Pure, testable pieces (no database access)
// ---------------------------------------------------------------------------

/** Parses argv. Dry run unless --execute. Unknown flags (e.g. --drop) are rejected. */
function parseArgs(argv) {
  const opts = { mode: 'dry-run', confirmTarget: null, sourceUriEnv: 'SOURCE_MONGO_URI', targetUriEnv: 'TARGET_MONGO_URI' };
  let sawDryRun = false;
  let sawExecute = false;
  for (const arg of argv) {
    const [flag, value] = arg.split(/=(.*)/s);
    if (!ALLOWED_FLAGS.has(flag)) throw new Error(`Unknown option "${flag}". Allowed: ${[...ALLOWED_FLAGS].join(', ')}`);
    if (flag === '--dry-run') sawDryRun = true;
    else if (flag === '--execute') sawExecute = true;
    else if (flag === '--confirm-target') opts.confirmTarget = value ?? '';
    else if (flag === '--source-uri-env') opts.sourceUriEnv = value;
    else if (flag === '--target-uri-env') opts.targetUriEnv = value;
  }
  if (sawDryRun && sawExecute) throw new Error('--dry-run and --execute are mutually exclusive');
  if (sawExecute) opts.mode = 'execute';
  return opts;
}

/** Returns null if writing is allowed, else the refusal reason. */
function writeRefusal(opts) {
  if (opts.mode !== 'execute') return 'dry run (default) — writes are disabled';
  if (!opts.confirmTarget) return `--execute requires --confirm-target=${TARGET_DB}`;
  if (opts.confirmTarget !== TARGET_DB) return `--confirm-target must be exactly "${TARGET_DB}"`;
  return null;
}

function assertSourceDb(name) {
  if (name !== SOURCE_DB) throw new Error(`Source database must be exactly "${SOURCE_DB}" (selected: "${name}")`);
}

function assertTargetDb(name) {
  if (name !== TARGET_DB) throw new Error(`Target database must be exactly "${TARGET_DB}" (selected: "${name}")`);
}

/** Resolves a collection name against the allowlist; anything else throws. */
function getPlan(collectionName) {
  const plan = MIGRATE.find((p) => p.name === collectionName);
  if (!plan) throw new Error(`Collection "${collectionName}" is not in the migration allowlist`);
  return plan;
}

/** Target user must hold exactly readWrite on the target database — nothing broader. */
function assertTargetRoles(roles) {
  const got = roles.map((r) => `${r.role}@${r.db}`).sort();
  const want = [`readWrite@${TARGET_DB}`];
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error(`Target user roles must be exactly ${JSON.stringify(want)} (got ${JSON.stringify(got)})`);
  }
}

/** Strips credentials/hosts from any error text before it is printed. */
function sanitize(message) {
  return String(message || '')
    .replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri>')
    .replace(/[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.mongodb\.net/g, '<host>');
}

/** Stable fingerprint of documents (canonical BSON, _id order) — detects any change. */
function fingerprint(docs) {
  const h = crypto.createHash('sha256');
  for (const d of docs) h.update(BSON.serialize(d));
  return h.digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// Database steps
// ---------------------------------------------------------------------------

function log(...args) {
  console.log(...args);
}

async function connect(uri, label) {
  if (!uri) throw new Error(`${label} connection string not provided (environment variable is empty)`);
  const client = new MongoClient(uri, { retryWrites: false, serverSelectionTimeoutMS: 15000 });
  await client.connect();
  return client;
}

/** Read-only inspection of the source; returns the exact _id snapshot per collection. */
async function inspectSource(sourceDb) {
  const existing = new Set((await sourceDb.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  const snapshot = {};

  for (const plan of MIGRATE) {
    if (!existing.has(plan.name)) throw new Error(`Source collection "${plan.name}" does not exist`);
    const col = sourceDb.collection(plan.name);

    const total = await col.countDocuments({});
    const docs = await col.find(plan.filter).sort({ _id: 1 }).toArray();
    const ids = docs.map((d) => String(d._id));
    if (new Set(ids).size !== ids.length) throw new Error(`Duplicate _id values in source ${plan.name}`);
    if (plan.expectedCount !== null && docs.length !== plan.expectedCount) {
      throw new Error(`${plan.name}: filter matched ${docs.length}, expected exactly ${plan.expectedCount}`);
    }

    // Index manifest must match the live source definitions (no invented indexes).
    const live = (await col.listIndexes().toArray()).filter((i) => i.name !== '_id_');
    const norm = (i) => JSON.stringify({ name: i.name, key: i.key, unique: i.unique || false, pfe: i.partialFilterExpression || null });
    const liveSet = live.map(norm).sort();
    const planSet = plan.indexes.map(norm).sort();
    if (JSON.stringify(liveSet) !== JSON.stringify(planSet)) {
      throw new Error(`${plan.name}: index manifest differs from live source indexes`);
    }

    snapshot[plan.name] = { total, filtered: docs.length, ids: docs.map((d) => d._id), fingerprint: fingerprint(docs), docs };
  }
  return snapshot;
}

/** Read-only checks of documents whose relationships matter. */
async function validateReferences(snapshot) {
  const findings = [];
  const roadIds = new Set(snapshot.roads.ids.map(String));

  const blocked = snapshot.roads.docs.filter((d) => d.status === 'BLOCKED');
  findings.push(`legacy BLOCKED roads included unchanged: ${blocked.length} (fingerprint ${fingerprint(blocked)})`);
  for (const d of blocked) findings.push(`  ${d._id} status=${d.status} landslideRisk=${d.landslideRisk} physical/official/field=${d.physicalStatus}/${d.officialStatus}/${d.fieldStatus}`);

  const demoLeak = snapshot.roads.docs.filter((d) => d.source === null || d.source === undefined).length;
  if (demoLeak) throw new Error(`roads filter leaked ${demoLeak} demo road(s)`);
  findings.push('demo roads (source: null) in migrated set: 0');

  const weatherWithRoadRef = snapshot.weatherobservations.docs.filter((d) => 'roadId' in d || 'roadIds' in d).length;
  const weatherNoLocation = snapshot.weatherobservations.docs.filter((d) => !d.location || !Array.isArray(d.location.coordinates)).length;
  findings.push(`weatherobservations: road-ID fields ${weatherWithRoadRef}, missing location ${weatherNoLocation} (coordinate-based association)`);
  if (weatherWithRoadRef || weatherNoLocation) throw new Error('weatherobservations reference check failed');

  const dangling = [];
  let populated = 0;
  for (const d of snapshot.disasteralerts.docs) {
    const refs = d.affectedRoadIds || [];
    if (refs.length) populated += 1;
    for (const r of refs) if (!roadIds.has(String(r))) dangling.push(String(r));
  }
  findings.push(`disasteralerts: affectedRoadIds populated on ${populated}, references outside migrated roads ${dangling.length}`);
  if (dangling.length) throw new Error('disasteralerts reference roads that are not being migrated');

  for (const name of ['warehouses', 'hospitals']) {
    const idFields = new Set();
    for (const d of snapshot[name].docs) {
      for (const [k, v] of Object.entries(d)) if (k !== '_id' && v && v._bsontype === 'ObjectId') idFields.add(k);
    }
    findings.push(`${name}: ObjectId reference fields ${idFields.size ? [...idFields].join(',') : 'none'}`);
    if (idFields.size) throw new Error(`${name} contains references to other collections`);
  }
  return findings;
}

/** Read-only checks of the target: identity, exact role, and no existing migrated data. */
async function inspectTarget(targetClient) {
  const db = targetClient.db();
  assertTargetDb(db.databaseName);
  const status = await db.admin().command({ connectionStatus: 1 });
  assertTargetRoles(status.authInfo.authenticatedUserRoles);

  const existing = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name);
  const occupied = [];
  for (const name of [...MIGRATE.map((p) => p.name), ...EXCLUDE]) {
    if (existing.includes(name) && (await db.collection(name).estimatedDocumentCount()) > 0) occupied.push(name);
  }
  if (occupied.length) throw new Error(`Target already contains data in: ${occupied.join(', ')} — refusing (no overwrite)`);
  return { db, existingCollections: existing };
}

/** WRITE PATH — only reachable when writeRefusal() returns null. */
async function executeMigration(opts, sourceDb, targetDb, snapshot) {
  const refusal = writeRefusal(opts);
  if (refusal) throw new Error(`Refusing to write: ${refusal}`); // defense in depth

  for (const plan of MIGRATE) {
    for (const idx of plan.indexes) {
      const { key, ...options } = idx;
      await targetDb.collection(plan.name).createIndex(key, options);
    }
  }

  for (const plan of MIGRATE) {
    const ids = snapshot[plan.name].ids;
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batchIds = ids.slice(i, i + BATCH_SIZE);
      // Re-read by exact _id snapshot; documents inserted unchanged (original _id kept).
      const docs = await sourceDb.collection(plan.name).find({ _id: { $in: batchIds } }).sort({ _id: 1 }).toArray();
      if (docs.length !== batchIds.length) throw new Error(`${plan.name}: source changed during copy (batch ${i / BATCH_SIZE})`);
      await targetDb.collection(plan.name).insertMany(docs, { ordered: true });
    }
    log(`  copied ${plan.name}: ${ids.length}`);
  }
}

/** Post-copy validation (read-only): counts, _id sets, byte-level content, indexes, exclusions. */
async function validateTarget(targetDb, snapshot) {
  for (const plan of MIGRATE) {
    const docs = await targetDb.collection(plan.name).find({}).sort({ _id: 1 }).toArray();
    const expected = snapshot[plan.name];
    if (docs.length !== expected.filtered) throw new Error(`${plan.name}: target has ${docs.length}, expected ${expected.filtered}`);
    // Weather/SACHET documents may legitimately be updated in the source mid-run;
    // the fingerprint compares against the snapshot taken at preflight.
    const fp = fingerprint(docs);
    log(`  ${plan.name}: count ${docs.length} OK, fingerprint ${fp === expected.fingerprint ? 'MATCH' : 'DIFFERS (source updated during copy)'}`);
    if (plan.name !== 'weatherobservations' && plan.name !== 'disasteralerts' && fp !== expected.fingerprint) {
      throw new Error(`${plan.name}: copied content differs from source snapshot`);
    }
    const names = (await targetDb.collection(plan.name).listIndexes().toArray()).map((i) => i.name);
    for (const idx of plan.indexes) if (!names.includes(idx.name)) throw new Error(`${plan.name}: missing index ${idx.name}`);
  }
  const present = (await targetDb.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name);
  const unexpected = present.filter((n) => !MIGRATE.some((p) => p.name === n));
  if (unexpected.length) throw new Error(`Target contains non-allowlisted collections: ${unexpected.join(', ')}`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(argv = process.argv.slice(2), env = process.env) {
  const opts = parseArgs(argv);
  const startedAt = new Date().toISOString();
  const refusal = writeRefusal(opts);

  log(`# NER-SMART isolated DB migration — ${opts.mode === 'execute' && !refusal ? 'EXECUTE' : 'DRY RUN'}`);
  log(`runStartedAt: ${startedAt}`);
  if (opts.mode === 'execute' && refusal) throw new Error(`Refusing to write: ${refusal}`);

  let source;
  let target;
  try {
    source = await connect(env[opts.sourceUriEnv], 'Source');
    const sourceDb = source.db();
    assertSourceDb(sourceDb.databaseName);

    target = await connect(env[opts.targetUriEnv], 'Target');
    const { db: targetDb, existingCollections } = await inspectTarget(target);

    log(`\n### Source\n${sourceDb.databaseName}`);
    log(`\n### Target\n${targetDb.databaseName}  (user roles: readWrite@${TARGET_DB} only; existing collections: ${existingCollections.length})`);
    log(`\n### Migration allowlist\n${MIGRATE.map((p) => p.name).join('\n')}`);
    log(`\n### Exclusions\n${EXCLUDE.join('\n')}\nall unrelated collections (never read)`);

    const snapshot = await inspectSource(sourceDb);
    log(`\n### Counts (snapshot at ${new Date().toISOString()})`);
    for (const plan of MIGRATE) {
      const s = snapshot[plan.name];
      const note = plan.expectedCount === null ? '  — Count is snapshot-dependent because source ingestion is still active.' : '';
      log(`${plan.name}: source ${s.total}, filtered ${s.filtered} -> expected target ${s.filtered}  [fingerprint ${s.fingerprint}]${note}`);
    }

    log('\n### References');
    for (const f of await validateReferences(snapshot)) log(f);
    log('No unresolved references expected.');

    log(`\n### IDs\nPreserved: ${PRESERVE_IDS ? 'yes — original _id values are inserted unchanged' : 'NO'}`);
    log('\n### Indexes (to be created on the target before copying)');
    for (const plan of MIGRATE) {
      if (!plan.indexes.length) log(`${plan.name}: _id_ only (no secondary indexes in schema or source)`);
      for (const idx of plan.indexes) {
        const { name, key, ...o } = idx;
        log(`${plan.name}: ${name} key=${JSON.stringify(key)}${Object.keys(o).length ? ' ' + JSON.stringify(o) : ''}`);
      }
    }

    if (refusal) {
      log('\n### Writes\nZERO — dry run. To execute: --execute --confirm-target=ner-smart-prod');
      return { mode: 'dry-run', snapshot };
    }

    log('\n### Executing');
    await executeMigration(opts, sourceDb, targetDb, snapshot);
    log('\n### Post-migration validation');
    await validateTarget(targetDb, snapshot);
    log('\nMigration complete and validated.');
    return { mode: 'execute', snapshot };
  } finally {
    if (source) await source.close().catch(() => {});
    if (target) await target.close().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`\nABORTED: ${sanitize(err.message)}`);
    process.exit(1);
  });
}

module.exports = {
  SOURCE_DB,
  TARGET_DB,
  MIGRATE,
  EXCLUDE,
  PRESERVE_IDS,
  parseArgs,
  writeRefusal,
  assertSourceDb,
  assertTargetDb,
  assertTargetRoles,
  getPlan,
  sanitize,
  fingerprint,
  main,
};
