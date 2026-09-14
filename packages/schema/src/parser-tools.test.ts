import { describe, expect, it } from "vitest";
import {
  isCommittableToolCall,
  ParserToolCallSchema,
  StoredParserToolCallSchema,
} from "./parser-tools.js";
import { ENTITY_TITLE_MAX_CHARS, PARSER_REASON_MAX_CHARS } from "./text-bounds.js";

describe("ParserToolCallSchema", () => {
  it("parses a create_task tool call", () => {
    const result = ParserToolCallSchema.safeParse({
      tool: "create_task",
      args: { title: "Call the insurance guy", due_at: "2026-08-16T15:00:00Z" },
    });
    expect(result.success).toBe(true);
  });

  it("parses an unclear tool call", () => {
    const result = ParserToolCallSchema.safeParse({
      tool: "unclear",
      args: { reason: "ambiguous phrasing" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a tool name outside the four known tools", () => {
    const result = ParserToolCallSchema.safeParse({
      tool: "delete_everything",
      args: {},
    });
    expect(result.success).toBe(false);
  });

  it("rejects args that don't match the discriminated tool", () => {
    // create_note requires body; omitted here.
    const result = ParserToolCallSchema.safeParse({
      tool: "create_note",
      args: { title: "Some note" },
    });
    expect(result.success).toBe(false);
  });
});

// Checkpoint 9.6: the tool schemas gained `.max()` bounds, but rows written
// before then can carry longer text. Reading them must not become a 409.
describe("StoredParserToolCallSchema vs ParserToolCallSchema", () => {
  const longTitle = "x".repeat(ENTITY_TITLE_MAX_CHARS + 88);
  const longReason = "y".repeat(PARSER_REASON_MAX_CHARS + 1);

  it("the stored (unbounded) union reads a legacy over-bound title; the wire union refuses it", () => {
    const call = { tool: "create_task", args: { title: longTitle } };
    expect(StoredParserToolCallSchema.safeParse(call).success).toBe(true);
    const wire = ParserToolCallSchema.safeParse(call);
    expect(wire.success).toBe(false);
    if (!wire.success) {
      expect(wire.error.issues.map((issue) => issue.path)).toEqual([["args", "title"]]);
    }
  });

  it("holds for every tool's bounded text field", () => {
    const calls = [
      { tool: "create_note", args: { title: longTitle, body: "" } },
      { tool: "create_event", args: { title: longTitle, start: "2026-09-14T09:00:00" } },
      { tool: "unclear", args: { reason: longReason } },
    ];
    for (const call of calls) {
      expect(StoredParserToolCallSchema.safeParse(call).success, call.tool).toBe(true);
      expect(ParserToolCallSchema.safeParse(call).success, call.tool).toBe(false);
    }
  });

  it("the stored union is still strict about shape: unknown tools and missing fields fail", () => {
    expect(
      StoredParserToolCallSchema.safeParse({ tool: "delete_everything", args: {} }).success,
    ).toBe(false);
    expect(
      StoredParserToolCallSchema.safeParse({ tool: "create_note", args: { title: "x" } }).success,
    ).toBe(false);
    expect(
      StoredParserToolCallSchema.safeParse({ tool: "create_task", args: { title: "" } }).success,
    ).toBe(false);
  });

  it("isCommittableToolCall accepts a stored call and a wire call alike", () => {
    const stored = StoredParserToolCallSchema.parse({
      tool: "create_task",
      args: { title: longTitle },
    });
    const wire = ParserToolCallSchema.parse({ tool: "unclear", args: { reason: "vague" } });
    expect(isCommittableToolCall(stored)).toBe(true);
    expect(isCommittableToolCall(wire)).toBe(false);
  });
});
