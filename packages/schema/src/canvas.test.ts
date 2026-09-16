import { describe, expect, it } from "vitest";
import {
  CanvasAnnouncementSchema,
  CanvasAssignmentSchema,
  CanvasUpcomingAssignmentSchema,
  CanvasConnectionSchema,
  CanvasConnectionsListResponseSchema,
  CanvasConnectionStatusSchema,
  CanvasConnectRequestSchema,
  CanvasCourseSchema,
  CanvasEventSchema,
  CanvasSyncRunKindSchema,
  CanvasSyncRunSchema,
  CanvasSyncRunsResponseSchema,
  CanvasSyncRunStatusSchema,
  CanvasSyncTokenSchema,
  CanvasSyncTriggerResponseSchema,
} from "./canvas.js";

const CONNECTION = {
  id: "11111111-1111-4111-8111-111111111111",
  canvas_base_url: "https://uta.instructure.com",
  canvas_user_id: 12345,
  canvas_user_name: "Himal Pokhrel",
  status: "active",
  last_sync_at: "2026-09-15T12:00:00Z",
  last_sync_error: null,
  last_sync_error_at: null,
  created_at: "2026-09-15T09:00:00Z",
  updated_at: "2026-09-15T12:00:00Z",
};

const COURSE = {
  id: "22222222-2222-4222-8222-222222222222",
  canvas_course_id: 98765,
  name: "Software Engineering",
  course_code: "CSE-3311-001",
  term_name: "Fall 2026 - UT Arlington",
  term_start_at: "2026-08-24T00:00:00Z",
  term_end_at: "2026-12-12T00:00:00Z",
  enrollment_state: "active",
  workflow_state: "available",
  html_url: "https://uta.instructure.com/courses/98765",
  archived_at: null,
};

const ASSIGNMENT = {
  id: "33333333-3333-4333-8333-333333333333",
  course_id: COURSE.id,
  canvas_assignment_id: 555111,
  title: "Homework 3",
  due_at: "2026-09-22T04:59:00Z",
  points_possible: 100,
  submission_types: ["online_upload"],
  html_url: "https://uta.instructure.com/courses/98765/assignments/555111",
  published: true,
  submission_state: "submitted",
  submission_missing: false,
  submission_late: false,
  submitted_at: "2026-09-21T20:00:00Z",
  score: 97,
  grade: "A",
  archived_at: null,
};

const ANNOUNCEMENT = {
  id: "44444444-4444-4444-8444-444444444444",
  course_id: COURSE.id,
  canvas_announcement_id: 777222,
  title: "Midterm reminder",
  message_preview: "The midterm is Thursday and covers chapters 1-5.",
  posted_at: "2026-09-14T15:00:00Z",
  html_url: "https://uta.instructure.com/courses/98765/discussion_topics/777222",
  read_state: "read",
  archived_at: null,
};

const EVENT = {
  id: "55555555-5555-4555-8555-555555555555",
  course_id: COURSE.id,
  canvas_event_id: 888333,
  title: "Guest lecture",
  starts_at: "2026-09-25T18:00:00Z",
  ends_at: "2026-09-25T19:00:00Z",
  all_day: false,
  location_name: "ERB 125",
  html_url: "https://uta.instructure.com/calendar?event_id=888333",
  archived_at: null,
};

const SYNC_RUN = {
  id: "66666666-6666-4666-8666-666666666666",
  connection_id: CONNECTION.id,
  kind: "cron",
  status: "succeeded",
  started_at: "2026-09-15T06:00:00Z",
  finished_at: "2026-09-15T06:00:12Z",
  courses_synced: 16,
  assignments_synced: 42,
  announcements_synced: 3,
  events_synced: 0,
  failure_class: null,
  error_message: null,
};

