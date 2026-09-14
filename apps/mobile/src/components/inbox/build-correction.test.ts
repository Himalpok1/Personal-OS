import { CAPTURE_TEXT_MAX_LENGTH, ParserToolCallSchema } from "@personal-os/schema";
import { describe, expect, it } from "vitest";
import {
  EMPTY_FILE_AS_DRAFT,
  EVENT_DEFAULT_DURATION_MS,
  FILE_AS_TITLE_MAX_CHARS,
  bodyFromText,
  buildCorrectionFromDraft,
  buildEventCorrection,
  buildNoteCorrection,
  buildTaskCorrection,
  defaultTitleFor,
  firstLineTitle,
  titleFromText,
} from "./build-correction";

describe("titleFromText", () => {
  it("collapses newlines and runs of whitespace into one line", () => {
    expect(titleFromText("  call the\n\n insurance   guy\ttomorrow ")).toBe(
      "call the insurance guy tomorrow",
    );
  });

  it("strips control characters BEFORE bounding, so they cannot spend the budget", () => {
    const padding = "\u0000".repeat(FILE_AS_TITLE_MAX_CHARS);
    const visible = "x".repeat(FILE_AS_TITLE_MAX_CHARS);
    expect(titleFromText(padding + visible)).toBe(visible);
    expect(titleFromText("a\u0007b\u009Fc")).toBe("abc");
  });

  it("caps at FILE_AS_TITLE_MAX_CHARS with a single ellipsis, never longer", () => {
    const long = "word ".repeat(100);
    const title = titleFromText(long);
    expect(title.length).toBeLessThanOrEqual(FILE_AS_TITLE_MAX_CHARS);
    expect(title.endsWith("…")).toBe(true);
  });

  it("does not split a surrogate pair at the cap", () => {
    const emoji = "😀";
    const title = titleFromText("a".repeat(FILE_AS_TITLE_MAX_CHARS - 2) + emoji + "tail");
    expect(title).not.toMatch(/[\uD800-\uDBFF]…$/);
    expect(title.endsWith("…")).toBe(true);
  });

  it("is empty for blank or control-only input -- never a placeholder", () => {
    expect(titleFromText("")).toBe("");
    expect(titleFromText("   \n ")).toBe("");
    expect(titleFromText("\u0000\u0001")).toBe("");
  });
});

describe("firstLineTitle", () => {
  it("takes the first NON-BLANK line", () => {
    expect(firstLineTitle("\n\n  Groceries \nmilk\neggs")).toBe("Groceries");
  });

  it("handles CRLF", () => {
    expect(firstLineTitle("Title\r\nbody")).toBe("Title");
  });

  it("is empty when every line is blank", () => {
    expect(firstLineTitle("\n \n")).toBe("");
  });
});

describe("bodyFromText", () => {
  it("keeps newlines, strips controls, trims, and bounds to the server's capture limit", () => {
    expect(bodyFromText(" a\nb\u0000c ")).toBe("a\nbc");
    expect(bodyFromText("x".repeat(CAPTURE_TEXT_MAX_LENGTH + 50)).length).toBe(
      CAPTURE_TEXT_MAX_LENGTH,
    );
  });
});

describe("buildTaskCorrection", () => {
  it("builds a create_task whose title is the capture text, validating against the wire schema", () => {
    const call = buildTaskCorrection("remind me to call the insurance guy");
    expect(call).toEqual({
      tool: "create_task",
      args: { title: "remind me to call the insurance guy" },
    });
    expect(ParserToolCallSchema.safeParse(call).success).toBe(true);
  });

  it("carries the chosen due instant verbatim and omits the key when unset", () => {
    const due = "2026-09-14T15:00:00-05:00";
    expect(buildTaskCorrection("x", { dueAt: due })?.args).toEqual({ title: "x", due_at: due });
    expect(buildTaskCorrection("x", { dueAt: null })?.args).toEqual({ title: "x" });
    expect(ParserToolCallSchema.safeParse(buildTaskCorrection("x", { dueAt: due })).success).toBe(
      true,
    );
  });

  it("prefers an owner-edited title, normalized the same way, and falls back when the edit is blank", () => {
    expect(buildTaskCorrection("raw", { title: "  Edited\ntitle " })?.args).toEqual({
      title: "Edited title",
    });
    expect(buildTaskCorrection("raw", { title: "   " })?.args).toEqual({ title: "raw" });
  });

  it("is null when there is no title to give -- a create_task with an empty title is a 400", () => {
    expect(buildTaskCorrection("")).toBeNull();
    expect(buildTaskCorrection("\u0000")).toBeNull();
  });
});

