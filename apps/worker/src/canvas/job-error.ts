import { classifyCanvasFault } from "@personal-os/canvas-providers";

/**
 * A deliberately information-poor wrapper for anything escaping a Canvas job.
 *
 * Mirrors apps/worker/src/jobs/mail-job-error.ts's `MailJobError` exactly, for
 * the identical reason: pg-boss persists whatever a failing handler throws
 * (`manager.js`'s `mapCompletionDataArg` hands it to `serialize-error`, which
 * copies every own-enumerable property onto `pgboss.job.output`, a durable
 * Postgres table). A Canvas error body can echo the offending request back
 * (ADR-068 §5), and a raw `pg` `DatabaseError` from an insert can carry
 * `detail` -- "Failing row contains (...)" -- an instructor's course name or
 * assignment title included. Written as its own small copy rather than a
 * shared generic wrapper, per this codebase's standing precedent (ADR-052)
 * of deliberate near-duplication per provider over premature sharing --
 * `MailJobError` is mail-specific (it reads `code`/SQLSTATE the identical
 * way, but classifies through `classifyMailFault`, not `classifyCanvasFault`).
 *
 * What survives is the queue name and a classification from the closed
 * `CanvasFailureClass` vocabulary, plus a SQLSTATE when there is one --
 * structurally incapable of carrying a message, a stack, a URL, a response
 * body, a course name or a Postgres `detail`.
 */
export class CanvasJobError extends Error {
  readonly queue: string;
  readonly classification: string;
  readonly sqlState: string | null;

  constructor(queue: string, cause: unknown) {
    const classification = classifyCanvasFault(cause).failureClass;
    const code =
      typeof cause === "object" && cause !== null && "code" in cause ? String(cause.code) : null;
    // Only an all-caps/digit SQLSTATE-shaped token is echoed; anything else is
    // dropped rather than trusted.
    const sqlState = code !== null && /^[A-Z0-9]{5}$/.test(code) ? code : null;

    super(`${queue} failed (${classification}${sqlState !== null ? ` ${sqlState}` : ""})`);
    this.name = "CanvasJobError";
    this.queue = queue;
    this.classification = classification;
    this.sqlState = sqlState;
    // `cause` is deliberately NOT retained -- `serialize-error` special-cases
    // it explicitly rather than relying on enumerability, so keeping it would
    // walk the original payload straight back into the job table.
  }
}

/** Wraps a pg-boss batch handler so nothing provider- or row-authored escapes it. */
export function withCanvasJobErrorContainment<T>(
  queue: string,
  handler: (jobs: T[]) => Promise<void>,
): (jobs: T[]) => Promise<void> {
  return async function containedCanvasJobHandler(jobs) {
    try {
      await handler(jobs);
    } catch (err) {
      throw new CanvasJobError(queue, err);
    }
  };
}
