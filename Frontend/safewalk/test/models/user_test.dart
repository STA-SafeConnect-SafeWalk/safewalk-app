import 'package:flutter_test/flutter_test.dart';
import 'package:safewalk/models/user.dart';

void main() {
  test('User.fromJson and toJson roundtrip', () {
    final user = User.fromJson({
      'id': 'u1',
      'username': 'jane',
      'email': 'jane@example.com',
    });

    expect(user.id, 'u1');
    expect(user.username, 'jane');
    expect(user.email, 'jane@example.com');

    expect(user.toJson(), {
      'id': 'u1',
      'username': 'jane',
      'email': 'jane@example.com',
    });
  });
}

