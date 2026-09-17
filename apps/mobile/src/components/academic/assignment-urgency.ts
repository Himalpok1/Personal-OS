import type { AcademicUrgency } from "@personal-os/schema";
import { academicTodayWindows } from "@personal-os/core/academic/buckets";
import { deriveUrgency } from "@personal-os/core/academic/urgency";

// Client-side urgency for the course screen's rows (Checkpoint 10.3).
//
// The course detail route carries no per-row urgency (the wire keeps every
// item schema byte-identical for the versionCode-25 client -- see
// packages/schema/src/academic.ts), and the screen already partitions its
// open rows client-side against the query's `dataUpdatedAt`
// (partition-assignments.ts records why that one derivation is permitted).
// This is the SAME derivation, made through core's own `deriveUrgency` with
// the SAME horizon end `academicTodayWindows` computes for the server's
// `due_this_week`, so a row's chip here can never disagree with the urgency
// the server would have assigned it on Today.
//
// Pure: `nowMs` is the caller's one instant per render (a query's
// `dataUpdatedAt`, never `Date.now()`), and `tz` is the device zone the same
// caller sends to `/academic/today`.

export interface UrgencyContext {
  now: Date;
  horizonEndUtc: Date;
}

/**
 * Computed ONCE per render and shared by every row, so the horizon end is
 * resolved once rather than per assignment. A non-finite or non-positive
 * `nowMs` (React Query's 0 before the first fetch) yields null: no chip is
 * better than a chip against 1970.
 */
export function urgencyContext(nowMs: number, tz: string): UrgencyContext | null {
  if (!Number.isFinite(nowMs) || nowMs <= 0) return null;
  const now = new Date(nowMs);
  try {
    return { now, horizonEndUtc: academicTodayWindows(tz, now).horizonEndUtc };
  } catch {
    // An unknown zone cannot define a local day; the rows simply carry no chip.
    return null;
  }
}

/** core's ladder for one `due_at`; null for an undated or unreadable instant, or with no context. */
export function assignmentUrgency(
  dueAt: string | null,
  context: UrgencyContext | null,
): AcademicUrgency | null {
  if (dueAt === null || context === null) return null;
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return null;
  return deriveUrgency(due, context.now, context.horizonEndUtc);
}
