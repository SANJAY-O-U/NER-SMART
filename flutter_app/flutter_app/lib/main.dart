import 'package:flutter/material.dart';
import 'screens/home_screen.dart';

void main() {
  runApp(const NerSmartApp());
}

class NerSmartApp extends StatelessWidget {
  const NerSmartApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'NER-SMART Driver',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        primaryColor: const Color(0xFF0F2942),
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF0F2942),
          primary: const Color(0xFF0F2942),
        ),
        useMaterial3: true,
        fontFamily: 'Roboto',
      ),
      home: const HomeScreen(),
    );
  }
}
