import {
  ACADEMIC_COURSE_ATTENTION_LEVELS,
  ACADEMIC_PRIORITY_REASONS,
  ACADEMIC_URGENCY_LEVELS,
  ACADEMIC_WORKLOAD_STATUSES,
  HIGH_POINTS_THRESHOLD,
  URGENCY_HIGH_WINDOW_HOURS,
} from "@personal-os/core/academic/urgency";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  ACADEMIC_COURSE_ATTENTION_ITEM_CAP,
  ACADEMIC_HIGH_POINTS_THRESHOLD,
  ACADEMIC_PRIORITIES_ITEM_CAP,
  ACADEMIC_UPCOMING_DAY_COUNT,
  ACADEMIC_URGENCY_HIGH_WINDOW_HOURS,
  AcademicAnnouncementSchema,
  AcademicAssignmentSchema,
  AcademicCourseAttentionLevelSchema,
  AcademicCourseAttentionSchema,
  AcademicCourseDetailResponseSchema,
  AcademicCourseSchema,
  AcademicCourseSummarySchema,
  AcademicCoursesQuerySchema,
  AcademicCoursesResponseSchema,
  AcademicEventSchema,
  AcademicGradeSummarySchema,
  AcademicPriorityItemSchema,
  AcademicPriorityReasonSchema,
  AcademicTodayQuerySchema,
  AcademicTodayResponseSchema,
  AcademicUrgencySchema,
  AcademicWorkloadDaySchema,
  AcademicWorkloadSchema,
  AcademicWorkloadStatusSchema,
} from "./academic.js";

// Checkpoint 10.2 (ADR-070) wire-contract tests. Structural, not behavioral:
// the read model's derivations (open, percentage, statuses, bucketing) are
// tested where they are computed, in packages/core and apps/api. This file
// pins what the shapes can and cannot express.

const BASE_URL = "https://uta.instructure.com";

const COURSE = {
  id: "22222222-2222-4222-8222-222222222222",
  source: "canvas",
  external_id: "98765",
  connection_id: "11111111-1111-4111-8111-111111111111",
  name: "Advanced Web Development",
  code: "INSY-4315",
  term: { name: "Fall 2026", starts_at: "2026-08-24T05:00:00Z", ends_at: "2026-12-12T05:59:00Z" },
  status: "active",
  html_url: `${BASE_URL}/courses/98765`,
  source_base_url: BASE_URL,
  archived_at: null,
  created_at: "2026-09-16T12:00:00Z",
  updated_at: "2026-09-16T12:00:00Z",
};

const COURSE_SUMMARY = {
  ...COURSE,
  open_assignment_count: 3,
  overdue_assignment_count: 1,
  next_due_at: "2026-09-22T04:59:00Z",
};

const ASSIGNMENT = {
  id: "33333333-3333-4333-8333-333333333333",
  source: "canvas",
  external_id: "555111",
  course_id: COURSE.id,
  course_name: COURSE.name,
  course_code: COURSE.code,
  title: "Homework 3",
  due_at: "2026-09-22T04:59:00Z",
  points_possible: 100,
  submission: { status: "unsubmitted", missing: false, late: false, submitted_at: null },
  grade: { status: "not_graded", score: null, grade: null, percentage: null },
  open: true,
  published: true,
  html_url: `${BASE_URL}/courses/98765/assignments/555111`,
  source_base_url: BASE_URL,
  archived_at: null,
};

const ANNOUNCEMENT = {
  id: "44444444-4444-4444-8444-444444444444",
  source: "canvas",
  external_id: "777",
  course_id: COURSE.id,
  course_name: COURSE.name,
  title: "Midterm reminder",
  preview: "The midterm is next Tuesday.",
  posted_at: "2026-09-15T14:00:00Z",
  read: false,
  html_url: `${BASE_URL}/courses/98765/discussion_topics/777`,
  source_base_url: BASE_URL,
  archived_at: null,
};

const EVENT = {
  kind: "calendar_event",
  id: "55555555-5555-4555-8555-555555555555",
  source: "canvas",
  course_id: COURSE.id,
  course_name: COURSE.name,
  title: "Guest lecture",
  at: "2026-09-18T19:00:00Z",
  ends_at: "2026-09-18T20:15:00Z",
  all_day: false,
  location: "ERB 129",
  html_url: `${BASE_URL}/calendar?event_id=9`,
  source_base_url: BASE_URL,
};

