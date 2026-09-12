/**
 * A deliberately information-poor wrapper for anything escaping an
 * occurrences job (Checkpoint 9.0).
 *
 * WHY THE RECURRENCE LANE NEEDS ONE TOO
 * -------------------------------------
 * pg-boss persists whatever a failing handler throws: `mapCompletionDataArg`
 * hands the thrown value to `serialize-error`, which copies EVERY own-enumerable
 * property into `pgboss.job.output` -- and, on retry exhaustion, copies that
 * output again onto the dead-letter job. Both occurrences handlers used to
 * rethrow raw. What a raw throw carries here is not a provider secret but the
 * user's own data: `packages/core`'s recurrence errors interpolate the RRULE
 * text and exdate strings into their messages, and a `pg` DatabaseError's
 * `detail` on a constraint violation is literally "Failing row contains (...)",
 * i.e. the whole occurrence row. Neither belongs in a table that self-prunes on
 * a retention nobody chose and that every operator reads first when a job
 * fails.
 *
 * `MailJobError`, `CalendarJobError`, `MonitorJobError` and
 * `RetentionCleanupError` apply the same containment to their lanes. What
 * survives here is the queue name, a SQLSTATE when there is one, and -- for
 * the nightly window expansion, which is a sweep over many parents -- the
 * COUNT of parents that failed against the count attempted, plus a BOUNDED
 * list of the failed parents' ids. Counts answer "how bad was it?" from the
 * job table alone; the ids answer "which one?", which matters because the
 * per-parent warn line is the only other place they are named and the worker
 * log does not survive a container recreation (docs/STATUS.md records exactly
 * that loss at 8.6C). A uuid and a type tag are all an id carries: no rule
 * string, no title, no Postgres `detail`, and the list is capped so a sweep
 * over thousands of parents cannot turn `job.output` into a dump.
 */
export interface FailedParentRef {
  parentType: "task" | "event";
  parentId: string;
}

/** How many failed parents `job.output` names; the count is always exact. */
export const FAILED_PARENT_REFS_MAX = 20;

export class OccurrencesJobError extends Error {
  readonly queue: string;
  readonly sqlState: string | null;
  /** Per-parent sweep accounting; null for the single-item generate-lazy lane. */
  readonly failedParents: number | null;
  readonly totalParents: number | null;
  /** The first `FAILED_PARENT_REFS_MAX` failed parents, ids only; null off the sweep. */
  readonly failedParentRefs: FailedParentRef[] | null;

  constructor(
    queue: string,
    cause: unknown,
    sweep: { failed: FailedParentRef[]; totalParents: number } | null = null,
  ) {
    const code =
      typeof cause === "object" && cause !== null && "code" in cause ? String(cause.code) : null;
    // Only an all-caps/digit SQLSTATE-shaped token is echoed; anything else is
    // dropped rather than trusted -- an rrule library error has no code, and
    // Node's own codes (ERR_*) are not what a reader of job.output needs.
    const sqlState = code !== null && /^[A-Z0-9]{5}$/.test(code) ? code : null;
    const suffix = [
      sqlState !== null ? ` (${sqlState})` : "",
      sweep !== null ? `: ${sweep.failed.length} of ${sweep.totalParents} parents failed` : "",
    ].join("");
    super(`${queue} failed${suffix}`);
    this.name = "OccurrencesJobError";
    this.queue = queue;
    this.sqlState = sqlState;
    this.failedParents = sweep?.failed.length ?? null;
    this.totalParents = sweep?.totalParents ?? null;
    // Copied field by field rather than sliced, so a caller's richer object
    // (a row, say) can never smuggle extra properties into the job table.
    this.failedParentRefs =
      sweep?.failed
        .slice(0, FAILED_PARENT_REFS_MAX)
        .map(({ parentType, parentId }) => ({ parentType, parentId })) ?? null;
    // `cause` is deliberately NOT retained: serialize-error special-cases it
    // rather than relying on enumerability, so keeping it would walk the
    // original error -- rule text and row detail included -- straight back
    // into the job table.
  }
}

/**
 * Wraps a pg-boss batch handler so no rule text, row detail or library message
 * escapes it.
 *
 * An `OccurrencesJobError` thrown from INSIDE the handler passes through
 * unchanged. The window-expansion job throws one itself, carrying the per-parent
 * counts, and re-wrapping it would replace "2 of 14 parents failed" with a bare
 * "failed" -- strictly less information for no additional safety, since the
 * class already carries nothing else.
 */
export function withOccurrencesJobErrorContainment<T>(
  queue: string,
  handler: (jobs: T[]) => Promise<void>,
): (jobs: T[]) => Promise<void> {
  return async function containedOccurrencesJobHandler(jobs) {
    try {
      await handler(jobs);
    } catch (err) {
      throw err instanceof OccurrencesJobError ? err : new OccurrencesJobError(queue, err);
    }
  };
}
