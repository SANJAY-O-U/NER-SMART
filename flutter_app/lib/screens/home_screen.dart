import 'dart:async';
import 'package:flutter/material.dart';
import 'report_flow_screen.dart';
import '../services/api_service.dart';
import '../services/location_service.dart';

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

  String? _matchedRoadId;
  String? _matchedRoadName;
  List<Map<String, dynamic>> _alerts = [];
  bool _loading = false;
  String? _error;

  Timer? _refreshTimer;

  @override
  void initState() {
    super.initState();
    _refresh();
    _refreshTimer = Timer.periodic(_alertRefreshInterval, (_) => _refresh());
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    super.dispose();
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
    } else {
      try {
        final fix = await LocationService.getLiveGpsFix();
        lat = fix.lat;
        lng = fix.lng;
      } on LocationException catch (e) {
        if (!mounted) return;
        setState(() {
          _loading = false;
          _error = e.message;
          _matchedRoadId = null;
          _alerts = [];
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
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e.message;
        _alerts = [];
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
      backgroundColor: const Color(0xFF0F2942),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 24),
              Row(
                children: [
                  Container(
                    width: 48,
                    height: 48,
                    decoration: BoxDecoration(
                      color: const Color(0xFFEF7B26),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: const Icon(Icons.alt_route, color: Colors.white),
                  ),
                  const SizedBox(width: 12),
                  const Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'NER-SMART',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 20,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      Text(
                        'Ctrl_Alt_Elite · Driver App',
                        style: TextStyle(color: Colors.white70, fontSize: 12),
                      ),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 20),
              _buildModeRow(),
              const SizedBox(height: 12),
              _buildAlertCard(),
              const Spacer(),
              const Text(
                'Spotted a road hazard?',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 26,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'Report it in a few taps. Your report is analysed and '
                'matched to the nearest road so authorities and other '
                'shipments can respond.',
                style: TextStyle(color: Colors.white70, fontSize: 14, height: 1.4),
              ),
              const SizedBox(height: 28),
              SizedBox(
                width: double.infinity,
                height: 56,
                child: ElevatedButton.icon(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFFEF7B26),
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                  ),
                  icon: const Icon(Icons.report_problem_outlined),
                  label: const Text(
                    'Report Incident',
                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
                  ),
                  onPressed: () {
                    Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => const ReportFlowScreen()),
                    );
                  },
                ),
              ),
              const Spacer(),
              const Center(
                child: Text(
                  'Prototype demo — NOT connected to a live government feed',
                  style: TextStyle(color: Colors.white38, fontSize: 11),
                  textAlign: TextAlign.center,
                ),
              ),
              const SizedBox(height: 8),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildModeRow() {
    return Row(
      children: [
        _modeChip('LIVE GPS', LocationMode.liveGps),
        const SizedBox(width: 8),
        _modeChip('NER DEMO', LocationMode.nerDemo),
        if (_mode == LocationMode.nerDemo) ...[
          const SizedBox(width: 8),
          Expanded(
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              decoration: BoxDecoration(
                color: Colors.white.withOpacity(0.08),
                borderRadius: BorderRadius.circular(8),
              ),
              child: DropdownButtonHideUnderline(
                child: DropdownButton<NerDemoLocation>(
                  value: _selectedDemoLocation,
                  isExpanded: true,
                  dropdownColor: const Color(0xFF0F2942),
                  style: const TextStyle(color: Colors.white, fontSize: 12),
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

  Widget _modeChip(String label, LocationMode mode) {
    final selected = _mode == mode;
    return InkWell(
      onTap: () => _onModeChanged(mode),
      borderRadius: BorderRadius.circular(8),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: selected ? const Color(0xFFEF7B26) : Colors.white.withOpacity(0.08),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: Colors.white,
            fontSize: 12,
            fontWeight: selected ? FontWeight.bold : FontWeight.normal,
          ),
        ),
      ),
    );
  }

  Widget _buildAlertCard() {
    if (_loading && _alerts.isEmpty && _error == null) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 8),
        child: Row(
          children: [
            SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white70)),
            SizedBox(width: 10),
            Text('Checking for alerts…', style: TextStyle(color: Colors.white54, fontSize: 12)),
          ],
        ),
      );
    }

    if (_error != null) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: Colors.red.withOpacity(0.15), borderRadius: BorderRadius.circular(10)),
        child: Text(_error!, style: const TextStyle(color: Colors.white, fontSize: 12)),
      );
    }

    if (_matchedRoadId == null) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: Colors.white.withOpacity(0.06), borderRadius: BorderRadius.circular(10)),
        child: const Text(
          'No nearby road matched for the current location — no operational alerts to show.',
          style: TextStyle(color: Colors.white54, fontSize: 12),
        ),
      );
    }

    if (_alerts.isEmpty) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: Colors.white.withOpacity(0.06), borderRadius: BorderRadius.circular(10)),
        child: Text(
          'No active operational alerts for ${_matchedRoadName ?? "the matched road"}.',
          style: const TextStyle(color: Colors.white54, fontSize: 12),
        ),
      );
    }

    // Every field below comes directly from the backend Alert object —
    // nothing here is hardcoded.
    return Column(
      children: _alerts.map((alert) {
        final message = alert['message']?.toString() ?? '';
        final severity = alert['severity']?.toString();
        final type = alert['type']?.toString();
        final source = alert['source']?.toString();
        final timestamp = alert['generatedAt'] ?? alert['timestamp'];

        return Container(
          margin: const EdgeInsets.only(bottom: 8),
          width: double.infinity,
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: Colors.orange.withOpacity(0.15),
            border: Border.all(color: Colors.orange.withOpacity(0.4)),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Icon(Icons.warning_amber_rounded, color: Colors.orange, size: 16),
                  const SizedBox(width: 6),
                  const Text('OPERATIONAL ALERT', style: TextStyle(color: Colors.orange, fontSize: 11, fontWeight: FontWeight.bold)),
                ],
              ),
              const SizedBox(height: 6),
              Text(message, style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w600)),
              if (_matchedRoadName != null)
                Text(_matchedRoadName!, style: const TextStyle(color: Colors.white70, fontSize: 12)),
              const SizedBox(height: 4),
              Wrap(
                spacing: 10,
                children: [
                  if (severity != null) Text('Severity: $severity', style: const TextStyle(color: Colors.white54, fontSize: 11)),
                  if (type != null) Text(type, style: const TextStyle(color: Colors.white54, fontSize: 11)),
                  if (source != null) Text('Source: $source', style: const TextStyle(color: Colors.white54, fontSize: 11)),
                ],
              ),
              if (timestamp != null) ...[
                const SizedBox(height: 4),
                Text('Updated: $timestamp', style: const TextStyle(color: Colors.white38, fontSize: 10)),
              ],
            ],
          ),
        );
      }).toList(),
    );
  }
}
