import 'dart:async';
import 'package:flutter/material.dart';
import 'report_flow_screen.dart';
import '../services/api_service.dart';
import '../services/location_service.dart';
import '../services/connectivity_service.dart';
import '../services/sync_service.dart';
import '../services/local_event_store.dart';
import '../models/local_incident_event.dart';
import '../theme/app_theme.dart';

const _alertRefreshInterval = Duration(seconds: 30);

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  // Reuses Phase 4A's explicit modes exactly — LIVE GPS is the real
  // device location, NER DEMO is an explicitly selected location. No
  // special-case Mumbai logic: a LIVE GPS fix taken in Mumbai simply
  // won't snap to any NER road (see locationMatchService's 20km
  // threshold), so no alert is shown — that's the correct, honest
  // outcome, not something this screen needs to special-case.
  LocationMode _mode = LocationMode.liveGps;
  NerDemoLocation _selectedDemoLocation = nerDemoLocations.first;

  double? _gpsAccuracyMeters; // LIVE GPS only — never fabricated for NER DEMO

  String? _matchedRoadId;
  String? _matchedRoadName;
  List<Map<String, dynamic>> _alerts = [];
  bool _loading = false;
  String? _error;

  // Operational accessibility — a SEPARATE evidence-driven system from
  // road-match/alerts. Fetched from the EXISTING GET
  // /api/roads/:id/accessibility endpoint (same one the dashboard uses).
  // `state` is rendered exactly as the API returns it — never invented.
  Map<String, dynamic>? _accessibility;
  bool _accessibilityLoading = false;

  Timer? _refreshTimer;

  // --- Sync/offline status (Phase 5 store-and-forward, read-only here) ---
  int _pendingCount = 0;
  int _syncedCount = 0;
  int _failedCount = 0;
  DateTime? _lastSyncAt;
  NetworkStatus _connectivity = ConnectivityService.current;
  StreamSubscription<NetworkStatus>? _connectivitySub;
  StreamSubscription<String>? _syncStatusSub;

  @override
  void initState() {
    super.initState();
    _refresh();
    _loadSyncSummary();
    _refreshTimer = Timer.periodic(_alertRefreshInterval, (_) => _refresh());
    _connectivitySub = ConnectivityService.onStatusChange.listen((status) {
      if (!mounted) return;
      setState(() => _connectivity = status);
    });
    // A sync pass completing (success or failure) is exactly when the
    // pending/synced/failed counts below may have changed.
    _syncStatusSub = SyncService.statusStream.listen((_) => _loadSyncSummary());
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    _connectivitySub?.cancel();
    _syncStatusSub?.cancel();
    super.dispose();
  }

  /// Reads local, on-device sync state only — no network call. Reflects
  /// exactly what LocalEventStore/SyncService already track; nothing here
  /// is invented or estimated. Never throws: a local-storage read failure
  /// (e.g. no platform DB channel available) must not crash the home
  /// screen — the sync section simply stays at its honest zero state.
  Future<void> _loadSyncSummary() async {
    List<LocalIncidentEvent> events;
    try {
      events = await LocalEventStore.getAll();
    } catch (_) {
      return;
    }
    if (!mounted) return;
    int pending = 0;
    int synced = 0;
    int failed = 0;
    DateTime? lastSync;
    for (final e in events) {
      switch (e.syncStatus) {
        case SyncStatus.localOnly:
        case SyncStatus.syncPending:
        case SyncStatus.syncing:
          pending += 1;
          break;
        case SyncStatus.synced:
          synced += 1;
          break;
        case SyncStatus.syncFailed:
          failed += 1;
          break;
      }
      if (e.lastSyncAttempt != null && (lastSync == null || e.lastSyncAttempt!.isAfter(lastSync))) {
        lastSync = e.lastSyncAttempt;
      }
    }
    setState(() {
      _pendingCount = pending;
      _syncedCount = synced;
      _failedCount = failed;
      _lastSyncAt = lastSync;
    });
  }

  Future<void> _refresh() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    double lat;
    double lng;

    if (_mode == LocationMode.nerDemo) {
      lat = _selectedDemoLocation.lat;
      lng = _selectedDemoLocation.lng;
      _gpsAccuracyMeters = null;
    } else {
      try {
        final fix = await LocationService.getLiveGpsFix();
        lat = fix.lat;
        lng = fix.lng;
        _gpsAccuracyMeters = fix.accuracyMeters;
      } on LocationException catch (e) {
        if (!mounted) return;
        setState(() {
          _loading = false;
          _error = e.message;
          _matchedRoadId = null;
          _alerts = [];
          _accessibility = null;
        });
        return;
      }
    }

    try {
      final match = await ApiService.getNearestRoad(lat: lat, lng: lng);
      if (match['matched'] != true) {
        if (!mounted) return;
        setState(() {
          _matchedRoadId = null;
          _matchedRoadName = null;
          _alerts = [];
          _accessibility = null;
          _loading = false;
        });
        return;
      }
      final road = match['road'] as Map<String, dynamic>?;
      final roadId = road?['id']?.toString();
      if (roadId == null) {
        if (!mounted) return;
        setState(() {
          _matchedRoadId = null;
          _alerts = [];
          _accessibility = null;
          _loading = false;
        });
        return;
      }

      final alerts = await ApiService.getAlertsForRoad(roadId);
      if (!mounted) return;
      setState(() {
        _matchedRoadId = roadId;
        _matchedRoadName = road?['name']?.toString();
        _alerts = alerts;
        _loading = false;
      });
      _refreshAccessibility(roadId);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e.message;
        _alerts = [];
        _accessibility = null;
      });
    }
  }

  /// Separate from `_refresh()`'s try/catch so an accessibility-lookup
  /// failure never blocks alerts/road-match from showing — this section
  /// simply shows its own honest UNKNOWN/unavailable state instead.
  Future<void> _refreshAccessibility(String roadId) async {
    setState(() => _accessibilityLoading = true);
    try {
      final result = await ApiService.getRoadAccessibility(roadId);
      if (!mounted) return;
      setState(() {
        _accessibility = result;
        _accessibilityLoading = false;
      });
    } on ApiException {
      if (!mounted) return;
      setState(() {
        _accessibility = null;
        _accessibilityLoading = false;
      });
    }
  }

  void _onModeChanged(LocationMode mode) {
    if (mode == _mode) return;
    setState(() => _mode = mode);
    _refresh();
  }

  void _onDemoLocationChanged(NerDemoLocation loc) {
    setState(() => _selectedDemoLocation = loc);
    _refresh();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        // A scrollable column, not Spacer()-based, so the layout never
        // depends on empty elastic space and never overflows regardless
        // of how many alerts are active or how small the screen is.
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildTopBar(),
              const SizedBox(height: AppSpacing.lg),
              _sectionLabel('LOCATION'),
              const SizedBox(height: AppSpacing.sm),
              _buildLocationCard(),
              const SizedBox(height: AppSpacing.lg),
              _sectionLabel('ROAD STATUS'),
              const SizedBox(height: AppSpacing.sm),
              _buildRoadStatusCard(),
              const SizedBox(height: AppSpacing.lg),
              _buildAlertsSectionHeader(),
              const SizedBox(height: AppSpacing.sm),
              _buildAlertsSection(),
              const SizedBox(height: AppSpacing.xl),
              _buildReportButton(context),
              const SizedBox(height: AppSpacing.lg),
              _sectionLabel('SYNC STATUS'),
              const SizedBox(height: AppSpacing.sm),
              _buildSyncStatusCard(),
              const SizedBox(height: AppSpacing.lg),
              Center(
                child: Text(
                  'Prototype demo — NOT connected to a live government feed',
                  style: TextStyle(color: AppColors.textMuted, fontSize: 11),
                  textAlign: TextAlign.center,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // --- 1. TOP APP BAR ---

  Widget _buildTopBar() {
    final online = _connectivity == NetworkStatus.online;
    final unknown = _connectivity == NetworkStatus.unknown;
    final dotColor = unknown ? AppColors.neutral : (online ? AppColors.success : AppColors.warning);
    final label = unknown ? 'Checking…' : (online ? 'Online' : 'Offline');

    return Row(
      children: [
        Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(
            color: AppColors.primary,
            borderRadius: BorderRadius.circular(AppRadius.md),
          ),
          child: const Icon(Icons.alt_route, color: Colors.white, size: 22),
        ),
        const SizedBox(width: 12),
        const Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'NER SMART',
                style: TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 20,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 0.1,
                ),
              ),
              Text(
                'Driver Assistant',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 12.5, fontWeight: FontWeight.w500),
              ),
            ],
          ),
        ),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(999),
            border: Border.all(color: AppColors.border),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(width: 8, height: 8, decoration: BoxDecoration(color: dotColor, shape: BoxShape.circle)),
              const SizedBox(width: 6),
              Text(label, style: const TextStyle(color: AppColors.textSecondary, fontSize: 11.5, fontWeight: FontWeight.w600)),
            ],
          ),
        ),
      ],
    );
  }

  // --- 2. LOCATION / OPERATIONAL CONTEXT ---

  Widget _sectionLabel(String text) {
    return Text(
      text,
      style: const TextStyle(
        color: AppColors.textMuted,
        fontSize: 11,
        fontWeight: FontWeight.w700,
        letterSpacing: 1.1,
      ),
    );
  }

  Widget _buildLocationCard() {
    return _surfaceCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildModeRow(),
          const SizedBox(height: 12),
          _buildRoadContextLine(),
        ],
      ),
    );
  }

  Widget _buildModeRow() {
    return Row(
      children: [
        _modeChip('LIVE GPS', LocationMode.liveGps, Icons.gps_fixed),
        const SizedBox(width: 8),
        _modeChip('NER DEMO', LocationMode.nerDemo, Icons.map_outlined),
        if (_mode == LocationMode.nerDemo) ...[
          const SizedBox(width: 8),
          Expanded(
            child: Container(
              height: 40,
              padding: const EdgeInsets.symmetric(horizontal: 10),
              decoration: BoxDecoration(
                color: Colors.white,
                border: Border.all(color: AppColors.border),
                borderRadius: BorderRadius.circular(AppRadius.sm),
              ),
              child: DropdownButtonHideUnderline(
                child: DropdownButton<NerDemoLocation>(
                  value: _selectedDemoLocation,
                  isExpanded: true,
                  dropdownColor: Colors.white,
                  style: const TextStyle(color: AppColors.textPrimary, fontSize: 12),
                  items: nerDemoLocations
                      .map((loc) => DropdownMenuItem(value: loc, child: Text(loc.name, overflow: TextOverflow.ellipsis)))
                      .toList(),
                  onChanged: (v) {
                    if (v != null) _onDemoLocationChanged(v);
                  },
                ),
              ),
            ),
          ),
        ],
      ],
    );
  }

  Widget _modeChip(String label, LocationMode mode, IconData icon) {
    final selected = _mode == mode;
    return InkWell(
      onTap: () => _onModeChanged(mode),
      borderRadius: BorderRadius.circular(AppRadius.sm),
      child: Container(
        height: 40,
        padding: const EdgeInsets.symmetric(horizontal: 14),
        decoration: BoxDecoration(
          color: selected ? AppColors.primary : Colors.white,
          border: Border.all(color: selected ? AppColors.primary : AppColors.border),
          borderRadius: BorderRadius.circular(AppRadius.sm),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 14, color: selected ? Colors.white : AppColors.textSecondary),
            const SizedBox(width: 6),
            Text(
              label,
              style: TextStyle(
                color: selected ? Colors.white : AppColors.textSecondary,
                fontSize: 12,
                fontWeight: selected ? FontWeight.bold : FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Compact, always-visible line showing what road (if any) the current
  /// mode/location resolved to, plus GPS accuracy when LIVE GPS provided
  /// one — separate from the alert/status cards below, so operational
  /// context is legible even while those are still loading or empty.
  Widget _buildRoadContextLine() {
    if (_loading) {
      return Row(
        children: [
          const SizedBox(
            width: 12,
            height: 12,
            child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.textMuted),
          ),
          const SizedBox(width: 8),
          const Text('Resolving location…', style: TextStyle(color: AppColors.textSecondary, fontSize: 12.5)),
        ],
      );
    }
    if (_error != null) return const SizedBox.shrink(); // full error already shown in the status card below

    final accuracyLabel = _mode == LocationMode.liveGps && _gpsAccuracyMeters != null
        ? ' · accuracy ${_gpsAccuracyMeters!.toStringAsFixed(0)}m'
        : '';

    if (_matchedRoadName != null) {
      return Row(
        children: [
          const Icon(Icons.signpost_outlined, size: 15, color: AppColors.textMuted),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              '$_matchedRoadName$accuracyLabel',
              style: const TextStyle(color: AppColors.textPrimary, fontSize: 13, fontWeight: FontWeight.w600),
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      );
    }
    return Text(
      'No nearby road matched for the current location.$accuracyLabel',
      style: const TextStyle(color: AppColors.textSecondary, fontSize: 12.5),
    );
  }

  // --- 3. ROAD STATUS ---

  Widget _buildRoadStatusCard() {
    if (_error != null) {
      return _surfaceCard(
        borderColor: AppColors.danger.withOpacity(0.3),
        backgroundColor: const Color(0xFFFEF0F0),
        child: Row(
          children: [
            const Icon(Icons.error_outline, color: AppColors.danger, size: 20),
            const SizedBox(width: 10),
            Expanded(child: Text(_error!, style: const TextStyle(color: AppColors.textPrimary, fontSize: 13))),
          ],
        ),
      );
    }

    if (_matchedRoadId == null) {
      return _surfaceCard(
        child: const Text(
          'No nearby road matched — no operational status to show.',
          style: TextStyle(color: AppColors.textSecondary, fontSize: 13),
        ),
      );
    }

    if (_accessibilityLoading && _accessibility == null) {
      return _surfaceCard(
        child: Row(
          children: const [
            SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.textMuted)),
            SizedBox(width: 10),
            Text('Checking road status…', style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
          ],
        ),
      );
    }

    // Display exactly what the accessibility API provided — never
    // invented, never substituted for road-match/alert status.
    final state = _accessibility?['state'] as String?;
    final meta = statusMetaFor(state);

    return _surfaceCard(
      backgroundColor: meta.surfaceColor,
      borderColor: meta.color.withOpacity(0.35),
      child: Row(
        children: [
          Icon(meta.icon, color: meta.color, size: 26),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  meta.label,
                  style: TextStyle(color: meta.color, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 0.2),
                ),
                const SizedBox(height: 2),
                Text(
                  meta.subtitle,
                  style: const TextStyle(color: AppColors.textSecondary, fontSize: 12.5),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // --- 4. ACTIVE ALERTS ---

  /// OPERATIONAL ALERTS label plus a small manual refresh affordance.
  /// Calls the EXISTING `_refresh()` — no new fetch logic. The 30s
  /// periodic timer already keeps this current, but after a demo reset
  /// (triggered from the dashboard) a presenter shouldn't have to wait
  /// up to 30s for the driver app to catch up.
  Widget _buildAlertsSectionHeader() {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        _sectionLabel('ACTIVE ALERTS'),
        InkWell(
          onTap: _loading ? null : _refresh,
          borderRadius: BorderRadius.circular(8),
          child: Padding(
            padding: const EdgeInsets.all(4),
            child: Icon(
              Icons.refresh,
              size: 17,
              color: _loading ? AppColors.textMuted.withOpacity(0.5) : AppColors.textSecondary,
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildAlertsSection() {
    if (_loading && _alerts.isEmpty && _error == null) {
      return _surfaceCard(
        child: Row(
          children: const [
            SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.textMuted)),
            SizedBox(width: 10),
            Text('Checking for alerts…', style: TextStyle(color: AppColors.textSecondary, fontSize: 12.5)),
          ],
        ),
      );
    }

    if (_error != null) {
      return const SizedBox.shrink(); // already surfaced above in the road status card
    }

    if (_matchedRoadId == null) {
      return _surfaceCard(
        child: const Text(
          'No nearby road matched for the current location — no operational alerts to show.',
          style: TextStyle(color: AppColors.textSecondary, fontSize: 12.5),
        ),
      );
    }

    if (_alerts.isEmpty) {
      return _surfaceCard(
        child: Row(
          children: [
            const Icon(Icons.check_circle_outline, color: AppColors.success, size: 18),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                'No active operational alerts for ${_matchedRoadName ?? "the matched road"}.',
                style: const TextStyle(color: AppColors.textSecondary, fontSize: 12.5),
              ),
            ),
          ],
        ),
      );
    }

    // Every field below comes directly from the backend Alert object —
    // nothing here is hardcoded. This is the most visually prominent
    // dynamic section on the screen, per design intent.
    return Column(
      children: _alerts.map((alert) {
        final message = alert['message']?.toString() ?? '';
        final severity = alert['severity']?.toString();
        final type = alert['type']?.toString();
        final source = alert['source']?.toString();
        final timestamp = alert['generatedAt'] ?? alert['timestamp'];

        final severityColor = switch (severity) {
          'HIGH' => AppColors.danger,
          'MEDIUM' => AppColors.warning,
          'LOW' => AppColors.success,
          _ => AppColors.neutral,
        };

        return Container(
          margin: const EdgeInsets.only(bottom: 10),
          width: double.infinity,
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(AppRadius.md),
            border: Border.all(color: AppColors.border),
            boxShadow: [
              BoxShadow(color: Colors.black.withOpacity(0.03), blurRadius: 6, offset: const Offset(0, 2)),
            ],
          ),
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Container(width: 4, decoration: BoxDecoration(color: severityColor, borderRadius: BorderRadius.circular(2))),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Icon(Icons.warning_amber_rounded, color: severityColor, size: 16),
                          const SizedBox(width: 6),
                          Text(
                            type ?? 'OPERATIONAL ALERT',
                            style: TextStyle(color: severityColor, fontSize: 11, fontWeight: FontWeight.w800, letterSpacing: 0.5),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Text(message, style: const TextStyle(color: AppColors.textPrimary, fontSize: 14, fontWeight: FontWeight.w600, height: 1.3)),
                      if (_matchedRoadName != null) ...[
                        const SizedBox(height: 3),
                        Text(_matchedRoadName!, style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                      ],
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 12,
                        runSpacing: 4,
                        children: [
                          if (severity != null) _metaChip('Severity: $severity', severityColor),
                          if (source != null) _metaChip('Source: $source', AppColors.textSecondary),
                        ],
                      ),
                      if (timestamp != null) ...[
                        const SizedBox(height: 6),
                        Text('Updated: $timestamp', style: const TextStyle(color: AppColors.textMuted, fontSize: 10.5)),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
        );
      }).toList(),
    );
  }

  Widget _metaChip(String text, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(text, style: TextStyle(color: color, fontSize: 10.5, fontWeight: FontWeight.w600)),
    );
  }

  // --- 5. PRIMARY ACTION ---

  Widget _buildReportButton(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      height: 58,
      child: ElevatedButton.icon(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.primary,
          foregroundColor: Colors.white,
          elevation: 0,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.md)),
        ),
        icon: const Icon(Icons.report_problem_outlined, size: 22),
        label: const Text(
          'REPORT INCIDENT',
          style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, letterSpacing: 0.4),
        ),
        onPressed: () {
          Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => const ReportFlowScreen()),
          );
        },
      ),
    );
  }

  // --- 6. RECENT/SYNC STATUS ---

  Widget _buildSyncStatusCard() {
    final offline = _connectivity == NetworkStatus.offline;
    return _surfaceCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: _syncStat('Pending', _pendingCount, AppColors.warning)),
              Expanded(child: _syncStat('Synced', _syncedCount, AppColors.success)),
              Expanded(child: _syncStat('Failed', _failedCount, AppColors.danger)),
            ],
          ),
          const SizedBox(height: 12),
          Container(height: 1, color: AppColors.border),
          const SizedBox(height: 12),
          Row(
            children: [
              Icon(offline ? Icons.cloud_off : Icons.cloud_done_outlined, size: 15, color: AppColors.textSecondary),
              const SizedBox(width: 6),
              // Expanded (not a fixed-width Text + Spacer) so this label
              // truncates instead of pushing the row past the available
              // width — "Offline — reports are queued on this device" is
              // long enough to overflow narrower emulator/phone widths
              // once paired with the last-sync label below.
              Expanded(
                child: Text(
                  offline ? 'Offline — reports are queued on this device' : 'Online',
                  style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
                  overflow: TextOverflow.ellipsis,
                  maxLines: 1,
                ),
              ),
              const SizedBox(width: 8),
              Text(
                _lastSyncAt != null ? 'Last sync: ${_formatTime(_lastSyncAt!)}' : 'No sync attempts yet',
                style: const TextStyle(color: AppColors.textMuted, fontSize: 11.5),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _syncStat(String label, int value, Color color) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('$value', style: TextStyle(color: color, fontSize: 22, fontWeight: FontWeight.bold)),
        Text(label, style: const TextStyle(color: AppColors.textSecondary, fontSize: 11.5, fontWeight: FontWeight.w600)),
      ],
    );
  }

  String _formatTime(DateTime dt) {
    final local = dt.toLocal();
    final h = local.hour.toString().padLeft(2, '0');
    final m = local.minute.toString().padLeft(2, '0');
    return '$h:$m';
  }

  // --- shared surface card ---

  Widget _surfaceCard({required Widget child, Color? backgroundColor, Color? borderColor}) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: backgroundColor ?? AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: borderColor ?? AppColors.border),
      ),
      child: child,
    );
  }
}
