import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator_platform_interface/geolocator_platform_interface.dart';
import 'package:safewalk/core/network/api_result.dart';
import 'package:safewalk/models/map_models.dart';
import 'package:safewalk/services/api_service.dart';
import 'package:safewalk/viewmodels/map_viewmodel.dart';

import '../helpers/fake_geolocator_platform.dart';
import '../helpers/fake_mapbox_places_service.dart';

class FakeApiService extends ApiService {
  ApiResult mapDataResult = ApiResult.success(statusCode: 200, data: {
    'data': {
      'pois': [
        {'id': 'node/1', 'category': 'POLICE', 'lat': 48.1, 'lng': 11.6},
      ],
      'reports': [
        {
          'reportId': 'r1',
          'type': 'UNSAFE_AREA',
          'lat': 48.2,
          'lng': 11.7,
        },
      ],
    },
  });

  ApiResult submitReportResult = ApiResult.success(statusCode: 200);
  ApiResult contactsResult = ApiResult.success(statusCode: 200, data: {
    'locations': [],
  });
  ApiResult sosResult = ApiResult.success(statusCode: 200, data: []);

  @override
  Future<ApiResult> getMapData({
    required double lat,
    required double lng,
    required double radiusMeters,
    bool cancelPrevious = false,
  }) async => mapDataResult;

  @override
  Future<ApiResult> submitMapReport({
    required double lat,
    required double lng,
    required String type,
    String? comment,
  }) async => submitReportResult;

  @override
  Future<ApiResult> getContactLiveLocations() async => contactsResult;

  @override
  Future<ApiResult> getReceivedSosAlarms() async => sosResult;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    GeolocatorPlatform.instance = FakeGeolocatorPlatform();
  });

  test('initialize selects default layers and sets title', () async {
    final api = FakeApiService();
    final vm = MapViewModel(apiService: api);

    await vm.initialize();

    expect(vm.activeViewTitle, 'Lichtkarte');
    expect(vm.publicDataLayers.where((layer) => layer.isSelected).length, 2);
    vm.stopSocialPolling();
  });

  test('loadMapData populates points and reports', () async {
    final api = FakeApiService();
    final vm = MapViewModel(apiService: api);

    await vm.initialize();
    await vm.loadMapData();

    expect(vm.publicDataPoints, hasLength(1));
    expect(vm.communityReports, hasLength(1));
    expect(vm.layerTotals['POLICE'], 1);
    vm.stopSocialPolling();
  });

  test('toggleLayer updates selected layer list', () async {
    final api = FakeApiService();
    final vm = MapViewModel(apiService: api);

    await vm.initialize();
    final before = vm.renderGeneration;

    vm.toggleLayer('POLICE');

    expect(vm.renderGeneration, greaterThan(before));
    vm.stopSocialPolling();
  });

  test('setSearchQuery triggers Mapbox search', () {
    final api = FakeApiService();
    final fakeMapbox = FakeMapboxPlacesService(
      results: const [
        MapPlaceSuggestion(
          name: 'Marienplatz',
          fullName: 'Marienplatz, Muenchen',
          lat: 48.137,
          lng: 11.575,
        ),
      ],
    );
    final vm = MapViewModel(apiService: api, mapboxPlacesService: fakeMapbox);

    fakeAsync((async) {
      vm.setSearchQuery('Marien');
      async.elapse(const Duration(milliseconds: 400));
      async.flushMicrotasks();

      expect(vm.searchSuggestions, hasLength(1));
    });

    vm.dispose();
  });

  test('refreshSocialData filters stale locations', () async {
    final api = FakeApiService();
    final now = DateTime.now();
    api.contactsResult = ApiResult.success(statusCode: 200, data: {
      'locations': [
        {
          'safeWalkId': 'fresh',
          'displayName': 'Fresh',
          'lat': 48.1,
          'lng': 11.6,
          'accuracy': 5,
          'updatedAt': now.toIso8601String(),
        },
        {
          'safeWalkId': 'stale',
          'displayName': 'Stale',
          'lat': 48.1,
          'lng': 11.6,
          'accuracy': 5,
          'updatedAt': now.subtract(const Duration(minutes: 4)).toIso8601String(),
        },
      ],
    });

    final vm = MapViewModel(apiService: api);
    await vm.initialize();
    await vm.refreshSocialData();

    expect(vm.contactLocations.map((c) => c.safeWalkId), ['fresh']);
    vm.stopSocialPolling();
  });
}

