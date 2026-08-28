/**
 * A deliberately information-poor wrapper for anything escaping the two
 * AI-provider jobs (`capture.parse`, `ptt.transcribe`).
 *
 * WHY THIS IS NEEDED
 * ------------------
 * pg-boss persists whatever a failing handler throws. `manager.js`'s
 * `mapCompletionDataArg` hands the thrown value to `serialize-error`, which
 * copies EVERY own-enumerable property onto the stored object -- so an
 * escaping Vercel AI SDK `APICallError` writes its `responseBody`,
 * `requestBodyValues` (the user's own capture text) and `responseHeaders`
 * into `pgboss.job.output`, a durable Postgres table, and the transcription
 * client's plain `Error` embeds the STT provider's raw HTTP response body in
 * its message.
 *
 * `HealthSyncJobError` (Checkpoint 6.3) and `CalendarJobError` (6.5) already
 * apply exactly this containment to their lanes. These two jobs predate that
 * discipline and never got it; this is the same fix, one lane over.
 *
 * What survives is the queue name and either a SQLSTATE-shaped code or the
 * error's class name -- enough to answer "why did parsing stop?" from the job
 * table alone, and structurally incapable of carrying a message, a stack, a
 * response body, or a Postgres `detail`.
 */
export class AiJobError extends Error {
  readonly queue: string;
  readonly sqlState: string | null;

  constructor(queue: string, cause: unknown) {
    const code =
      typeof cause === "object" && cause !== null && "code" in cause ? String(cause.code) : null;
    // Only an all-caps/digit SQLSTATE-shaped token is echoed; anything else
    // is dropped rather than trusted (same rule as HealthSyncJobError).
    const safeCode = code !== null && /^[A-Z0-9]{5}$/.test(code) ? code : null;
    const name = cause instanceof Error ? cause.name : "unknown";
    super(`${queue} failed (${safeCode ?? name})`);
    this.name = "AiJobError";
    this.queue = queue;
    this.sqlState = safeCode;
    // `cause` is deliberately NOT retained -- serialize-error special-cases
    // `cause` explicitly rather than relying on enumerability, so retaining
    // it would walk the provider payload straight back into the job table.
  }
}

/** Wraps a pg-boss batch handler so nothing provider-authored escapes it. */
export function withAiJobErrorContainment<T>(
  queue: string,
  handler: (jobs: T[]) => Promise<void>,
): (jobs: T[]) => Promise<void> {
  return async function containedAiJobHandler(jobs) {
    try {
      await handler(jobs);
    } catch (err) {
      throw new AiJobError(queue, err);
    }
  };
}
