import { describe, expect, it } from "vitest";
import { isValidTimezone, resolveWallClockToInstant, toWallClockComponents } from "./timezone.js";

describe("isValidTimezone", () => {
  it("accepts a real IANA timezone", () => {
    expect(isValidTimezone("America/Chicago")).toBe(true);
  });

  it("rejects a bogus timezone", () => {
    expect(isValidTimezone("Not/A_Zone")).toBe(false);
  });
});

describe("resolveWallClockToInstant", () => {
  it("resolves a plain non-DST wall-clock time", () => {
    const result = resolveWallClockToInstant(
      { year: 2026, month: 7, day: 10, hour: 9, minute: 0, second: 0 },
      "America/Chicago",
    );
    // July = CDT = UTC-5
    expect(result.toISOString()).toBe("2026-07-10T14:00:00.000Z");
  });

  it("resolves an ambiguous DST fall-back time to the earlier (pre-transition) instant", () => {
    // Clocks in America/Chicago fall back from 02:00 to 01:00 on 2026-11-01,
    // so 01:30 occurs twice (once at CDT UTC-5, once at CST UTC-6).
    const result = resolveWallClockToInstant(
      { year: 2026, month: 11, day: 1, hour: 1, minute: 30, second: 0 },
      "America/Chicago",
    );
    expect(result.toISOString()).toBe("2026-11-01T06:30:00.000Z");
  });

  it("resolves a nonexistent DST spring-forward time deterministically", () => {
    // Clocks in America/Chicago spring forward from 02:00 to 03:00 on
    // 2026-03-08, so 02:30 never occurs.
    const result = resolveWallClockToInstant(
      { year: 2026, month: 3, day: 8, hour: 2, minute: 30, second: 0 },
      "America/Chicago",
    );
    expect(result.toISOString()).toBe("2026-03-08T07:30:00.000Z");
  });

  it("round-trips through toWallClockComponents for a plain instant", () => {
    const instant = resolveWallClockToInstant(
      { year: 2026, month: 5, day: 20, hour: 14, minute: 45, second: 0 },
      "America/Chicago",
    );
    const components = toWallClockComponents(instant, "America/Chicago");
    expect(components).toEqual({ year: 2026, month: 5, day: 20, hour: 14, minute: 45, second: 0 });
  });
});
