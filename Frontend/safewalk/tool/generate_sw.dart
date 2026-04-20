// Generates platform-specific Firebase config files from firebase.env.json:
//   - web/firebase-messaging-sw.js  (Web service worker)
//   - android/app/google-services.json  (Android)
// Run via: dart run tool/generate_sw.dart
import 'dart:convert';
import 'dart:io';

void main() {
  final scriptDir = File(Platform.script.toFilePath()).parent;
  // Support running from project root or from tool/
  final projectRoot = scriptDir.path.endsWith('tool')
      ? scriptDir.parent
      : scriptDir;

  final envFile = File('${projectRoot.path}/firebase.env.json');
  if (!envFile.existsSync()) {
    stderr.writeln('Error: firebase.env.json not found at ${envFile.path}');
    exit(1);
  }

  final Map<String, dynamic> env;
  try {
    env = jsonDecode(envFile.readAsStringSync()) as Map<String, dynamic>;
  } catch (e) {
    stderr.writeln('Error: Failed to parse firebase.env.json: $e');
    exit(1);
  }

  _generateWebServiceWorker(projectRoot, env);
  _generateGoogleServicesJson(projectRoot, env);
}

void _generateWebServiceWorker(
    Directory projectRoot, Map<String, dynamic> env) {
  final template =
      File('${projectRoot.path}/web/firebase-messaging-sw.js.template');
  if (!template.existsSync()) {
    stderr.writeln(
        'Error: web/firebase-messaging-sw.js.template not found at ${template.path}');
    exit(1);
  }

  // Replace placeholders in order: longest/most-specific strings first to
  // avoid partial substitution (e.g. replace "YOUR_PROJECT_ID.firebaseapp.com"
  // before the bare "YOUR_PROJECT_ID").
  var content = template.readAsStringSync();
  content = content
      .replaceAll('YOUR_PROJECT_ID.firebaseapp.com',
          env['FIREBASE_AUTH_DOMAIN'] as String)
      .replaceAll('YOUR_PROJECT_ID.firebasestorage.app',
          env['FIREBASE_STORAGE_BUCKET'] as String)
      .replaceAll('YOUR_PROJECT_ID', env['FIREBASE_PROJECT_ID'] as String)
      .replaceAll('YOUR_WEB_API_KEY', env['FIREBASE_WEB_API_KEY'] as String)
      .replaceAll('YOUR_SENDER_ID', env['FIREBASE_SENDER_ID'] as String)
      .replaceAll('YOUR_WEB_APP_ID', env['FIREBASE_WEB_APP_ID'] as String);

  final output = File('${projectRoot.path}/web/firebase-messaging-sw.js');
  output.writeAsStringSync(content);
  stdout.writeln('Generated ${output.path}');
}

void _generateGoogleServicesJson(
    Directory projectRoot, Map<String, dynamic> env) {
  final projectId = env['FIREBASE_PROJECT_ID'] as String;
  final senderId = env['FIREBASE_SENDER_ID'] as String;
  final storageBucket = env['FIREBASE_STORAGE_BUCKET'] as String;
  final androidApiKey = env['FIREBASE_ANDROID_API_KEY'] as String;
  final androidAppId = env['FIREBASE_ANDROID_APP_ID'] as String;

  // Derive the Android package name from build.gradle.kts so this script
  // never needs to be updated when the package name changes.
  final buildGradle = File(
      '${projectRoot.path}/android/app/build.gradle.kts');
  String packageName = 'com.example.safewalk'; // safe fallback
  if (buildGradle.existsSync()) {
    final match = RegExp(r'applicationId\s*=\s*"([^"]+)"')
        .firstMatch(buildGradle.readAsStringSync());
    if (match != null) packageName = match.group(1)!;
  }

  final googleServices = {
    'project_info': {
      'project_number': senderId,
      'project_id': projectId,
      'storage_bucket': storageBucket,
    },
    'client': [
      {
        'client_info': {
          'mobilesdk_app_id': androidAppId,
          'android_client_info': {'package_name': packageName},
        },
        'oauth_client': <dynamic>[],
        'api_key': [
          {'current_key': androidApiKey}
        ],
        'services': {
          'appinvite_service': {
            'other_platform_oauth_client': <dynamic>[]
          }
        },
      }
    ],
    'configuration_version': '1',
  };

  final output =
      File('${projectRoot.path}/android/app/google-services.json');
  output.writeAsStringSync(
      const JsonEncoder.withIndent('  ').convert(googleServices));
  stdout.writeln('Generated ${output.path}');
}
