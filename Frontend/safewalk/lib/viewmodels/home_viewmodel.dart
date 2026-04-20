import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:geocoding/geocoding.dart';
import 'package:geolocator/geolocator.dart';
import 'package:safewalk/services/api_service.dart';

enum SosScreenState { home, countdown, active }

class HomeViewModel extends ChangeNotifier {
  HomeViewModel({ApiService? apiService})
    : _apiService = apiService ?? ApiService();

  final ApiService _apiService;
  final Duration _countdownTotal = const Duration(seconds: 5);
  final Duration _sosUpdateInterval = const Duration(seconds: 30);

  Timer? _countdownTimer;
  Timer? _sosUpdateTimer;
  bool _initialized = false;
  bool _isSosUpdateInFlight = false;

  SosScreenState _screenState = SosScreenState.home;
  Duration _remaining = const Duration(seconds: 5);
  bool _isSubmittingSos = false;

  bool _isSharingLocation = true;

  bool _isLocating = false;
  bool _isGpsActive = false;
  String _locationInfo = 'Standort wird ermittelt...';
  String? _locationError;

  double? _lat;
  double? _lng;
  double? _accuracy;

  String? _sosId;
  Map<String, dynamic>? _sosData;
  String? _sosError;

  SosScreenState get screenState => _screenState;
  bool get isSubmittingSos => _isSubmittingSos;
  bool get isSharingLocation => _isSharingLocation;

  bool get isLocating => _isLocating;
  bool get isGpsActive => _isGpsActive;
  String get locationInfo => _locationInfo;
  String? get locationError => _locationError;

  Duration get remaining => _remaining;
  double get remainingSeconds => _remaining.inMilliseconds / 1000;
  double get countdownProgress {
    final elapsed = _countdownTotal - _remaining;
    return (elapsed.inMilliseconds / _countdownTotal.inMilliseconds).clamp(
      0,
      1,
    );
  }

  String? get sosId => _sosId;
  Map<String, dynamic>? get sosData => _sosData;
  String? get sosError => _sosError;

  String get bottomInfoText => _locationError ?? _locationInfo;

  Future<void> initializeIfNeeded() async {
    if (_initialized) return;
    _initialized = true;
    await refreshLocation();
  }

