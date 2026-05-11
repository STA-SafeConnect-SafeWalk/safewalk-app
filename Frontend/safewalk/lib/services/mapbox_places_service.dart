import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:safewalk/models/map_models.dart';

class MapboxPlacesService {
  MapboxPlacesService({http.Client? client, String? geocodingBaseUrl})
    : _client = client ?? http.Client(),
      _geocodingBaseUrl =
          geocodingBaseUrl ??
          'https://api.mapbox.com/geocoding/v5/mapbox.places';

  static const accessToken = '';

  static const styleUri =
      'mapbox://styles/safewalkteam/cmobay96u00a801s805jsegqr';

  final http.Client _client;
  final String _geocodingBaseUrl;

  bool get isConfigured => accessToken.isNotEmpty;

  Future<List<MapPlaceSuggestion>> searchPlaces(
    String query, {
    double? proximityLat,
    double? proximityLng,
    int limit = 6,
  }) async {
    if (!isConfigured) return const [];

    final trimmedQuery = query.trim();
    if (trimmedQuery.length < 2) return const [];

    final encodedQuery = Uri.encodeComponent(trimmedQuery);
    final uri = Uri.parse('$_geocodingBaseUrl/$encodedQuery.json').replace(
      queryParameters: {
        'access_token': accessToken,
        'autocomplete': 'true',
        'limit': '$limit',
        'language': 'de',
        if (proximityLat != null && proximityLng != null)
          'proximity': '$proximityLng,$proximityLat',
      },
    );

    try {
      final response = await _client
          .get(uri)
          .timeout(const Duration(seconds: 10));
      if (response.statusCode < 200 || response.statusCode >= 300) {
        return const [];
      }

      final decoded = jsonDecode(response.body);
      if (decoded is! Map<String, dynamic>) return const [];

      final features = decoded['features'];
      if (features is! List) return const [];

      final suggestions = <MapPlaceSuggestion>[];
      for (final item in features) {
        if (item is! Map<String, dynamic>) continue;

        final center = item['center'];
        if (center is! List || center.length < 2) continue;

        final lng = _toDouble(center[0]);
        final lat = _toDouble(center[1]);
        if (lat == null || lng == null) continue;

        final name = (item['text'] ?? '').toString();
        final fullName = (item['place_name'] ?? name).toString();

        suggestions.add(
          MapPlaceSuggestion(
            name: name.isEmpty ? fullName : name,
            fullName: fullName,
            lat: lat,
            lng: lng,
          ),
        );
      }
      return suggestions;
    } catch (_) {
      return const [];
    }
  }

  double? _toDouble(dynamic value) {
    if (value is double) return value;
    if (value is num) return value.toDouble();
    if (value is String) return double.tryParse(value);
    return null;
  }
}
