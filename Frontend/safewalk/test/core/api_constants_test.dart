import 'package:flutter_test/flutter_test.dart';
import 'package:safewalk/core/constants/api_constants.dart';

void main() {
  test('ApiConstants builds dynamic paths', () {
    expect(ApiConstants.contactById('c1'), '/contacts/c1');
    expect(ApiConstants.sosById('s1'), '/sos/s1');
    expect(ApiConstants.sosPropagate('s1'), '/sos/s1/propagate');
    expect(ApiConstants.mapReportById('r1'), '/map-data/reports/r1');
  });

  test('ApiConstants base values are non-empty', () {
    expect(ApiConstants.baseUrl, isNotEmpty);
    expect(ApiConstants.defaultTimeout.inSeconds, 30);
    expect(ApiConstants.authSignIn, '/auth/sign-in');
  });
}

