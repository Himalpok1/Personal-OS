import { ActionRequestCreateSchema, ENTITY_TITLE_MAX_CHARS } from "@personal-os/schema";
import { describe, expect, it } from "vitest";
import {
  ASSIGNMENT_SOURCE_REF,
  ASSIGNMENT_TASK_REASON,
  boundedTitle,
  buildAssignmentTaskRequest,
  buildStudyBlockRequest,
  nextStudyBlockStart,
  studyBlockReason,
} from "./build-assignment-requests";

const TZ = "America/Chicago";
const ASSIGNMENT = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Project milestone 2",
  due_at: "2026-09-23T04:59:00Z",
};

describe("nextStudyBlockStart", () => {
  it("rounds up to the next whole hour at least 15 minutes ahead, on the zone's wall clock", () => {
    // 14:10 Chicago -> 15:00
    expect(nextStudyBlockStart(new Date("2026-09-17T19:10:00Z"), TZ).toISOString()).toBe(
      "2026-09-17T20:00:00.000Z",
    );
    // 14:50 Chicago -> 16:00 (15:00 is only 10 minutes ahead)
    expect(nextStudyBlockStart(new Date("2026-09-17T19:50:00Z"), TZ).toISOString()).toBe(
      "2026-09-17T21:00:00.000Z",
    );
    // exactly 14:45 -> 15:00 (exactly 15 minutes ahead qualifies)
    expect(nextStudyBlockStart(new Date("2026-09-17T19:45:00Z"), TZ).toISOString()).toBe(
      "2026-09-17T20:00:00.000Z",
    );
    // on the hour -> one hour later
    expect(nextStudyBlockStart(new Date("2026-09-17T19:00:00Z"), TZ).toISOString()).toBe(
      "2026-09-17T20:00:00.000Z",
    );
  });

  it("is a whole hour in the zone across the fall-back transition", () => {
    // 2026-11-01 00:40 CDT (05:40Z) -> 01:00 CDT (06:00Z), the first 01:00.
    expect(nextStudyBlockStart(new Date("2026-11-01T05:40:00Z"), TZ).toISOString()).toBe(
      "2026-11-01T06:00:00.000Z",
    );
    // 00:50 CDT: the first 01:00 is only ten minutes ahead, so the block lands
    // on the second 01:00 (CST, 07:00Z) -- still a whole hour on the wall clock.
    expect(nextStudyBlockStart(new Date("2026-11-01T05:50:00Z"), TZ).toISOString()).toBe(
      "2026-11-01T07:00:00.000Z",
    );
  });
});

describe("buildStudyBlockRequest", () => {
  it("proposes a 60-minute local calendar event from Focus Now with an offset-bearing wall clock and no calendar link", () => {
    const request = buildStudyBlockRequest({
      assignment: ASSIGNMENT,
      now: new Date("2026-09-17T19:10:00Z"),
      tz: TZ,
    });
    expect(request).toEqual({
      action_id: "create_calendar_event",
      input: {
        title: "Study: Project milestone 2",
        starts_at: "2026-09-17T15:00:00-05:00",
        ends_at: "2026-09-17T16:00:00-05:00",
        timezone: TZ,
      },
      source: "focus_now",
      source_ref: ASSIGNMENT_SOURCE_REF,
      reason: "Due Sep 22 · 11:59 PM · from your Focus Now list",
    });
    expect(ActionRequestCreateSchema.safeParse(request).success).toBe(true);
  });

  it("still proposes the next hour when the assignment is already due, and says so honestly", () => {
    const request = buildStudyBlockRequest({
      assignment: { ...ASSIGNMENT, due_at: "2026-09-17T12:00:00Z" },
      now: new Date("2026-09-17T19:10:00Z"),
      tz: TZ,
    });
    expect(request.input).toMatchObject({ starts_at: "2026-09-17T15:00:00-05:00" });
    expect(request.reason).toBe("Due Sep 17 · 7:00 AM · from your Focus Now list");
  });

  it("names No due date for an undated assignment and bounds the title", () => {
    const long = "x".repeat(ENTITY_TITLE_MAX_CHARS + 50);
    const request = buildStudyBlockRequest({
      assignment: { ...ASSIGNMENT, title: long, due_at: null },
      now: new Date("2026-09-17T19:10:00Z"),
      tz: TZ,
    });
    expect((request.input as { title: string }).title.length).toBe(ENTITY_TITLE_MAX_CHARS);
    expect(request.reason).toBe("No due date · from your Focus Now list");
    expect(studyBlockReason({ due_at: null }, TZ)).toBe("No due date · from your Focus Now list");
    expect(ActionRequestCreateSchema.safeParse(request).success).toBe(true);
  });
});

describe("buildAssignmentTaskRequest", () => {
  it("proposes a one-off task linked to the assignment with its due instant", () => {
    const request = buildAssignmentTaskRequest({ assignment: ASSIGNMENT, tz: TZ });
    expect(request).toEqual({
      action_id: "create_task",
      input: {
        title: "Project milestone 2",
        due_at: "2026-09-23T04:59:00Z",
        canvas_assignment_id: ASSIGNMENT.id,
        timezone: TZ,
      },
      source: "academic",
      source_ref: ASSIGNMENT_SOURCE_REF,
      reason: ASSIGNMENT_TASK_REASON,
    });
    expect(ActionRequestCreateSchema.safeParse(request).success).toBe(true);
  });

  it("omits due_at for an undated assignment and never invents a reminder, priority or rule", () => {
    const request = buildAssignmentTaskRequest({
      assignment: { ...ASSIGNMENT, due_at: null },
      tz: TZ,
    });
    expect(request.input).toEqual({
      title: "Project milestone 2",
      canvas_assignment_id: ASSIGNMENT.id,
      timezone: TZ,
    });
    expect(ActionRequestCreateSchema.safeParse(request).success).toBe(true);
  });
});

describe("boundedTitle", () => {
  it("trims, cuts surrogate-safely to the shared bound, and falls back when empty", () => {
    expect(boundedTitle("  hi  ", "x")).toBe("hi");
    expect(boundedTitle("   ", "Study block")).toBe("Study block");
    const emoji = "😀".repeat(ENTITY_TITLE_MAX_CHARS + 5);
    const cut = boundedTitle(emoji, "x");
    expect(Array.from(cut)).toHaveLength(ENTITY_TITLE_MAX_CHARS);
    expect(cut.endsWith("😀")).toBe(true);
  });
});
