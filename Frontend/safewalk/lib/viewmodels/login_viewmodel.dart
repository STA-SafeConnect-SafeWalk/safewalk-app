// LoginViewModel manages state for the Login / Registration / Password-Reset
// screens.
//
// It holds form field values, validates input, and triggers authentication
// calls via [ApiService]. The View observes this ViewModel through
// [ChangeNotifier].

import 'package:flutter/foundation.dart';
import 'package:safewalk/services/api_service.dart';

/// The different screens / modes the auth flow can be in.
enum AuthMode {
  signIn,
  signUp,
  confirmSignUp,
  forgotPassword,
  confirmForgotPassword,
}

class LoginViewModel extends ChangeNotifier {
  final ApiService _apiService;

  LoginViewModel({ApiService? apiService})
    : _apiService = apiService ?? ApiService();

  // ---------------------------------------------------------------------------
  // Observable state
  // ---------------------------------------------------------------------------

  /// Current auth-flow step.
  AuthMode _authMode = AuthMode.signIn;
  AuthMode get authMode => _authMode;

  /// Status / error message displayed below the form.
  String _statusMessage = '';
  String get statusMessage => _statusMessage;

  /// Whether an auth request is in flight.
  bool _isLoading = false;
  bool get isLoading => _isLoading;

  /// Whether the user has been authenticated successfully.
  bool _isAuthenticated = false;
  bool get isAuthenticated => _isAuthenticated;

  /// Stores the email after sign-up so it can be pre-filled in confirm step.
  String _pendingEmail = '';
  String get pendingEmail => _pendingEmail;

  /// Tracks whether the user just completed sign-up confirmation, so that
  /// the next [signIn] call creates the profile instead of just checking it.
  bool _isFirstLogin = false;

  // ---------------------------------------------------------------------------
  // Mode switching
  // ---------------------------------------------------------------------------

  /// Switches to the given [mode] and clears status message.
  void switchMode(AuthMode mode) {
    _authMode = mode;
    _statusMessage = '';
    notifyListeners();
  }

  /// Convenience: toggles between sign-in and sign-up.
  void toggleMode() {
    switchMode(
      _authMode == AuthMode.signIn ? AuthMode.signUp : AuthMode.signIn,
    );
  }

  // ---------------------------------------------------------------------------
  // Auth actions
  // ---------------------------------------------------------------------------

  /// Signs in with [email] and [password].
  Future<void> signIn(String email, String password) async {
    _isLoading = true;
    _statusMessage = '';
    notifyListeners();

    final result = await _apiService.signIn(email, password);

    if (result.isSuccess) {
      if (_isFirstLogin) {
        // First login after sign-up: create the profile in DynamoDB.
        await _apiService.registerProfile();
        _isFirstLogin = false;
      } else {
        // Normal login: verify the user profile still exists.
        final meResult = await _apiService.getMe();
        if (!meResult.isSuccess) {
          // Profile was deleted – sign out and block access.
          await _apiService.signOut();
          _isAuthenticated = false;
          _statusMessage =
              'Kein Benutzerprofil gefunden. Bitte registriere dich erneut.';
          _isLoading = false;
          notifyListeners();
          return;
        }
      }

      _isAuthenticated = true;
      _statusMessage = 'Login erfolgreich!';
    } else {
      final data = result.data;
      _statusMessage = (data is Map && data['error'] != null)
          ? data['error'] as String
          : result.message ?? 'Login fehlgeschlagen.';
    }

    _isLoading = false;
    notifyListeners();
  }

  /// Registers a new account.
  Future<void> signUp(
    String email,
    String password, {
    String? displayName,
  }) async {
    _isLoading = true;
    _statusMessage = '';
    notifyListeners();

    final result = await _apiService.signUp(
      email,
      password,
      displayName: displayName,
    );

    if (result.isSuccess) {
      _pendingEmail = email;
      _statusMessage =
          'Registrierung erfolgreich! Bitte prüfe deine E-Mails und gib den Bestätigungscode ein.';
      _authMode = AuthMode.confirmSignUp;
    } else {
      final data = result.data;
      _statusMessage = (data is Map && data['error'] != null)
          ? data['error'] as String
          : result.message ?? 'Registrierung fehlgeschlagen.';
    }

    _isLoading = false;
    notifyListeners();
  }

  /// Confirms the email address with [confirmationCode].
  Future<void> confirmSignUp(String email, String confirmationCode) async {
    _isLoading = true;
    _statusMessage = '';
    notifyListeners();

    final result = await _apiService.confirmSignUp(email, confirmationCode);

    if (result.isSuccess) {
      _isFirstLogin = true;
      _statusMessage = 'E-Mail bestätigt! Du kannst dich jetzt anmelden.';
      _authMode = AuthMode.signIn;
    } else {
      final data = result.data;
      _statusMessage = (data is Map && data['error'] != null)
          ? data['error'] as String
          : result.message ?? 'Bestätigung fehlgeschlagen.';
    }

    _isLoading = false;
    notifyListeners();
  }

  /// Triggers the forgot-password flow.
  Future<void> forgotPassword(String email) async {
    _isLoading = true;
    _statusMessage = '';
    notifyListeners();

    final result = await _apiService.forgotPassword(email);

    if (result.isSuccess) {
      _pendingEmail = email;
      _statusMessage =
          'Falls ein Konto mit dieser E-Mail existiert, wurde ein Reset-Code gesendet.';
      _authMode = AuthMode.confirmForgotPassword;
    } else {
      final data = result.data;
      _statusMessage = (data is Map && data['error'] != null)
          ? data['error'] as String
          : result.message ?? 'Anfrage fehlgeschlagen.';
    }

    _isLoading = false;
    notifyListeners();
  }

  /// Resets the password with the code and sets a new one.
  Future<void> confirmForgotPassword(
    String email,
    String confirmationCode,
    String newPassword,
  ) async {
    _isLoading = true;
    _statusMessage = '';
    notifyListeners();

    final result = await _apiService.confirmForgotPassword(
      email,
      confirmationCode,
      newPassword,
    );

    if (result.isSuccess) {
      _statusMessage =
          'Passwort erfolgreich zurückgesetzt. Du kannst dich jetzt anmelden.';
      _authMode = AuthMode.signIn;
    } else {
      final data = result.data;
      _statusMessage = (data is Map && data['error'] != null)
          ? data['error'] as String
          : result.message ?? 'Passwort-Reset fehlgeschlagen.';
    }

    _isLoading = false;
    notifyListeners();
  }

  /// Signs out the current user and resets state.
  Future<void> signOut() async {
    await _apiService.signOut();
    _isAuthenticated = false;
    _authMode = AuthMode.signIn;
    _statusMessage = '';
    notifyListeners();
  }

  /// Tries to restore the session from stored tokens (call on app start).
  Future<void> tryRestoreSession() async {
    final hasTokens = await _apiService.authService.hasTokens;
    if (!hasTokens) return;

    // Try a silent refresh to validate that the refresh token is still good.
    final result = await _apiService.refreshTokens();
    if (result.isSuccess) {
      // Verify the user profile still exists in DynamoDB.
      final meResult = await _apiService.getMe();
      if (meResult.isSuccess) {
        _isAuthenticated = true;
      } else {
        // Profile was deleted – clear tokens and stay signed out.
        await _apiService.authService.clearTokens();
      }
      notifyListeners();
    } else {
      // Tokens are invalid – clear them.
      await _apiService.authService.clearTokens();
    }
  }

  /// Skips authentication (for development / testing purposes).
  void skipLogin() {
    _isAuthenticated = true;
    notifyListeners();
  }
}
