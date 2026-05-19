import 'package:safewalk/models/map_models.dart';
import 'package:safewalk/services/mapbox_places_service.dart';

class FakeMapboxPlacesService extends MapboxPlacesService {
  FakeMapboxPlacesService({this.results = const []});

  final List<MapPlaceSuggestion> results;

  @override
  bool get isConfigured => true;

  @override
  Future<List<MapPlaceSuggestion>> searchPlaces(
    String query, {
    double? proximityLat,
    double? proximityLng,
    int limit = 6,
  }) async {
    return results;
  }
}

