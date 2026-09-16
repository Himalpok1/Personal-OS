import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  ACADEMIC_UPCOMING_DAY_COUNT,
  AcademicAnnouncementSchema,
  AcademicAssignmentSchema,
  AcademicCourseDetailResponseSchema,
  AcademicCourseSchema,
  AcademicCourseSummarySchema,
  AcademicCoursesQuerySchema,
  AcademicCoursesResponseSchema,
  AcademicEventSchema,
  AcademicTodayQuerySchema,
  AcademicTodayResponseSchema,
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
    ];
    let seen = 0;
    for (const schema of schemas) {
      const keys = keysOf(schema);
      seen += keys.length;
      for (const key of keys) expect(key, key).not.toMatch(FORBIDDEN);
    }
    // Positive control: the walk actually visited fields.
    expect(seen).toBeGreaterThan(40);
  });
});
