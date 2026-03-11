/// Represents a trusted contact in SafeWalk.
///
/// Maps to the backend response from GET /contacts:
/// ```json
/// {
///   "contactId": "...",
///   "outgoingContactId": "...",
///   "safeWalkId": "...",
///   "displayName": "Jane Doe",
///   "isOutgoing": true,
///   "locationSharing": true,
///   "sosSharing": true,
///   "sharesBackLocation": true,
///   "sharesBackSOS": false
/// }
/// ```
class Contact {
  /// Representative contact ID (outgoing preferred). Used for DELETE.
  final String contactId;

  /// The user's own (outgoing) contact ID for PATCH. Null if only incoming.
  final String? outgoingContactId;

  /// SafeWalk platform ID of the contact.
  final String safeWalkId;

  /// Display name of the contact (may be null from backend).
  final String displayName;

  /// Whether the user has an outgoing sharing entry for this contact.
  final bool isOutgoing;

  /// Whether the user shares their location with this contact (outgoing).
  final bool locationSharing;

  /// Whether the user shares SOS alerts with this contact (outgoing).
  final bool sosSharing;

  /// Whether the contact shares their location back with the user (incoming).
  final bool sharesBackLocation;

  /// Whether the contact shares SOS alerts back with the user (incoming).
  final bool sharesBackSOS;

  const Contact({
    required this.contactId,
    this.outgoingContactId,
    required this.safeWalkId,
    required this.displayName,
    this.isOutgoing = false,
    this.locationSharing = false,
    this.sosSharing = false,
    this.sharesBackLocation = false,
    this.sharesBackSOS = false,
  });

  /// Constructs a [Contact] from a JSON map returned by the backend.
  factory Contact.fromJson(Map<String, dynamic> json) {
    return Contact(
      contactId: json['contactId'] as String? ?? '',
      outgoingContactId: json['outgoingContactId'] as String?,
      safeWalkId: json['safeWalkId'] as String? ?? '',
      displayName: json['displayName'] as String? ?? 'Unbekannt',
      isOutgoing: json['isOutgoing'] as bool? ?? false,
      locationSharing: json['locationSharing'] as bool? ?? false,
      sosSharing: json['sosSharing'] as bool? ?? false,
      sharesBackLocation: json['sharesBackLocation'] as bool? ?? false,
      sharesBackSOS: json['sharesBackSOS'] as bool? ?? false,
    );
  }

  /// Describes what the user shares with this contact (outgoing).
  String get permissionDescription {
    if (locationSharing && sosSharing) return 'Du teilst Standort & SOS';
    if (locationSharing) return 'Du teilst deinen Standort';
    if (sosSharing) return 'Du teilst deinen SOS Alarm';
    return 'Du teilst nichts';
  }

  /// Describes what the contact shares back with the user (incoming).
  String get sharesBackDescription {
    if (sharesBackLocation && sharesBackSOS) {
      return 'Teilt Standort & SOS mit dir';
    }
    if (sharesBackLocation) return 'Teilt Standort mit dir';
    if (sharesBackSOS) return 'Teilt SOS mit dir';
    return 'Teilt nichts mit dir';
  }

  Contact copyWith({
    String? contactId,
    String? outgoingContactId,
    String? safeWalkId,
    String? displayName,
    bool? isOutgoing,
    bool? locationSharing,
    bool? sosSharing,
    bool? sharesBackLocation,
    bool? sharesBackSOS,
  }) {
    return Contact(
      contactId: contactId ?? this.contactId,
      outgoingContactId: outgoingContactId ?? this.outgoingContactId,
      safeWalkId: safeWalkId ?? this.safeWalkId,
      displayName: displayName ?? this.displayName,
      isOutgoing: isOutgoing ?? this.isOutgoing,
      locationSharing: locationSharing ?? this.locationSharing,
      sosSharing: sosSharing ?? this.sosSharing,
      sharesBackLocation: sharesBackLocation ?? this.sharesBackLocation,
      sharesBackSOS: sharesBackSOS ?? this.sharesBackSOS,
    );
  }
}
