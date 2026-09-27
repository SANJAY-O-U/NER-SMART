import 'package:flutter_test/flutter_test.dart';
import 'package:ner_smart_driver/models/local_incident_event.dart';
import 'package:ner_smart_driver/services/sync_service.dart';

/// Restart recovery: a report left `localOnly` (app died between the
/// initial insert and the syncPending update) or `syncing` (app died
/// mid-upload) must be re-queued at startup — never stranded, never
/// deleted, never duplicated. Uses in-memory fakes via SyncService's
/// test seams; no SQLite, no network.

class FakeStore {
  final Map<String, LocalIncidentEvent> rows = {};
  int saves = 0;

  Future<List<LocalIncidentEvent>> all() async => rows.values.toList();
  Future<List<LocalIncidentEvent>> pending() async => rows.values
      .where((e) => e.syncStatus == SyncStatus.syncPending || e.syncStatus == SyncStatus.syncFailed)
      .toList();
  Future<void> save(LocalIncidentEvent e) async {
    saves += 1;
    rows[e.eventId] = e; // update-in-place by primary key, like LocalEventStore.update
  }
}

/// Mimics the backend's clientEventId idempotency: the same key always
/// resolves to the same server incident.
class FakeServer {
  final Map<String, String> incidentByClientEventId = {};
  final List<String> receivedClientEventIds = [];
  int _next = 1;

  Future<Map<String, dynamic>> send(LocalIncidentEvent e) async {
    receivedClientEventIds.add(e.eventId);
    final id = incidentByClientEventId.putIfAbsent(e.eventId, () => 'srv-${_next++}');
    return {'id': id};
  }
}

LocalIncidentEvent makeEvent(String id, SyncStatus status, {int retryCount = 0, DateTime? lastSyncAttempt}) {
  final created = DateTime.utc(2026, 9, 27, 10, 0);
  return LocalIncidentEvent(
    eventId: id,
    eventType: 'ROAD_DAMAGE',
    createdAt: created,
    updatedAt: created,
    latitude: 24.839033206185018,
    longitude: 92.83321918253361,
    locationMode: 'LIVE_GPS',
    gpsAccuracyMeters: 8.0,
    description: 'test report $id',
    syncStatus: status,
    retryCount: retryCount,
    lastSyncAttempt: lastSyncAttempt,
  );
}

void main() {
  late FakeStore store;
  late FakeServer server;

  setUp(() {
    store = FakeStore();
    server = FakeServer();
    SyncService.loadAllEvents = store.all;
    SyncService.loadPendingEvents = store.pending;
    SyncService.saveEvent = store.save;
    SyncService.sendIncident = server.send;
  });

  tearDown(SyncService.resetTestSeams);

  test('1. localOnly -> syncPending after restart', () async {
    store.rows['a'] = makeEvent('a', SyncStatus.localOnly);
    expect(await SyncService.recoverInterruptedEvents(), 1);
    expect(store.rows['a']!.syncStatus, SyncStatus.syncPending);
  });

  test('2. syncing -> syncPending after restart', () async {
    store.rows['b'] = makeEvent('b', SyncStatus.syncing);
    expect(await SyncService.recoverInterruptedEvents(), 1);
    expect(store.rows['b']!.syncStatus, SyncStatus.syncPending);
  });

  test('3/4/5. syncPending, syncFailed and synced are left untouched', () async {
    store.rows['p'] = makeEvent('p', SyncStatus.syncPending);
    store.rows['f'] = makeEvent('f', SyncStatus.syncFailed, retryCount: 3);
    store.rows['s'] = makeEvent('s', SyncStatus.synced)..serverIncidentId = 'srv-old';
    expect(await SyncService.recoverInterruptedEvents(), 0);
    expect(store.saves, 0); // not even rewritten
    expect(store.rows['p']!.syncStatus, SyncStatus.syncPending);
    expect(store.rows['f']!.syncStatus, SyncStatus.syncFailed);
    expect(store.rows['f']!.retryCount, 3);
    expect(store.rows['s']!.syncStatus, SyncStatus.synced);
    expect(store.rows['s']!.serverIncidentId, 'srv-old');
  });

  test('6. recovery is idempotent across repeated startups', () async {
    store.rows['a'] = makeEvent('a', SyncStatus.localOnly);
    store.rows['b'] = makeEvent('b', SyncStatus.syncing);
    expect(await SyncService.recoverInterruptedEvents(), 2);
    final savesAfterFirst = store.saves;
    expect(await SyncService.recoverInterruptedEvents(), 0);
    expect(await SyncService.recoverInterruptedEvents(), 0);
    expect(store.saves, savesAfterFirst);
    expect(store.rows.length, 2); // nothing added or deleted
  });

  test('8. eventId/clientEventId, payload and retry history are preserved', () async {
    final attempted = DateTime.utc(2026, 9, 27, 9, 0);
    final original = makeEvent('keep-me', SyncStatus.syncing, retryCount: 2, lastSyncAttempt: attempted);
    store.rows['keep-me'] = original;
    await SyncService.recoverInterruptedEvents();
    final e = store.rows['keep-me']!;
    expect(e.eventId, 'keep-me');
    expect(e.createdAt, DateTime.utc(2026, 9, 27, 10, 0));
    expect(e.latitude, 24.839033206185018);
    expect(e.longitude, 92.83321918253361);
    expect(e.description, 'test report keep-me');
    expect(e.eventType, 'ROAD_DAMAGE');
    expect(e.retryCount, 2);
    expect(e.lastSyncAttempt, attempted);
    expect(e.serverIncidentId, isNull);
  });

  test('7. a recovered event is then sent through the existing sync path', () async {
    store.rows['a'] = makeEvent('a', SyncStatus.localOnly);
    await SyncService.recoverInterruptedEvents();
    await SyncService.runSyncPass();
    expect(server.receivedClientEventIds, ['a']);
    expect(store.rows['a']!.syncStatus, SyncStatus.synced);
    expect(store.rows['a']!.serverIncidentId, 'srv-1');
  });

  test('without recovery, localOnly/syncing are never picked up (documents the original defect)', () async {
    store.rows['a'] = makeEvent('a', SyncStatus.localOnly);
    store.rows['b'] = makeEvent('b', SyncStatus.syncing);
    await SyncService.runSyncPass();
    expect(server.receivedClientEventIds, isEmpty);
  });

  test('an event interrupted mid-upload (server already has it) resyncs without a duplicate identity', () async {
    // Previous app run: the POST reached the server, then the app died
    // before marking the event SYNCED, leaving it `syncing` locally.
    final e = makeEvent('interrupted', SyncStatus.syncing);
    store.rows['interrupted'] = e;
    final firstServerId = (await server.send(e))['id'];

    await SyncService.recoverInterruptedEvents();
    await SyncService.runSyncPass();

    expect(server.receivedClientEventIds, ['interrupted', 'interrupted']); // same clientEventId both times
    expect(server.incidentByClientEventId.length, 1); // still ONE server incident
    expect(store.rows.length, 1); // still ONE local event
    expect(store.rows['interrupted']!.syncStatus, SyncStatus.synced);
    expect(store.rows['interrupted']!.serverIncidentId, firstServerId);
  });

  test('startup recovery runs before the first sync pass', () async {
    store.rows['a'] = makeEvent('a', SyncStatus.syncing);
    await SyncService.recoverThenSync();
    expect(server.receivedClientEventIds, ['a']);
    expect(store.rows['a']!.syncStatus, SyncStatus.synced);
  });
}
