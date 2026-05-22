/// Map theme mode chosen by the user in Settings.
enum MapThemeMode {
  /// Always use the day style.
  alwaysDay,

  /// Switch style automatically based on local system time.
  timeBased,

  /// Follow the device light/dark system theme.
  systemTheme,
}

/// Mapbox style URIs for each visual variant.
class MapStyleConfig {
  MapStyleConfig._();

  static const String day =
      'mapbox://styles/safewalkteam/cmpgwas5j000p01pd50dbdte4';
  static const String dawn =
      'mapbox://styles/safewalkteam/cmobay96u00a801s805jsegqr';
  static const String dusk =
      'mapbox://styles/safewalkteam/cmpgwfdnc003q01se6jghawyp';
  static const String night =
      'mapbox://styles/safewalkteam/cmpgwfyur000h01r6fi4o9w3d';
  static const String dark =
      'mapbox://styles/safewalkteam/cmpgwfyur000h01r6fi4o9w3d';

  // ── Time-based slot boundaries (hour, 24-h) ──────────────────────────────
  // 05:00–08:59 → dawn
  // 09:00–17:59 → day
  // 18:00–20:59 → dusk
  // 21:00–04:59 → night

  /// Returns the style URI that matches the current local time.
  static String styleForCurrentTime() {
    final hour = DateTime.now().hour;
    if (hour >= 5 && hour < 9) return dawn;
    if (hour >= 9 && hour < 18) return day;
    if (hour >= 18 && hour < 21) return dusk;
    return night;
  }
}
