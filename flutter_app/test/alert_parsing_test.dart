import 'package:flutter_test/flutter_test.dart';
import 'package:ner_smart_driver/services/api_service.dart';

void main() {
  group('parseAlertsList — driver alert delivery', () {
    test('parses a normal alert list', () {
      final result = parseAlertsList([
        {'id': 'a1', 'message': 'Heavy rain', 'severity': 'HIGH'},
        {'id': 'a2', 'message': 'Road damage', 'severity': 'MEDIUM'},
      ]);
      expect(result.length, 2);
      expect(result[0]['message'], 'Heavy rain');
    });

    test('an empty list renders safely as an empty list', () {
      expect(parseAlertsList([]), <Map<String, dynamic>>[]);
    });

    test('a malformed/unexpected shape (not a List) never crashes — returns empty', () {
      expect(parseAlertsList(null), <Map<String, dynamic>>[]);
      expect(parseAlertsList('not a list'), <Map<String, dynamic>>[]);
      expect(parseAlertsList({'not': 'a list'}), <Map<String, dynamic>>[]);
      expect(parseAlertsList(42), <Map<String, dynamic>>[]);
    });

    test('non-Map items inside the list are silently dropped rather than crashing', () {
      final result = parseAlertsList([
        {'id': 'a1', 'message': 'valid'},
        'not a map',
        123,
      ]);
      expect(result.length, 1);
      expect(result[0]['id'], 'a1');
    });
  });
}
