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

  test('updateDisplayName surfaces backend error', () async {
    final api = FakeApiService();
    api.updateDisplayNameResult = ApiResult.error(
      statusCode: 500,
      message: 'Error',
      data: {'error': 'Speichern fehlgeschlagen'},
    );
    final vm = SettingsViewModel(apiService: api);

    await vm.updateDisplayName('New Name');

    expect(vm.errorMessage, 'Speichern fehlgeschlagen');
  });

  test('deleteAccount sets isAccountDeleted', () async {
    final api = FakeApiService();
    final vm = SettingsViewModel(apiService: api);

    await vm.deleteAccount();

    expect(vm.isAccountDeleted, isTrue);
  });

  test('deleteAccount surfaces error on failure', () async {
    final api = FakeApiService();
    api.deleteAccountResult = ApiResult.error(
      statusCode: 500,
      message: 'Error',
      data: {'error': 'Konto konnte nicht gelöscht werden.'},
    );
    final vm = SettingsViewModel(apiService: api);

    await vm.deleteAccount();

    expect(vm.isAccountDeleted, isFalse);
    expect(vm.errorMessage, 'Konto konnte nicht gelöscht werden.');
  });

  test('loadProfile surfaces backend error', () async {
    final api = FakeApiService();
    api.getMeResult = ApiResult.error(
      statusCode: 500,
      message: 'Error',
      data: {'error': 'Profil konnte nicht geladen werden'},
    );
    final vm = SettingsViewModel(apiService: api);

    await vm.loadProfile();

    expect(vm.errorMessage, 'Profil konnte nicht geladen werden');
  });

  test('clearError and clearSuccess reset messages', () async {
    final api = FakeApiService();
    final vm = SettingsViewModel(apiService: api);

    await vm.updateDisplayName('New Name');
    expect(vm.successMessage, isNotNull);
    vm.clearSuccess();
    expect(vm.successMessage, isNull);

    api.updateDisplayNameResult = ApiResult.error(
      statusCode: 500,
      message: 'Error',
      data: {'error': 'Speichern fehlgeschlagen'},
    );
    await vm.updateDisplayName('Another');
    expect(vm.errorMessage, isNotNull);
    vm.clearError();
    expect(vm.errorMessage, isNull);
  });
}