function emptySection() {
  return { items: [], total: 0 };
}

const TODAY = {
  generated_at: "2026-09-16T13:00:00Z",
  effective_now: "2026-09-16T13:00:00Z",
  tz: "America/Chicago",
  local_date: "2026-09-16",
  configured: true,
  summary: {
    overdue_total: 1,
    due_today_total: 0,
    due_this_week_total: 2,
    missing_total: 1,
    unread_announcements_total: 1,
  },
  overdue: { items: [ASSIGNMENT], total: 1 },
  due_today: emptySection(),
  due_this_week: { items: [], total: 2 },
  announcements: { items: [ANNOUNCEMENT], total: 1 },
  events: { items: [EVENT], total: 1 },
};

// Checkpoint 10.3 fixtures -- every one wraps or sits BESIDE the untouched
// item shapes above, never extends them.
const PRIORITY_ITEM = {
  assignment: ASSIGNMENT,
  urgency: "medium",
  score: 225,
  reasons: ["due_this_week", "high_points"],
  hours_until_due: 135.9,
};

const WORKLOAD_DAY = { date: "2026-09-16", due_total: 1, points_total: 100 };

const WORKLOAD = {
  status: "behind",
  open_total: 4,
  overdue_total: 1,
  missing_total: 1,
  due_within_24h_total: 0,
  due_this_week_total: 2,
  points_at_stake: 150,
  horizon_days: 7,
  days: [
    WORKLOAD_DAY,
    { date: "2026-09-17", due_total: 0, points_total: 0 },
    { date: "2026-09-18", due_total: 1, points_total: 50 },
    { date: "2026-09-19", due_total: 0, points_total: 0 },
    { date: "2026-09-20", due_total: 0, points_total: 0 },
    { date: "2026-09-21", due_total: 1, points_total: 0 },
    { date: "2026-09-22", due_total: 0, points_total: 0 },
    { date: "2026-09-23", due_total: 0, points_total: 0 },
  ],
};

const COURSE_ATTENTION = {
  course_id: COURSE.id,
  course_name: COURSE.name,
  course_code: COURSE.code,
  open_total: 3,
  overdue_total: 1,
  due_within_24h_total: 0,
  due_this_week_total: 2,
  next_due_at: "2026-09-22T04:59:00Z",
  attention: "high",
};

const GRADE_SUMMARY = {
  graded_total: 7,
  average_percentage: 91.4,
  points_earned: 63.94,
  points_possible_graded: 70,
  weighted_percentage: 91.3,
};

const TODAY_WITH_INTELLIGENCE = {
  ...TODAY,
  current_term: { name: "2026 Fall", starts_at: "2026-08-03T05:00:00Z" },
  priorities: { items: [PRIORITY_ITEM], total: 1 },
  workload: WORKLOAD,
  course_attention: { items: [COURSE_ATTENTION], total: 1 },
};

/** Walk a schema's keys (one level deep for nested objects) for a forbidden name. */
function keysOf(schema: z.ZodTypeAny): string[] {
  const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
  if (!shape) return [];
  return Object.entries(shape).flatMap(([key, value]) => {
    const nested = (value as z.ZodObject<z.ZodRawShape>).shape;
    return nested ? [key, ...Object.keys(nested).map((k) => `${key}.${k}`)] : [key];
  });
}

describe("AcademicCourseSchema / AcademicCourseSummarySchema", () => {
  it("parses a full course and a summary", () => {
    expect(AcademicCourseSchema.parse(COURSE).status).toBe("active");
    expect(AcademicCourseSummarySchema.parse(COURSE_SUMMARY).open_assignment_count).toBe(3);
  });

  it("rejects an unknown course status and an unknown key", () => {
    expect(() => AcademicCourseSchema.parse({ ...COURSE, status: "available" })).toThrow();
    expect(() => AcademicCourseSchema.parse({ ...COURSE, enrollment_state: "active" })).toThrow();
  });

  it("rejects a source it has never heard of", () => {
    expect(() => AcademicCourseSchema.parse({ ...COURSE, source: "moodle" })).toThrow();
  });
});

