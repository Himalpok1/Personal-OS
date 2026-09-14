import { describe, expect, it } from "vitest";
import {
  DATE_TOKEN_MAX_YEAR,
  DATE_TOKEN_MIN_YEAR,
  addDays,
  daysInMonth,
  formatLocalDate,
  isLeapYear,
  parseDateToken,
  parseLocalDate,
} from "./date-tokens.js";

const TODAY = "2026-09-14";

describe("calendar helpers", () => {
  it("knows the leap-year rule including the century exceptions", () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
  });

  it("returns the right length for every month", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => daysInMonth(2026, m))).toEqual([
      31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
    ]);
    expect(daysInMonth(2024, 2)).toBe(29);
  });

  it("parses only real dates", () => {
    expect(parseLocalDate("2026-02-28")).toEqual({ year: 2026, month: 2, day: 28 });
    expect(parseLocalDate("2024-02-29")).toEqual({ year: 2024, month: 2, day: 29 });
    expect(parseLocalDate("2026-02-29")).toBeNull();
    expect(parseLocalDate("2026-02-30")).toBeNull();
    expect(parseLocalDate("2026-04-31")).toBeNull();
    expect(parseLocalDate("2026-13-01")).toBeNull();
    expect(parseLocalDate("2026-00-10")).toBeNull();
    expect(parseLocalDate("2026-9-14")).toBeNull();
    expect(parseLocalDate("20260914")).toBeNull();
    expect(parseLocalDate("")).toBeNull();
  });

  it("bounds the year to the supported range", () => {
    expect(parseLocalDate(`${DATE_TOKEN_MIN_YEAR}-01-01`)).not.toBeNull();
    expect(parseLocalDate(`${DATE_TOKEN_MAX_YEAR}-12-31`)).not.toBeNull();
    expect(parseLocalDate("1899-12-31")).toBeNull();
    expect(parseLocalDate("2100-01-01")).toBeNull();
    expect(parseLocalDate("0001-01-01")).toBeNull();
  });

  it("adds days by calendar arithmetic across month, year and leap boundaries", () => {
    expect(addDays("2026-09-14", 1)).toBe("2026-09-15");
    expect(addDays("2026-09-14", -1)).toBe("2026-09-13");
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("adds days on the DST transition days without an hour ever entering the picture", () => {
    // 2026-03-08 and 2026-11-01 are the US DST transitions; the result is a
    // calendar day either way, because nothing here is an instant.
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
  });

  it("refuses to add to a malformed date", () => {
    expect(() => addDays("2026-02-30", 1)).toThrow();
    expect(() => addDays("today", 1)).toThrow();
  });

  it("formats with zero padding", () => {
    expect(formatLocalDate(2026, 1, 5)).toBe("2026-01-05");
  });
});

describe("parseDateToken -- relative words", () => {
  it("today is a one-day window on today", () => {
    expect(parseDateToken("today", null, TODAY)).toEqual({
      token: "today",
      kind: "day",
      from: TODAY,
      to: TODAY,
      consumedNext: false,
    });
  });

  it("tomorrow and yesterday step one calendar day", () => {
    expect(parseDateToken("tomorrow", null, TODAY)).toMatchObject({
      kind: "day",
      from: "2026-09-15",
      to: "2026-09-15",
    });
    expect(parseDateToken("yesterday", null, TODAY)).toMatchObject({
      kind: "day",
      from: "2026-09-13",
      to: "2026-09-13",
    });
  });

  it("crosses a month and a year boundary by the calendar", () => {
    expect(parseDateToken("tomorrow", null, "2026-12-31")?.from).toBe("2027-01-01");
    expect(parseDateToken("yesterday", null, "2027-01-01")?.from).toBe("2026-12-31");
    expect(parseDateToken("tomorrow", null, "2024-02-28")?.from).toBe("2024-02-29");
  });

  it("is matched on the NFKC-lowercased word", () => {
    expect(parseDateToken("TODAY", null, TODAY)?.token).toBe("today");
    expect(parseDateToken("Tomorrow", null, TODAY)?.kind).toBe("day");
    // Full-width Latin letters fold to ASCII under NFKC.
    expect(parseDateToken("ｔｏｄａｙ", null, TODAY)?.token).toBe("today");
  });

  it("needs a valid today and returns null without one", () => {
    expect(parseDateToken("today", null, "")).toBeNull();
    expect(parseDateToken("tomorrow", null, "2026-02-30")).toBeNull();
    expect(parseDateToken("yesterday", null, "not-a-date")).toBeNull();
  });

  it("never consumes the next word", () => {
    expect(parseDateToken("today", "2026", TODAY)?.consumedNext).toBe(false);
  });
});

