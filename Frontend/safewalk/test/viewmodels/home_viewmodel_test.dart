import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:geolocator_platform_interface/geolocator_platform_interface.dart';
import 'package:safewalk/core/network/api_result.dart';
import 'package:safewalk/services/api_service.dart';
import 'package:safewalk/viewmodels/home_viewmodel.dart';

import '../helpers/fake_geolocator_platform.dart';

class FakeApiService extends ApiService {
  ApiResult updateLiveLocationResult = ApiResult.success(statusCode: 200);
  ApiResult stopLiveLocationResult = ApiResult.success(statusCode: 204);

  @override
  Future<ApiResult> updateLiveLocation({
    required double lat,
    required double lng,
    required double accuracy,
  }) async => updateLiveLocationResult;

  @override
  Future<ApiResult> stopLiveLocation() async => stopLiveLocationResult;
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
}
