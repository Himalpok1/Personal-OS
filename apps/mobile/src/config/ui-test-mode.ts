export const UI_TEST_MODE = process.env.EXPO_PUBLIC_UI_TEST_MODE === "true";

function isPrivateDevelopmentHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1") return true;

  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) return false;

  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

export function assertUiTestApiIsolation(apiUrl: string): void {
  if (!UI_TEST_MODE) return;

  let hostname: string;
  try {
    hostname = new URL(apiUrl).hostname;
  } catch {
    throw new Error("UI test mode requires an explicit valid development API URL");
  }

  if (!isPrivateDevelopmentHost(hostname)) {
    throw new Error("UI test mode requires a loopback or private-network development API");
  }
}

// The runtime flag (this module, inlined by Metro from EXPO_PUBLIC_UI_TEST_MODE)
// and the build-time Android applicationId (app.config.ts) are read from the
// same env var but resolved independently -- nothing has ever asserted they
// agree. They must, because device-identity/storage.ts uses the SAME SecureStore
// key names in both builds: isolation between the UI-test identity and the real
// one rests ENTIRELY on the differing applicationId giving each its own Android
// sandbox. A UI-test JS bundle running inside the production package (a stale
// Metro cache, a mismatched export) would therefore read and overwrite the
// production device's bearer token.
//
// Pure so it stays testable under plain vitest; the caller injects the native
// value. `applicationId` is null on web, where the whole concern is moot.
export const UI_TEST_ANDROID_PACKAGE = "com.himal.personalos.dev";
export const PRODUCTION_ANDROID_PACKAGE = "com.himal.personalos";

export function assertUiTestPackageIsolation(applicationId: string | null): void {
  if (applicationId === null) return;

  if (UI_TEST_MODE && applicationId === PRODUCTION_ANDROID_PACKAGE) {
    throw new Error(
      "UI test mode is running inside the production package -- refusing to start, " +
        "as this would share SecureStore with the real device identity",
    );
  }

  if (!UI_TEST_MODE && applicationId === UI_TEST_ANDROID_PACKAGE) {
    throw new Error(
      "Production mode is running inside the UI-test package -- refusing to start",
    );
  }
}
