class MapLayerMetadata {
  const MapLayerMetadata({
    required this.key,
    required this.label,
    required this.iconKey,
    this.isSelected = false,
  });

  final String key;
  final String label;
  final String iconKey;
  final bool isSelected;

  MapLayerMetadata copyWith({bool? isSelected}) {
    return MapLayerMetadata(
      key: key,
      label: label,
      iconKey: iconKey,
      isSelected: isSelected ?? this.isSelected,
    );
  }
}

class MapReportCategoryMetadata {
  const MapReportCategoryMetadata({required this.key, required this.label});

  final String key;
  final String label;
}

class PublicDataPoint {
  const PublicDataPoint({
    required this.id,
    required this.category,
    required this.lat,
    required this.lng,
    this.name,
  });

  /// OSM identifier in the form `<type>/<id>` (e.g. `node/123`).
  final String id;

  /// Backend category, e.g. `HOSPITAL`, `POLICE`, `STREET_LAMP`, `UNLIT_WAY`.
  final String category;
  final double lat;
  final double lng;
  final String? name;

  factory PublicDataPoint.fromJson(Map<String, dynamic> json) {
    return PublicDataPoint(
      id: (json['id'] ?? '').toString(),
      category: (json['category'] ?? '').toString(),
      lat: _toDouble(json['lat']) ?? 0,
      lng: _toDouble(json['lng']) ?? 0,
      name: json['name'] is String ? json['name'] as String : null,
    );
  }
}

class MapPlaceSuggestion {
  const MapPlaceSuggestion({
    required this.name,
    required this.fullName,
    required this.lat,
    required this.lng,
  });

  final String name;
  final String fullName;
  final double lat;
  final double lng;
}

class MapLayerEntry {
  const MapLayerEntry({
    required this.layerKey,
    required this.layerLabel,
    required this.lat,
    required this.lng,
  });

  final String layerKey;
  final String layerLabel;
  final double lat;
  final double lng;
}

class CommunityReportItem {
  const CommunityReportItem({
    required this.reportId,
    required this.type,
    required this.lat,
    required this.lng,
    this.comment,
    this.createdAt,
  });

  final String reportId;

  /// Backend report type, e.g. `UNLIT_WAY`, `WELL_LIT_WAY`, `UNSAFE_AREA`,
  /// `HIGH_FOOT_TRAFFIC`, `LOW_FOOT_TRAFFIC`, `CRIME_INCIDENT`.
  final String type;
  final double lat;
  final double lng;
  final String? comment;
  final String? createdAt;

  factory CommunityReportItem.fromJson(Map<String, dynamic> json) {
    return CommunityReportItem(
      reportId: (json['reportId'] ?? '').toString(),
      type: (json['type'] ?? '').toString(),
      lat: _toDouble(json['lat']) ?? 0,
      lng: _toDouble(json['lng']) ?? 0,
      comment: json['comment'] is String ? json['comment'] as String : null,
      createdAt: json['createdAt'] is String
          ? json['createdAt'] as String
          : null,
    );
  }
}

/// Live location of a trusted contact who shares their position with the
/// authenticated user.
class ContactLiveLocation {
  const ContactLiveLocation({
    required this.safeWalkId,
    required this.displayName,
    required this.lat,
    required this.lng,
    required this.accuracy,
    required this.updatedAt,
  });

  final String safeWalkId;
  final String displayName;
  final double lat;
  final double lng;
  final double accuracy;

  /// ISO-8601 timestamp from the backend (`updatedAt`).
  final DateTime updatedAt;

  /// Age of this position relative to [now] (or [DateTime.now] by default).
  Duration ageFrom([DateTime? now]) =>
      (now ?? DateTime.now()).difference(updatedAt);

  static ContactLiveLocation? fromJson(Map<String, dynamic> json) {
    final lat = _toDouble(json['lat']);
    final lng = _toDouble(json['lng']);
    final updated = json['updatedAt'];
    if (lat == null || lng == null || updated is! String) return null;

    final updatedAt = DateTime.tryParse(updated);
    if (updatedAt == null) return null;

    return ContactLiveLocation(
      safeWalkId: (json['safeWalkId'] ?? '').toString(),
      displayName: (json['displayName'] ?? '').toString(),
      lat: lat,
      lng: lng,
      accuracy: _toDouble(json['accuracy']) ?? 0,
      updatedAt: updatedAt,
    );
  }

  @override
  bool operator ==(Object other) {
    if (identical(this, other)) return true;
    return other is ContactLiveLocation &&
        other.safeWalkId == safeWalkId &&
        other.displayName == displayName &&
        other.lat == lat &&
        other.lng == lng &&
        other.accuracy == accuracy &&
        other.updatedAt == updatedAt;
  }

  @override
  int get hashCode =>
      Object.hash(safeWalkId, displayName, lat, lng, accuracy, updatedAt);
}

/// An active SOS alarm received by the authenticated user.
class ActiveSosLocation {
  const ActiveSosLocation({
    required this.sosId,
    required this.victimDisplayName,
    required this.lat,
    required this.lng,
    required this.accuracy,
    required this.updatedAt,
    required this.createdAt,
  });

  final String sosId;
  final String victimDisplayName;
  final double lat;
  final double lng;
  final double accuracy;

  /// ISO-8601 timestamp of the last location update.
  final DateTime updatedAt;
  final DateTime createdAt;

  Duration ageFrom([DateTime? now]) =>
      (now ?? DateTime.now()).difference(updatedAt);

  static ActiveSosLocation? fromJson(Map<String, dynamic> json) {
    final geo = json['geoLocation'];
    if (geo is! Map) return null;
    final lat = _toDouble(geo['lat']);
    final lng = _toDouble(geo['lng']);
    if (lat == null || lng == null) return null;

    final status = (json['status'] ?? '').toString();
    if (status != 'ACTIVE') return null;

    final updatedRaw = json['updatedAt'];
    final createdRaw = json['createdAt'];
    final updatedAt = updatedRaw is String
        ? DateTime.tryParse(updatedRaw)
        : null;
    final createdAt = createdRaw is String
        ? DateTime.tryParse(createdRaw)
        : null;
    if (updatedAt == null || createdAt == null) return null;

    return ActiveSosLocation(
      sosId: (json['sosId'] ?? '').toString(),
      victimDisplayName: (json['victimDisplayName'] ?? 'Unbekannte Person')
          .toString(),
      lat: lat,
      lng: lng,
      accuracy: _toDouble(geo['accuracy']) ?? 0,
      updatedAt: updatedAt,
      createdAt: createdAt,
    );
  }

  @override
  bool operator ==(Object other) {
    if (identical(this, other)) return true;
    return other is ActiveSosLocation &&
        other.sosId == sosId &&
        other.victimDisplayName == victimDisplayName &&
        other.lat == lat &&
        other.lng == lng &&
        other.accuracy == accuracy &&
        other.updatedAt == updatedAt &&
        other.createdAt == createdAt;
  }

  @override
  int get hashCode => Object.hash(
    sosId,
    victimDisplayName,
    lat,
    lng,
    accuracy,
    updatedAt,
    createdAt,
  );
}

double? _toDouble(dynamic value) {
  if (value is double) return value;
  if (value is num) return value.toDouble();
  if (value is String) return double.tryParse(value);
  return null;
}
