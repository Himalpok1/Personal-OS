import { CANVAS_TITLE_MAX_CHARS } from "@personal-os/core/canvas/provider-strings";
import { describe, expect, it } from "vitest";
import type {
  CanvasAnnouncementApiShape,
  CanvasAssignmentApiShape,
  CanvasCalendarEventApiShape,
  CanvasCourseApiShape,
} from "./canvas-client.js";
import {
  CANVAS_GRADE_MAX_CHARS,
  translateCanvasAnnouncement,
  translateCanvasAssignment,
  translateCanvasCalendarEvent,
  translateCanvasCourse,
} from "./translate.js";

// Fixtures are built from the real field shapes the ADR-068 live probe
// against uta.instructure.com confirmed -- not invented ones.

function okCourse(payload: CanvasCourseApiShape) {
  const result = translateCanvasCourse(payload);
  if (!result.ok) throw new Error(`expected translation to succeed: ${result.rejection.keyPath}`);
  return result.row;
}

function okAssignment(payload: CanvasAssignmentApiShape, courseId: string | number = 12345) {
  const result = translateCanvasAssignment(payload, courseId);
  if (!result.ok) throw new Error(`expected translation to succeed: ${result.rejection.keyPath}`);
  return result.row;
}

function okAnnouncement(payload: CanvasAnnouncementApiShape, courseId: string | number = 12345) {
  const result = translateCanvasAnnouncement(payload, courseId);
  if (!result.ok) throw new Error(`expected translation to succeed: ${result.rejection.keyPath}`);
  return result.row;
}

function okCalendarEvent(payload: CanvasCalendarEventApiShape, courseId: string | number = 12345) {
  const result = translateCanvasCalendarEvent(payload, courseId);
  if (!result.ok) throw new Error(`expected translation to succeed: ${result.rejection.keyPath}`);
  return result.row;
}