describe("AcademicAssignmentSchema", () => {
  it("parses an open, ungraded assignment", () => {
    expect(AcademicAssignmentSchema.parse(ASSIGNMENT).open).toBe(true);
  });

  it("parses a graded assignment with a derived percentage", () => {
    const graded = {
      ...ASSIGNMENT,
      submission: {
        status: "graded",
        missing: false,
        late: false,
        submitted_at: "2026-09-21T20:00:00Z",
      },
      grade: { status: "graded", score: 97, grade: "A", percentage: 97 },
      open: false,
    };
    expect(AcademicAssignmentSchema.parse(graded).grade.percentage).toBe(97);
  });

  it("accepts an extra-credit percentage above 100 (never clamped)", () => {
    const extra = {
      ...ASSIGNMENT,
      grade: { status: "graded", score: 110, grade: "A+", percentage: 110 },
    };
    expect(AcademicAssignmentSchema.parse(extra).grade.percentage).toBe(110);
  });

  it("rejects a provider submission string that was not normalized", () => {
    expect(() =>
      AcademicAssignmentSchema.parse({
        ...ASSIGNMENT,
        submission: { ...ASSIGNMENT.submission, status: "submitted_late" },
      }),
    ).toThrow();
  });

  // ADR-068 §3, unchanged by ADR-068a: no description, no entered_* twins,
  // no attachments -- on the wire any more than in the table.
  it("cannot express description, entered_score, entered_grade or attachments", () => {
    for (const key of ["description", "entered_score", "entered_grade", "attachments"]) {
      expect(() => AcademicAssignmentSchema.parse({ ...ASSIGNMENT, [key]: "x" })).toThrow();
      expect(() =>
        AcademicAssignmentSchema.parse({
          ...ASSIGNMENT,
          grade: { ...ASSIGNMENT.grade, [key]: "x" },
        }),
      ).toThrow();
    }
  });
});

describe("AcademicAnnouncementSchema / AcademicEventSchema", () => {
  it("parses an announcement with a nullable read flag", () => {
    expect(AcademicAnnouncementSchema.parse(ANNOUNCEMENT).read).toBe(false);
    expect(AcademicAnnouncementSchema.parse({ ...ANNOUNCEMENT, read: null }).read).toBeNull();
  });

  it("parses each event kind and a personal (course-less) event", () => {
    for (const kind of ["assignment_due", "calendar_event", "announcement"]) {
      expect(AcademicEventSchema.parse({ ...EVENT, kind }).kind).toBe(kind);
    }
    expect(
      AcademicEventSchema.parse({ ...EVENT, course_id: null, course_name: null }).course_id,
    ).toBeNull();
  });

  it("rejects an unknown event kind", () => {
    expect(() => AcademicEventSchema.parse({ ...EVENT, kind: "exam" })).toThrow();
  });
});

describe("AcademicTodayResponseSchema", () => {
  it("parses a full response", () => {
    expect(AcademicTodayResponseSchema.parse(TODAY).summary.overdue_total).toBe(1);
  });

  it("parses the not-configured shape (empty sections, zero totals)", () => {
    const unconfigured = {
      ...TODAY,
      configured: false,
      summary: {
        overdue_total: 0,
        due_today_total: 0,
        due_this_week_total: 0,
        missing_total: 0,
        unread_announcements_total: 0,
      },
      overdue: emptySection(),
      due_today: emptySection(),
      due_this_week: emptySection(),
      announcements: emptySection(),
      events: emptySection(),
    };
    expect(AcademicTodayResponseSchema.parse(unconfigured).configured).toBe(false);
  });

  it("refuses a section whose total is smaller than its emitted items (honest totals)", () => {
    expect(() =>
      AcademicTodayResponseSchema.parse({ ...TODAY, overdue: { items: [ASSIGNMENT], total: 0 } }),
    ).toThrow();
  });

  it("requires a valid IANA tz on the query, exactly like /today", () => {
    expect(AcademicTodayQuerySchema.parse({ tz: "America/Chicago" }).tz).toBe("America/Chicago");
    expect(() => AcademicTodayQuerySchema.parse({ tz: "Mars/Olympus" })).toThrow();
    expect(() => AcademicTodayQuerySchema.parse({})).toThrow();
  });

  it("uses Today's own 7-day upcoming horizon", () => {
    expect(ACADEMIC_UPCOMING_DAY_COUNT).toBe(7);
  });
});

