#!/usr/bin/env bash
# Compatibility entry point: installer construction is owned by GitHub Actions.
set -euo pipefail
cat >&2 <<'MESSAGE'
The standalone macOS release lane has been retired.
Start a cloud candidate build:
  gh workflow run release.yml --ref main -f sign_macos=false
For a signed release, merge the version preparation into main and push its
verified version tag. See docs/spec/06-delivery/06-release-runbook.md.
MESSAGE
exit 1
