import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';
import 'package:safewalk/models/map_models.dart';
import 'package:safewalk/services/api_service.dart';
import 'package:safewalk/services/mapbox_places_service.dart';

class LatLng {
  const LatLng(this.latitude, this.longitude);
  final double latitude;
  final double longitude;
}

class MapViewportBounds {
  const MapViewportBounds({
    required this.north,
    required this.south,
    required this.east,
    required this.west,
  });

  final double north;
  final double south;
  final double east;
  final double west;

  List<LatLng> get corners => [
    LatLng(north, west),
    LatLng(north, east),
    LatLng(south, west),
    LatLng(south, east),
  ];
}

class MapViewModel extends ChangeNotifier {
  MapViewModel({
    ApiService? apiService,
    MapboxPlacesService? mapboxPlacesService,
  }) : _apiService = apiService ?? ApiService(),
       _mapboxPlacesService = mapboxPlacesService ?? MapboxPlacesService();

  final ApiService _apiService;
  final MapboxPlacesService _mapboxPlacesService;

  static const _defaultCenter = LatLng(48.137154, 11.576124);
  static const _defaultZoom = 13.0;
  static const _searchDebounce = Duration(milliseconds: 350);

  /// Backend constraints (see `map-data-handler`).
  static const _minRadiusMeters = 50.0;
  static const _maxRadiusMeters = 5000.0;

  /// Layers selected by default when the screen opens.
  static const _defaultSelectedLayerKeys = <String>{'STREET_LAMP', 'UNLIT_WAY'};

  /// Public-data layer catalogue. Keys must match the `category` values
  /// returned by the backend `GET /map-data` endpoint.
  static const _availablePublicLayers = <MapLayerMetadata>[
    MapLayerMetadata(
      key: 'STREET_LAMP',
      label: 'Strassenlaternen',
      iconKey: 'street_lamp',
    ),
    MapLayerMetadata(
      key: 'UNLIT_WAY',
      label: 'Unbeleuchtete Wege',
      iconKey: 'unlit_way',
    ),
    MapLayerMetadata(
      key: 'POLICE',
      label: 'Polizeistationen',
      iconKey: 'police',
    ),
    MapLayerMetadata(
      key: 'HOSPITAL',
      label: 'Krankenhäuser',
      iconKey: 'hospital',
    ),
    MapLayerMetadata(
      key: 'CLINIC',
      label: 'Kliniken',
      iconKey: 'clinic',
    ),
    MapLayerMetadata(
      key: 'PHARMACY',
      label: 'Apotheken',
      iconKey: 'pharmacy',
    ),
    MapLayerMetadata(
      key: 'FIRE_STATION',
      label: 'Feuerwehr',
      iconKey: 'fire_station',
    ),
    MapLayerMetadata(
      key: 'EMERGENCY_PHONE',
      label: 'Notruftelefone',
      iconKey: 'emergency_phone',
    ),
  ];

  /// User-report categories. Keys must match the `type` values accepted by
  /// the backend `POST /map-data/reports` endpoint.
  static const _availableReportCategories = <MapReportCategoryMetadata>[
    MapReportCategoryMetadata(key: 'UNSAFE_AREA', label: 'Unsicherer Bereich'),
    MapReportCategoryMetadata(key: 'WELL_LIT_WAY', label: 'Gut beleuchtet'),
    MapReportCategoryMetadata(key: 'UNLIT_WAY', label: 'Schlecht beleuchtet'),
    MapReportCategoryMetadata(
      key: 'HIGH_FOOT_TRAFFIC',
      label: 'Hohe Personenfrequenz',
    ),
    MapReportCategoryMetadata(
      key: 'LOW_FOOT_TRAFFIC',
      label: 'Geringe Personenfrequenz',
    ),
    MapReportCategoryMetadata(
      key: 'CRIME_INCIDENT',
      label: 'Kriminalitätsvorfall',
    ),
  ];

