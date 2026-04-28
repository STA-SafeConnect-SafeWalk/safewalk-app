// ApiClient provides a general-purpose HTTP client for communicating with
// REST APIs. It wraps the `http` package and offers typed methods for
// GET, POST, PUT, PATCH, and DELETE requests with consistent error handling,
// timeout support, and JSON serialization.
//
// For authenticated requests set [authToken] before making calls.
// The token is automatically added as `Authorization: Bearer <token>`.
//
// Usage:
//   final client = ApiClient(baseUrl: 'https://api.example.com');
//   client.authToken = 'eyJ...';       // optional – enables auth header
//   final result = await client.get('/users');

import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:safewalk/core/network/api_result.dart';

class ApiClient {
  /// The base URL all requests are made against (e.g. https://api.example.com).
  final String baseUrl;

  /// Maximum duration to wait for a response before timing out.
  final Duration timeout;

  /// When set, every request includes `Authorization: Bearer <authToken>`.
  /// Set to `null` to disable.
  String? authToken;

  ApiClient({
    required this.baseUrl,
    this.timeout = const Duration(seconds: 15),
    this.authToken,
  });

  // ---------------------------------------------------------------------------
  // Public HTTP methods
  // ---------------------------------------------------------------------------

  /// Sends a GET request to [endpoint].
  ///
  /// Optional [headers] are merged with the default JSON headers.
  /// Optional [queryParameters] are appended to the URL.
  Future<ApiResult> get(
    String endpoint, {
    Map<String, String>? headers,
    Map<String, dynamic>? queryParameters,
    http.Client? client,
  }) async {
    final effectiveClient = client ?? http.Client();
    final ownsClient = client == null;

    try {
      final uri = _buildUri(endpoint, queryParameters);
      final response = await effectiveClient
          .get(uri, headers: _buildHeaders(headers))
          .timeout(timeout);
      return _handleResponse(response);
    } catch (e) {
      return ApiResult.error(
        statusCode: 0,
        message: 'GET request failed: ${e.toString()}',
      );
    } finally {
      if (ownsClient) {
        effectiveClient.close();
      }
    }
  }

  /// Sends a POST request to [endpoint] with an optional JSON [body].
  Future<ApiResult> post(
    String endpoint, {
    dynamic body,
    Map<String, String>? headers,
  }) async {
    try {
      final uri = _buildUri(endpoint, null);
      final response = await http
          .post(
            uri,
            headers: _buildHeaders(headers),
            body: body != null ? jsonEncode(body) : null,
          )
          .timeout(timeout);
      return _handleResponse(response);
    } catch (e) {
      return ApiResult.error(
        statusCode: 0,
        message: 'POST request failed: ${e.toString()}',
      );
    }
  }

  /// Sends a PUT request to [endpoint] with an optional JSON [body].
  Future<ApiResult> put(
    String endpoint, {
    dynamic body,
    Map<String, String>? headers,
  }) async {
    try {
      final uri = _buildUri(endpoint, null);
      final response = await http
          .put(
            uri,
            headers: _buildHeaders(headers),
            body: body != null ? jsonEncode(body) : null,
          )
          .timeout(timeout);
      return _handleResponse(response);
    } catch (e) {
      return ApiResult.error(
        statusCode: 0,
        message: 'PUT request failed: ${e.toString()}',
      );
    }
  }

  /// Sends a PATCH request to [endpoint] with an optional JSON [body].
  Future<ApiResult> patch(
    String endpoint, {
    dynamic body,
    Map<String, String>? headers,
  }) async {
    try {
      final uri = _buildUri(endpoint, null);
      final response = await http
          .patch(
            uri,
            headers: _buildHeaders(headers),
            body: body != null ? jsonEncode(body) : null,
          )
          .timeout(timeout);
      return _handleResponse(response);
    } catch (e) {
      return ApiResult.error(
        statusCode: 0,
        message: 'PATCH request failed: ${e.toString()}',
      );
    }
  }

  /// Sends a DELETE request to [endpoint].
  Future<ApiResult> delete(
    String endpoint, {
    Map<String, String>? headers,
  }) async {
    try {
      final uri = _buildUri(endpoint, null);
      final response = await http
          .delete(uri, headers: _buildHeaders(headers))
          .timeout(timeout);
      return _handleResponse(response);
    } catch (e) {
      return ApiResult.error(
        statusCode: 0,
        message: 'DELETE request failed: ${e.toString()}',
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /// Constructs a full [Uri] from the [baseUrl], [endpoint], and optional
  /// [queryParameters].
  Uri _buildUri(String endpoint, Map<String, dynamic>? queryParameters) {
    final uri = Uri.parse('$baseUrl$endpoint');
    if (queryParameters != null && queryParameters.isNotEmpty) {
      return uri.replace(
        queryParameters: queryParameters.map(
          (key, value) => MapEntry(key, value.toString()),
        ),
      );
    }
    return uri;
  }

  /// Merges default JSON headers with any [customHeaders].
  /// Automatically includes `Authorization: Bearer <authToken>` when
  /// [authToken] is set.
  Map<String, String> _buildHeaders(Map<String, String>? customHeaders) {
    final headers = <String, String>{
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    if (authToken != null && authToken!.isNotEmpty) {
      headers['Authorization'] = 'Bearer $authToken';
    }
    if (customHeaders != null) {
      headers.addAll(customHeaders);
    }
    return headers;
  }

  /// Converts an [http.Response] into an [ApiResult].
  ApiResult _handleResponse(http.Response response) {
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return ApiResult.success(
        statusCode: response.statusCode,
        data: _parseBody(response.body),
        rawBody: response.body,
      );
    } else {
      return ApiResult.error(
        statusCode: response.statusCode,
        message: 'Request failed with status ${response.statusCode}',
        data: _parseBody(response.body),
      );
    }
  }

  /// Tries to parse [body] as JSON; returns the raw string on failure.
  dynamic _parseBody(String body) {
    if (body.isEmpty) return null;
    try {
      return jsonDecode(body);
    } catch (_) {
      return body;
    }
  }
}
