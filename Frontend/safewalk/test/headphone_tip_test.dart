import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:safewalk/services/api_service.dart';
import 'package:safewalk/services/headphone_service.dart';
import 'package:safewalk/viewmodels/tips_viewmodel.dart';

// A fake HeadphoneService that lets tests drive the headphone state.
class FakeHeadphoneService extends HeadphoneService {
  final _controller = StreamController<bool>.broadcast();
  bool _connected = false;

  @override
  bool get isConnected => _connected;

  @override
  Stream<bool> get onChanged => _controller.stream;

  void simulateChange(bool connected) {
    _connected = connected;
    _controller.add(connected);
  }

  @override
  Future<void> init() async {}

  @override
  void dispose() {
    _controller.close();
  }
}

void main() {
  group('TipsViewModel headphone detection', () {
    late FakeHeadphoneService fakeHeadphones;
    TipsViewModel? vm;

    setUp(() {
      fakeHeadphones = FakeHeadphoneService();
    });

    tearDown(() {
      vm?.dispose();
      vm = null;
      fakeHeadphones.dispose();
    });

    test('headphonesConnected is false by default', () {
      vm = TipsViewModel(
        apiService: ApiService(),
        headphoneService: fakeHeadphones,
      );
      expect(vm!.headphonesConnected, isFalse);
    });

    test('headphonesConnected updates when headphones connect', () async {
      vm = TipsViewModel(
        apiService: ApiService(),
        headphoneService: fakeHeadphones,
      );

      bool notified = false;
      vm!.addListener(() => notified = true);

      fakeHeadphones.simulateChange(true);
      await Future.microtask(() {});

      expect(vm!.headphonesConnected, isTrue);
      expect(notified, isTrue);
    });

    test('headphonesConnected updates when headphones disconnect', () async {
      fakeHeadphones.simulateChange(true);
      vm = TipsViewModel(
        apiService: ApiService(),
        headphoneService: fakeHeadphones,
      );

      fakeHeadphones.simulateChange(false);
      await Future.microtask(() {});

      expect(vm!.headphonesConnected, isFalse);
    });

    test('headphoneTip has expected fields', () {
      expect(TipsViewModel.headphoneTip.tipId, 'headphone-awareness');
      expect(TipsViewModel.headphoneTip.category, 'Aufmerksamkeit');
      expect(TipsViewModel.headphoneTip.title, isNotEmpty);
      expect(TipsViewModel.headphoneTip.description, isNotEmpty);
    });
  });
}
