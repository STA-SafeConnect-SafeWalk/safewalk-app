import 'package:flutter_test/flutter_test.dart';
import 'package:safewalk/core/network/api_result.dart';
import 'package:safewalk/models/contact.dart';
import 'package:safewalk/services/api_service.dart';
import 'package:safewalk/viewmodels/contacts_viewmodel.dart';

class FakeApiService extends ApiService {
  ApiResult getContactsResult = ApiResult.success(statusCode: 200, data: {
    'contacts': [
      {
        'contactId': 'c1',
        'outgoingContactId': 'o1',
        'safeWalkId': 'sw1',
        'displayName': 'Jane',
        'locationSharing': true,
        'sosSharing': false,
      },
    ],
  });
  ApiResult deleteContactResult = ApiResult.success(statusCode: 204);
  ApiResult updateContactSettingsResult = ApiResult.success(statusCode: 200);
  ApiResult getSharingCodeResult = ApiResult.success(statusCode: 200, data: {
    'sharingCode': 'ABC123',
    'sharingCodeExpiresAt': '2030-01-01T00:00:00.000Z',
  });
  ApiResult generateSharingCodeResult = ApiResult.success(statusCode: 200, data: {
    'sharingCode': 'NEW123',
    'sharingCodeExpiresAt': '2030-01-01T00:00:00.000Z',
  });
  ApiResult connectWithSharingCodeResult = ApiResult.success(statusCode: 200);
  ApiResult connectBackWithContactResult = ApiResult.success(statusCode: 200);

  @override
  Future<ApiResult> getContacts() async => getContactsResult;

  @override
  Future<ApiResult> deleteContact(String contactId) async => deleteContactResult;

  @override
  Future<ApiResult> updateContactSettings(
    String contactId, {
    required bool locationSharing,
    required bool sosSharing,
  }) async => updateContactSettingsResult;

  @override
  Future<ApiResult> getSharingCode() async => getSharingCodeResult;

  @override
  Future<ApiResult> generateSharingCode() async => generateSharingCodeResult;

  @override
  Future<ApiResult> connectWithSharingCode(String sharingCode) async {
    return connectWithSharingCodeResult;
  }

  @override
  Future<ApiResult> connectBackWithContact(String peerSafeWalkId) async {
    return connectBackWithContactResult;
  }
}

void main() {
  test('fetchContacts populates list', () async {
    final api = FakeApiService();
    final vm = ContactsViewModel(apiService: api);

    await vm.fetchContacts();

    expect(vm.contacts, hasLength(1));
    expect(vm.contacts.first.displayName, 'Jane');
  });

  test('toggleLocationSharing updates on success', () async {
    final api = FakeApiService();
    final vm = ContactsViewModel(apiService: api);

    await vm.fetchContacts();
    final before = vm.contacts.first;

    await vm.toggleLocationSharing(before.contactId);

    final updated = vm.contacts.first;
    expect(updated.locationSharing, isFalse);
  });

  test('toggleLocationSharing reverts on failure', () async {
    final api = FakeApiService();
    api.updateContactSettingsResult = ApiResult.error(
      statusCode: 400,
      message: 'Bad',
      data: {'error': 'Fehler'},
    );
    final vm = ContactsViewModel(apiService: api);

    await vm.fetchContacts();
    final before = vm.contacts.first;

    await vm.toggleLocationSharing(before.contactId);

    final updated = vm.contacts.first;
    expect(updated.locationSharing, before.locationSharing);
    expect(vm.errorMessage, 'Fehler');
  });

  test('removeContact removes entry on success', () async {
    final api = FakeApiService();
    final vm = ContactsViewModel(apiService: api);

    await vm.fetchContacts();
    await vm.removeContact(vm.contacts.first.contactId);

    expect(vm.contacts, isEmpty);
  });

  test('fetchSharingCode caches active code', () async {
    final api = FakeApiService();
    final vm = ContactsViewModel(apiService: api);

    await vm.fetchSharingCode();

    expect(vm.activeCode, 'ABC123');
    expect(vm.isCodeExpiringSoon, isFalse);
  });

  test('connectWithCode sets success message', () async {
    final api = FakeApiService();
    final vm = ContactsViewModel(apiService: api);

    await vm.connectWithCode('ABC123');

    expect(vm.successMessage, 'Erfolgreich als Bezugsperson verbunden!');
  });

  test('connectBackToContact sets success message', () async {
    final api = FakeApiService();
    final vm = ContactsViewModel(apiService: api);

    await vm.connectBackToContact('sw1');

    expect(vm.successMessage, 'Kontakt wurde ebenfalls zum Teilen hinzugefügt!');
  });
}

