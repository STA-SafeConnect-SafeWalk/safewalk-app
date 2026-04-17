#!/bin/bash
#
# Generates ios/Runner/GoogleService-Info.plist from firebase.env.json.
# Called automatically by an Xcode Build Phase so that anyone cloning
# the repo only needs to supply firebase.env.json and build.
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$PROJECT_DIR/firebase.env.json"
OUTPUT_FILE="$SCRIPT_DIR/../Runner/GoogleService-Info.plist"

if [ ! -f "$ENV_FILE" ]; then
  echo "error: firebase.env.json not found at $ENV_FILE"
  echo "Copy firebase.env.json.template to firebase.env.json and fill in your values."
  exit 1
fi

# Parse values from firebase.env.json using python3 (ships with macOS)
read_json() {
  python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get(sys.argv[2],''))" "$ENV_FILE" "$1"
}

API_KEY=$(read_json "FIREBASE_IOS_API_KEY")
GCM_SENDER_ID=$(read_json "FIREBASE_SENDER_ID")
BUNDLE_ID=$(read_json "FIREBASE_IOS_BUNDLE_ID")
PROJECT_ID=$(read_json "FIREBASE_PROJECT_ID")
STORAGE_BUCKET=$(read_json "FIREBASE_STORAGE_BUCKET")
GOOGLE_APP_ID=$(read_json "FIREBASE_IOS_APP_ID")

cat > "$OUTPUT_FILE" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>API_KEY</key>
	<string>${API_KEY}</string>
	<key>GCM_SENDER_ID</key>
	<string>${GCM_SENDER_ID}</string>
	<key>PLIST_VERSION</key>
	<string>1</string>
	<key>BUNDLE_ID</key>
	<string>${BUNDLE_ID}</string>
	<key>PROJECT_ID</key>
	<string>${PROJECT_ID}</string>
	<key>STORAGE_BUCKET</key>
	<string>${STORAGE_BUCKET}</string>
	<key>IS_ADS_ENABLED</key>
	<false/>
	<key>IS_ANALYTICS_ENABLED</key>
	<false/>
	<key>IS_APPINVITE_ENABLED</key>
	<true/>
	<key>IS_GCM_ENABLED</key>
	<true/>
	<key>IS_SIGNIN_ENABLED</key>
	<true/>
	<key>GOOGLE_APP_ID</key>
	<string>${GOOGLE_APP_ID}</string>
</dict>
</plist>
EOF

echo "Generated GoogleService-Info.plist successfully."