  Future<bool> refreshLocation({bool allowFallback = true}) async {
    _isLocating = true;
    _locationError = null;
    notifyListeners();

    try {
      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) {
        throw Exception('Standortdienste sind deaktiviert.');
      }

      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }

      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        throw Exception('Standortberechtigung wurde nicht erteilt.');
      }

      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.best,
        ),
      );

      _updatePosition(position);
      _isGpsActive = true;
      _locationError = null;
      return true;
    } catch (e) {
      debugPrint('Location error: $e');

      if (!allowFallback) {
        _clearPosition();
        _isGpsActive = false;
        _locationError =
            'Live-Standort konnte nicht ermittelt werden. Bitte Standort prüfen.';
        return false;
      }

      final fallback = await Geolocator.getLastKnownPosition();
      if (fallback != null) {
        _updatePosition(fallback);
        _isGpsActive = true;
        _locationError =
            'Live-Standort nicht verfügbar, letzte bekannte Position wird genutzt.';
        return true;
      } else {
        _clearPosition();
        _isGpsActive = false;
        _locationError = 'Standort konnte nicht ermittelt werden.';
        return false;
      }
    } finally {
      _isLocating = false;
      notifyListeners();
    }
  }

  void toggleLocationSharingCard() {
    _isSharingLocation = !_isSharingLocation;
    notifyListeners();
  }

  void startCountdown() {
    if (_isSubmittingSos) return;
    _sosError = null;
    _screenState = SosScreenState.countdown;
    _remaining = _countdownTotal;
    _startTimer();
    notifyListeners();
  }

  Future<void> cancelCountdownAndReturnHome() async {
    _countdownTimer?.cancel();
    _screenState = SosScreenState.home;
    _remaining = _countdownTotal;
    notifyListeners();
  }

  Future<void> triggerSosNow() async {
    if (_isSubmittingSos) return;

    _countdownTimer?.cancel();
    _stopSosLocationUpdates();
    _isSubmittingSos = true;
    _sosError = null;
    notifyListeners();

    final hasLiveLocation = await refreshLocation(allowFallback: false);

    if (!hasLiveLocation || _lat == null || _lng == null || _accuracy == null) {
      _isSubmittingSos = false;
      _sosError =
          'SOS konnte nicht ausgelöst werden: Kein aktueller Live-Standort verfügbar.';
      _screenState = SosScreenState.home;
      notifyListeners();
      return;
    }

    final result = await _apiService.triggerSos(
      lat: _lat!,
      lng: _lng!,
      accuracy: _accuracy!,
    );

    if (result.isSuccess && result.data is Map<String, dynamic>) {
      final map = result.data as Map<String, dynamic>;
      final data = map['data'];
      if (data is Map<String, dynamic>) {
        _sosData = data;
        _sosId = data['sosId']?.toString();
      } else {
        _sosData = map;
        _sosId = map['sosId']?.toString();
      }

      if (_sosId == null || _sosId!.isEmpty) {
        _screenState = SosScreenState.home;
        _sosError =
            'SOS wurde erstellt, aber keine SOS-ID wurde zurückgegeben. Bitte erneut versuchen.';
      } else {
        _screenState = SosScreenState.active;
        _startSosLocationUpdates();
      }
    } else {
      _screenState = SosScreenState.home;
      _sosError =
          'SOS konnte nicht ausgelöst werden (${result.statusCode}): ${result.message ?? 'Unbekannter Fehler'}';
    }

    _isSubmittingSos = false;
    notifyListeners();
  }

  Future<void> cancelActiveSos() async {
    if (_screenState != SosScreenState.active || _isSubmittingSos) return;

    if (_sosId == null || _sosId!.isEmpty) {
      _resetToHome();
      return;
    }

    _isSubmittingSos = true;
    notifyListeners();

    final result = await _apiService.cancelSos(_sosId!);
    _isSubmittingSos = false;

    if (result.isSuccess) {
      _resetToHome();
    } else {
      _sosError =
          'SOS konnte nicht beendet werden (${result.statusCode}): ${result.message ?? 'Unbekannter Fehler'}';
      notifyListeners();
    }
  }

  void _resetToHome() {
    _countdownTimer?.cancel();
    _stopSosLocationUpdates();
    _screenState = SosScreenState.home;
    _remaining = _countdownTotal;
    _sosId = null;
    _sosData = null;
    _sosError = null;
    notifyListeners();
  }

  void _startTimer() {
    _countdownTimer?.cancel();

    final startedAt = DateTime.now();
    _countdownTimer = Timer.periodic(const Duration(milliseconds: 100), (
      timer,
    ) {
      final elapsed = DateTime.now().difference(startedAt);
      final newRemaining = _countdownTotal - elapsed;

      if (newRemaining <= Duration.zero) {
        _remaining = Duration.zero;
        timer.cancel();
        notifyListeners();
        unawaited(triggerSosNow());
        return;
      }

      _remaining = newRemaining;
      notifyListeners();
    });
  }

  void _startSosLocationUpdates() {
    _sosUpdateTimer?.cancel();
    _sosUpdateTimer = Timer.periodic(_sosUpdateInterval, (_) {
      unawaited(_updateActiveSosLocation());
    });
  }

  void _stopSosLocationUpdates() {
    _sosUpdateTimer?.cancel();
    _sosUpdateTimer = null;
    _isSosUpdateInFlight = false;
  }

  Future<void> _updateActiveSosLocation() async {
    if (_isSosUpdateInFlight || _screenState != SosScreenState.active) return;

    final currentSosId = _sosId;
    if (currentSosId == null || currentSosId.isEmpty) return;

    _isSosUpdateInFlight = true;
    try {
      final hasLocation = await refreshLocation();
      if (!hasLocation || _lat == null || _lng == null || _accuracy == null) {
        debugPrint('[SOS] Skipping periodic update: no location available.');
        return;
      }

      final result = await _apiService.updateSosLocation(
        sosId: currentSosId,
        lat: _lat!,
        lng: _lng!,
        accuracy: _accuracy!,
      );

      if (!result.isSuccess) {
        debugPrint(
          '[SOS] Periodic location update failed '
          '(${result.statusCode}): ${result.message ?? 'Unknown error'}',
        );
      }
    } catch (e) {
      debugPrint('[SOS] Periodic location update error: $e');
    } finally {
      _isSosUpdateInFlight = false;
    }
  }

  void _clearPosition() {
    _lat = null;
    _lng = null;
    _accuracy = null;
  }

  void _updatePosition(Position position) {
    _lat = position.latitude;
    _lng = position.longitude;
    _accuracy = position.accuracy;
    _locationInfo =
        'Breite ${position.latitude.toStringAsFixed(5)}, '
        'Länge ${position.longitude.toStringAsFixed(5)} '
        '(±${position.accuracy.toStringAsFixed(0)} m)';

    unawaited(_tryReverseGeocode(position.latitude, position.longitude));
  }

  Future<void> _tryReverseGeocode(double lat, double lng) async {
    try {
      final placemarks = await placemarkFromCoordinates(lat, lng);
      if (placemarks.isEmpty) return;

      final place = placemarks.first;
      final parts = <String>[
        if ((place.street ?? '').isNotEmpty) place.street!,
        if ((place.locality ?? '').isNotEmpty) place.locality!,
        if ((place.country ?? '').isNotEmpty) place.country!,
      ];

      if (parts.isNotEmpty) {
        _locationInfo = parts.join(', ');
        notifyListeners();
      }
    } catch (_) {
      // Keep coordinate fallback if reverse geocoding is unavailable.
    }
  }

  @override
  void dispose() {
    _countdownTimer?.cancel();
    _stopSosLocationUpdates();
    super.dispose();
  }
}
