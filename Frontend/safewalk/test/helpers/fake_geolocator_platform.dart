import 'package:geolocator/geolocator.dart';
import 'package:geolocator_platform_interface/geolocator_platform_interface.dart';

class FakeGeolocatorPlatform extends GeolocatorPlatform {
  FakeGeolocatorPlatform({
    this.serviceEnabled = true,
    this.permission = LocationPermission.always,
    Position? position,
    Position? lastKnownPosition,
  }) : _position = position,
       _lastKnownPosition = lastKnownPosition;

  bool serviceEnabled;
  LocationPermission permission;
  Position? _position;
  Position? _lastKnownPosition;

  set position(Position? value) => _position = value;
  set lastKnownPosition(Position? value) => _lastKnownPosition = value;

  @override
  Future<bool> isLocationServiceEnabled() async => serviceEnabled;

  @override
  Future<LocationPermission> checkPermission() async => permission;

  @override
  Future<LocationPermission> requestPermission() async => permission;

  @override
  Future<Position> getCurrentPosition({LocationSettings? locationSettings}) async {
    return _position ?? _fallbackPosition();
  }

  @override
  Future<Position?> getLastKnownPosition({bool forceLocationManager = false}) async {
    return _lastKnownPosition;
  }

  @override
  Stream<Position> getPositionStream({LocationSettings? locationSettings}) {
    return const Stream<Position>.empty();
  }

  Position _fallbackPosition() {
    return Position(
      latitude: 48.137154,
      longitude: 11.576124,
      timestamp: DateTime.now(),
      accuracy: 5,
      altitude: 0,
      altitudeAccuracy: 0,
      heading: 0,
      headingAccuracy: 0,
      speed: 0,
      speedAccuracy: 0,
    );
  }
}