  bool _initialized = false;
  bool _isInitializing = false;
  bool _isLoadingMapData = false;
  bool _isSearchingPlaces = false;
  bool _isSubmittingReport = false;
  bool _isFetchingLocation = false;

  String? _errorMessage;
  String? _successMessage;

  LatLng _mapCenter = _defaultCenter;
  double _zoom = _defaultZoom;

  LatLng? _userLocation;
  LatLng? _selectedSearchLocation;
  LatLng? _reportTapLocation;

  MapViewportBounds? _lastViewportBounds;

  String _searchQuery = '';
  List<MapPlaceSuggestion> _searchSuggestions = const [];

  List<MapLayerMetadata> _publicDataLayers = const [];
  final List<MapReportCategoryMetadata> _reportCategories =
      List.unmodifiable(_availableReportCategories);
  List<PublicDataPoint> _publicDataPoints = const [];

  String? _selectedReportCategoryKey;
  bool _useCurrentLocationForReport = true;

  List<CommunityReportItem> _communityReports = const [];

  LatLng? _savedReportPinLocation;

  Timer? _searchTimer;

  int _activeMapDataRequestId = 0;
  int _renderGeneration = 0;

  bool get isInitialized => _initialized;
  bool get isInitializing => _isInitializing;
  bool get isLoadingMapData => _isLoadingMapData;
  bool get isSearchingPlaces => _isSearchingPlaces;
  bool get isSubmittingReport => _isSubmittingReport;

  String? get errorMessage => _errorMessage;
  String? get successMessage => _successMessage;

  LatLng get mapCenter => _mapCenter;
  double get zoom => _zoom;

  LatLng? get userLocation => _userLocation;
  LatLng? get selectedSearchLocation => _selectedSearchLocation;
  LatLng? get reportTapLocation => _reportTapLocation;

  String get searchQuery => _searchQuery;
  List<MapPlaceSuggestion> get searchSuggestions => _searchSuggestions;

  List<MapLayerMetadata> get publicDataLayers => _publicDataLayers;
  List<MapReportCategoryMetadata> get reportCategories => _reportCategories;
  List<PublicDataPoint> get publicDataPoints => _publicDataPoints;

  bool get useCurrentLocationForReport => _useCurrentLocationForReport;
  String? get selectedReportCategoryKey => _selectedReportCategoryKey;

  List<CommunityReportItem> get communityReports => _communityReports;
  int get renderGeneration => _renderGeneration;

  bool get isMapboxConfigured => _mapboxPlacesService.isConfigured;
  String get mapboxAccessToken => MapboxPlacesService.accessToken;
  String get mapboxStyleUri => MapboxPlacesService.styleUri;

  List<MapLayerMetadata> get selectedLayers => _publicDataLayers
      .where((layer) => layer.isSelected)
      .toList(growable: false);

  String get activeViewTitle {
    final selected = selectedLayers;
    if (selected.isEmpty) return 'Keine Layer aktiv';

    final selectedKeys = selected.map((item) => item.key).toSet();
    if (selected.length == 2 &&
        selectedKeys.contains('STREET_LAMP') &&
        selectedKeys.contains('UNLIT_WAY')) {
      return 'Lichtkarte';
    }

    if (selected.length == 1) {
      return selected.first.label;
    }

    return '${selected.length} Layer aktiv';
  }

  String get activeViewSubtitle {
    final total = visibleLayerEntries.length;
    if (total == 0) return 'Keine Einträge im aktuellen Ausschnitt verfügbar';
    return '$total Einträge im aktuellen Ausschnitt';
  }

  Map<String, int> get layerTotals {
    final totals = <String, int>{};
    for (final layer in _publicDataLayers) {
      totals[layer.key] = 0;
    }

    for (final point in _publicDataPoints) {
      totals[point.category] = (totals[point.category] ?? 0) + 1;
    }

    return totals;
  }

