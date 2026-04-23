import 'dart:async';

import 'package:flutter/material.dart';
import 'package:mapbox_maps_flutter/mapbox_maps_flutter.dart';
import 'package:provider/provider.dart';
import 'package:safewalk/models/map_models.dart';
import 'package:safewalk/viewmodels/map_viewmodel.dart';

const _kMapBackground = Color(0xFFF5F8F8);
const _kMapPrimary = Color(0xFF00666B);
const _kMapPrimarySoft = Color(0x1A00666B);
const _kMapCardBackground = Colors.white;

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
  CircleAnnotationManager? _circleAnnotationManager;
  CircleAnnotationManager? _heatmapAnnotationManager;
  PointAnnotationManager? _pointAnnotationManager;

  List<HeatmapLayerEntry>? _lastRenderedEntries;

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
    final entries = vm.visibleLayerEntries;
    if (!_listEquals(entries, _lastRenderedEntries)) {
      _syncAnnotations(vm);
    }
  }

  bool _listEquals(List<HeatmapLayerEntry>? a, List<HeatmapLayerEntry>? b) {
    if (identical(a, b)) return true;
    if (a == null || b == null || a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i].lat != b[i].lat ||
          a[i].lng != b[i].lng ||
          a[i].layerKey != b[i].layerKey ||
          a[i].count != b[i].count) {
        return false;
      }
    }
    return true;
  }

  @override
  void dispose() {
    context.read<MapViewModel>().removeListener(_onViewModelChanged);
    _searchController.dispose();
    _searchFocusNode.dispose();
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
            Positioned(top: 8, left: 16, right: 16, child: _buildTopSearch(vm)),
            Positioned(right: 16, bottom: 250, child: _buildMapControls(vm)),
            Positioned(
              left: 16,
              right: 16,
              bottom: 88,
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
      onTapListener: _onMapTap,
      onMapIdleListener: _onMapIdle,
    );
  }

  void _onMapCreated(MapboxMap map) async {
    _mapboxMap = map;
    _heatmapAnnotationManager = await map.annotations
        .createCircleAnnotationManager();
    _circleAnnotationManager = await map.annotations
        .createCircleAnnotationManager();
    _pointAnnotationManager = await map.annotations
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

    final vm = context.read<MapViewModel>();
    _flyTo(vm.mapCenter, vm.zoom);
  }

  void _onMapTap(MapContentGestureContext gestureContext) {
    final point = gestureContext.point;
    final coords = point.coordinates;
    final vm = context.read<MapViewModel>();
    vm.setReportTapLocation(
      LatLng(coords.lat.toDouble(), coords.lng.toDouble()),
    );
    _syncAnnotations(vm);

    if (_awaitingReportPin) {
      _awaitingReportPin = false;
      _openReportSheet();
    }
  }

  void _onMapIdle(MapIdleEventData event) {
    final map = _mapboxMap;
    if (map == null) return;

    map.getCameraState().then((camera) {
      final center = camera.center.coordinates;
      final vm = context.read<MapViewModel>();
      vm.onCameraMoved(
        LatLng(center.lat.toDouble(), center.lng.toDouble()),
        camera.zoom,
        scheduleReload: true,
      );
    });
  }

  Future<void> _syncAnnotations(MapViewModel vm) async {
    final circleMgr = _circleAnnotationManager;
    final heatmapMgr = _heatmapAnnotationManager;
    final pointMgr = _pointAnnotationManager;
    if (circleMgr == null || pointMgr == null || heatmapMgr == null) return;

    await circleMgr.deleteAll();
    await pointMgr.deleteAll();
    await heatmapMgr.deleteAll();

    final entries = vm.visibleLayerEntries;
    _lastRenderedEntries = entries;

    for (final entry in entries) {
      await heatmapMgr.create(
        CircleAnnotationOptions(
          geometry: Point(
            coordinates: Position(entry.lng, entry.lat),
          ),
          circleRadius: _heatmapRadius(entry.count),
          circleColor: _heatmapColor(entry.layerKey).toARGB32(),
          circleOpacity: 0.55,
          circleStrokeColor: _heatmapColor(entry.layerKey).toARGB32(),
          circleStrokeWidth: 1,
          circleStrokeOpacity: 0.8,
        ),
      );
    }

    if (vm.reportTapLocation != null) {
      await circleMgr.create(
        CircleAnnotationOptions(
          geometry: Point(
            coordinates: Position(
              vm.reportTapLocation!.longitude,
              vm.reportTapLocation!.latitude,
            ),
          ),
          circleRadius: 12,
          circleColor: const Color(0xFFEF4444).toARGB32(),
          circleStrokeColor: Colors.white.toARGB32(),
          circleStrokeWidth: 3,
        ),
      );
    }

    if (vm.selectedSearchLocation != null) {
      await circleMgr.create(
        CircleAnnotationOptions(
          geometry: Point(
            coordinates: Position(
              vm.selectedSearchLocation!.longitude,
              vm.selectedSearchLocation!.latitude,
            ),
          ),
          circleRadius: 12,
          circleColor: const Color(0xFF8B5CF6).toARGB32(),
          circleStrokeColor: Colors.white.toARGB32(),
          circleStrokeWidth: 3,
        ),
      );
    }
  }

  double _heatmapRadius(int count) {
    if (count <= 5) return 8;
    if (count <= 20) return 12;
    if (count <= 100) return 16;
    return 20;
  }

  Color _heatmapColor(String layerKey) {
    switch (layerKey) {
      case 'STREET_LAMP':
        return const Color(0xFFFBBF24);
      case 'LIT_WAY':
        return const Color(0xFF34D399);
      case 'UNLIT_WAY':
        return const Color(0xFFEF4444);
      case 'POLICE_STATION':
        return const Color(0xFF3B82F6);
      case 'HOSPITAL':
        return const Color(0xFFF472B6);
      case 'EMERGENCY_PHONE':
        return const Color(0xFFA78BFA);
      default:
        return const Color(0xFF6B7280);
    }
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
        const SizedBox(height: 12),
        _CircleControlButton(
          icon: Icons.remove,
          onPressed: () => _adjustZoom(-1),
        ),
        const SizedBox(height: 12),
        _CircleControlButton(
          icon: Icons.my_location,
          onPressed: () async {
            final target = await vm.recenterToUser();
            if (!mounted || target == null) return;
            _flyTo(target, vm.zoom);
          },
        ),
        const SizedBox(height: 12),
        _SquareControlButton(
          icon: Icons.add_comment_outlined,
          onPressed: () => _openReportSheet(),
        ),
      ],
    );
  }

  Widget _buildActiveLayerCard(MapViewModel vm) {
    return GestureDetector(
      onTap: _openLayerSheet,
      child: Container(
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
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
        child: Row(
          children: [
            Container(
              width: 56,
              height: 56,
              decoration: const BoxDecoration(
                shape: BoxShape.circle,
                color: _kMapPrimarySoft,
              ),
              child: const Icon(Icons.layers, color: _kMapPrimary, size: 28),
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
            if (vm.isLoadingHeatmap)
              const SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            else
              const Icon(
                Icons.chevron_right,
                color: Color(0xFFB4BCC8),
                size: 28,
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _openLayerSheet() async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => const _LayerSelectionSheet(),
    );
  }

  Future<void> _openReportSheet() async {
    final vm = context.read<MapViewModel>();
    final needsPin = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _ReportSheet(
        initialCategory: vm.selectedReportCategoryKey,
        initialUseCurrentLocation: vm.useCurrentLocationForReport,
      ),
    );
    _awaitingReportPin = needsPin == true;
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
          width: 58,
          height: 58,
          child: Icon(icon, size: 34, color: _kMapPrimary),
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
          width: 74,
          height: 74,
          child: Icon(icon, size: 34, color: _kMapPrimary),
        ),
      ),
    );
  }
}

