import 'dart:convert';
import 'package:http/http.dart' as http;

/// Talks to the EXISTING NER-SMART Node/Express backend.
/// This is the ONLY place in the app that makes network calls.
///
/// IMPORTANT — set this to wherever your backend is actually reachable
/// from the device/emulator running this app:
///   - Android emulator -> host machine's localhost: 10.0.2.2
///   - iOS simulator    -> localhost works directly: 127.0.0.1
///   - Physical device  -> your machine's LAN IP, e.g. 192.168.1.42
/// Same backend, same MongoDB, same API the React dashboard already uses —
/// there is no separate backend for this app.
class ApiService {
  static const String baseUrl = 'http://10.0.2.2:5000/api';

  /// POST /api/incidents
  /// Returns the created incident (including AI analysis result) as a Map,
  /// or throws an ApiException with a human-readable message.
  static Future<Map<String, dynamic>> reportIncident({
    required String type,
    required double lat,
    required double lng,
    String description = '',
    String? locationMode,
    double? gpsAccuracyMeters,
  }) async {
    final uri = Uri.parse('$baseUrl/incidents');

    http.Response response;
    try {
      response = await http
          .post(
            uri,
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({
              'type': type,
              'lat': lat,
              'lng': lng,
              'description': description,
              'source': 'DRIVER_APP',
              if (locationMode != null) 'locationMode': locationMode,
              if (gpsAccuracyMeters != null) 'gpsAccuracyMeters': gpsAccuracyMeters,
            }),
          )
          .timeout(const Duration(seconds: 15));
    } catch (e) {
      throw ApiException(
        'Could not reach the backend at $baseUrl. Is it running and reachable from this device?',
      );
    }

    final Map<String, dynamic> body = jsonDecode(response.body);

    if (response.statusCode >= 200 && response.statusCode < 300) {
      if (body['data'] is Map<String, dynamic>) {
        return body['data'] as Map<String, dynamic>;
      }
      return body;
    }

    throw ApiException(body['error']?.toString() ?? 'Report failed (${response.statusCode})');
  }

  /// GET /api/roads/nearest?lat=&lng=&accuracyMeters=
  /// Real 2dsphere road matching. Returns a Map with either
  /// `matched: true` (+ road/distance/confidence) or `matched: false`
  /// (+ reason/message) — both are normal successful responses, NOT
  /// exceptions. An ApiException here means the BACKEND itself failed
  /// (network/timeout/5xx), which the UI must show differently from
  /// "no road found nearby".
  static Future<Map<String, dynamic>> getNearestRoad({
    required double lat,
    required double lng,
    double? accuracyMeters,
  }) async {
    final params = <String, String>{
      'lat': lat.toString(),
      'lng': lng.toString(),
      if (accuracyMeters != null) 'accuracyMeters': accuracyMeters.toString(),
    };
    final uri = Uri.parse('$baseUrl/roads/nearest').replace(queryParameters: params);

    http.Response response;
    try {
      response = await http.get(uri).timeout(const Duration(seconds: 12));
    } catch (e) {
      throw ApiException(
        'Could not reach the backend at $baseUrl. Is it running and reachable from this device?',
      );
    }

    final Map<String, dynamic> body = jsonDecode(response.body);

    if (response.statusCode >= 200 && response.statusCode < 300) {
      if (body['data'] is Map<String, dynamic>) {
        return body['data'] as Map<String, dynamic>;
      }
      return body;
    }

    throw ApiException(body['error']?.toString() ?? 'Road lookup failed (${response.statusCode})');
  }
}

class ApiException implements Exception {
  final String message;
  ApiException(this.message);
  @override
  String toString() => message;
}
