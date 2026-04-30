class HeatmapLayerMetadata {
  const HeatmapLayerMetadata({
    required this.key,
    required this.label,
    required this.weight,
    required this.iconKey,
    this.isSelected = false,
  });

  final String key;
  final String label;
  final double weight;
  final String iconKey;
  final bool isSelected;

  HeatmapLayerMetadata copyWith({bool? isSelected}) {
    return HeatmapLayerMetadata(
      key: key,
      label: label,
      weight: weight,
      iconKey: iconKey,
      isSelected: isSelected ?? this.isSelected,
    );
  }

  factory HeatmapLayerMetadata.fromJson(
    Map<String, dynamic> json, {
    bool isSelected = false,
  }) {
    return HeatmapLayerMetadata(
      key: (json['key'] ?? '').toString(),
      label: (json['label'] ?? '').toString(),
      weight: _toDouble(json['weight']) ?? 0,
      iconKey: (json['iconKey'] ?? '').toString(),
      isSelected: isSelected,
    );
  }
}

class HeatmapReportCategoryMetadata {
  const HeatmapReportCategoryMetadata({
    required this.key,
    required this.label,
    required this.weight,
  });

  final String key;
  final String label;
  final double weight;

  factory HeatmapReportCategoryMetadata.fromJson(Map<String, dynamic> json) {
    return HeatmapReportCategoryMetadata(
      key: (json['key'] ?? '').toString(),
      label: (json['label'] ?? '').toString(),
      weight: _toDouble(json['weight']) ?? 0,
    );
  }
}

class PublicDataPoint {
  const PublicDataPoint({
    required this.lat,
    required this.lng,
    required this.type,
    required this.osmId,
  });

  final double lat;
  final double lng;
  final String type;
  final String osmId;

  factory PublicDataPoint.fromJson(Map<String, dynamic> json) {
    return PublicDataPoint(
      lat: _toDouble(json['lat']) ?? 0,
      lng: _toDouble(json['lng']) ?? 0,
      type: (json['type'] ?? '').toString(),
      osmId: (json['osmId'] ?? '').toString(),
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

class HeatmapLayerEntry {
  const HeatmapLayerEntry({
    required this.layerKey,
    required this.layerLabel,
    required this.lat,
    required this.lng,
    required this.count,
  });

  final String layerKey;
  final String layerLabel;
  final double lat;
  final double lng;
  final int count;
}

class CommunityReportItem {
  const CommunityReportItem({
    required this.reportId,
    required this.category,
    required this.lat,
    required this.lng,
    this.description,
    this.createdAt,
  });

  final String reportId;
  final String category;
  final double lat;
  final double lng;
  final String? description;
  final String? createdAt;

  factory CommunityReportItem.fromJson(Map<String, dynamic> json) {
    return CommunityReportItem(
      reportId: (json['reportId'] ?? '').toString(),
      category: (json['category'] ?? '').toString(),
      lat: _toDouble(json['lat']) ?? 0,
      lng: _toDouble(json['lng']) ?? 0,
      description: json['description'] as String?,
      createdAt: json['createdAt'] as String?,
    );
  }
}


double? _toDouble(dynamic value) {
  if (value is double) return value;
  if (value is num) return value.toDouble();
  if (value is String) return double.tryParse(value);
  return null;
}
