import { describe, expect, it } from "vitest";
import { formatInstantWithOffset, parseFlexibleDatetime } from "./timezone.js";

// Checkpoint 8.4. The date/time pickers produce an instant; the task
// contracts accept an offset-less datetime and would resolve it against some
// other timezone, so the offset has to be carried explicitly.
describe("formatInstantWithOffset", () => {
  it("carries the zone's standard-time offset", () => {
    // 2026-01-15 09:30 America/Chicago = CST, UTC-6.
    const instant = new Date("2026-01-15T15:30:00Z");
    expect(formatInstantWithOffset(instant, "America/Chicago")).toBe("2026-01-15T09:30:00-06:00");
  });

  it("carries the zone's daylight-time offset for the same zone", () => {
    // 2026-07-15 10:30 America/Chicago = CDT, UTC-5. The offset must follow
    // the instant, not a fixed per-zone constant.
    const instant = new Date("2026-07-15T15:30:00Z");
    expect(formatInstantWithOffset(instant, "America/Chicago")).toBe("2026-07-15T10:30:00-05:00");
  });

  it("handles positive offsets and a whole-hour zone east of UTC", () => {
    expect(formatInstantWithOffset(new Date("2026-03-01T00:00:00Z"), "Europe/Berlin")).toBe(
      "2026-03-01T01:00:00+01:00",
    );
  });

  it("handles a half-hour offset", () => {
    expect(formatInstantWithOffset(new Date("2026-03-01T00:00:00Z"), "Asia/Kolkata")).toBe(
      "2026-03-01T05:30:00+05:30",
    );
  });

  it("handles a three-quarter-hour offset", () => {
    expect(formatInstantWithOffset(new Date("2026-03-01T00:00:00Z"), "Asia/Kathmandu")).toBe(
      "2026-03-01T05:45:00+05:45",
    );
  });

  it("emits +00:00 for UTC itself", () => {
    expect(formatInstantWithOffset(new Date("2026-03-01T12:00:00Z"), "UTC")).toBe(
      "2026-03-01T12:00:00+00:00",
    );
  });

  it("round-trips back to the same instant through parseFlexibleDatetime", () => {
    // The property that actually matters: whatever the picker chose is the
    // instant the server stores, regardless of which zone parses it.
    for (const iso of ["2026-01-15T15:30:00Z", "2026-07-15T15:30:00Z", "2026-11-01T06:30:00Z"]) {
      const instant = new Date(iso);
      const formatted = formatInstantWithOffset(instant, "America/Chicago");
      // An explicit offset means the fallback zone is irrelevant -- pass a
      // deliberately different one to prove it.
      expect(parseFlexibleDatetime(formatted, "Pacific/Auckland").getTime()).toBe(
        instant.getTime(),
      );
    }
  });

  it("pads a four-digit year and single-digit components", () => {
    expect(formatInstantWithOffset(new Date("2026-03-05T09:07:03Z"), "UTC")).toBe(
      "2026-03-05T09:07:03+00:00",
    );
  });
});
