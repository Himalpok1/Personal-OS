import { describe, expect, it } from "vitest";
import {
  chunkRange,
  densifiableRange,
  hotWindow,
  lastGloballyCompleteDateExclusive,
  trailingWindow,
  warmWindow,
} from "./windows.js";

// 2026-08-24T19:00:00Z. Chosen deliberately: at this instant it is already
// 2026-08-25 in Kathmandu (+05:45) and still 2026-08-24 in Los Angeles
// (-07:00), so a UTC-only window would be wrong in both directions at once.
const NOW = new Date("2026-08-24T19:00:00Z");

describe("trailingWindow widening (ADR-048)", () => {
  it("widens one calendar day at each end, half-open", () => {
    // days=3 covers 08-22..08-24, widened to 08-21..08-25, so the EXCLUSIVE
    // end is 08-26. An end of today+1 would silently exclude today+1 itself --
    // the exact day the widening exists to capture.
    expect(trailingWindow(3, NOW)).toEqual({
      startDate: "2026-08-21",
      endDate: "2026-08-26",
    });
  });

  // Every real UTC offset lies within -12:00..+14:00, so a one-day widening at
  // each end provably contains any real local day.
  it("covers the ahead-of-UTC local day (Kathmandu +05:45 is already the 25th)", () => {
    const w = hotWindow(NOW);
    expect(w.startDate <= "2026-08-25").toBe(true);
    expect(w.endDate > "2026-08-25").toBe(true);
  });

  it("covers the extreme offsets in both directions (+14:00 and -12:00)", () => {
    const w = hotWindow(NOW);
    for (const localDay of ["2026-08-24", "2026-08-25"]) {
      expect(w.startDate <= localDay).toBe(true);
      expect(w.endDate > localDay).toBe(true);
    }
  });

  it("hot covers 3 days and warm 35, both widened", () => {
    expect(hotWindow(NOW)).toEqual({ startDate: "2026-08-21", endDate: "2026-08-26" });
    expect(warmWindow(NOW)).toEqual({ startDate: "2026-07-20", endDate: "2026-08-26" });
  });

  it("rejects a negative or fractional day count", () => {
    expect(() => trailingWindow(-1, NOW)).toThrow(/non-negative integer/);
    expect(() => trailingWindow(1.5, NOW)).toThrow(/non-negative integer/);
  });
});

describe("lastGloballyCompleteDateExclusive", () => {
  // At 19:00Z on the 24th, a user at -12:00 is still in their 24th (07:00
  // local), so the 24th is not yet knowably empty anywhere.
  it("excludes a day still running in the most-behind timezone", () => {
    expect(lastGloballyCompleteDateExclusive(NOW)).toBe("2026-08-24");
  });

  it("advances only once the day has ended even at -12:00", () => {
    // 12:00Z on the 25th == 00:00 on the 25th at -12:00, so the 24th has just
    // finished everywhere.
    expect(lastGloballyCompleteDateExclusive(new Date("2026-08-25T12:00:00Z"))).toBe("2026-08-25");
    // One minute earlier it has not.
    expect(lastGloballyCompleteDateExclusive(new Date("2026-08-25T11:59:00Z"))).toBe("2026-08-24");
  });
});

describe("densifiableRange", () => {
  const w = { startDate: "2026-08-21", endDate: "2026-08-26" };

  it("clamps the end to days that have finished in every timezone", () => {
    expect(densifiableRange(w, "2020-01-01", NOW)).toEqual({
      startDate: "2026-08-21",
      endDate: "2026-08-24",
    });
  });

  // The start edge is deliberately NOT clamped: chunks abut, so skipping each
  // chunk's first day would punch a hole at every backfill seam.
  it("does NOT skip the first day of the window", () => {
    expect(densifiableRange(w, "2020-01-01", NOW).startDate).toBe(w.startDate);
  });

  it("a fully historical backfill chunk is densifiable end to end", () => {
    const past = { startDate: "2026-01-01", endDate: "2026-03-01" };
    expect(densifiableRange(past, "2020-01-01", NOW)).toEqual(past);
  });

  it("clamps the start to firstDataDate (no invented pre-device history)", () => {
    expect(densifiableRange(w, "2026-08-23", NOW)).toEqual({
      startDate: "2026-08-23",
      endDate: "2026-08-24",
    });
  });

  it("densifies NOTHING when the stream has never returned data", () => {
    const r = densifiableRange(w, null, NOW);
    expect(r.startDate).toBe(r.endDate);
  });

  it("densifies nothing when firstDataDate is after the window", () => {
    const r = densifiableRange(w, "2027-01-01", NOW);
    expect(r.startDate).toBe(r.endDate);
  });

  it("densifies nothing when the whole window is still in flight", () => {
    const future = { startDate: "2026-08-25", endDate: "2026-08-27" };
    const r = densifiableRange(future, "2020-01-01", NOW);
    expect(r.startDate).toBe(r.endDate);
  });
});

describe("chunkRange", () => {
  it("walks backwards and abuts exactly, with no overlap and no gap", () => {
    const chunks = chunkRange(14, "2026-07-20", "2026-08-24");
    expect(chunks).toEqual([
      { startDate: "2026-08-10", endDate: "2026-08-24" },
      { startDate: "2026-07-27", endDate: "2026-08-10" },
      { startDate: "2026-07-20", endDate: "2026-07-27" },
    ]);
    for (let i = 1; i < chunks.length; i += 1) {
      expect(chunks[i]!.endDate).toBe(chunks[i - 1]!.startDate);
    }
  });

  it("never emits a chunk wider than maxRangeDays", () => {
    for (const c of chunkRange(14, "2024-01-01", "2026-08-24")) {
      const span =
        (Date.parse(c.endDate + "T00:00:00Z") - Date.parse(c.startDate + "T00:00:00Z")) / 86400000;
      expect(span).toBeLessThanOrEqual(14);
      expect(span).toBeGreaterThan(0);
    }
  });

  it("emits a single chunk when the range already fits", () => {
    expect(chunkRange(90, "2026-08-20", "2026-08-24")).toEqual([
      { startDate: "2026-08-20", endDate: "2026-08-24" },
    ]);
  });

  it("returns empty for an empty or inverted range", () => {
    expect(chunkRange(14, "2026-08-24", "2026-08-24")).toEqual([]);
    expect(chunkRange(14, "2026-08-24", "2026-08-20")).toEqual([]);
  });

  it("rejects a non-positive chunk size rather than looping forever", () => {
    expect(() => chunkRange(0, "2026-08-20", "2026-08-24")).toThrow(/positive integer/);
    expect(() => chunkRange(-5, "2026-08-20", "2026-08-24")).toThrow(/positive integer/);
  });
});
