import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:headphones_detection/headphones_detection.dart';

class HeadphoneService extends ChangeNotifier {
  HeadphoneService();

  StreamSubscription<bool>? _subscription;

  bool _connected = false;
  bool get isConnected => _connected;

  final _controller = StreamController<bool>.broadcast();
  Stream<bool> get onChanged => _controller.stream;

  void debugSetConnected(bool connected) {
    assert(() {
      if (connected != _connected) {
        _connected = connected;
        _controller.add(_connected);
        notifyListeners();
      }
      return true;
    }());
  }

  Future<void> init() async {
    // package only supported on mobile platforms
    if (kIsWeb || !_isMobile) return;

    try {
      _connected = await HeadphonesDetection.isHeadphonesConnected();
      _controller.add(_connected);
      notifyListeners();

      _subscription = HeadphonesDetection.headphonesStream.listen((connected) {
        if (connected != _connected) {
          _connected = connected;
          _controller.add(_connected);
          notifyListeners();
        }
      });
    } catch (_) {
      // Plugin unavailable on this platform (e.g. simulator without audio).
    }
  }

  bool get _isMobile =>
      defaultTargetPlatform == TargetPlatform.android ||
      defaultTargetPlatform == TargetPlatform.iOS;

  @override
  void dispose() {
    _subscription?.cancel();
    _controller.close();
    super.dispose();
  }
}