describe("CanvasConnectRequestSchema", () => {
  it("parses a valid connect request", () => {
    const parsed = CanvasConnectRequestSchema.parse({
      base_url: "https://uta.instructure.com",
      personal_access_token: "1234~abcDEF",
    });
    expect(parsed.base_url).toBe("https://uta.instructure.com");
  });

  it("rejects a non-URL base_url", () => {
    expect(() =>
      CanvasConnectRequestSchema.parse({
        base_url: "not-a-url",
        personal_access_token: "token",
      }),
    ).toThrow();
  });

  it("rejects an empty personal_access_token", () => {
    expect(() =>
      CanvasConnectRequestSchema.parse({
        base_url: "https://uta.instructure.com",
        personal_access_token: "",
      }),
    ).toThrow();
  });

  it("rejects a token over the 2000-character bound", () => {
    expect(() =>
      CanvasConnectRequestSchema.parse({
        base_url: "https://uta.instructure.com",
        personal_access_token: "a".repeat(2001),
      }),
    ).toThrow();
  });

  it("rejects an unknown key", () => {
    expect(() =>
      CanvasConnectRequestSchema.parse({
        base_url: "https://uta.instructure.com",
        personal_access_token: "token",
        remember_me: true,
      }),
    ).toThrow();
  });
});

describe("CanvasConnectRequestSchema: token shape (Checkpoint 10.2 hotfix)", () => {
  const BASE = { base_url: "https://uta.instructure.com" };
  // The Canvas PAT shape, with a sentinel that is obviously not real.
  const PAT = "1234~SENTINELnotARealTokenAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

  it("trims surrounding whitespace and newlines from a pasted token", () => {
    for (const pasted of [`${PAT}\n`, `\n${PAT}`, `  ${PAT}  `, `\t${PAT}\r\n`]) {
      expect(
        CanvasConnectRequestSchema.parse({ ...BASE, personal_access_token: pasted })
          .personal_access_token,
      ).toBe(PAT);
    }
  });

  it("REJECTS a token with an embedded newline, CR, tab, space or control character", () => {
    for (const bad of [
      `123~abc\ndef`,
      `123~abc\rdef`,
      `123~abc\tdef`,
      `123~abc def`,
      `123~abc\u0000def`,
      `123~abc\u001fdef`,
    ]) {
      expect(() =>
        CanvasConnectRequestSchema.parse({ ...BASE, personal_access_token: bad }),
      ).toThrow();
    }
  });

  it("rejects a token that is only whitespace (empty after trim)", () => {
    expect(() =>
      CanvasConnectRequestSchema.parse({ ...BASE, personal_access_token: "  \n  " }),
    ).toThrow();
  });

  it("the rejection issue never carries the token itself", () => {
    const bad = `1234~SENTINEL\nLEAKCHECKxxxxxxxxxxxxxxxxxxxxxxxxxxxx`;
    let issues = "";
    try {
      CanvasConnectRequestSchema.parse({ ...BASE, personal_access_token: bad });
    } catch (err) {
      issues = JSON.stringify((err as { issues?: unknown }).issues ?? err);
    }
    expect(issues).not.toBe("");
    expect(issues).not.toContain("LEAKCHECK");
    expect(issues).not.toContain("SENTINEL");
  });
});

describe("CanvasConnectionStatusSchema", () => {
  it("accepts each of the three lifecycle states", () => {
    for (const s of ["active", "disconnected", "invalid_token"]) {
      expect(CanvasConnectionStatusSchema.parse(s)).toBe(s);
    }
  });

  it("rejects a status outside the closed lifecycle", () => {
    for (const s of ["needs_reauth", "revoked", "ACTIVE", ""]) {
      expect(() => CanvasConnectionStatusSchema.parse(s)).toThrow();
    }
  });
});

