// AuthService manages JWT token storage and retrieval.
//
// On iOS / Android:  tokens are stored in flutter_secure_storage (Keychain /
//                    Android Keystore) for maximum security.
// On macOS / desktop: tokens are stored in shared_preferences because macOS
//                    Keychain access requires a signed provisioning profile
//                    which is unavailable in ad-hoc development builds.
//
// Usage:
//   final auth = AuthService();
//   await auth.saveTokens(idToken: '...', accessToken: '...', refreshToken: '...');
//   final id = await auth.idToken;

import 'dart:io';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

class AuthService {
  static const _keyIdToken = 'auth_id_token';
  static const _keyAccessToken = 'auth_access_token';
  static const _keyRefreshToken = 'auth_refresh_token';

  /// True when the platform supports flutter_secure_storage without a
  /// provisioning profile (i.e. mobile / web).
  static bool get _useSecureStorage =>
      !kIsWeb && (Platform.isAndroid || Platform.isIOS);

  final FlutterSecureStorage _secure;

  AuthService({FlutterSecureStorage? storage})
      : _secure = storage ?? const FlutterSecureStorage();

  // ---------------------------------------------------------------------------
  // Internal read / write helpers
  // ---------------------------------------------------------------------------

  Future<void> _write(String key, String value) async {
    if (_useSecureStorage) {
      await _secure.write(key: key, value: value);
    } else {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(key, value);
    }
  }

  Future<String?> _read(String key) async {
    if (_useSecureStorage) {
      return _secure.read(key: key);
    } else {
      final prefs = await SharedPreferences.getInstance();
      return prefs.getString(key);
    }
  }

  Future<void> _delete(String key) async {
    if (_useSecureStorage) {
      await _secure.delete(key: key);
    } else {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(key);
    }
  }

  // ---------------------------------------------------------------------------
  // Token persistence
  // ---------------------------------------------------------------------------

  /// Persists all three tokens received after a successful sign-in.
  Future<void> saveTokens({
    required String idToken,
    required String accessToken,
    required String refreshToken,
  }) async {
    await Future.wait([
      _write(_keyIdToken, idToken),
      _write(_keyAccessToken, accessToken),
      _write(_keyRefreshToken, refreshToken),
    ]);
  }

  /// Updates only the idToken and accessToken (used after a token refresh).
  Future<void> saveRefreshedTokens({
    required String idToken,
    required String accessToken,
  }) async {
    await Future.wait([
      _write(_keyIdToken, idToken),
      _write(_keyAccessToken, accessToken),
    ]);
  }

  /// Returns the stored ID token, or `null` if not present.
  Future<String?> get idToken => _read(_keyIdToken);

  /// Returns the stored access token, or `null` if not present.
  Future<String?> get accessToken => _read(_keyAccessToken);

  /// Returns the stored refresh token, or `null` if not present.
  Future<String?> get refreshToken => _read(_keyRefreshToken);

  /// Returns `true` if an ID token is stored (user has logged in before).
  Future<bool> get hasTokens async => (await idToken) != null;

  /// Clears all stored tokens (used on sign-out or session expiry).
  Future<void> clearTokens() async {
    await Future.wait([
      _delete(_keyIdToken),
      _delete(_keyAccessToken),
      _delete(_keyRefreshToken),
    ]);
  }
}
