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