  List<MapLayerEntry> get visibleLayerEntries {
    final selected = selectedLayers;
    if (selected.isEmpty || _publicDataPoints.isEmpty) return const [];

    final selectedKeys = {
      for (final layer in selected) layer.key: layer.label,
    };

    final entries = <MapLayerEntry>[];
    for (final point in _publicDataPoints) {
      final label = selectedKeys[point.category];
      if (label == null) continue;

      entries.add(
        MapLayerEntry(
          layerKey: point.category,
          layerLabel: label,
          lat: point.lat,
          lng: point.lng,
        ),
      );
    }
    return entries;
  }

  Future<void> initialize() async {
    if (_initialized) return;

    _initialized = true;
    _isInitializing = true;

    _publicDataLayers = _availablePublicLayers
        .map(
          (layer) => layer.copyWith(
            isSelected: _defaultSelectedLayerKeys.contains(layer.key),
          ),
        )
        .toList(growable: false);
    _selectedReportCategoryKey ??= _reportCategories.isNotEmpty
        ? _reportCategories.first.key
        : null;

    notifyListeners();

    await _loadCurrentLocation();

    _isInitializing = false;
    notifyListeners();
  }

  Future<void> loadMapData({
    LatLng? center,
    MapViewportBounds? viewportBounds,
    bool force = false,
  }) async {
    if (center != null) {
      _mapCenter = center;
    }

    if (viewportBounds != null) {
      _lastViewportBounds = viewportBounds;
    }

    final requestCenter = _mapCenter;
    final effectiveViewportBounds = viewportBounds ?? _lastViewportBounds;

    final requestRadiusMeters = _requiredViewportRadiusMeters(
      _zoom,
      center: requestCenter,
      viewportBounds: effectiveViewportBounds,
    );

    if (requestRadiusMeters > _maxRadiusMeters) {
      _errorMessage =
          'Kartenausschnitt zu gross. Bitte zoomen, um Daten zu laden.';
      notifyListeners();
      return;
    }

    final clampedRadius = requestRadiusMeters.clamp(
      _minRadiusMeters,
      _maxRadiusMeters,
    );

    final requestId = ++_activeMapDataRequestId;

    _isLoadingMapData = true;
    notifyListeners();

    try {
      final result = await _apiService.getMapData(
        lat: requestCenter.latitude,
        lng: requestCenter.longitude,
        radiusMeters: clampedRadius,
        cancelPrevious: true,
      );

      if (requestId != _activeMapDataRequestId) {
        return;
      }

      if (!result.isSuccess || result.data is! Map<String, dynamic>) {
        _errorMessage = _extractError(result.data, result.message);
        return;
      }

      final payload = result.data as Map<String, dynamic>;
      final data = payload['data'];
      if (data is! Map<String, dynamic>) {
        _publicDataPoints = const [];
        _communityReports = const [];
        return;
      }

      final rawPois = data['pois'];
      if (rawPois is List) {
        _publicDataPoints = rawPois
            .whereType<Map>()
            .map(
              (item) =>
                  PublicDataPoint.fromJson(Map<String, dynamic>.from(item)),
            )
            .toList(growable: false);
      } else {
        _publicDataPoints = const [];
      }

      final rawReports = data['reports'];
      if (rawReports is List) {
        _communityReports = rawReports
            .whereType<Map>()
            .map(
              (item) =>
                  CommunityReportItem.fromJson(Map<String, dynamic>.from(item)),
            )
            .toList(growable: false);
      } else {
        _communityReports = const [];
      }
    } catch (e) {
      if (requestId != _activeMapDataRequestId) {
        return;
      }
      _errorMessage = 'Karten-Daten konnten nicht geladen werden: $e';
    } finally {
      if (requestId == _activeMapDataRequestId) {
        _isLoadingMapData = false;
        notifyListeners();
      }
    }
  }

