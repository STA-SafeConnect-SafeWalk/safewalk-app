import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:geolocator_platform_interface/geolocator_platform_interface.dart';
import 'package:safewalk/core/network/api_result.dart';
import 'package:safewalk/services/api_service.dart';
import 'package:safewalk/viewmodels/home_viewmodel.dart';
import 'package:fake_async/fake_async.dart';

import '../helpers/fake_geolocator_platform.dart';

Future<void> settle() async {
  await Future<void>.delayed(const Duration(milliseconds: 10));
}

class FakeApiService extends ApiService {
  ApiResult updateLiveLocationResult = ApiResult.success(statusCode: 200);
  ApiResult stopLiveLocationResult = ApiResult.success(statusCode: 204);
  ApiResult triggerSosResult = ApiResult.success(statusCode: 200, data: {
    'sosId': 's1',
  });
  ApiResult cancelSosResult = ApiResult.success(statusCode: 204);
  ApiResult propagateSosResult = ApiResult.success(statusCode: 200);
  ApiResult updateSosLocationResult = ApiResult.success(statusCode: 200);

  int updateLiveLocationCalls = 0;
  int triggerCalls = 0;
  int cancelCalls = 0;
  int propagateCalls = 0;
  int updateSosLocationCalls = 0;

  @override
  Future<ApiResult> updateLiveLocation({
    required double lat,
    required double lng,
    required double accuracy,
  }) async {
    updateLiveLocationCalls++;
    return updateLiveLocationResult;
  }

  @override
  Future<ApiResult> stopLiveLocation() async => stopLiveLocationResult;

  @override
  Future<ApiResult> triggerSos({
    double? lat,
    double? lng,
    double? accuracy,
  }) async {
    triggerCalls++;
    return triggerSosResult;
  }

  @override
  Future<ApiResult> cancelSos(String sosId) async {
    cancelCalls++;
    return cancelSosResult;
  }

  @override
  Future<ApiResult> propagateSos(String sosId) async {
    propagateCalls++;
    return propagateSosResult;
  }

