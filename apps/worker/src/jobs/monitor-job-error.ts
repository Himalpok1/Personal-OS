/**
 * A deliberately information-poor wrapper for anything escaping a monitor job.
 *
 * WHY THIS IS NEEDED, AND WHY IT MATTERS MORE HERE THAN ELSEWHERE
 * --------------------------------------------------------------
 * pg-boss persists whatever a failing handler throws: `mapCompletionDataArg`
 * hands the thrown value to `serialize-error`, which copies EVERY own-enumerable
 * property into `pgboss.job.output`, a durable Postgres table.
 *
 * A monitoring pass holds TARGET URLS in memory, and a target URL is
 * operator-supplied -- it may legitimately carry a token in a query string.
 * Node's fetch failures carry the URL they failed against, so an unwrapped throw
 * writes a credential into a table that is never pruned.
 *
 * `MailJobError`, `CalendarJobError` and `HealthSyncJobError` apply the same
 * containment to their lanes. What survives here is the queue name and a
 * SQLSTATE when there is one -- enough to answer "why did the sweep stop?" from
 * the job table alone, and structurally incapable of carrying a message, a
 * stack, a URL or a Postgres `detail`.
 */
export class MonitorJobError extends Error {
  readonly queue: string;
  readonly sqlState: string | null;

  constructor(queue: string, cause: unknown) {
    const code =
      typeof cause === "object" && cause !== null && "code" in cause ? String(cause.code) : null;
    // Only an all-caps/digit SQLSTATE-shaped token is echoed; anything else is
    // dropped rather than trusted.
    const sqlState = code !== null && /^[A-Z0-9]{5}$/.test(code) ? code : null;
    super(`${queue} failed${sqlState !== null ? ` (${sqlState})` : ""}`);
    this.name = "MonitorJobError";
    this.queue = queue;
    this.sqlState = sqlState;
    // `cause` is deliberately NOT retained: serialize-error special-cases it
    // rather than relying on enumerability, so keeping it would walk the
    // original payload -- URLs included -- straight back into the job table.
  }
}

/** Wraps a pg-boss batch handler so no URL or provider text escapes it. */
export function withMonitorJobErrorContainment<T>(
  queue: string,
  handler: (jobs: T[]) => Promise<void>,
): (jobs: T[]) => Promise<void> {
  return async function containedMonitorJobHandler(jobs) {
    try {
      await handler(jobs);
    } catch (err) {
      throw new MonitorJobError(queue, err);
    }
  };
}
