// Pins the fix for the live bug where flipping a timed week-grid slot to
// All-day seeded the WRONG calendar date whenever the device's local
// timezone offset carries an instant's local date across the UTC date
// boundary -- e.g. a 19:00 America/Chicago slot (UTC-5) landed one day LATE,
// and a 06:00 Pacific/Auckland slot (UTC+13) landed one day EARLY. See the
// comment on `deriveAllDaySeedDates` in `./all-day-seed.ts` for the root cause.
//
// process.env.TZ is pinned below, following the convention in
// `calendar/grid-math.test.ts` and `calendar/week-grid-layout.test.ts`.
// This matters for more than determinism: under TZ=UTC an instant's local
// date and its UTC-sliced date are identical, so the pre-fix implementation
// would PASS every assertion here. Pinning a negative-offset zone is what
// makes an ordinary `pnpm test` actually catch a regression, rather than
// only the manual multi-zone sweep. (A positive-offset zone -- the
// Pacific/Auckland mirror image, where the naive slice lands one day EARLY
// rather than one day LATE -- is covered by running this file under
// TZ=Pacific/Auckland from the shell; see docs/STATUS.md.)
//
// Expected local dates are still derived independently via
// `Intl.DateTimeFormat` with an explicit `timeZone`, which shares no code
// path with `formatLocalDate`'s getFullYear/getMonth/getDate -- so the test
// cannot tautologically pass by repeating the implementation's own bug.
import { describe, expect, it } from "vitest";
import { deriveAllDaySeedDates } from "./all-day-seed";

// Set after imports: execution order is what matters, since the code under
// test reads the system zone per call rather than at import time.
// `||` not `??` -- an empty TZ_OVERRIDE must fall through to the default.
process.env.TZ = process.env["TZ_OVERRIDE"] || "America/Chicago";

const runningTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Ground truth: the calendar date `iso` falls on on the process's own local zone. */
function expectedLocalDate(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: runningTz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

describe(`deriveAllDaySeedDates (running under TZ=${runningTz})`, () => {
  it("derives the LOCAL calendar date from startsAt, not the UTC date", () => {
    // 19:00 America/Chicago (UTC-5, CDT) on 2026-08-23 serializes to
    // 2026-08-24T00:00:00.000Z -- one calendar day later in UTC. Under
    // TZ=America/Chicago this instant's local date must come back
    // 2026-08-23, not the UTC-sliced 2026-08-24.
    const startsAt = "2026-08-24T00:00:00.000Z";
    const result = deriveAllDaySeedDates({ startsAt });
    expect(result.startDate).toBe(expectedLocalDate(startsAt));
    // The whole point: it must NOT be the UTC slice. Asserted explicitly so
    // the test still says something if the ground-truth helper ever drifts.
    if (expectedLocalDate(startsAt) !== startsAt.slice(0, 10)) {
      expect(result.startDate).not.toBe(startsAt.slice(0, 10));
    }
  });

  it("derives the LOCAL calendar date for an early-morning slot near the UTC day boundary", () => {
    // 06:00 Pacific/Auckland (UTC+13, NZST) on 2026-08-24 serializes to
    // 2026-08-23T17:00:00.000Z -- the PRECEDING UTC calendar date. Under
    // TZ=Pacific/Auckland this instant's local date must come back
    // 2026-08-24, not the UTC-sliced 2026-08-23.
    const startsAt = "2026-08-23T17:00:00.000Z";
    const result = deriveAllDaySeedDates({ startsAt });
    expect(result.startDate).toBe(expectedLocalDate(startsAt));
  });

  it("falls back endDate to endsAt's local date when both are given", () => {
    const startsAt = "2026-08-24T00:00:00.000Z";
    const endsAt = "2026-08-24T01:00:00.000Z";
    const result = deriveAllDaySeedDates({ startsAt, endsAt });
    expect(result.startDate).toBe(expectedLocalDate(startsAt));
    expect(result.endDate).toBe(expectedLocalDate(endsAt));
  });

  it("falls back endDate to startsAt's local date when endsAt is absent", () => {
    const startsAt = "2026-08-24T00:00:00.000Z";
    const result = deriveAllDaySeedDates({ startsAt });
    expect(result.endDate).toBe(result.startDate);
  });

  it("prefers the explicit `date` param over startsAt/endsAt for both fields", () => {
    // Same UTC-day-shifting instant as the first test, but an explicit
    // `date` is also present (the month-grid day-tap path) -- it must win
    // outright, matching the pre-fix precedence.
    const result = deriveAllDaySeedDates({
      date: "2026-08-23",
      startsAt: "2026-08-24T00:00:00.000Z",
      endsAt: "2026-08-24T01:00:00.000Z",
    });
    expect(result.startDate).toBe("2026-08-23");
    expect(result.endDate).toBe("2026-08-23");
  });

  it("returns empty strings when no params are given", () => {
    expect(deriveAllDaySeedDates({})).toEqual({ startDate: "", endDate: "" });
  });
});
