import 'package:flutter_test/flutter_test.dart';
import 'package:safewalk/models/contact.dart';

void main() {
  test('Contact.fromJson applies defaults and parses fields', () {
    final contact = Contact.fromJson({'contactId': 'c1', 'safeWalkId': 'sw1'});

    expect(contact.contactId, 'c1');
    expect(contact.safeWalkId, 'sw1');
    expect(contact.displayName, 'Unbekannt');
    expect(contact.locationSharing, isFalse);
  });

  test('Contact permission descriptions reflect sharing flags', () {
    final both = Contact(
      contactId: '1',
      safeWalkId: 'sw1',
      displayName: 'Jane',
      locationSharing: true,
      sosSharing: true,
      sharesBackLocation: true,
      sharesBackSOS: true,
    );

    expect(both.permissionDescription, 'Du teilst Standort & SOS');
    expect(both.sharesBackDescription, 'Teilt Standort & SOS mit dir');

    final locationOnly = both.copyWith(
      locationSharing: true,
      sosSharing: false,
      sharesBackLocation: true,
      sharesBackSOS: false,
    );

    expect(locationOnly.permissionDescription, 'Du teilst deinen Standort');
    expect(locationOnly.sharesBackDescription, 'Teilt Standort mit dir');

    final none = both.copyWith(
      locationSharing: false,
      sosSharing: false,
      sharesBackLocation: false,
      sharesBackSOS: false,
    );

    expect(none.permissionDescription, 'Du teilst nichts');
    expect(none.sharesBackDescription, 'Teilt nichts mit dir');
  });

  test('Contact.copyWith preserves original values', () {
    const contact = Contact(
      contactId: 'c1',
      outgoingContactId: 'out1',
      safeWalkId: 'sw1',
      displayName: 'Jane',
      isOutgoing: true,
      locationSharing: true,
      sosSharing: false,
    );

    final updated = contact.copyWith(displayName: 'Jane Doe');

    expect(updated.displayName, 'Jane Doe');
    expect(updated.contactId, 'c1');
    expect(updated.outgoingContactId, 'out1');
  });
}

