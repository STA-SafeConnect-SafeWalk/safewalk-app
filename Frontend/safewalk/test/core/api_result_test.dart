import 'package:flutter_test/flutter_test.dart';
import 'package:safewalk/core/network/api_result.dart';

void main() {
  test('ApiResult.success sets success fields', () {
    final result = ApiResult.success(statusCode: 200, data: {'ok': true});

    expect(result.isSuccess, isTrue);
    expect(result.statusCode, 200);
    expect(result.data, {'ok': true});
    expect(result.message, 'Success');
  });

  test('ApiResult.error sets error fields', () {
    final result = ApiResult.error(statusCode: 500, message: 'Boom');

    expect(result.isSuccess, isFalse);
    expect(result.statusCode, 500);
    expect(result.message, 'Boom');
  });

  test('ApiResult.toString includes status and message', () {
    final result = ApiResult.error(statusCode: 404, message: 'Not found');

    expect(result.toString(), contains('statusCode: 404'));
    expect(result.toString(), contains('Not found'));
  });
}
