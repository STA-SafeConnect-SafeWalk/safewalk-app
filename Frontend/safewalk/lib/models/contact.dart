/// Represents a trusted contact in SafeWalk.
class Contact {
  final String id;

  /// Display name of the contact.
  final String name;

  /// Whether the user has granted this contact access (location / SOS toggles
  /// are visible only when [isApproved] is true).
  final bool isApproved;

  /// Whether the contact can see the user's location.
  final bool sharesLocation;

  /// Whether the contact receives the user's SOS alarm.
  final bool sharesSOS;

  /// Whether this contact is currently actively tracking (green dot indicator).
  final bool isActivelyTracking;

  /// Whether this contact shares their own location back with the user.
  final bool sharesBackLocation;

  /// Whether this contact shares their own SOS alarm back with the user.
  final bool sharesBackSOS;

  /// Optional remote URL for the contact's profile picture.
  final String? avatarUrl;

  const Contact({
    required this.id,
    required this.name,
    this.isApproved = true,
    this.sharesLocation = false,
    this.sharesSOS = false,
    this.isActivelyTracking = false,
    this.sharesBackLocation = false,
    this.sharesBackSOS = false,
    this.avatarUrl,
  });

  /// Computed permission description derived from the toggles.
  String get permissionDescription {
    if (sharesLocation && sharesSOS) return 'Sieht Standort & SOS Alarm';
    if (sharesLocation) return 'Sieht deinen Standort';
    if (sharesSOS) return 'Sieht dein SOS Alarm';
    return 'Keine Berechtigung';
  }

  /// Computed description of what this contact shares back with the user.
  /// Returns null when the contact shares nothing back.
  String? get sharesBackDescription {
    if (!sharesBackLocation && !sharesBackSOS) return null;
    final firstName = name.split(' ').first;
    if (sharesBackLocation && sharesBackSOS) {
      return '$firstName teilt Standort & SOS Alarm mit dir.';
    }
    if (sharesBackLocation)
      return '$firstName teilt seinen/ihren Standort mit dir.';
    return '$firstName teilt seinen/ihren SOS Alarm mit dir.';
  }

  Contact copyWith({
    String? id,
    String? name,
    bool? isApproved,
    bool? sharesLocation,
    bool? sharesSOS,
    bool? isActivelyTracking,
    bool? sharesBackLocation,
    bool? sharesBackSOS,
    String? avatarUrl,
  }) {
    return Contact(
      id: id ?? this.id,
      name: name ?? this.name,
      isApproved: isApproved ?? this.isApproved,
      sharesLocation: sharesLocation ?? this.sharesLocation,
      sharesSOS: sharesSOS ?? this.sharesSOS,
      isActivelyTracking: isActivelyTracking ?? this.isActivelyTracking,
      sharesBackLocation: sharesBackLocation ?? this.sharesBackLocation,
      sharesBackSOS: sharesBackSOS ?? this.sharesBackSOS,
      avatarUrl: avatarUrl ?? this.avatarUrl,
    );
  }
}
