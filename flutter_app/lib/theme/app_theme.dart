import 'package:flutter/material.dart';

/// NER SMART driver app design system — shared color tokens, spacing, and
/// the operational-state → color/label mapping used across every screen.
/// A single source of truth so no screen hardcodes an arbitrary color.
///
/// IMPORTANT: `statusMeta` only maps a KNOWN backend state string to a
/// display color/subtitle — it never invents or reinterprets the state
/// itself. Callers always render `state` exactly as the API returned it;
/// this lookup only decides how to draw an already-known value, and falls
/// back to a neutral/UNKNOWN treatment for anything it doesn't recognize.
class AppColors {
  AppColors._();

  static const Color background = Color(0xFFFFFFFF);
  static const Color surface = Color(0xFFF6F7F8);
  static const Color border = Color(0xFFE3E6EA);

  static const Color textPrimary = Color(0xFF1C2126);
  static const Color textSecondary = Color(0xFF5B6470);
  static const Color textMuted = Color(0xFF8A93A0);

  static const Color primary = Color(0xFFEF7B26); // NER orange
  static const Color primaryDark = Color(0xFFD9670F);

  static const Color success = Color(0xFF16A34A); // OPEN / SAFE
  static const Color warning = Color(0xFFD97706); // HIGH_RISK / caution
  static const Color restricted = Color(0xFFDC5F1D); // RESTRICTED — between warning and danger
  static const Color danger = Color(0xFFDC2626); // BLOCKED
  static const Color neutral = Color(0xFF8A93A0); // UNKNOWN

  static const Color infoSurface = Color(0xFFEFF6FF);
}

class AppSpacing {
  AppSpacing._();
  static const double xs = 4;
  static const double sm = 8;
  static const double md = 16;
  static const double lg = 24;
  static const double xl = 32;
}

class AppRadius {
  AppRadius._();
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
}

/// Visual treatment for an operational STATE value coming directly from
/// the accessibility/road APIs. `key` is normalized (uppercased/trimmed)
/// before lookup so minor formatting differences from the backend don't
/// accidentally fall through to UNKNOWN.
class StatusMeta {
  final String label;
  final String subtitle;
  final Color color;
  final Color surfaceColor;
  final IconData icon;
  const StatusMeta({
    required this.label,
    required this.subtitle,
    required this.color,
    required this.surfaceColor,
    required this.icon,
  });
}

StatusMeta statusMetaFor(String? rawState) {
  final key = (rawState ?? '').trim().toUpperCase();
  switch (key) {
    case 'OPEN':
      return const StatusMeta(
        label: 'OPEN',
        subtitle: 'No active operational warning',
        color: AppColors.success,
        surfaceColor: Color(0xFFEFFBF3),
        icon: Icons.check_circle_outline,
      );
    case 'HIGH_RISK':
      return const StatusMeta(
        label: 'HIGH RISK',
        subtitle: 'Drive with caution',
        color: AppColors.warning,
        surfaceColor: Color(0xFFFFF8EC),
        icon: Icons.warning_amber_rounded,
      );
    case 'RESTRICTED':
      return const StatusMeta(
        label: 'RESTRICTED',
        subtitle: 'Restrictions reported',
        color: AppColors.restricted,
        surfaceColor: Color(0xFFFFF1E8),
        icon: Icons.block_flipped,
      );
    case 'BLOCKED':
      return const StatusMeta(
        label: 'BLOCKED',
        subtitle: 'Do not use this route',
        color: AppColors.danger,
        surfaceColor: Color(0xFFFEF0F0),
        icon: Icons.do_not_disturb_on_outlined,
      );
    case 'UNKNOWN':
    default:
      return const StatusMeta(
        label: 'UNKNOWN',
        subtitle: 'No current operational evidence',
        color: AppColors.neutral,
        surfaceColor: Color(0xFFF6F7F8),
        icon: Icons.help_outline,
      );
  }
}

ThemeData buildAppTheme() {
  final base = ThemeData(
    useMaterial3: true,
    colorScheme: ColorScheme.fromSeed(
      seedColor: AppColors.primary,
      primary: AppColors.primary,
      brightness: Brightness.light,
    ),
    scaffoldBackgroundColor: AppColors.background,
    fontFamily: 'Roboto',
  );

  return base.copyWith(
    appBarTheme: const AppBarTheme(
      backgroundColor: AppColors.background,
      foregroundColor: AppColors.textPrimary,
      elevation: 0,
      surfaceTintColor: Colors.transparent,
    ),
    textTheme: base.textTheme.apply(
      bodyColor: AppColors.textPrimary,
      displayColor: AppColors.textPrimary,
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        elevation: 0,
        padding: const EdgeInsets.symmetric(vertical: 14),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.md)),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: AppColors.textPrimary,
        side: const BorderSide(color: AppColors.border),
        padding: const EdgeInsets.symmetric(vertical: 14),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.md)),
      ),
    ),
  );
}
