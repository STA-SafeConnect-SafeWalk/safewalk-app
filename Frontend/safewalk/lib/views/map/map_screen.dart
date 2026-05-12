import 'dart:async';
import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:mapbox_maps_flutter/mapbox_maps_flutter.dart';
import 'package:provider/provider.dart';
import 'package:safewalk/models/map_models.dart';
import 'package:safewalk/viewmodels/map_viewmodel.dart';

const _kMapBackground = Color(0xFFF5F8F8);
const _kMapPrimary = Color(0xFF00666B);
const _kMapPrimarySoft = Color(0x1A00666B);
const _kMapCardBackground = Colors.white;
const _kMarkerBorder = Color(0xFFAEEADB);

class _LayerVisualStyle {
  const _LayerVisualStyle({required this.icon, required this.color});

  final IconData icon;
  final Color color;
}

enum _ContactFreshness { fresh, stale }

_LayerVisualStyle _layerVisualStyle(String layerKey) {
  switch (layerKey) {
    case 'STREET_LAMP':
      return const _LayerVisualStyle(
        icon: Icons.light_mode_rounded,
        color: Color(0xFFE0AA00),
      );
    case 'UNLIT_WAY':
      return const _LayerVisualStyle(
        icon: Icons.nights_stay_rounded,
        color: Color(0xFFE11D48),
      );
    case 'POLICE':
      return const _LayerVisualStyle(
        icon: Icons.local_police_rounded,
        color: Color(0xFF2563EB),
      );
    case 'HOSPITAL':
      return const _LayerVisualStyle(
        icon: Icons.local_hospital_rounded,
        color: Color(0xFFDB2777),
      );
    case 'CLINIC':
      return const _LayerVisualStyle(
        icon: Icons.medical_services_rounded,
        color: Color(0xFFEC4899),
      );
    case 'PHARMACY':
      return const _LayerVisualStyle(
        icon: Icons.local_pharmacy_rounded,
        color: Color(0xFF16A34A),
      );
    case 'FIRE_STATION':
      return const _LayerVisualStyle(
        icon: Icons.local_fire_department_rounded,
        color: Color(0xFFEA580C),
      );
    case 'EMERGENCY_PHONE':
      return const _LayerVisualStyle(
        icon: Icons.phone_in_talk_rounded,
        color: Color(0xFF7C3AED),
      );
    default:
      return const _LayerVisualStyle(
        icon: Icons.place_rounded,
        color: Color(0xFF475569),
      );
  }
}

class MapScreen extends StatefulWidget {
  const MapScreen({super.key});

  @override
  State<MapScreen> createState() => _MapScreenState();
}

class _MapScreenState extends State<MapScreen> {
  final TextEditingController _searchController = TextEditingController();
  final FocusNode _searchFocusNode = FocusNode();
  bool _awaitingReportPin = false;

  MapboxMap? _mapboxMap;
  PointAnnotationManager? _pointAnnotationManager;
  CircleAnnotationManager? _reportPinAnnotationManager;
  PointAnnotationManager? _communityReportAnnotationManager;
  PointAnnotationManager? _contactAnnotationManager;
  PointAnnotationManager? _sosAnnotationManager;
  CircleAnnotationManager? _sosHaloAnnotationManager;
  bool _cameraUpdatesEnabled = false;
  bool _initialCameraSynced = false;

  List<MapLayerEntry>? _lastRenderedEntries;
  List<CommunityReportItem>? _lastRenderedCommunityReports;
  List<ContactLiveLocation>? _lastRenderedContacts;
  List<ActiveSosLocation>? _lastRenderedSos;
  List<CircleAnnotation> _sosHaloAnnotations = const [];
  LatLng? _lastReportTapLocation;
  LatLng? _lastSearchLocation;
  int _lastRenderGeneration = 0;
  final Map<String, Uint8List> _markerIconCache = <String, Uint8List>{};

