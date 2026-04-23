// Entry point of the SafeWalk application.
//
// Sets up all [ChangeNotifierProvider]s (one per ViewModel) at the top of
// the widget tree, then launches [SafeWalkApp].
//
// Providing ViewModels here ensures they are accessible from every screen
// and their lifecycle is tied to the app's lifetime.

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:safewalk/app.dart';
import 'package:safewalk/services/api_service.dart';
import 'package:safewalk/services/auth_service.dart';
import 'package:safewalk/services/push_notification_service.dart';
import 'package:safewalk/viewmodels/home_viewmodel.dart';
import 'package:safewalk/viewmodels/login_viewmodel.dart';
import 'package:safewalk/viewmodels/map_viewmodel.dart';
import 'package:safewalk/viewmodels/contacts_viewmodel.dart';
import 'package:safewalk/viewmodels/settings_viewmodel.dart';
import 'package:safewalk/viewmodels/tips_viewmodel.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();

  // Shared services so all ViewModels use the same instances.
  final authService = AuthService();
  final apiService = ApiService(authService: authService);
  final pushService = PushNotificationService(apiService: apiService);

  // Initialise Firebase (non-blocking – push won't work until configured).
  pushService.init();

  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider(
          create: (_) => LoginViewModel(
            apiService: apiService,
            pushNotificationService: pushService,
          ),
        ),
        ChangeNotifierProvider(
          create: (_) => HomeViewModel(apiService: apiService),
        ),
        ChangeNotifierProvider(
          create: (_) => MapViewModel(apiService: apiService),
        ),
        ChangeNotifierProvider(
          create: (_) => ContactsViewModel(apiService: apiService),
        ),
        ChangeNotifierProvider(
          create: (_) => TipsViewModel(apiService: apiService),
        ),
        ChangeNotifierProvider(create: (_) => SettingsViewModel()),
      ],
      child: const SafeWalkApp(),
    ),
  );
}
