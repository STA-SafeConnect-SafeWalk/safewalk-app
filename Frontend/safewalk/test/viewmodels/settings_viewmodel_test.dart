import 'package:flutter_test/flutter_test.dart';
import 'package:safewalk/core/network/api_result.dart';
import 'package:safewalk/services/api_service.dart';
import 'package:safewalk/viewmodels/settings_viewmodel.dart';

class FakeApiService extends ApiService {
  ApiResult getMeResult = ApiResult.success(statusCode: 200, data: {
    'displayName': 'Jane',
    'email': 'jane@example.com',
  });
  ApiResult updateDisplayNameResult = ApiResult.success(statusCode: 200);
  ApiResult deleteAccountResult = ApiResult.success(statusCode: 204);

  @override
  Future<ApiResult> getMe() async => getMeResult;

  @override
  Future<ApiResult> updateDisplayName(String displayName) async {
    return updateDisplayNameResult;
  }

  @override
  Future<ApiResult> deleteAccount() async => deleteAccountResult;
}

void main() {
  test('loadProfile populates display name and email', () async {
    final api = FakeApiService();
    final vm = SettingsViewModel(apiService: api);

    await vm.loadProfile();

    expect(vm.displayName, 'Jane');
    expect(vm.email, 'jane@example.com');
  });

  test('updateDisplayName validates empty input', () async {
    final api = FakeApiService();
    final vm = SettingsViewModel(apiService: api);

    await vm.updateDisplayName('');

    expect(vm.errorMessage, 'Anzeigename darf nicht leer sein.');
  });

  test('updateDisplayName updates state on success', () async {
    final api = FakeApiService();
    final vm = SettingsViewModel(apiService: api);

    await vm.updateDisplayName('New Name');

    expect(vm.displayName, 'New Name');
    expect(vm.successMessage, 'Anzeigename erfolgreich aktualisiert.');
  });

  test('deleteAccount sets isAccountDeleted', () async {
    final api = FakeApiService();
    final vm = SettingsViewModel(apiService: api);

    await vm.deleteAccount();

    expect(vm.isAccountDeleted, isTrue);
  });
}

