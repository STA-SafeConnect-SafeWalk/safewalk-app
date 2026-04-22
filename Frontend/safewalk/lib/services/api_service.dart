// ApiService acts as the **service layer** between ViewModels and the network.
//
// It uses [ApiClient] for HTTP calls and [AuthService] for token persistence.
// Exposes domain-specific methods so that ViewModels never deal with raw
// endpoints, request construction, or token management directly.
//
// Token lifecycle:
//   - After sign-in the three tokens are persisted via [AuthService].
//   - Before every protected call [_ensureAuth] loads the idToken and sets
//     it on the [ApiClient].
//   - If a protected call returns 401 the service attempts a silent token
//     refresh using the stored refreshToken.

import 'package:safewalk/core/constants/api_constants.dart';
import 'package:safewalk/core/network/api_client.dart';
import 'package:safewalk/core/network/api_result.dart';
import 'package:safewalk/services/auth_service.dart';

class ApiService {
  late final ApiClient _client;
  late final AuthService _authService;

  ApiService({ApiClient? client, AuthService? authService}) {
    _client =
        client ??
        ApiClient(
          baseUrl: ApiConstants.baseUrl,
          timeout: ApiConstants.defaultTimeout,
        );
    _authService = authService ?? AuthService();
  }

  /// Exposes the [AuthService] so ViewModels can check token state.
  AuthService get authService => _authService;

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /// Loads the stored idToken and sets it on the [ApiClient] so that the next
  /// request includes the `Authorization: Bearer <idToken>` header.
  /// Returns `false` if no token is available (user is not logged in).
  Future<bool> _ensureAuth() async {
    final token = await _authService.idToken;
    if (token == null || token.isEmpty) return false;
    _client.authToken = token;
    return true;
  }

  /// Executes [request]. If it returns 401, attempts a silent token refresh
  /// and retries once.
  Future<ApiResult> _authenticatedRequest(
    Future<ApiResult> Function() request,
  ) async {
    if (!await _ensureAuth()) {
      return ApiResult.error(
        statusCode: 401,
        message: 'Not authenticated. Please sign in first.',
      );
    }

    var result = await request();

    // If 401, try a silent refresh and retry once
    if (result.statusCode == 401) {
      final refreshed = await _tryRefreshToken();
      if (refreshed) {
        result = await request();
      }
    }

    return result;
  }

  /// Attempts to refresh the token silently. Returns `true` on success.
  Future<bool> _tryRefreshToken() async {
    final storedRefreshToken = await _authService.refreshToken;
    if (storedRefreshToken == null || storedRefreshToken.isEmpty) return false;

    // Temporarily clear auth header so the refresh call doesn't send an
    // expired idToken.
    _client.authToken = null;

    final result = await _client.post(
      ApiConstants.authRefresh,
      body: {'refreshToken': storedRefreshToken},
    );

    if (result.isSuccess && result.data is Map) {
      final data = result.data as Map<String, dynamic>;
      final newIdToken = data['idToken'] as String?;
      final newAccessToken = data['accessToken'] as String?;
      if (newIdToken != null && newAccessToken != null) {
        await _authService.saveRefreshedTokens(
          idToken: newIdToken,
          accessToken: newAccessToken,
        );
        _client.authToken = newIdToken;
        return true;
      }
    }
    return false;
  }

  // ===========================================================================
  // PUBLIC AUTH ENDPOINTS (no JWT needed)
  // ===========================================================================

  /// Signs up a new user with [email], [password], and optional [displayName].
  Future<ApiResult> signUp(
    String email,
    String password, {
    String? displayName,
  }) async {
    return _client.post(
      ApiConstants.authSignUp,
      body: {
        'email': email,
        'password': password,
        if (displayName != null && displayName.isNotEmpty)
          'displayName': displayName,
      },
    );
  }

  /// Confirms the email address using the 6-digit [confirmationCode].
  Future<ApiResult> confirmSignUp(String email, String confirmationCode) async {
    return _client.post(
      ApiConstants.authConfirm,
      body: {'email': email, 'confirmationCode': confirmationCode},
    );
  }

