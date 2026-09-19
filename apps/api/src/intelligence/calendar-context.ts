// Checkpoint 10.9 -- `buildCalendarContext`: the `get_calendar_context` read
// tool's implementation (ADR-081 §5), the second builder in this lane after
// `buildTodayContext` and written to its rules:
//
//   - `assertGrant` is the FIRST statement: a forged or absent grant throws
//     before a single row is read (ask/authorize.ts). The gateway mints its
//     grant through `authorizeAgentRead`; the Ask lane through
//     `authorizeCloudAsk`; one WeakSet, one gate.
//   - Reads ONLY through a read model (read-models/calendar-context.ts),
//     never a table, and never writes (Guard 4).
//   - The output is `GetCalendarContextOutputSchema` -- `.strict()`, id-
//     carrying (an agent that may PROPOSE needs the target id, ADR-078) and
//     description-free by construction: the read model's row shape has no
//     description field, so this file cannot even name it. Titles and
//     locations are control-stripped then word-boundary truncated to the
//     same caps TodayContext uses; an external row's text is provider-
//     authored and arrives bounded exactly as a local row's does.
//   - A recurring instance reports ITS OWN instant (`occurs_at` /
//     `occurs_ends_at`), never the series template's `starts_at` -- the
//     Checkpoint 10.6 briefing defect class, pinned by calendar-context.test.ts.
//   - Capped at READ_TOOL_CALENDAR_ITEMS_MAX with an honest `total` and a
//     `truncated` flag; the span itself is bounded upstream by
//     `GetCalendarContextInputSchema` (≤ 14 days).
//   - Never logs.
import {
  stripUnsummarizableCharacters,
  truncateAtWordBoundary,
} from "@personal-os/core/mail/provider-strings";
import {
  GetCalendarContextOutputSchema,
  READ_TOOL_CALENDAR_ITEMS_MAX,
  TODAY_CONTEXT_LOCATION_MAX_CHARS,
  TODAY_CONTEXT_TITLE_MAX_CHARS,
  type CalendarContextItem,
  type GetCalendarContextOutput,
  type ReadToolInput,
} from "@personal-os/schema";
import { assertGrant } from "../ask/authorize.js";
import { collectCalendarRange, type CalendarRangeRow } from "../read-models/calendar-context.js";
import type { ReadContext } from "./read-context.js";

export type GetCalendarContextInput = ReadToolInput<"get_calendar_context">;

// The same string discipline as today-context.ts: control-strip, then cut.
function bound(value: string | null | undefined, cap: number): string {
  return truncateAtWordBoundary(stripUnsummarizableCharacters(value) ?? "", cap) ?? "";
}

function boundNullable(value: string | null | undefined, cap: number): string | null {
  if (value === null || value === undefined) return null;
  return bound(value, cap);
}

function toItem(row: CalendarRangeRow): CalendarContextItem {
  // Timed instance: a recurring row's `starts_at`/`ends_at` are the SERIES
  // template's instants; the instance's own are `occurs_at`/`occurs_ends_at`.
  // All-day rows carry dates only and never an instant (ADR-042/045).
  const startsAt = row.all_day ? null : row.is_recurring_instance ? row.occurs_at : row.starts_at;
  const endsAt = row.all_day ? null : row.is_recurring_instance ? row.occurs_ends_at : row.ends_at;
  return {
    id: row.id,
    title: bound(row.title, TODAY_CONTEXT_TITLE_MAX_CHARS),
    all_day: row.all_day,
    starts_at: startsAt,
    ends_at: endsAt,
    start_date: row.all_day ? row.start_date : null,
    end_date: row.all_day ? row.end_date : null,
    location: boundNullable(row.location, TODAY_CONTEXT_LOCATION_MAX_CHARS),
    origin: row.origin,
    is_recurring_instance: row.is_recurring_instance,
    parent_event_id: row.parent_event_id,
    status: row.status,
  };
}

/**
 * `get_calendar_context`: every unarchived event instance in the inclusive
 * local window `[from, to]` of `input.tz`, projected to the strict,
 * description-free item shape. `input` is expected to have passed
 * `GetCalendarContextInputSchema` (the gateway parses it; the span bound
 * lives there). The read context's own `tz` is NOT used: the tool's zone is
 * its input, as the schema defines it.
 */
export async function buildCalendarContext(
  ctx: ReadContext,
  input: GetCalendarContextInput,
): Promise<GetCalendarContextOutput> {
  assertGrant(ctx.grant);

  const { rows } = await collectCalendarRange(
    ctx.db,
    { tz: input.tz, from: input.from, to: input.to },
    { now: ctx.effectiveNow },
  );

  const total = rows.length;
  const items = rows.slice(0, READ_TOOL_CALENDAR_ITEMS_MAX).map(toItem);

  return GetCalendarContextOutputSchema.parse({
    tz: input.tz,
    from: input.from,
    to: input.to,
    items,
    total,
    truncated: total > items.length,
  });
}