describe("buildNoteCorrection", () => {
  it("titles the note by its first line and bodies it with the whole text", () => {
    const call = buildNoteCorrection("Groceries\nmilk\neggs");
    expect(call).toEqual({
      tool: "create_note",
      args: { title: "Groceries", body: "Groceries\nmilk\neggs" },
    });
    expect(ParserToolCallSchema.safeParse(call).success).toBe(true);
  });

  it("is null for blank text", () => {
    expect(buildNoteCorrection("  \n")).toBeNull();
  });
});

describe("buildEventCorrection", () => {
  const TZ = "America/Chicago";

  it("ends exactly one hour after the start, rendered in the given zone", () => {
    const call = buildEventCorrection("Dentist", {
      start: "2026-09-14T15:00:00-05:00",
      timezone: TZ,
    });
    expect(call).toEqual({
      tool: "create_event",
      args: { title: "Dentist", start: "2026-09-14T15:00:00-05:00", end: "2026-09-14T16:00:00-05:00" },
    });
    expect(ParserToolCallSchema.safeParse(call).success).toBe(true);
  });

  it("computes the end on the INSTANT across a DST transition", () => {
    // 2026-11-01 01:30 CDT is thirty minutes before the fall-back in Chicago.
    // Sixty real minutes later is 01:30 CST -- same wall clock, new offset.
    const call = buildEventCorrection("Late", {
      start: "2026-11-01T01:30:00-05:00",
      timezone: TZ,
    });
    expect(call?.args).toMatchObject({ end: "2026-11-01T01:30:00-06:00" });
    const start = new Date("2026-11-01T01:30:00-05:00").getTime();
    expect(new Date((call?.args as { end: string }).end).getTime() - start).toBe(
      EVENT_DEFAULT_DURATION_MS,
    );
  });

  it("is null without a start, with an unparseable start, or without a title", () => {
    expect(buildEventCorrection("x", { start: null, timezone: TZ })).toBeNull();
    expect(buildEventCorrection("x", { start: "not a date", timezone: TZ })).toBeNull();
    expect(buildEventCorrection("", { start: "2026-09-14T15:00:00-05:00", timezone: TZ })).toBeNull();
  });
});

describe("the File-as draft", () => {
  const raw = "Dentist appointment\nbring the referral";

  it("seeds a note title from the first line and a task/event title from the whole text", () => {
    expect(defaultTitleFor("note", raw)).toBe("Dentist appointment");
    expect(defaultTitleFor("task", raw)).toBe("Dentist appointment bring the referral");
    expect(defaultTitleFor("event", raw)).toBe("Dentist appointment bring the referral");
  });

  it("is not submittable with no kind chosen", () => {
    expect(buildCorrectionFromDraft(raw, EMPTY_FILE_AS_DRAFT)).toBeNull();
  });

  it("submits each kind with the draft's fields", () => {
    const start = "2026-09-14T15:00:00-05:00";
    expect(
      buildCorrectionFromDraft(raw, { kind: "task", title: "Dentist", dueAt: start, startAt: null }),
    ).toEqual({ tool: "create_task", args: { title: "Dentist", due_at: start } });
    expect(
      buildCorrectionFromDraft(raw, { kind: "note", title: "", dueAt: null, startAt: null }),
    ).toEqual({ tool: "create_note", args: { title: "Dentist appointment", body: raw } });
    expect(
      buildCorrectionFromDraft(
        raw,
        { kind: "event", title: "Dentist", dueAt: null, startAt: start },
        "America/Chicago",
      ),
    ).toEqual({
      tool: "create_event",
      args: { title: "Dentist", start, end: "2026-09-14T16:00:00-05:00" },
    });
  });

  it("an event draft without a start is not submittable", () => {
    expect(
      buildCorrectionFromDraft(raw, { kind: "event", title: "x", dueAt: null, startAt: null }),
    ).toBeNull();
  });
});
