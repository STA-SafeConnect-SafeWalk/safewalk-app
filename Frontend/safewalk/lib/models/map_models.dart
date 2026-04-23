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

class HeatmapCellModel {
  const HeatmapCellModel({
    required this.geohash,
    required this.centerLat,
    required this.centerLng,
    required this.safetyScore,
    required this.reportCounts,
    required this.publicDataCounts,
    required this.totalDataPoints,
  });

  final String geohash;
  final double centerLat;
  final double centerLng;
  final double? safetyScore;
  final Map<String, int> reportCounts;
  final Map<String, int> publicDataCounts;
  final int totalDataPoints;

  factory HeatmapCellModel.fromJson(Map<String, dynamic> json) {
    return HeatmapCellModel(
      geohash: (json['geohash'] ?? '').toString(),
      centerLat: _toDouble(json['centerLat']) ?? 0,
      centerLng: _toDouble(json['centerLng']) ?? 0,
      safetyScore: _toDouble(json['safetyScore']),
      reportCounts: _toIntMap(json['reportCounts']),
      publicDataCounts: _toIntMap(json['publicDataCounts']),
      totalDataPoints: _toInt(json['totalDataPoints']) ?? 0,
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

Map<String, int> _toIntMap(dynamic value) {
  if (value is! Map) return const {};
  final result = <String, int>{};
  for (final entry in value.entries) {
    final parsed = _toInt(entry.value);
    if (parsed != null) {
      result[entry.key.toString()] = parsed;
    }
  }
  return result;
}

int? _toInt(dynamic value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  if (value is String) return int.tryParse(value);
  return null;
}

double? _toDouble(dynamic value) {
  if (value is double) return value;
  if (value is num) return value.toDouble();
  if (value is String) return double.tryParse(value);
  return null;
}
