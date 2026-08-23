#!/usr/bin/env bash
# Build + install the side-by-side UI-test identity (com.himal.personalos.dev).
#
# Why this is a script and not a one-line `expo run:android`:
#
# `expo run:android` reuses an existing generated android/ directory. If that
# directory was last generated for the PRODUCTION identity, the UI-test env var
# does not retroactively change the already-written applicationId -- so the
# command cheerfully builds com.himal.personalos and tries to install it OVER
# the user's real production app. That happened for real during Checkpoint 5.6
# physical testing; only Android's signature check (production is EAS-signed,
# local builds use the debug keystore) stopped it, which is luck, not a design.
#
# So: always regenerate native for THIS identity first, then hard-assert the
# generated applicationId before anything is allowed to touch the device.
set -euo pipefail

# Run from the app directory regardless of the caller's cwd, so invoking the
# script directly behaves the same as `pnpm --filter mobile android:ui-test`.
cd "$(dirname "$0")/.."

DEV_PACKAGE="com.himal.personalos.dev"
export EXPO_PUBLIC_UI_TEST_MODE=true

echo "==> Regenerating android/ for the UI-test identity"
npx expo prebuild --platform android --clean

GENERATED=$(grep -oE "applicationId '[^']+'" android/app/build.gradle | head -1 | cut -d"'" -f2)
if [ "$GENERATED" != "$DEV_PACKAGE" ]; then
  echo "REFUSING TO INSTALL: generated applicationId is '$GENERATED', expected '$DEV_PACKAGE'." >&2
  echo "Installing this build could overwrite the production app. Aborting." >&2
  exit 1
fi
echo "==> Verified generated applicationId: $GENERATED"

npx expo run:android
