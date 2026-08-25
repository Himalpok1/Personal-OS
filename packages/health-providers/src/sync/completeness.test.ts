import { describe, expect, it } from "vitest";
import {
  assessDailyCompleteness,
  assessPagedCompleteness,
  datesOutsideWindow,
  MAX_PAGES_LARGE,
  MAX_PAGES_SESSIONS,
  type PagingEvidence,
} from "./completeness.js";

const WINDOW = { startDate: "2026-08-18", endDate: "2026-08-25" }; // 7 civil days

const CLEAN: PagingEvidence = { pagesFetched: 1, maxPages: MAX_PAGES_LARGE, pagingSupported: true };

describe("page caps", () => {
  it("pins the two caps", () => {
    expect(MAX_PAGES_LARGE).toBe(50);
    expect(MAX_PAGES_SESSIONS).toBe(200);
  });
});

describe("assessDailyCompleteness -- received < expected is NEVER truncation", () => {
  // THE REGRESSION THIS FILE EXISTS FOR. 6.2P observed `floors` returning SIX
  // buckets for a SEVEN-day range, with 2026-08-24 simply absent because no
  // stairs were climbed. The originally-planned count-equality check would have
  // hard-failed on that correct response, and would go on dead-lettering every
  // backfill chunk covering days the device was not worn.
  it("stays complete when a day is simply absent", () => {
    const observed = new Set([
      "2026-08-18",
      "2026-08-19",
      "2026-08-20",
      "2026-08-21",
      "2026-08-22",
      "2026-08-23",
    ]);
    const result = assessDailyCompleteness(WINDOW, observed, CLEAN);
    expect(result).toEqual({
      fetchComplete: true,
      expectedBucketCount: 7,
      receivedBucketCount: 6,
      truncationReason: null,
    });
  });

  it("stays complete when the window returns nothing at all", () => {
    const result = assessDailyCompleteness(WINDOW, new Set(), CLEAN);
    expect(result.fetchComplete).toBe(true);
    expect(result.receivedBucketCount).toBe(0);
    expect(result.expectedBucketCount).toBe(7);
    expect(result.truncationReason).toBeNull();
  });

  it("counts expected as the civil days in the half-open window", () => {
    expect(
      assessDailyCompleteness({ startDate: "2026-08-18", endDate: "2026-08-19" }, new Set(), CLEAN)
        .expectedBucketCount,
    ).toBe(1);
    expect(
      assessDailyCompleteness({ startDate: "2026-08-18", endDate: "2026-08-18" }, new Set(), CLEAN)
        .expectedBucketCount,
    ).toBe(0);
  });

  // A Set, not a count, so a duplicate record cannot inflate coverage into
  // looking better than it was -- nor manufacture a phantom received > expected.
  it("counts DISTINCT civil dates, so a duplicate record inflates nothing", () => {
    const observed = new Set(["2026-08-18", "2026-08-19"]);
    expect(assessDailyCompleteness(WINDOW, observed, CLEAN).receivedBucketCount).toBe(2);
  });

  it("reports truncation only from paging evidence", () => {
    const truncated = assessDailyCompleteness(WINDOW, new Set(), {
      pagesFetched: MAX_PAGES_LARGE,
      maxPages: MAX_PAGES_LARGE,
      pagingSupported: true,
      nextPageToken: "more",
    });
    expect(truncated.fetchComplete).toBe(false);
    expect(truncated.truncationReason).toBe("page_cap_reached");
    expect(truncated.expectedBucketCount).toBe(7);
  });

  // dailyRollUp documents pageSize/pageToken as request fields, but sending
  // pageSize is a live-verified 400 -- so DailyRollUpRequest carries none and we
  // cannot follow a token if one ever appears. That is a real truncation.
  it("reports an unfollowable token from a rollup as truncation", () => {
    const result = assessDailyCompleteness(WINDOW, new Set(["2026-08-18"]), {
      pagesFetched: 1,
      maxPages: 1,
      pagingSupported: false,
      nextPageToken: "surprise",
    });
    expect(result).toMatchObject({
      fetchComplete: false,
      truncationReason: "unfollowable_next_page_token",
    });
  });

  it("stays complete when a rollup returns no token, which is the normal case", () => {
    const result = assessDailyCompleteness(WINDOW, new Set(["2026-08-18"]), {
      pagesFetched: 1,
      maxPages: 1,
      pagingSupported: false,
    });
    expect(result.fetchComplete).toBe(true);
  });
});

