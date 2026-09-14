import {
  ENTITY_TITLE_MAX_CHARS,
  EVENT_LOCATION_MAX_CHARS,
  NOTE_BODY_MAX_CHARS,
  PARSER_PROJECT_REF_MAX_CHARS,
  PARSER_REASON_MAX_CHARS,
  ParserToolCallSchema,
} from "@personal-os/schema";
import { describe, expect, it } from "vitest";
import { boundParserToolInput } from "./capture-parse.js";

/**
 * Checkpoint 9.6 (ADR-065) -- the model's tool-call arguments are bounded
 * BEFORE `ParserToolCallSchema.parse`, so an over-long model title becomes a
 * truncated title rather than a failed capture. The auto-parse path runs a
 * real `generateText`, so the bounding step is a pure exported function and
 * is pinned here directly; the round trip through the bounded schema is the
 * assertion that matters.
 */
describe("boundParserToolInput", () => {
  it("truncates every declared string argument of each tool to its bound, and the bounded schema then accepts it", () => {
    const cases: Array<{
      tool: string;
      input: Record<string, unknown>;
      expected: Record<string, number>;
    }> = [
      {
        tool: "create_task",
        input: {
          title: "t".repeat(ENTITY_TITLE_MAX_CHARS + 50),
          project: "p".repeat(PARSER_PROJECT_REF_MAX_CHARS + 50),
        },
        expected: { title: ENTITY_TITLE_MAX_CHARS, project: PARSER_PROJECT_REF_MAX_CHARS },
      },
      {
        tool: "create_note",
        input: {
          title: "t".repeat(ENTITY_TITLE_MAX_CHARS + 50),
          body: "b".repeat(NOTE_BODY_MAX_CHARS + 50),
          project: "p".repeat(PARSER_PROJECT_REF_MAX_CHARS + 50),
        },
        expected: {
          title: ENTITY_TITLE_MAX_CHARS,
          body: NOTE_BODY_MAX_CHARS,
          project: PARSER_PROJECT_REF_MAX_CHARS,
        },
      },
      {
        tool: "create_event",
        input: {
          title: "t".repeat(ENTITY_TITLE_MAX_CHARS + 50),
          start: "2026-09-14T10:00:00-05:00",
          location: "l".repeat(EVENT_LOCATION_MAX_CHARS + 50),
        },
        expected: { title: ENTITY_TITLE_MAX_CHARS, location: EVENT_LOCATION_MAX_CHARS },
      },
      {
        tool: "unclear",
        input: { reason: "r".repeat(PARSER_REASON_MAX_CHARS + 50) },
        expected: { reason: PARSER_REASON_MAX_CHARS },
      },
    ];

    for (const { tool, input, expected } of cases) {
      // The unbounded input is what the schema refuses -- the reason this
      // function exists.
      expect(ParserToolCallSchema.safeParse({ tool, args: input }).success, tool).toBe(false);

      const bounded = boundParserToolInput(tool, input);
      expect(bounded.truncatedArgs, tool).toBe(Object.keys(expected).length);
      const args = bounded.input as Record<string, unknown>;
      for (const [name, max] of Object.entries(expected)) {
        expect(args[name], `${tool}.${name}`).toHaveLength(max);
      }
      expect(ParserToolCallSchema.safeParse({ tool, args: bounded.input }).success, tool).toBe(
        true,
      );
    }
  });

  it("never cuts a surrogate pair in half", () => {
    const title = "x".repeat(ENTITY_TITLE_MAX_CHARS - 1) + "\u{1F600}" + "tail";
    const bounded = boundParserToolInput("create_task", { title });
    const args = bounded.input as { title: string };
    expect(args.title).toHaveLength(ENTITY_TITLE_MAX_CHARS - 1);
    expect(args.title.endsWith("x")).toBe(true);
  });

  it("leaves arguments within the bounds byte-identical and reports zero truncations", () => {
    const input = {
      title: "e".repeat(ENTITY_TITLE_MAX_CHARS),
      body: "milk \u{1F600}",
      project: "Home",
    };
    const bounded = boundParserToolInput("create_note", input);
    expect(bounded.truncatedArgs).toBe(0);
    expect(bounded.input).toEqual(input);
  });

  it("leaves non-string and undeclared arguments, and unknown tools, untouched", () => {
    const input = { title: 42, due_at: "2026-09-14T10:00:00-05:00", priority: 2 };
    expect(boundParserToolInput("create_task", input)).toEqual({ input, truncatedArgs: 0 });
    const weird = { title: "t".repeat(ENTITY_TITLE_MAX_CHARS + 50) };
    expect(boundParserToolInput("no_such_tool", weird)).toEqual({ input: weird, truncatedArgs: 0 });
    expect(boundParserToolInput("create_task", "not an object")).toEqual({
      input: "not an object",
      truncatedArgs: 0,
    });
  });
});
