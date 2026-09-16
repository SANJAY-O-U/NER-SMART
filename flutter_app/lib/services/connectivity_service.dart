import 'dart:async';
import 'package:connectivity_plus/connectivity_plus.dart';

/// Network status only — NOT backend availability. A device can report
/// WiFi/mobile connectivity while the NER-SMART API is unreachable
/// (server down, wrong IP configured, firewalled). The sync engine must
/// still attempt a real request and handle its own failure; this class
/// only decides WHEN it's worth trying.
enum NetworkStatus { online, offline, unknown }

class ConnectivityService {
  static final _controller = StreamController<NetworkStatus>.broadcast();
  static StreamSubscription<List<ConnectivityResult>>? _subscription;
  static NetworkStatus _last = NetworkStatus.unknown;

  static NetworkStatus get current => _last;
  static Stream<NetworkStatus> get onStatusChange => _controller.stream;

  static NetworkStatus _mapResults(List<ConnectivityResult> results) {
    if (results.isEmpty) return NetworkStatus.unknown;
    final hasConnection = results.any((r) => r != ConnectivityResult.none);
    return hasConnection ? NetworkStatus.online : NetworkStatus.offline;
  }

  /// Starts listening for connectivity changes. Call once at app
  /// startup. Safe to call multiple times (re-subscribes cleanly).
  static Future<void> start() async {
    await _subscription?.cancel();
    try {
      final initial = await Connectivity().checkConnectivity();
      _last = _mapResults(initial);
    } catch (_) {
      _last = NetworkStatus.unknown; // never crash the app over a connectivity check failure
    }
    _controller.add(_last);

    _subscription = Connectivity().onConnectivityChanged.listen(
      (results) {
        _last = _mapResults(results);
        _controller.add(_last);
      },
      onError: (_) {
        _last = NetworkStatus.unknown;
        _controller.add(_last);
      },
    );
  }

  static Future<void> stop() async {
    await _subscription?.cancel();
    _subscription = null;
  }
}
