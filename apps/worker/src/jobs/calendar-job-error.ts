import { classifyCalendarProviderError } from "@personal-os/calendar-providers";

/**
 * A deliberately information-poor wrapper for anything escaping a calendar job.
 *
 * WHY THIS IS NEEDED
 * ------------------
 * pg-boss persists whatever a failing handler throws. `manager.js`'s
 * `mapCompletionDataArg` hands the thrown value to `serialize-error`, which
 * copies EVERY own-enumerable property onto the stored object -- so an escaping
 * `CalDavError` writes its `responseBody` (the provider's full raw response
 * body) into `pgboss.job.output`, a durable Postgres table, and an escaping
 * `GoogleOAuthError`/`GoogleCalendarApiError` writes Google's own prose there.
 *
 * `HealthSyncJobError` already applies exactly this containment to the health
 * pass (Checkpoint 6.3). The three calendar jobs predate that discipline and
 * were never given it; this is the same fix, one lane over.
 *
 * What survives is the queue name and a classification code from the closed
 * `CalendarSyncErrorCode` vocabulary -- enough to answer "why did sync stop?"
 * from the job table alone, and structurally incapable of carrying a message,
 * a stack, a URL, a response body, or a Postgres `detail`.
 */
export class CalendarJobError extends Error {
  readonly queue: string;
  readonly classification: string;

  constructor(queue: string, cause: unknown) {
    const classification = classifyCalendarProviderError(cause);
    super(`${queue} failed (${classification})`);
    this.name = "CalendarJobError";
    this.queue = queue;
    this.classification = classification;
    // `cause` is deliberately NOT retained. An earlier comment here claimed
    // Error#cause is enumerable enough for serialize-error to walk; that is
    // backwards -- a `cause` set through the Error constructor is
    // non-enumerable by spec, so a `for...in` walk would miss it anyway.
    // Not retaining it is still right: `serialize-error` special-cases
    // `cause` explicitly rather than relying on enumerability, and a future
    // serializer would have every reason to follow it.
  }
}

/** Wraps a pg-boss batch handler so nothing provider-authored escapes it. */
export function withCalendarJobErrorContainment<T>(
  queue: string,
  handler: (jobs: T[]) => Promise<void>,
): (jobs: T[]) => Promise<void> {
  return async function containedCalendarJobHandler(jobs) {
    try {
      await handler(jobs);
    } catch (err) {
      throw new CalendarJobError(queue, err);
    }
  };
}
