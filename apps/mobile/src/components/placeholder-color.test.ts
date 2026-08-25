import { describe, expect, it, vi } from "vitest";
import { PLACEHOLDER_DARK, PLACEHOLDER_LIGHT, usePlaceholderColor } from "./placeholder-color";

// Importing this module used to take the WHOLE suite file down rather than
// failing an assertion: it reaches `nativewind`, whose published entry point
// the mobile vitest transform cannot parse (`SyntaxError: Unexpected token
// 'typeof'`), so two unrelated suites collapsed the moment a screen started
// importing it. The alias in vitest.config.mts fixes that, and this file is
// the guard -- if the alias is ever dropped, this fails first and names why.
describe("usePlaceholderColor", () => {
  it("loads at all under the mobile test environment", () => {
    expect(typeof usePlaceholderColor).toBe("function");
  });

  it("returns the light value by default", () => {
    expect(usePlaceholderColor()).toBe(PLACEHOLDER_LIGHT);
  });

  it("returns the dark value when the scheme is dark", async () => {
    vi.resetModules();
    vi.doMock("nativewind", () => ({
      useColorScheme: () => ({ colorScheme: "dark" as const }),
    }));
    const mod = await import("./placeholder-color");
    expect(mod.usePlaceholderColor()).toBe(PLACEHOLDER_DARK);
    vi.doUnmock("nativewind");
    vi.resetModules();
  });

  it("keeps the two values distinct, which is the whole point", () => {
    // A single value cannot clear 4.5:1 against both a white and a near-black
    // surface, so collapsing these would silently reintroduce the contrast bug.
    expect(PLACEHOLDER_LIGHT).not.toBe(PLACEHOLDER_DARK);
  });
});
