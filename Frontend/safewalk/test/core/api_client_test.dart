import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:safewalk/core/network/api_client.dart';

void main() {
  late HttpServer server;
  late String baseUrl;

  setUp(() async {
    server = await HttpServer.bind('127.0.0.1', 0);
    baseUrl = 'http://127.0.0.1:${server.port}';
  });

  tearDown(() async {
    await server.close(force: true);
  });

  test('GET returns parsed JSON', () async {
    server.listen((request) async {
      request.response.statusCode = 200;
      request.response.headers.contentType = ContentType.json;
      request.response.write(jsonEncode({'ok': true}));
      await request.response.close();
    });

    final client = ApiClient(baseUrl: baseUrl);
    final result = await client.get('/test');

    expect(result.isSuccess, isTrue);
    expect(result.data, {'ok': true});
  });

  test('POST sends body and returns response', () async {
    server.listen((request) async {
      final body = await utf8.decoder.bind(request).join();
      request.response.statusCode = 200;
      request.response.headers.contentType = ContentType.json;
      request.response.write(body);
      await request.response.close();
    });

    final client = ApiClient(baseUrl: baseUrl);
    final result = await client.post('/test', body: {'name': 'Jane'});

    expect(result.isSuccess, isTrue);
    expect(result.data, {'name': 'Jane'});
  });

  test('PUT includes auth header when token is set', () async {
    server.listen((request) async {
      final auth = request.headers.value('authorization');
      request.response.statusCode = auth == 'Bearer token' ? 200 : 401;
      await request.response.close();
    });

    final client = ApiClient(baseUrl: baseUrl, authToken: 'token');
    final result = await client.put('/secure', body: {'ok': true});

    expect(result.isSuccess, isTrue);
  });

  test('PATCH returns friendly message on 404', () async {
    server.listen((request) async {
      request.response.statusCode = 404;
      await request.response.close();
    });

    final client = ApiClient(baseUrl: baseUrl);
    final result = await client.patch('/missing', body: {'ok': true});

    expect(result.isSuccess, isFalse);
    expect(result.message, 'Die angeforderten Daten wurden nicht gefunden.');
  });

  test('GET returns friendly message on 500', () async {
    server.listen((request) async {
      request.response.statusCode = 500;
      await request.response.close();
    });

    final client = ApiClient(baseUrl: baseUrl);
    final result = await client.get('/boom');

    expect(result.isSuccess, isFalse);
    expect(result.message, 'Serverfehler. Bitte versuche es später erneut.');
  });

  test('GET returns auth message on 401', () async {
    server.listen((request) async {
      request.response.statusCode = 401;
      await request.response.close();
    });

    final client = ApiClient(baseUrl: baseUrl);
    final result = await client.get('/secure');

    expect(result.isSuccess, isFalse);
    expect(result.message, 'Bitte melde dich erneut an, um fortzufahren.');
  });

  test('GET attaches query parameters', () async {
    server.listen((request) async {
      final ok = request.uri.queryParameters['q'] == 'test' &&
          request.uri.queryParameters['page'] == '1';
      request.response.statusCode = ok ? 200 : 400;
      request.response.headers.contentType = ContentType.json;
      request.response.write(jsonEncode({'ok': ok}));
      await request.response.close();
    });

    final client = ApiClient(baseUrl: baseUrl);
    final result = await client.get('/search', queryParameters: {
      'q': 'test',
      'page': 1,
    });

    expect(result.isSuccess, isTrue);
    expect(result.data, {'ok': true});
  });

  test('POST surfaces server error message', () async {
    server.listen((request) async {
      request.response.statusCode = 400;
      request.response.headers.contentType = ContentType.json;
      request.response.write(jsonEncode({'error': 'Bad request'}));
      await request.response.close();
    });

    final client = ApiClient(baseUrl: baseUrl);
    final result = await client.post('/bad', body: {'ok': false});

    expect(result.isSuccess, isFalse);
    expect(result.message, 'Bad request');
  });

  test('DELETE returns error on timeout', () async {
    server.listen((request) async {
      await Future.delayed(const Duration(milliseconds: 50));
      request.response.statusCode = 200;
      await request.response.close();
    });

    final client = ApiClient(
      baseUrl: baseUrl,
      timeout: const Duration(milliseconds: 10),
    );
    final result = await client.delete('/slow');

    expect(result.isSuccess, isFalse);
    expect(result.message, contains('zu lange'));
  });
}
