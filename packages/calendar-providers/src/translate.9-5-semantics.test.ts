import { describe, expect, it } from "vitest";
import { googleAllDayToLocal, localAllDayToGoogle } from "./translate.js";

// Checkpoint 9.5 (Lane E): pure import-only pins of the all-day
// exclusive-end conversion the OUTBOUND push (Lane B) now relies on in the
// local -> Google direction for the first time. Lane B owns translate.ts;
// this file only reads its exports and must never need editing when the
// recurrence helpers next to them change.
//
// Google: `end.date` is EXCLUSIVE. Personal OS: `end_date` is INCLUSIVE.
// Checkpoint 8.6A floor: a Google event with end.date == start.date is a
// zero-length all-day event and converts to ONE local day, never to
// end_date < start_date (which the read models would render on no day).

describe("localAllDayToGoogle / googleAllDayToLocal round trips (9.5 outbound push)", () => {
  it("1-day span: local (d, d) -> Google (d, d+1) -> local (d, d)", () => {
    const google = localAllDayToGoogle("2026-09-14", "2026-09-14");
    expect(google).toEqual({ googleStartDate: "2026-09-14", googleEndDate: "2026-09-15" });
    expect(googleAllDayToLocal(google.googleStartDate, google.googleEndDate)).toEqual({
      startDate: "2026-09-14",
      endDate: "2026-09-14",
    });
  });

  it("3-day span: local (d, d+2) -> Google (d, d+3) -> local (d, d+2)", () => {
    const google = localAllDayToGoogle("2026-09-14", "2026-09-16");
    expect(google).toEqual({ googleStartDate: "2026-09-14", googleEndDate: "2026-09-17" });
    expect(googleAllDayToLocal(google.googleStartDate, google.googleEndDate)).toEqual({
      startDate: "2026-09-14",
      endDate: "2026-09-16",
    });
  });

  it("spans crossing a month end, a year end and Feb 29 stay exact in both directions", () => {
    for (const [start, end] of [
      ["2026-09-30", "2026-10-02"],
      ["2026-12-30", "2027-01-01"],
      ["2028-02-28", "2028-03-01"], // leap year: 3 local days (28, 29, 1)
      ["2026-02-27", "2026-03-01"], // common year: 3 local days (27, 28, 1)
    ] as const) {
      const google = localAllDayToGoogle(start, end);
      expect(
        googleAllDayToLocal(google.googleStartDate, google.googleEndDate),
        `${start}..${end}`,
      ).toEqual({ startDate: start, endDate: end });
    }
    expect(localAllDayToGoogle("2028-02-28", "2028-02-29").googleEndDate).toBe("2028-03-01");
    expect(localAllDayToGoogle("2026-02-28", "2026-02-28").googleEndDate).toBe("2026-03-01");
  });

  it("8.6A floor: Google end == start (zero-length) -> exactly one local day, never end_date < start_date", () => {
    const local = googleAllDayToLocal("2026-09-14", "2026-09-14");
    expect(local).toEqual({ startDate: "2026-09-14", endDate: "2026-09-14" });
    expect(local.endDate >= local.startDate).toBe(true);
  });

  it("8.6A floor: a Google end BEFORE start (malformed upstream) is also clamped to the start date", () => {
    const local = googleAllDayToLocal("2026-09-14", "2026-09-10");
    expect(local).toEqual({ startDate: "2026-09-14", endDate: "2026-09-14" });
  });

  it("the floor is one-way: re-pushing a floored one-day event produces the NORMAL (d, d+1) Google shape, not the zero-length one", () => {
    // Inbound zero-length -> local one day -> outbound one day. Round trip
    // through Google is therefore NOT identity for the degenerate input, by
    // design: Personal OS never emits a zero-length all-day event.
    const local = googleAllDayToLocal("2026-09-14", "2026-09-14");
    expect(localAllDayToGoogle(local.startDate, local.endDate)).toEqual({
      googleStartDate: "2026-09-14",
      googleEndDate: "2026-09-15",
    });
  });

  it("never passes through a Date instant: the output strings are the pure date arithmetic of the inputs", () => {
    // If either helper resolved through the host zone, a UTC-negative host
    // would show up as an off-by-one here. Assert byte-exact strings.
    expect(localAllDayToGoogle("2026-03-08", "2026-03-08").googleEndDate).toBe("2026-03-09"); // US spring-forward
    expect(localAllDayToGoogle("2026-11-01", "2026-11-01").googleEndDate).toBe("2026-11-02"); // US fall-back
    expect(googleAllDayToLocal("2026-03-08", "2026-03-09").endDate).toBe("2026-03-08");
    expect(googleAllDayToLocal("2026-11-01", "2026-11-02").endDate).toBe("2026-11-01");
  });

  it("rejects a non-YYYY-MM-DD input rather than silently producing a shifted date", () => {
    expect(() => localAllDayToGoogle("2026-09-14", "2026-09-14T00:00:00Z")).toThrow();
    expect(() => googleAllDayToLocal("2026-09-14", "20260915")).toThrow();
  });
});
