/// Explicit sync-state machine. Deliberately NOT a boolean `isSynced` —
/// an incident can be in exactly one of these states, and the UI/sync
/// engine branch on all five, not just "done vs not done".
enum SyncStatus {
  localOnly, // written to the device, sync not yet attempted
  syncPending, // queued, waiting for connectivity/backoff window
  syncing, // an upload attempt is currently in flight
  synced, // server has confirmed persistence (or idempotent replay)
  syncFailed, // a sync attempt failed — retained locally, may retry
}

String syncStatusToDb(SyncStatus s) => s.name;

SyncStatus syncStatusFromDb(String value) {
  return SyncStatus.values.firstWhere(
    (s) => s.name == value,
    orElse: () => SyncStatus.localOnly,
  );
}

/// A durable local field event. Every field the device/platform didn't
/// actually provide is null — never fabricated. `eventId` is generated
/// once on-device (UUID) and never changes across retries; it is sent to
/// the backend as `clientEventId` and is the idempotency key that
/// guarantees one field report never becomes two server-side Incidents.
class LocalIncidentEvent {
  final String eventId;
  final String eventType; // ROAD_DAMAGE | LANDSLIDE | FLOOD | ACCIDENT | OTHER
  final DateTime createdAt;
  DateTime updatedAt;

  final double latitude;
  final double longitude;
  final double? gpsAccuracyMeters;
  final double? speedMetersPerSecond;
  final double? headingDegrees;
  final String locationMode; // 'LIVE_GPS' | 'NER_DEMO' — Phase 4A modes, unchanged

  String? roadId; // filled in once nearest-road matching succeeds (online)
  String? roadMatchConfidence;

  final String? severity; // optional, driver-supplied — never AI-inferred locally
  final String description;

  final List<String> mediaReferences; // local file paths, Phase 5G queue (see OFFLINE_ARCHITECTURE.md)

  SyncStatus syncStatus;
  int retryCount;
  DateTime? lastSyncAttempt;
  String? lastSyncError;
  String? serverIncidentId; // set once the server confirms (SYNCED)

  final String source; // always 'FIELD_APP' for locally-created events

  LocalIncidentEvent({
    required this.eventId,
    required this.eventType,
    required this.createdAt,
    required this.updatedAt,
    required this.latitude,
    required this.longitude,
    required this.locationMode,
    this.gpsAccuracyMeters,
    this.speedMetersPerSecond,
    this.headingDegrees,
    this.roadId,
    this.roadMatchConfidence,
    this.severity,
    this.description = '',
    this.mediaReferences = const [],
    this.syncStatus = SyncStatus.localOnly,
    this.retryCount = 0,
    this.lastSyncAttempt,
    this.lastSyncError,
    this.serverIncidentId,
    this.source = 'FIELD_APP',
  });

  Map<String, dynamic> toDbMap() {
    return {
      'eventId': eventId,
      'eventType': eventType,
      'createdAt': createdAt.toIso8601String(),
      'updatedAt': updatedAt.toIso8601String(),
      'latitude': latitude,
      'longitude': longitude,
      'gpsAccuracyMeters': gpsAccuracyMeters,
      'speedMetersPerSecond': speedMetersPerSecond,
      'headingDegrees': headingDegrees,
      'locationMode': locationMode,
      'roadId': roadId,
      'roadMatchConfidence': roadMatchConfidence,
      'severity': severity,
      'description': description,
      'mediaReferences': mediaReferences.join('|'), // simple delimited list — see OFFLINE_ARCHITECTURE.md
      'syncStatus': syncStatusToDb(syncStatus),
      'retryCount': retryCount,
      'lastSyncAttempt': lastSyncAttempt?.toIso8601String(),
      'lastSyncError': lastSyncError,
      'serverIncidentId': serverIncidentId,
      'source': source,
    };
  }

  static LocalIncidentEvent fromDbMap(Map<String, dynamic> map) {
    return LocalIncidentEvent(
      eventId: map['eventId'] as String,
      eventType: map['eventType'] as String,
      createdAt: DateTime.parse(map['createdAt'] as String),
      updatedAt: DateTime.parse(map['updatedAt'] as String),
      latitude: map['latitude'] as double,
      longitude: map['longitude'] as double,
      gpsAccuracyMeters: map['gpsAccuracyMeters'] as double?,
      speedMetersPerSecond: map['speedMetersPerSecond'] as double?,
      headingDegrees: map['headingDegrees'] as double?,
      locationMode: map['locationMode'] as String,
      roadId: map['roadId'] as String?,
      roadMatchConfidence: map['roadMatchConfidence'] as String?,
      severity: map['severity'] as String?,
      description: (map['description'] as String?) ?? '',
      mediaReferences: ((map['mediaReferences'] as String?) ?? '')
          .split('|')
          .where((s) => s.isNotEmpty)
          .toList(),
      syncStatus: syncStatusFromDb(map['syncStatus'] as String),
      retryCount: (map['retryCount'] as int?) ?? 0,
      lastSyncAttempt: map['lastSyncAttempt'] != null ? DateTime.parse(map['lastSyncAttempt'] as String) : null,
      lastSyncError: map['lastSyncError'] as String?,
      serverIncidentId: map['serverIncidentId'] as String?,
      source: (map['source'] as String?) ?? 'FIELD_APP',
    );
  }
}