describe("parseDateToken -- ISO forms", () => {
  it("YYYY-MM-DD is a one-day window", () => {
    expect(parseDateToken("2026-10-01", null, TODAY)).toEqual({
      token: "2026-10-01",
      kind: "iso_date",
      from: "2026-10-01",
      to: "2026-10-01",
      consumedNext: false,
    });
  });

  it("rejects an impossible calendar date rather than rolling it", () => {
    expect(parseDateToken("2026-02-30", null, TODAY)).toBeNull();
    expect(parseDateToken("2026-02-29", null, TODAY)).toBeNull();
    expect(parseDateToken("2024-02-29", null, TODAY)?.kind).toBe("iso_date");
    expect(parseDateToken("2026-06-31", null, TODAY)).toBeNull();
  });

  it("YYYY-MM is the whole month", () => {
    expect(parseDateToken("2026-02", null, TODAY)).toEqual({
      token: "2026-02",
      kind: "iso_month",
      from: "2026-02-01",
      to: "2026-02-28",
      consumedNext: false,
    });
    expect(parseDateToken("2024-02", null, TODAY)?.to).toBe("2024-02-29");
    expect(parseDateToken("2026-12", null, TODAY)?.to).toBe("2026-12-31");
  });

  it("rejects an ISO month outside 01-12 or outside the year range", () => {
    expect(parseDateToken("2026-13", null, TODAY)).toBeNull();
    expect(parseDateToken("2026-00", null, TODAY)).toBeNull();
    expect(parseDateToken("1899-12", null, TODAY)).toBeNull();
    expect(parseDateToken("2100-01", null, TODAY)).toBeNull();
    expect(parseDateToken("2100-01-01", null, TODAY)).toBeNull();
  });

  it("does not need today", () => {
    expect(parseDateToken("2026-10-01", null, "")?.kind).toBe("iso_date");
    expect(parseDateToken("2026-10", null, "")?.kind).toBe("iso_month");
  });

  it("folds full-width digits under NFKC", () => {
    expect(parseDateToken("２０２６-１０-０１", null, TODAY)?.from).toBe("2026-10-01");
  });

  it("does not accept partial or padded variants", () => {
    expect(parseDateToken("2026-9-1", null, TODAY)).toBeNull();
    expect(parseDateToken("2026/10/01", null, TODAY)).toBeNull();
    expect(parseDateToken("10-01", null, TODAY)).toBeNull();
    expect(parseDateToken("2026-10-01T00:00:00Z", null, TODAY)).toBeNull();
  });
});

