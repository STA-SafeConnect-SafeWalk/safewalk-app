import 'package:flutter_test/flutter_test.dart';
import 'package:safewalk/core/network/api_result.dart';
import 'package:safewalk/services/api_service.dart';
import 'package:safewalk/services/auth_service.dart';
import 'package:safewalk/services/push_notification_service.dart';
import 'package:safewalk/viewmodels/login_viewmodel.dart';

class FakeAuthService extends AuthService {
  FakeAuthService({this.hasTokensValue = false});

  bool hasTokensValue;
  bool cleared = false;

  @override
  Future<bool> get hasTokens async => hasTokensValue;

  @override
  Future<void> clearTokens() async {
    cleared = true;
    hasTokensValue = false;
  }
}

class FakeApiService extends ApiService {
  FakeApiService({required AuthService authService})
    : _authService = authService,
      super(authService: authService);

  final AuthService _authService;

  ApiResult signInResult = ApiResult.success(statusCode: 200);
  ApiResult getMeResult = ApiResult.success(statusCode: 200, data: {'ok': true});
  ApiResult signUpResult = ApiResult.success(statusCode: 200);
  ApiResult confirmSignUpResult = ApiResult.success(statusCode: 200);
  ApiResult registerProfileResult = ApiResult.success(statusCode: 200);
  ApiResult refreshTokensResult = ApiResult.success(statusCode: 200);
  ApiResult signOutResult = ApiResult.success(statusCode: 200);
  bool registerProfileCalled = false;

  @override
  AuthService get authService => _authService;

  @override
  Future<ApiResult> signIn(String email, String password) async => signInResult;

  @override
  Future<ApiResult> getMe() async => getMeResult;

  @override
  Future<ApiResult> signUp(
    String email,
    String password, {
    String? displayName,
  }) async => signUpResult;

  @override
  Future<ApiResult> confirmSignUp(
    String email,
    String confirmationCode,
  ) async => confirmSignUpResult;

  @override
  Future<ApiResult> registerProfile({String? displayName}) async {
    registerProfileCalled = true;
    return registerProfileResult;
  }

  @override
  Future<ApiResult> refreshTokens() async => refreshTokensResult;

  @override
  Future<ApiResult> signOut() async => signOutResult;
}

class FakePushService extends PushNotificationService {
  FakePushService() : super(apiService: FakeApiService(authService: AuthService()));

  int registerCalls = 0;
  int unregisterCalls = 0;

  @override
  Future<void> registerDevice() async {
    registerCalls++;
  }

  @override
  Future<void> unregisterDevice() async {
    unregisterCalls++;
  }
}

