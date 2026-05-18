import 'package:flutter_test/flutter_test.dart';
import 'package:safewalk/models/tip.dart';

void main() {
  test('Tip.fromJson applies fallbacks', () {
    final tip = Tip.fromJson({'id': 't1'});

    expect(tip.tipId, 't1');
    expect(tip.title, 'Sicherheitstipp');
    expect(tip.category, 'Allgemein');
  });

  test('Tip.matchesSearch looks at title, description, category', () {
    const tip = Tip(
      tipId: 't1',
      icon: 'icon',
      title: 'Bleib wachsam',
      description: 'Achte auf deine Umgebung',
      category: 'Aufmerksamkeit',
    );

    expect(tip.matchesSearch('wachsam'), isTrue);
    expect(tip.matchesSearch('umgebung'), isTrue);
    expect(tip.matchesSearch('aufmerksamkeit'), isTrue);
    expect(tip.matchesSearch(''), isTrue);
    expect(tip.matchesSearch('xyz'), isFalse);
  });
}

