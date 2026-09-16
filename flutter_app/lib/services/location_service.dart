import 'package:geolocator/geolocator.dart';

/// Explicit location mode — the user chooses one, the app never
/// silently substitutes one for the other. Whichever mode is active
/// must be visibly labelled everywhere location is shown.
enum LocationMode { liveGps, nerDemo }

/// The 8 NER demonstration locations (real town coordinates — state
/// capitals / major towns of each Northeast state). These are clearly
/// DEMONSTRATION locations, never presented as the user's actual GPS
/// position.
class NerDemoLocation {
  final String name;
  final String state;
  final double lat;
  final double lng;
  const NerDemoLocation({required this.name, required this.state, required this.lat, required this.lng});
}

const List<NerDemoLocation> nerDemoLocations = [
  // Verified against the actual imported road geometry (see
  // ROUTING_ARCHITECTURE.md / DATA_PROVENANCE.md) — this exact
  // coordinate is a real NH 27 endpoint, 0km from an actual imported
  // segment. Labeled honestly (not a city name) since it isn't one.
  // The city-named entries below are real town coordinates but do NOT
  // currently resolve to a road match via /api/roads/nearest unless the
  // real road dataset has been imported into the running backend — see
  // "Import the real road network" in DEMO_RUN.md.
  NerDemoLocation(name: 'NH27 Verified Test Corridor', state: 'Assam/Nagaland border', lat: 24.839033206185018, lng: 92.83321918253361),
  NerDemoLocation(name: 'Guwahati', state: 'Assam', lat: 26.1445, lng: 91.7362),
  NerDemoLocation(name: 'Imphal', state: 'Manipur', lat: 24.8170, lng: 93.9368),
  NerDemoLocation(name: 'Shillong', state: 'Meghalaya', lat: 25.5788, lng: 91.8933),
  NerDemoLocation(name: 'Aizawl', state: 'Mizoram', lat: 23.7271, lng: 92.7176),
  NerDemoLocation(name: 'Kohima', state: 'Nagaland', lat: 25.6751, lng: 94.1086),
  NerDemoLocation(name: 'Agartala', state: 'Tripura', lat: 23.8315, lng: 91.2868),
  NerDemoLocation(name: 'Itanagar', state: 'Arunachal Pradesh', lat: 27.0844, lng: 93.6053),
  NerDemoLocation(name: 'Gangtok', state: 'Sikkim', lat: 27.3389, lng: 88.6065),
];

/// GPS quality tier — engineering defaults, not a scientific claim.
/// Mirrors the backend's locationMatchService.js thresholds exactly, so
/// what the app shows matches what the backend will use for confidence.
enum GpsQualityTier { high, medium, low, unknown }

GpsQualityTier qualityTierForAccuracy(double? accuracyMeters) {
  if (accuracyMeters == null) return GpsQualityTier.unknown;
  if (accuracyMeters <= 20) return GpsQualityTier.high;
  if (accuracyMeters <= 100) return GpsQualityTier.medium;
  return GpsQualityTier.low;
}

/// A real GPS fix with full metadata. Every field the device/platform
/// doesn't actually provide is null — never fabricated, never defaulted
/// to zero unless zero is what was actually reported.
class GpsFix {
  final double lat;
  final double lng;
  final double? accuracyMeters;
  final double? speedMetersPerSecond;
  final double? headingDegrees;
  final DateTime timestamp;

  GpsFix({
    required this.lat,
    required this.lng,
    required this.accuracyMeters,
    required this.speedMetersPerSecond,
    required this.headingDegrees,
    required this.timestamp,
  });

  GpsQualityTier get qualityTier => qualityTierForAccuracy(accuracyMeters);
}

/// The resolved location the app should use — either a real GPS fix
/// (LIVE GPS mode) or a chosen demo location (NER DEMO mode). The mode
/// is always explicit; nothing here silently falls back to the other.
class ResolvedLocation {
  final LocationMode mode;
  final double lat;
  final double lng;
  final GpsFix? gpsFix; // only set in LIVE GPS mode
  final NerDemoLocation? demoLocation; // only set in NER DEMO mode

  ResolvedLocation.live(GpsFix fix)
      : mode = LocationMode.liveGps,
        lat = fix.lat,
        lng = fix.lng,
        gpsFix = fix,
        demoLocation = null;

  ResolvedLocation.demo(NerDemoLocation loc)
      : mode = LocationMode.nerDemo,
        lat = loc.lat,
        lng = loc.lng,
        gpsFix = null,
        demoLocation = loc;
}

enum LocationErrorReason {
  permissionDenied,
  permissionDeniedForever,
  serviceDisabled,
  timeout,
  unknown,
}

class LocationException implements Exception {
  final LocationErrorReason reason;
  final String message;
  LocationException(this.reason, this.message);
  @override
  String toString() => message;
}

class LocationService {
  /// Attempts a REAL GPS fix. Throws [LocationException] on any failure
  /// — permission denied, location services off, timeout, or unknown
  /// error. Per Phase 4A: no silent fallback to a demo coordinate. The
  /// caller (UI) must show the error and let the user either retry LIVE
  /// GPS or explicitly switch to NER DEMO mode themselves.
  static Future<GpsFix> getLiveGpsFix() async {
    final serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      throw LocationException(
        LocationErrorReason.serviceDisabled,
        'Location services are turned off on this device. Enable GPS to use Live GPS mode.',
      );
    }

    LocationPermission permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied) {
      throw LocationException(
        LocationErrorReason.permissionDenied,
        'Location permission is required to associate this report with a road.',
      );
    }
    if (permission == LocationPermission.deniedForever) {
      throw LocationException(
        LocationErrorReason.permissionDeniedForever,
        'Location permission was permanently denied. Enable it in system settings to use Live GPS mode.',
      );
    }

    Position position;
    try {
      position = await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.high,
      ).timeout(const Duration(seconds: 12));
    } on Exception catch (e) {
      final isTimeout = e.toString().toLowerCase().contains('timeout');
      throw LocationException(
        isTimeout ? LocationErrorReason.timeout : LocationErrorReason.unknown,
        isTimeout
            ? 'Timed out waiting for a GPS fix. Try again, ideally with a clear view of the sky.'
            : 'Could not get your location: ${e.toString()}',
      );
    }

    return GpsFix(
      lat: position.latitude,
      lng: position.longitude,
      // geolocator reports these as 0.0 when genuinely unknown on some
      // platforms rather than null; there is no reliable cross-platform
      // way to distinguish "reported zero" from "unknown" here, so we
      // pass the value through as-is rather than guessing — documented
      // in GPS_LOCATION_ARCHITECTURE.md.
      accuracyMeters: position.accuracy,
      speedMetersPerSecond: position.speed,
      headingDegrees: position.heading,
      timestamp: position.timestamp,
    );
  }
}
