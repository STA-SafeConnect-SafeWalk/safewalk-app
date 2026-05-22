// Entry point of the SafeWalk application.
//
// Sets up all [ChangeNotifierProvider]s (one per ViewModel) at the top of
// the widget tree, then launches [SafeWalkApp].
//
// Providing ViewModels here ensures they are accessible from every screen
// and their lifecycle is tied to the app's lifetime.

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:mapbox_maps_flutter/mapbox_maps_flutter.dart';

import 'package:safewalk/app.dart';
import 'package:safewalk/services/api_service.dart';
import 'package:safewalk/services/auth_service.dart';
import 'package:safewalk/services/headphone_service.dart';
import 'package:safewalk/services/mapbox_places_service.dart';
import 'package:safewalk/services/push_notification_service.dart';
import 'package:safewalk/services/map_theme_service.dart';
import 'package:safewalk/viewmodels/home_viewmodel.dart';
import 'package:safewalk/viewmodels/login_viewmodel.dart';
import 'package:safewalk/viewmodels/map_viewmodel.dart';
import 'package:safewalk/viewmodels/contacts_viewmodel.dart';
import 'package:safewalk/viewmodels/settings_viewmodel.dart';
import 'package:safewalk/viewmodels/tips_viewmodel.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Set the Mapbox access token before any MapView is created.
  if (MapboxPlacesService.accessTokenFallback.isNotEmpty) {
    MapboxOptions.setAccessToken(MapboxPlacesService.accessTokenFallback);
  }

  // Shared services so all ViewModels use the same instances.
  final authService = AuthService();
  final apiService = ApiService(authService: authService);
  final pushService = PushNotificationService(apiService: apiService);
  final headphoneService = HeadphoneService();
  final mapThemeService = MapThemeService();

  // Initialise Firebase (non-blocking – push won't work until configured).
  pushService.init();

  // Start listening for headphone connection changes.
  headphoneService.init();

  // Load persisted map theme preference before the first frame.
  await mapThemeService.init();

  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider<HeadphoneService>.value(value: headphoneService),
        ChangeNotifierProvider<MapThemeService>.value(value: mapThemeService),
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
          create: (_) => MapViewModel(
            apiService: apiService,
            mapThemeService: mapThemeService,
          ),
        ),
        ChangeNotifierProvider(
          create: (_) => ContactsViewModel(apiService: apiService),
        ),
        ChangeNotifierProvider(
          create: (_) => TipsViewModel(
            apiService: apiService,
            headphoneService: headphoneService,
          ),
        ),
        ChangeNotifierProvider(
          create: (_) => SettingsViewModel(apiService: apiService),
        ),
      ],
      child: const SafeWalkApp(),
    ),
  );
}
