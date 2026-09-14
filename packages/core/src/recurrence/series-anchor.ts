// The series anchor of a recurring task (Checkpoint 9.4) -- the DTSTART every
// writer expands a `due_date` rule from. Before 9.4 there were three answers:
// POST /tasks used `due_at` or the request instant, PATCH /tasks/:id used
// `due_at` or `now`, and the nightly expand-window job (since 9.3) used the
// parent's earliest existing occurrence -- so a due-at-less series could be
// materialised from one instant by the route and re-expanded from another by
// the cron, and the two never agreed. This module is the ONE rule, shared by
// PATCH branch A, POST /tasks, the capture commit path and the nightly job:
//
//   anchor = due_at ?? min(occurs_at over the parent's occurrences) ?? now
//
// `due_at` first because docs/ARCHITECTURE.md makes the parent's due_at the
// series anchor, never advanced; the earliest occurrence second because once
// a series has been materialised THAT is its de facto start and re-anchoring
// on a later `now` would silently drop the instances in between; `now` last,
// and POST /tasks then persists it as `due_at` so the fallback is taken at
// most once per series.
//
// The returned instant is floored to a whole SECOND (9.4 review). The
// recurrence engine iterates in whole-second wall-clock space, so the first
// expanded occurrence of a series anchored at 09:00:00.750 is 09:00:00.000
// -- 750 ms BEFORE the anchor -- and expandDueDateWindow's now-floor then
// drops it. `now` is the case that actually bites: it is a real clock read
// and almost never a whole second, and it is the anchor POST /tasks persists
// as due_at. Flooring here means anchor, first occurrence and persisted
// due_at are one and the same instant for every writer.
//
// Pure: no imports, no clock of its own (`now` is the caller's single
// effectiveNow per the frozen read-model rule).

export interface SeriesAnchorInput {
  dueAt: Date | null;
  /** min(occurs_at) over ALL of the parent's occurrence rows, any status; null when none exist. */
  earliestOccursAt: Date | null;
  now: Date;
}

export function resolveSeriesAnchor(input: SeriesAnchorInput): Date {
  const anchor = input.dueAt ?? input.earliestOccursAt ?? input.now;
  const ms = anchor.getTime();
  if (Number.isNaN(ms)) throw new Error("resolveSeriesAnchor: invalid instant");
  return new Date(Math.floor(ms / 1000) * 1000);
}
