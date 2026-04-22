class Tip {
  final String tipId;
  final String icon;
  final String title;
  final String description;
  final String category;
  final String? link;

  const Tip({
    required this.tipId,
    required this.icon,
    required this.title,
    required this.description,
    required this.category,
    this.link,
  });

  factory Tip.fromJson(Map<String, dynamic> json) {
    return Tip(
      tipId: (json['tipId'] as String?) ?? (json['id'] as String?) ?? '',
      icon: (json['icon'] as String?) ?? '',
      title: (json['title'] as String?) ?? 'Sicherheitstipp',
      description: (json['description'] as String?) ?? '',
      category: (json['category'] as String?) ?? 'Allgemein',
      link: json['link'] as String?,
    );
  }

  bool matchesSearch(String query) {
    if (query.isEmpty) return true;
    final q = query.toLowerCase();
    return title.toLowerCase().contains(q) ||
        description.toLowerCase().contains(q) ||
        category.toLowerCase().contains(q);
  }
}
