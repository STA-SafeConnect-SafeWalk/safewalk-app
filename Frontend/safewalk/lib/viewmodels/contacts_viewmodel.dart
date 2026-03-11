// ContactsViewModel manages state for the Contacts screen.
//
// All data is fetched from / persisted to the SafeWalk backend via
// [ApiService]. The ViewModel exposes loading / error states so the UI
// can show spinners and error messages transparently.

import 'package:flutter/foundation.dart';
import 'package:safewalk/models/contact.dart';
import 'package:safewalk/services/api_service.dart';

class ContactsViewModel extends ChangeNotifier {
  final ApiService _apiService;

  ContactsViewModel({required ApiService apiService})
    : _apiService = apiService;

  // ─── Loading / error state ───────────────────────────────────────────

  bool _isLoadingContacts = false;
  bool get isLoadingContacts => _isLoadingContacts;

  bool _isLoadingSharingCode = false;
  bool get isLoadingSharingCode => _isLoadingSharingCode;

  bool _isGeneratingCode = false;
  bool get isGeneratingCode => _isGeneratingCode;

  bool _isConnecting = false;
  bool get isConnecting => _isConnecting;

  /// Maps contactId → true while a PATCH or DELETE is in flight.
  final Map<String, bool> _contactBusy = {};
  bool isContactBusy(String contactId) => _contactBusy[contactId] ?? false;

  String? _errorMessage;
  String? get errorMessage => _errorMessage;

  /// Clears the current error message.
  void clearError() {
    _errorMessage = null;
    notifyListeners();
  }

  String? _successMessage;
  String? get successMessage => _successMessage;

  void clearSuccess() {
    _successMessage = null;
    notifyListeners();
  }

  // ─── Sharing-code panel ──────────────────────────────────────────────

  bool _isSharingPanelOpen = false;
  bool get isSharingPanelOpen => _isSharingPanelOpen;

  void toggleSharingPanel() {
    _isSharingPanelOpen = !_isSharingPanelOpen;
    notifyListeners();
  }

  // ─── Sharing code (from backend) ─────────────────────────────────────

  String? _sharingCode;
  DateTime? _codeExpiresAt;

  /// Returns the sharing code only if it has not expired yet.
  String? get activeCode {
    if (_sharingCode == null || _codeExpiresAt == null) return null;
    if (DateTime.now().isAfter(_codeExpiresAt!)) {
      return null;
    }
    return _sharingCode;
  }

  /// Expiry timestamp — only meaningful when [activeCode] is non-null.
  DateTime? get codeExpiresAt => (activeCode != null) ? _codeExpiresAt : null;

  /// Whether the code expires within the next hour (for red styling).
  bool get isCodeExpiringSoon {
    if (_codeExpiresAt == null || activeCode == null) return false;
    return _codeExpiresAt!
            .difference(DateTime.now())
            .compareTo(const Duration(hours: 1)) <
        0;
  }

  // ─── Contacts list ───────────────────────────────────────────────────

  List<Contact> _contacts = [];
  List<Contact> get contacts => List.unmodifiable(_contacts);

  // ─── Expanded card ───────────────────────────────────────────────────

  String? _expandedContactId;
  String? get expandedContactId => _expandedContactId;

  void toggleExpanded(String id) {
    _expandedContactId = _expandedContactId == id ? null : id;
    notifyListeners();
  }

  // ─── Initial data load ───────────────────────────────────────────────

  /// Call when the screen is first shown or when a refresh is needed.
  /// Fetches contacts and the current sharing code in parallel.
  Future<void> loadInitialData() async {
    await Future.wait([fetchContacts(), fetchSharingCode()]);
  }

  // ─── GET /contacts ───────────────────────────────────────────────────

  Future<void> fetchContacts() async {
    _isLoadingContacts = true;
    _errorMessage = null;
    notifyListeners();

    try {
      final result = await _apiService.getContacts();
      if (result.isSuccess && result.data is Map) {
        final data = result.data as Map<String, dynamic>;
        final list = data['contacts'] as List<dynamic>? ?? [];
        _contacts = list
            .map((e) => Contact.fromJson(e as Map<String, dynamic>))
            .toList();
      } else {
        _errorMessage = _extractError(result.data, result.message);
      }
    } catch (e) {
      _errorMessage = 'Kontakte konnten nicht geladen werden: $e';
    }

    _isLoadingContacts = false;
    notifyListeners();
  }

  // ─── DELETE /contacts/{contactId} ─────────────────────────────────────

  Future<void> removeContact(String contactId) async {
    _contactBusy[contactId] = true;
    _errorMessage = null;
    notifyListeners();

    try {
      final result = await _apiService.deleteContact(contactId);
      if (result.isSuccess) {
        _contacts.removeWhere((c) => c.contactId == contactId);
        if (_expandedContactId == contactId) _expandedContactId = null;
      } else {
        _errorMessage = _extractError(result.data, result.message);
      }
    } catch (e) {
      _errorMessage = 'Kontakt konnte nicht entfernt werden: $e';
    }

    _contactBusy.remove(contactId);
    notifyListeners();
  }

