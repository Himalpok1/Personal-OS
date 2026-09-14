import type { SearchDateFilter, SearchMatchMode, SearchResult } from "@personal-os/schema";
import { formatShortDate, parseLocalDate } from "./local-date";

// The small, pure decisions behind the search screen's secondary lines and
// its two explanatory banners (Checkpoint 9.6). Kept out of the screen so each
// rule is a plain function with a plain test, and so the ADR-045 rule below
// lives in one place rather than in a JSX ternary.
//
// Every string returned here is displayed in a <Text>; none is ever a route.

/** Copy shown when the server fell through to the OR rung of its ladder. */
export const SEARCH_PARTIAL_MATCHES_COPY = "No exact matches — showing partial matches";

/** Copy shown when the query's date token found nothing and was dropped. */
export const SEARCH_DATE_IGNORED_COPY = "Date ignored — no matches in that range";

/** Marker for an imported event, which the detail screen will show read-only (ADR-064). */
export const SEARCH_EXTERNAL_EVENT_COPY = "From calendar · read-only";

/**
 * "Ignored: a, b" for the query words the server dropped past its token cap,
 * or null when nothing was dropped. These are the user's OWN query tokens,
 * echoed by the server (`SearchResponse.dropped`) -- never a stored string.
 */
export function searchIgnoredTokensLine(dropped: readonly string[]): string | null {
  if (dropped.length === 0) return null;
  return `Ignored: ${dropped.join(", ")}`;
}

/** The banner line for a match mode, or null when the mode needs no explanation. */
export function searchMatchModeBanner(mode: SearchMatchMode): string | null {
  return mode === "any" ? SEARCH_PARTIAL_MATCHES_COPY : null;
}

/** "September 2026" from an inclusive local-date window's first day. */
function formatMonthYear(date: string): string {
  return parseLocalDate(date).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/**
 * The chip text describing the date window the server applied -- echoed back
 * so the "month without year means THIS year" rule is visible rather than
 * guessed. A dropped filter says so instead of describing a window that was
 * not used.
 *
 * `from`/`to` are calendar dates and are formatted through the local-date
 * helpers, never through `new Date(string)` (which would read them as UTC
 * midnight and show the previous day west of Greenwich).
 */
export function searchDateFilterChip(filter: SearchDateFilter | null): string | null {
  if (filter === null) return null;
  if (filter.dropped) return SEARCH_DATE_IGNORED_COPY;
  switch (filter.kind) {
    case "day":
    case "iso_date":
      return `On ${formatShortDate(filter.from)}`;
    case "month":
    case "iso_month":
      return `In ${formatMonthYear(filter.from)}`;
    case "year":
      return `In ${filter.from.slice(0, 4)}`;
  }
}

/** Device-local "Sep 18, 2026, 07:46" for a timed event's start instant. */
function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * The date line under an event result.
 *
 * ADR-045: `all_day === true` means date-only everywhere outside recurrence
 * internals. The all-day branch returns BEFORE any instant is touched and
 * formats `start_date` as a calendar date, so the local-noon anchor can never
 * surface as "12:00" here (the 5.7.1 defect). A timed event shows its start
 * in the device zone; a series parent's `starts_at` is the series template,
 * which is the honest thing to show for a row that stands for the series.
 */
export function searchEventDateLine(
  event: Extract<SearchResult, { type: "event" }>,
): string | null {
  if (event.all_day) {
    return event.start_date === null ? null : formatShortDate(event.start_date);
  }
  if (event.starts_at === null) return null;
  const when = formatDateTime(event.starts_at);
  return event.is_recurring ? `${when} · repeats` : when;
}

/** "Done" / "Dropped" for a task whose status the row should show; null for open tasks. */
export function searchTaskStatusLine(task: Extract<SearchResult, { type: "task" }>): string | null {
  switch (task.status) {
    case "done":
      return "Done";
    case "dropped":
      return "Dropped";
    default:
      return null;
  }
}

/** "Paused" / "Completed" for a project; null for an active one. */
export function searchProjectStatusLine(
  project: Extract<SearchResult, { type: "project" }>,
): string | null {
  switch (project.status) {
    case "paused":
      return "Paused";
    case "completed":
      return "Completed";
    default:
      return null;
  }
}