  void onCameraMoved(
    LatLng center,
    double zoom, {
    MapViewportBounds? viewportBounds,
  }) {
    _mapCenter = center;
    _zoom = zoom;
    if (viewportBounds != null) {
      _lastViewportBounds = viewportBounds;
    }
  }

  double _requiredViewportRadiusMeters(
    double zoom, {
    required LatLng center,
    MapViewportBounds? viewportBounds,
  }) {
    if (viewportBounds != null) {
      var maxCornerDistanceMeters = 0.0;
      for (final corner in viewportBounds.corners) {
        final distance = _haversineMeters(center, corner);
        if (distance > maxCornerDistanceMeters) {
          maxCornerDistanceMeters = distance;
        }
      }

      if (maxCornerDistanceMeters > 0) {
        return maxCornerDistanceMeters;
      }
    }

    // Fallback approximation when no viewport bounds are available yet.
    const earthCircumMeters = 40075000.0;
    final metersPerPx = earthCircumMeters / (256 * (1 << zoom.floor()));
    const fallbackScreenPx = 420.0;
    return metersPerPx * fallbackScreenPx / 2;
  }

  static double _haversineMeters(LatLng a, LatLng b) {
    const r = 6371000.0;
    final dLat = (b.latitude - a.latitude) * math.pi / 180;
    final dLng = (b.longitude - a.longitude) * math.pi / 180;
    final aLat = a.latitude * math.pi / 180;
    final bLat = b.latitude * math.pi / 180;
    final h =
        math.sin(dLat / 2) * math.sin(dLat / 2) +
        math.cos(aLat) *
            math.cos(bLat) *
            math.sin(dLng / 2) *
            math.sin(dLng / 2);
    return 2 * r * math.atan2(math.sqrt(h), math.sqrt(1 - h));
  }

  void setSearchQuery(String value) {
    _searchQuery = value;
    _searchTimer?.cancel();

    if (!isMapboxConfigured || value.trim().length < 2) {
      _isSearchingPlaces = false;
      _searchSuggestions = const [];
      notifyListeners();
      return;
    }

    _isSearchingPlaces = true;
    notifyListeners();

    final requestQuery = value.trim();
    _searchTimer = Timer(_searchDebounce, () async {
      try {
        final suggestions = await _mapboxPlacesService.searchPlaces(
          requestQuery,
          proximityLat: _mapCenter.latitude,
          proximityLng: _mapCenter.longitude,
        );

        if (_searchQuery.trim() != requestQuery) return;

        _searchSuggestions = suggestions;
      } catch (_) {
        _searchSuggestions = const [];
      }
      _isSearchingPlaces = false;
      notifyListeners();
    });
  }

  void clearSearchSuggestions() {
    if (_searchSuggestions.isEmpty) return;
    _searchSuggestions = const [];
    notifyListeners();
  }

  Future<void> selectSearchSuggestion(MapPlaceSuggestion suggestion) async {
    _searchSuggestions = const [];
    _searchQuery = suggestion.fullName;
    _selectedSearchLocation = LatLng(suggestion.lat, suggestion.lng);
    _mapCenter = _selectedSearchLocation!;
    _zoom = 15.5;
    notifyListeners();
  }

  Future<LatLng?> recenterToUser() async {
    await _loadCurrentLocation();
    if (_userLocation == null) {
      _errorMessage =
          'Standort konnte nicht ermittelt werden. Bitte Berechtigungen pruefen.';
      notifyListeners();
      return null;
    }

    _mapCenter = _userLocation!;
    if (_zoom < 15) _zoom = 15;
    notifyListeners();
    return _userLocation;
  }

  void setReportTapLocation(LatLng location) {
    _reportTapLocation = location;
    _savedReportPinLocation = location;
    _useCurrentLocationForReport = false;
    notifyListeners();
  }

  void clearReportTapLocation() {
    _reportTapLocation = null;
    notifyListeners();
  }

  void clearReportState() {
    _reportTapLocation = null;
    _savedReportPinLocation = null;
    notifyListeners();
  }

