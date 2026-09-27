import 'dart:async';
import 'dart:math';
import 'package:flutter/foundation.dart' show visibleForTesting;
import 'api_service.dart';
import 'connectivity_service.dart';
import 'local_event_store.dart';
import '../models/local_incident_event.dart';

/// Store-and-forward synchronization engine.
///
/// Processes SYNC_PENDING and SYNC_FAILED events from local storage,
/// uploads each via the idempotent POST /api/incidents (clientEventId),
/// and updates local sync state transactionally. One event's failure
/// never stops the rest of the batch. Retries use bounded exponential
/// backoff — never an aggressive tight loop.
class SyncService {
  static const int _maxRetries = 8;
  static const Duration _baseBackoff = Duration(seconds: 5);
  static const Duration _maxBackoff = Duration(minutes: 10);

  static bool _running = false;
  static StreamSubscription<NetworkStatus>? _connectivitySub;
  static Timer? _periodicTimer;

  static final _statusController = StreamController<String>.broadcast();

  // Storage/network seams. Default to the real LocalEventStore/ApiService
  // calls; tests replace them with in-memory fakes (no SQLite, no network).
  @visibleForTesting
  static Future<List<LocalIncidentEvent>> Function() loadAllEvents = LocalEventStore.getAll;
  @visibleForTesting
  static Future<List<LocalIncidentEvent>> Function() loadPendingEvents = LocalEventStore.getPendingSync;
  @visibleForTesting
  static Future<void> Function(LocalIncidentEvent) saveEvent = LocalEventStore.update;
  @visibleForTesting
  static Future<Map<String, dynamic>> Function(LocalIncidentEvent) sendIncident = _sendViaApi;

  @visibleForTesting
  static void resetTestSeams() {
    loadAllEvents = LocalEventStore.getAll;
    loadPendingEvents = LocalEventStore.getPendingSync;
    saveEvent = LocalEventStore.update;
    sendIncident = _sendViaApi;
  }

  static Future<Map<String, dynamic>> _sendViaApi(LocalIncidentEvent event) {
    return ApiService.reportIncident(
      type: event.eventType,
      lat: event.latitude,
      lng: event.longitude,
      description: event.description,
      locationMode: event.locationMode,
      gpsAccuracyMeters: event.gpsAccuracyMeters,
      clientEventId: event.eventId, // the idempotency key — safe to retry
    );
  }
  /// Emits a short human-readable status line each time a sync pass
  /// starts/finishes, for a UI banner ("Syncing 2 reports…", etc.).
  static Stream<String> get statusStream => _statusController.stream;

  /// How long to wait before the next retry, given how many attempts
  /// have already failed. Exponential with a documented cap — this is
  /// an engineering default, not tuned against real network conditions.
  /// Public (not `_backoffFor`) so it's directly unit-testable without
  /// needing to drive the whole sync engine.
  static Duration backoffFor(int retryCount) {
    final seconds = _baseBackoff.inSeconds * pow(2, retryCount).clamp(1, 1 << 20);
    final capped = min(seconds.toInt(), _maxBackoff.inSeconds);
    return Duration(seconds: capped);
  }

  /// Starts listening for connectivity changes and triggers a sync pass
  /// whenever the device comes back online, plus a periodic safety-net
  /// pass (in case connectivity flapped without a clean transition
  /// event, or the app was already online at launch with pending events
  /// left over from a previous session/crash).
  static void start() {
    _connectivitySub?.cancel();
    _connectivitySub = ConnectivityService.onStatusChange.listen((status) {
      if (status == NetworkStatus.online) {
        runSyncPass();
      }
    });
    _periodicTimer?.cancel();
    _periodicTimer = Timer.periodic(const Duration(minutes: 2), (_) => runSyncPass());
    // Also attempt one pass immediately — covers "app restarted with
    // pending events and connectivity already available" per the
    // mission's required restart-recovery scenario. Interrupted events
    // are re-queued first so that pass can pick them up.
    unawaited(recoverThenSync());
  }

  /// Startup order: re-queue interrupted events, then run a sync pass.
  @visibleForTesting
  static Future<void> recoverThenSync() async {
    try {
      await recoverInterruptedEvents();
    } catch (_) {
      // Recovery must never stop sync; the next startup retries it.
    }
    await runSyncPass();
  }

