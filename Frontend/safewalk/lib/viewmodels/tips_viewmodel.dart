import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:safewalk/models/tip.dart';
import 'package:safewalk/services/api_service.dart';
import 'package:safewalk/services/headphone_service.dart';

class TipsViewModel extends ChangeNotifier {
  TipsViewModel({
    required ApiService apiService,
    required HeadphoneService headphoneService,
  })  : _apiService = apiService,
        _headphoneService = headphoneService {
    _headphoneSubscription = _headphoneService.onChanged.listen((connected) {
      _headphonesConnected = connected;
      notifyListeners();
    });
    _headphonesConnected = _headphoneService.isConnected;
  }

  final ApiService _apiService;
  final HeadphoneService _headphoneService;
  StreamSubscription<bool>? _headphoneSubscription;

  bool _headphonesConnected = false;
  bool get headphonesConnected => _headphonesConnected;

  static const Tip headphoneTip = Tip(
    tipId: 'headphone-awareness',
    icon: 'visibility',
    title: 'Kopfhörer erkannt',
    description:
        'Du trägst gerade Kopfhörer. Achte besonders auf deine Umgebung – '
        'du könntest wichtige Geräusche wie Verkehr oder Warnrufe überhören. '
        'Erwäge, die Lautstärke zu reduzieren oder einen Transparenzmodus zu nutzen.',
    category: 'Aufmerksamkeit',
  );

  @override
  void dispose() {
    _headphoneSubscription?.cancel();
    super.dispose();
  }

  bool _isLoading = false;
  bool get isLoading => _isLoading;

  String? _errorMessage;
  String? get errorMessage => _errorMessage;

  Tip? _tipOfTheDay;
  Tip? get tipOfTheDay => _tipOfTheDay;

  List<Tip> _tips = const [];

  String _searchQuery = '';
  String get searchQuery => _searchQuery;

  String _selectedCategory = _allCategory;
  String get selectedCategory => _selectedCategory;

  static const String _allCategory = 'Alle';

  List<String> get categories {
    final dynamicCategories = <String>{
      ..._tips.map((tip) => tip.category.trim()).where((c) => c.isNotEmpty),
      if (_tipOfTheDay != null) _tipOfTheDay!.category.trim(),
    };

    final sorted = dynamicCategories.toList()..sort((a, b) => a.compareTo(b));
    return <String>[_allCategory, ...sorted];
  }

  bool get showTipOfDayHighlighted => _selectedCategory == _allCategory;

  List<Tip> get filteredTips {
    final pool = _selectedCategory == _allCategory
        ? _tips
        : [if (_tipOfTheDay != null) _tipOfTheDay!, ..._tips]
            .where((tip) => tip.category == _selectedCategory)
            .toList();

    return pool.where((tip) => tip.matchesSearch(_searchQuery)).toList();
  }

  Future<void> loadTips() async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      final result = await _apiService.getTips();
      if (!result.isSuccess || result.data is! Map<String, dynamic>) {
        _errorMessage = (result.message?.isNotEmpty ?? false)
            ? result.message
            : 'Tipps konnten nicht geladen werden.';
        _tips = const [];
        _tipOfTheDay = null;
        _isLoading = false;
        notifyListeners();
        return;
      }

      final payload = result.data as Map<String, dynamic>;
      final data = payload['data'];
      final dataMap = data is Map<String, dynamic> ? data : <String, dynamic>{};

      final tipOfTheDayMap = dataMap['tipOfTheDay'];
      _tipOfTheDay = tipOfTheDayMap is Map<String, dynamic>
          ? Tip.fromJson(tipOfTheDayMap)
          : null;

      final tipsJson = dataMap['tips'];
      if (tipsJson is List) {
        _tips = tipsJson
            .whereType<Map<String, dynamic>>()
            .map(Tip.fromJson)
            .toList();
      } else {
        _tips = const [];
      }

      if (!categories.contains(_selectedCategory)) {
        _selectedCategory = _allCategory;
      }
    } catch (_) {
      _errorMessage = 'Tipps konnten nicht geladen werden.';
      _tips = const [];
      _tipOfTheDay = null;
    }

    _isLoading = false;
    notifyListeners();
  }

  void setSearchQuery(String value) {
    _searchQuery = value.trim();
    notifyListeners();
  }

  void setSelectedCategory(String category) {
    if (!categories.contains(category)) return;
    _selectedCategory = category;
    notifyListeners();
  }

  void clearError() {
    _errorMessage = null;
    notifyListeners();
  }
}