  /// Signs in with [email] and [password].
  /// On success the returned tokens are automatically stored.
  Future<ApiResult> signIn(String email, String password) async {
    // Make sure no stale token is sent along
    _client.authToken = null;

    final result = await _client.post(
      ApiConstants.authSignIn,
      body: {'email': email, 'password': password},
    );

    if (result.isSuccess && result.data is Map) {
      final data = result.data as Map<String, dynamic>;
      final idToken = data['idToken'] as String?;
      final accessToken = data['accessToken'] as String?;
      final refreshToken = data['refreshToken'] as String?;

      if (idToken != null && accessToken != null && refreshToken != null) {
        await _authService.saveTokens(
          idToken: idToken,
          accessToken: accessToken,
          refreshToken: refreshToken,
        );
        _client.authToken = idToken;
      }
    }

    return result;
  }

  /// Refreshes the tokens using the stored refresh token.
  /// On success the new idToken and accessToken are persisted.
  Future<ApiResult> refreshTokens() async {
    final storedRefreshToken = await _authService.refreshToken;
    if (storedRefreshToken == null || storedRefreshToken.isEmpty) {
      return ApiResult.error(
        statusCode: 400,
        message: 'No refresh token available.',
      );
    }

    _client.authToken = null;

    final result = await _client.post(
      ApiConstants.authRefresh,
      body: {'refreshToken': storedRefreshToken},
    );

    if (result.isSuccess && result.data is Map) {
      final data = result.data as Map<String, dynamic>;
      final newIdToken = data['idToken'] as String?;
      final newAccessToken = data['accessToken'] as String?;
      if (newIdToken != null && newAccessToken != null) {
        await _authService.saveRefreshedTokens(
          idToken: newIdToken,
          accessToken: newAccessToken,
        );
        _client.authToken = newIdToken;
      }
    }

    return result;
  }

  /// Signs out the current user (global sign-out on the server).
  /// Clears all stored tokens regardless of server response.
  Future<ApiResult> signOut() async {
    final storedAccessToken = await _authService.accessToken;

    // Best-effort server sign-out
    ApiResult result;
    if (storedAccessToken != null && storedAccessToken.isNotEmpty) {
      _client.authToken = null;
      result = await _client.post(
        ApiConstants.authSignOut,
        body: {'accessToken': storedAccessToken},
      );
    } else {
      result = ApiResult.success(statusCode: 200);
    }

    // Always clear local tokens
    await _authService.clearTokens();
    _client.authToken = null;

    return result;
  }

  /// Requests a password-reset code for [email].
  Future<ApiResult> forgotPassword(String email) async {
    return _client.post(
      ApiConstants.authForgotPassword,
      body: {'email': email},
    );
  }

  /// Resets the password using [confirmationCode] and [newPassword].
  Future<ApiResult> confirmForgotPassword(
    String email,
    String confirmationCode,
    String newPassword,
  ) async {
    return _client.post(
      ApiConstants.authConfirmForgotPassword,
      body: {
        'email': email,
        'confirmationCode': confirmationCode,
        'newPassword': newPassword,
      },
    );
  }

  // ===========================================================================
  // PROTECTED ENDPOINTS (JWT required – auto-attached via _authenticatedRequest)
  // ===========================================================================

  /// Checks whether the current user's profile exists in DynamoDB.
  /// Returns 200 with profile data if it exists, 404 if not.
  Future<ApiResult> getMe() async {
    return _authenticatedRequest(() => _client.get(ApiConstants.me));
  }

  /// Creates the user profile in DynamoDB (call once after first sign-in).
  Future<ApiResult> registerProfile({String? displayName}) async {
    return _authenticatedRequest(
      () => _client.post(
        ApiConstants.register,
        body: displayName != null ? {'displayName': displayName} : {},
      ),
    );
  }

  /// Registers the user on the SafeWalk platform.
  Future<ApiResult> registerPlatform() async {
    return _authenticatedRequest(
      () => _client.post(ApiConstants.registerPlatform),
    );
  }

  /// Retrieves the current sharing code for the logged-in user.
  Future<ApiResult> getSharingCode() async {
    return _authenticatedRequest(() => _client.get(ApiConstants.sharingCode));
  }

  /// Generates a new 24-hour sharing code.
  Future<ApiResult> generateSharingCode() async {
    return _authenticatedRequest(() => _client.post(ApiConstants.sharingCode));
  }

  /// Connects with a friend using their [sharingCode].
  Future<ApiResult> connectWithSharingCode(String sharingCode) async {
    return _authenticatedRequest(
      () => _client.post(
        ApiConstants.sharingCodeConnect,
        body: {'sharingCode': sharingCode},
      ),
    );
  }

