import 'package:flutter_test/flutter_test.dart';
import 'package:ner_smart_driver/config/app_config.dart';

void main() {
  group('AppConfig.resolveApiBaseUrl', () {
    test('debug with no define falls back to the emulator URL', () {
      expect(AppConfig.resolveApiBaseUrl('', isRelease: false), AppConfig.devEmulatorBaseUrl);
    });

    test('debug accepts a plain-HTTP LAN URL for a physical device', () {
      expect(
        AppConfig.resolveApiBaseUrl('http://192.168.1.42:5000/api', isRelease: false),
        'http://192.168.1.42:5000/api',
      );
    });

    test('release with no define fails closed', () {
      expect(() => AppConfig.resolveApiBaseUrl('', isRelease: true), throwsA(isA<AppConfigException>()));
    });

    test('release rejects plain HTTP', () {
      expect(
        () => AppConfig.resolveApiBaseUrl('http://api.example.org/api', isRelease: true),
        throwsA(isA<AppConfigException>()),
      );
    });

    test('release accepts HTTPS and strips a trailing slash', () {
      expect(
        AppConfig.resolveApiBaseUrl('https://api.example.org/api/', isRelease: true),
        'https://api.example.org/api',
      );
    });

    test('rejects malformed URLs', () {
      expect(() => AppConfig.resolveApiBaseUrl('not a url', isRelease: false), throwsA(isA<AppConfigException>()));
      expect(() => AppConfig.resolveApiBaseUrl('ftp://host/api', isRelease: false), throwsA(isA<AppConfigException>()));
    });
  });
}
