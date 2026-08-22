import { captureEffectiveNow, localDayWindow, localDayWindowForDate } from "@personal-os/core";
import { occurrences, tasks, type Db } from "@personal-os/db";
import {
  ReviewRecentlyCompletedItemSchema,
  type ReviewRecentlyCompletedItem,
} from "@personal-os/schema";
import { and, eq, gte, isNotNull, isNull, lte } from "drizzle-orm";

// Frozen recently-completed semantics (Checkpoint 5.3 review contexts):
// the last 7 LOCAL calendar days including today, bounded above by
// effectiveNow itself -- [startOfLocalDay(tz, today-6), effectiveNow].

const DEFAULT_LIMIT = 10;
const FIRST_WINDOW_DAY_OFFSET = -6;

function addLocalDays(localDate: string, days: number): string {
  const [year, month, day] = localDate.split("-").map(Number);
  const next = new Date(Date.UTC(year!, month! - 1, day, 12) + days * 86_400_000);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${String(next.getUTCFullYear()).padStart(4, "0")}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

export async function collectRecentlyCompleted(
  db: Db,
  opts: { tz: string; now?: Date; limit?: number },
): Promise<{ items: ReviewRecentlyCompletedItem[]; total: number }> {
  const effectiveNow = captureEffectiveNow(opts.now);
  const windowStartUtc = localDayWindowForDate(
    opts.tz,
    addLocalDays(localDayWindow(opts.tz, effectiveNow).localDate, FIRST_WINDOW_DAY_OFFSET),
  ).startUtc;

  const [taskRows, occurrenceRows] = await Promise.all([
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        completedAt: tasks.completedAt,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.status, "done"),
          // Recurring parents can never reach done via occurrence completion
          // (canCompleteTaskDirectly is false for rrule tasks); this guard is
          // belt-and-braces against force-mutated rows.
          isNull(tasks.rrule),
          isNotNull(tasks.completedAt),
          gte(tasks.completedAt, windowStartUtc),
          lte(tasks.completedAt, effectiveNow),
        ),
      ),
    db
      .select({
        occurrenceId: occurrences.id,
        parentTaskId: occurrences.parentId,
        title: tasks.title,
        completedAt: occurrences.completedAt,
      })
      .from(occurrences)
      .innerJoin(tasks, eq(occurrences.parentId, tasks.id))
      .where(
        and(
          eq(occurrences.parentType, "task"),
          eq(occurrences.status, "done"),
          isNotNull(occurrences.completedAt),
          gte(occurrences.completedAt, windowStartUtc),
          lte(occurrences.completedAt, effectiveNow),
        ),
      ),
  ]);

  const merged: ReviewRecentlyCompletedItem[] = [
    ...taskRows.map((row) => ({
      kind: "task" as const,
      id: row.id,
      title: row.title,
      completed_at: row.completedAt!.toISOString(),
    })),
    ...occurrenceRows.map((row) => ({
      kind: "occurrence" as const,
      occurrence_id: row.occurrenceId,
      parent_task_id: row.parentTaskId,
      title: row.title,
      completed_at: row.completedAt!.toISOString(),
    })),
  ];

  merged.sort((a, b) => {
    const byTime = Date.parse(b.completed_at) - Date.parse(a.completed_at);
    if (byTime !== 0) return byTime;
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    const aId = a.kind === "task" ? a.id : a.occurrence_id;
    const bId = b.kind === "task" ? b.id : b.occurrence_id;
    return aId < bId ? -1 : aId > bId ? 1 : 0;
  });

  // Honest total: full in-window count BEFORE the limit slice.
  const total = merged.length;
  const limit = Math.max(0, opts.limit ?? DEFAULT_LIMIT);

  return {
    items: ReviewRecentlyCompletedItemSchema.array().parse(merged.slice(0, limit)),
    total,
  };
}