  /// Adds a contact back using their SafeWalk ID without a sharing code.
  Future<ApiResult> connectBackWithContact(String peerSafeWalkId) async {
    return _authenticatedRequest(
      () => _client.post(
        ApiConstants.contactsConnectBack,
        body: {'peerSafeWalkId': peerSafeWalkId},
      ),
    );
  }

  /// Fetches all trusted contacts for the logged-in user.
  Future<ApiResult> getContacts() async {
    return _authenticatedRequest(() => _client.get(ApiConstants.contacts));
  }

  /// Fetches the tip of the day and all additional tips.
  Future<ApiResult> getTips() async {
    return _authenticatedRequest(() => _client.get(ApiConstants.tips));
  }

  /// Updates sharing settings for a specific contact.
  Future<ApiResult> updateContactSettings(
    String contactId, {
    required bool locationSharing,
    required bool sosSharing,
  }) async {
    return _authenticatedRequest(
      () => _client.patch(
        ApiConstants.contactById(contactId),
        body: {'locationSharing': locationSharing, 'sosSharing': sosSharing},
      ),
    );
  }

  /// Removes a trusted contact.
  Future<ApiResult> deleteContact(String contactId) async {
    return _authenticatedRequest(
      () => _client.delete(ApiConstants.contactById(contactId)),
    );
  }

  /// Triggers an SOS alarm for the current user.
  Future<ApiResult> triggerSos({
    double? lat,
    double? lng,
    double? accuracy,
  }) async {
    assert(
      (lat == null && lng == null && accuracy == null) ||
          (lat != null && lng != null && accuracy != null),
      'lat, lng and accuracy must be provided together.',
    );

    final hasLocation = lat != null && lng != null && accuracy != null;

    return _authenticatedRequest(
      () => _client.post(
        ApiConstants.sos,
        body: hasLocation
            ? {
                'geoLocation': {'lat': lat, 'lng': lng, 'accuracy': accuracy},
              }
            : <String, dynamic>{},
      ),
    );
  }

  /// Cancels an active SOS alarm.
  Future<ApiResult> cancelSos(String sosId) async {
    return _authenticatedRequest(
      () => _client.delete(ApiConstants.sosById(sosId)),
    );
  }

  /// Immediately propagates a pending SOS to the platform, skipping the delay.
  Future<ApiResult> propagateSos(String sosId) async {
    return _authenticatedRequest(
      () => _client.post(ApiConstants.sosPropagate(sosId)),
    );
  }

  /// Updates the location of an active SOS alarm.
  Future<ApiResult> updateSosLocation({
    required String sosId,
    required double lat,
    required double lng,
    required double accuracy,
  }) async {
    return _authenticatedRequest(
      () => _client.patch(
        ApiConstants.sosById(sosId),
        body: {
          'geoLocation': {'lat': lat, 'lng': lng, 'accuracy': accuracy},
        },
      ),
    );
  }

  // ===========================================================================
  // PUSH NOTIFICATIONS (JWT required)
  // ===========================================================================

  /// Registers a device token for push notifications.
  Future<ApiResult> registerDevice({
    required String deviceToken,
    required String platform,
  }) async {
    return _authenticatedRequest(
      () => _client.post(
        ApiConstants.deviceRegister,
        body: {'deviceToken': deviceToken, 'platform': platform},
      ),
    );
  }

  /// Unregisters a device token.
  Future<ApiResult> unregisterDevice({required String deviceToken}) async {
    return _authenticatedRequest(
      () => _client.post(
        ApiConstants.deviceUnregister,
        body: {'deviceToken': deviceToken},
      ),
    );
  }

  /// Sends a push notification to a specific user (for testing).
  Future<ApiResult> sendNotification({
    required String targetUserId,
    required String title,
    required String body,
    Map<String, String>? data,
  }) async {
    return _authenticatedRequest(
      () => _client.post(
        ApiConstants.notificationsSend,
        body: {
          'targetUserId': targetUserId,
          'title': title,
          'body': body,
          if (data != null) 'data': data,
        },
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Legacy / testing
  // ---------------------------------------------------------------------------

  /// Sends a test POST request to verify backend connectivity.
  Future<ApiResult> testConnection() async {
    return _authenticatedRequest(
      () => _client.post(ApiConstants.registerPlatform),
    );
  }
}
