import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:safewalk/services/headphone_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('HeadphoneService init is a no-op on non-mobile', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.linux;
    final service = HeadphoneService();

    await service.init();

    expect(service.isConnected, isFalse);
    service.dispose();
    debugDefaultTargetPlatformOverride = null;
  });
  test('HeadphoneService init on mobile keeps defaults when plugin fails', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    final service = HeadphoneService();

    await service.init();

    expect(service.isConnected, isFalse);
    service.dispose();
    debugDefaultTargetPlatformOverride = null;
  });
}
