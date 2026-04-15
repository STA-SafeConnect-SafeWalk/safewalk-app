import 'package:flutter/foundation.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:safewalk/firebase_options.dart';
import 'package:safewalk/services/api_service.dart';

/// Handles Firebase Cloud Messaging (FCM) setup and device-token registration
/// with the SafeWalk backend (which uses Amazon SNS for delivery).
///
/// Lifecycle:
///   1. [init] – called once at app start (initialises Firebase + FCM).
///   2. [registerDevice] – called after successful sign-in.
///   3. [unregisterDevice] – called on sign-out.
class PushNotificationService {
  final ApiService _apiService;

  FirebaseMessaging? _messaging;
  String? _currentToken;
  Future<bool>? _initFuture;

  PushNotificationService({required ApiService apiService})
      : _apiService = apiService;

  /// Initialise Firebase and set up foreground message handling.
  /// Returns `true` if initialisation succeeded.
  /// Safe to call multiple times — subsequent calls return the same future.
  Future<bool> init() {
    _initFuture ??= _doInit();
    return _initFuture!;
  }

  Future<bool> _doInit() async {
    try {
      await Firebase.initializeApp(
        options: DefaultFirebaseOptions.currentPlatform,
      );
      _messaging = FirebaseMessaging.instance;

      // Request permission (required on iOS / web).
      final settings = await _messaging!.requestPermission(
        alert: true,
        badge: true,
        sound: true,
      );

      if (settings.authorizationStatus == AuthorizationStatus.denied) {
        debugPrint('[Push] Permission denied by user.');
        return false;
      }

      // Listen for foreground messages.
      FirebaseMessaging.onMessage.listen(_onForegroundMessage);

      // Listen for token refresh so we can re-register.
      _messaging!.onTokenRefresh.listen(_onTokenRefresh);

      debugPrint('[Push] Firebase initialised successfully.');
      return true;
    } catch (e) {
      debugPrint('[Push] Firebase init failed (expected until configured): $e');
      return false;
    }
  }

  /// Retrieves the FCM token and registers it with the backend.
  /// Call after the user has signed in.
  Future<void> registerDevice() async {
    debugPrint('[Push] registerDevice called, awaiting init...');
    // Ensure Firebase is ready before trying to get a token.
    await init();
    if (_messaging == null) {
      debugPrint('[Push] registerDevice aborted: _messaging is null.');
      return;
    }

    try {
      // For web, pass the VAPID key if available.
      final token = await _messaging!.getToken(
        vapidKey: DefaultFirebaseOptions.vapidKey,
      );

      if (token == null || token.isEmpty) {
        debugPrint('[Push] No FCM token available.');
        return;
      }

      _currentToken = token;

      final platform = _detectPlatform();
      final result = await _apiService.registerDevice(
        deviceToken: token,
        platform: platform,
      );

      if (result.isSuccess) {
        debugPrint('[Push] Device registered with backend ($platform).');
      } else {
        debugPrint('[Push] Device registration failed: ${result.message}');
      }
    } catch (e) {
      debugPrint('[Push] registerDevice error: $e');
    }
  }

  /// Unregisters the current device token from the backend.
  /// Call before or during sign-out.
  Future<void> unregisterDevice() async {
    if (_currentToken == null) return;

    try {
      await _apiService.unregisterDevice(deviceToken: _currentToken!);
      debugPrint('[Push] Device unregistered.');
    } catch (e) {
      debugPrint('[Push] unregisterDevice error: $e');
    }

    _currentToken = null;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  void _onForegroundMessage(RemoteMessage message) {
    debugPrint('[Push] Foreground message: ${message.notification?.title}');
    // TODO: Show an in-app notification banner / snackbar.
  }

  Future<void> _onTokenRefresh(String newToken) async {
    debugPrint('[Push] Token refreshed, re-registering…');
    _currentToken = newToken;
    await registerDevice();
  }

  String _detectPlatform() {
    if (kIsWeb) return 'web';
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return 'android';
      case TargetPlatform.iOS:
        return 'ios';
      default:
        return 'web';
    }
  }
}
