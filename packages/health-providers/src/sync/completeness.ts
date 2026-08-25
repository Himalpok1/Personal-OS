import { civilDateRange } from "@personal-os/core/health/civil-time";
import type { CivilWindow } from "@personal-os/core/health/windows";

// Did we actually get everything the window asked for?
//
// ============================================================================
// THE RULE THIS MODULE EXISTS TO ENFORCE:
//     `received < expected` IS NEVER TRUNCATION.
// ============================================================================
//
// The Google Health API OMITS civil days with no recorded data. This is not a
// theory: during 6.2P, `floors` returned SIX buckets for a SEVEN-day range,
// with 2026-08-24 simply absent. That is a correct, complete response about a
// day the user did not climb any stairs.
//
// The originally-planned check -- "bucket count must equal civil-day count" --
// would have hard-failed on exactly that response, and would go on hard-failing
// every backfill chunk covering days the device was not worn. It would have
// dead-lettered correct data at scale, and the more honestly empty the account,
// the worse it would get. It was removed for this reason and must not come back.
//
// So fetchComplete is set false ONLY on POSITIVE EVIDENCE that a page was left
// unread. A shortfall in day count is evidence of nothing except that some days
// had no data, which is the normal state of the world.
//
// expectedBucketCount and receivedBucketCount are still reported, because the
// PAIR is a genuinely useful diagnostic on health_sync_runs -- a stream that
// reports 0 of 35 for weeks is worth looking at. They are diagnostics, not a
// gate, and nothing here turns them into one.

/** Page cap for the pageSize-10000 modes: daily lists and body samples. */
export const MAX_PAGES_LARGE = 50;
/** Page cap for sessions, which the API hard-limits to 25 records per page. */
export const MAX_PAGES_SESSIONS = 200;

export interface Completeness {
  /** False only on positive evidence of an unread page. */
  fetchComplete: boolean;
  /** Civil days in the requested window; null for non-daily modes. */
  expectedBucketCount: number | null;
  /** DISTINCT civil dates observed; null for non-daily modes. */
  receivedBucketCount: number | null;
  /** Why fetchComplete is false, or null when it is true. */
  truncationReason: string | null;
}

export interface PagingEvidence {
  /** Pages actually fetched in this chunk's loop. */
  readonly pagesFetched: number;
  /** The cap that applied to this loop (MAX_PAGES_LARGE / MAX_PAGES_SESSIONS). */
  readonly maxPages: number;
  /** The token returned alongside the LAST page fetched, if any. */
  readonly nextPageToken?: string | null;
  /**
   * Whether the method can follow a token at all.
   *
   * False for dailyRollUp. The REST reference documents pageSize/pageToken as
   * dailyRollUp REQUEST fields, but sending pageSize is a live-verified HTTP
   * 400, so DailyRollUpRequest deliberately cannot carry one -- and its response
   * type marks nextPageToken optional precisely so its appearance can be
   * DETECTED rather than assumed away. If one ever shows up we cannot page for
   * it, and that is a truncation we must report rather than silently drop.
   */
  readonly pagingSupported: boolean;
}

function assessPaging(evidence: PagingEvidence): { complete: boolean; reason: string | null } {
  const token = evidence.nextPageToken;
  const hasToken = typeof token === "string" && token.length > 0;
  if (!hasToken) return { complete: true, reason: null };

  if (!evidence.pagingSupported) {
    return { complete: false, reason: "unfollowable_next_page_token" };
  }
  if (evidence.pagesFetched >= evidence.maxPages) {
    return { complete: false, reason: "page_cap_reached" };
  }
  // A token still outstanding while under the cap on a method that CAN page
  // means the loop stopped for some other reason (an abort, a break, a bug).
  // Reporting it is safe: a loop that genuinely finished has no token at all,
  // so this can never misfire on a complete fetch.
  return { complete: false, reason: "unfollowed_next_page_token" };
}

/** Completeness for `sample_list` and `session_list`: paging evidence only. */
export function assessPagedCompleteness(evidence: PagingEvidence): Completeness {
  const { complete, reason } = assessPaging(evidence);
  return {
    fetchComplete: complete,
    expectedBucketCount: null,
    receivedBucketCount: null,
    truncationReason: reason,
  };
}

/**
 * Completeness for `daily_rollup` and `daily_list`.
 *
 * `observedDates` must be the set of DISTINCT civil dates the chunk returned.
 * A Set rather than a count on purpose: a duplicate record must not inflate
 * receivedBucketCount into looking like better coverage than was achieved, and
 * `received > expected` must remain a genuine anomaly worth charging as
 * rejections (see datesOutsideWindow) rather than an artefact of counting rows.
 */
export function assessDailyCompleteness(
  window: CivilWindow,
  observedDates: ReadonlySet<string>,
  evidence: PagingEvidence,
): Completeness {
  const { complete, reason } = assessPaging(evidence);
  return {
    fetchComplete: complete,
    expectedBucketCount: civilDateRange(window.startDate, window.endDate).length,
    receivedBucketCount: observedDates.size,
    truncationReason: reason,
  };
}

/**
 * Observed civil dates that fall OUTSIDE the half-open requested window.
 *
 * These are rejections, not truncation. A record dated outside the chunk we
 * asked for means our filter and Google's interpretation of it disagree -- the
 * single most likely symptom of a wrong literal form in buildWindowFilter -- and
 * silently accepting it would let one chunk write over a neighbouring chunk's
 * days. It is also the only way `received > expected` can legitimately arise,
 * which is why that condition is explained here rather than treated as a
 * truncation signal.
 *
 * Sorted, so a run's diagnostics do not depend on Set iteration order.
 */
export function datesOutsideWindow(
  window: CivilWindow,
  observedDates: ReadonlySet<string>,
): string[] {
  return [...observedDates].filter((d) => d < window.startDate || d >= window.endDate).sort();
}
