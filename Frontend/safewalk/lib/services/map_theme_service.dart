import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:safewalk/core/constants/map_style_config.dart';

/// Manages the user's chosen map theme mode and derives the active Mapbox
/// style URI from it.
///
/// - [MapThemeMode.alwaysDay]   → always uses the day style.
/// - [MapThemeMode.timeBased]   → style follows local time; a one-shot timer
///   wakes exactly at each hour-slot boundary so transitions happen in real
///   time without polling.
/// - [MapThemeMode.systemTheme] → follows the OS light/dark setting via
///   [WidgetsBindingObserver.didChangePlatformBrightness].
class MapThemeService extends ChangeNotifier with WidgetsBindingObserver {
  MapThemeService({SharedPreferences? prefs}) : _prefs = prefs;

  static const _prefKey = 'map_theme_mode';

  // ── Time-slot boundaries (local hour, 24-h) ───────────────────────────────
  static const _thresholds = [5, 9, 18, 21];

  SharedPreferences? _prefs;
  MapThemeMode _mode = MapThemeMode.alwaysDay;
  Timer? _timer;

  MapThemeMode get mode => _mode;

  // ── Derived style URI ─────────────────────────────────────────────────────

  String get activeStyleUri {
    switch (_mode) {
      case MapThemeMode.alwaysDay:
        return MapStyleConfig.day;
      case MapThemeMode.timeBased:
        return MapStyleConfig.styleForCurrentTime();
      case MapThemeMode.systemTheme:
        final brightness =
            WidgetsBinding.instance.platformDispatcher.platformBrightness;
        return brightness == Brightness.dark
            ? MapStyleConfig.dark
            : MapStyleConfig.day;
    }
  }

  // ── Initialisation ────────────────────────────────────────────────────────

  Future<void> init() async {
    WidgetsBinding.instance.addObserver(this);
    _prefs ??= await SharedPreferences.getInstance();
    final stored = _prefs!.getString(_prefKey);
    if (stored != null) {
      _mode = MapThemeMode.values.firstWhere(
        (m) => m.name == stored,
        orElse: () => MapThemeMode.alwaysDay,
      );
    }
    _applyMode(_mode, persist: false);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  Future<void> setMode(MapThemeMode mode) async {
    if (_mode == mode) return;
    _applyMode(mode, persist: true);
  }

  // ── WidgetsBindingObserver ────────────────────────────────────────────────

  @override
  void didChangePlatformBrightness() {
    if (_mode == MapThemeMode.systemTheme) notifyListeners();
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  void _applyMode(MapThemeMode mode, {required bool persist}) {
    _mode = mode;
    _timer?.cancel();
    _timer = null;

    if (mode == MapThemeMode.timeBased) {
      _scheduleNextThresholdTimer();
    }

    if (persist) {
      _prefs?.setString(_prefKey, mode.name);
    }

    notifyListeners();
  }

  /// Schedules a one-shot timer that fires exactly when the local time crosses
  /// the next hour-slot boundary (05:00, 09:00, 18:00, or 21:00).
  void _scheduleNextThresholdTimer() {
    final delay = _durationUntilNextThreshold();
    _timer = Timer(delay, () {
      notifyListeners();
      // Re-schedule for the boundary after that one.
      if (_mode == MapThemeMode.timeBased) _scheduleNextThresholdTimer();
    });
  }

  /// Duration from now until the next threshold boundary.
  Duration _durationUntilNextThreshold() {
    final now = DateTime.now();
    for (final h in _thresholds) {
      final candidate = DateTime(now.year, now.month, now.day, h);
      if (candidate.isAfter(now)) {
        return candidate.difference(now);
      }
    }
    // All thresholds passed today — next one is 05:00 tomorrow.
    final tomorrow = DateTime(now.year, now.month, now.day + 1, _thresholds[0]);
    return tomorrow.difference(now);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _timer?.cancel();
    super.dispose();
  }
}
