import { describe, expect, it } from "vitest";
import { formatShortDateTime } from "./format-datetime";

// This function delegates straight to the runtime's own Intl formatting
// with no injectable locale/zone -- kept exactly as it was in
// projects/[id].tsx before Checkpoint 10.5 moved it here for reuse, since
// this checkpoint's scope was sharing the existing implementation, not
// redesigning it (unlike components/academic/format.ts's formatters, whose
// tests pin an explicit locale/timeZone). The exact digits therefore depend
// on the machine's own locale and timezone, the same caveat
// academic-today-card.test.tsx records for its own raw device-zone callers
// -- so this test proves the delegation (the same instant, the same
// options), not one specific rendered string.
function expected(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

describe("formatShortDateTime", () => {
  it("formats an instant with month, day, hour and minute in the device's own locale/zone", () => {
    const iso = "2026-09-22T14:30:00.000Z";
    expect(formatShortDateTime(iso)).toBe(expected(iso));
  });

  it("passes a second instant through the same way", () => {
    const iso = "2026-01-05T03:05:00.000Z";
    expect(formatShortDateTime(iso)).toBe(expected(iso));
  });
});
