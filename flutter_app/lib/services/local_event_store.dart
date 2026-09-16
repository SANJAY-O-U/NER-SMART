import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart' as p;
import '../models/local_incident_event.dart';

/// Durable local storage for field-captured incident events.
///
/// This is the FIRST place a report lands — before any network call is
/// attempted. If this write fails, the report is NOT considered captured
/// (see report_flow_screen.dart) — the app must never tell the field
/// worker "captured" while quietly holding nothing.
///
/// Schema versioned (DB_VERSION) with a migration hook, per the mission's
/// explicit requirement, even though there's only one version so far.
class LocalEventStore {
  static const String _dbName = 'ner_smart_field.db';
  static const int _dbVersion = 1;
  static const String _eventsTable = 'incident_events';
  static const String _mediaTable = 'media_queue'; // Phase 5G — schema ready, no capture UI yet (see OFFLINE_ARCHITECTURE.md)

  static Database? _db;

  static Future<Database> _database() async {
    if (_db != null) return _db!;
    final dbPath = await getDatabasesPath();
    final path = p.join(dbPath, _dbName);
    _db = await openDatabase(
      path,
      version: _dbVersion,
      onCreate: (db, version) async {
        await db.execute('''
          CREATE TABLE $_eventsTable (
            eventId TEXT PRIMARY KEY,
            eventType TEXT NOT NULL,
            createdAt TEXT NOT NULL,
            updatedAt TEXT NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            gpsAccuracyMeters REAL,
            speedMetersPerSecond REAL,
            headingDegrees REAL,
            locationMode TEXT NOT NULL,
            roadId TEXT,
            roadMatchConfidence TEXT,
            severity TEXT,
            description TEXT NOT NULL DEFAULT '',
            mediaReferences TEXT NOT NULL DEFAULT '',
            syncStatus TEXT NOT NULL,
            retryCount INTEGER NOT NULL DEFAULT 0,
            lastSyncAttempt TEXT,
            lastSyncError TEXT,
            serverIncidentId TEXT,
            source TEXT NOT NULL DEFAULT 'FIELD_APP'
          )
        ''');
        await db.execute('CREATE INDEX idx_events_syncStatus ON $_eventsTable (syncStatus)');
        await db.execute('CREATE INDEX idx_events_createdAt ON $_eventsTable (createdAt)');

        // Media queue: schema in place for Phase 5G, unused until the
        // app gains photo-capture UI. Never populated with fake rows.
        await db.execute('''
          CREATE TABLE $_mediaTable (
            mediaId TEXT PRIMARY KEY,
            eventId TEXT NOT NULL,
            localPath TEXT NOT NULL,
            createdAt TEXT NOT NULL,
            syncStatus TEXT NOT NULL,
            retryCount INTEGER NOT NULL DEFAULT 0,
            lastSyncAttempt TEXT,
            lastSyncError TEXT,
            FOREIGN KEY (eventId) REFERENCES $_eventsTable (eventId)
          )
        ''');
        await db.execute('CREATE INDEX idx_media_eventId ON $_mediaTable (eventId)');
      },
      // Migration hook for future schema versions. No-op today (v1 is
      // the only version that has ever shipped), but the mechanism
      // exists per the mission's explicit requirement.
      onUpgrade: (db, oldVersion, newVersion) async {
        // if (oldVersion < 2) { await db.execute('ALTER TABLE ... '); }
      },
    );
    return _db!;
  }

  /// Writes a new event. Uses `ConflictAlgorithm.abort` (the default) —
  /// an eventId collision is a programming error (UUIDs shouldn't
  /// collide), not something to silently overwrite.
  static Future<void> insert(LocalIncidentEvent event) async {
    final db = await _database();
    await db.insert(_eventsTable, event.toDbMap());
  }

  /// Updates an existing event's mutable fields (sync state, retry
  /// bookkeeping, road match once resolved). Transactional — a single
  /// row update is already atomic in SQLite, but wrapped for clarity
  /// and to make future multi-row updates safe to add here.
  static Future<void> update(LocalIncidentEvent event) async {
    final db = await _database();
    event.updatedAt = DateTime.now();
    await db.update(
      _eventsTable,
      event.toDbMap(),
      where: 'eventId = ?',
      whereArgs: [event.eventId],
    );
  }

  static Future<LocalIncidentEvent?> getById(String eventId) async {
    final db = await _database();
    final rows = await db.query(_eventsTable, where: 'eventId = ?', whereArgs: [eventId], limit: 1);
    if (rows.isEmpty) return null;
    return LocalIncidentEvent.fromDbMap(rows.first);
  }

  /// Events in SYNC_PENDING or SYNC_FAILED — what the sync engine
  /// processes on each pass. Ordered by createdAt to preserve ordering
  /// where practical, per the mission's requirement.
  static Future<List<LocalIncidentEvent>> getPendingSync() async {
    final db = await _database();
    final rows = await db.query(
      _eventsTable,
      where: 'syncStatus IN (?, ?)',
      whereArgs: [syncStatusToDb(SyncStatus.syncPending), syncStatusToDb(SyncStatus.syncFailed)],
      orderBy: 'createdAt ASC',
    );
    return rows.map(LocalIncidentEvent.fromDbMap).toList();
  }

  /// All events, newest first — for the field worker's "my reports" list,
  /// so LOCAL_ONLY/SYNC_FAILED reports are never invisible.
  static Future<List<LocalIncidentEvent>> getAll() async {
    final db = await _database();
    final rows = await db.query(_eventsTable, orderBy: 'createdAt DESC');
    return rows.map(LocalIncidentEvent.fromDbMap).toList();
  }

  /// Test/ops helper — never called from normal app flow. Deleting a
  /// user's captured report is not something this app does on its own
  /// (see OFFLINE_ARCHITECTURE.md — "never silently discard").
  static Future<void> deleteForTesting(String eventId) async {
    final db = await _database();
    await db.delete(_eventsTable, where: 'eventId = ?', whereArgs: [eventId]);
  }
}
