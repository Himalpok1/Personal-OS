import type { PgBoss } from "pg-boss";
import {
  CALENDAR_PUSH_EVENT_DEAD_QUEUE,
  CALENDAR_PUSH_EVENT_QUEUE,
  QUEUE_RETRY_OPTIONS,
} from "../queue-names.js";

/**
 * Creates the push-event dead-letter queue, attaches it to the primary, and
 * -- the part that matters on every deployed database -- updates the primary
 * so the attach survives the queue already existing (Checkpoint 9.5, the
 * 9.0 `attachOccurrencesDeadLetterQueues` sequence applied to
 * `calendar.google.push-event`).
 *
 * Exported so a test can run THIS sequence against a database where the
 * primary already exists without a dead letter -- production's state, since
 * the queue has existed since Phase 4 -- and assert the outcome from
 * `pgboss.queue` rather than from the source text. `boss.work()` stays in
 * index.ts, where the containment and parity guards read it.
 *
 * Ordering is load-bearing three times over:
 *   1. dead queue BEFORE primary -- `queue.dead_letter` is a foreign key
 *      against `queue.name`;
 *   2. createQueue with `deadLetter` -- what attaches it on a FRESH database;
 *   3. updateQueue -- what attaches it on an EXISTING one, because
 *      create_queue ends in ON CONFLICT DO NOTHING and silently discards the
 *      option when the row already exists.
 */
export async function attachCalendarPushDeadLetterQueue(boss: PgBoss): Promise<void> {
  await boss.createQueue(CALENDAR_PUSH_EVENT_DEAD_QUEUE);
  await boss.createQueue(CALENDAR_PUSH_EVENT_QUEUE, {
    ...QUEUE_RETRY_OPTIONS[CALENDAR_PUSH_EVENT_QUEUE],
    deadLetter: CALENDAR_PUSH_EVENT_DEAD_QUEUE,
  });
  await boss.updateQueue(CALENDAR_PUSH_EVENT_QUEUE, { deadLetter: CALENDAR_PUSH_EVENT_DEAD_QUEUE });
}
