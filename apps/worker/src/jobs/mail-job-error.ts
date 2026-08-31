import { classifyMailFault } from "@personal-os/mail-providers";

/**
 * A deliberately information-poor wrapper for anything escaping a mail job.
 *
 * WHY THIS IS NEEDED
 * ------------------
 * pg-boss persists whatever a failing handler throws. `manager.js`'s
 * `mapCompletionDataArg` hands the thrown value to `serialize-error`, which
 * copies EVERY own-enumerable property onto the stored object -- and
 * `pgboss.job.output` is a durable Postgres table.
 *
 * For mail the payload in flight is the problem. A `pg` DatabaseError raised by
 * an insert into `mail_messages` carries `detail`, which for a CHECK or unique
 * violation is literally "Failing row contains (...)" -- the whole row,
 * SUBJECT LINE AND SENDER ADDRESS INCLUDED. ADR-054 states plainly that no
 * email subject, address or display name may appear in a log line; an
 * unwrapped throw would put one in a database table instead, which is worse.
 *
 * `HealthSyncJobError` applies exactly this containment to the health pass and
 * `CalendarJobError` to the three calendar jobs. ADR-053 requires every new
 * mail handler to be wrapped before registration, which is what
 * `withMailJobErrorContainment` is for.
 *
 * What survives is the queue name and a classification code from the closed
 * `MailSyncErrorCode` vocabulary, plus a SQLSTATE when there is one -- enough
 * to answer "why did sync stop?" from the job table alone, and structurally
 * incapable of carrying a message, a stack, a URL, a response body, a subject
 * or a Postgres `detail`.
 */
export class MailJobError extends Error {
  readonly queue: string;
  readonly classification: string;
  readonly sqlState: string | null;

  constructor(queue: string, cause: unknown) {
    // `refresh_token` as the operation is the conservative choice: it is the
    // only value that never maps a 404 to cursor expiry, and an escaped error
    // has already lost the context that would justify that interpretation.
    const classification = classifyMailFault(cause, "refresh_token").code;
    const code =
      typeof cause === "object" && cause !== null && "code" in cause
        ? String((cause as { code: unknown }).code)
        : null;
    // Only an all-caps/digit SQLSTATE-shaped token is echoed; anything else is
    // dropped rather than trusted.
    const sqlState = code !== null && /^[A-Z0-9]{5}$/.test(code) ? code : null;

    super(`${queue} failed (${classification}${sqlState !== null ? ` ${sqlState}` : ""})`);
    this.name = "MailJobError";
    this.queue = queue;
    this.classification = classification;
    this.sqlState = sqlState;
    // `cause` is deliberately NOT retained. `serialize-error` special-cases
    // `cause` explicitly rather than relying on enumerability, so keeping it
    // would walk the original payload straight back into the job table.
  }
}

/** Wraps a pg-boss batch handler so nothing provider- or row-authored escapes it. */
export function withMailJobErrorContainment<T>(
  queue: string,
  handler: (jobs: T[]) => Promise<void>,
): (jobs: T[]) => Promise<void> {
  return async function containedMailJobHandler(jobs) {
    try {
      await handler(jobs);
    } catch (err) {
      throw new MailJobError(queue, err);
    }
  };
}