describe("CanvasConnectionSchema", () => {
  it("parses a valid full connection object", () => {
    const parsed = CanvasConnectionSchema.parse(CONNECTION);
    expect(parsed.canvas_base_url).toBe(CONNECTION.canvas_base_url);
    expect(parsed.canvas_user_id).toBe(12345);
  });

  it("parses with a token-shaped last_sync_error", () => {
    expect(
      CanvasConnectionSchema.parse({ ...CONNECTION, last_sync_error: "invalid_token" })
        .last_sync_error,
    ).toBe("invalid_token");
    expect(
      CanvasConnectionSchema.parse({ ...CONNECTION, last_sync_error: "provider_error:503" })
        .last_sync_error,
    ).toBe("provider_error:503");
  });

  it("rejects provider prose in last_sync_error", () => {
    expect(() =>
      CanvasConnectionSchema.parse({
        ...CONNECTION,
        last_sync_error: "The request could not be completed: 503 Service Unavailable",
      }),
    ).toThrow();
  });

  it("rejects an unknown key", () => {
    expect(() => CanvasConnectionSchema.parse({ ...CONNECTION, extra_field: "nope" })).toThrow();
  });

  it("carries no credential-shaped field, structurally", () => {
    // The same proof mail-connections.ts and health-metrics.ts run: walk the
    // schema's own keys rather than trusting review. A credential must be
    // inexpressible here, not merely absent today.
    const forbidden =
      /(access_token|refresh_token|ciphertext|iv|auth_tag|secret|password|credential|client_id|client_secret|state_hash)/i;
    const seen = Object.keys(CanvasConnectionSchema.shape);
    // Positive control: the walk actually visited fields.
    expect(seen).toContain("canvas_base_url");
    for (const key of seen) {
      expect(key).not.toMatch(forbidden);
    }
  });
});

describe("CanvasConnectionsListResponseSchema", () => {
  it("parses an empty and a populated list", () => {
    expect(CanvasConnectionsListResponseSchema.parse({ configured: false, items: [] })).toEqual({
      configured: false,
      items: [],
    });
    expect(
      CanvasConnectionsListResponseSchema.parse({ configured: true, items: [CONNECTION] }).items,
    ).toHaveLength(1);
  });
});

describe("CanvasCourseSchema", () => {
  it("parses a valid full course object", () => {
    expect(CanvasCourseSchema.parse(COURSE).name).toBe("Software Engineering");
  });

  it("parses with every nullable field set to null", () => {
    const minimal = {
      ...COURSE,
      course_code: null,
      term_name: null,
      term_start_at: null,
      term_end_at: null,
      enrollment_state: null,
      workflow_state: null,
      html_url: null,
      archived_at: null,
    };
    expect(CanvasCourseSchema.parse(minimal).course_code).toBeNull();
  });

  it("accepts an enrollment_state or workflow_state Canvas has not been observed to use before, since neither is a closed enum", () => {
    expect(
      CanvasCourseSchema.parse({ ...COURSE, enrollment_state: "a_brand_new_canvas_state" })
        .enrollment_state,
    ).toBe("a_brand_new_canvas_state");
  });

  it("rejects an unknown key", () => {
    expect(() => CanvasCourseSchema.parse({ ...COURSE, connection_id: "x" })).toThrow();
  });
});

