import 'package:flutter/material.dart';
import 'config/app_config.dart';
import 'screens/home_screen.dart';
import 'services/connectivity_service.dart';
import 'services/sync_service.dart';
import 'theme/app_theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  // Phase 7A: a release build without a valid HTTPS backend URL must not
  // start the sync engine or talk to any backend — show why instead.
  final configError = AppConfig.validate();
  if (configError != null) {
    runApp(ConfigErrorApp(message: configError));
    return;
  }
  // Phase 5: start connectivity monitoring and the store-and-forward
  // sync engine at launch, BEFORE the first screen renders — this
  // covers the "app restarted with pending events" recovery scenario,
  // since SyncService.start() runs an immediate pass in addition to
  // listening for future connectivity changes.
  ConnectivityService.start();
  SyncService.start();
  runApp(const NerSmartApp());
}

class NerSmartApp extends StatelessWidget {
  const NerSmartApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'NER SMART Driver',
      debugShowCheckedModeBanner: false,
      theme: buildAppTheme(),
      home: const HomeScreen(),
    );
  }
}

/// Shown instead of the app when the build-time backend configuration is
/// invalid (see AppConfig). Never contains secrets — only the rule broken.
class ConfigErrorApp extends StatelessWidget {
  final String message;
  const ConfigErrorApp({super.key, required this.message});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'NER SMART Driver',
      debugShowCheckedModeBanner: false,
      theme: buildAppTheme(),
      home: Scaffold(
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Center(
              child: Text(
                'App configuration error\n\n$message',
                textAlign: TextAlign.center,
              ),
            ),
          ),
        ),
      ),
    );
  }
}