  /// Restart recovery. At startup no upload can be in flight, so an event
  /// still marked `syncing` was interrupted mid-upload (app killed/crashed),
  /// and one still `localOnly` was interrupted between the initial insert
  /// and its syncPending update. getPendingSync() never selects either
  /// state, so without this they would be stranded forever.
  ///
  /// Both are moved to `syncPending`; nothing else changes — same eventId
  /// (the backend's clientEventId idempotency key, so a resend of an
  /// upload that did reach the server resolves to the SAME incident),
  /// same payload, retryCount, lastSyncAttempt and createdAt. Events are
  /// never deleted or duplicated. Idempotent: a second run finds nothing.
  /// Skipped while a sync pass is running, where `syncing` is legitimate.
  /// Returns the number of events re-queued.
  static Future<int> recoverInterruptedEvents() async {
    if (_running) return 0;
    var recovered = 0;
    for (final event in await loadAllEvents()) {
      if (event.syncStatus == SyncStatus.localOnly || event.syncStatus == SyncStatus.syncing) {
        event.syncStatus = SyncStatus.syncPending;
        await saveEvent(event);
        recovered += 1;
      }
    }
    return recovered;
  }

  static void stop() {
    _connectivitySub?.cancel();
    _periodicTimer?.cancel();
  }

  /// Runs one synchronization pass over all currently pending/failed
  /// events. Safe to call concurrently — a pass already in progress is
  /// not duplicated (avoids the "aggressive retry loop" the mission
  /// warns against if triggered by both a connectivity event and the
  /// periodic timer at once).
  static Future<void> runSyncPass() async {
    if (_running) return;
    if (ConnectivityService.current == NetworkStatus.offline) return; // no point trying

    _running = true;
    try {
      final pending = await loadPendingEvents();
      if (pending.isEmpty) return;

      _statusController.add('Syncing ${pending.length} report(s)…');

      int succeeded = 0;
      for (final event in pending) {
        final ok = await _syncOne(event);
        if (ok) succeeded += 1;
      }

      _statusController.add('Sync complete: $succeeded/${pending.length} synced.');
    } finally {
      _running = false;
    }
  }

  /// Attempts to sync a single event. Never throws — every failure path
  /// updates the event's SYNC_FAILED state with a real error message and
  /// returns false; the event is NEVER deleted locally on failure.
  static Future<bool> _syncOne(LocalIncidentEvent event) async {
    if (event.retryCount >= _maxRetries) {
      // Stop retrying automatically, but the event remains on-device
      // and visible as SYNC_FAILED — the field worker can still see and
      // (in a future UI) manually retry it. Never discarded.
      return false;
    }

    if (event.lastSyncAttempt != null) {
      final waitUntil = event.lastSyncAttempt!.add(backoffFor(event.retryCount));
      if (DateTime.now().isBefore(waitUntil)) return false; // not due yet — bounded backoff, not a tight loop
    }

    event.syncStatus = SyncStatus.syncing;
    await saveEvent(event);

    try {
      final result = await sendIncident(event); // clientEventId = eventId (idempotent)

      // Only mark SYNCED on an actual server confirmation (including an
      // idempotent replay of an event we already sent) — never earlier.
      event.serverIncidentId = (result['id'] ?? result['_id'])?.toString();
      event.syncStatus = SyncStatus.synced;
      event.lastSyncError = null;
      event.lastSyncAttempt = DateTime.now();
      await saveEvent(event);
      return true;
    } on ApiException catch (e) {
      event.retryCount += 1;
      event.lastSyncAttempt = DateTime.now();
      event.lastSyncError = e.message;
      // A permanent validation failure still isn't deleted — it's
      // surfaced honestly as failed, per the mission's anti-fabrication
      // rule — but it's not worth bounded-retrying forever either way,
      // since the retryCount cap above already handles that uniformly.
      event.syncStatus = SyncStatus.syncFailed;
      await saveEvent(event);
      return false;
    } catch (e) {
      event.retryCount += 1;
      event.lastSyncAttempt = DateTime.now();
      event.lastSyncError = 'Unexpected error: $e';
      event.syncStatus = SyncStatus.syncFailed;
      await saveEvent(event);
      return false;
    }
  }
}
