import type { CivilWindow } from "@personal-os/core/health/windows";
import type { HealthMetricDefinition } from "../google-health-catalog.js";
import type { ApiCivilDateTime, ApiCivilTimeInterval } from "../google-health-client.js";

// Request-shape construction for the Google Health sync engine.
//
// Every fact encoded here was either transcribed from the REST reference or
// learned the hard way during the 6.2P live probe. Two of them cost a whole
// probe run, so they are pinned by tests rather than by comment alone:
//
//   1. The rollup REQUEST range is a CivilTimeInterval and uses bare
//      `start`/`end`. It is NOT `startTime`/`endTime` -- those belong to the
//      interval carried ON a record. Sending startTime yields
//      `Unknown name "startTime" at 'range': Cannot find field`.
//   2. `pageSize` must never be sent on dailyRollUp. That is enforced by the
//      client's types (DailyRollUpRequest has no such field), so nothing here
//      can reintroduce it.

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseLocalDate(localDate: string, label: string): ApiCivilDateTime {
  const m = LOCAL_DATE.exec(localDate);
  if (!m) throw new Error(`invalid ${label} date "${localDate}", expected YYYY-MM-DD`);
  return { date: { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) } };
}

/**
 * The `range` object for a dailyRollUp call, from a half-open civil window.
 *
 * The `time` component is deliberately omitted rather than written as an
 * explicit midnight. CivilDateTime.time is optional and defaults to start of
 * day, and a window boundary is a pure calendar date -- inventing 00:00:00.000
 * would be writing a fact the window never carried, which is the same class of
 * mistake ADR-048 exists to prevent.
 */
export function buildRollupRange(window: CivilWindow): ApiCivilTimeInterval {
  return {
    start: parseLocalDate(window.startDate, "window start"),
    end: parseLocalDate(window.endDate, "window end"),
  };
}

/**
 * Whether a documented filter path addresses a `google.type.Date` or a
 * `CivilDateTime`, which decides the literal form on the right-hand side.
 *
 * The rule is structural, not per-metric: a path whose LAST segment is `date`
 * (e.g. `daily_resting_heart_rate.date`) addresses a bare calendar date, so the
 * literal is `YYYY-MM-DD`. Everything else addresses a civil date-time
 * (`weight.sample_time.civil_time`, `sleep.interval.civil_end_time`), so the
 * literal carries a time-of-day: `YYYY-MM-DDT00:00:00`.
 */
function isBareDatePath(filterPath: string): boolean {
  return filterPath.endsWith(".date");
}

/**
 * Formats one boundary literal for a filter expression.
 *
 * WHY THIS BRANCHES, AND WHY IT IS ONE FUNCTION:
 *
 * During 6.2P the `T00:00:00` form was sent against a `.date` path and returned
 * HTTP 200 with zero rows. That proves nothing whatsoever, because the account
 * has zero rows for those metrics anyway -- a 200-with-nothing is exactly what a
 * silently-misparsed literal and a genuinely empty account look like from the
 * outside, and they are indistinguishable.
 *
 * Emitting the structurally-correct literal for each path kind is therefore the
 * safer default: if Google disagrees with our reading of the type, the call
 * fails LOUDLY with a 400 carrying an `error.details[].reason` we can act on,
 * instead of quietly returning an empty page that the sync engine would happily
 * densify into "verified absent". A loud disagreement is a fact; a silent empty
 * page is not.
 *
 * Kept as a single function precisely so that flipping the convention -- if a
 * live 400 ever proves the other form correct -- is a one-line change in one
 * place, not a sweep across six call sites.
 */
function boundaryLiteral(localDate: string, bareDate: boolean): string {
  // Validate even though the caller already holds a window: a malformed date
  // interpolated into a filter string would be an opaque 400 at Google rather
  // than a clear error here.
  parseLocalDate(localDate, "filter boundary");
  return bareDate ? localDate : `${localDate}T00:00:00`;
}

/**
 * The half-open filter expression for one `list`/`reconcile` chunk.
 *
 * Half-open on purpose, matching CivilWindow: `>= start AND < end`. A closed
 * upper bound would double-count the seam day between abutting backfill chunks.
 *
 * Note sleep: its filterPath is `sleep.interval.civil_end_time`, which is a
 * sleep-EXCLUSIVE filter. `list` explicitly excludes sleep from the generic
 * session-start filter, and 6.2P confirmed this live -- `civil_end_time`
 * returned 200 while `start_time` returned 400 INVALID_ARGUMENT. That is also
 * the ADR-049 attribution axis, so query, attribution and deletion scope are one
 * and the same. Nothing here may substitute a start-time filter for sleep.
 */
export function buildWindowFilter(def: HealthMetricDefinition, window: CivilWindow): string {
  if (def.filterPath === null) {
    throw new Error(
      `metric "${def.metric}" has no filterPath: ${def.method} takes a range object, ` +
        `not a filter string -- use buildRollupRange instead`,
    );
  }
  const bare = isBareDatePath(def.filterPath);
  const lo = boundaryLiteral(window.startDate, bare);
  const hi = boundaryLiteral(window.endDate, bare);
  return `${def.filterPath} >= "${lo}" AND ${def.filterPath} < "${hi}"`;
}
