import 'dart:async';
import 'package:flutter/material.dart';
import 'package:uuid/uuid.dart';
import '../services/api_service.dart';
import '../services/location_service.dart';
import '../services/local_event_store.dart';
import '../services/connectivity_service.dart';
import '../services/sync_service.dart';
import '../models/local_incident_event.dart';
import '../theme/app_theme.dart';

enum _Step { form, error }

const List<Map<String, String>> _incidentTypes = [
  {'value': 'ROAD_DAMAGE', 'label': 'Road Damage'},
  {'value': 'LANDSLIDE', 'label': 'Landslide'},
  {'value': 'FLOOD', 'label': 'Flood'},
  {'value': 'ACCIDENT', 'label': 'Accident'},
  {'value': 'OTHER', 'label': 'Other'},
];

const _uuid = Uuid();

class ReportFlowScreen extends StatefulWidget {
  const ReportFlowScreen({super.key});

  @override
  State<ReportFlowScreen> createState() => _ReportFlowScreenState();
}

class _ReportFlowScreenState extends State<ReportFlowScreen> {
  _Step _step = _Step.form;

  String _type = 'ROAD_DAMAGE';
  final TextEditingController _descriptionController = TextEditingController();

  // --- Location mode state (Phase 4A) ---
  LocationMode _mode = LocationMode.liveGps;
  NerDemoLocation _selectedDemoLocation = nerDemoLocations.first;

  ResolvedLocation? _resolvedLocation;
  bool _locating = false;
  LocationException? _locationError;

  // --- Real road-match preview (Phase 4A, best-effort — only works if
  // currently online; the ACTUAL road match used for the report is
  // resolved server-side during sync, same as before) ---
  Map<String, dynamic>? _roadMatch;
  bool _matchingRoad = false;
  String? _roadMatchError;

  String? _errorMessage;

  // --- Phase 5: local-first capture + live sync status ---
  LocalIncidentEvent? _capturedEvent; // non-null once written locally — this IS "captured", regardless of sync outcome
  Timer? _statusPoll;

  @override
  void initState() {
    super.initState();
    _acquireLocation();
  }

  @override
  void dispose() {
    _statusPoll?.cancel();
    _descriptionController.dispose();
    super.dispose();
  }

  Future<void> _acquireLocation() async {
    setState(() {
      _locating = true;
      _locationError = null;
      _resolvedLocation = null;
      _roadMatch = null;
      _roadMatchError = null;
    });

    if (_mode == LocationMode.nerDemo) {
      final resolved = ResolvedLocation.demo(_selectedDemoLocation);
      if (!mounted) return;
      setState(() {
        _resolvedLocation = resolved;
        _locating = false;
      });
      _lookupNearestRoadPreview(resolved);
      return;
    }

    try {
      final fix = await LocationService.getLiveGpsFix();
      if (!mounted) return;
      final resolved = ResolvedLocation.live(fix);
      setState(() {
        _resolvedLocation = resolved;
        _locating = false;
      });
      _lookupNearestRoadPreview(resolved);
    } on LocationException catch (e) {
      if (!mounted) return;
      setState(() {
        _locationError = e;
        _locating = false;
      });
    }
  }

  /// Best-effort ONLY — used to show the field worker a road-match
  /// preview before they submit. If offline, this silently has no
  /// result (shown as "unavailable offline"), and the report is still
  /// fully capturable — road matching happens for real server-side once
  /// the event syncs (see incidentController.js, unchanged).
  Future<void> _lookupNearestRoadPreview(ResolvedLocation location) async {
    if (ConnectivityService.current == NetworkStatus.offline) return;
    setState(() {
      _matchingRoad = true;
      _roadMatchError = null;
    });
    try {
      final result = await ApiService.getNearestRoad(
        lat: location.lat,
        lng: location.lng,
        accuracyMeters: location.gpsFix?.accuracyMeters,
      );
      if (!mounted) return;
      setState(() {
        _roadMatch = result;
        _matchingRoad = false;
      });
    } on ApiException {
      if (!mounted) return;
      setState(() {
        _roadMatchError = 'Road match preview unavailable offline.';
        _matchingRoad = false;
      });
    }
  }

