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
  bool cleared = false;

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
    cleared = true;
  }
}

class FakeApiClient extends ApiClient {
  FakeApiClient() : super(baseUrl: 'https://example.com');

  final Map<String, List<ApiResult>> _responses = {};
  String? lastEndpoint;
  Object? lastBody;

  void enqueue(String endpoint, ApiResult result) {
    _responses.putIfAbsent(endpoint, () => []).add(result);
  }

  ApiResult _next(String endpoint) {
    lastEndpoint = endpoint;
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
    lastBody = body;
    return _next(endpoint);
  }

  @override
  Future<ApiResult> put(
    String endpoint, {
    body,
    Map<String, String>? headers,
  }) async {
    lastBody = body;
    return _next(endpoint);
  }

  @override
  Future<ApiResult> patch(
    String endpoint, {
    body,
    Map<String, String>? headers,
  }) async {
    lastBody = body;
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

ApiService buildAuthedService(FakeApiClient client) {
  final auth = FakeAuthService(idToken: 'id-token', accessToken: 'access');
  return ApiService(client: client, authService: auth);
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

  test('updateLiveLocation sends location payload', () async {
    final client = FakeApiClient();
    final auth = FakeAuthService(idToken: 'id');
    client.enqueue(ApiConstants.location, ApiResult.success(statusCode: 200));

    final service = ApiService(client: client, authService: auth);
    final result = await service.updateLiveLocation(
      lat: 48.1,
      lng: 11.6,
      accuracy: 7,
    );

    expect(result.isSuccess, isTrue);
    expect(client.lastEndpoint, ApiConstants.location);
    expect(client.lastBody, {
      'lat': 48.1,
      'lng': 11.6,
      'accuracy': 7,
    });
  });

  test('stopLiveLocation calls delete endpoint', () async {
    final client = FakeApiClient();
    final auth = FakeAuthService(idToken: 'id');
    client.enqueue(ApiConstants.location, ApiResult.success(statusCode: 204));

    final service = ApiService(client: client, authService: auth);
    final result = await service.stopLiveLocation();

    expect(result.isSuccess, isTrue);
    expect(client.lastEndpoint, ApiConstants.location);
  });

  test('getContactLiveLocations calls contacts endpoint', () async {
    final client = FakeApiClient();
    final auth = FakeAuthService(idToken: 'id');
    client.enqueue(
      ApiConstants.locationContacts,
      ApiResult.success(statusCode: 200, data: {'locations': []}),
    );

    final service = ApiService(client: client, authService: auth);
    final result = await service.getContactLiveLocations();

    expect(result.isSuccess, isTrue);
    expect(client.lastEndpoint, ApiConstants.locationContacts);
  });

  test('submitMapReport posts report payload', () async {
    final client = FakeApiClient();
    final auth = FakeAuthService(idToken: 'id');
    client.enqueue(ApiConstants.mapReports, ApiResult.success(statusCode: 200));

    final service = ApiService(client: client, authService: auth);
    final result = await service.submitMapReport(
      lat: 48.1,
      lng: 11.6,
      type: 'UNSAFE_AREA',
      comment: 'Dark area',
    );

    expect(result.isSuccess, isTrue);
    expect(client.lastEndpoint, ApiConstants.mapReports);
    expect(client.lastBody, {
      'lat': 48.1,
      'lng': 11.6,
      'type': 'UNSAFE_AREA',
      'comment': 'Dark area',
    });
  });

  test('signOut clears tokens even when server fails', () async {
    final client = FakeApiClient();
    final auth = FakeAuthService(accessToken: 'access');
    client.enqueue(ApiConstants.authSignOut, ApiResult.error(statusCode: 500, message: 'Error'));

    final service = ApiService(client: client, authService: auth);
    final result = await service.signOut();

    expect(result.isSuccess, isFalse);
    expect(auth.cleared, isTrue);
    expect(client.lastEndpoint, ApiConstants.authSignOut);
  });

  test('sharing code endpoints call expected routes', () async {
    final client = FakeApiClient();
    final service = buildAuthedService(client);
    client.enqueue(ApiConstants.sharingCode, ApiResult.success(statusCode: 200));
    client.enqueue(ApiConstants.sharingCode, ApiResult.success(statusCode: 200));

    await service.getSharingCode();
    expect(client.lastEndpoint, ApiConstants.sharingCode);

    await service.generateSharingCode();
    expect(client.lastEndpoint, ApiConstants.sharingCode);
  });

  test('contacts endpoints call expected routes', () async {
    final client = FakeApiClient();
    final service = buildAuthedService(client);
    client.enqueue(ApiConstants.contacts, ApiResult.success(statusCode: 200));
    client.enqueue(ApiConstants.sharingCodeConnect, ApiResult.success(statusCode: 200));
    client.enqueue(ApiConstants.contactsConnectBack, ApiResult.success(statusCode: 200));
    client.enqueue(ApiConstants.contactById('c1'), ApiResult.success(statusCode: 200));
    client.enqueue(ApiConstants.contactById('c1'), ApiResult.success(statusCode: 204));

    await service.getContacts();
    expect(client.lastEndpoint, ApiConstants.contacts);

    await service.connectWithSharingCode('ABC');
    expect(client.lastEndpoint, ApiConstants.sharingCodeConnect);

    await service.connectBackWithContact('sw1');
    expect(client.lastEndpoint, ApiConstants.contactsConnectBack);

    await service.updateContactSettings('c1', locationSharing: true, sosSharing: false);
    expect(client.lastEndpoint, ApiConstants.contactById('c1'));

    await service.deleteContact('c1');
    expect(client.lastEndpoint, ApiConstants.contactById('c1'));
  });

  test('map endpoints call expected routes', () async {
    final client = FakeApiClient();
    final service = buildAuthedService(client);
    client.enqueue(ApiConstants.mapData, ApiResult.success(statusCode: 200));
    client.enqueue(ApiConstants.mapReportById('r1'), ApiResult.success(statusCode: 204));

    await service.getMapData(lat: 48.1, lng: 11.6, radiusMeters: 200);
    expect(client.lastEndpoint, ApiConstants.mapData);

    await service.deleteMapReport(reportId: 'r1', lat: 48.1, lng: 11.6);
    expect(client.lastEndpoint, ApiConstants.mapReportById('r1'));
  });

  test('tips endpoint calls expected route', () async {
    final client = FakeApiClient();
    final service = buildAuthedService(client);
    client.enqueue(ApiConstants.tips, ApiResult.success(statusCode: 200));

    await service.getTips();

    expect(client.lastEndpoint, ApiConstants.tips);
  });

  test('sos endpoints call expected routes', () async {
    final client = FakeApiClient();
    final service = buildAuthedService(client);
    client.enqueue(ApiConstants.sos, ApiResult.success(statusCode: 200));
    client.enqueue(ApiConstants.sosById('s1'), ApiResult.success(statusCode: 200));
    client.enqueue(ApiConstants.sosPropagate('s1'), ApiResult.success(statusCode: 200));
    client.enqueue(ApiConstants.sosById('s1'), ApiResult.success(statusCode: 200));
    client.enqueue(ApiConstants.sosReceived, ApiResult.success(statusCode: 200));

    await service.triggerSos(lat: 48.1, lng: 11.6, accuracy: 5);
    expect(client.lastEndpoint, ApiConstants.sos);

    await service.cancelSos('s1');
    expect(client.lastEndpoint, ApiConstants.sosById('s1'));

    await service.propagateSos('s1');
    expect(client.lastEndpoint, ApiConstants.sosPropagate('s1'));

    await service.updateSosLocation(sosId: 's1', lat: 48.1, lng: 11.6, accuracy: 5);
    expect(client.lastEndpoint, ApiConstants.sosById('s1'));

    await service.getReceivedSosAlarms();
    expect(client.lastEndpoint, ApiConstants.sosReceived);
  });

  test('device endpoints call expected routes', () async {
    final client = FakeApiClient();
    final service = buildAuthedService(client);
    client.enqueue(ApiConstants.deviceRegister, ApiResult.success(statusCode: 200));
    client.enqueue(ApiConstants.deviceUnregister, ApiResult.success(statusCode: 200));
    client.enqueue(ApiConstants.notificationsSend, ApiResult.success(statusCode: 200));

    await service.registerDevice(deviceToken: 'token', platform: 'ios');
    expect(client.lastEndpoint, ApiConstants.deviceRegister);

    await service.unregisterDevice(deviceToken: 'token');
    expect(client.lastEndpoint, ApiConstants.deviceUnregister);

    await service.sendNotification(targetUserId: 'u1', title: 'T', body: 'B');
    expect(client.lastEndpoint, ApiConstants.notificationsSend);
  });

  test('profile endpoints call expected routes', () async {
    final client = FakeApiClient();
    final service = buildAuthedService(client);
    client.enqueue(ApiConstants.me, ApiResult.success(statusCode: 200));
    client.enqueue(ApiConstants.me, ApiResult.success(statusCode: 204));

    await service.updateDisplayName('Jane');
    expect(client.lastEndpoint, ApiConstants.me);

    await service.deleteAccount();
    expect(client.lastEndpoint, ApiConstants.me);
  });
}