class _LayerSelectionSheet extends StatelessWidget {
  const _LayerSelectionSheet();

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
                .map(
                  (layer) => FilterChip(
                    label: Text('${layer.label} (${totals[layer.key] ?? 0})'),
                    selected: layer.isSelected,
                    selectedColor: _kMapPrimarySoft,
                    checkmarkColor: _kMapPrimary,
                    side: BorderSide(
                      color: layer.isSelected
                          ? _kMapPrimary
                          : const Color(0xFFE2E8F0),
                    ),
                    onSelected: (_) => vm.toggleLayer(layer.key),
                  ),
                )
                .toList(growable: false),
          ),
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              onPressed: vm.isLoadingHeatmap
                  ? null
                  : () => vm.loadHeatmap(force: true),
              icon: const Icon(Icons.refresh),
              label: Text(
                vm.isLoadingHeatmap ? 'Aktualisiere...' : 'Jetzt aktualisieren',
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
            'Melde einen Punkt direkt an das Backend.',
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
              ChoiceChip(
                label: const Text('Karten-Pin'),
                selected: !_useCurrentLocation,
                onSelected: (_) {
                  setState(() => _useCurrentLocation = false);
                  vm.setUseCurrentLocationForReport(false);
                  if (vm.reportTapLocation == null) {
                    Navigator.of(context).pop(true);
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
                        description: _descriptionController.text,
                      );
                      if (!mounted) return;
                      if (ok) Navigator.of(context).pop();
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
