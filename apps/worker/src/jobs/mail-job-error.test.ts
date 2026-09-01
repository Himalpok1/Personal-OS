import { GmailApiError, GmailOAuthError } from "@personal-os/mail-providers";
import { MailSyncErrorCodeSchema } from "@personal-os/schema";
import { describe, expect, it } from "vitest";
import { MailJobError, withMailJobErrorContainment } from "./mail-job-error.js";

const QUEUE = "mail.gmail.sync-connection";

/**
 * What pg-boss actually persists.
 *
 * `mapCompletionDataArg` hands a thrown value to `serialize-error`, which walks
 * every own-enumerable property. This approximates that walk so the assertions
 * are about what reaches `pgboss.job.output` rather than about what the error
 * looks like in a debugger.
 */
function serializeLikePgBoss(err: unknown): string {
  if (typeof err !== "object" || err === null) return String(err);
  const out: Record<string, unknown> = {
    name: (err as Error).name,
    message: (err as Error).message,
    stack: (err as Error).stack,
  };
  for (const key in err) out[key] = (err as Record<string, unknown>)[key];
  return JSON.stringify(out);
}

describe("MailJobError", () => {
  it("carries a queue name and a closed-vocabulary classification", () => {
    const err = new MailJobError(QUEUE, new GmailApiError(500, "INTERNAL", [], null));
    expect(err.queue).toBe(QUEUE);
    expect(() => MailSyncErrorCodeSchema.parse(err.classification)).not.toThrow();
    expect(err.classification).toBe("provider_unavailable");
  });

  it("DESTROYS a Postgres detail, which is the whole point", () => {
    // A CHECK or unique violation's `detail` is literally
    // "Failing row contains (...)" -- the whole row, subject line and sender
    // address included -- and pg-boss would write it to a durable table.
    const pgError = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
      detail:
        "Failing row contains (m1, t1, 2026-09-01, ada@example.com, example.com, Ada Lovelace, Your verification code is 483920).",
      table: "mail_messages",
      constraint: "mail_messages_connection_external_id_unique",
    });

    const contained = new MailJobError(QUEUE, pgError);
    const persisted = serializeLikePgBoss(contained);

    expect(persisted).not.toContain("Failing row");
    expect(persisted).not.toContain("ada@example.com");
    expect(persisted).not.toContain("483920");
    expect(persisted).not.toContain("Ada Lovelace");
    // The SQLSTATE survives, because it is the part that tells you which
    // constraint fired without telling you what was in the row.
    expect(contained.sqlState).toBe("23505");
    expect(persisted).toContain("23505");
  });

  it("destroys provider prose", () => {
    const gmail = new GmailApiError(400, "INVALID_ARGUMENT", [], null);
    Object.defineProperty(gmail, "message", {
      value: 'Unknown name "startHistoryId": Cannot find field.',
      enumerable: true,
    });

    const persisted = serializeLikePgBoss(new MailJobError(QUEUE, gmail));
    expect(persisted).not.toContain("startHistoryId");
    expect(persisted).toContain("invalid_request");
  });

  it("does NOT retain the cause", () => {
    // `serialize-error` special-cases `cause` explicitly rather than relying on
    // enumerability, so retaining it would walk the original payload straight
    // back into the job table.
    const cause = Object.assign(new Error("secret"), { detail: "a subject line" });
    const contained = new MailJobError(QUEUE, cause);
    expect((contained as { cause?: unknown }).cause).toBeUndefined();
    expect(serializeLikePgBoss(contained)).not.toContain("a subject line");
  });

  it("drops a code that is not SQLSTATE-shaped rather than trusting it", () => {
    const err = new MailJobError(QUEUE, Object.assign(new Error("x"), { code: "ECONNREFUSED" }));
    expect(err.sqlState).toBeNull();
    expect(serializeLikePgBoss(err)).not.toContain("ECONNREFUSED");
  });

  it("classifies an OAuth failure without carrying its error_description", () => {
    const oauth = new GmailOAuthError("invalid_grant", 400);
    const contained = new MailJobError(QUEUE, oauth);
    expect(contained.classification).toBe("auth_expired");
  });

  it("never maps a bare 404 to cursor expiry", () => {
    // An escaped error has already lost the context that would justify that
    // interpretation, so the wrapper uses the one operation that never makes it:
    // a wrongly-inferred cursor expiry would trigger a needless full resync.
    const contained = new MailJobError(QUEUE, new GmailApiError(404, "NOT_FOUND", [], null));
    expect(contained.classification).toBe("not_found");
  });

  it("handles a non-Error throw", () => {
    expect(new MailJobError(QUEUE, "just a string").classification).toBe("network_error");
    expect(new MailJobError(QUEUE, null).classification).toBe("network_error");
  });
});

describe("withMailJobErrorContainment", () => {
  it("passes a successful handler straight through", async () => {
    let ran = false;
    const wrapped = withMailJobErrorContainment<number>(QUEUE, () => {
      ran = true;
      return Promise.resolve();
    });
    await wrapped([1]);
    expect(ran).toBe(true);
  });

  it("wraps ANYTHING the handler throws", async () => {
    const wrapped = withMailJobErrorContainment<number>(QUEUE, () =>
      Promise.reject(
        Object.assign(new Error("boom"), { code: "23514", detail: "Failing row contains (...)" }),
      ),
    );

    await expect(wrapped([1])).rejects.toBeInstanceOf(MailJobError);
    await wrapped([1]).catch((err: unknown) => {
      expect(serializeLikePgBoss(err)).not.toContain("Failing row");
    });
  });
});