describe("translateCanvasCourse", () => {
  it("pulls name/code/term/enrollment-and-workflow-state/html_url out of a real course shape", () => {
    const row = okCourse({
      id: 12345,
      name: "Calculus II",
      course_code: "MATH-1426",
      term: {
        id: 22,
        name: "Fall 2026 - UT Arlington",
        start_at: "2026-08-24T00:00:00Z",
        end_at: "2026-12-12T00:00:00Z",
      },
      enrollments: [{ enrollment_state: "active" }],
      workflow_state: "available",
      html_url: "https://uta.instructure.com/courses/12345",
      // Excluded-by-design fields Canvas genuinely returns; present in the
      // payload but must not surface anywhere on the row.
      uuid: "abc123",
      license: "private",
      storage_quota_mb: 500,
      is_public: false,
    });

    expect(row.externalId).toBe("12345");
    expect(row.name).toBe("Calculus II");
    expect(row.courseCode).toBe("MATH-1426");
    expect(row.termName).toBe("Fall 2026 - UT Arlington");
    expect(row.termStartAt?.toISOString()).toBe("2026-08-24T00:00:00.000Z");
    expect(row.termEndAt?.toISOString()).toBe("2026-12-12T00:00:00.000Z");
    expect(row.enrollmentState).toBe("active");
    expect(row.workflowState).toBe("available");
    expect(row.htmlUrl).toBe("https://uta.instructure.com/courses/12345");

    expect(row).not.toHaveProperty("uuid");
    expect(row).not.toHaveProperty("license");
    expect(row).not.toHaveProperty("storageQuotaMb");
    expect(row).not.toHaveProperty("isPublic");
  });

  it("reads enrollment_state from the FIRST enrollment only", () => {
    const row = okCourse({
      id: 1,
      enrollments: [{ enrollment_state: "active" }, { enrollment_state: "completed" }],
    });
    expect(row.enrollmentState).toBe("active");
  });

  it("is null-safe when a course has no term, no enrollments, and no html_url", () => {
    const row = okCourse({ id: 1, name: "Independent Study" });
    expect(row.termName).toBeNull();
    expect(row.termStartAt).toBeNull();
    expect(row.termEndAt).toBeNull();
    expect(row.enrollmentState).toBeNull();
    expect(row.htmlUrl).toBeNull();
  });

  it("rejects a course with no id, carrying no value", () => {
    const result = translateCanvasCourse({ id: undefined as unknown as number, name: "X" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.rejection).toEqual({ keyPath: "id", received: "missing" });
  });

  it("rejects an unparseable term.start_at rather than storing a wrong date", () => {
    const result = translateCanvasCourse({
      id: 1,
      term: { start_at: "not-a-date" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.rejection.keyPath).toBe("term.start_at");
    expect(result.rejection.received).toBe("string");
  });

  it("truncates a course name at the shared title bound rather than storing it unbounded", () => {
    const overLong = "x".repeat(CANVAS_TITLE_MAX_CHARS + 50);
    const row = okCourse({ id: 1, name: overLong });
    expect(row.name).toHaveLength(CANVAS_TITLE_MAX_CHARS);
  });
});

describe("translateCanvasAssignment", () => {
  it("keeps title/due_at/points_possible/submission_types/published/html_url, the coarse submission facts, and score/grade", () => {
    const row = okAssignment(
      {
        id: 98765,
        name: "Homework 3",
        due_at: "2026-09-20T05:59:00Z",
        points_possible: 100,
        submission_types: ["online_upload", "online_text_entry"],
        html_url: "https://uta.instructure.com/courses/12345/assignments/98765",
        published: true,
        workflow_state: "published",
        submission: {
          workflow_state: "graded",
          missing: false,
          late: true,
          submitted_at: "2026-09-19T22:00:00Z",
          // Checkpoint 10.2 (ADR-068a): score and grade DO reach the row.
          score: 95,
          grade: "A",
          // Real, populated fields Canvas genuinely returns -- must never
          // reach the row.
          entered_score: 95,
          entered_grade: "A",
          attachments: [{ id: 1, filename: "hw3.pdf" }],
        },
        description: "<p>Complete problems 1-20.</p>",
      },
      12345,
    );

    expect(row.externalId).toBe("98765");
    expect(row.courseExternalId).toBe("12345");
    expect(row.title).toBe("Homework 3");
    expect(row.dueAt?.toISOString()).toBe("2026-09-20T05:59:00.000Z");
    expect(row.pointsPossible).toBe(100);
    expect(row.submissionTypes).toEqual(["online_upload", "online_text_entry"]);
    expect(row.htmlUrl).toBe("https://uta.instructure.com/courses/12345/assignments/98765");
    expect(row.published).toBe(true);
    expect(row.workflowState).toBe("published");
    expect(row.submissionState).toBe("graded");
    expect(row.submissionMissing).toBe(false);
    expect(row.submissionLate).toBe(true);
    expect(row.submittedAt?.toISOString()).toBe("2026-09-19T22:00:00.000Z");
    expect(row.score).toBe(95);
    expect(row.grade).toBe("A");
  });

  // Checkpoint 10.2 (ADR-068a). The row's key set is pinned EXACTLY, not
  // merely "does not have X": a future field added to the row without a
  // deliberate decision fails here, which is the point -- ADR-068 §3's
  // exclusions were enforced by omission, and omission is only a guarantee
  // if something notices when it stops being one.
  it("carries exactly the approved key set -- score and grade in, entered_* / attachments / description out", () => {
    const row = okAssignment({
      id: 1,
      name: "Quiz 1",
      submission: {
        score: 42,
        grade: "B+",
        entered_score: 40,
        entered_grade: "B",
        attachments: [{ id: 9 }],
      },
      description: "<p>secret rubric</p>",
    });

    expect(Object.keys(row).sort()).toEqual(
      [
        "courseExternalId",
        "dueAt",
        "externalId",
        "grade",
        "htmlUrl",
        "pointsPossible",
        "published",
        "score",
        "submissionLate",
        "submissionMissing",
        "submissionState",
        "submissionTypes",
        "submittedAt",
        "title",
        "workflowState",
      ].sort(),
    );
    for (const forbidden of [
      "enteredScore",
      "enteredGrade",
      "entered_score",
      "entered_grade",
      "attachments",
      "description",
    ]) {
      expect(row).not.toHaveProperty(forbidden);
    }
    // And the two that ARE present carry the submission's own values, not
    // the entered_* near-duplicates.
    expect(row.score).toBe(42);
    expect(row.grade).toBe("B+");
  });

  it("is null-safe for an assignment with no submission and no due date", () => {
    const row = okAssignment({ id: 1, name: "Reading" });
    expect(row.dueAt).toBeNull();
    expect(row.pointsPossible).toBeNull();
    expect(row.submissionTypes).toEqual([]);
    expect(row.submissionState).toBeNull();
    expect(row.submissionMissing).toBe(false);
    expect(row.submissionLate).toBe(false);
    expect(row.submittedAt).toBeNull();
    expect(row.published).toBe(false);
    expect(row.score).toBeNull();
    expect(row.grade).toBeNull();
  });

  it("yields null score and grade for a submission Canvas has not graded (null fields)", () => {
    const row = okAssignment({
      id: 1,
      name: "Essay",
      submission: { workflow_state: "submitted", score: null, grade: null },
    });
    expect(row.submissionState).toBe("submitted");
    expect(row.score).toBeNull();
    expect(row.grade).toBeNull();
  });

  it("yields null score for a non-finite or non-numeric score rather than rejecting the assignment", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const row = okAssignment({ id: 1, name: "X", submission: { score: bad, grade: "A" } });
      expect(row.score).toBeNull();
      // The grade is independent of the score's validity.
      expect(row.grade).toBe("A");
    }
    const stringScore = okAssignment({
      id: 1,
      name: "X",
      submission: { score: "95" as unknown as number },
    });
    expect(stringScore.score).toBeNull();
  });

  it("yields null grade for a non-string grade rather than rejecting the assignment", () => {
    const row = okAssignment({
      id: 1,
      name: "X",
      submission: { score: 7.5, grade: 95 as unknown as string },
    });
    expect(row.grade).toBeNull();
    expect(row.score).toBe(7.5);
  });

  it("truncates an over-long grade string at CANVAS_GRADE_MAX_CHARS rather than rejecting it", () => {
    const overLong = "A".repeat(CANVAS_GRADE_MAX_CHARS + 20);
    const row = okAssignment({ id: 1, name: "X", submission: { grade: overLong } });
    expect(row.grade).toHaveLength(CANVAS_GRADE_MAX_CHARS);
    expect(row.grade).toBe("A".repeat(CANVAS_GRADE_MAX_CHARS));
  });

  it("keeps the real display-grade vocabulary verbatim: letter, percent, numeric and pass/fail forms", () => {
    for (const grade of ["A", "A-", "95", "95%", "complete", "incomplete", "pass", "fail"]) {
      const row = okAssignment({ id: 1, name: "X", submission: { score: 1, grade } });
      expect(row.grade).toBe(grade);
    }
  });

  it("rejects an unparseable submission.submitted_at rather than storing a wrong date", () => {
    const result = translateCanvasAssignment(
      { id: 1, name: "X", submission: { submitted_at: "garbage" } },
      1,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.rejection.keyPath).toBe("submission.submitted_at");
  });

  it("rejects a missing course id without carrying its value", () => {
    const result = translateCanvasAssignment({ id: 1, name: "X" }, undefined as unknown as number);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.rejection).toEqual({ keyPath: "courseId", received: "missing" });
  });

  it("caps and dedupes-by-emptiness a garbage submission_types array", () => {
    const row = okAssignment({
      id: 1,
      name: "X",
      submission_types: ["online_upload", "", 123 as unknown as string, null as unknown as string],
    });
    expect(row.submissionTypes).toEqual(["online_upload"]);
  });
});

