import { describe, expect, it } from "vitest";
import { ParserToolCallSchema } from "./parser-tools.js";

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
