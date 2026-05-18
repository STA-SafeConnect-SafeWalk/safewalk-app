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

  test('submitReport rejects missing category', () async {
    final api = FakeApiService();
    final vm = MapViewModel(apiService: api);

    final ok = await vm.submitReport(categoryKey: '');

    expect(ok, isFalse);
    expect(vm.errorMessage, 'Bitte waehle eine Kategorie aus.');
  });

  test('submitReport rejects missing location', () async {
    GeolocatorPlatform.instance = FakeGeolocatorPlatform(serviceEnabled: false);
    final api = FakeApiService();
    final vm = MapViewModel(apiService: api);
    await vm.initialize();
    vm.setUseCurrentLocationForReport(true);

    final ok = await vm.submitReport(categoryKey: 'UNSAFE_AREA');

    expect(ok, isFalse);
    expect(
      vm.errorMessage,
      'Keine gültige Position verfuegbar. Tippe auf die Karte oder nutze den aktuellen Standort.',
    );
    vm.stopSocialPolling();
  });

  test('recenterToUser returns null when location unavailable', () async {
    GeolocatorPlatform.instance = FakeGeolocatorPlatform(serviceEnabled: false);
    final api = FakeApiService();
    final vm = MapViewModel(apiService: api);

    final result = await vm.recenterToUser();

    expect(result, isNull);
    expect(
      vm.errorMessage,
      'Standort konnte nicht ermittelt werden. Bitte Berechtigungen pruefen.',
    );
  });

  test('loadMapData warns on oversized viewport', () async {
    final api = FakeApiService();
    final vm = MapViewModel(apiService: api);
    await vm.initialize();

    await vm.loadMapData(
      center: const LatLng(0, 0),
      viewportBounds: const MapViewportBounds(
        north: 80,
        south: -80,
        east: 170,
        west: -170,
      ),
    );

    expect(
      vm.errorMessage,
      'Kartenausschnitt zu gross. Bitte zoomen, um Daten zu laden.',
    );
    vm.stopSocialPolling();
  });

  test('setReportTapLocation toggles report pin state', () async {
    final api = FakeApiService();
    final vm = MapViewModel(apiService: api);

    vm.setReportTapLocation(const LatLng(48.1, 11.6));

    expect(vm.reportTapLocation, isNotNull);
    expect(vm.useCurrentLocationForReport, isFalse);

    vm.setUseCurrentLocationForReport(true);
    expect(vm.reportTapLocation, isNull);
  });

  test('submitReport succeeds and clears report state', () async {
    final api = FakeApiService();
    final vm = MapViewModel(apiService: api);
    await vm.initialize();

    final ok = await vm.submitReport(
      categoryKey: 'UNSAFE_AREA',
      comment: 'Dark area',
    );

    expect(ok, isTrue);
    expect(vm.successMessage, 'Meldung wurde erfolgreich übermittelt.');
    expect(vm.reportTapLocation, isNull);
    vm.stopSocialPolling();
  });

  test('submitReport surfaces backend error', () async {
    final api = FakeApiService();
    api.submitReportResult = ApiResult.error(
      statusCode: 500,
      message: 'Error',
      data: {'error': 'Meldung konnte nicht gesendet werden'},
    );
    final vm = MapViewModel(apiService: api);
    await vm.initialize();

    final ok = await vm.submitReport(
      categoryKey: 'UNSAFE_AREA',
      comment: 'Dark area',
    );

    expect(ok, isFalse);
    expect(vm.errorMessage, 'Meldung konnte nicht gesendet werden');
    vm.stopSocialPolling();
  });

  test('visibleLayerEntries and summaries reflect map data', () async {
    final api = FakeApiService();
    final vm = MapViewModel(apiService: api);
    await vm.initialize();
    await vm.loadMapData();

    vm.toggleLayer('POLICE');

    expect(vm.visibleLayerEntries, isNotEmpty);
    expect(vm.activeViewSubtitle, contains('Einträge'));
    vm.stopSocialPolling();
  });

  test('onCameraMoved updates center and zoom', () async {
    final api = FakeApiService();
    final vm = MapViewModel(apiService: api);

    vm.onCameraMoved(const LatLng(1, 2), 12);

    expect(vm.mapCenter.latitude, 1);
    expect(vm.mapCenter.longitude, 2);
    expect(vm.zoom, 12);
  });

  test('clearSearchSuggestions empties suggestions list', () {
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
      expect(vm.searchSuggestions, isNotEmpty);

      vm.clearSearchSuggestions();
      expect(vm.searchSuggestions, isEmpty);
    });
  });

  test('clearReportState resets report locations', () {
    final api = FakeApiService();
    final vm = MapViewModel(apiService: api);

    vm.setReportTapLocation(const LatLng(48.1, 11.6));
    expect(vm.reportTapLocation, isNotNull);

    vm.clearReportState();
    expect(vm.reportTapLocation, isNull);
  });

  test('clearError and clearSuccess reset messages', () async {
    final api = FakeApiService();
    final vm = MapViewModel(apiService: api);
    await vm.initialize();

    api.submitReportResult = ApiResult.error(
      statusCode: 500,
      message: 'Error',
      data: {'error': 'Meldung konnte nicht gesendet werden'},
    );
    await vm.submitReport(categoryKey: 'UNSAFE_AREA');
    expect(vm.errorMessage, isNotNull);
    vm.clearError();
    expect(vm.errorMessage, isNull);

    api.submitReportResult = ApiResult.success(statusCode: 200);
    await vm.submitReport(categoryKey: 'UNSAFE_AREA');
    expect(vm.successMessage, isNotNull);
    vm.clearSuccess();
    expect(vm.successMessage, isNull);
    vm.stopSocialPolling();
  });

  test('activeViewTitle reflects selected layers', () async {
    final api = FakeApiService();
    final vm = MapViewModel(apiService: api);
    await vm.initialize();

    vm.toggleLayer('UNLIT_WAY');
    expect(vm.activeViewTitle, 'Strassenlaternen');

    vm.toggleLayer('STREET_LAMP');
    expect(vm.activeViewTitle, 'Keine Layer aktiv');
    vm.stopSocialPolling();
  });
}