describe("translateCanvasAnnouncement", () => {
  it("strips HTML from message to a plain-text preview and keeps title/posted_at/html_url/read_state", () => {
    const row = okAnnouncement({
      id: 555,
      title: "Midterm rescheduled",
      message: "<p>The midterm exam has been moved to <strong>next Friday</strong>.</p>",
      posted_at: "2026-09-10T14:00:00Z",
      html_url: "https://uta.instructure.com/courses/12345/discussion_topics/555",
      read_state: "unread",
      context_code: "course_12345",
    });

    expect(row.externalId).toBe("555");
    expect(row.courseExternalId).toBe("12345");
    expect(row.title).toBe("Midterm rescheduled");
    // stripHtmlToPlainText replaces each tag with a space (not empty string)
    // before collapsing whitespace runs, so the closing </strong> before the
    // sentence's final period leaves one space ahead of it -- a faithful,
    // if imperfect, plain-text rendering of the real HTML, not a defect.
    expect(row.messagePreview).toBe("The midterm exam has been moved to next Friday .");
    expect(row.postedAt?.toISOString()).toBe("2026-09-10T14:00:00.000Z");
    expect(row.htmlUrl).toBe("https://uta.instructure.com/courses/12345/discussion_topics/555");
    expect(row.readState).toBe("unread");
  });

  it("stores the real, non-empty 712-char-class announcement message as a bounded plain-text preview", () => {
    const richMessage =
      "<div><p>" +
      "Reminder: office hours moved. ".repeat(30) +
      "</p><ul><li>See syllabus</li></ul></div>";
    const row = okAnnouncement({ id: 1, title: "Office hours", message: richMessage });
    expect(row.messagePreview).not.toContain("<");
    expect(row.messagePreview).not.toContain(">");
    expect(row.messagePreview).toContain("Reminder: office hours moved.");
  });

  it("is null-safe for an announcement with no message", () => {
    const row = okAnnouncement({ id: 1, title: "Heads up" });
    expect(row.messagePreview).toBeNull();
  });

  it("rejects an unparseable posted_at rather than storing a wrong date", () => {
    const result = translateCanvasAnnouncement({ id: 1, title: "X", posted_at: "not-a-date" }, 1);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.rejection.keyPath).toBe("posted_at");
  });
});

