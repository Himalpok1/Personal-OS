import { describe, expect, it } from "vitest";
import {
  SUMMARY_PREVIEW_MAX_CHARS,
  describeConfidenceFlags,
  parseSummaryHeadline,
  summarizeParseResult,
} from "./parse-summary";

const labels = (value: unknown) => summarizeParseResult(value).map((line) => line.label);
const byLabel = (value: unknown, label: string) =>
  summarizeParseResult(value).find((line) => line.label === label)?.value;

describe("summarizeParseResult", () => {
  it("describes a task with every optional field it carries", () => {
    const stored = {
      toolCall: {
        tool: "create_task",
        args: {
          title: "Call the insurance guy",
          due_at: "2026-09-14T15:00:00-05:00",
          remind_at: "2026-09-14T14:30:00-05:00",
          priority: 2,
          project: "House",
          rrule: "FREQ=WEEKLY;BYDAY=MO",
          recurrence_anchor: "completion_date",
        },
      },
      confidenceFlags: [],
    };
    expect(labels(stored)).toEqual([
      "Task",
      "Due",
      "Reminder",
      "Priority",
      "Project",
      "Repeats",
    ]);
    expect(byLabel(stored, "Task")).toBe("Call the insurance guy");
    expect(byLabel(stored, "Priority")).toBe("P2");
    expect(byLabel(stored, "Repeats")).toBe("FREQ=WEEKLY;BYDAY=MO (after each completion)");
    // A real instant renders as a locale label, not the ISO string.
    expect(byLabel(stored, "Due")).not.toContain("T15:00");
  });

  it("omits the optional lines a minimal task lacks", () => {
    expect(
      labels({ toolCall: { tool: "create_task", args: { title: "x" } }, confidenceFlags: [] }),
    ).toEqual(["Task"]);
  });

  it("describes a note with a bounded, single-line body preview", () => {
    const body = "line one\nline two " + "y".repeat(500);
    const stored = {
      toolCall: { tool: "create_note", args: { title: "Groceries", body } },
      confidenceFlags: [],
    };
    expect(labels(stored)).toEqual(["Note", "Body"]);
    const preview = byLabel(stored, "Body")!;
    expect(preview).not.toContain("\n");
    expect(preview.length).toBeLessThanOrEqual(SUMMARY_PREVIEW_MAX_CHARS);
    expect(preview.endsWith("…")).toBe(true);
  });

  it("describes an event including all-day, location and end", () => {
    const stored = {
      toolCall: {
        tool: "create_event",
        args: {
          title: "Dentist",
          start: "2026-09-14T15:00:00-05:00",
          end: "2026-09-14T16:00:00-05:00",
          location: "Main St",
          all_day: true,
        },
      },
      confidenceFlags: [],
    };
    expect(labels(stored)).toEqual(["Event", "All day", "Starts", "Ends", "Where"]);
  });

  it("explains an `unclear` result in prose rather than JSON", () => {
    const stored = {
      toolCall: { tool: "unclear", args: { reason: "one character, no verb" } },
      confidenceFlags: ["modelUnclear"],
    };
    const lines = summarizeParseResult(stored);
    expect(lines).toEqual([
      { label: "Couldn't classify", value: "one character, no verb" },
      { label: "Flagged because", value: "the parser couldn't classify it" },
    ]);
    for (const line of lines) {
      expect(line.value).not.toContain("{");
      expect(line.value).not.toContain("toolCall");
    }
  });

  it("appends the failure marker when the row was finalized by the dead-letter handler", () => {
    const stored = {
      toolCall: { tool: "create_note", args: { title: "T", body: "B" } },
      confidenceFlags: [],
      failure: { reason: "retries_exhausted", mode: "confirm", failed_at: "2026-09-10T12:00:00.000Z" },
    };
    expect(labels(stored)).toEqual(["Note", "Body", "Filing failed"]);
    expect(byLabel(stored, "Filing failed")).toMatch(/^Gave up after repeated attempts/);
  });

  it("reads a failure marker stored ALONE (the auto-parse path with no tool call)", () => {
    const alone = { reason: "retries_exhausted", mode: "auto", failed_at: "2026-09-10T12:00:00.000Z" };
    expect(labels(alone)).toEqual(["Filing failed"]);
  });

  it("describes the legacy no-provider `{error}` shape with a fixed sentence, never echoing it", () => {
    const lines = summarizeParseResult({ error: "no provider configured for capture_parser" });
    expect(lines).toEqual([
      { label: "Filing failed", value: "No AI provider was available to parse this." },
    ]);
  });

  it("is empty for nothing stored or an unrecognised shape", () => {
    expect(summarizeParseResult(null)).toEqual([]);
    expect(summarizeParseResult(undefined)).toEqual([]);
    expect(summarizeParseResult("nonsense")).toEqual([]);
    expect(summarizeParseResult({ toolCall: { tool: "not_a_tool" } })).toEqual([]);
    // The bare tool call the API stored for a correction before 8.4.
    expect(summarizeParseResult({ tool: "create_note", args: { title: "T", body: "B" } })).toEqual(
      [],
    );
  });

  it("strips control characters out of every previewed value", () => {
    const stored = {
      toolCall: { tool: "create_task", args: { title: "a\u0000b\u001Fc" } },
      confidenceFlags: [],
    };
    expect(byLabel(stored, "Task")).toBe("abc");
  });
});

describe("describeConfidenceFlags", () => {
  it("maps known flags to copy and passes an unknown token through so it stays visible", () => {
    expect(describeConfidenceFlags(["typeAmbiguous", "brandNewFlag"])).toBe(
      "unsure whether this is a task, note or event; brandNewFlag",
    );
  });

  it("is null for no flags", () => {
    expect(describeConfidenceFlags([])).toBeNull();
  });
});

describe("parseSummaryHeadline", () => {
  it("is the first line as 'Label: value', or null with nothing stored", () => {
    expect(
      parseSummaryHeadline({
        parse_result: { toolCall: { tool: "create_task", args: { title: "x" } }, confidenceFlags: [] },
      }),
    ).toBe("Task: x");
    expect(parseSummaryHeadline({ parse_result: null })).toBeNull();
  });
});