describe("parseDateToken -- month names", () => {
  const MONTHS: [string, number][] = [
    ["january", 1],
    ["february", 2],
    ["march", 3],
    ["april", 4],
    ["may", 5],
    ["june", 6],
    ["july", 7],
    ["august", 8],
    ["september", 9],
    ["october", 10],
    ["november", 11],
    ["december", 12],
  ];

  it("recognises every full month name in the current year", () => {
    for (const [name, month] of MONTHS) {
      const parsed = parseDateToken(name, null, TODAY);
      expect(parsed, name).toMatchObject({
        token: name,
        kind: "month",
        from: formatLocalDate(2026, month, 1),
        to: formatLocalDate(2026, month, daysInMonth(2026, month)),
        consumedNext: false,
      });
    }
  });

  it("recognises the three-letter abbreviations and 'sept'", () => {
    for (const [name, month] of MONTHS) {
      expect(parseDateToken(name.slice(0, 3), null, TODAY)?.from, name).toBe(
        formatLocalDate(2026, month, 1),
      );
    }
    expect(parseDateToken("sept", null, TODAY)).toMatchObject({
      token: "sept",
      kind: "month",
      from: "2026-09-01",
      to: "2026-09-30",
    });
  });

  it("does not recognise other prefixes or misspellings", () => {
    expect(parseDateToken("septe", null, TODAY)).toBeNull();
    expect(parseDateToken("octo", null, TODAY)).toBeNull();
    expect(parseDateToken("janu", null, TODAY)).toBeNull();
    expect(parseDateToken("ma", null, TODAY)).toBeNull();
  });

  it("a month without a year is the CURRENT year of today, even when that month is past", () => {
    expect(parseDateToken("january", null, TODAY)?.from).toBe("2026-01-01");
    expect(parseDateToken("december", null, "2027-03-01")?.to).toBe("2027-12-31");
  });

  it("february's length follows today's year", () => {
    expect(parseDateToken("feb", null, "2024-06-01")?.to).toBe("2024-02-29");
    expect(parseDateToken("feb", null, "2026-06-01")?.to).toBe("2026-02-28");
  });

  it("a month without a year needs today", () => {
    expect(parseDateToken("september", null, "")).toBeNull();
  });

  it("consumes a following 4-digit year and reports it in the token", () => {
    expect(parseDateToken("september", "2025", TODAY)).toEqual({
      token: "september 2025",
      kind: "month",
      from: "2025-09-01",
      to: "2025-09-30",
      consumedNext: true,
    });
    expect(parseDateToken("Feb", "2024", TODAY)).toMatchObject({
      token: "feb 2024",
      to: "2024-02-29",
      consumedNext: true,
    });
  });

  it("a month with an explicit year does not need today", () => {
    expect(parseDateToken("march", "2020", "")?.from).toBe("2020-03-01");
  });

  it("does not consume a next word that is not a 4-digit year", () => {
    expect(parseDateToken("september", "rent", TODAY)?.consumedNext).toBe(false);
    expect(parseDateToken("september", "26", TODAY)?.consumedNext).toBe(false);
    expect(parseDateToken("september", "1850", TODAY)?.consumedNext).toBe(false);
    expect(parseDateToken("september", "2100", TODAY)?.consumedNext).toBe(false);
    expect(parseDateToken("september", "20260", TODAY)?.consumedNext).toBe(false);
  });

  it("matches on the NFKC-lowercased word", () => {
    expect(parseDateToken("SEPTEMBER", null, TODAY)?.token).toBe("september");
    expect(parseDateToken("Oct", null, TODAY)?.from).toBe("2026-10-01");
  });
});

describe("parseDateToken -- bare years", () => {
  it("a 19xx or 20xx year is the whole year", () => {
    expect(parseDateToken("2026", null, TODAY)).toEqual({
      token: "2026",
      kind: "year",
      from: "2026-01-01",
      to: "2026-12-31",
      consumedNext: false,
    });
    expect(parseDateToken("1999", null, TODAY)?.from).toBe("1999-01-01");
    expect(parseDateToken("1900", null, TODAY)?.kind).toBe("year");
    expect(parseDateToken("2099", null, TODAY)?.kind).toBe("year");
  });

  it("does not recognise other 4-digit numbers, or other lengths", () => {
    expect(parseDateToken("1850", null, TODAY)).toBeNull();
    expect(parseDateToken("2100", null, TODAY)).toBeNull();
    expect(parseDateToken("3000", null, TODAY)).toBeNull();
    expect(parseDateToken("202", null, TODAY)).toBeNull();
    expect(parseDateToken("20260", null, TODAY)).toBeNull();
  });

  it("does not need today", () => {
    expect(parseDateToken("2026", null, "")?.kind).toBe("year");
  });

  it("folds full-width digits", () => {
    expect(parseDateToken("２０２６", null, TODAY)?.token).toBe("2026");
  });
});

describe("parseDateToken -- ordinary words", () => {
  it("returns null for anything outside the grammar", () => {
    for (const word of ["rent", "dentist", "next", "week", "monday", "q3", "2026-", "-2026", ""]) {
      expect(parseDateToken(word, null, TODAY), word).toBeNull();
    }
  });
});
