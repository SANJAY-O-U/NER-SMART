import 'package:flutter_test/flutter_test.dart';
import 'package:ner_smart_driver/services/sync_service.dart';

void main() {
  group('SyncService.backoffFor — bounded exponential backoff', () {
    test('grows with retry count', () {
      final b0 = SyncService.backoffFor(0);
      final b1 = SyncService.backoffFor(1);
      final b2 = SyncService.backoffFor(2);
      expect(b1.inSeconds, greaterThan(b0.inSeconds));
      expect(b2.inSeconds, greaterThan(b1.inSeconds));
    });

    test('never exceeds the documented cap even for a very high retry count', () {
      final huge = SyncService.backoffFor(50);
      expect(huge.inMinutes, lessThanOrEqualTo(10));
    });

    test('never goes below the base backoff for the first retry', () {
      final first = SyncService.backoffFor(0);
      expect(first.inSeconds, greaterThanOrEqualTo(5));
    });

    test('is deterministic — same retryCount always yields the same duration', () {
      expect(SyncService.backoffFor(3), SyncService.backoffFor(3));
    });
  });
}
