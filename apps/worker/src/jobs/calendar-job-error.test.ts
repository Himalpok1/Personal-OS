import { CalDavError, GoogleOAuthError } from "@personal-os/calendar-providers";
import { describe, expect, it } from "vitest";
import { CalendarJobError, withCalendarJobErrorContainment } from "./calendar-job-error.js";

// pg-boss hands a failing handler's thrown value to serialize-error, which
// copies every own-enumerable property into pgboss.job.output -- a durable
// Postgres table. This mimics that walk closely enough to prove containment.
function serializeLikePgBoss(err: unknown): string {
  if (!(err instanceof Error)) return JSON.stringify(err);
  const out: Record<string, unknown> = {
    name: err.name,
    message: err.message,
    stack: err.stack,
  };
  for (const key in err) out[key] = (err as unknown as Record<string, unknown>)[key];
  if ((err as { cause?: unknown }).cause !== undefined) {
    out["cause"] = (err as { cause?: unknown }).cause;
  }
  return JSON.stringify(out);
}

const TOKEN = "ya29.SENTINEL-not-a-real-token";
const GOOGLE_PROSE = "Token has been expired or revoked.";

describe("CalendarJobError", () => {
  it("carries a classification and the queue, and nothing the provider wrote", () => {
    const err = new CalendarJobError(
      "calendar.google.sync-calendar",
      new GoogleOAuthError(GOOGLE_PROSE, 400, "invalid_grant"),
    );
    expect(err.classification).toBe("auth_expired");
    expect(err.queue).toBe("calendar.google.sync-calendar");
    expect(err.message).toBe("calendar.google.sync-calendar failed (auth_expired)");
  });

  it("keeps a CalDAV response body out of what pg-boss would persist", () => {
    const inner = new CalDavError("PUT failed", 500, `<body>${TOKEN}</body>`);
    const persisted = serializeLikePgBoss(
      new CalendarJobError("calendar.google.push-event", inner),
    );
    expect(persisted).not.toContain(TOKEN);
    expect(persisted).not.toContain("responseBody");
    expect(persisted).not.toContain("PUT failed");
  });

  it("does not retain the cause, which serialize-error would walk straight back into", () => {
    const contained = new CalendarJobError("q", new GoogleOAuthError(GOOGLE_PROSE, 400, undefined));
    expect((contained as { cause?: unknown }).cause).toBeUndefined();
    expect(serializeLikePgBoss(contained)).not.toContain(GOOGLE_PROSE);
  });

  it("contains a Postgres error's `detail`, which embeds the user's own row", () => {
    const pgErr = Object.assign(new Error("duplicate key"), {
      code: "23505",
      detail: "Failing row contains (7, call the insurance guy, ...).",
    });
    const persisted = serializeLikePgBoss(new CalendarJobError("q", pgErr));
    expect(persisted).not.toContain("insurance");
    expect(persisted).not.toContain("Failing row");
  });
});

describe("withCalendarJobErrorContainment", () => {
  it("passes a successful batch through untouched", async () => {
    const seen: number[][] = [];
    const wrapped = withCalendarJobErrorContainment<number>("q", (jobs) => {
      seen.push(jobs);
      return Promise.resolve();
    });
    await wrapped([1, 2, 3]);
    expect(seen).toEqual([[1, 2, 3]]);
  });

  it("replaces an escaping provider error with a contained one", async () => {
    const wrapped = withCalendarJobErrorContainment<number>("calendar.google.sync-calendar", () => {
      throw new CalDavError(GOOGLE_PROSE, 500, TOKEN);
    });
    await expect(wrapped([1])).rejects.toBeInstanceOf(CalendarJobError);
    const caught: unknown = await wrapped([1]).catch((err: unknown) => err);
    expect(serializeLikePgBoss(caught)).not.toContain(TOKEN);
  });

  it("still fails the job — containment must not swallow the failure", async () => {
    const wrapped = withCalendarJobErrorContainment<number>("q", () => {
      throw new Error("boom");
    });
    await expect(wrapped([1])).rejects.toThrow();
  });
});
