import 'package:flutter/material.dart';
import 'screens/home_screen.dart';
import 'services/connectivity_service.dart';
import 'services/sync_service.dart';
import 'theme/app_theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
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