describe("translateCanvasCalendarEvent", () => {
  it("keeps title/start_at/end_at/all_day/location_name/html_url", () => {
    const row = okCalendarEvent({
      id: 321,
      title: "Guest Lecture",
      start_at: "2026-10-01T18:00:00Z",
      end_at: "2026-10-01T19:00:00Z",
      all_day: false,
      location_name: "Room 204",
      html_url: "https://uta.instructure.com/calendar?event_id=321",
    });

    expect(row.externalId).toBe("321");
    expect(row.courseExternalId).toBe("12345");
    expect(row.title).toBe("Guest Lecture");
    expect(row.startAt?.toISOString()).toBe("2026-10-01T18:00:00.000Z");
    expect(row.endAt?.toISOString()).toBe("2026-10-01T19:00:00.000Z");
    expect(row.allDay).toBe(false);
    expect(row.locationName).toBe("Room 204");
    expect(row.htmlUrl).toBe("https://uta.instructure.com/calendar?event_id=321");
  });

  it("handles an all-day event with no location", () => {
    const row = okCalendarEvent({
      id: 1,
      title: "No Classes",
      start_at: "2026-11-26T00:00:00Z",
      end_at: "2026-11-27T00:00:00Z",
      all_day: true,
    });
    expect(row.allDay).toBe(true);
    expect(row.locationName).toBeNull();
  });

  it("rejects an unparseable start_at rather than storing a wrong date", () => {
    const result = translateCanvasCalendarEvent({ id: 1, title: "X", start_at: "garbage" }, 1);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.rejection.keyPath).toBe("start_at");
  });
});
