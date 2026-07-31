#!/bin/bash
set -euo pipefail

readonly expected_identity="7F9A56793C16683742AA7818FE65221A884FA108"
readonly expected_application_id="9NN976MFZ4.io.github.mat4m0.gwonmac"
readonly expected_team_id="9NN976MFZ4"
readonly bundle_id="io.github.mat4m0.gwonmac"

profile="${GW_KEYCHAIN_PHASE0_PROFILE:-}"
if [[ -z "$profile" || ! -f "$profile" ]]; then
  echo "GW_KEYCHAIN_PHASE0_PROFILE must name the G2 Developer ID profile" >&2
  exit 64
fi

keychain="${GW_KEYCHAIN_PHASE0_KEYCHAIN:-$(security default-keychain -d user | tr -d '"[:space:]')}"
if [[ ! -f "$keychain" ]]; then
  echo "signing keychain not found: $keychain" >&2
  exit 64
fi

identities="$(security find-identity -v -p codesigning "$keychain")"
if ! grep -Fq "$expected_identity" <<< "$identities"; then
  echo "the expected G2 Developer ID identity is not valid in $keychain" >&2
  exit 1
fi

work="$(mktemp -d /private/tmp/gwonmac-keychain-phase0.XXXXXX)"
cleanup_executable=""

cleanup_synthetic_item() {
  if [[ -z "$cleanup_executable" || ! -x "$cleanup_executable" ]]; then
    return
  fi

  "$cleanup_executable" reset >/dev/null 2>&1 &
  local command_pid=$!
  (
    sleep 5
    kill -TERM "$command_pid" 2>/dev/null || true
  ) &
  local watchdog_pid=$!
  wait "$command_pid" 2>/dev/null || true
  kill "$watchdog_pid" 2>/dev/null || true
  wait "$watchdog_pid" 2>/dev/null || true
}

cleanup() {
  cleanup_synthetic_item
  if [[ "$work" == /private/tmp/gwonmac-keychain-phase0.* ]]; then
    rm -rf "$work"
  fi
}
trap cleanup EXIT

decoded_profile="$work/profile.plist"
security cms -D -i "$profile" -k "$keychain" > "$decoded_profile"

profile_value() {
  /usr/libexec/PlistBuddy -c "Print :$1" "$decoded_profile"
}

profile_uuid="$(profile_value UUID)"
profile_application_id="$(profile_value Entitlements:com.apple.application-identifier)"
profile_entitlement_team="$(profile_value Entitlements:com.apple.developer.team-identifier)"
profile_team="$(profile_value TeamIdentifier:0)"
profile_ttl="$(profile_value TimeToLive)"

if [[ "$profile_application_id" != "$expected_application_id" ]]; then
  echo "profile has unexpected application identifier $profile_application_id" >&2
  exit 1
fi
if [[ "$profile_entitlement_team" != "$expected_team_id" ||
      "$profile_team" != "$expected_team_id" ]]; then
  echo "profile has an unexpected Team ID" >&2
  exit 1
fi
if [[ "$(profile_value ProvisionsAllDevices)" != "true" ]]; then
  echo "profile is not a Developer ID distribution profile" >&2
  exit 1
fi
if /usr/libexec/PlistBuddy -c "Print :ProvisionedDevices" "$decoded_profile" >/dev/null 2>&1; then
  echo "profile unexpectedly contains a device list" >&2
  exit 1
fi
if /usr/libexec/PlistBuddy -c "Print :Entitlements:get-task-allow" "$decoded_profile" >/dev/null 2>&1; then
  echo "profile unexpectedly contains get-task-allow" >&2
  exit 1
fi
if (( profile_ttl < 3650 )); then
  echo "profile lifetime is shorter than ten years" >&2
  exit 1
fi

echo "profile UUID=$profile_uuid"
echo "profile application-identifier=$profile_application_id"
echo "profile expires=$(profile_value ExpirationDate)"

profile_certificate="$work/profile-certificate.der"
plutil -extract DeveloperCertificates.0 raw -o - "$decoded_profile" |
  base64 --decode > "$profile_certificate"
profile_fingerprint="$(
  openssl x509 -inform DER -in "$profile_certificate" -noout -fingerprint -sha1 |
    cut -d= -f2 | tr -d ':'
)"
if [[ "$profile_fingerprint" != "$expected_identity" ]]; then
  echo "profile contains unexpected certificate $profile_fingerprint" >&2
  exit 1
fi
echo "profile certificate SHA-1=$profile_fingerprint"

entitlements="$work/release-entitlements.plist"
cat > "$entitlements" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.application-identifier</key>
  <string>$expected_application_id</string>
  <key>com.apple.developer.team-identifier</key>
  <string>$expected_team_id</string>
</dict>
</plist>
PLIST

adhoc_entitlements="$work/adhoc-entitlements.plist"
cat > "$adhoc_entitlements" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
</dict>
</plist>
PLIST

