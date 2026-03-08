// ContactsViewModel manages state for the Contacts screen.
//
// Holds the list of trusted contacts, expanded/collapsed card state,
// sharing-code panel visibility, per-contact permission toggles,
// generated sharing-code with expiry, and the approved flag per contact.

import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:safewalk/models/contact.dart';

class ContactsViewModel extends ChangeNotifier {
  // ─── Sharing-code panel ──────────────────────────────────────────────

  /// Whether the sharing-code panel at the top is visible.
  bool _isSharingPanelOpen = false;
  bool get isSharingPanelOpen => _isSharingPanelOpen;

  void toggleSharingPanel() {
    _isSharingPanelOpen = !_isSharingPanelOpen;
    notifyListeners();
  }

  // ─── Generated code ──────────────────────────────────────────────────

  String? _generatedCode;
  DateTime? _codeExpiresAt;

  /// The currently active code, or null if no code has been generated or it
  /// has expired.
  String? get activeCode {
    if (_generatedCode == null || _codeExpiresAt == null) return null;
    if (DateTime.now().isAfter(_codeExpiresAt!)) {
      // Code expired — clear lazily so UI correctly switches back.
      _generatedCode = null;
      _codeExpiresAt = null;
      return null;
    }
    return _generatedCode;
  }

  /// Expiry timestamp of the currently generated code.
  DateTime? get codeExpiresAt => (activeCode != null) ? _codeExpiresAt : null;

  /// Generates a new 6-character alphanumeric code valid for 24 hours.
  void generateCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    final rand = Random.secure();
    _generatedCode = List.generate(
      6,
      (_) => chars[rand.nextInt(chars.length)],
    ).join();
    _codeExpiresAt = DateTime.now().add(const Duration(hours: 24));
    notifyListeners();
  }

  // ─── Contacts list ───────────────────────────────────────────────────

  final List<Contact> _contacts = [
    const Contact(
      id: '1',
      name: 'Sarah Jena',
      isApproved: true,
      sharesLocation: true,
      sharesSOS: true,
    ),
    const Contact(
      id: '2',
      name: 'Markus Thomas',
      isApproved: true,
      sharesLocation: true,
      sharesSOS: false,
      sharesBackLocation: true,
      sharesBackSOS: false,
    ),
    const Contact(
      id: '3',
      name: 'Elena Rodriguez',
      isApproved: false,
      sharesLocation: false,
      sharesSOS: true,
      sharesBackLocation: true,
      sharesBackSOS: false,
    ),
  ];

  List<Contact> get contacts => List.unmodifiable(_contacts);

  // ─── Expanded card ───────────────────────────────────────────────────

  /// ID of the currently expanded contact card (null = all collapsed).
  String? _expandedContactId;
  String? get expandedContactId => _expandedContactId;

  void toggleExpanded(String id) {
    _expandedContactId = _expandedContactId == id ? null : id;
    notifyListeners();
  }

  // ─── Permission toggles ──────────────────────────────────────────────

  void toggleSharesLocation(String id) {
    final i = _contacts.indexWhere((c) => c.id == id);
    if (i == -1) return;
    _contacts[i] = _contacts[i].copyWith(
      sharesLocation: !_contacts[i].sharesLocation,
    );
    notifyListeners();
  }

  void toggleSharesSOS(String id) {
    final i = _contacts.indexWhere((c) => c.id == id);
    if (i == -1) return;
    _contacts[i] = _contacts[i].copyWith(sharesSOS: !_contacts[i].sharesSOS);
    notifyListeners();
  }

  // ─── Approve / Add to sharing ────────────────────────────────────────

  /// Toggles the [isApproved] flag for the contact with [id].
  void toggleApproved(String id) {
    final i = _contacts.indexWhere((c) => c.id == id);
    if (i == -1) return;
    _contacts[i] = _contacts[i].copyWith(isApproved: !_contacts[i].isApproved);
    notifyListeners();
  }

  // ─── Add / Remove ────────────────────────────────────────────────────

  void addContact(Contact contact) {
    _contacts.add(contact);
    notifyListeners();
  }

  void removeContact(String id) {
    _contacts.removeWhere((c) => c.id == id);
    if (_expandedContactId == id) _expandedContactId = null;
    notifyListeners();
  }
}
