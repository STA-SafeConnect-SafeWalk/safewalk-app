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

  static const _defaultSelectedLayerKeys = <String>{'STREET_LAMP', 'LIT_WAY'};

  static const _fallbackPublicLayers = <HeatmapLayerMetadata>[
    HeatmapLayerMetadata(
      key: 'STREET_LAMP',
      label: 'Strassenlaternen',
      weight: 0.5,
      iconKey: 'street_lamp',
    ),
    HeatmapLayerMetadata(
      key: 'LIT_WAY',
      label: 'Beleuchtete Wege',
      weight: 0.3,
      iconKey: 'lit_way',
    ),
    HeatmapLayerMetadata(
      key: 'UNLIT_WAY',
      label: 'Unbeleuchtete Wege',
      weight: -0.5,
      iconKey: 'unlit_way',
    ),
    HeatmapLayerMetadata(
      key: 'POLICE_STATION',
      label: 'Polizeistationen',
      weight: 1,
      iconKey: 'police_station',
    ),
    HeatmapLayerMetadata(
      key: 'HOSPITAL',
      label: 'Krankenhäuser',
      weight: 0.5,
      iconKey: 'hospital',
    ),
    HeatmapLayerMetadata(
      key: 'EMERGENCY_PHONE',
      label: 'Notruftelefone',
      weight: 0.5,
      iconKey: 'emergency_phone',
    ),
  ];

  static const _fallbackReportCategories = <HeatmapReportCategoryMetadata>[
    HeatmapReportCategoryMetadata(
      key: 'UNSAFE_AREA',
      label: 'Unsicherer Bereich',
      weight: -2,
    ),
    HeatmapReportCategoryMetadata(
      key: 'WELL_LIT',
      label: 'Gut beleuchtet',
      weight: 1,
    ),
    HeatmapReportCategoryMetadata(
      key: 'POORLY_LIT',
      label: 'Schlecht beleuchtet',
      weight: -1,
    ),
    HeatmapReportCategoryMetadata(
      key: 'HIGH_FOOT_TRAFFIC',
      label: 'Hohe Personenfrequenz',
      weight: 1,
    ),
    HeatmapReportCategoryMetadata(
      key: 'LOW_FOOT_TRAFFIC',
      label: 'Geringe Personenfrequenz',
      weight: -1,
    ),
    HeatmapReportCategoryMetadata(
      key: 'CRIME_INCIDENT',
      label: 'Kriminalitätsvorfall',
      weight: -3,
    ),
  ];

  bool _initialized = false;
  bool _isInitializing = false;
  bool _isLoadingMetadata = false;
  bool _isLoadingHeatmap = false;
  bool _isSearchingPlaces = false;
  bool _isSubmittingReport = false;
  bool _isFetchingLocation = false;

  String? _errorMessage;
  String? _successMessage;

  LatLng _mapCenter = _defaultCenter;
  double _zoom = _defaultZoom;
  double _radiusKm = 2;
  double _maxRadiusKm = 10;

  LatLng? _userLocation;
  LatLng? _selectedSearchLocation;
  LatLng? _reportTapLocation;

  MapViewportBounds? _lastViewportBounds;

  String _searchQuery = '';
  List<MapPlaceSuggestion> _searchSuggestions = const [];

  List<HeatmapLayerMetadata> _publicDataLayers = const [];
  List<HeatmapReportCategoryMetadata> _reportCategories = const [];
  List<HeatmapCellModel> _cells = const [];

  String? _selectedReportCategoryKey;
  bool _useCurrentLocationForReport = true;

  List<CommunityReportItem> _communityReports = const [];

  LatLng? _savedReportPinLocation;

  Timer? _searchTimer;

  int _activeHeatmapRequestId = 0;
  int _renderGeneration = 0;

  bool get isInitialized => _initialized;
  bool get isInitializing => _isInitializing;
  bool get isLoadingMetadata => _isLoadingMetadata;
  bool get isLoadingHeatmap => _isLoadingHeatmap;
  bool get isSearchingPlaces => _isSearchingPlaces;
  bool get isSubmittingReport => _isSubmittingReport;

  String? get errorMessage => _errorMessage;
  String? get successMessage => _successMessage;

  LatLng get mapCenter => _mapCenter;
  double get zoom => _zoom;
  double get radiusKm => _radiusKm;

  LatLng? get userLocation => _userLocation;
  LatLng? get selectedSearchLocation => _selectedSearchLocation;
  LatLng? get reportTapLocation => _reportTapLocation;

  String get searchQuery => _searchQuery;
  List<MapPlaceSuggestion> get searchSuggestions => _searchSuggestions;

  List<HeatmapLayerMetadata> get publicDataLayers => _publicDataLayers;
  List<HeatmapReportCategoryMetadata> get reportCategories => _reportCategories;
  List<HeatmapCellModel> get cells => _cells;

  bool get useCurrentLocationForReport => _useCurrentLocationForReport;
  String? get selectedReportCategoryKey => _selectedReportCategoryKey;

  List<CommunityReportItem> get communityReports => _communityReports;
  int get renderGeneration => _renderGeneration;

  bool get isMapboxConfigured => _mapboxPlacesService.isConfigured;
  String get mapboxAccessToken => MapboxPlacesService.accessToken;
  String get mapboxStyleUri => MapboxPlacesService.styleUri;

  List<HeatmapLayerMetadata> get selectedLayers => _publicDataLayers
      .where((layer) => layer.isSelected)
      .toList(growable: false);

  String get activeViewTitle {
    final selected = selectedLayers;
    if (selected.isEmpty) return 'Keine Layer aktiv';

    final selectedKeys = selected.map((item) => item.key).toSet();
    if (selected.length == 2 &&
        selectedKeys.contains('STREET_LAMP') &&
        selectedKeys.contains('LIT_WAY')) {
      return 'Lichtkarte';
    }

    if (selected.length == 1) {
      return selected.first.label;
    }

    return '${selected.length} Layer aktiv';
  }

  String get activeViewSubtitle {
    final total = visibleLayerEntries.fold<int>(
      0,
      (sum, item) => sum + item.count,
    );
    if (total == 0) return 'Keine Einträge im aktuellen Ausschnitt verfügbar';
    return '$total Einträge im aktuellen Ausschnitt';
  }

  Map<String, int> get layerTotals {
    final totals = <String, int>{};
    for (final layer in _publicDataLayers) {
      totals[layer.key] = 0;
    }

    for (final cell in _cells) {
      for (final entry in cell.publicDataCounts.entries) {
        totals[entry.key] = (totals[entry.key] ?? 0) + entry.value;
      }
    }

    return totals;
  }

  List<HeatmapLayerEntry> get visibleLayerEntries {
    final selected = selectedLayers;
    if (selected.isEmpty || _cells.isEmpty) return const [];

    final selectedByKey = {
      for (final layer in selected) layer.key: layer.label,
    };

    final entries = <HeatmapLayerEntry>[];

    for (final cell in _cells) {
      String? strongestKey;
      int strongestCount = 0;

      for (final selectedEntry in selectedByKey.entries) {
        final count = cell.publicDataCounts[selectedEntry.key] ?? 0;
        if (count > strongestCount) {
          strongestCount = count;
          strongestKey = selectedEntry.key;
        }
      }

      if (strongestKey != null && strongestCount > 0) {
        entries.add(
          HeatmapLayerEntry(
            layerKey: strongestKey,
            layerLabel: selectedByKey[strongestKey] ?? strongestKey,
            lat: cell.centerLat,
            lng: cell.centerLng,
            count: strongestCount,
          ),
        );
      }
    }

    entries.sort((a, b) => b.count.compareTo(a.count));
    return entries;
  }

  Future<void> initialize() async {
    if (_initialized) return;

    _initialized = true;
    _isInitializing = true;
    notifyListeners();

    await _loadMetadata();
    await _loadCurrentLocation();

    _isInitializing = false;
    notifyListeners();
  }

  Future<void> loadHeatmap({
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

    final requestRadiusKm = _requiredViewportRadiusKm(
      _zoom,
      center: requestCenter,
      viewportBounds: effectiveViewportBounds,
    );

    if (requestRadiusKm > _maxRadiusKm) {
      _errorMessage =
          'Kartenausschnitt zu gross. Bitte zoomen, um Daten zu laden.';
      notifyListeners();
      return;
    }

    final requestId = ++_activeHeatmapRequestId;

    _isLoadingHeatmap = true;
    notifyListeners();

    try {
      final result = await _apiService.getHeatmap(
        lat: requestCenter.latitude,
        lng: requestCenter.longitude,
        radiusKm: requestRadiusKm,
        cancelPrevious: true,
      );

      if (requestId != _activeHeatmapRequestId) {
        return;
      }

      if (!result.isSuccess || result.data is! Map<String, dynamic>) {
        _errorMessage = _extractError(result.data, result.message);
        return;
      }

      final payload = result.data as Map<String, dynamic>;
      final data = payload['data'];
      if (data is! Map<String, dynamic>) {
        _cells = const [];
        return;
      }

      final rawCells = data['cells'];
      if (rawCells is List) {
        _cells = rawCells
            .whereType<Map>()
            .map(
              (item) =>
                  HeatmapCellModel.fromJson(Map<String, dynamic>.from(item)),
            )
            .toList(growable: false);
      } else {
        _cells = const [];
      }

      final rawReports = data['reports'];
      if (rawReports is List) {
        _communityReports = rawReports
            .whereType<Map>()
            .map(
              (item) => CommunityReportItem.fromJson(
                Map<String, dynamic>.from(item),
              ),
            )
            .toList(growable: false);
      } else {
        _communityReports = const [];
      }

      final serverRadius = _toDouble(data['radiusKm']);
      final effectiveRadius = serverRadius ?? requestRadiusKm;
      if (effectiveRadius > _maxRadiusKm) {
        _errorMessage =
            'Kartenausschnitt zu gross. Bitte zoomen, um Daten zu laden.';
      }
    } catch (e) {
      if (requestId != _activeHeatmapRequestId) {
        return;
      }
      _errorMessage = 'Heatmap-Daten konnten nicht geladen werden: $e';
    } finally {
      if (requestId == _activeHeatmapRequestId) {
        _isLoadingHeatmap = false;
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

  double _requiredViewportRadiusKm(
    double zoom, {
    required LatLng center,
    MapViewportBounds? viewportBounds,
  }) {
    if (viewportBounds != null) {
      var maxCornerDistanceKm = 0.0;
      for (final corner in viewportBounds.corners) {
        final distance = _haversineKm(center, corner);
        if (distance > maxCornerDistanceKm) {
          maxCornerDistanceKm = distance;
        }
      }

      if (maxCornerDistanceKm > 0) {
        return maxCornerDistanceKm;
      }
    }

    const earthCircumKm = 40075.0;
    final kmPerPx = earthCircumKm / (256 * (1 << zoom.floor()));
    const fallbackScreenPx = 420.0;
    final zoomBasedFallback = kmPerPx * fallbackScreenPx / 2;
    final configuredFallback = _radiusKm > 0 ? _radiusKm : zoomBasedFallback;
    return configuredFallback;
  }

  static double _haversineKm(LatLng a, LatLng b) {
    const r = 6371.0;
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

  Future<bool> submitReport({String? categoryKey, String? description}) async {
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
      final result = await _apiService.submitHeatmapReport(
        lat: target.latitude,
        lng: target.longitude,
        category: selectedCategory,
        description: description,
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

  Future<void> _loadMetadata() async {
    _isLoadingMetadata = true;
    notifyListeners();

    try {
      final result = await _apiService.getHeatmapMetadata();

      if (result.isSuccess && result.data is Map<String, dynamic>) {
        final payload = result.data as Map<String, dynamic>;
        final data = payload['data'];

        if (data is Map<String, dynamic>) {
          final categories = _parseReportCategories(data['reportCategories']);
          final layers = _parsePublicLayers(data['publicDataLayers']);

          if (categories.isNotEmpty) {
            _reportCategories = categories;
            _selectedReportCategoryKey ??= _reportCategories.first.key;
          }

          if (layers.isNotEmpty) {
            _publicDataLayers = layers;
          }

          final defaults = data['defaults'];
          if (defaults is Map<String, dynamic>) {
            final radiusValue = _toDouble(defaults['radiusKm']);
            if (radiusValue != null && radiusValue > 0) {
              _radiusKm = radiusValue;
            }

            final maxRadiusValue = _toDouble(defaults['maxRadiusKm']);
            if (maxRadiusValue != null && maxRadiusValue > 0) {
              _maxRadiusKm = maxRadiusValue;
              if (_radiusKm > _maxRadiusKm) {
                _radiusKm = _maxRadiusKm;
              }
            }
          }
        }
      }
    } catch (_) {}

    if (_reportCategories.isEmpty) {
      _reportCategories = _fallbackReportCategories;
      _selectedReportCategoryKey ??= _reportCategories.first.key;
    }

    if (_publicDataLayers.isEmpty) {
      _publicDataLayers = _fallbackPublicLayers
          .map(
            (layer) => layer.copyWith(
              isSelected: _defaultSelectedLayerKeys.contains(layer.key),
            ),
          )
          .toList(growable: false);
    }

    _isLoadingMetadata = false;
    notifyListeners();
  }

  List<HeatmapReportCategoryMetadata> _parseReportCategories(dynamic value) {
    if (value is! List) return const [];

    final parsed = <HeatmapReportCategoryMetadata>[];
    for (final item in value) {
      if (item is! Map) continue;
      final map = Map<String, dynamic>.from(item);
      final key = (map['key'] ?? '').toString();
      if (key.isEmpty) continue;

      parsed.add(HeatmapReportCategoryMetadata.fromJson(map));
    }

    return parsed;
  }

  List<HeatmapLayerMetadata> _parsePublicLayers(dynamic value) {
    if (value is! List) return const [];

    final parsed = <HeatmapLayerMetadata>[];
    for (final item in value) {
      if (item is! Map) continue;
      final map = Map<String, dynamic>.from(item);
      final key = (map['key'] ?? '').toString();
      if (key.isEmpty) continue;

      parsed.add(
        HeatmapLayerMetadata.fromJson(
          map,
          isSelected: _defaultSelectedLayerKeys.contains(key),
        ),
      );
    }

    return parsed;
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

  double? _toDouble(dynamic value) {
    if (value is double) return value;
    if (value is num) return value.toDouble();
    if (value is String) return double.tryParse(value);
    return null;
  }

  @override
  void dispose() {
    _searchTimer?.cancel();
    super.dispose();
  }
}
