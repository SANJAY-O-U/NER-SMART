import 'dart:convert';
import 'package:http/http.dart' as http;
import '../config/app_config.dart';

/// Talks to the EXISTING NER-SMART Node/Express backend.
/// This is the ONLY place in the app that makes network calls.
///
/// The backend base URL is resolved at build time by [AppConfig] — see
/// lib/config/app_config.dart for the emulator / physical-device /
/// production (HTTPS-only) options.
/// Same backend, same MongoDB, same API the React dashboard already uses —
/// there is no separate backend for this app.
class ApiService {
  static String get baseUrl => AppConfig.apiBaseUrl;

  /// POST /api/incidents
  /// Returns the created (or, on idempotent replay, existing) incident as
  /// a Map, or throws an ApiException with a classified error type.
  ///
  /// `clientEventId`, when supplied, is the Phase 5 offline-sync
  /// idempotency key — the backend guarantees the SAME eventId always
  /// resolves to the SAME server-side incident, so this method is safe
  /// to call repeatedly for the same local event (retries after a
  /// timeout, app restarts mid-sync, etc.) without ever creating a
  /// duplicate.
  static Future<Map<String, dynamic>> reportIncident({
    required String type,
    required double lat,
    required double lng,
    String description = '',
    String? locationMode,
    double? gpsAccuracyMeters,
    String? clientEventId,
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
              if (clientEventId != null) 'clientEventId': clientEventId,
            }),
          )
          .timeout(const Duration(seconds: 15));
    } on Exception catch (e) {
      final isTimeout = e.toString().toLowerCase().contains('timeout');
      throw ApiException(
        isTimeout
            ? 'Timed out reaching the backend at $baseUrl.'
            : 'Could not reach the backend at $baseUrl. Is it running and reachable from this device?',
        type: isTimeout ? ApiErrorType.timeout : ApiErrorType.network,
      );
    }

    final Map<String, dynamic> body;
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is! Map<String, dynamic>) throw const FormatException('unexpected JSON shape');
      body = decoded;
    } catch (_) {
      // Phase 7I: a malformed/non-JSON response (e.g. an HTML error page
      // from a misconfigured proxy, or a truncated body) must not crash
      // the caller with an uncaught FormatException — classify it like
      // any other backend-side failure instead.
      throw ApiException(
        'The backend returned an unreadable response (HTTP ${response.statusCode}).',
        type: ApiErrorType.serverError,
      );
    }

    if (response.statusCode >= 200 && response.statusCode < 300) {
      if (body['data'] is Map<String, dynamic>) {
        return body['data'] as Map<String, dynamic>;
      }
      return body;
    }

    final message = body['error']?.toString() ?? 'Report failed (${response.statusCode})';
    if (response.statusCode == 422) {
      throw ApiException(message, type: ApiErrorType.validation);
    }
    if (response.statusCode >= 500) {
      throw ApiException(message, type: ApiErrorType.serverError);
    }
    throw ApiException(message, type: ApiErrorType.unknown);
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
        type: ApiErrorType.network,
      );
    }

    final Map<String, dynamic> body;
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is! Map<String, dynamic>) throw const FormatException('unexpected JSON shape');
      body = decoded;
    } catch (_) {
      throw ApiException(
        'The backend returned an unreadable response (HTTP ${response.statusCode}).',
        type: ApiErrorType.serverError,
      );
    }

    if (response.statusCode >= 200 && response.statusCode < 300) {
      if (body['data'] is Map<String, dynamic>) {
        return body['data'] as Map<String, dynamic>;
      }
      return body;
    }

    throw ApiException(body['error']?.toString() ?? 'Road lookup failed (${response.statusCode})', type: ApiErrorType.unknown);
  }

  /// GET /api/alerts?roadId=
  /// Returns the alert list (empty if none) for the given road, using
  /// the EXISTING /api/alerts endpoint's new optional roadId filter —
  /// no new backend endpoint. Never throws for an empty result; only
  /// throws ApiException for a genuine network/backend/parse failure.
  static Future<List<Map<String, dynamic>>> getAlertsForRoad(String roadId) async {
    final uri = Uri.parse('$baseUrl/alerts').replace(queryParameters: {'roadId': roadId});

    http.Response response;
    try {
      response = await http.get(uri).timeout(const Duration(seconds: 12));
    } catch (e) {
      throw ApiException(
        'Could not reach the backend at $baseUrl. Is it running and reachable from this device?',
        type: ApiErrorType.network,
      );
    }

    dynamic decoded;
    try {
      decoded = jsonDecode(response.body);
    } catch (_) {
      throw ApiException(
        'The backend returned an unreadable response (HTTP ${response.statusCode}).',
        type: ApiErrorType.serverError,
      );
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      final message = (decoded is Map && decoded['error'] != null)
          ? decoded['error'].toString()
          : 'Alert lookup failed (${response.statusCode})';
      throw ApiException(message, type: response.statusCode >= 500 ? ApiErrorType.serverError : ApiErrorType.unknown);
    }

    final data = (decoded is Map) ? decoded['data'] : null;
    return parseAlertsList(data);
  }

  /// GET /api/roads/:roadId/accessibility
  /// Returns the EXISTING accessibility contract exactly as the backend's
  /// accessibility engine computes it ({ state, accessibilityScore,
  /// confidence, explanation, evidence, ... }) — same endpoint the React
  /// dashboard already consumes. This method does not interpret or
  /// reshape `state`; the UI displays whatever value comes back.
  static Future<Map<String, dynamic>> getRoadAccessibility(String roadId) async {
    final uri = Uri.parse('$baseUrl/roads/$roadId/accessibility');

    http.Response response;
    try {
      response = await http.get(uri).timeout(const Duration(seconds: 12));
    } catch (e) {
      throw ApiException(
        'Could not reach the backend at $baseUrl. Is it running and reachable from this device?',
        type: ApiErrorType.network,
      );
    }

    dynamic decoded;
    try {
      decoded = jsonDecode(response.body);
    } catch (_) {
      throw ApiException(
        'The backend returned an unreadable response (HTTP ${response.statusCode}).',
        type: ApiErrorType.serverError,
      );
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      final message = (decoded is Map && decoded['error'] != null)
          ? decoded['error'].toString()
          : 'Accessibility lookup failed (${response.statusCode})';
      throw ApiException(message, type: response.statusCode >= 500 ? ApiErrorType.serverError : ApiErrorType.unknown);
    }

    final data = (decoded is Map) ? decoded['data'] : null;
    if (data is Map<String, dynamic>) return data;
    throw ApiException('The backend returned an unexpected accessibility response shape.', type: ApiErrorType.serverError);
  }
}

/// Pure — extracted so JSON-shape handling is directly unit-testable
/// without mocking HTTP. Never throws: any unexpected shape becomes an
/// empty list rather than a crash.
List<Map<String, dynamic>> parseAlertsList(dynamic data) {
  if (data is List) {
    return data.whereType<Map<String, dynamic>>().toList();
  }
  return const [];
}

class ApiException implements Exception {
  final String message;
  final ApiErrorType type;
  ApiException(this.message, {this.type = ApiErrorType.unknown});
  @override
  String toString() => message;
}

/// Distinguishes WHY a request failed, so the sync engine can decide
/// whether a retry is worthwhile. NETWORK/TIMEOUT/SERVER_ERROR are
/// transient — retry later. VALIDATION is permanent — the event is
/// malformed and retrying identically will never succeed (still never
/// deleted locally, per the mission's "never silently discard" rule,
/// but the UI can say so honestly instead of retrying forever).
enum ApiErrorType { network, timeout, serverError, validation, unknown }
