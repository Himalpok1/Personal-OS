import { describe, expect, it } from "vitest";
import {
  InboxConfirmRefusalSchema,
  InboxConfirmRequestSchema,
  readStoredParseResult,
  StoredParseResultSchema,
} from "./inbox.js";
import { isCommittableToolCall, type ParserToolCall } from "./parser-tools.js";

// Checkpoint 8.4. The confirm contract was unsound in three separate ways and
// every one of them failed silently in production.
describe("isCommittableToolCall", () => {
  it("rejects `unclear`, the one tool with no entity to create", () => {
    expect(isCommittableToolCall({ tool: "unclear", args: { reason: "no idea" } })).toBe(false);
  });

  it("accepts each of the three tools that do create an entity", () => {
    const committable: ParserToolCall[] = [
      { tool: "create_task", args: { title: "Call the insurer" } },
      { tool: "create_note", args: { title: "Groceries", body: "milk" } },
      { tool: "create_event", args: { title: "Standup", start: "2026-09-04T09:00:00-05:00" } },
    ];
    for (const call of committable) expect(isCommittableToolCall(call)).toBe(true);
  });
});

describe("readStoredParseResult", () => {
  it("reads the shape capture.parse persists", () => {
    const stored = {
      toolCall: { tool: "create_note", args: { title: "T", body: "B" } },
      confidenceFlags: ["modelUnclear"],
    };
    expect(readStoredParseResult(stored)).toEqual(stored);
  });

  it("returns null for the legacy {error} shape the no-provider path writes", () => {
    expect(readStoredParseResult({ error: "no provider configured" })).toBeNull();
  });

  it("returns null for a BARE tool call, which is what the API used to store", () => {
    // This is the second silent failure: a correction was written without the
    // `toolCall` wrapper, so the worker -- which reads `.toolCall` -- could
    // not see it and threw "has no parse_result to confirm".
    expect(
      readStoredParseResult({ tool: "create_note", args: { title: "T", body: "B" } }),
    ).toBeNull();
  });

  it("returns null rather than throwing for null and for junk", () => {
    expect(readStoredParseResult(null)).toBeNull();
    expect(readStoredParseResult(undefined)).toBeNull();
    expect(readStoredParseResult("nonsense")).toBeNull();
    expect(
      readStoredParseResult({ toolCall: { tool: "not_a_tool" }, confidenceFlags: [] }),
    ).toBeNull();
  });

  it("never invents a tool call from a partially-valid row", () => {
    expect(readStoredParseResult({ toolCall: { tool: "create_note", args: {} } })).toBeNull();
  });
});

describe("InboxConfirmRequestSchema", () => {
  it("accepts an omitted correction -- 'the parser was right, just commit it'", () => {
    expect(InboxConfirmRequestSchema.parse({})).toEqual({});
  });

  it("validates a correction against the tool-call union instead of accepting anything", () => {
    // `corrected_tool_call` was `z.unknown()` before 8.4, so a malformed
    // correction was stored and only failed later, inside the job.
    expect(() =>
      InboxConfirmRequestSchema.parse({ corrected_tool_call: { tool: "create_task" } }),
    ).toThrow();
    expect(() =>
      InboxConfirmRequestSchema.parse({ corrected_tool_call: "a note please" }),
    ).toThrow();
    expect(() =>
      InboxConfirmRequestSchema.parse({
        corrected_tool_call: { tool: "delete_everything", args: {} },
      }),
    ).toThrow();
  });

  it("accepts a well-formed correction", () => {
    const call = { tool: "create_note", args: { title: "T", body: "B" } };
    expect(InboxConfirmRequestSchema.parse({ corrected_tool_call: call })).toEqual({
      corrected_tool_call: call,
    });
  });
});

describe("StoredParseResultSchema / InboxConfirmRefusalSchema", () => {
  it("requires both members, so API and worker cannot disagree on the shape", () => {
    expect(() =>
      StoredParseResultSchema.parse({ toolCall: { tool: "unclear", args: { reason: "r" } } }),
    ).toThrow();
  });

  it("is a closed refusal vocabulary the client can map to copy", () => {
    expect(InboxConfirmRefusalSchema.options).toEqual([
      "parse_result_not_committable",
      "parse_result_unreadable",
    ]);
  });
});
