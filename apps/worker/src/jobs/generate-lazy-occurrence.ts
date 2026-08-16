import {
  computeNextLazyOccurrence,
  validateCompletionAnchoredRule,
  wallClockToNaiveDate,
} from "@personal-os/core";
import { occurrences, tasks, type Db } from "@personal-os/db";
import { eq } from "drizzle-orm";
import type { Job } from "pg-boss";

export interface GenerateLazyOccurrenceJobData {
  occurrenceId: string;
  fromStatus: "completed" | "skipped";
}

function pgErrorCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const direct = (err as { code?: unknown }).code;
  if (typeof direct === "string") return direct;
  const cause = (err as { cause?: unknown }).cause;
  if (typeof cause === "object" && cause !== null) {
    const causeCode = (cause as { code?: unknown }).code;
    if (typeof causeCode === "string") return causeCode;
  }
  return undefined;
}

const UNIQUE_VIOLATION = "23505";

async function generateOne(db: Db, data: GenerateLazyOccurrenceJobData): Promise<void> {
  const [occurrence] = await db
    .select()
    .from(occurrences)
    .where(eq(occurrences.id, data.occurrenceId));
  if (!occurrence) {
    console.warn(`occurrences.generate-lazy: occurrence ${data.occurrenceId} not found, skipping`);
    return;
  }
  if (occurrence.parentType !== "task") {
    console.warn(
      `occurrences.generate-lazy: occurrence ${data.occurrenceId} is not a task occurrence, skipping`,
    );
    return;
  }

  const [task] = await db.select().from(tasks).where(eq(tasks.id, occurrence.parentId));
  if (
    !task ||
    task.recurrenceAnchor !== "completion_date" ||
    !task.rrule ||
    !task.recurrenceTimezone
  ) {
    console.warn(
      `occurrences.generate-lazy: task ${occurrence.parentId} is not completion-anchored, skipping`,
    );
    return;
  }

  // Re-validated defensively even though this should already have been
  // enforced at write time (see commit-parsed-entity.ts) -- hitting this
  // here would indicate a data-integrity bug worth surfacing loudly, not a
  // normal error path.
  validateCompletionAnchoredRule(task.rrule);

  const fromInstant = occurrence.completedAt ?? new Date();
  const next = computeNextLazyOccurrence(
    { rrule: task.rrule, recurrenceTimezone: task.recurrenceTimezone },
    fromInstant,
    data.fromStatus,
  );

  try {
    await db.insert(occurrences).values({
      parentType: "task",
      parentId: task.id,
      occursAt: next.occursAt,
      occursLocal: wallClockToNaiveDate(next.occursLocal),
      status: "scheduled",
      lazyGenerated: true,
    });
  } catch (err) {
    // one_open_occurrence_per_lazy_parent is the real safety net under
    // pg-boss's at-least-once delivery: a duplicate job run hitting this
    // constraint means the successor already exists, which is success, not
    // an error to retry.
    if (pgErrorCode(err) === UNIQUE_VIOLATION) {
      console.warn(
        `occurrences.generate-lazy: successor already exists for task ${task.id}, no-op`,
      );
      return;
    }
    throw err;
  }
}

export function createGenerateLazyOccurrenceHandler(db: Db) {
  return async function handleGenerateLazyOccurrence(
    jobs: Job<GenerateLazyOccurrenceJobData>[],
  ): Promise<void> {
    for (const job of jobs) {
      await generateOne(db, job.data);
    }
  };
}
