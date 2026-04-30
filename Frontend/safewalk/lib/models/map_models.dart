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

double? _toDouble(dynamic value) {
  if (value is double) return value;
  if (value is num) return value.toDouble();
  if (value is String) return double.tryParse(value);
  return null;
}
