import type { Db } from "@personal-os/db";
import type { Job, PgBoss } from "pg-boss";
import { describe, expect, it } from "vitest";
import { AiJobError, withAiJobErrorContainment } from "./ai-job-error.js";
import { createCaptureParseHandler, type CaptureParseJobData } from "./capture-parse.js";
import { createPttTranscribeHandler, type PttTranscribeJobData } from "./ptt-transcribe.js";

// pg-boss hands a failing handler's thrown value to serialize-error, which
// copies every own-enumerable property into pgboss.job.output -- a durable
// Postgres table. This mimics that walk closely enough to prove containment.
// Same harness as calendar-job-error.test.ts.
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

const CAPTURE_TEXT = "remind me to call the insurance guy tomorrow at 3";
const PROVIDER_BODY = `{"error":{"message":"quota exceeded for org-SENTINEL"}}`;

// Shaped like a Vercel AI SDK APICallError: own-enumerable provider payload
// properties that serialize-error would copy verbatim.
function providerShapedError(): Error {
  return Object.assign(new Error(`transcription request failed: 429 ${PROVIDER_BODY}`), {
    responseBody: PROVIDER_BODY,
    requestBodyValues: { prompt: CAPTURE_TEXT },
    responseHeaders: { "x-request-id": "sentinel" },
  });
}

describe("AiJobError", () => {
  it("keeps a provider response body and the user's capture text out of what pg-boss would persist", () => {
    const persisted = serializeLikePgBoss(new AiJobError("ptt.transcribe", providerShapedError()));
    expect(persisted).not.toContain(PROVIDER_BODY);
    expect(persisted).not.toContain(CAPTURE_TEXT);
    expect(persisted).not.toContain("responseBody");
    expect(persisted).not.toContain("429");
  });

  it("echoes only a SQLSTATE-shaped code, never a Postgres detail", () => {
    const pgErr = Object.assign(new Error("duplicate key"), {
      code: "23505",
      detail: "Failing row contains (7, call the insurance guy, ...).",
    });
    const contained = new AiJobError("capture.parse", pgErr);
    expect(contained.sqlState).toBe("23505");
    expect(contained.message).toBe("capture.parse failed (23505)");
    const persisted = serializeLikePgBoss(contained);
    expect(persisted).not.toContain("insurance");
    expect(persisted).not.toContain("Failing row");
  });

  it("does not retain the cause", () => {
    const contained = new AiJobError("q", providerShapedError());
    expect((contained as { cause?: unknown }).cause).toBeUndefined();
  });
});

describe("withAiJobErrorContainment", () => {
  it("passes a successful batch through untouched", async () => {
    const seen: number[][] = [];
    const wrapped = withAiJobErrorContainment<number>("q", (jobs) => {
      seen.push(jobs);
      return Promise.resolve();
    });
    await wrapped([1, 2]);
    expect(seen).toEqual([[1, 2]]);
  });

  it("still fails the job -- containment must not swallow the failure", async () => {
    const wrapped = withAiJobErrorContainment<number>("q", () => {
      throw providerShapedError();
    });
    await expect(wrapped([1])).rejects.toBeInstanceOf(AiJobError);
  });
});

// The two factories must actually APPLY the containment -- deleting the
// wrapper from either factory fails these tests, which is what distinguishes
// them from the pure wrapper tests above. A fake db whose select() throws a
// provider-shaped error stands in for any escaping failure inside the batch.
function throwingDb(): Db {
  return {
    select: () => {
      throw providerShapedError();
    },
  } as unknown as Db;
}

const fakeBoss = {} as PgBoss;

describe("job factories apply containment", () => {
  it("capture.parse converts an escaping provider error into AiJobError", async () => {
    const handler = createCaptureParseHandler(throwingDb(), fakeBoss);
    const jobs = [{ data: { inboxId: "x" } }] as Job<CaptureParseJobData>[];
    const caught: unknown = await handler(jobs).then(
      () => null,
      (err: unknown) => err,
    );
    expect(caught).toBeInstanceOf(AiJobError);
    expect(serializeLikePgBoss(caught)).not.toContain(PROVIDER_BODY);
  });

  it("ptt.transcribe converts an escaping provider error into AiJobError", async () => {
    const handler = createPttTranscribeHandler(throwingDb(), fakeBoss);
    const jobs = [{ data: { inboxId: "x" } }] as Job<PttTranscribeJobData>[];
    const caught: unknown = await handler(jobs).then(
      () => null,
      (err: unknown) => err,
    );
    expect(caught).toBeInstanceOf(AiJobError);
    expect(serializeLikePgBoss(caught)).not.toContain(PROVIDER_BODY);
  });
});