  /// Smooth SOS halo pulse — uses a high-frequency Ticker via Timer.periodic.
  Timer? _sosPulseTimer;
  double _sosPulseT = 0.0;
  static const Duration _sosPulseTickInterval = Duration(milliseconds: 33);
  static const Duration _sosPulseDuration = Duration(milliseconds: 1400);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      final vm = context.read<MapViewModel>();
      if (vm.isMapboxConfigured) {
        MapboxOptions.setAccessToken(vm.mapboxAccessToken);
      }
      vm.addListener(_onViewModelChanged);
      await vm.initialize();
    });
  }

  void _onViewModelChanged() {
    final vm = context.read<MapViewModel>();
    unawaited(_ensureInitialCameraSync(vm));

    final generationChanged = vm.renderGeneration != _lastRenderGeneration;
    if (generationChanged) {
      _lastRenderGeneration = vm.renderGeneration;
    }

    final entries = vm.visibleLayerEntries;
    final reportChanged = !_sameLocation(
      vm.reportTapLocation,
      _lastReportTapLocation,
    );
    final searchChanged = !_sameLocation(
      vm.selectedSearchLocation,
      _lastSearchLocation,
    );
    if (generationChanged ||
        reportChanged ||
        searchChanged ||
        !_listEquals(entries, _lastRenderedEntries)) {
      _lastReportTapLocation = vm.reportTapLocation;
      _lastSearchLocation = vm.selectedSearchLocation;
      _syncAnnotations(vm);
    }

    final communityReports = vm.communityReports;
    if (!_communityReportsEqual(
      communityReports,
      _lastRenderedCommunityReports,
    )) {
      _lastRenderedCommunityReports = communityReports;
      _syncCommunityReportAnnotations(vm);
    }

    final contacts = vm.contactLocations;
    if (!_contactsEqual(contacts, _lastRenderedContacts)) {
      _lastRenderedContacts = List<ContactLiveLocation>.unmodifiable(contacts);
      _syncContactAnnotations(vm);
    }

    final activeSos = vm.activeSosLocations;
    if (!_sosEqual(activeSos, _lastRenderedSos)) {
      _lastRenderedSos = List<ActiveSosLocation>.unmodifiable(activeSos);
      _syncSosAnnotations(vm);
    }

    _ensureSosPulseTimer(activeSos.isNotEmpty);
  }

  bool _listEquals(List<MapLayerEntry>? a, List<MapLayerEntry>? b) {
    if (identical(a, b)) return true;
    if (a == null || b == null || a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i].lat != b[i].lat ||
          a[i].lng != b[i].lng ||
          a[i].layerKey != b[i].layerKey) {
        return false;
      }
    }
    return true;
  }

  bool _sameLocation(LatLng? a, LatLng? b) {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    return a.latitude == b.latitude && a.longitude == b.longitude;
  }

  bool _communityReportsEqual(
    List<CommunityReportItem>? a,
    List<CommunityReportItem>? b,
  ) {
    if (identical(a, b)) return true;
    if (a == null || b == null || a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i].reportId != b[i].reportId) return false;
    }
    return true;
  }

  bool _contactsEqual(
    List<ContactLiveLocation>? a,
    List<ContactLiveLocation>? b,
  ) {
    if (identical(a, b)) return true;
    if (a == null || b == null || a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i] != b[i]) return false;
    }
    return true;
  }

  bool _sosEqual(List<ActiveSosLocation>? a, List<ActiveSosLocation>? b) {
    if (identical(a, b)) return true;
    if (a == null || b == null || a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i] != b[i]) return false;
    }
    return true;
  }

  @override
  void dispose() {
    context.read<MapViewModel>().removeListener(_onViewModelChanged);
    _sosPulseTimer?.cancel();
    _searchController.dispose();
    _searchFocusNode.dispose();
    _markerIconCache.clear();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final vm = context.watch<MapViewModel>();

    _syncSearchField(vm);
    _showFeedbackMessages(vm);

    return Scaffold(
      backgroundColor: _kMapBackground,
      body: SafeArea(
        bottom: false,
        child: Stack(
          children: [
            Positioned.fill(child: _buildMap(vm)),
            // SOS banner sits ABOVE the search bar so it's always the topmost
            // navigation element when an alarm is active.
            if (vm.hasActiveSos)
              Positioned(
                top: 4,
                left: 16,
                right: 16,
                child: _buildSosBanner(vm),
              ),
            Positioned(
              top: vm.hasActiveSos ? 76 : 8,
              left: 16,
              right: 16,
              child: _buildTopSearch(vm),
            ),
            Positioned(
              top: vm.hasActiveSos ? 162 : 94,
              right: 16,
              child: _buildMapControls(vm),
            ),
            Positioned(
              left: 16,
              right: 16,
              bottom: 16,
              child: _buildActiveLayerCard(vm),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildMap(MapViewModel vm) {
    if (!vm.isMapboxConfigured) {
      return Container(
        color: const Color(0xFFE6F1F3),
        child: const Center(
          child: Padding(
            padding: EdgeInsets.symmetric(horizontal: 32),
            child: Text(
              'Mapbox ist noch nicht konfiguriert. Bitte MAPBOX_ACCESS_TOKEN als Dart-Define setzen.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Color(0xFF3A4B4D), fontSize: 15),
            ),
          ),
        ),
      );
    }

    return MapWidget(
      key: const ValueKey('mapbox-map'),
      mapOptions: MapOptions(
        pixelRatio: MediaQuery.of(context).devicePixelRatio,
      ),
      styleUri: vm.mapboxStyleUri,
      cameraOptions: CameraOptions(
        center: Point(
          coordinates: Position(vm.mapCenter.longitude, vm.mapCenter.latitude),
        ),
        zoom: vm.zoom,
      ),
      onMapCreated: _onMapCreated,
      onCameraChangeListener: _onCameraChanged,
      onTapListener: _onMapTap,
      onMapIdleListener: _onMapIdle,
    );
  }

  void _onMapCreated(MapboxMap map) async {
    _mapboxMap = map;
    _pointAnnotationManager = await map.annotations
        .createPointAnnotationManager();
    _reportPinAnnotationManager = await map.annotations
        .createCircleAnnotationManager();
    _communityReportAnnotationManager = await map.annotations
        .createPointAnnotationManager();
    // Contact + SOS layers must be on top of POIs / community reports.
    _contactAnnotationManager = await map.annotations
        .createPointAnnotationManager();
    // Pulse halo sits below the SOS icon.
    _sosHaloAnnotationManager = await map.annotations
        .createCircleAnnotationManager();
    _sosAnnotationManager = await map.annotations
        .createPointAnnotationManager();

    await map.scaleBar.updateSettings(ScaleBarSettings(enabled: false));
    await map.compass.updateSettings(CompassSettings(enabled: false));
    await map.attribution.updateSettings(
      AttributionSettings(marginBottom: 100),
    );

    await map.location.updateSettings(
      LocationComponentSettings(
        enabled: true,
        pulsingEnabled: true,
        pulsingColor: const Color(0xFF3B82F6).toARGB32(),
        showAccuracyRing: true,
      ),
    );

    if (!mounted) return;
    final vm = context.read<MapViewModel>();
    unawaited(_ensureInitialCameraSync(vm));
    unawaited(_syncAnnotations(vm));
    unawaited(_syncCommunityReportAnnotations(vm));
  }

  Future<void> _ensureInitialCameraSync(MapViewModel vm) async {
    final map = _mapboxMap;
    if (map == null || _initialCameraSynced || !vm.isInitialized) {
      return;
    }

    _initialCameraSynced = true;

    try {
      await map.setCamera(
        CameraOptions(
          center: Point(
            coordinates: Position(
              vm.mapCenter.longitude,
              vm.mapCenter.latitude,
            ),
          ),
          zoom: vm.zoom,
        ),
      );

      _cameraUpdatesEnabled = true;

      final camera = await map.getCameraState();
      _applyCameraStateToViewModel(camera, includeViewportBounds: true);
    } catch (_) {
      _cameraUpdatesEnabled = true;
    }
  }

  void _onCameraChanged(CameraChangedEventData event) {
    if (!_cameraUpdatesEnabled) return;

    _applyCameraStateToViewModel(
      event.cameraState,
      includeViewportBounds: false,
    );
  }

  void _onMapTap(MapContentGestureContext gestureContext) {
    final point = gestureContext.point;
    final coords = point.coordinates;
    final tappedLat = coords.lat.toDouble();
    final tappedLng = coords.lng.toDouble();

    if (_awaitingReportPin) {
      final vm = context.read<MapViewModel>();
      vm.setReportTapLocation(LatLng(tappedLat, tappedLng));
      _syncAnnotations(vm);
      _awaitingReportPin = false;
      _openReportSheet();
      return;
    }

    final vm = context.read<MapViewModel>();

    // Priority: SOS alarms first, then live contacts, then community reports.
    final tappedSos = _findNearestSos(
      vm.activeSosLocations,
      tappedLat,
      tappedLng,
    );
    if (tappedSos != null) {
      _showContactDetail(
        title: 'SOS — ${tappedSos.victimDisplayName}',
        displayName: tappedSos.victimDisplayName,
        updatedAt: tappedSos.updatedAt,
        accuracy: tappedSos.accuracy,
        isSos: true,
      );
      return;
    }

    final tappedContact = _findNearestContact(
      vm.contactLocations,
      tappedLat,
      tappedLng,
    );
    if (tappedContact != null) {
      _showContactDetail(
        title: tappedContact.displayName,
        displayName: tappedContact.displayName,
        updatedAt: tappedContact.updatedAt,
        accuracy: tappedContact.accuracy,
        isSos: false,
      );
      return;
    }

    final tappedReport = _findNearestCommunityReport(
      vm.communityReports,
      tappedLat,
      tappedLng,
    );
    if (tappedReport != null) {
      _showCommunityReportDetail(tappedReport);
    }
  }

  ContactLiveLocation? _findNearestContact(
    List<ContactLiveLocation> contacts,
    double lat,
    double lng,
  ) {
    if (contacts.isEmpty) return null;
    const thresholdDeg = 0.0006;
    ContactLiveLocation? closest;
    double closestDist = double.infinity;
    for (final c in contacts) {
      final dLat = (c.lat - lat).abs();
      final dLng = (c.lng - lng).abs();
      if (dLat > thresholdDeg || dLng > thresholdDeg) continue;
      final dist = dLat * dLat + dLng * dLng;
      if (dist < closestDist) {
        closestDist = dist;
        closest = c;
      }
    }
    return closest;
  }

  ActiveSosLocation? _findNearestSos(
    List<ActiveSosLocation> alarms,
    double lat,
    double lng,
  ) {
    if (alarms.isEmpty) return null;
    const thresholdDeg = 0.0008;
    ActiveSosLocation? closest;
    double closestDist = double.infinity;
    for (final s in alarms) {
      final dLat = (s.lat - lat).abs();
      final dLng = (s.lng - lng).abs();
      if (dLat > thresholdDeg || dLng > thresholdDeg) continue;
      final dist = dLat * dLat + dLng * dLng;
      if (dist < closestDist) {
        closestDist = dist;
        closest = s;
      }
    }
    return closest;
  }

  CommunityReportItem? _findNearestCommunityReport(
    List<CommunityReportItem> reports,
    double lat,
    double lng,
  ) {
    if (reports.isEmpty) return null;

    const thresholdDeg = 0.0005;
    CommunityReportItem? closest;
    double closestDist = double.infinity;

    for (final report in reports) {
      final dLat = (report.lat - lat).abs();
      final dLng = (report.lng - lng).abs();
      if (dLat > thresholdDeg || dLng > thresholdDeg) continue;
      final dist = dLat * dLat + dLng * dLng;
      if (dist < closestDist) {
        closestDist = dist;
        closest = report;
      }
    }
    return closest;
  }

  void _onMapIdle(MapIdleEventData event) {
    final map = _mapboxMap;
    if (!_cameraUpdatesEnabled || map == null) return;

    Future<void>(() async {
      final camera = await map.getCameraState();
      _applyCameraStateToViewModel(camera, includeViewportBounds: true);
    });
  }

  void _applyCameraStateToViewModel(
    CameraState camera, {
    required bool includeViewportBounds,
  }) {
    final map = _mapboxMap;
    if (!mounted) return;

    Future<void>(() async {
      MapViewportBounds? viewportBounds;

      if (includeViewportBounds && map != null) {
        try {
          final bounds = await map.coordinateBoundsForCamera(
            CameraOptions(
              center: camera.center,
              padding: camera.padding,
              zoom: camera.zoom,
              bearing: camera.bearing,
              pitch: camera.pitch,
            ),
          );

          viewportBounds = MapViewportBounds(
            north: bounds.northeast.coordinates.lat.toDouble(),
            south: bounds.southwest.coordinates.lat.toDouble(),
            east: bounds.northeast.coordinates.lng.toDouble(),
            west: bounds.southwest.coordinates.lng.toDouble(),
          );
        } catch (_) {}
      }

      if (!mounted) return;

      final center = camera.center.coordinates;
      final vm = context.read<MapViewModel>();
      vm.onCameraMoved(
        LatLng(center.lat.toDouble(), center.lng.toDouble()),
        camera.zoom,
        viewportBounds: viewportBounds,
      );
    });
  }

  Future<void> _syncCommunityReportAnnotations(MapViewModel vm) async {
    final mgr = _communityReportAnnotationManager;
    if (mgr == null) return;

    await mgr.deleteAll();

    final reports = vm.communityReports;
    if (reports.isEmpty) return;

    final markerIcon = await _markerIconForVisual(
      cacheKey: 'community-report',
      icon: Icons.campaign_rounded,
      iconColor: const Color(0xFFD97706),
    );

    final options = reports
        .map(
          (report) => PointAnnotationOptions(
            geometry: Point(coordinates: Position(report.lng, report.lat)),
            image: markerIcon,
            iconAnchor: IconAnchor.BOTTOM,
            iconSize: 0.85,
          ),
        )
        .toList(growable: false);

    await mgr.createMulti(options);
  }

  void _showContactDetail({
    required String title,
    required String displayName,
    required DateTime updatedAt,
    required double accuracy,
    required bool isSos,
  }) {
    if (!mounted) return;

    final initials = _initialsFor(displayName);
    final age = DateTime.now().difference(updatedAt);
    final ringColor = isSos
        ? const Color(0xFFB91C1C)
        : (age <= MapViewModel.locationStaleAfter
              ? const Color(0xFF16A34A)
              : const Color(0xFFCA8A04));
    final fillColor = isSos
        ? const Color(0xFFDC2626)
        : (age <= MapViewModel.locationStaleAfter
              ? _kMapPrimary
              : const Color(0xFF94A3B8));

    showDialog<void>(
      context: context,
      barrierColor: Colors.black.withValues(alpha: 0.35),
      builder: (ctx) {
        return Dialog(
          backgroundColor: Colors.white,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(24),
          ),
          insetPadding: const EdgeInsets.symmetric(horizontal: 32),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 24, 20, 16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Container(
                  width: 72,
                  height: 72,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: fillColor,
                    border: Border.all(color: ringColor, width: 3),
                  ),
                  child: Center(
                    child: Text(
                      initials,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 26,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 14),
                if (isSos) ...[
                  const Text(
                    'AKTIVER SOS-ALARM',
                    style: TextStyle(
                      color: Color(0xFFDC2626),
                      fontWeight: FontWeight.w800,
                      fontSize: 12,
                      letterSpacing: 1.2,
                    ),
                  ),
                  const SizedBox(height: 4),
                ],
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                  ),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 12),
                _DetailRow(
                  icon: Icons.access_time_rounded,
                  label: 'Letztes Update',
                  value: 'vor ${_formatAge(age)}',
                ),
                const SizedBox(height: 6),
                _DetailRow(
                  icon: Icons.gps_fixed_rounded,
                  label: 'Genauigkeit',
                  value: '±${accuracy.toStringAsFixed(0)} m',
                ),
                const SizedBox(height: 16),
                SizedBox(
                  width: double.infinity,
                  child: TextButton(
                    onPressed: () => Navigator.of(ctx).pop(),
                    style: TextButton.styleFrom(
                      foregroundColor: _kMapPrimary,
                      padding: const EdgeInsets.symmetric(vertical: 12),
                    ),
                    child: const Text(
                      'Schliessen',
                      style: TextStyle(fontWeight: FontWeight.w600),
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  void _showCommunityReportDetail(CommunityReportItem report) {
    if (!mounted) return;

    final vm = context.read<MapViewModel>();
    final categoryLabel =
        vm.reportCategories
            .where((c) => c.key == report.type)
            .map((c) => c.label)
            .firstOrNull ??
        report.type;

    showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (_) => Container(
        padding: const EdgeInsets.all(20),
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(
                  Icons.campaign_rounded,
                  color: Color(0xFFD97706),
                  size: 24,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    categoryLabel,
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
            if (report.comment != null && report.comment!.isNotEmpty) ...[
              const SizedBox(height: 12),
              Text(
                report.comment!,
                style: const TextStyle(fontSize: 15, color: Color(0xFF475569)),
              ),
            ],
            if (report.createdAt != null) ...[
              const SizedBox(height: 10),
              Text(
                'Gemeldet am ${_formatDate(report.createdAt!)}',
                style: const TextStyle(fontSize: 13, color: Color(0xFF94A3B8)),
              ),
            ],
          ],
        ),
      ),
    );
  }

  String _formatDate(String isoDate) {
    try {
      final dt = DateTime.parse(isoDate);
      return '${dt.day.toString().padLeft(2, '0')}.${dt.month.toString().padLeft(2, '0')}.${dt.year}';
    } catch (_) {
      return isoDate;
    }
  }

  Future<void> _syncAnnotations(MapViewModel vm) async {
    final pointMgr = _pointAnnotationManager;
    final reportMgr = _reportPinAnnotationManager;
    if (pointMgr == null || reportMgr == null) return;

    final renderGen = vm.renderGeneration;

    await pointMgr.deleteAll();
    await reportMgr.deleteAll();

    if (vm.renderGeneration != renderGen) return;

    final entries = vm.visibleLayerEntries;
    _lastRenderedEntries = entries;

    final iconsByLayerKey = <String, Uint8List>{};
    for (final entry in entries) {
      if (!iconsByLayerKey.containsKey(entry.layerKey)) {
        final style = _layerVisualStyle(entry.layerKey);
        iconsByLayerKey[entry.layerKey] = await _markerIconForVisual(
          cacheKey: 'layer:${entry.layerKey}',
          icon: style.icon,
          iconColor: style.color,
        );
        if (vm.renderGeneration != renderGen) return;
      }
    }

    final pointOptions = <PointAnnotationOptions>[];
    for (final entry in entries) {
      pointOptions.add(
        PointAnnotationOptions(
          geometry: Point(coordinates: Position(entry.lng, entry.lat)),
          image: iconsByLayerKey[entry.layerKey]!,
          iconAnchor: IconAnchor.BOTTOM,
          iconSize: 1,
        ),
      );
    }

    if (vm.selectedSearchLocation != null) {
      final searchMarkerIcon = await _markerIconForVisual(
        cacheKey: 'search-pin',
        icon: Icons.place_rounded,
        iconColor: const Color(0xFF2563EB),
      );
      if (vm.renderGeneration != renderGen) return;
      pointOptions.add(
        PointAnnotationOptions(
          geometry: Point(
            coordinates: Position(
              vm.selectedSearchLocation!.longitude,
              vm.selectedSearchLocation!.latitude,
            ),
          ),
          image: searchMarkerIcon,
          iconAnchor: IconAnchor.BOTTOM,
          iconSize: 1,
          symbolSortKey: 999,
        ),
      );
    }

    if (vm.renderGeneration != renderGen) return;

    if (pointOptions.isNotEmpty) {
      await pointMgr.createMulti(pointOptions);
    }

    if (vm.reportTapLocation != null) {
      await reportMgr.create(
        CircleAnnotationOptions(
          geometry: Point(
            coordinates: Position(
              vm.reportTapLocation!.longitude,
              vm.reportTapLocation!.latitude,
            ),
          ),
          circleRadius: 10,
          circleColor: const Color(0xFFEF4444).toARGB32(),
          circleStrokeColor: Colors.white.toARGB32(),
          circleStrokeWidth: 2,
        ),
      );
    }
  }

  Future<Uint8List> _markerIconForVisual({
    required String cacheKey,
    required IconData icon,
    required Color iconColor,
  }) async {
    final cached = _markerIconCache[cacheKey];
    if (cached != null) {
      return cached;
    }

    final markerBytes = await _buildMarkerIcon(
      icon: icon,
      iconColor: iconColor,
    );
    _markerIconCache[cacheKey] = markerBytes;
    return markerBytes;
  }

  // ── Contact / SOS markers ────────────────────────────────────────────────

  Future<void> _syncContactAnnotations(MapViewModel vm) async {
    final mgr = _contactAnnotationManager;
    if (mgr == null) return;

    await mgr.deleteAll();

    final contacts = vm.contactLocations;
    if (contacts.isEmpty) return;

    final now = DateTime.now();
    final options = <PointAnnotationOptions>[];
    for (final contact in contacts) {
      final age = contact.ageFrom(now);
      final freshness = _freshnessFor(age);
      final initials = _initialsFor(contact.displayName);
      final icon = await _buildContactAvatarIcon(
        initials: initials,
        freshness: freshness,
      );
      options.add(
        PointAnnotationOptions(
          geometry: Point(coordinates: Position(contact.lng, contact.lat)),
          image: icon,
          iconAnchor: IconAnchor.CENTER,
          iconSize: 1,
          symbolSortKey: 1000,
        ),
      );
    }

    if (options.isNotEmpty) {
      await mgr.createMulti(options);
    }
  }

  Future<void> _syncSosAnnotations(MapViewModel vm) async {
    final mgr = _sosAnnotationManager;
    final haloMgr = _sosHaloAnnotationManager;
    if (mgr == null || haloMgr == null) return;

    await mgr.deleteAll();
    await haloMgr.deleteAll();
    _sosHaloAnnotations = const [];

    final sosList = vm.activeSosLocations;
    if (sosList.isEmpty) return;

    // Static initials avatar per victim — same shape/colors as contact avatar
    // but in the danger palette.
    final pointOptions = <PointAnnotationOptions>[];
    for (final sos in sosList) {
      final initials = _initialsFor(sos.victimDisplayName);
      final icon = await _buildSosAvatarIcon(initials: initials);
      pointOptions.add(
        PointAnnotationOptions(
          geometry: Point(coordinates: Position(sos.lng, sos.lat)),
          image: icon,
          iconAnchor: IconAnchor.CENTER,
          iconSize: 1,
          symbolSortKey: 2000,
        ),
      );
    }

    // Halo circles (initial state) — animated by the pulse ticker.
    final haloOptions = sosList
        .map(
          (sos) => CircleAnnotationOptions(
            geometry: Point(coordinates: Position(sos.lng, sos.lat)),
            circleRadius: _sosHaloRadiusForT(_sosPulseT),
            circleColor: const Color(0xFFEF4444).toARGB32(),
            circleOpacity: _sosHaloOpacityForT(_sosPulseT),
            circleStrokeWidth: 0,
          ),
        )
        .toList(growable: false);

    final created = <CircleAnnotation>[];
    for (final opt in haloOptions) {
      final ann = await haloMgr.create(opt);
      created.add(ann);
    }
    _sosHaloAnnotations = created;

    await mgr.createMulti(pointOptions);
  }

  void _ensureSosPulseTimer(bool active) {
    if (active) {
      if (_sosPulseTimer != null) return;
      final start = DateTime.now();
      _sosPulseTimer = Timer.periodic(_sosPulseTickInterval, (_) {
        if (!mounted) return;
        final elapsed = DateTime.now().difference(start).inMilliseconds;
        _sosPulseT =
            (elapsed % _sosPulseDuration.inMilliseconds) /
            _sosPulseDuration.inMilliseconds;
        unawaited(_animateSosHalo());
      });
    } else {
      _sosPulseTimer?.cancel();
      _sosPulseTimer = null;
    }
  }

  Future<void> _animateSosHalo() async {
    final haloMgr = _sosHaloAnnotationManager;
    if (haloMgr == null) return;
    if (_sosHaloAnnotations.isEmpty) return;

    final radius = _sosHaloRadiusForT(_sosPulseT);
    final opacity = _sosHaloOpacityForT(_sosPulseT);

    for (final annotation in _sosHaloAnnotations) {
      annotation.circleRadius = radius;
      annotation.circleOpacity = opacity;
      try {
        await haloMgr.update(annotation);
      } catch (_) {
        // Ignore transient update errors during teardown.
      }
    }
  }

  /// Smooth ease-out radius growth from 18 → 70 px.
  double _sosHaloRadiusForT(double t) {
    final eased = 1 - math.pow(1 - t, 2).toDouble();
    return 18 + 52 * eased;
  }

  /// Smooth fade-out from 0.55 → 0.
  double _sosHaloOpacityForT(double t) {
    final eased = math.pow(1 - t, 1.6).toDouble();
    return 0.55 * eased;
  }

  String _initialsFor(String name) {
    final cleaned = name.trim();
    if (cleaned.isEmpty) return '?';
    final parts = cleaned.split(RegExp(r'\s+'));
    if (parts.length >= 2 && parts.first.isNotEmpty && parts.last.isNotEmpty) {
      return '${parts.first[0]}${parts.last[0]}'.toUpperCase();
    }
    return cleaned[0].toUpperCase();
  }

  _ContactFreshness _freshnessFor(Duration age) {
    if (age <= MapViewModel.locationStaleAfter) {
      return _ContactFreshness.fresh;
    }
    return _ContactFreshness.stale;
  }

  Future<Uint8List> _buildContactAvatarIcon({
    required String initials,
    required _ContactFreshness freshness,
  }) async {
    final cacheKey = 'contact-avatar:${freshness.name}:$initials';
    final cached = _markerIconCache[cacheKey];
    if (cached != null) return cached;

    final ringColor = switch (freshness) {
      _ContactFreshness.fresh => const Color(0xFF16A34A),
      _ContactFreshness.stale => const Color(0xFFCA8A04),
    };
    final fillColor = switch (freshness) {
      _ContactFreshness.fresh => _kMapPrimary,
      _ContactFreshness.stale => const Color(0xFF94A3B8),
    };

    final bytes = await _renderInitialsAvatar(
      initials: initials,
      fillColor: fillColor,
      ringColor: ringColor,
    );
    _markerIconCache[cacheKey] = bytes;
    return bytes;
  }

  Future<Uint8List> _buildSosAvatarIcon({required String initials}) async {
    final cacheKey = 'sos-avatar:$initials';
    final cached = _markerIconCache[cacheKey];
    if (cached != null) return cached;

    final bytes = await _renderInitialsAvatar(
      initials: initials,
      fillColor: const Color(0xFFDC2626),
      ringColor: const Color(0xFFB91C1C),
    );
    _markerIconCache[cacheKey] = bytes;
    return bytes;
  }

  Future<Uint8List> _renderInitialsAvatar({
    required String initials,
    required Color fillColor,
    required Color ringColor,
  }) async {
    const size = 96.0;
    const center = Offset(size / 2, size / 2);
    const radius = 32.0;

    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder, const Rect.fromLTWH(0, 0, size, size));

    final shadowPaint = Paint()
      ..color = const Color(0x33000000)
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 4)
      ..isAntiAlias = true;
    canvas.drawCircle(center.translate(0, 2), radius, shadowPaint);

    final outerWhitePaint = Paint()
      ..color = Colors.white
      ..isAntiAlias = true;
    canvas.drawCircle(center, radius + 4, outerWhitePaint);

    final ringPaint = Paint()
      ..color = ringColor
      ..isAntiAlias = true
      ..style = PaintingStyle.stroke
      ..strokeWidth = 4;
    canvas.drawCircle(center, radius + 2, ringPaint);

    final fillPaint = Paint()
      ..color = fillColor
      ..isAntiAlias = true;
    canvas.drawCircle(center, radius, fillPaint);

    final textPainter = TextPainter(
      text: TextSpan(
        text: initials,
        style: const TextStyle(
          color: Colors.white,
          fontWeight: FontWeight.w700,
          fontSize: 24,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    textPainter.paint(
      canvas,
      Offset(
        center.dx - textPainter.width / 2,
        center.dy - textPainter.height / 2,
      ),
    );

    final image = await recorder.endRecording().toImage(
      size.toInt(),
      size.toInt(),
    );
    final byteData = await image.toByteData(format: ui.ImageByteFormat.png);
    if (byteData == null) {
      throw StateError('Avatar-Icon konnte nicht erstellt werden.');
    }
    return byteData.buffer.asUint8List();
  }

  Future<Uint8List> _buildMarkerIcon({
    required IconData icon,
    required Color iconColor,
  }) async {
    const markerWidth = 88.0;
    const markerHeight = 98.0;
    const bubbleTop = 8.0;
    const bubbleHeight = 64.0;
    const pointerTop = bubbleTop + bubbleHeight - 2;
    const pointerBottom = 88.0;
    const pointerHalfWidth = 12.0;

    final recorder = ui.PictureRecorder();
    final canvas = Canvas(
      recorder,
      Rect.fromLTWH(0, 0, markerWidth, markerHeight),
    );

    final bubbleRect = RRect.fromRectAndRadius(
      const Rect.fromLTWH(8, bubbleTop, markerWidth - 16, bubbleHeight),
      const Radius.circular(24),
    );
    final pointerPath = Path()
      ..moveTo(markerWidth / 2 - pointerHalfWidth, pointerTop)
      ..lineTo(markerWidth / 2 + pointerHalfWidth, pointerTop)
      ..lineTo(markerWidth / 2, pointerBottom)
      ..close();

    final shadowPaint = Paint()
      ..color = const Color(0x33000000)
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 3)
      ..isAntiAlias = true;
    final fillPaint = Paint()
      ..color = Colors.white
      ..isAntiAlias = true;
    final strokePaint = Paint()
      ..color = _kMarkerBorder
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3
      ..isAntiAlias = true;

    canvas.drawRRect(bubbleRect.shift(const Offset(0, 1)), shadowPaint);
    canvas.drawPath(pointerPath.shift(const Offset(0, 1)), shadowPaint);

    canvas.drawRRect(bubbleRect, fillPaint);
    canvas.drawPath(pointerPath, fillPaint);

    canvas.drawRRect(bubbleRect, strokePaint);
    canvas.drawPath(pointerPath, strokePaint);

    final iconPainter = TextPainter(
      text: TextSpan(
        text: String.fromCharCode(icon.codePoint),
        style: TextStyle(
          color: iconColor,
          fontFamily: icon.fontFamily,
          package: icon.fontPackage,
          fontSize: 34,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();

    iconPainter.paint(
      canvas,
      Offset(
        (markerWidth - iconPainter.width) / 2,
        bubbleTop + (bubbleHeight - iconPainter.height) / 2,
      ),
    );

    final image = await recorder.endRecording().toImage(
      markerWidth.toInt(),
      markerHeight.toInt(),
    );
    final byteData = await image.toByteData(format: ui.ImageByteFormat.png);
    if (byteData == null) {
      throw StateError('Marker-Icon konnte nicht erstellt werden.');
    }

    return byteData.buffer.asUint8List();
  }

  Widget _buildSosBanner(MapViewModel vm) {
    final alarms = vm.activeSosLocations;
    if (alarms.isEmpty) return const SizedBox.shrink();

    final primary = alarms.first;
    final additional = alarms.length - 1;
    final age = primary.ageFrom();

    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: () => _focusOnSos(primary),
        child: TweenAnimationBuilder<double>(
          tween: Tween(begin: 0.6, end: 1.0),
          duration: const Duration(milliseconds: 600),
          curve: Curves.easeInOut,
          builder: (context, value, child) {
            return Container(
              padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
              decoration: BoxDecoration(
                color: Color.lerp(
                  const Color(0xFFB91C1C),
                  const Color(0xFFEF4444),
                  value,
                ),
                borderRadius: BorderRadius.circular(20),
                boxShadow: const [
                  BoxShadow(
                    color: Color(0x55EF4444),
                    blurRadius: 16,
                    offset: Offset(0, 6),
                  ),
                ],
              ),
              child: child,
            );
          },
          child: Row(
            children: [
              const Icon(
                Icons.priority_high_rounded,
                color: Colors.white,
                size: 28,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      additional > 0
                          ? 'SOS – ${primary.victimDisplayName} (+$additional weitere)'
                          : 'SOS – ${primary.victimDisplayName}',
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w700,
                        fontSize: 15,
                      ),
                      overflow: TextOverflow.ellipsis,
                      maxLines: 1,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Letztes Update vor ${_formatAge(age)}',
                      style: const TextStyle(
                        color: Color(0xFFFEE2E2),
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(
                Icons.my_location_rounded,
                color: Colors.white,
                size: 20,
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _focusOnSos(ActiveSosLocation sos) async {
    final map = _mapboxMap;
    if (map == null) return;
    await map.flyTo(
      CameraOptions(
        center: Point(coordinates: Position(sos.lng, sos.lat)),
        zoom: 16,
      ),
      MapAnimationOptions(duration: 700),
    );
  }

  String _formatAge(Duration age) {
    if (age.isNegative || age.inSeconds < 5) return 'jetzt';
    if (age.inSeconds < 60) return '${age.inSeconds} s';
    if (age.inMinutes < 60) return '${age.inMinutes} min';
    final hours = age.inHours;
    return '$hours h';
  }

  Widget _buildTopSearch(MapViewModel vm) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 12),
        DecoratedBox(
          decoration: BoxDecoration(
            color: _kMapCardBackground,
            borderRadius: BorderRadius.circular(34),
            boxShadow: const [
              BoxShadow(
                color: Color(0x22000000),
                blurRadius: 14,
                offset: Offset(0, 4),
              ),
            ],
          ),
          child: TextField(
            controller: _searchController,
            focusNode: _searchFocusNode,
            onChanged: vm.setSearchQuery,
            decoration: InputDecoration(
              hintText: 'Suche nach einem Ort...',
              prefixIcon: const Icon(
                Icons.search,
                color: _kMapPrimary,
                size: 24,
              ),
              suffixIcon: vm.searchQuery.trim().isNotEmpty
                  ? IconButton(
                      onPressed: () {
                        vm.setSearchQuery('');
                        _searchFocusNode.requestFocus();
                      },
                      icon: const Icon(Icons.close),
                    )
                  : null,
              border: InputBorder.none,
              contentPadding: const EdgeInsets.symmetric(vertical: 10),
            ),
            style: const TextStyle(fontSize: 16),
          ),
        ),
        if (vm.isSearchingPlaces || vm.searchSuggestions.isNotEmpty)
          Container(
            margin: const EdgeInsets.only(top: 8),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(16),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x22000000),
                  blurRadius: 10,
                  offset: Offset(0, 3),
                ),
              ],
            ),
            child: vm.isSearchingPlaces
                ? const Padding(
                    padding: EdgeInsets.all(12),
                    child: Center(
                      child: SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                    ),
                  )
                : ListView.separated(
                    shrinkWrap: true,
                    itemCount: vm.searchSuggestions.length,
                    separatorBuilder: (_, _) => const Divider(height: 1),
                    itemBuilder: (context, index) {
                      final suggestion = vm.searchSuggestions[index];
                      return ListTile(
                        dense: true,
                        leading: const Icon(Icons.location_on_outlined),
                        title: Text(suggestion.name),
                        subtitle: Text(
                          suggestion.fullName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        onTap: () async {
                          _searchFocusNode.unfocus();
                          await vm.selectSearchSuggestion(suggestion);
                          if (!mounted) return;
                          _flyTo(vm.mapCenter, vm.zoom);
                          _syncAnnotations(vm);
                        },
                      );
                    },
                  ),
          ),
      ],
    );
  }

  Widget _buildMapControls(MapViewModel vm) {
    return Column(
      children: [
        _CircleControlButton(icon: Icons.add, onPressed: () => _adjustZoom(1)),
        const SizedBox(height: 8),
        _CircleControlButton(
          icon: Icons.remove,
          onPressed: () => _adjustZoom(-1),
        ),
        const SizedBox(height: 8),
        _CircleControlButton(
          icon: Icons.my_location,
          onPressed: () async {
            final target = await vm.recenterToUser();
            if (!mounted || target == null) return;
            _flyTo(target, vm.zoom);
          },
        ),
        const SizedBox(height: 8),
        _SquareControlButton(
          icon: Icons.add_comment_outlined,
          onPressed: () => _openReportSheet(),
        ),
      ],
    );
  }

  Widget _buildActiveLayerCard(MapViewModel vm) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        boxShadow: const [
          BoxShadow(
            color: Color(0x1F000000),
            blurRadius: 16,
            offset: Offset(0, 4),
          ),
        ],
      ),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      child: Row(
        children: [
          Expanded(
            child: InkWell(
              borderRadius: BorderRadius.circular(20),
              onTap: _openLayerSheet,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
                child: Row(
                  children: [
                    Container(
                      width: 56,
                      height: 56,
                      decoration: const BoxDecoration(
                        shape: BoxShape.circle,
                        color: _kMapPrimarySoft,
                      ),
                      child: const Icon(
                        Icons.layers,
                        color: _kMapPrimary,
                        size: 28,
                      ),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Aktuelle Ansicht: ${vm.activeViewTitle}',
                            style: const TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.w700,
                              color: Color(0xFF172338),
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            vm.activeViewSubtitle,
                            style: const TextStyle(
                              fontSize: 15,
                              color: Color(0xFF64748B),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const Icon(
                      Icons.chevron_right,
                      color: Color(0xFFB4BCC8),
                      size: 28,
                    ),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(width: 8),
          IconButton(
            tooltip: 'Daten aktualisieren',
            onPressed: vm.isLoadingMapData ? null : _refreshData,
            icon: vm.isLoadingMapData
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.refresh),
            color: _kMapPrimary,
          ),
        ],
      ),
    );
  }

  Future<void> _refreshData() async {
    final map = _mapboxMap;
    if (map == null) return;

    final camera = await map.getCameraState();
    final center = camera.center.coordinates;

    MapViewportBounds? viewportBounds;
    try {
      final bounds = await map.coordinateBoundsForCamera(
        CameraOptions(
          center: camera.center,
          padding: camera.padding,
          zoom: camera.zoom,
          bearing: camera.bearing,
          pitch: camera.pitch,
        ),
      );
      viewportBounds = MapViewportBounds(
        north: bounds.northeast.coordinates.lat.toDouble(),
        south: bounds.southwest.coordinates.lat.toDouble(),
        east: bounds.northeast.coordinates.lng.toDouble(),
        west: bounds.southwest.coordinates.lng.toDouble(),
      );
    } catch (_) {}

    if (!mounted) return;
    final vm = context.read<MapViewModel>();
    vm.onCameraMoved(
      LatLng(center.lat.toDouble(), center.lng.toDouble()),
      camera.zoom,
      viewportBounds: viewportBounds,
    );
    vm.loadMapData(force: true);
  }

  Future<void> _openLayerSheet() async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _LayerSelectionSheet(onRefresh: _refreshData),
    );
  }

  Future<void> _openReportSheet() async {
    final vm = context.read<MapViewModel>();
    final result = await showModalBottomSheet<_ReportSheetResult>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _ReportSheet(
        initialCategory: vm.selectedReportCategoryKey,
        initialUseCurrentLocation: vm.useCurrentLocationForReport,
      ),
    );
    if (!mounted) return;

    if (result == _ReportSheetResult.needsPin) {
      _awaitingReportPin = true;
      return;
    }

    _awaitingReportPin = false;
    vm.clearReportState();
    unawaited(_syncAnnotations(vm));
  }

  void _syncSearchField(MapViewModel vm) {
    if (_searchController.text == vm.searchQuery) return;
    _searchController.value = TextEditingValue(
      text: vm.searchQuery,
      selection: TextSelection.collapsed(offset: vm.searchQuery.length),
    );
  }

  void _showFeedbackMessages(MapViewModel vm) {
    if (vm.errorMessage != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted || vm.errorMessage == null) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(vm.errorMessage!),
            backgroundColor: const Color(0xFFB42318),
          ),
        );
        vm.clearError();
      });
      return;
    }

    if (vm.successMessage != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted || vm.successMessage == null) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(vm.successMessage!),
            backgroundColor: _kMapPrimary,
          ),
        );
        vm.clearSuccess();
      });
    }
  }

  void _adjustZoom(double delta) {
    final map = _mapboxMap;
    if (map == null) return;

    map.getCameraState().then((camera) {
      final targetZoom = (camera.zoom + delta).clamp(3.0, 19.0).toDouble();
      map.flyTo(
        CameraOptions(center: camera.center, zoom: targetZoom),
        MapAnimationOptions(duration: 300),
      );
    });
  }

  void _flyTo(LatLng center, double zoom) {
    final map = _mapboxMap;
    if (map == null) return;

    map.flyTo(
      CameraOptions(
        center: Point(coordinates: Position(center.longitude, center.latitude)),
        zoom: zoom,
      ),
      MapAnimationOptions(duration: 500),
    );
  }
}