describe("courses routes", () => {
  it("parses include_past_terms as a boolean query param, default false (ADR-070a)", () => {
    expect(AcademicCoursesQuerySchema.parse({}).include_past_terms).toBe(false);
    expect(
      AcademicCoursesQuerySchema.parse({ include_past_terms: "true" }).include_past_terms,
    ).toBe(true);
  });

  it("accepts and echoes current_term on the courses and today responses, nullable and optional", () => {
    const term = { name: "2026 Fall", starts_at: "2026-08-03T05:00:00Z" };
    expect(
      AcademicCoursesResponseSchema.parse({ configured: true, current_term: term, items: [] })
        .current_term,
    ).toEqual(term);
    expect(
      AcademicCoursesResponseSchema.parse({ configured: true, current_term: null, items: [] })
        .current_term,
    ).toBeNull();
    // The versionCode-25 client's compiled schema predates the key: absent must still parse.
    expect(
      AcademicCoursesResponseSchema.parse({ configured: true, items: [] }).current_term,
    ).toBeUndefined();
    expect(
      AcademicTodayResponseSchema.parse({ ...TODAY, current_term: term }).current_term,
    ).toEqual(term);
    expect(() =>
      AcademicCoursesResponseSchema.parse({
        configured: true,
        current_term: { name: "x" },
        items: [],
      }),
    ).toThrow();
  });

  it("parses include_archived as a boolean query param, default false", () => {
    expect(AcademicCoursesQuerySchema.parse({}).include_archived).toBe(false);
    expect(AcademicCoursesQuerySchema.parse({ include_archived: "true" }).include_archived).toBe(
      true,
    );
    expect(() => AcademicCoursesQuerySchema.parse({ include_archived: "yes" })).toThrow();
  });

  it("parses a course detail response", () => {
    const detail = {
      course: COURSE_SUMMARY,
      assignments: [ASSIGNMENT],
      announcements: [ANNOUNCEMENT],
      events: [EVENT],
    };
    expect(AcademicCourseDetailResponseSchema.parse(detail).assignments).toHaveLength(1);
  });
});

describe("Checkpoint 10.3 -- the closed vocabularies mirror core exactly", () => {
  it("urgency, reason, workload status and attention level enums equal core's as-const arrays", () => {
    expect(AcademicUrgencySchema.options).toEqual([...ACADEMIC_URGENCY_LEVELS]);
    expect(AcademicPriorityReasonSchema.options).toEqual([...ACADEMIC_PRIORITY_REASONS]);
    expect(AcademicWorkloadStatusSchema.options).toEqual([...ACADEMIC_WORKLOAD_STATUSES]);
    expect(AcademicCourseAttentionLevelSchema.options).toEqual([
      ...ACADEMIC_COURSE_ATTENTION_LEVELS,
    ]);
  });

  it("the two thresholds equal core's constants and the caps are the documented values", () => {
    expect(ACADEMIC_URGENCY_HIGH_WINDOW_HOURS).toBe(URGENCY_HIGH_WINDOW_HOURS);
    expect(ACADEMIC_URGENCY_HIGH_WINDOW_HOURS).toBe(24);
    expect(ACADEMIC_HIGH_POINTS_THRESHOLD).toBe(HIGH_POINTS_THRESHOLD);
    expect(ACADEMIC_HIGH_POINTS_THRESHOLD).toBe(50);
    expect(ACADEMIC_PRIORITIES_ITEM_CAP).toBe(5);
    expect(ACADEMIC_COURSE_ATTENTION_ITEM_CAP).toBe(10);
  });

  it("rejects a member none of the four enums has heard of", () => {
    expect(() => AcademicUrgencySchema.parse("urgent")).toThrow();
    expect(() => AcademicPriorityReasonSchema.parse("important")).toThrow();
    expect(() => AcademicWorkloadStatusSchema.parse("ok")).toThrow();
    expect(() => AcademicCourseAttentionLevelSchema.parse("critical")).toThrow();
  });
});

