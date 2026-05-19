import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:safewalk/services/mapbox_places_service.dart';

void main() {
  test('searchPlaces returns empty list when not configured', () async {
    final service = MapboxPlacesService();

    final results = await service.searchPlaces('Munich');

    expect(results, isEmpty);
  });

  test('searchPlaces returns empty list for short query', () async {
    final service = MapboxPlacesService(accessTokenOverride: 'token');

    final results = await service.searchPlaces('M');

    expect(results, isEmpty);
  });

  test('searchPlaces parses suggestions from API response', () async {
    final client = MockClient((request) async {
      expect(request.url.queryParameters['access_token'], 'token');
      final body = jsonEncode({
        'features': [
          {
            'text': 'Marienplatz',
            'place_name': 'Marienplatz, Munich',
            'center': [11.575, 48.137],
          },
        ],
      });
      return http.Response(body, 200);
    });

    final service = MapboxPlacesService(
      client: client,
      accessTokenOverride: 'token',
      geocodingBaseUrl: 'https://example.test',
    );

    final results = await service.searchPlaces('Marien');

    expect(results, hasLength(1));
    expect(results.first.name, 'Marienplatz');
  });

  test('searchPlaces returns empty list on non-200 response', () async {
    final client = MockClient((request) async => http.Response('fail', 500));

    final service = MapboxPlacesService(
      client: client,
      accessTokenOverride: 'token',
      geocodingBaseUrl: 'https://example.test',
    );

    final results = await service.searchPlaces('Marien');

    expect(results, isEmpty);
  });
}
