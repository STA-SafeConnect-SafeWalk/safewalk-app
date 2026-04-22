// Centralised API configuration so that URLs and endpoints are defined in
// one place and can be changed easily (e.g. for staging vs. production).

class ApiConstants {
  // Prevent instantiation.
  ApiConstants._();

  /// Base URL of the SafeWalk backend API.
  static const String baseUrl =
      'https://r7fu37l4m5.execute-api.eu-central-1.amazonaws.com';

  /// Default timeout duration for HTTP requests.
  static const Duration defaultTimeout = Duration(seconds: 15);

  // ---------------------------------------------------------------------------
  // Auth endpoints (public – no JWT required)
  // ---------------------------------------------------------------------------

  /// POST – Sign up a new user account.
  static const String authSignUp = '/auth/sign-up';

  /// POST – Confirm email address with verification code.
  static const String authConfirm = '/auth/confirm';

  /// POST – Sign in and receive JWT tokens.
  static const String authSignIn = '/auth/sign-in';

  /// POST – Refresh idToken / accessToken using refreshToken.
  static const String authRefresh = '/auth/refresh';

  /// POST – Sign out (invalidate all tokens).
  static const String authSignOut = '/auth/sign-out';

  /// POST – Request a password-reset code via email.
  static const String authForgotPassword = '/auth/forgot-password';

  /// POST – Set a new password using the reset code.
  static const String authConfirmForgotPassword =
      '/auth/confirm-forgot-password';

  // ---------------------------------------------------------------------------
  // Protected endpoints (JWT required)
  // ---------------------------------------------------------------------------

  /// GET – Check whether the current user's profile exists in DynamoDB.
  static const String me = '/me';

  /// POST – Create user profile in DynamoDB (once after first login).
  static const String register = '/register';

  /// POST – Register user on the SafeWalk platform.
  static const String registerPlatform = '/register/platform';

  /// GET  – Retrieve current sharing code.
  /// POST – Generate a new sharing code.
  static const String sharingCode = '/sharing-code';

  /// POST – Connect with a friend using their sharing code.
  static const String sharingCodeConnect = '/sharing-code/connect';

  /// POST – Add a contact back without sharing a code.
  static const String contactsConnectBack = '/contacts/connect-back';

  /// GET – List all trusted contacts.
  static const String contacts = '/contacts';

  /// GET – Returns tip of the day and additional safety tips.
  static const String tips = '/tips';

  /// POST – Trigger a new SOS alarm.
  static const String sos = '/sos';

  /// Returns the path for a specific contact: /contacts/{contactId}
  static String contactById(String contactId) => '/contacts/$contactId';

  /// Returns the path for a specific SOS event: /sos/{sosId}
  static String sosById(String sosId) => '/sos/$sosId';

  // ---------------------------------------------------------------------------
  // Push notification endpoints (JWT required)
  // ---------------------------------------------------------------------------

  /// POST – Register a device token for push notifications.
  static const String deviceRegister = '/device/register';

  /// POST – Unregister a device token.
  static const String deviceUnregister = '/device/unregister';

  /// POST – Send a push notification to a specific user.
  static const String notificationsSend = '/notifications/send';
}
