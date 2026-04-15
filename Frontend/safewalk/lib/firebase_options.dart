// ============================================================================
// Firebase configuration for SafeWalk.
//
// IMPORTANT: Replace the placeholder values below with your real Firebase
// project configuration. You can get these from the Firebase Console:
//   1. Go to https://console.firebase.google.com
//   2. Create a project (or use an existing one).
//   3. Add a Web app → copy the config object values here.
//   4. Enable Cloud Messaging in Project Settings → Cloud Messaging.
//
// Alternatively, run `flutterfire configure` to auto-generate this file.
// ============================================================================

import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart'
    show defaultTargetPlatform, kIsWeb, TargetPlatform;

class DefaultFirebaseOptions {
  /// VAPID key for web push (from Firebase Console → Cloud Messaging → Web Push certificates).
  /// Set to `null` until configured.
  static const String? vapidKey = ' BCfUrdRW9pnshoQ2sdr90_VKbPLNMm2vklCeFRNCmoEIcwUZlMJLXb9FF6qC4c2YT5IGbBbzWUjSqHyg2cV_bRA';

  static FirebaseOptions get currentPlatform {
    if (kIsWeb) return web;
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return android;
      case TargetPlatform.iOS:
        return ios;
      default:
        throw UnsupportedError('Unsupported platform for Firebase.');
    }
  }

  // ---------------------------------------------------------------------------
  // Web – replace with values from Firebase Console

  static const FirebaseOptions web = FirebaseOptions(
    apiKey: 'AIzaSyAzxr1hhh-d11WM8AJ7-ZDQSvBXlIRyQLo',
    appId: '1:188485248388:web:0d90c579ae97744da5e9d1',
    messagingSenderId: '188485248388',
    projectId: 'safewalk-backend-sns',
    authDomain: 'safewalk-backend-sns.firebaseapp.com',
    storageBucket: 'safewalk-backend-sns.firebasestorage.app',
    measurementId: 'G-BH29G0MRQN',
  );

  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Android – replace after running `flutterfire configure`

  static const FirebaseOptions android = FirebaseOptions(
    apiKey: 'AIzaSyB_FzVnZcx3X1D6ycgwUqMr8dHx5e1quu4',
    appId: '1:188485248388:android:94e40e5cfc2432e1a5e9d1',
    messagingSenderId: '188485248388',
    projectId: 'safewalk-backend-sns',
    storageBucket: 'safewalk-backend-sns.firebasestorage.app',
  );

  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // iOS – replace after running `flutterfire configure`

  static const FirebaseOptions ios = FirebaseOptions(
    apiKey: 'AIzaSyBf73BwjnKjYZlxdCU_-4I-e2NpC1LjyD0',
    appId: '1:188485248388:ios:59130ef3941925aca5e9d1',
    messagingSenderId: '188485248388',
    projectId: 'safewalk-backend-sns',
    storageBucket: 'safewalk-backend-sns.firebasestorage.app',
    iosBundleId: 'com.example.safewalk',
  );

  // ---------------------------------------------------------------------------
}