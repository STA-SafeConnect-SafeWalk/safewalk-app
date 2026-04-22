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
  static const double _timerEndDistanceThresholdMeters = 10;
  static const double _timerEndAccuracyThresholdMeters = 10;

  Timer? _countdownTimer;
  Timer? _sosUpdateTimer;
  bool _initialized = false;
  bool _isSosUpdateInFlight = false;
  bool _isCreatingSos = false;
  bool _isCancelingCountdownSos = false;
  bool _isFinalizingCountdown = false;
  bool _countdownFinished = false;
  bool _cancelRequestedDuringCountdown = false;

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
  _SosLocationSnapshot? _initialSosLocation;

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
    if (_screenState != SosScreenState.home || _isSubmittingSos) return;

    _stopSosLocationUpdates();
    _sosError = null;
    _sosData = null;
    _sosId = null;
    _initialSosLocation = null;
    _cancelRequestedDuringCountdown = false;
    _countdownFinished = false;
    _screenState = SosScreenState.countdown;
    _remaining = _countdownTotal;
    _startTimer();
    notifyListeners();

    unawaited(_createSosImmediately());
  }

  Future<void> cancelCountdownAndReturnHome() async {
    if (_screenState != SosScreenState.countdown) return;

    _countdownTimer?.cancel();
    _remaining = _countdownTotal;
    _countdownFinished = true;
    _cancelRequestedDuringCountdown = true;
    _sosError = null;

    final currentSosId = _sosId;
    if (currentSosId != null && currentSosId.isNotEmpty) {
      _isSubmittingSos = true;
      notifyListeners();
      await _cancelCountdownSosIfPossible();
      return;
    }

    if (_isCreatingSos || _isCancelingCountdownSos) {
      _isSubmittingSos = true;
      notifyListeners();
      return;
    }

    _resetToHome();
  }

  void skipCountdownTimer() {
    if (_screenState != SosScreenState.countdown) return;

    _countdownTimer?.cancel();
    _remaining = Duration.zero;
    _countdownFinished = true;
    _sosError = null;

    if (_cancelRequestedDuringCountdown) {
      notifyListeners();
      return;
    }

    _immediatePropagate();
  }

  void _immediatePropagate() {
    if (_cancelRequestedDuringCountdown) return;

    _screenState = SosScreenState.active;
    _startSosLocationUpdates();
    notifyListeners();

    final currentSosId = _sosId;
    if (currentSosId != null && currentSosId.isNotEmpty) {
      unawaited(_apiService.propagateSos(currentSosId));
    }
  }

  Future<void> _createSosImmediately() async {
    if (_isCreatingSos) return;

    _isCreatingSos = true;

    final initialLocation = await _loadLiveLocationSnapshot();
    _initialSosLocation = initialLocation;

    final result = await _apiService.triggerSos(
      lat: initialLocation?.lat,
      lng: initialLocation?.lng,
      accuracy: initialLocation?.accuracy,
    );

    _isCreatingSos = false;

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
        _isSubmittingSos = false;
        if (_cancelRequestedDuringCountdown) {
          _resetToHome();
        } else {
          _screenState = SosScreenState.home;
          _sosError =
              'SOS wurde erstellt, aber keine SOS-ID wurde zurückgegeben. Bitte erneut versuchen.';
          notifyListeners();
        }
        return;
      }

      if (_cancelRequestedDuringCountdown) {
        await _cancelCountdownSosIfPossible();
        return;
      }

      _isSubmittingSos = false;
      notifyListeners();

      if (_countdownFinished) {
        await _finalizeCountdownSosActivation();
      }
      return;
    }

    _isSubmittingSos = false;
    if (_cancelRequestedDuringCountdown) {
      _resetToHome();
      return;
    }

    _screenState = SosScreenState.home;
    _sosError =
        'SOS konnte nicht ausgelöst werden (${result.statusCode}): ${result.message ?? 'Unbekannter Fehler'}';
    notifyListeners();
  }

  Future<void> _cancelCountdownSosIfPossible() async {
    final currentSosId = _sosId;
    if (currentSosId == null || currentSosId.isEmpty) {
      _isSubmittingSos = false;
      _resetToHome();
      return;
    }

    if (_isCancelingCountdownSos) return;
    _isCancelingCountdownSos = true;

    try {
      final result = await _apiService.cancelSos(currentSosId);
      _isSubmittingSos = false;

      if (result.isSuccess || _isSosAlreadyClosedStatus(result.statusCode)) {
        _resetToHome();
        return;
      }

      _cancelRequestedDuringCountdown = false;
      _sosError =
          'SOS konnte nicht beendet werden (${result.statusCode}): ${result.message ?? 'Unbekannter Fehler'}';
      _screenState = SosScreenState.active;
      _startSosLocationUpdates();
      notifyListeners();
    } finally {
      _isCancelingCountdownSos = false;
    }
  }

  Future<void> _finalizeCountdownSosActivation() async {
    if (_isFinalizingCountdown) return;
    if (_screenState != SosScreenState.countdown ||
        _cancelRequestedDuringCountdown) {
      return;
    }

    final currentSosId = _sosId;
    if (currentSosId == null || currentSosId.isEmpty) {
      _isSubmittingSos = false;
      _screenState = SosScreenState.home;
      _sosError = 'SOS konnte nicht aktiviert werden: Keine SOS-ID verfügbar.';
      notifyListeners();
      return;
    }

    _isFinalizingCountdown = true;
    _isSubmittingSos = true;
    notifyListeners();

    try {
      final latestLocation = await _loadLiveLocationSnapshot();
      final shouldSendUpdate = _shouldSendTimerEndLocationUpdate(
        initial: _initialSosLocation,
        latest: latestLocation,
      );

      if (shouldSendUpdate && latestLocation != null) {
        final result = await _apiService.updateSosLocation(
          sosId: currentSosId,
          lat: latestLocation.lat,
          lng: latestLocation.lng,
          accuracy: latestLocation.accuracy,
        );

        if (!result.isSuccess) {
          debugPrint(
            '[SOS] Timer-end location update failed '
            '(${result.statusCode}): ${result.message ?? 'Unknown error'}',
          );
        } else {
          _initialSosLocation = latestLocation;
        }
      }

      if (_cancelRequestedDuringCountdown) {
        return;
      }

      _screenState = SosScreenState.active;
      _startSosLocationUpdates();
    } catch (e) {
      debugPrint('[SOS] Timer-end location update error: $e');
    } finally {
      _isFinalizingCountdown = false;
      _isSubmittingSos = false;
      notifyListeners();
    }
  }

  Future<_SosLocationSnapshot?> _loadLiveLocationSnapshot() async {
    final hasLiveLocation = await refreshLocation(allowFallback: false);
    if (!hasLiveLocation || _lat == null || _lng == null || _accuracy == null) {
      return null;
    }

    return _SosLocationSnapshot(lat: _lat!, lng: _lng!, accuracy: _accuracy!);
  }

  bool _shouldSendTimerEndLocationUpdate({
    required _SosLocationSnapshot? initial,
    required _SosLocationSnapshot? latest,
  }) {
    if (latest == null) return false;
    if (initial == null) return true;

    final distance = Geolocator.distanceBetween(
      initial.lat,
      initial.lng,
      latest.lat,
      latest.lng,
    );
    final accuracyDelta = (latest.accuracy - initial.accuracy).abs();

    return distance >= _timerEndDistanceThresholdMeters ||
        accuracyDelta >= _timerEndAccuracyThresholdMeters;
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

    if (result.isSuccess || _isSosAlreadyClosedStatus(result.statusCode)) {
      _resetToHome();
    } else {
      _sosError =
          'SOS konnte nicht beendet werden (${result.statusCode}): ${result.message ?? 'Unbekannter Fehler'}';
      notifyListeners();
    }
  }

  bool _isSosAlreadyClosedStatus(int? statusCode) {
    return statusCode == 410 || statusCode == 404;
  }

  void _resetToHome() {
    _countdownTimer?.cancel();
    _stopSosLocationUpdates();
    _screenState = SosScreenState.home;
    _remaining = _countdownTotal;
    _isSubmittingSos = false;
    _isCreatingSos = false;
    _isCancelingCountdownSos = false;
    _isFinalizingCountdown = false;
    _countdownFinished = false;
    _cancelRequestedDuringCountdown = false;
    _sosId = null;
    _sosData = null;
    _sosError = null;
    _initialSosLocation = null;
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
        _countdownFinished = true;
        notifyListeners();
        unawaited(_onCountdownTimerFinished());
        return;
      }

      _remaining = newRemaining;
      notifyListeners();
    });
  }

  Future<void> _onCountdownTimerFinished() async {
    if (_screenState != SosScreenState.countdown ||
        _cancelRequestedDuringCountdown) {
      return;
    }

    if (_isCreatingSos || _isCancelingCountdownSos) {
      return;
    }

    await _finalizeCountdownSosActivation();
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

class _SosLocationSnapshot {
  const _SosLocationSnapshot({
    required this.lat,
    required this.lng,
    required this.accuracy,
  });

  final double lat;
  final double lng;
  final double accuracy;
}
