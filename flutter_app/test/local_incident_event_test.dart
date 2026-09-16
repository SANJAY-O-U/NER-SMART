import 'package:flutter_test/flutter_test.dart';
import 'package:ner_smart_driver/models/local_incident_event.dart';

void main() {
  group('LocalIncidentEvent DB round-trip', () {
    test('toDbMap/fromDbMap preserves all fields for a fully-populated event', () {
      final now = DateTime.now();
      final original = LocalIncidentEvent(
        eventId: 'test-uuid-1234',
        eventType: 'ROAD_DAMAGE',
        createdAt: now,
        updatedAt: now,
        latitude: 26.1445,
        longitude: 91.7362,
        locationMode: 'LIVE_GPS',
        gpsAccuracyMeters: 12.5,
        speedMetersPerSecond: 3.2,
        headingDegrees: 180.0,
        roadId: 'road123',
        roadMatchConfidence: 'HIGH',
        severity: 'HIGH',
        description: 'Severe pothole blocking one lane',
        mediaReferences: const ['/local/path/photo1.jpg', '/local/path/photo2.jpg'],
        syncStatus: SyncStatus.syncPending,
        retryCount: 2,
        lastSyncAttempt: now,
        lastSyncError: 'timeout',
        serverIncidentId: null,
      );

      final map = original.toDbMap();
      final restored = LocalIncidentEvent.fromDbMap(map);

      expect(restored.eventId, original.eventId);
      expect(restored.eventType, original.eventType);
      expect(restored.latitude, original.latitude);
      expect(restored.longitude, original.longitude);
      expect(restored.gpsAccuracyMeters, original.gpsAccuracyMeters);
      expect(restored.speedMetersPerSecond, original.speedMetersPerSecond);
      expect(restored.headingDegrees, original.headingDegrees);
      expect(restored.roadId, original.roadId);
      expect(restored.roadMatchConfidence, original.roadMatchConfidence);
      expect(restored.severity, original.severity);
      expect(restored.description, original.description);
      expect(restored.mediaReferences, original.mediaReferences);
      expect(restored.syncStatus, SyncStatus.syncPending);
      expect(restored.retryCount, 2);
      expect(restored.lastSyncError, 'timeout');
    });

    test('round-trip preserves null optional fields as null, never fabricated', () {
      final now = DateTime.now();
      final original = LocalIncidentEvent(
        eventId: 'e2',
        eventType: 'FLOOD',
        createdAt: now,
        updatedAt: now,
        latitude: 24.8,
        longitude: 93.9,
        locationMode: 'NER_DEMO',
      );

      final restored = LocalIncidentEvent.fromDbMap(original.toDbMap());

      expect(restored.gpsAccuracyMeters, null);
      expect(restored.speedMetersPerSecond, null);
      expect(restored.headingDegrees, null);
      expect(restored.roadId, null);
      expect(restored.severity, null);
      expect(restored.serverIncidentId, null);
      expect(restored.mediaReferences, <String>[]);
    });

    test('syncStatus round-trips through every state in the state machine', () {
      for (final status in SyncStatus.values) {
        final event = LocalIncidentEvent(
          eventId: 'e-$status',
          eventType: 'OTHER',
          createdAt: DateTime.now(),
          updatedAt: DateTime.now(),
          latitude: 0,
          longitude: 0,
          locationMode: 'LIVE_GPS',
          syncStatus: status,
        );
        final restored = LocalIncidentEvent.fromDbMap(event.toDbMap());
        expect(restored.syncStatus, status);
      }
    });

    test('an unrecognized syncStatus string falls back to LOCAL_ONLY rather than throwing', () {
      expect(syncStatusFromDb('SOME_UNKNOWN_VALUE'), SyncStatus.localOnly);
    });

    test('a default-constructed event starts as LOCAL_ONLY with retryCount 0', () {
      final event = LocalIncidentEvent(
        eventId: 'e3',
        eventType: 'ACCIDENT',
        createdAt: DateTime.now(),
        updatedAt: DateTime.now(),
        latitude: 26.0,
        longitude: 92.0,
        locationMode: 'LIVE_GPS',
      );
      expect(event.syncStatus, SyncStatus.localOnly);
      expect(event.retryCount, 0);
      expect(event.source, 'FIELD_APP');
    });
  });
}