describe("AcademicPriorityItemSchema", () => {
  it("parses a priority item wrapping an untouched assignment", () => {
    const parsed = AcademicPriorityItemSchema.parse(PRIORITY_ITEM);
    expect(parsed.assignment).toEqual(AcademicAssignmentSchema.parse(ASSIGNMENT));
    expect(parsed.reasons).toEqual(["due_this_week", "high_points"]);
  });

  it("accepts a negative hours_until_due (overdue) and a null one, and an empty reasons list", () => {
    expect(
      AcademicPriorityItemSchema.parse({
        ...PRIORITY_ITEM,
        urgency: "critical",
        score: 400,
        reasons: ["overdue"],
        hours_until_due: -2.5,
      }).hours_until_due,
    ).toBe(-2.5);
    expect(
      AcademicPriorityItemSchema.parse({
        ...PRIORITY_ITEM,
        urgency: "low",
        score: 100,
        reasons: [],
        hours_until_due: null,
      }).reasons,
    ).toEqual([]);
  });

  it("rejects a non-integer or negative score, an unknown reason, and an unknown key", () => {
    expect(() => AcademicPriorityItemSchema.parse({ ...PRIORITY_ITEM, score: 1.5 })).toThrow();
    expect(() => AcademicPriorityItemSchema.parse({ ...PRIORITY_ITEM, score: -1 })).toThrow();
    expect(() =>
      AcademicPriorityItemSchema.parse({ ...PRIORITY_ITEM, reasons: ["because"] }),
    ).toThrow();
    expect(() => AcademicPriorityItemSchema.parse({ ...PRIORITY_ITEM, rank: 1 })).toThrow();
  });
});

describe("AcademicWorkloadSchema / AcademicWorkloadDaySchema", () => {
  it("parses a workload with eight local days", () => {
    const parsed = AcademicWorkloadSchema.parse(WORKLOAD);
    expect(parsed.days).toHaveLength(8);
    expect(parsed.status).toBe("behind");
    expect(AcademicWorkloadDaySchema.parse(WORKLOAD_DAY).due_total).toBe(1);
  });

  it("parses the zeroed not-configured workload", () => {
    const zeroed = {
      ...WORKLOAD,
      status: "on_track",
      open_total: 0,
      overdue_total: 0,
      missing_total: 0,
      due_within_24h_total: 0,
      due_this_week_total: 0,
      points_at_stake: 0,
      days: WORKLOAD.days.map((d) => ({ ...d, due_total: 0, points_total: 0 })),
    };
    expect(AcademicWorkloadSchema.parse(zeroed).status).toBe("on_track");
  });

  it("rejects a non-date day, a negative total, a fractional count and an unknown key", () => {
    expect(() =>
      AcademicWorkloadDaySchema.parse({ ...WORKLOAD_DAY, date: "2026-09-16T00:00:00Z" }),
    ).toThrow();
    expect(() => AcademicWorkloadDaySchema.parse({ ...WORKLOAD_DAY, points_total: -1 })).toThrow();
    expect(() => AcademicWorkloadDaySchema.parse({ ...WORKLOAD_DAY, due_total: 0.5 })).toThrow();
    expect(() => AcademicWorkloadDaySchema.parse({ ...WORKLOAD_DAY, label: "Wed" })).toThrow();
    expect(() => AcademicWorkloadSchema.parse({ ...WORKLOAD, trend: "up" })).toThrow();
  });
});

describe("AcademicCourseAttentionSchema", () => {
  it("parses a course-attention row and a null next_due_at", () => {
    expect(AcademicCourseAttentionSchema.parse(COURSE_ATTENTION).attention).toBe("high");
    expect(
      AcademicCourseAttentionSchema.parse({ ...COURSE_ATTENTION, next_due_at: null }).next_due_at,
    ).toBeNull();
  });

  it("rejects an unknown level and an unknown key", () => {
    expect(() =>
      AcademicCourseAttentionSchema.parse({ ...COURSE_ATTENTION, attention: "urgent" }),
    ).toThrow();
    expect(() =>
      AcademicCourseAttentionSchema.parse({ ...COURSE_ATTENTION, html_url: BASE_URL }),
    ).toThrow();
  });
});

describe("AcademicGradeSummarySchema", () => {
  it("parses a summary and an all-null one with a zero count", () => {
    expect(AcademicGradeSummarySchema.parse(GRADE_SUMMARY).weighted_percentage).toBe(91.3);
    expect(
      AcademicGradeSummarySchema.parse({
        graded_total: 0,
        average_percentage: null,
        points_earned: null,
        points_possible_graded: null,
        weighted_percentage: null,
      }).average_percentage,
    ).toBeNull();
  });

  it("rejects a fractional count and an unknown key", () => {
    expect(() =>
      AcademicGradeSummarySchema.parse({ ...GRADE_SUMMARY, graded_total: 1.5 }),
    ).toThrow();
    expect(() =>
      AcademicGradeSummarySchema.parse({ ...GRADE_SUMMARY, letter_grade: "A" }),
    ).toThrow();
  });
});