  // ─── PATCH /contacts/{contactId}  — toggle location sharing ──────────

  Future<void> toggleLocationSharing(String contactId) async {
    final i = _contacts.indexWhere((c) => c.contactId == contactId);
    if (i == -1) return;
    final contact = _contacts[i];
    final outId = contact.outgoingContactId;
    if (outId == null || outId.isEmpty) return; // no outgoing entry to PATCH
    final newValue = !contact.locationSharing;

    // Optimistic update
    _contacts[i] = contact.copyWith(locationSharing: newValue);
    notifyListeners();

    try {
      final result = await _apiService.updateContactSettings(
        outId,
        locationSharing: newValue,
        sosSharing: contact.sosSharing,
      );
      if (!result.isSuccess) {
        // Revert
        _contacts[i] = contact;
        _errorMessage = _extractError(result.data, result.message);
        notifyListeners();
      }
    } catch (e) {
      _contacts[i] = contact;
      _errorMessage = 'Einstellung konnte nicht gespeichert werden: $e';
      notifyListeners();
    }
  }

  // ─── PATCH /contacts/{contactId}  — toggle SOS sharing ───────────────

  Future<void> toggleSosSharing(String contactId) async {
    final i = _contacts.indexWhere((c) => c.contactId == contactId);
    if (i == -1) return;
    final contact = _contacts[i];
    final outId = contact.outgoingContactId;
    if (outId == null || outId.isEmpty) return; // no outgoing entry to PATCH
    final newValue = !contact.sosSharing;

    // Optimistic update
    _contacts[i] = contact.copyWith(sosSharing: newValue);
    notifyListeners();

    try {
      final result = await _apiService.updateContactSettings(
        outId,
        locationSharing: contact.locationSharing,
        sosSharing: newValue,
      );
      if (!result.isSuccess) {
        _contacts[i] = contact;
        _errorMessage = _extractError(result.data, result.message);
        notifyListeners();
      }
    } catch (e) {
      _contacts[i] = contact;
      _errorMessage = 'Einstellung konnte nicht gespeichert werden: $e';
      notifyListeners();
    }
  }

  // ─── GET /sharing-code ───────────────────────────────────────────────

  Future<void> fetchSharingCode() async {
    _isLoadingSharingCode = true;
    notifyListeners();

    try {
      final result = await _apiService.getSharingCode();
      if (result.isSuccess && result.data is Map) {
        final data = result.data as Map<String, dynamic>;
        _sharingCode = data['sharingCode'] as String?;
        final expiresStr = data['sharingCodeExpiresAt'] as String?;
        _codeExpiresAt = expiresStr != null
            ? DateTime.tryParse(expiresStr)?.toLocal()
            : null;
      } else {
        // 404 means no code yet — not an error worth showing
        if (result.statusCode != 404) {
          _errorMessage = _extractError(result.data, result.message);
        }
        _sharingCode = null;
        _codeExpiresAt = null;
      }
    } catch (e) {
      _errorMessage = 'Sharing-Code konnte nicht geladen werden: $e';
    }

    _isLoadingSharingCode = false;
    notifyListeners();
  }

  // ─── POST /sharing-code  (generate / refresh) ────────────────────────

  Future<void> generateCode() async {
    _isGeneratingCode = true;
    _errorMessage = null;
    notifyListeners();

    try {
      final result = await _apiService.generateSharingCode();
      if (result.isSuccess && result.data is Map) {
        final data = result.data as Map<String, dynamic>;
        _sharingCode = data['sharingCode'] as String?;
        final expiresStr = data['sharingCodeExpiresAt'] as String?;
        _codeExpiresAt = expiresStr != null
            ? DateTime.tryParse(expiresStr)?.toLocal()
            : null;
      } else {
        _errorMessage = _extractError(result.data, result.message);
      }
    } catch (e) {
      _errorMessage = 'Code konnte nicht generiert werden: $e';
    }

    _isGeneratingCode = false;
    notifyListeners();
  }

  // ─── POST /sharing-code/connect ──────────────────────────────────────

  Future<void> connectWithCode(String code) async {
    _isConnecting = true;
    _errorMessage = null;
    _successMessage = null;
    notifyListeners();

    try {
      final result = await _apiService.connectWithSharingCode(code);
      if (result.isSuccess) {
        _successMessage = 'Erfolgreich als Bezugsperson verbunden!';
        // Refresh contacts list to include the new connection
        await fetchContacts();
      } else {
        _errorMessage = _extractError(result.data, result.message);
      }
    } catch (e) {
      _errorMessage = 'Verbindung fehlgeschlagen: $e';
    }

    _isConnecting = false;
    notifyListeners();
  }

  // ─── Helper ──────────────────────────────────────────────────────────

  /// Extracts a user-friendly error string from the backend response.
  String _extractError(dynamic data, String? fallback) {
    if (data is Map) {
      final err = data['error'] ?? data['message'];
      if (err != null) return err.toString();
    }
    return fallback ?? 'Ein unbekannter Fehler ist aufgetreten.';
  }
}
