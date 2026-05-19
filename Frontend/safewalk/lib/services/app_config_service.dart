import 'dart:io';

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

class AppConfigService {
  static const _keyMapboxAccessToken = 'app_config_mapbox_access_token';

  static bool get _useSecureStorage =>
      !kIsWeb && (Platform.isAndroid || Platform.isIOS);

  final FlutterSecureStorage _secure;

  AppConfigService({FlutterSecureStorage? storage})
    : _secure = storage ?? const FlutterSecureStorage();

  Future<void> _write(String key, String value) async {
    if (_useSecureStorage) {
      await _secure.write(key: key, value: value);
    } else {
      try {
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString(key, value);
      } catch (_) {
        // Ignore storage errors in unsupported test environments.
      }
    }
  }

  Future<String?> _read(String key) async {
    if (_useSecureStorage) {
      return _secure.read(key: key);
    }

    try {
      final prefs = await SharedPreferences.getInstance();
      return prefs.getString(key);
    } catch (_) {
      return null;
    }
  }

  Future<void> _delete(String key) async {
    if (_useSecureStorage) {
      await _secure.delete(key: key);
    } else {
      try {
        final prefs = await SharedPreferences.getInstance();
        await prefs.remove(key);
      } catch (_) {
        // Ignore storage errors in unsupported test environments.
      }
    }
  }

  Future<String?> get mapboxAccessToken => _read(_keyMapboxAccessToken);

  Future<void> saveMapboxAccessToken(String token) async {
    await _write(_keyMapboxAccessToken, token);
  }

  Future<void> clearMapboxAccessToken() async {
    await _delete(_keyMapboxAccessToken);
  }
}