describe("Checkpoint 10.3 -- response compatibility with the deployed versionCode-25 client", () => {
  it("the Today response parses WITH the three new keys", () => {
    const parsed = AcademicTodayResponseSchema.parse(TODAY_WITH_INTELLIGENCE);
    expect(parsed.priorities?.items[0]?.urgency).toBe("medium");
    expect(parsed.workload?.days).toHaveLength(8);
    expect(parsed.course_attention?.items[0]?.attention).toBe("high");
  });

  it("the Today and course-detail responses still parse WITHOUT them (the deployed client's shape)", () => {
    const today = AcademicTodayResponseSchema.parse(TODAY);
    expect(today.priorities).toBeUndefined();
    expect(today.workload).toBeUndefined();
    expect(today.course_attention).toBeUndefined();
    const detail = AcademicCourseDetailResponseSchema.parse({
      course: COURSE_SUMMARY,
      assignments: [ASSIGNMENT],
      announcements: [],
      events: [],
    });
    expect(detail.grade_summary).toBeUndefined();
    expect(
      AcademicCourseDetailResponseSchema.parse({
        course: COURSE_SUMMARY,
        assignments: [],
        announcements: [],
        events: [],
        grade_summary: GRADE_SUMMARY,
      }).grade_summary?.graded_total,
    ).toBe(7);
  });

  it("a priorities section with a dishonest total is refused like every other section", () => {
    expect(() =>
      AcademicTodayResponseSchema.parse({
        ...TODAY_WITH_INTELLIGENCE,
        priorities: { items: [PRIORITY_ITEM], total: 0 },
      }),
    ).toThrow();
  });

  it("urgency, score and reasons NEVER leaked onto an item schema -- every strict item still rejects them", () => {
    const leaks = { urgency: "high", score: 300, reasons: ["due_within_24h"], attention: "high" };
    for (const [key, value] of Object.entries(leaks)) {
      expect(() => AcademicAssignmentSchema.parse({ ...ASSIGNMENT, [key]: value })).toThrow();
      expect(() =>
        AcademicCourseSummarySchema.parse({ ...COURSE_SUMMARY, [key]: value }),
      ).toThrow();
      expect(() => AcademicCourseSchema.parse({ ...COURSE, [key]: value })).toThrow();
      expect(() => AcademicAnnouncementSchema.parse({ ...ANNOUNCEMENT, [key]: value })).toThrow();
      expect(() => AcademicEventSchema.parse({ ...EVENT, [key]: value })).toThrow();
    }
    // And the wrapped assignment inside a priority item is the strict schema too.
    expect(() =>
      AcademicPriorityItemSchema.parse({
        ...PRIORITY_ITEM,
        assignment: { ...ASSIGNMENT, urgency: "high" },
      }),
    ).toThrow();
  });
});

describe("structural exclusions across every academic schema", () => {
  const FORBIDDEN =
    /(description|entered_score|entered_grade|attachments|access_token|ciphertext|auth_tag|last_sync_error|error_message|failure_class)/i;

  it("no academic schema can name a description, entered_* grade, attachment, credential or error-prose field", () => {
    const schemas = [
      AcademicCourseSchema,
      AcademicCourseSummarySchema,
      AcademicAssignmentSchema,
      AcademicAnnouncementSchema,
      AcademicEventSchema,
      // Checkpoint 10.3 shapes -- every new schema joins the walk.
      AcademicPriorityItemSchema,
      AcademicWorkloadDaySchema,
      AcademicWorkloadSchema,
      AcademicCourseAttentionSchema,
      AcademicGradeSummarySchema,
    ];
    let seen = 0;
    for (const schema of schemas) {
      const keys = keysOf(schema);
      seen += keys.length;
      for (const key of keys) expect(key, key).not.toMatch(FORBIDDEN);
    }
    // Positive control: the walk actually visited fields, including the
    // 10.3 additions (5 + 3 + 9 + 9 + 5 = 31 more top-level keys, plus the
    // priority item's nested assignment keys).
    expect(seen).toBeGreaterThan(80);
  });
});
