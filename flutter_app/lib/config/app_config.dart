import 'package:flutter/foundation.dart';

/// Build-time API configuration (Phase 7A — deployment preparation).
///
/// The backend base URL is supplied at build time with a dart-define —
/// never hardcoded for production, and never carrying any secret (the
/// Flutter app sends no API key by design; see incidentRoutes.js):
///
///   Emulator (default, debug only — no flag needed):
///     flutter run
///   Physical device on the dev LAN (debug/profile):
///     flutter run --dart-define=NER_API_BASE_URL=http://192.168.1.42:5000/api
///   Production release (HTTPS mandatory):
///     flutter build apk --release --dart-define=NER_API_BASE_URL=https://<host>/api
///
/// Release builds FAIL CLOSED: with no NER_API_BASE_URL, or with a
/// non-HTTPS one, the app refuses to talk to any backend and shows a
/// configuration error instead of silently falling back to the emulator
/// URL or sending field reports over plaintext.
///
/// This check lives in Dart, not only in Android's network security
/// config, because dart:io's HTTP client does not consult the Android
/// cleartext policy. The debug-only `usesCleartextTraffic` in
/// android/app/src/debug/AndroidManifest.xml is unchanged and is never
/// merged into release builds.
class AppConfig {
  /// Android emulator alias for the host machine's localhost.
  static const String devEmulatorBaseUrl = 'http://10.0.2.2:5000/api';

  static const String _definedBaseUrl = String.fromEnvironment('NER_API_BASE_URL');

  /// Pure, directly-testable resolution rule.
  static String resolveApiBaseUrl(String defined, {required bool isRelease}) {
    final value = defined.trim();

    if (value.isEmpty) {
      if (isRelease) {
        throw const AppConfigException(
          'No backend URL configured for this release build. '
          'Rebuild with --dart-define=NER_API_BASE_URL=https://<host>/api',
        );
      }
      return devEmulatorBaseUrl;
    }

    final uri = Uri.tryParse(value);
    if (uri == null || !uri.hasScheme || uri.host.isEmpty || !(uri.scheme == 'http' || uri.scheme == 'https')) {
      throw AppConfigException('NER_API_BASE_URL is not a valid http(s) URL: $value');
    }
    if (isRelease && uri.scheme != 'https') {
      throw const AppConfigException(
        'Release builds require an HTTPS backend URL (NER_API_BASE_URL must start with https://).',
      );
    }

    // Normalise away a trailing slash so '$baseUrl/incidents' stays valid.
    return value.endsWith('/') ? value.substring(0, value.length - 1) : value;
  }

  static final String apiBaseUrl = resolveApiBaseUrl(_definedBaseUrl, isRelease: kReleaseMode);

  /// Returns null when the configuration is usable, otherwise the error
  /// message to show the user. Called once from main() before any
  /// network-using service starts.
  static String? validate() {
    try {
      apiBaseUrl;
      return null;
    } on AppConfigException catch (e) {
      return e.message;
    }
  }
}

class AppConfigException implements Exception {
  final String message;
  const AppConfigException(this.message);

  @override
  String toString() => 'AppConfigException: $message';
}