  void _onModeChanged(LocationMode mode) {
    if (mode == _mode) return;
    setState(() => _mode = mode);
    _acquireLocation();
  }

  void _onDemoLocationChanged(NerDemoLocation loc) {
    setState(() => _selectedDemoLocation = loc);
    _acquireLocation();
  }

  /// Phase 5 core flow: write to local storage FIRST, and only consider
  /// the report "captured" once that succeeds — never before. Network
  /// sync is attempted afterward, best-effort, and its outcome is shown
  /// live but never conflated with capture success.
  Future<void> _submit() async {
    final loc = _resolvedLocation;
    if (loc == null) return;

    final now = DateTime.now();
    final event = LocalIncidentEvent(
      eventId: _uuid.v4(),
      eventType: _type,
      createdAt: now,
      updatedAt: now,
      latitude: loc.lat,
      longitude: loc.lng,
      locationMode: loc.mode == LocationMode.liveGps ? 'LIVE_GPS' : 'NER_DEMO',
      gpsAccuracyMeters: loc.gpsFix?.accuracyMeters,
      speedMetersPerSecond: loc.gpsFix?.speedMetersPerSecond,
      headingDegrees: loc.gpsFix?.headingDegrees,
      description: _descriptionController.text.trim(),
      syncStatus: SyncStatus.localOnly,
    );

    try {
      await LocalEventStore.insert(event);
    } catch (e) {
      // The one genuinely exceptional case: local storage itself
      // failed. The report has NOT been captured — say so honestly,
      // don't pretend otherwise, and let the user retry.
      if (!mounted) return;
      setState(() {
        _errorMessage = 'Could not save your report locally: $e\n\nYour report was NOT captured. Please try again.';
        _step = _Step.error;
      });
      return;
    }

    // Local persistence succeeded — this IS "captured", independent of
    // whatever happens with sync next.
    event.syncStatus = SyncStatus.syncPending;
    await LocalEventStore.update(event);

    if (!mounted) return;
    setState(() => _capturedEvent = event);

    // Best-effort immediate sync attempt (also covered by SyncService's
    // own connectivity-triggered and periodic passes if this one can't
    // run right now, e.g. offline).
    unawaited(SyncService.runSyncPass());

    _statusPoll?.cancel();
    _statusPoll = Timer.periodic(const Duration(seconds: 1), (_) async {
      final latest = await LocalEventStore.getById(event.eventId);
      if (!mounted || latest == null) return;
      setState(() => _capturedEvent = latest);
    });
  }

