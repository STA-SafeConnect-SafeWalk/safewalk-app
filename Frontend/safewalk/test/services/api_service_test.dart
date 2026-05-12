import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:safewalk/core/constants/api_constants.dart';
import 'package:safewalk/core/network/api_client.dart';
import 'package:safewalk/core/network/api_result.dart';
import 'package:safewalk/services/api_service.dart';
import 'package:safewalk/services/auth_service.dart';

class FakeAuthService extends AuthService {
  String? _idToken;
  String? _accessToken;
  String? _refreshToken;

  FakeAuthService({String? idToken, String? accessToken, String? refreshToken})
    : _idToken = idToken,
      _accessToken = accessToken,
      _refreshToken = refreshToken;

  @override
  Future<void> saveTokens({
    required String idToken,
    required String accessToken,
    required String refreshToken,
  }) async {
    _idToken = idToken;
    _accessToken = accessToken;
    _refreshToken = refreshToken;
  }

  @override
  Future<void> saveRefreshedTokens({
    required String idToken,
    required String accessToken,
  }) async {
    _idToken = idToken;
    _accessToken = accessToken;
  }

  @override
  Future<String?> get idToken async => _idToken;

  @override
  Future<String?> get accessToken async => _accessToken;

  @override
  Future<String?> get refreshToken async => _refreshToken;

  @override
  Future<bool> get hasTokens async => _idToken != null;

  @override
  Future<void> clearTokens() async {
    _idToken = null;
    _accessToken = null;
    _refreshToken = null;
  }
}

class FakeApiClient extends ApiClient {
  FakeApiClient() : super(baseUrl: 'https://example.com');

  final Map<String, List<ApiResult>> _responses = {};

  void enqueue(String endpoint, ApiResult result) {
    _responses.putIfAbsent(endpoint, () => []).add(result);
  }

  ApiResult _next(String endpoint) {
    final queue = _responses[endpoint];
    if (queue == null || queue.isEmpty) {
      return ApiResult.error(statusCode: 500, message: 'Missing stub');
    }
    return queue.removeAt(0);
  }

  @override
  Future<ApiResult> get(
    String endpoint, {
    Map<String, String>? headers,
    Map<String, dynamic>? queryParameters,
    http.Client? client,
  }) async {
    return _next(endpoint);
  }

  @override
  Future<ApiResult> post(
    String endpoint, {
    body,
    Map<String, String>? headers,
  }) async {
    return _next(endpoint);
  }

  @override
  Future<ApiResult> put(
    String endpoint, {
    body,
    Map<String, String>? headers,
  }) async {
    return _next(endpoint);
  }

  @override
  Future<ApiResult> patch(
    String endpoint, {
    body,
    Map<String, String>? headers,
  }) async {
    return _next(endpoint);
  }

  @override
  Future<ApiResult> delete(
    String endpoint, {
    Map<String, dynamic>? queryParameters,
    Map<String, String>? headers,
  }) async {
    return _next(endpoint);
  }
}

void main() {
  test('signIn stores tokens on success', () async {
    final client = FakeApiClient();
    final auth = FakeAuthService();
    client.enqueue(
      ApiConstants.authSignIn,
      ApiResult.success(
        statusCode: 200,
        data: {
          'idToken': 'id-token',
          'accessToken': 'access-token',
          'refreshToken': 'refresh-token',
        },
      ),
    );

    final service = ApiService(client: client, authService: auth);
    final result = await service.signIn('user@example.com', 'password');

    expect(result.isSuccess, isTrue);
    expect(await auth.idToken, 'id-token');
    expect(await auth.accessToken, 'access-token');
    expect(await auth.refreshToken, 'refresh-token');
    expect(client.authToken, 'id-token');
  });

  test('getMe returns 401 when no token is stored', () async {
    final client = FakeApiClient();
    final auth = FakeAuthService();
    final service = ApiService(client: client, authService: auth);

    final result = await service.getMe();

    expect(result.isSuccess, isFalse);
    expect(result.statusCode, 401);
  });

  test('getMe refreshes token after 401 and retries', () async {
    final client = FakeApiClient();
    final auth = FakeAuthService(
      idToken: 'old-id',
      refreshToken: 'refresh-token',
    );

    client.enqueue(
      ApiConstants.me,
      ApiResult.error(statusCode: 401, message: 'Unauthorized'),
    );
    client.enqueue(
      ApiConstants.authRefresh,
      ApiResult.success(
        statusCode: 200,
        data: {'idToken': 'new-id', 'accessToken': 'new-access'},
      ),
    );
    client.enqueue(
      ApiConstants.me,
      ApiResult.success(statusCode: 200, data: {'ok': true}),
    );

    final service = ApiService(client: client, authService: auth);
    final result = await service.getMe();

    expect(result.isSuccess, isTrue);
    expect(await auth.idToken, 'new-id');
    expect(client.authToken, 'new-id');
  });

  test('refreshTokens fails without refresh token', () async {
    final client = FakeApiClient();
    final auth = FakeAuthService();
    final service = ApiService(client: client, authService: auth);

    final result = await service.refreshTokens();

    expect(result.isSuccess, isFalse);
    expect(result.statusCode, 400);
  });
}
