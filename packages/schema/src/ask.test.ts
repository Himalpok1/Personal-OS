import { describe, expect, it } from "vitest";
import {
  ASK_QUESTION_MAX_CHARS,
  ASK_QUESTION_MIN_CHARS,
  AskRequestSchema,
  AskResponseSchema,
} from "./ask.js";

describe("AskRequestSchema", () => {
  it("accepts an ordinary question", () => {
    const result = AskRequestSchema.safeParse({ question: "what did I say about the renewal?" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.question).toBe("what did I say about the renewal?");
  });

  it("control-strips BEFORE measuring length (Checkpoint 8.1 ordering)", () => {
    // A question made almost entirely of a zero-width/control character
    // would, if measured on the RAW string, pass a length check it should
    // fail once the invisible codepoints are gone.
    const raw = "a​​​​​​b"; // "ab" once stripped -- 2 chars, below the minimum
    const result = AskRequestSchema.safeParse({ question: raw });
    expect(result.success).toBe(false);
  });

  it(`rejects a question shorter than ${ASK_QUESTION_MIN_CHARS} characters after stripping`, () => {
    expect(AskRequestSchema.safeParse({ question: "hi" }).success).toBe(false);
  });

  it(`rejects a question longer than ${ASK_QUESTION_MAX_CHARS} characters after stripping`, () => {
    const result = AskRequestSchema.safeParse({ question: "a".repeat(ASK_QUESTION_MAX_CHARS + 1) });
    expect(result.success).toBe(false);
  });

  it(`accepts a question of exactly ${ASK_QUESTION_MAX_CHARS} characters`, () => {
    const result = AskRequestSchema.safeParse({ question: "a".repeat(ASK_QUESTION_MAX_CHARS) });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown field -- the body carries a question and nothing else", () => {
    const result = AskRequestSchema.safeParse({ question: "a real question here", q: "ignored" });
    expect(result.success).toBe(false);
  });

  it("rejects a missing question", () => {
    expect(AskRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("AskResponseSchema", () => {
  const VALID = {
    answer: "You have one task about renewing the insurance policy.",
    sources: [
      {
        ref: 1,
        type: "task" as const,
        id: "6a51f2b6-3d0c-4a35-9a4f-3e0f5d6a7b8c",
        title: "Renew insurance",
      },
    ],
    redactions: 0,
    model_id: "6a51f2b6-3d0c-4a35-9a4f-3e0f5d6a7b8c",
  };

  it("accepts a well-formed response", () => {
    expect(AskResponseSchema.safeParse(VALID).success).toBe(true);
  });

  it("accepts a null model_id and an empty sources array (the no-provider-yet edge case)", () => {
    expect(AskResponseSchema.safeParse({ ...VALID, sources: [], model_id: null }).success).toBe(
      true,
    );
  });

  it("rejects a source carrying anything beyond ref/type/id/title -- no body, no snippet, no score", () => {
    const result = AskResponseSchema.safeParse({
      ...VALID,
      sources: [{ ...VALID.sources[0], body: "should never be here" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a source type outside the closed set", () => {
    const result = AskResponseSchema.safeParse({
      ...VALID,
      sources: [{ ...VALID.sources[0], type: "mail_message" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown top-level field -- no room for a stray model-returned key", () => {
    const result = AskResponseSchema.safeParse({ ...VALID, extra: "nope" });
    expect(result.success).toBe(false);
  });
});
