import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:safewalk/app.dart';
import 'package:safewalk/services/api_service.dart';
import 'package:safewalk/services/auth_service.dart';
import 'package:safewalk/viewmodels/login_viewmodel.dart';

class FakeAuthService extends AuthService {
  FakeAuthService({this.hasTokensValue = false});

  bool hasTokensValue;

  @override
  Future<bool> get hasTokens async => hasTokensValue;
}

class FakeApiService extends ApiService {
  FakeApiService({required AuthService authService})
    : _authService = authService,
      super(authService: authService);

  final AuthService _authService;

  @override
  AuthService get authService => _authService;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('SafeWalkApp shows login after session restore', (tester) async {
    final auth = FakeAuthService(hasTokensValue: false);
    final api = FakeApiService(authService: auth);
    final loginVm = LoginViewModel(apiService: api);

    await tester.pumpWidget(
      ChangeNotifierProvider<LoginViewModel>.value(
        value: loginVm,
        child: const SafeWalkApp(),
      ),
    );

    expect(find.byType(CircularProgressIndicator), findsOneWidget);

    await tester.pumpAndSettle();

    expect(find.text('SafeWalk'), findsWidgets);
  });
}

