import 'package:flutter_test/flutter_test.dart';
import 'package:safewalk/models/map_models.dart';

void main() {
  test('PublicDataPoint parses numeric fields', () {
    final point = PublicDataPoint.fromJson({
      'id': 'node/1',
      'category': 'POLICE',
      'lat': '48.1',
      'lng': 11.5,
      'name': 'Station',
    });

    expect(point.id, 'node/1');
    expect(point.category, 'POLICE');
    expect(point.lat, 48.1);
    expect(point.lng, 11.5);
    expect(point.name, 'Station');
  });

  test('CommunityReportItem parses fields', () {
    final report = CommunityReportItem.fromJson({
      'reportId': 'r1',
      'type': 'UNSAFE_AREA',
      'lat': 48.2,
      'lng': 11.6,
      'comment': 'Dark area',
    });

    expect(report.reportId, 'r1');
    expect(report.type, 'UNSAFE_AREA');
    expect(report.comment, 'Dark area');
  });

  test('ContactLiveLocation parses and compares', () {
    final now = DateTime.now().toUtc();
    final json = {
      'safeWalkId': 'sw1',
      'displayName': 'Jane',
      'lat': 48.1,
      'lng': 11.6,
      'accuracy': 5,
      'updatedAt': now.toIso8601String(),
    };

    final loc = ContactLiveLocation.fromJson(json);
    expect(loc, isNotNull);
    expect(loc!.ageFrom(now), Duration.zero);

    final loc2 = ContactLiveLocation.fromJson(json);
    expect(loc, equals(loc2));
  });

  test('ActiveSosLocation parses active status', () {
    final now = DateTime.now().toUtc();
    final json = {
      'sosId': 's1',
      'victimDisplayName': 'Sam',
      'status': 'ACTIVE',
      'updatedAt': now.toIso8601String(),
      'createdAt': now.subtract(const Duration(minutes: 1)).toIso8601String(),
      'geoLocation': {'lat': 48.1, 'lng': 11.6, 'accuracy': 12},
    };

    final active = ActiveSosLocation.fromJson(json);
    expect(active, isNotNull);
    expect(active!.sosId, 's1');
  });
}