binary="$work/keychain-phase0"
xcrun clang \
  -fobjc-arc \
  -Wall -Wextra -Werror \
  -framework Foundation \
  -framework LocalAuthentication \
  -framework Security \
  tests/macos/keychain-phase0.m \
  -o "$binary"

make_app() {
  local destination="$1"
  local version="$2"
  mkdir -p "$destination/Contents/MacOS"
  cp "$binary" "$destination/Contents/MacOS/keychain-phase0"
  cp "$profile" "$destination/Contents/embedded.provisionprofile"
  cat > "$destination/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>keychain-phase0</string>
  <key>CFBundleIdentifier</key>
  <string>$bundle_id</string>
  <key>CFBundleName</key>
  <string>gwonmac Keychain Phase 0</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleVersion</key>
  <string>$version</string>
  <key>LSBackgroundOnly</key>
  <true/>
</dict>
</plist>
PLIST
}

sign_official() {
  local app="$1"
  local label="$2"
  codesign --force \
    --sign "$expected_identity" \
    --keychain "$keychain" \
    --options runtime \
    --timestamp \
    --entitlements "$entitlements" \
    "$app"
  codesign --verify --deep --strict --verbose=2 "$app"

  local actual_entitlements="$work/$label-entitlements.plist"
  local actual_entitlements_json="$work/$label-entitlements.json"
  local expected_entitlements_json="$work/$label-expected-entitlements.json"
  codesign -d --entitlements - --xml "$app" > "$actual_entitlements"
  plutil -convert json -o "$actual_entitlements_json" "$actual_entitlements"
  plutil -convert json -o "$expected_entitlements_json" "$entitlements"
  node - "$actual_entitlements_json" "$expected_entitlements_json" <<'NODE'
const assert = require("node:assert/strict");
const fs = require("node:fs");
const [actualPath, expectedPath] = process.argv.slice(2);
const read = (path) => JSON.parse(fs.readFileSync(path, "utf8"));
assert.deepStrictEqual(read(actualPath), read(expectedPath), "unexpected signed entitlements");
NODE

  local signature
  signature="$(codesign -dv --verbose=4 "$app" 2>&1)"
  if ! grep -Fq "Identifier=$bundle_id" <<< "$signature" ||
     ! grep -Fq "TeamIdentifier=$expected_team_id" <<< "$signature"; then
    echo "$label has an unexpected signed identity" >&2
    exit 1
  fi
  echo "$label signed identifier=$bundle_id team=$expected_team_id"
}

run_bounded() {
  local executable="$1"
  local operation="$2"
  "$executable" "$operation" &
  local command_pid=$!
  (
    sleep 5
    kill -TERM "$command_pid" 2>/dev/null || true
  ) &
  local watchdog_pid=$!

  local status=0
  wait "$command_pid" || status=$?
  kill "$watchdog_pid" 2>/dev/null || true
  wait "$watchdog_pid" 2>/dev/null || true
  if [[ "$status" -ne 0 ]]; then
    echo "$operation failed or exceeded the five-second deadline (status $status)" >&2
    return "$status"
  fi
}

app_a="$work/build-a/gwonmac Keychain Phase 0.app"
make_app "$app_a" 1
sign_official "$app_a" build-a
official_a="$app_a/Contents/MacOS/keychain-phase0"
cleanup_executable="$official_a"

echo "testing create, relaunch read, update, and relaunch read"
run_bounded "$official_a" reset
run_bounded "$official_a" add-v1
run_bounded "$official_a" read-v1
run_bounded "$official_a" update-v2
run_bounded "$official_a" read-v2

moved_app="$work/moved/gwonmac Keychain Phase 0.app"
mkdir -p "$(dirname "$moved_app")"
cp -R "$app_a" "$moved_app"
echo "testing the same signed app from a different directory"
run_bounded "$moved_app/Contents/MacOS/keychain-phase0" read-v2

app_b="$work/build-b/gwonmac Keychain Phase 0.app"
make_app "$app_b" 2
sign_official "$app_b" build-b
cleanup_executable="$app_b/Contents/MacOS/keychain-phase0"
echo "testing a newly signed build with the same permanent identity"
run_bounded "$app_b/Contents/MacOS/keychain-phase0" read-v2

adhoc_app="$work/adhoc/gwonmac Keychain Phase 0.app"
mkdir -p "$(dirname "$adhoc_app")"
cp -R "$app_b" "$adhoc_app"
rm "$adhoc_app/Contents/embedded.provisionprofile"
codesign --force --sign - --options runtime \
  --entitlements "$adhoc_entitlements" "$adhoc_app"
codesign --verify --deep --strict --verbose=2 "$adhoc_app"
echo "testing that an ad-hoc build cannot read the official item"
run_bounded "$adhoc_app/Contents/MacOS/keychain-phase0" expect-inaccessible

echo "deleting the synthetic item and proving it is gone"
run_bounded "$app_b/Contents/MacOS/keychain-phase0" delete
run_bounded "$app_b/Contents/MacOS/keychain-phase0" expect-inaccessible

echo "Phase 0 passed. Confirm that no authentication or Keychain dialog appeared."
