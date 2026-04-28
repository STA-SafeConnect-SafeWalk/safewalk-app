// SettingsViewModel manages state for the Settings screen.
//
// Loads the user's profile and exposes actions for updating the display name
// and deleting the account. After a successful account deletion, sets
// [isAccountDeleted] so the screen can trigger a full sign-out via
// LoginViewModel.

import 'package:flutter/foundation.dart';
import 'package:safewalk/services/api_service.dart';

class SettingsViewModel extends ChangeNotifier {
  final ApiService _apiService;

  SettingsViewModel({required ApiService apiService})
    : _apiService = apiService;

  // ─── Profile state ────────────────────────────────────────────────────────

  String? _displayName;
  String? get displayName => _displayName;

  String? _email;
  String? get email => _email;

  // ─── Loading / error / success state ──────────────────────────────────────

  bool _isLoading = false;
  bool get isLoading => _isLoading;

  bool _isSaving = false;
  bool get isSaving => _isSaving;

  bool _isDeleting = false;
  bool get isDeleting => _isDeleting;

  String? _errorMessage;
  String? get errorMessage => _errorMessage;

  void clearError() {
    _errorMessage = null;
    notifyListeners();
  }

  String? _successMessage;
  String? get successMessage => _successMessage;

  void clearSuccess() {
    _successMessage = null;
    notifyListeners();
  }

  /// Set to true after the account has been deleted so the screen can
  /// trigger a global sign-out via LoginViewModel.
  bool _isAccountDeleted = false;
  bool get isAccountDeleted => _isAccountDeleted;

  // ─── Load user profile ────────────────────────────────────────────────────

  Future<void> loadProfile() async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      final result = await _apiService.getMe();
      if (result.isSuccess && result.data is Map) {
        final data = result.data as Map<String, dynamic>;
        _displayName = data['displayName'] as String?;
        _email = data['email'] as String?;
      } else {
        _errorMessage = _extractError(result.data, result.message);
      }
    } catch (e) {
      _errorMessage = 'Profil konnte nicht geladen werden: $e';
    }

    _isLoading = false;
    notifyListeners();
  }

  // ─── PATCH /me ─────────────────────────────────────────────────────────────

  Future<void> updateDisplayName(String name) async {
    final trimmed = name.trim();
    if (trimmed.isEmpty) {
      _errorMessage = 'Anzeigename darf nicht leer sein.';
      notifyListeners();
      return;
    }

    _isSaving = true;
    _errorMessage = null;
    notifyListeners();

    try {
      final result = await _apiService.updateDisplayName(trimmed);
      if (result.isSuccess) {
        _displayName = trimmed;
        _successMessage = 'Anzeigename erfolgreich aktualisiert.';
      } else {
        _errorMessage = _extractError(result.data, result.message);
      }
    } catch (e) {
      _errorMessage = 'Anzeigename konnte nicht gespeichert werden: $e';
    }

    _isSaving = false;
    notifyListeners();
  }

  // ─── DELETE /me ────────────────────────────────────────────────────────────

  Future<void> deleteAccount() async {
    _isDeleting = true;
    _errorMessage = null;
    notifyListeners();

    try {
      final result = await _apiService.deleteAccount();
      if (result.isSuccess) {
        _isAccountDeleted = true;
      } else {
        _errorMessage =
            _extractError(result.data, result.message) ??
            'Konto konnte nicht gelöscht werden.';
      }
    } catch (e) {
      _errorMessage = 'Konto konnte nicht gelöscht werden: $e';
    }

    _isDeleting = false;
    notifyListeners();
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  String? _extractError(dynamic data, String? fallback) {
    if (data is Map && data['error'] != null) {
      return data['error'] as String;
    }
    return fallback;
  }
}
