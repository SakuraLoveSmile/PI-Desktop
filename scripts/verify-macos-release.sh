#!/usr/bin/env bash
# Verify macOS package integrity, or Developer ID/notarization qualification.

set -euo pipefail

PRODUCT_NAME="Pi-Desktop-Plus"

verify_bundle_integrity() {
  local app="$1"
  local host_core="$app/Contents/Resources/bin/pi-desktop-host-core"
  if [[ ! -d "$app" || ! -f "$app/Contents/_CodeSignature/CodeResources" ]]; then
    echo "error: missing app resource seal: $app" >&2
    return 1
  fi
  if [[ ! -f "$host_core" ]]; then
    echo "error: missing host-core sidecar at $host_core" >&2
    return 1
  fi
  echo "==> Verifying bundle and host-core integrity: $app"
  codesign --verify --deep --strict --verbose=2 "$app"
  codesign --verify --strict --verbose=2 "$host_core"
}

if [[ "${1:-}" == "--integrity-only" ]]; then
  RELEASE_DIR="${2:-apps/desktop/release}"
  shopt -s nullglob
  APPS=("$RELEASE_DIR"/mac*/"$PRODUCT_NAME".app)
  DMGS=("$RELEASE_DIR"/*.dmg)
  ZIPS=("$RELEASE_DIR"/*.zip)
  if [[ "${#APPS[@]}" -ne 1 || "${#DMGS[@]}" -ne 1 || "${#ZIPS[@]}" -ne 1 ]]; then
    echo "error: expected exactly one app, DMG and ZIP under $RELEASE_DIR." >&2
    exit 1
  fi

  verify_bundle_integrity "${APPS[0]}"
  SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/pi-macos-release.XXXXXX")"
  MOUNT_DIR="$SCRATCH/dmg"
  DMG_ATTACH_ATTEMPTED=false
  cleanup() {
    local status=$?
    trap - EXIT
    if [[ "$DMG_ATTACH_ATTEMPTED" == true ]]; then
      if ! hdiutil detach "$MOUNT_DIR"; then
        echo "error: unable to detach DMG; retained verification files at $SCRATCH" >&2
        exit 1
      fi
    fi
    rm -rf "$SCRATCH"
    if [[ "$status" -eq 0 ]]; then
      echo "==> macOS app, ZIP and DMG integrity passed (no notarization assessment)."
    fi
    exit "$status"
  }
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  echo "==> Verifying the application extracted from ${ZIPS[0]}"
  ditto -x -k "${ZIPS[0]}" "$SCRATCH/zip"
  ZIP_APPS=("$SCRATCH"/zip/*.app)
  if [[ "${#ZIP_APPS[@]}" -ne 1 ]]; then
    echo "error: expected exactly one application in the ZIP." >&2
    exit 1
  fi
  verify_bundle_integrity "$SCRATCH/zip/$PRODUCT_NAME.app"

  echo "==> Verifying the application inside ${DMGS[0]}"
  mkdir "$MOUNT_DIR"
  DMG_ATTACH_ATTEMPTED=true
  hdiutil attach -readonly -nobrowse -mountpoint "$MOUNT_DIR" "${DMGS[0]}"
  DMG_APPS=("$MOUNT_DIR"/*.app)
  if [[ "${#DMG_APPS[@]}" -ne 1 ]]; then
    echo "error: expected exactly one application in the DMG." >&2
    exit 1
  fi
  verify_bundle_integrity "$MOUNT_DIR/$PRODUCT_NAME.app"
  exit 0
fi

RELEASE_DIR="${1:-apps/desktop/release}"
# Accepts either the bare common name or the full certificate label.
IDENTITY_NAME="${MAC_SIGNING_IDENTITY:-}"
IDENTITY_NAME="${IDENTITY_NAME#Developer ID Application: }"
EXPECTED_IDENTITY="Developer ID Application: ${IDENTITY_NAME}"
EXPECTED_TEAM_ID="${APPLE_TEAM_ID:-}"

if [[ -z "$IDENTITY_NAME" || -z "$EXPECTED_TEAM_ID" ]]; then
  echo "error: MAC_SIGNING_IDENTITY and APPLE_TEAM_ID are required." >&2
  exit 1
fi

if [[ ! -d "$RELEASE_DIR" ]]; then
  echo "error: release directory does not exist: $RELEASE_DIR" >&2
  exit 1
fi

shopt -s nullglob
APPS=("$RELEASE_DIR"/mac*/"$PRODUCT_NAME".app)
DMGS=("$RELEASE_DIR"/*.dmg)

if [[ "${#APPS[@]}" -ne 1 ]]; then
  echo "error: expected exactly one $PRODUCT_NAME.app under $RELEASE_DIR/mac*/." >&2
  exit 1
fi

if [[ "${#DMGS[@]}" -ne 1 ]]; then
  echo "error: expected exactly one DMG under $RELEASE_DIR/." >&2
  exit 1
fi

APP="${APPS[0]}"
DMG="${DMGS[0]}"
HOST_CORE="$APP/Contents/Resources/bin/pi-desktop-host-core"

echo "==> Inspecting Developer ID signature: $APP"
SIGNATURE_INFO="$(codesign -dv --verbose=4 "$APP" 2>&1)"
printf '%s\n' "$SIGNATURE_INFO"
if [[ "$SIGNATURE_INFO" != *"Authority=${EXPECTED_IDENTITY}"* ]]; then
  echo "error: $APP is not signed with $EXPECTED_IDENTITY." >&2
  exit 1
fi
if [[ "$SIGNATURE_INFO" != *"TeamIdentifier=${EXPECTED_TEAM_ID}"* ]]; then
  echo "error: $APP is not signed for Apple team $EXPECTED_TEAM_ID." >&2
  exit 1
fi
if [[ "$SIGNATURE_INFO" != *"flags=0x10000(runtime)"* && "$SIGNATURE_INFO" != *"flags=runtime"* && "$SIGNATURE_INFO" != *"runtime"* ]]; then
  echo "warning: hardened runtime flag not found in codesign -dv output; continuing with --deep --strict."
fi

echo "==> Verifying code-signing integrity: $APP"
codesign --verify --deep --strict --verbose=2 "$APP"

if [[ -f "$HOST_CORE" ]]; then
  echo "==> Verifying host-core sidecar signature: $HOST_CORE"
  codesign --verify --strict --verbose=2 "$HOST_CORE"
else
  echo "error: missing host-core sidecar at $HOST_CORE" >&2
  exit 1
fi

echo "==> Assessing Gatekeeper notarization: $APP"
ASSESSMENT="$(spctl --assess --type execute --verbose=4 "$APP" 2>&1)"
printf '%s\n' "$ASSESSMENT"
if [[ "$ASSESSMENT" != *"source=Notarized Developer ID"* ]]; then
  echo "error: Gatekeeper did not recognize $APP as notarized." >&2
  exit 1
fi

echo "==> Validating stapled notarization tickets"
xcrun stapler validate "$APP"
xcrun stapler validate "$DMG"

echo "==> macOS release verification passed: $APP and $DMG"