  void _reset() {
    _statusPoll?.cancel();
    setState(() {
      _step = _Step.form;
      _capturedEvent = null;
      _errorMessage = null;
      _descriptionController.clear();
      _type = 'ROAD_DAMAGE';
    });
    _acquireLocation();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Report Incident', style: TextStyle(fontWeight: FontWeight.w700)),
        backgroundColor: AppColors.background,
        foregroundColor: AppColors.textPrimary,
        elevation: 0,
        surfaceTintColor: Colors.transparent,
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20.0),
          child: _capturedEvent != null
              ? _buildCapturedStep()
              : _step == _Step.error
                  ? _buildErrorStep()
                  : _buildFormStep(),
        ),
      ),
    );
  }

  Widget _buildFormStep() {
    final loc = _resolvedLocation;
    final canSubmit = loc != null && !_locating;

    return SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Incident category', style: TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          Container(
            decoration: BoxDecoration(
              color: Colors.white,
              border: Border.all(color: AppColors.border),
              borderRadius: BorderRadius.circular(AppRadius.md),
            ),
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: DropdownButtonHideUnderline(
              child: DropdownButton<String>(
                value: _type,
                isExpanded: true,
                items: _incidentTypes
                    .map((t) => DropdownMenuItem(value: t['value'], child: Text(t['label']!)))
                    .toList(),
                onChanged: (v) => setState(() => _type = v ?? _type),
              ),
            ),
          ),
          const SizedBox(height: 20),
          const Text('Description', style: TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          TextField(
            controller: _descriptionController,
            maxLines: 4,
            decoration: InputDecoration(
              hintText: 'e.g. Severe road damage, landslide blocking one lane…',
              filled: true,
              fillColor: Colors.white,
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(AppRadius.md)),
            ),
          ),
          const SizedBox(height: 20),
          _buildLocationModeSelector(),
          const SizedBox(height: 12),
          if (_mode == LocationMode.nerDemo) _buildDemoLocationDropdown(),
          if (_mode == LocationMode.nerDemo) const SizedBox(height: 12),
          _buildConnectivityBanner(),
          const SizedBox(height: 8),
          _buildLocationStatus(),
          const SizedBox(height: 12),
          _buildRoadMatchPreview(),
          const SizedBox(height: 32),
          SizedBox(
            width: double.infinity,
            height: 52,
            child: ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.primary,
                foregroundColor: Colors.white,
                elevation: 0,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.md)),
              ),
              onPressed: canSubmit ? _submit : null,
              child: const Text('Capture Report', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            'Your report is saved on this device immediately, even offline, and sent to the server automatically once connected.',
            style: TextStyle(fontSize: 11, color: AppColors.textMuted),
          ),
        ],
      ),
    );
  }

  Widget _buildConnectivityBanner() {
    return StreamBuilder<NetworkStatus>(
      stream: ConnectivityService.onStatusChange,
      initialData: ConnectivityService.current,
      builder: (context, snapshot) {
        final status = snapshot.data ?? NetworkStatus.unknown;
        final (label, color) = switch (status) {
          NetworkStatus.online => ('Online — reports sync immediately', AppColors.success),
          NetworkStatus.offline => ('Offline — reports will be captured and synced later', AppColors.warning),
          NetworkStatus.unknown => ('Connectivity unknown', AppColors.neutral),
        };
        return Row(
          children: [
            Icon(Icons.circle, size: 8, color: color),
            const SizedBox(width: 6),
            Text(label, style: TextStyle(fontSize: 12, color: color)),
          ],
        );
      },
    );
  }

  Widget _buildLocationModeSelector() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Location mode', style: TextStyle(fontWeight: FontWeight.w600)),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: _ModeButton(
                label: 'LIVE GPS',
                icon: Icons.gps_fixed,
                selected: _mode == LocationMode.liveGps,
                onTap: () => _onModeChanged(LocationMode.liveGps),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _ModeButton(
                label: 'NER DEMO',
                icon: Icons.map_outlined,
                selected: _mode == LocationMode.nerDemo,
                onTap: () => _onModeChanged(LocationMode.nerDemo),
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildDemoLocationDropdown() {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: AppColors.border),
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 12),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<NerDemoLocation>(
          value: _selectedDemoLocation,
          isExpanded: true,
          items: nerDemoLocations
              .map((loc) => DropdownMenuItem(value: loc, child: Text('${loc.name}, ${loc.state}')))
              .toList(),
          onChanged: (v) {
            if (v != null) _onDemoLocationChanged(v);
          },
        ),
      ),
    );
  }

  Widget _buildLocationStatus() {
    if (_locating) {
      return Row(
        children: const [
          SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)),
          SizedBox(width: 10),
          Text('Getting location…'),
        ],
      );
    }

    if (_locationError != null) {
      return Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: const Color(0xFFFEF0F0),
          border: Border.all(color: AppColors.danger.withOpacity(0.3)),
          borderRadius: BorderRadius.circular(AppRadius.md),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.error_outline, size: 18, color: AppColors.danger),
                const SizedBox(width: 8),
                const Expanded(child: Text('Location error', style: TextStyle(fontWeight: FontWeight.w600))),
              ],
            ),
            const SizedBox(height: 6),
            Text(_locationError!.message, style: const TextStyle(fontSize: 13)),
            const SizedBox(height: 10),
            OutlinedButton(onPressed: _acquireLocation, child: const Text('Retry Live GPS')),
          ],
        ),
      );
    }

    final loc = _resolvedLocation;
    if (loc == null) return const SizedBox.shrink();

    final isLive = loc.mode == LocationMode.liveGps;
    final tier = loc.gpsFix?.qualityTier;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: AppColors.border),
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(isLive ? Icons.gps_fixed : Icons.map, size: 16, color: isLive ? AppColors.success : AppColors.primary),
              const SizedBox(width: 6),
              Text(
                isLive ? 'LIVE GPS' : 'NER DEMO',
                style: TextStyle(
                  fontWeight: FontWeight.bold,
                  fontSize: 12,
                  color: isLive ? AppColors.success : AppColors.primary,
                ),
              ),
              if (!isLive) ...[
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    '· ${loc.demoLocation!.name}, ${loc.demoLocation!.state}',
                    style: const TextStyle(fontSize: 12),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ],
          ),
          const SizedBox(height: 6),
          Text('${loc.lat.toStringAsFixed(5)}, ${loc.lng.toStringAsFixed(5)}', style: const TextStyle(fontSize: 13)),
          if (isLive) ...[
            const SizedBox(height: 4),
            Text(
              loc.gpsFix?.accuracyMeters != null
                  ? 'Accuracy: ${loc.gpsFix!.accuracyMeters!.toStringAsFixed(0)} m (${_tierLabel(tier)})'
                  : 'Accuracy: unavailable',
              style: TextStyle(fontSize: 12, color: _tierColor(tier)),
            ),
            if (loc.gpsFix?.speedMetersPerSecond != null)
              Text('Speed: ${loc.gpsFix!.speedMetersPerSecond!.toStringAsFixed(1)} m/s', style: const TextStyle(fontSize: 12)),
            if (loc.gpsFix?.headingDegrees != null)
              Text('Heading: ${loc.gpsFix!.headingDegrees!.toStringAsFixed(0)}°', style: const TextStyle(fontSize: 12)),
          ],
        ],
      ),
    );
  }

  Widget _buildRoadMatchPreview() {
    if (ConnectivityService.current == NetworkStatus.offline) {
      return const Text(
        'Nearest-road preview unavailable offline — road matching happens automatically once your report syncs.',
        style: TextStyle(fontSize: 12, color: AppColors.textMuted, fontStyle: FontStyle.italic),
      );
    }
    if (_matchingRoad) {
      return Row(
        children: const [
          SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2)),
          SizedBox(width: 10),
          Text('Matching nearest road…', style: TextStyle(fontSize: 13)),
        ],
      );
    }
    if (_roadMatchError != null) {
      return Text(_roadMatchError!, style: const TextStyle(fontSize: 12, color: AppColors.textMuted));
    }
    final match = _roadMatch;
    if (match == null) return const SizedBox.shrink();
    if (match['matched'] != true) {
      return Text(
        match['message']?.toString() ?? 'No nearby road found.',
        style: const TextStyle(fontSize: 12, color: AppColors.textMuted),
      );
    }
    final road = match['road'] as Map<String, dynamic>?;
    return Text(
      'Nearest road: ${road?['name'] ?? 'Unknown'} (${match['distanceMeters']}m, ${match['confidence']} confidence)',
      style: const TextStyle(fontSize: 12, color: AppColors.textSecondary),
    );
  }

  Widget _buildCapturedStep() {
    final event = _capturedEvent!;
    return SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.check_circle, color: AppColors.success, size: 28),
              SizedBox(width: 10),
              Text('Report Captured', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
            ],
          ),
          const SizedBox(height: 6),
          const Text(
            'Saved on this device. This is true whether or not it has reached the server yet.',
            style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
          ),
          const SizedBox(height: 20),
          _resultCard([
            _resultRow('Event ID', event.eventId.substring(0, 8)),
            _resultRow('Category', event.eventType),
            _resultRow('Location mode', event.locationMode == 'LIVE_GPS' ? 'LIVE GPS' : 'NER DEMO'),
            _resultRow('Coordinates', '${event.latitude.toStringAsFixed(5)}, ${event.longitude.toStringAsFixed(5)}'),
          ]),
          const SizedBox(height: 16),
          _buildSyncStatusCard(event),
          const SizedBox(height: 32),
          SizedBox(
            width: double.infinity,
            height: 52,
            child: OutlinedButton(onPressed: _reset, child: const Text('Report Another Incident')),
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            height: 52,
            child: ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: AppColors.textPrimary, foregroundColor: Colors.white, elevation: 0),
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Back to Home'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSyncStatusCard(LocalIncidentEvent event) {
    final (label, color, icon) = switch (event.syncStatus) {
      SyncStatus.localOnly => ('Captured locally — preparing to sync', AppColors.neutral, Icons.save),
      SyncStatus.syncPending => ('Sync pending', AppColors.warning, Icons.hourglass_bottom),
      SyncStatus.syncing => ('Syncing to server…', AppColors.primary, Icons.sync),
      SyncStatus.synced => ('Synced to server ✓', AppColors.success, Icons.cloud_done),
      SyncStatus.syncFailed => ('Sync failed — retained on device, will retry', AppColors.danger, Icons.cloud_off),
    };

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: color.withOpacity(0.08),
        border: Border.all(color: color.withOpacity(0.3)),
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 18, color: color),
              const SizedBox(width: 8),
              Expanded(child: Text(label, style: TextStyle(fontWeight: FontWeight.w600, color: color))),
            ],
          ),
          if (event.syncStatus == SyncStatus.synced && event.serverIncidentId != null) ...[
            const SizedBox(height: 6),
            Text('Server incident ID: ${event.serverIncidentId}', style: const TextStyle(fontSize: 12)),
          ],
          if (event.syncStatus == SyncStatus.syncFailed) ...[
            const SizedBox(height: 6),
            Text('Attempts: ${event.retryCount}', style: const TextStyle(fontSize: 12)),
            if (event.lastSyncError != null)
              Text(event.lastSyncError!, style: const TextStyle(fontSize: 11, color: AppColors.textSecondary)),
          ],
        ],
      ),
    );
  }

  String _tierLabel(GpsQualityTier? tier) {
    switch (tier) {
      case GpsQualityTier.high:
        return 'high';
      case GpsQualityTier.medium:
        return 'medium';
      case GpsQualityTier.low:
        return 'low';
      default:
        return 'unknown';
    }
  }

  Color _tierColor(GpsQualityTier? tier) {
    switch (tier) {
      case GpsQualityTier.high:
        return AppColors.success;
      case GpsQualityTier.medium:
        return AppColors.warning;
      case GpsQualityTier.low:
        return AppColors.danger;
      default:
        return AppColors.textSecondary;
    }
  }

  Widget _buildErrorStep() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.error_outline, color: AppColors.danger, size: 40),
          const SizedBox(height: 16),
          Text(_errorMessage ?? 'Something went wrong.', textAlign: TextAlign.center, style: const TextStyle(fontSize: 15)),
          const SizedBox(height: 24),
          ElevatedButton(onPressed: () => setState(() => _step = _Step.form), child: const Text('Try Again')),
        ],
      ),
    );
  }

  Widget _resultCard(List<Widget> rows) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(children: rows),
    );
  }

  Widget _resultRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(color: AppColors.textSecondary)),
          Flexible(child: Text(value, textAlign: TextAlign.right, style: const TextStyle(fontWeight: FontWeight.w600))),
        ],
      ),
    );
  }
}

class _ModeButton extends StatelessWidget {
  final String label;
  final IconData icon;
  final bool selected;
  final VoidCallback onTap;

  const _ModeButton({required this.label, required this.icon, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppRadius.md),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: BoxDecoration(
          color: selected ? AppColors.primary : Colors.white,
          border: Border.all(color: selected ? AppColors.primary : AppColors.border),
          borderRadius: BorderRadius.circular(AppRadius.md),
        ),
        child: Column(
          children: [
            Icon(icon, size: 18, color: selected ? Colors.white : AppColors.textSecondary),
            const SizedBox(height: 4),
            Text(label, style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: selected ? Colors.white : AppColors.textSecondary)),
          ],
        ),
      ),
    );
  }
}
