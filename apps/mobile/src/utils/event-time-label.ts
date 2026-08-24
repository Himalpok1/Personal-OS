// The single place that decides what time text an event row shows.
//
// Why this exists (Checkpoint 5.7.1): ADR-042 anchors a recurring ALL-DAY
// series' DTSTART at LOCAL NOON so date-only recurrence is DST-safe and
// correct in nonexistent-midnight zones. That noon value is *implementation
// metadata*. A canonical all-day event has `starts_at === null`, so any
// fallback chain that ends in `occurs_at` renders a materialized all-day
// instance as "12:00" -- which shipped to production and was found on the
// device as "12:00, P57-SMOKE all-day weekly".
//
// The invariant, stated once so both callers cannot drift:
//
//   all_day === true  ->  NEVER format an instant. Full stop.
//
// `all_day` is checked FIRST and returns before any timestamp is touched, so
// the noon anchor is unreachable for an all-day item by construction rather
// than by every caller remembering to guard. Non-recurring all-day events
// happened to render correctly before this fix only because their
// `occurs_at` is null -- an accident, not a guarantee.

export interface EventTimeLabelInput {
  all_day: boolean;
  starts_at: string | null;
  ends_at: string | null;
  occurs_at: string | null;
}

/** Formats an ISO instant as local wall-clock HH:MM. */
export function formatEventTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * The time text for an event row.
 *
 * @param allDayLabel what to show for an all-day event -- callers differ only
 *   in casing/styling ("All day" on Today, "ALL-DAY" in the Agenda gutter),
 *   never in the underlying rule.
 */
export function eventTimeLabel(event: EventTimeLabelInput, allDayLabel: string): string {
  // Load-bearing: this returns before any instant is formatted. Do not move
  // it below the timestamp branches, and do not add an `occurs_at` fallback
  // that can be reached when all_day is true.
  if (event.all_day) return allDayLabel;

  if (event.starts_at && event.ends_at) {
    return `${formatEventTime(event.starts_at)}–${formatEventTime(event.ends_at)}`;
  }
  if (event.starts_at) return formatEventTime(event.starts_at);
  // Timed recurring instance: `starts_at` is the series template, `occurs_at`
  // carries this instance's real instant (ADR-042).
  if (event.occurs_at) return formatEventTime(event.occurs_at);
  return allDayLabel;
}