  @override
  Future<ApiResult> updateSosLocation({
    required String sosId,
    required double lat,
    required double lng,
    required double accuracy,
  }) async {
    updateSosLocationCalls++;
    return updateSosLocationResult;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('refreshLocation sets gps active on success', () async {
    final fakeGeolocator = FakeGeolocatorPlatform(
      position: Position(
        latitude: 48.1,
        longitude: 11.6,
        timestamp: DateTime.now(),
        accuracy: 5,
        altitude: 0,
        altitudeAccuracy: 0,
        heading: 0,
        headingAccuracy: 0,
        speed: 0,
        speedAccuracy: 0,
      ),
    );
    GeolocatorPlatform.instance = fakeGeolocator;

    final vm = HomeViewModel(apiService: FakeApiService());

    final ok = await vm.refreshLocation();

    expect(ok, isTrue);
    expect(vm.isGpsActive, isTrue);
    expect(vm.locationError, isNull);
  });

  test('refreshLocation sets error when service disabled', () async {
    final fakeGeolocator = FakeGeolocatorPlatform(serviceEnabled: false);
    GeolocatorPlatform.instance = fakeGeolocator;

    final vm = HomeViewModel(apiService: FakeApiService());

    final ok = await vm.refreshLocation();

    expect(ok, isFalse);
    expect(vm.isGpsActive, isFalse);
    expect(vm.locationError, isNotNull);
  });

  test('enableLocationSharing toggles on success', () async {
    final fakeGeolocator = FakeGeolocatorPlatform(
      position: Position(
        latitude: 48.1,
        longitude: 11.6,
        timestamp: DateTime.now(),
        accuracy: 5,
        altitude: 0,
        altitudeAccuracy: 0,
        heading: 0,
        headingAccuracy: 0,
        speed: 0,
        speedAccuracy: 0,
      ),
    );
    GeolocatorPlatform.instance = fakeGeolocator;

    final vm = HomeViewModel(apiService: FakeApiService());

    final enabled = await vm.enableLocationSharing();

    expect(enabled, isTrue);
    expect(vm.isSharingLocation, isTrue);
  });

  test('disableLocationSharing toggles off on success', () async {
    final fakeGeolocator = FakeGeolocatorPlatform(
      position: Position(
        latitude: 48.1,
        longitude: 11.6,
        timestamp: DateTime.now(),
        accuracy: 5,
        altitude: 0,
        altitudeAccuracy: 0,
        heading: 0,
        headingAccuracy: 0,
        speed: 0,
        speedAccuracy: 0,
      ),
    );
    GeolocatorPlatform.instance = fakeGeolocator;

    final vm = HomeViewModel(apiService: FakeApiService());
    await vm.enableLocationSharing();

    final disabled = await vm.disableLocationSharing();

    expect(disabled, isTrue);
    expect(vm.isSharingLocation, isFalse);
  });

  test('startCountdown transitions to countdown and creates SOS', () async {
    final fakeGeolocator = FakeGeolocatorPlatform(
      position: Position(
        latitude: 48.1,
        longitude: 11.6,
        timestamp: DateTime.now(),
        accuracy: 5,
        altitude: 0,
        altitudeAccuracy: 0,
        heading: 0,
        headingAccuracy: 0,
        speed: 0,
        speedAccuracy: 0,
      ),
    );
    GeolocatorPlatform.instance = fakeGeolocator;

    final api = FakeApiService();
    final vm = HomeViewModel(apiService: api);

    vm.startCountdown();
    await settle();

    expect(vm.screenState, SosScreenState.countdown);
    expect(api.triggerCalls, 1);
  });

  test('skipCountdownTimer activates SOS and propagates', () async {
    final fakeGeolocator = FakeGeolocatorPlatform(
      position: Position(
        latitude: 48.1,
        longitude: 11.6,
        timestamp: DateTime.now(),
        accuracy: 5,
        altitude: 0,
        altitudeAccuracy: 0,
        heading: 0,
        headingAccuracy: 0,
        speed: 0,
        speedAccuracy: 0,
      ),
    );
    GeolocatorPlatform.instance = fakeGeolocator;

    final api = FakeApiService();
    final vm = HomeViewModel(apiService: api);

    vm.startCountdown();
    await settle();
    vm.skipCountdownTimer();
    await settle();

    expect(vm.screenState, SosScreenState.active);
    expect(api.propagateCalls, 1);
  });

  test('cancelCountdownAndReturnHome cancels pending SOS', () async {
    final fakeGeolocator = FakeGeolocatorPlatform(
      position: Position(
        latitude: 48.1,
        longitude: 11.6,
        timestamp: DateTime.now(),
        accuracy: 5,
        altitude: 0,
        altitudeAccuracy: 0,
        heading: 0,
        headingAccuracy: 0,
        speed: 0,
        speedAccuracy: 0,
      ),
    );
    GeolocatorPlatform.instance = fakeGeolocator;

    final api = FakeApiService();
    final vm = HomeViewModel(apiService: api);

    vm.startCountdown();
    await settle();
    await vm.cancelCountdownAndReturnHome();
    await settle();

    expect(vm.screenState, SosScreenState.home);
    expect(api.cancelCalls, 1);
  });

  test('enableLocationSharing fails when API rejects update', () async {
    final fakeGeolocator = FakeGeolocatorPlatform(
      position: Position(
        latitude: 48.1,
        longitude: 11.6,
        timestamp: DateTime.now(),
        accuracy: 5,
        altitude: 0,
        altitudeAccuracy: 0,
        heading: 0,
        headingAccuracy: 0,
        speed: 0,
        speedAccuracy: 0,
      ),
    );
    GeolocatorPlatform.instance = fakeGeolocator;

    final api = FakeApiService();
    api.updateLiveLocationResult = ApiResult.error(statusCode: 500, message: 'Error');
    final vm = HomeViewModel(apiService: api);

    final enabled = await vm.enableLocationSharing();

    expect(enabled, isFalse);
    expect(vm.isSharingLocation, isFalse);
  });

  test('disableLocationSharing keeps sharing when API fails', () async {
    final fakeGeolocator = FakeGeolocatorPlatform(
      position: Position(
        latitude: 48.1,
        longitude: 11.6,
        timestamp: DateTime.now(),
        accuracy: 5,
        altitude: 0,
        altitudeAccuracy: 0,
        heading: 0,
        headingAccuracy: 0,
        speed: 0,
        speedAccuracy: 0,
      ),
    );
    GeolocatorPlatform.instance = fakeGeolocator;

    final api = FakeApiService();
    final vm = HomeViewModel(apiService: api);
    await vm.enableLocationSharing();
    api.stopLiveLocationResult = ApiResult.error(statusCode: 500, message: 'Error');

    final disabled = await vm.disableLocationSharing();

    expect(disabled, isFalse);
    expect(vm.isSharingLocation, isTrue);
  });

  test('cancelActiveSos returns to home on success', () async {
    final fakeGeolocator = FakeGeolocatorPlatform(
      position: Position(
        latitude: 48.1,
        longitude: 11.6,
        timestamp: DateTime.now(),
        accuracy: 5,
        altitude: 0,
        altitudeAccuracy: 0,
        heading: 0,
        headingAccuracy: 0,
        speed: 0,
        speedAccuracy: 0,
      ),
    );
    GeolocatorPlatform.instance = fakeGeolocator;

    final api = FakeApiService();
    final vm = HomeViewModel(apiService: api);

    vm.startCountdown();
    await settle();
    vm.skipCountdownTimer();
    await settle();

    await vm.cancelActiveSos();

    expect(vm.screenState, SosScreenState.home);
    expect(api.cancelCalls, greaterThan(0));
  });

  test('refreshLocation uses last known position on failure', () async {
    final fallback = Position(
      latitude: 48.2,
      longitude: 11.7,
      timestamp: DateTime.now(),
      accuracy: 12,
      altitude: 0,
      altitudeAccuracy: 0,
      heading: 0,
      headingAccuracy: 0,
      speed: 0,
      speedAccuracy: 0,
    );
    final fakeGeolocator = FakeGeolocatorPlatform(
      throwOnPosition: true,
      lastKnownPosition: fallback,
    );
    GeolocatorPlatform.instance = fakeGeolocator;

    final vm = HomeViewModel(apiService: FakeApiService());

    final ok = await vm.refreshLocation();

    expect(ok, isTrue);
    expect(vm.isGpsActive, isTrue);
    expect(vm.locationError, contains('letzte bekannte Position'));
  });

  test('refreshLocation reports error when no fallback available', () async {
    final fakeGeolocator = FakeGeolocatorPlatform(throwOnPosition: true);
    GeolocatorPlatform.instance = fakeGeolocator;

    final vm = HomeViewModel(apiService: FakeApiService());

    final ok = await vm.refreshLocation();

    expect(ok, isFalse);
    expect(vm.isGpsActive, isFalse);
    expect(vm.locationError, 'Standort konnte nicht ermittelt werden.');
  });

  test('refreshLocation respects allowFallback false', () async {
    final fakeGeolocator = FakeGeolocatorPlatform(throwOnPosition: true);
    GeolocatorPlatform.instance = fakeGeolocator;

    final vm = HomeViewModel(apiService: FakeApiService());

    final ok = await vm.refreshLocation(allowFallback: false);

    expect(ok, isFalse);
    expect(vm.locationError, 'Live-Standort konnte nicht ermittelt werden. Bitte Standort prüfen.');
  });

  test('refreshLocation fails when permission denied forever', () async {
    final fakeGeolocator = FakeGeolocatorPlatform(
      permission: LocationPermission.deniedForever,
    );
    GeolocatorPlatform.instance = fakeGeolocator;

    final vm = HomeViewModel(apiService: FakeApiService());

    final ok = await vm.refreshLocation();

    expect(ok, isFalse);
    expect(vm.locationError, 'Standort konnte nicht ermittelt werden.');
  });

  test('cancelActiveSos returns home when SOS already closed', () async {
    final fakeGeolocator = FakeGeolocatorPlatform(
      position: Position(
        latitude: 48.1,
        longitude: 11.6,
        timestamp: DateTime.now(),
        accuracy: 5,
        altitude: 0,
        altitudeAccuracy: 0,
        heading: 0,
        headingAccuracy: 0,
        speed: 0,
        speedAccuracy: 0,
      ),
    );
    GeolocatorPlatform.instance = fakeGeolocator;

    final api = FakeApiService();
    api.cancelSosResult = ApiResult.error(statusCode: 410, message: 'Gone');
    final vm = HomeViewModel(apiService: api);

    vm.startCountdown();
    await settle();
    vm.skipCountdownTimer();
    await settle();

    await vm.cancelActiveSos();

    expect(vm.screenState, SosScreenState.home);
  });

  test('startCountdown surfaces error when SOS creation fails', () async {
    final fakeGeolocator = FakeGeolocatorPlatform(
      position: Position(
        latitude: 48.1,
        longitude: 11.6,
        timestamp: DateTime.now(),
        accuracy: 5,
        altitude: 0,
        altitudeAccuracy: 0,
        heading: 0,
        headingAccuracy: 0,
        speed: 0,
        speedAccuracy: 0,
      ),
    );
    GeolocatorPlatform.instance = fakeGeolocator;

    final api = FakeApiService();
    api.triggerSosResult = ApiResult.error(statusCode: 500, message: 'Error');
    final vm = HomeViewModel(apiService: api);

    vm.startCountdown();
    await settle();

    expect(vm.screenState, SosScreenState.home);
    expect(vm.sosError, contains('SOS konnte nicht ausgelöst werden'));
  });

  test('startCountdown handles missing SOS id', () async {
    final fakeGeolocator = FakeGeolocatorPlatform(
      position: Position(
        latitude: 48.1,
        longitude: 11.6,
        timestamp: DateTime.now(),
        accuracy: 5,
        altitude: 0,
        altitudeAccuracy: 0,
        heading: 0,
        headingAccuracy: 0,
        speed: 0,
        speedAccuracy: 0,
      ),
    );
    GeolocatorPlatform.instance = fakeGeolocator;

    final api = FakeApiService();
    api.triggerSosResult = ApiResult.success(statusCode: 200, data: {'data': {}});
    final vm = HomeViewModel(apiService: api);

    vm.startCountdown();
    await settle();

    expect(vm.screenState, SosScreenState.home);
    expect(vm.sosError, contains('keine SOS-ID'));
  });

  test('cancelCountdownAndReturnHome shows error when cancel fails', () async {
    final fakeGeolocator = FakeGeolocatorPlatform(
      position: Position(
        latitude: 48.1,
        longitude: 11.6,
        timestamp: DateTime.now(),
        accuracy: 5,
        altitude: 0,
        altitudeAccuracy: 0,
        heading: 0,
        headingAccuracy: 0,
        speed: 0,
        speedAccuracy: 0,
      ),
    );
    GeolocatorPlatform.instance = fakeGeolocator;

    final api = FakeApiService();
    api.cancelSosResult = ApiResult.error(statusCode: 500, message: 'Error');
    final vm = HomeViewModel(apiService: api);

    vm.startCountdown();
    await settle();
    await vm.cancelCountdownAndReturnHome();
    await settle();

    expect(vm.screenState, SosScreenState.active);
    expect(vm.sosError, contains('SOS konnte nicht beendet werden'));
  });

  test('location sharing triggers periodic updates', () {
    fakeAsync((async) {
      final fakeGeolocator = FakeGeolocatorPlatform(
        position: Position(
          latitude: 48.1,
          longitude: 11.6,
          timestamp: DateTime.now(),
          accuracy: 5,
          altitude: 0,
          altitudeAccuracy: 0,
          heading: 0,
          headingAccuracy: 0,
          speed: 0,
          speedAccuracy: 0,
        ),
      );
      GeolocatorPlatform.instance = fakeGeolocator;

      final api = FakeApiService();
      final vm = HomeViewModel(apiService: api);

      async.run((async) async {
        await vm.enableLocationSharing();
      });
      async.flushMicrotasks();

      async.elapse(const Duration(seconds: 16));
      async.flushMicrotasks();

      expect(api.updateLiveLocationCalls, greaterThan(1));
      vm.dispose();
    });
  });
}