describe("CanvasAssignmentSchema", () => {
  it("parses a valid full assignment object", () => {
    expect(CanvasAssignmentSchema.parse(ASSIGNMENT).title).toBe("Homework 3");
  });

  it("parses with every nullable field set to null", () => {
    const minimal = {
      ...ASSIGNMENT,
      due_at: null,
      points_possible: null,
      submission_types: null,
      html_url: null,
      submission_state: null,
      submission_missing: null,
      submission_late: null,
      submitted_at: null,
      score: null,
      grade: null,
      archived_at: null,
    };
    expect(CanvasAssignmentSchema.parse(minimal).due_at).toBeNull();
  });

  it("rejects an unknown key", () => {
    expect(() => CanvasAssignmentSchema.parse({ ...ASSIGNMENT, connection_id: "x" })).toThrow();
  });

  // Structural regression test (ADR-068 §3): description is unbounded
  // instructor-authored HTML with no in-app renderer and may not silently
  // reappear on this schema, whatever value it carries -- including a
  // legitimate-looking one.
  it("REJECTS an object carrying a description field, however innocuous its value", () => {
    expect(() =>
      CanvasAssignmentSchema.parse({ ...ASSIGNMENT, description: "<p>Read chapters 1-5.</p>" }),
    ).toThrow();
  });

  // Checkpoint 10.2 (ADR-068a, migration 0021): score and grade are now
  // stored, by explicit owner decision. Both must be nullable -- Canvas
  // leaves them null until an assignment is graded.
  it("ACCEPTS score and grade, nullable (ADR-068a)", () => {
    expect(CanvasAssignmentSchema.parse(ASSIGNMENT).score).toBe(97);
    expect(CanvasAssignmentSchema.parse(ASSIGNMENT).grade).toBe("A");
    expect(
      CanvasAssignmentSchema.parse({ ...ASSIGNMENT, score: null, grade: null }).score,
    ).toBeNull();
    expect(() => CanvasAssignmentSchema.parse({ ...ASSIGNMENT, score: "97" })).toThrow();
  });

  // Still excluded after ADR-068a: the pre-late-policy duplicates and the
  // student's own uploaded work. A fresh owner decision is required for each.
  it("REJECTS an object carrying entered_score/entered_grade fields", () => {
    for (const key of ["entered_score", "entered_grade"]) {
      expect(() => CanvasAssignmentSchema.parse({ ...ASSIGNMENT, [key]: "A" })).toThrow();
    }
  });

  it("REJECTS an object carrying a submission attachments field", () => {
    expect(() => CanvasAssignmentSchema.parse({ ...ASSIGNMENT, attachments: [] })).toThrow();
  });
});

describe("CanvasUpcomingAssignmentSchema (frozen 10.1 wire shape)", () => {
  // The Rabbit R1's versionCode-22 build parses GET /canvas-assignments/upcoming
  // through the 10.1 form of this schema, which is strict. ADR-068a's new
  // score/grade keys must therefore stay OUT of it until that client is
  // replaced -- an added key would blank the deployed Canvas card.
  const ASSIGNMENT_10_1 = Object.fromEntries(
    Object.entries(ASSIGNMENT).filter(([key]) => key !== "score" && key !== "grade"),
  );
  const UPCOMING = {
    ...ASSIGNMENT_10_1,
    course_name: "Advanced Web Development",
    canvas_base_url: "https://uta.instructure.com",
  };

  it("parses exactly the 10.1 shape (no score, no grade)", () => {
    expect(CanvasUpcomingAssignmentSchema.parse(UPCOMING).course_name).toBe(
      "Advanced Web Development",
    );
  });

  it("REJECTS score and grade keys, the way the deployed client would", () => {
    expect(() => CanvasUpcomingAssignmentSchema.parse({ ...UPCOMING, score: null })).toThrow();
    expect(() => CanvasUpcomingAssignmentSchema.parse({ ...UPCOMING, grade: null })).toThrow();
  });
});

describe("CanvasAnnouncementSchema", () => {
  it("parses a valid full announcement object", () => {
    expect(CanvasAnnouncementSchema.parse(ANNOUNCEMENT).title).toBe("Midterm reminder");
  });

  it("parses with every nullable field set to null", () => {
    const minimal = {
      ...ANNOUNCEMENT,
      message_preview: null,
      posted_at: null,
      html_url: null,
      read_state: null,
      archived_at: null,
    };
    expect(CanvasAnnouncementSchema.parse(minimal).message_preview).toBeNull();
  });

  it("rejects an unknown key", () => {
    expect(() =>
      CanvasAnnouncementSchema.parse({ ...ANNOUNCEMENT, message: "raw html" }),
    ).toThrow();
  });
});