class _CircleControlButton extends StatelessWidget {
  const _CircleControlButton({required this.icon, required this.onPressed});

  final IconData icon;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      elevation: 4,
      shape: const CircleBorder(),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onPressed,
        child: SizedBox(
          width: 48,
          height: 48,
          child: Icon(icon, size: 22, color: _kMapPrimary),
        ),
      ),
    );
  }
}

class _SquareControlButton extends StatelessWidget {
  const _SquareControlButton({required this.icon, required this.onPressed});

  final IconData icon;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xFFD4E7EA),
      borderRadius: BorderRadius.circular(18),
      elevation: 4,
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: onPressed,
        child: SizedBox(
          width: 48,
          height: 48,
          child: Icon(icon, size: 22, color: _kMapPrimary),
        ),
      ),
    );
  }
}

class _LayerSelectionSheet extends StatelessWidget {
  const _LayerSelectionSheet({required this.onRefresh});

  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    final vm = context.watch<MapViewModel>();
    final totals = vm.layerTotals;

    return Container(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 18,
        bottom: MediaQuery.of(context).viewInsets.bottom + 22,
      ),
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Layer ausblenden / einblenden',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 14),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: vm.publicDataLayers
                .map((layer) {
                  final style = _layerVisualStyle(layer.key);
                  return FilterChip(
                    label: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(style.icon, size: 18, color: style.color),
                        const SizedBox(width: 6),
                        Text('${layer.label} (${totals[layer.key] ?? 0})'),
                      ],
                    ),
                    selected: layer.isSelected,
                    selectedColor: _kMapPrimarySoft,
                    checkmarkColor: _kMapPrimary,
                    side: BorderSide(
                      color: layer.isSelected
                          ? _kMapPrimary
                          : const Color(0xFFE2E8F0),
                    ),
                    onSelected: (_) => vm.toggleLayer(layer.key),
                  );
                })
                .toList(growable: false),
          ),
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              onPressed: vm.isLoadingMapData ? null : onRefresh,
              icon: const Icon(Icons.refresh),
              label: Text(
                vm.isLoadingMapData
                    ? 'Aktualisieren...'
                    : 'Daten für ausgewählten Bereich neu laden',
              ),
              style: ElevatedButton.styleFrom(
                backgroundColor: _kMapPrimary,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

enum _ReportSheetResult { needsPin, submitted }

class _ReportSheet extends StatefulWidget {
  const _ReportSheet({
    required this.initialCategory,
    required this.initialUseCurrentLocation,
  });

  final String? initialCategory;
  final bool initialUseCurrentLocation;

  @override
  State<_ReportSheet> createState() => _ReportSheetState();
}

class _ReportSheetState extends State<_ReportSheet> {
  late final TextEditingController _descriptionController;
  late bool _useCurrentLocation;
  String? _selectedCategory;

  @override
  void initState() {
    super.initState();
    _descriptionController = TextEditingController();
    _useCurrentLocation = widget.initialUseCurrentLocation;
    _selectedCategory = widget.initialCategory;
  }

  @override
  void dispose() {
    _descriptionController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final vm = context.watch<MapViewModel>();

    _selectedCategory ??= vm.reportCategories.isNotEmpty
        ? vm.reportCategories.first.key
        : null;

    return Container(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 18,
        bottom: MediaQuery.of(context).viewInsets.bottom + 20,
      ),
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Meldung erstellen',
            style: TextStyle(fontSize: 21, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 6),
          const Text(
            'Teile deine Erfahrung mit anderen',
            style: TextStyle(color: Color(0xFF64748B)),
          ),
          const SizedBox(height: 14),
          const Text(
            'Positionsquelle',
            style: TextStyle(fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            children: [
              ChoiceChip(
                label: const Text('Aktueller Standort'),
                selected: _useCurrentLocation,
                onSelected: (_) {
                  setState(() => _useCurrentLocation = true);
                  vm.setUseCurrentLocationForReport(true);
                },
              ),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  ChoiceChip(
                    label: const Text('Karten-Pin'),
                    selected: !_useCurrentLocation,
                    onSelected: (_) {
                      setState(() => _useCurrentLocation = false);
                      vm.setUseCurrentLocationForReport(false);
                      if (vm.reportTapLocation == null) {
                        Navigator.of(context).pop(_ReportSheetResult.needsPin);
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text(
                              'Tippe auf die Karte, um einen Meldepunkt zu setzen.',
                            ),
                            backgroundColor: _kMapPrimary,
                            duration: Duration(seconds: 3),
                          ),
                        );
                      }
                    },
                  ),
                  const SizedBox(width: 4),
                  IconButton(
                    tooltip: 'Position aendern',
                    icon: const Icon(Icons.edit_location_alt_outlined),
                    color: _kMapPrimary,
                    onPressed: () {
                      setState(() => _useCurrentLocation = false);
                      vm.setUseCurrentLocationForReport(false);
                      vm.clearReportTapLocation();
                      Navigator.of(context).pop(_ReportSheetResult.needsPin);
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text(
                            'Tippe auf die Karte, um einen neuen Meldepunkt zu setzen.',
                          ),
                          backgroundColor: _kMapPrimary,
                          duration: Duration(seconds: 3),
                        ),
                      );
                    },
                  ),
                ],
              ),
            ],
          ),
          if (!_useCurrentLocation)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                vm.reportTapLocation == null
                    ? 'Tippe zuerst auf die Karte, um einen Meldepunkt zu setzen.'
                    : 'Ausgewaehlte Position: '
                          '${vm.reportTapLocation!.latitude.toStringAsFixed(5)}, '
                          '${vm.reportTapLocation!.longitude.toStringAsFixed(5)}',
                style: const TextStyle(color: Color(0xFF475569), fontSize: 13),
              ),
            ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: _selectedCategory,
            decoration: const InputDecoration(
              labelText: 'Kategorie',
              border: OutlineInputBorder(),
            ),
            items: vm.reportCategories
                .map(
                  (category) => DropdownMenuItem(
                    value: category.key,
                    child: Text(category.label),
                  ),
                )
                .toList(growable: false),
            onChanged: (value) {
              setState(() => _selectedCategory = value);
              if (value != null) vm.setSelectedReportCategory(value);
            },
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _descriptionController,
            maxLength: 500,
            minLines: 2,
            maxLines: 4,
            decoration: const InputDecoration(
              labelText: 'Beschreibung (optional)',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 8),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              onPressed: vm.isSubmittingReport || _selectedCategory == null
                  ? null
                  : () async {
                      final ok = await vm.submitReport(
                        categoryKey: _selectedCategory,
                        comment: _descriptionController.text,
                      );
                      if (!context.mounted) return;
                      if (ok) {
                        Navigator.of(context).pop(_ReportSheetResult.submitted);
                      }
                    },
              icon: vm.isSubmittingReport
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(Icons.send),
              label: Text(
                vm.isSubmittingReport ? 'Sende...' : 'Meldung senden',
              ),
              style: ElevatedButton.styleFrom(
                backgroundColor: _kMapPrimary,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 18, color: const Color(0xFF64748B)),
        const SizedBox(width: 8),
        Text(
          '$label: ',
          style: const TextStyle(color: Color(0xFF64748B), fontSize: 14),
        ),
        Expanded(
          child: Text(
            value,
            style: const TextStyle(
              color: Color(0xFF0F172A),
              fontSize: 14,
              fontWeight: FontWeight.w600,
            ),
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}