  void setUseCurrentLocationForReport(bool useCurrent) {
    _useCurrentLocationForReport = useCurrent;
    if (useCurrent) {
      _reportTapLocation = null;
    } else if (_reportTapLocation == null && _savedReportPinLocation != null) {
      _reportTapLocation = _savedReportPinLocation;
    }
    notifyListeners();
  }

  void setSelectedReportCategory(String categoryKey) {
    _selectedReportCategoryKey = categoryKey;
    notifyListeners();
  }

  Future<bool> submitReport({String? categoryKey, String? comment}) async {
    final selectedCategory = categoryKey ?? _selectedReportCategoryKey;
    if (selectedCategory == null || selectedCategory.isEmpty) {
      _errorMessage = 'Bitte waehle eine Kategorie aus.';
      notifyListeners();
      return false;
    }

    LatLng? target;
    if (_useCurrentLocationForReport) {
      await _loadCurrentLocation();
      target = _userLocation;
    } else {
      target = _reportTapLocation;
    }

    if (target == null) {
      _errorMessage =
          'Keine gültige Position verfuegbar. Tippe auf die Karte oder nutze den aktuellen Standort.';
      notifyListeners();
      return false;
    }

    _isSubmittingReport = true;
    _errorMessage = null;
    _successMessage = null;
    notifyListeners();

    try {
      final result = await _apiService.submitMapReport(
        lat: target.latitude,
        lng: target.longitude,
        type: selectedCategory,
        comment: comment,
      );

      if (!result.isSuccess) {
        _errorMessage = _extractError(result.data, result.message);
        _isSubmittingReport = false;
        notifyListeners();
        return false;
      }

      _selectedReportCategoryKey = selectedCategory;
      _successMessage = 'Meldung wurde erfolgreich übermittelt.';

      _reportTapLocation = null;
      _savedReportPinLocation = null;
      _isSubmittingReport = false;
      notifyListeners();

      // Refresh map data so the new report appears immediately.
      unawaited(loadMapData(force: true));
      return true;
    } catch (e) {
      _errorMessage = 'Meldung konnte nicht gesendet werden: $e';
      _isSubmittingReport = false;
      notifyListeners();
      return false;
    }
  }

  void toggleLayer(String layerKey) {
    final index = _publicDataLayers.indexWhere((item) => item.key == layerKey);
    if (index == -1) return;

    final updated = [..._publicDataLayers];
    final current = updated[index];
    updated[index] = current.copyWith(isSelected: !current.isSelected);
    _publicDataLayers = updated;
    _renderGeneration++;
    notifyListeners();
  }

  void clearError() {
    _errorMessage = null;
    notifyListeners();
  }

  void clearSuccess() {
    _successMessage = null;
    notifyListeners();
  }

  Future<void> _loadCurrentLocation() async {
    if (_isFetchingLocation) return;

    _isFetchingLocation = true;
    try {
      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) return;

      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }

      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        return;
      }

      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.best,
        ),
      );

      _userLocation = LatLng(position.latitude, position.longitude);
      if (_selectedSearchLocation == null) {
        _mapCenter = _userLocation!;
      }
    } catch (_) {
      final fallback = await Geolocator.getLastKnownPosition();
      if (fallback != null) {
        _userLocation = LatLng(fallback.latitude, fallback.longitude);
        if (_selectedSearchLocation == null) {
          _mapCenter = _userLocation!;
        }
      }
    } finally {
      _isFetchingLocation = false;
      notifyListeners();
    }
  }

  String _extractError(dynamic data, String? fallback) {
    if (data is Map) {
      final error = data['error'] ?? data['message'];
      if (error != null) {
        return error.toString();
      }
    }

    return fallback ?? 'Ein unbekannter Fehler ist aufgetreten.';
  }

  @override
  void dispose() {
    _searchTimer?.cancel();
    super.dispose();
  }
}
