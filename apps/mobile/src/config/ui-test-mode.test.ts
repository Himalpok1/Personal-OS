import { afterEach, describe, expect, it, vi } from "vitest";

describe("UI test API isolation", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("rejects a non-development API origin in UI test mode", async () => {
    vi.stubEnv("EXPO_PUBLIC_UI_TEST_MODE", "true");
    const { assertUiTestApiIsolation } = await import("./ui-test-mode");

    expect(() => assertUiTestApiIsolation("https://example.com")).toThrow(
      "private-network development API",
    );
  });

  it("allows a development API origin in UI test mode", async () => {
    vi.stubEnv("EXPO_PUBLIC_UI_TEST_MODE", "true");
    const { assertUiTestApiIsolation } = await import("./ui-test-mode");

    expect(() => assertUiTestApiIsolation("http://192.168.1.220:3000")).not.toThrow();
  });
});

describe("UI test package isolation", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("refuses a UI-test bundle running inside the production package", async () => {
    vi.stubEnv("EXPO_PUBLIC_UI_TEST_MODE", "true");
    const { assertUiTestPackageIsolation, PRODUCTION_ANDROID_PACKAGE } = await import(
      "./ui-test-mode"
    );

    expect(() => assertUiTestPackageIsolation(PRODUCTION_ANDROID_PACKAGE)).toThrow(
      "would share SecureStore",
    );
  });

  it("refuses a production bundle running inside the UI-test package", async () => {
    vi.stubEnv("EXPO_PUBLIC_UI_TEST_MODE", "false");
    const { assertUiTestPackageIsolation, UI_TEST_ANDROID_PACKAGE } = await import(
      "./ui-test-mode"
    );

    expect(() => assertUiTestPackageIsolation(UI_TEST_ANDROID_PACKAGE)).toThrow(
      "Production mode is running inside the UI-test package",
    );
  });

  it("accepts each bundle inside its own package", async () => {
    vi.stubEnv("EXPO_PUBLIC_UI_TEST_MODE", "true");
    const uiTest = await import("./ui-test-mode");
    expect(() =>
      uiTest.assertUiTestPackageIsolation(uiTest.UI_TEST_ANDROID_PACKAGE),
    ).not.toThrow();

    vi.resetModules();
    vi.stubEnv("EXPO_PUBLIC_UI_TEST_MODE", "false");
    const prod = await import("./ui-test-mode");
    expect(() =>
      prod.assertUiTestPackageIsolation(prod.PRODUCTION_ANDROID_PACKAGE),
    ).not.toThrow();
  });

  it("no-ops on web, where applicationId is null", async () => {
    vi.stubEnv("EXPO_PUBLIC_UI_TEST_MODE", "true");
    const { assertUiTestPackageIsolation } = await import("./ui-test-mode");

    expect(() => assertUiTestPackageIsolation(null)).not.toThrow();
  });
});
