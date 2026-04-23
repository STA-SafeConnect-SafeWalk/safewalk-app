// Basic smoke test for the SafeWalk application.
//
// Verifies that the app boots without errors and shows the login screen.

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:safewalk/app.dart';
import 'package:safewalk/services/api_service.dart';
import 'package:safewalk/viewmodels/home_viewmodel.dart';
import 'package:safewalk/viewmodels/login_viewmodel.dart';
import 'package:safewalk/viewmodels/map_viewmodel.dart';
import 'package:safewalk/viewmodels/contacts_viewmodel.dart';
import 'package:safewalk/viewmodels/settings_viewmodel.dart';
import 'package:safewalk/viewmodels/tips_viewmodel.dart';

void main() {
  testWidgets('App starts and shows login screen', (WidgetTester tester) async {
    final apiService = ApiService();

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider(
            create: (_) => LoginViewModel(apiService: apiService),
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

    await tester.pump();

    final showsLoginTitle = find.text('SafeWalk').evaluate().isNotEmpty;
    final showsLoading = find
        .byType(CircularProgressIndicator)
        .evaluate()
        .isNotEmpty;

    // The app should render either the loading or login state without crashing.
    expect(showsLoginTitle || showsLoading, isTrue);
  });
}