describe("assessPagedCompleteness -- samples and sessions", () => {
  it("reports no bucket counts, which are meaningless for these modes", () => {
    expect(assessPagedCompleteness(CLEAN)).toEqual({
      fetchComplete: true,
      expectedBucketCount: null,
      receivedBucketCount: null,
      truncationReason: null,
    });
  });

  it("is complete when the last page carried no token", () => {
    for (const token of [undefined, null, ""]) {
      expect(
        assessPagedCompleteness({ ...CLEAN, pagesFetched: 12, nextPageToken: token }).fetchComplete,
      ).toBe(true);
    }
  });

  it("reports the session page cap being hit with a token outstanding", () => {
    expect(
      assessPagedCompleteness({
        pagesFetched: MAX_PAGES_SESSIONS,
        maxPages: MAX_PAGES_SESSIONS,
        pagingSupported: true,
        nextPageToken: "more",
      }),
    ).toMatchObject({ fetchComplete: false, truncationReason: "page_cap_reached" });
  });

  // Can never misfire on a completed loop: a loop that genuinely finished has
  // no token at all.
  it("reports a token abandoned below the cap", () => {
    expect(
      assessPagedCompleteness({ ...CLEAN, pagesFetched: 3, nextPageToken: "more" }),
    ).toMatchObject({ fetchComplete: false, truncationReason: "unfollowed_next_page_token" });
  });

  it("treats a cap overshoot the same as hitting it", () => {
    expect(
      assessPagedCompleteness({ ...CLEAN, pagesFetched: 99, maxPages: 50, nextPageToken: "x" })
        .truncationReason,
    ).toBe("page_cap_reached");
  });
});

describe("datesOutsideWindow -- a rejection signal, not a truncation signal", () => {
  it("finds dates below and at/above the half-open bounds", () => {
    const observed = new Set([
      "2026-08-17", // before start
      "2026-08-18", // inclusive start -- inside
      "2026-08-24", // inside
      "2026-08-25", // exclusive end -- OUTSIDE
      "2026-09-01",
    ]);
    expect(datesOutsideWindow(WINDOW, observed)).toEqual([
      "2026-08-17",
      "2026-08-25",
      "2026-09-01",
    ]);
  });

  it("returns nothing when every date is in range", () => {
    expect(datesOutsideWindow(WINDOW, new Set(["2026-08-18", "2026-08-24"]))).toEqual([]);
  });

  // The only legitimate route to received > expected, and it is charged as
  // rejections rather than reported as truncation.
  it("explains a received count above the expected count", () => {
    const observed = new Set([
      "2026-08-18",
      "2026-08-19",
      "2026-08-20",
      "2026-08-21",
      "2026-08-22",
      "2026-08-23",
      "2026-08-24",
      "2026-09-30",
    ]);
    const result = assessDailyCompleteness(WINDOW, observed, CLEAN);
    expect(result.receivedBucketCount).toBe(8);
    expect(result.expectedBucketCount).toBe(7);
    expect(result.fetchComplete).toBe(true); // NOT truncation
    expect(result.truncationReason).toBeNull();
    expect(datesOutsideWindow(WINDOW, observed)).toEqual(["2026-09-30"]);
  });

  it("is sorted, so diagnostics do not depend on Set iteration order", () => {
    expect(datesOutsideWindow(WINDOW, new Set(["2026-09-01", "2026-08-17"]))).toEqual([
      "2026-08-17",
      "2026-09-01",
    ]);
  });
});
