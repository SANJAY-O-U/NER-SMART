import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../services/location_service.dart';

enum _Step { form, processing, result, error }

const List<Map<String, String>> _incidentTypes = [
  {'value': 'ROAD_DAMAGE', 'label': 'Road Damage'},
  {'value': 'LANDSLIDE', 'label': 'Landslide'},
  {'value': 'FLOOD', 'label': 'Flood'},
  {'value': 'ACCIDENT', 'label': 'Accident'},
  {'value': 'OTHER', 'label': 'Other'},
];

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

  // --- Real road-match result (Phase 4A) ---
  Map<String, dynamic>? _roadMatch;
  bool _matchingRoad = false;
  String? _roadMatchError;

  String _processingLabel = 'Submitting report…';
  Map<String, dynamic>? _result;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _acquireLocation();
  }

  /// Acquires location for whichever mode is currently selected. In LIVE
  /// GPS mode this may fail — per Phase 4A there is NO silent fallback
  /// to demo data; the failure is shown and the user must retry or
  /// explicitly switch modes themselves.
  Future<void> _acquireLocation() async {
    setState(() {
      _locating = true;
      _locationError = null;
      _resolvedLocation = null;
      _roadMatch = null;
      _roadMatchError = null;
    });

    if (_mode == LocationMode.nerDemo) {
      // NER DEMO: deterministic, no device GPS involved at all.
      final resolved = ResolvedLocation.demo(_selectedDemoLocation);
      if (!mounted) return;
      setState(() {
        _resolvedLocation = resolved;
        _locating = false;
      });
      _lookupNearestRoad(resolved);
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
      _lookupNearestRoad(resolved);
    } on LocationException catch (e) {
      if (!mounted) return;
      setState(() {
        _locationError = e;
        _locating = false;
      });
    }
  }

  /// Calls the SAME backend road-matching API regardless of mode — only
  /// the source of the coordinates differs (live GPS vs a chosen NER
  /// demo location). Never a separate/fake matching algorithm.
  Future<void> _lookupNearestRoad(ResolvedLocation location) async {
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
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _roadMatchError = e.message; // backend/network error — distinct from "no road nearby"
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

  Future<void> _submit() async {
    final loc = _resolvedLocation;
    if (loc == null) return;

    setState(() {
      _step = _Step.processing;
      _processingLabel = 'Report submitted…';
    });

    // Short staged messages so the officer/judge sees the pipeline stages
    // (this is UI pacing only — the real work is the single API call below).
    await Future.delayed(const Duration(milliseconds: 500));
    if (!mounted) return;
    setState(() => _processingLabel = 'AI analysing…');

    try {
      final result = await ApiService.reportIncident(
        type: _type,
        lat: loc.lat,
        lng: loc.lng,
        description: _descriptionController.text.trim(),
        locationMode: loc.mode == LocationMode.liveGps ? 'LIVE_GPS' : 'NER_DEMO',
        gpsAccuracyMeters: loc.gpsFix?.accuracyMeters,
      );

      await Future.delayed(const Duration(milliseconds: 400));
      if (!mounted) return;
      setState(() => _processingLabel = 'Incident detected');
      await Future.delayed(const Duration(milliseconds: 400));

      if (!mounted) return;
      setState(() {
        _result = result;
        _step = _Step.result;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _errorMessage = e.toString();
        _step = _Step.error;
      });
    }
  }

  void _reset() {
    setState(() {
      _step = _Step.form;
      _result = null;
      _errorMessage = null;
      _descriptionController.clear();
      _type = 'ROAD_DAMAGE';
    });
    _acquireLocation();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F7FA),
      appBar: AppBar(
        title: const Text('Report Incident'),
        backgroundColor: const Color(0xFF0F2942),
        foregroundColor: Colors.white,
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20.0),
          child: _buildStep(),
        ),
      ),
    );
  }

  Widget _buildStep() {
    switch (_step) {
      case _Step.form:
        return _buildFormStep();
      case _Step.processing:
        return _buildProcessingStep();
      case _Step.result:
        return _buildResultStep();
      case _Step.error:
        return _buildErrorStep();
    }
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
              border: Border.all(color: Colors.grey.shade300),
              borderRadius: BorderRadius.circular(10),
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
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
            ),
          ),
          const SizedBox(height: 20),
          _buildLocationModeSelector(),
          const SizedBox(height: 12),
          if (_mode == LocationMode.nerDemo) _buildDemoLocationDropdown(),
          if (_mode == LocationMode.nerDemo) const SizedBox(height: 12),
          _buildLocationStatus(),
          const SizedBox(height: 12),
          _buildRoadMatchStatus(),
          const SizedBox(height: 32),
          SizedBox(
            width: double.infinity,
            height: 52,
            child: ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFEF7B26),
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
              onPressed: canSubmit ? _submit : null,
              child: const Text('Submit Report', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
            ),
          ),
        ],
      ),
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
        border: Border.all(color: Colors.grey.shade300),
        borderRadius: BorderRadius.circular(10),
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
          color: Colors.red.shade50,
          border: Border.all(color: Colors.red.shade200),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.error_outline, size: 18, color: Colors.red.shade700),
                const SizedBox(width: 8),
                const Expanded(child: Text('Location error', style: TextStyle(fontWeight: FontWeight.w600))),
              ],
            ),
            const SizedBox(height: 6),
            Text(_locationError!.message, style: const TextStyle(fontSize: 13)),
            const SizedBox(height: 10),
            OutlinedButton(
              onPressed: _acquireLocation,
              child: const Text('Retry Live GPS'),
            ),
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
        border: Border.all(color: Colors.grey.shade300),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(isLive ? Icons.gps_fixed : Icons.map, size: 16, color: isLive ? Colors.green : Colors.purple),
              const SizedBox(width: 6),
              Text(
                isLive ? 'LIVE GPS' : 'NER DEMO',
                style: TextStyle(
                  fontWeight: FontWeight.bold,
                  fontSize: 12,
                  color: isLive ? Colors.green.shade700 : Colors.purple.shade700,
                ),
              ),
              if (!isLive) ...[
                const SizedBox(width: 6),
                Text('· ${loc.demoLocation!.name}, ${loc.demoLocation!.state}', style: const TextStyle(fontSize: 12)),
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
            if (tier == GpsQualityTier.low)
              const Padding(
                padding: EdgeInsets.only(top: 4),
                child: Text(
                  'Low GPS accuracy — road association may be uncertain.',
                  style: TextStyle(fontSize: 12, color: Colors.orange, fontStyle: FontStyle.italic),
                ),
              ),
          ],
        ],
      ),
    );
  }

  Widget _buildRoadMatchStatus() {
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
      // Backend/network failure — distinct from "no road found nearby".
      return Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(color: Colors.red.shade50, borderRadius: BorderRadius.circular(8)),
        child: Text('Backend error: $_roadMatchError', style: const TextStyle(fontSize: 12, color: Colors.red)),
      );
    }

    final match = _roadMatch;
    if (match == null) return const SizedBox.shrink();

    if (match['matched'] != true) {
      return Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(color: Colors.grey.shade100, borderRadius: BorderRadius.circular(8)),
        child: Text(
          match['message']?.toString() ?? 'Road network coverage unavailable for this location.',
          style: const TextStyle(fontSize: 12, color: Colors.black54),
        ),
      );
    }

    final road = match['road'] as Map<String, dynamic>?;
    final distance = match['distanceMeters'];
    final confidence = match['confidence']?.toString() ?? '—';

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(color: Colors.green.shade50, borderRadius: BorderRadius.circular(8)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Nearest road: ${road?['name'] ?? 'Unknown'}', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
          Text('Distance: ${distance}m · Confidence: $confidence', style: const TextStyle(fontSize: 12)),
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
        return Colors.green.shade700;
      case GpsQualityTier.medium:
        return Colors.orange.shade700;
      case GpsQualityTier.low:
        return Colors.red.shade700;
      default:
        return Colors.black54;
    }
  }

  Widget _buildProcessingStep() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const CircularProgressIndicator(color: Color(0xFFEF7B26)),
          const SizedBox(height: 24),
          Text(
            _processingLabel,
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }

  Widget _buildResultStep() {
    final result = _result ?? {};
    final aiResult = (result['aiResult'] as Map?) ?? {};
    final confidence = aiResult['confidence'];
    final loc = _resolvedLocation;

    return SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.check_circle, color: Colors.green, size: 28),
              SizedBox(width: 10),
              Text('Incident Recorded', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
            ],
          ),
          const SizedBox(height: 20),
          _resultCard([
            _resultRow('Incident ID', (result['id'] ?? '-').toString()),
            _resultRow('Classification', (aiResult['classification'] ?? result['type'] ?? '-').toString()),
            _resultRow('Severity', (result['severity'] ?? '-').toString()),
            _resultRow(
              'Confidence',
              confidence != null ? '${(confidence * 100).round()}%' : '-',
            ),
            _resultRow('Road', (result['roadName'] ?? 'Unmapped').toString()),
            _resultRow('Status', (result['status'] ?? '-').toString()),
            _resultRow('Location mode', loc?.mode == LocationMode.liveGps ? 'LIVE GPS' : 'NER DEMO'),
          ]),
          if (aiResult['summary'] != null) ...[
            const SizedBox(height: 16),
            Text(
              aiResult['summary'].toString(),
              style: const TextStyle(color: Colors.black54, fontStyle: FontStyle.italic),
            ),
          ],
          const SizedBox(height: 32),
          SizedBox(
            width: double.infinity,
            height: 52,
            child: OutlinedButton(
              onPressed: _reset,
              child: const Text('Report Another Incident'),
            ),
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            height: 52,
            child: ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF0F2942),
                foregroundColor: Colors.white,
              ),
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Back to Home'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildErrorStep() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.error_outline, color: Colors.red, size: 40),
          const SizedBox(height: 16),
          Text(
            _errorMessage ?? 'Something went wrong.',
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 15),
          ),
          const SizedBox(height: 24),
          ElevatedButton(
            onPressed: () => setState(() => _step = _Step.form),
            child: const Text('Try Again'),
          ),
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
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.grey.shade300),
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
          Text(label, style: const TextStyle(color: Colors.black54)),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
          ),
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
      borderRadius: BorderRadius.circular(10),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: BoxDecoration(
          color: selected ? const Color(0xFF0F2942) : Colors.white,
          border: Border.all(color: selected ? const Color(0xFF0F2942) : Colors.grey.shade300),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Column(
          children: [
            Icon(icon, size: 18, color: selected ? Colors.white : Colors.black54),
            const SizedBox(height: 4),
            Text(
              label,
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.bold,
                color: selected ? Colors.white : Colors.black54,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
