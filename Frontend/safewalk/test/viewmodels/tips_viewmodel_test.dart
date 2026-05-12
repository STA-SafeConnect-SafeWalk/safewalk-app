import 'package:flutter_test/flutter_test.dart';
import 'package:safewalk/core/network/api_result.dart';
import 'package:safewalk/models/tip.dart';
import 'package:safewalk/services/api_service.dart';
import 'package:safewalk/services/headphone_service.dart';
import 'package:safewalk/viewmodels/tips_viewmodel.dart';

class FakeApiService extends ApiService {
  ApiResult tipsResult = ApiResult.success(statusCode: 200, data: {
    'data': {
      'tipOfTheDay': {
        'tipId': 't1',
        'title': 'Daily tip',
        'description': 'Stay safe',
        'category': 'Allgemein',
      },
      'tips': [
        {
          'tipId': 't2',
          'title': 'Another tip',
          'description': 'More info',
          'category': 'Aufmerksamkeit',
        },
      ],
    },
  });

  @override
  Future<ApiResult> getTips() async => tipsResult;
}

class FakeHeadphoneService extends HeadphoneService {
  @override
  bool get isConnected => false;
}

void main() {
  test('loadTips populates tips and categories', () async {
    final api = FakeApiService();
    final vm = TipsViewModel(
      apiService: api,
      headphoneService: FakeHeadphoneService(),
    );

    await vm.loadTips();

    expect(vm.tipOfTheDay?.tipId, 't1');
    expect(vm.filteredTips.length, 1);
    expect(vm.categories, contains('Aufmerksamkeit'));
  });

  test('setSelectedCategory ignores invalid categories', () async {
    final api = FakeApiService();
    final vm = TipsViewModel(
      apiService: api,
      headphoneService: FakeHeadphoneService(),
    );

    await vm.loadTips();
    vm.setSelectedCategory('Unknown');

    expect(vm.selectedCategory, 'Alle');
  });

  test('filteredTips respects search query', () async {
    final api = FakeApiService();
    final vm = TipsViewModel(
      apiService: api,
      headphoneService: FakeHeadphoneService(),
    );

    await vm.loadTips();
    vm.setSearchQuery('another');

    expect(vm.filteredTips.single.tipId, 't2');
  });

  test('headphone tip matches required shape', () {
    const tip = TipsViewModel.headphoneTip;

    expect(tip, isA<Tip>());
    expect(tip.tipId, 'headphone-awareness');
    expect(tip.category, 'Aufmerksamkeit');
  });
}

