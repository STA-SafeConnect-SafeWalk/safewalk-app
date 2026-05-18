import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:safewalk/services/auth_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  test('AuthService stores and retrieves tokens', () async {
    final auth = AuthService();

    await auth.saveTokens(
      idToken: 'id-token',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    );

    expect(await auth.idToken, 'id-token');
    expect(await auth.accessToken, 'access-token');
    expect(await auth.refreshToken, 'refresh-token');
    expect(await auth.hasTokens, isTrue);
  });

  test('AuthService clears tokens', () async {
    final auth = AuthService();

    await auth.saveTokens(
      idToken: 'id-token',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    );

    await auth.clearTokens();

    expect(await auth.idToken, isNull);
    expect(await auth.accessToken, isNull);
    expect(await auth.refreshToken, isNull);
    expect(await auth.hasTokens, isFalse);
  });
}