describe("CanvasEventSchema", () => {
  it("parses a valid full event object", () => {
    expect(CanvasEventSchema.parse(EVENT).title).toBe("Guest lecture");
  });

  it("accepts a null course_id for a personal calendar event", () => {
    expect(CanvasEventSchema.parse({ ...EVENT, course_id: null }).course_id).toBeNull();
  });

  it("parses an all-day event with null start/end instants", () => {
    expect(
      CanvasEventSchema.parse({ ...EVENT, all_day: true, starts_at: null, ends_at: null }).all_day,
    ).toBe(true);
  });

  it("rejects an unknown key", () => {
    expect(() => CanvasEventSchema.parse({ ...EVENT, due_at: "2026-09-25T18:00:00Z" })).toThrow();
  });
});

describe("CanvasSyncRunKindSchema and CanvasSyncRunStatusSchema", () => {
  it("accept their closed vocabularies", () => {
    for (const k of ["manual", "cron"]) expect(CanvasSyncRunKindSchema.parse(k)).toBe(k);
    for (const s of ["succeeded", "failed", "skipped"]) {
      expect(CanvasSyncRunStatusSchema.parse(s)).toBe(s);
    }
  });

  it("reject anything outside the closed vocabularies", () => {
    expect(() => CanvasSyncRunKindSchema.parse("scheduled")).toThrow();
    expect(() => CanvasSyncRunStatusSchema.parse("running")).toThrow();
  });
});

describe("CanvasSyncTokenSchema", () => {
  it("accepts a bare token and a token with one qualifier", () => {
    expect(CanvasSyncTokenSchema.parse("invalid_token")).toBe("invalid_token");
    expect(CanvasSyncTokenSchema.parse("provider_error:503")).toBe("provider_error:503");
  });

  it("rejects prose", () => {
    for (const bad of [
      "The server returned an error",
      "Provider Error",
      "provider error",
      "",
      "1invalid_start",
    ]) {
      expect(() => CanvasSyncTokenSchema.parse(bad)).toThrow();
    }
  });
});

describe("CanvasSyncRunSchema", () => {
  it("parses a valid full sync run object", () => {
    expect(CanvasSyncRunSchema.parse(SYNC_RUN).status).toBe("succeeded");
  });

  it("parses a failed run with token-shaped failure_class and error_message", () => {
    const failed = {
      ...SYNC_RUN,
      status: "failed",
      failure_class: "auth_failed",
      error_message: "auth_failed:401",
      courses_synced: null,
      assignments_synced: null,
      announcements_synced: null,
      events_synced: null,
    };
    const parsed = CanvasSyncRunSchema.parse(failed);
    expect(parsed.failure_class).toBe("auth_failed");
    expect(parsed.error_message).toBe("auth_failed:401");
  });

  it("rejects raw provider prose in error_message", () => {
    expect(() =>
      CanvasSyncRunSchema.parse({
        ...SYNC_RUN,
        status: "failed",
        failure_class: "provider_error",
        error_message: "Unexpected token < in JSON at position 0",
      }),
    ).toThrow();
  });

  it("parses a skipped run with a null finished_at as still in flight is not representable, but null counts are", () => {
    expect(
      CanvasSyncRunSchema.parse({ ...SYNC_RUN, status: "skipped", finished_at: null }).finished_at,
    ).toBeNull();
  });

  it("rejects an unknown key", () => {
    expect(() => CanvasSyncRunSchema.parse({ ...SYNC_RUN, provider: "canvas" })).toThrow();
  });
});

describe("CanvasSyncRunsResponseSchema", () => {
  it("parses a list of sync runs", () => {
    expect(CanvasSyncRunsResponseSchema.parse({ items: [SYNC_RUN] }).items).toHaveLength(1);
  });
});

describe("CanvasSyncTriggerResponseSchema", () => {
  it("parses a queued response", () => {
    expect(CanvasSyncTriggerResponseSchema.parse({ queued: true })).toEqual({ queued: true });
  });
});