void main() {
  test('signIn success authenticates and registers device', () async {
    final auth = FakeAuthService();
    final api = FakeApiService(authService: auth);
    final push = FakePushService();
    final vm = LoginViewModel(apiService: api, pushNotificationService: push);

    await vm.signIn('user@example.com', 'password');

    expect(vm.isAuthenticated, isTrue);
    expect(vm.statusMessage, 'Login erfolgreich!');
    expect(push.registerCalls, 1);
  });

  test('signIn failure uses backend error message', () async {
    final auth = FakeAuthService();
    final api = FakeApiService(authService: auth);
    api.signInResult = ApiResult.error(
      statusCode: 401,
      message: 'Failed',
      data: {'error': 'Ungültige Daten'},
    );

    final vm = LoginViewModel(apiService: api);
    await vm.signIn('user@example.com', 'password');

    expect(vm.isAuthenticated, isFalse);
    expect(vm.statusMessage, 'Ungültige Daten');
  });

  test('signUp success transitions to confirm mode', () async {
    final auth = FakeAuthService();
    final api = FakeApiService(authService: auth);
    final vm = LoginViewModel(apiService: api);

    await vm.signUp('new@example.com', 'password', displayName: 'Jane');

    expect(vm.pendingEmail, 'new@example.com');
    expect(vm.authMode, AuthMode.confirmSignUp);
  });

  test('signUp failure shows error message', () async {
    final auth = FakeAuthService();
    final api = FakeApiService(authService: auth);
    api.signUpResult = ApiResult.error(
      statusCode: 400,
      message: 'Bad',
      data: {'error': 'Registrierung fehlgeschlagen'},
    );
    final vm = LoginViewModel(apiService: api);

    await vm.signUp('new@example.com', 'password');

    expect(vm.statusMessage, 'Registrierung fehlgeschlagen');
    expect(vm.authMode, AuthMode.signIn);
  });

  test('confirmSignUp success switches to sign-in', () async {
    final auth = FakeAuthService();
    final api = FakeApiService(authService: auth);
    final vm = LoginViewModel(apiService: api);

    await vm.confirmSignUp('new@example.com', '123456');

    expect(vm.authMode, AuthMode.signIn);
  });

  test('forgotPassword success moves to confirm reset mode', () async {
    final auth = FakeAuthService();
    final api = FakeApiService(authService: auth);
    final vm = LoginViewModel(apiService: api);

    await vm.forgotPassword('user@example.com');

    expect(vm.authMode, AuthMode.confirmForgotPassword);
  });

  test('confirmForgotPassword success returns to sign-in', () async {
    final auth = FakeAuthService();
    final api = FakeApiService(authService: auth);
    final vm = LoginViewModel(apiService: api);

    await vm.confirmForgotPassword('user@example.com', '123456', 'newpass');

    expect(vm.authMode, AuthMode.signIn);
  });

  test('first login registers profile after confirmation', () async {
    final auth = FakeAuthService();
    final api = FakeApiService(authService: auth);
    final vm = LoginViewModel(apiService: api);

    await vm.confirmSignUp('new@example.com', '123456');
    await vm.signIn('new@example.com', 'password');

    expect(api.registerProfileCalled, isTrue);
  });

  test('tryRestoreSession authenticates with valid tokens', () async {
    final auth = FakeAuthService(hasTokensValue: true);
    final api = FakeApiService(authService: auth);
    api.refreshTokensResult = ApiResult.success(statusCode: 200);
    api.getMeResult = ApiResult.success(statusCode: 200, data: {'ok': true});
    final vm = LoginViewModel(apiService: api);

    await vm.tryRestoreSession();

    expect(vm.isAuthenticated, isTrue);
  });

  test('tryRestoreSession clears tokens on refresh failure', () async {
    final auth = FakeAuthService(hasTokensValue: true);
    final api = FakeApiService(authService: auth);
    api.refreshTokensResult = ApiResult.error(statusCode: 401, message: 'Expired');
    final vm = LoginViewModel(apiService: api);

    await vm.tryRestoreSession();

    expect(vm.isAuthenticated, isFalse);
    expect(auth.cleared, isTrue);
  });

  test('signOut resets state and unregisters device', () async {
    final auth = FakeAuthService();
    final api = FakeApiService(authService: auth);
    final push = FakePushService();
    final vm = LoginViewModel(apiService: api, pushNotificationService: push);

    await vm.signOut();

    expect(vm.isAuthenticated, isFalse);
    expect(vm.authMode, AuthMode.signIn);
    expect(push.unregisterCalls, 1);
  });

  test('toggleMode switches between sign-in and sign-up', () {
    final auth = FakeAuthService();
    final api = FakeApiService(authService: auth);
    final vm = LoginViewModel(apiService: api);

    expect(vm.authMode, AuthMode.signIn);
    vm.toggleMode();
    expect(vm.authMode, AuthMode.signUp);
    vm.toggleMode();
    expect(vm.authMode, AuthMode.signIn);
  });

  test('switchMode clears status message', () async {
    final auth = FakeAuthService();
    final api = FakeApiService(authService: auth);
    api.signInResult = ApiResult.error(
      statusCode: 401,
      message: 'Failed',
      data: {'error': 'Ungültige Daten'},
    );
    final vm = LoginViewModel(apiService: api);

    await vm.signIn('user@example.com', 'password');
    expect(vm.statusMessage, isNotEmpty);

    vm.switchMode(AuthMode.signUp);
    expect(vm.statusMessage, isEmpty);
  });
}
