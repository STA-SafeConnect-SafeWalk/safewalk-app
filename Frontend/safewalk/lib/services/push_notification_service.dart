import 'package:flutter/foundation.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:safewalk/firebase_options.dart';
import 'package:safewalk/services/api_service.dart';

class PushNotificationService {
  final ApiService _apiService;

  FirebaseMessaging? _messaging;
  String? _currentToken;
  Future<bool>? _initFuture;

  final FlutterLocalNotificationsPlugin _localNotifications =
      FlutterLocalNotificationsPlugin();

  static const _androidChannel = AndroidNotificationChannel(
    'safewalk_push',
    'SafeWalk Notifications',
    description: 'Push notifications from SafeWalk',
    importance: Importance.high,
  );

  PushNotificationService({required ApiService apiService})
      : _apiService = apiService;

  String? get currentToken => _currentToken;

  Future<bool> init() {
    _initFuture ??= _doInit();
    return _initFuture!;
  }

  Future<bool> _doInit() async {
    try {
      if (Firebase.apps.isEmpty) {
        await Firebase.initializeApp(
          options: DefaultFirebaseOptions.currentPlatform,
        );
      }
      _messaging = FirebaseMessaging.instance;

      final settings = await _messaging!.requestPermission(
        alert: true,
        badge: true,
        sound: true,
      );

      if (settings.authorizationStatus == AuthorizationStatus.denied) {
        debugPrint('[Push] Permission denied by user.');
        return false;
      }

      FirebaseMessaging.onMessage.listen(_onForegroundMessage);
      _messaging!.onTokenRefresh.listen(_onTokenRefresh);
      await _initLocalNotifications();

      await _messaging!.setForegroundNotificationPresentationOptions(
        alert: true,
        badge: true,
        sound: true,
      );

      debugPrint('[Push] Firebase initialised successfully.');
      return true;
    } catch (e) {
      debugPrint('[Push] Firebase init failed: $e');
      return false;
    }
  }

  /// Retrieves the FCM token and registers it with the backend.
  /// Call after the user has signed in.
  Future<void> registerDevice() async {
    await init();
    if (_messaging == null) return;

    try {
      if (defaultTargetPlatform == TargetPlatform.iOS) {
        await _waitForApnsToken();
      }

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

  Future<void> _initLocalNotifications() async {
    const androidInit = AndroidInitializationSettings('@mipmap/ic_launcher');
    const darwinInit = DarwinInitializationSettings();
    const initSettings = InitializationSettings(
      android: androidInit,
      iOS: darwinInit,
    );
    await _localNotifications.initialize(initSettings);

    await _localNotifications
        .resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(_androidChannel);
  }

  Future<void> _waitForApnsToken() async {
    const maxAttempts = 20;
    for (var i = 0; i < maxAttempts; i++) {
      final apnsToken = await _messaging!.getAPNSToken();
      if (apnsToken != null) {
        debugPrint('[Push] APNs token available after ${i * 500}ms.');
        return;
      }
      await Future.delayed(const Duration(milliseconds: 500));
    }
    debugPrint('[Push] APNs token not available after 10s, proceeding anyway.');
  }

  void _onForegroundMessage(RemoteMessage message) {
    final notification = message.notification;
    if (notification == null) return;

    _localNotifications.show(
      notification.hashCode,
      notification.title,
      notification.body,
      NotificationDetails(
        android: AndroidNotificationDetails(
          _androidChannel.id,
          _androidChannel.name,
          channelDescription: _androidChannel.description,
          importance: Importance.high,
          priority: Priority.high,
          icon: '@mipmap/ic_launcher',
        ),
        iOS: const DarwinNotificationDetails(
          presentAlert: true,
          presentBadge: true,
          presentSound: true,
        ),
      ),
    );
  }

  Future<void> _onTokenRefresh(String newToken) async {
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
