import type {
  AcademicAnnouncement,
  AcademicAssignment,
  AcademicCourseAttention,
  AcademicCourseSummary,
  AcademicEvent,
  AcademicGradeSummary,
  AcademicPriorityItem,
  AcademicTodayResponse,
  AcademicWorkload,
} from "@personal-os/schema";

// Shared fixture builders for the academic component tests. Not a test file
// itself (no `.test.` in the name, so vitest never collects it) and never
// imported by application code.

export const SOURCE_BASE_URL = "https://uta.instructure.com";
export const CONNECTION_ID = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";

export function assignment(overrides: Partial<AcademicAssignment> = {}): AcademicAssignment {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    source: "canvas",
    external_id: "1001",
    course_id: "22222222-2222-4222-8222-222222222222",
    course_name: "Advanced Web Development",
    course_code: "INSY 4315",
    title: "Project milestone 2",
    due_at: "2026-09-23T04:59:00Z",
    points_possible: 100,
    submission: { status: "unsubmitted", missing: false, late: false, submitted_at: null },
    grade: { status: "not_graded", score: null, grade: null, percentage: null },
    open: true,
    published: true,
    html_url: `${SOURCE_BASE_URL}/courses/1/assignments/1001`,
    source_base_url: SOURCE_BASE_URL,
    archived_at: null,
    ...overrides,
  };
}

export function announcement(overrides: Partial<AcademicAnnouncement> = {}): AcademicAnnouncement {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    source: "canvas",
    external_id: "2001",
    course_id: "22222222-2222-4222-8222-222222222222",
    course_name: "Advanced Web Development",
    title: "Exam 1 room change",
    preview: "The exam moves to room 204.",
    posted_at: "2026-09-15T14:00:00Z",
    read: false,
    html_url: `${SOURCE_BASE_URL}/courses/1/discussion_topics/2001`,
    source_base_url: SOURCE_BASE_URL,
    archived_at: null,
    ...overrides,
  };
}

export function event(overrides: Partial<AcademicEvent> = {}): AcademicEvent {
  return {
    kind: "calendar_event",
    id: "44444444-4444-4444-8444-444444444444",
    source: "canvas",
    course_id: "22222222-2222-4222-8222-222222222222",
    course_name: "Advanced Web Development",
    title: "Guest lecture",
    at: "2026-09-22T20:00:00Z",
    ends_at: "2026-09-22T21:00:00Z",
    all_day: false,
    location: "ERB 129",
    html_url: `${SOURCE_BASE_URL}/calendar?event_id=3001`,
    source_base_url: SOURCE_BASE_URL,
    ...overrides,
  };
}

export function course(overrides: Partial<AcademicCourseSummary> = {}): AcademicCourseSummary {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    source: "canvas",
    external_id: "1",
    connection_id: CONNECTION_ID,
    name: "Advanced Web Development",
    code: "INSY 4315",
    term: { name: "Fall 2026", starts_at: "2026-08-24T05:00:00Z", ends_at: "2026-12-12T06:00:00Z" },
    status: "active",
    html_url: `${SOURCE_BASE_URL}/courses/1`,
    source_base_url: SOURCE_BASE_URL,
    archived_at: null,
    created_at: "2026-09-16T10:00:00Z",
    updated_at: "2026-09-16T10:00:00Z",
    open_assignment_count: 3,
    overdue_assignment_count: 1,
    next_due_at: "2026-09-23T04:59:00Z",
    ...overrides,
  };
}

/** One ranked "Do next" candidate wrapping an untouched assignment (Checkpoint 10.3). */
export function priorityItem(overrides: Partial<AcademicPriorityItem> = {}): AcademicPriorityItem {
  return {
    assignment: assignment(),
    urgency: "high",
    score: 300,
    reasons: ["due_within_24h"],
    hours_until_due: 6.5,
    ...overrides,
  };
}

/** One "which courses need focus" row (Checkpoint 10.3). */
export function courseAttention(
  overrides: Partial<AcademicCourseAttention> = {},
): AcademicCourseAttention {
  return {
    course_id: "22222222-2222-4222-8222-222222222222",
    course_name: "Advanced Web Development",
    course_code: "INSY 4315",
    open_total: 2,
    overdue_total: 1,
    due_within_24h_total: 0,
    due_this_week_total: 1,
    next_due_at: "2026-09-23T04:59:00Z",
    attention: "high",
    ...overrides,
  };
}

/** An on-track, zero-filled workload over today + 7 days from 2026-09-16 (Checkpoint 10.3). */
export function workload(overrides: Partial<AcademicWorkload> = {}): AcademicWorkload {
  const days = [16, 17, 18, 19, 20, 21, 22, 23].map((day) => ({
    date: `2026-09-${day}`,
    due_total: 0,
    points_total: 0,
  }));
  return {
    status: "on_track",
    open_total: 0,
    overdue_total: 0,
    missing_total: 0,
    due_within_24h_total: 0,
    due_this_week_total: 0,
    points_at_stake: 0,
    horizon_days: 7,
    days,
    ...overrides,
  };
}

/** A course's grade summary (Checkpoint 10.3). */
export function gradeSummary(overrides: Partial<AcademicGradeSummary> = {}): AcademicGradeSummary {
  return {
    graded_total: 7,
    average_percentage: 92.4,
    points_earned: 112,
    points_possible_graded: 120,
    weighted_percentage: 93.3,
    ...overrides,
  };
}

/** A configured, fully empty academic Today response. */
export function academicToday(
  overrides: Partial<AcademicTodayResponse> = {},
): AcademicTodayResponse {
  return {
    generated_at: "2026-09-16T13:00:00Z",
    effective_now: "2026-09-16T13:00:00Z",
    tz: "America/Chicago",
    local_date: "2026-09-16",
    configured: true,
    summary: {
      overdue_total: 0,
      due_today_total: 0,
      due_this_week_total: 0,
      missing_total: 0,
      unread_announcements_total: 0,
    },
    overdue: { items: [], total: 0 },
    due_today: { items: [], total: 0 },
    due_this_week: { items: [], total: 0 },
    announcements: { items: [], total: 0 },
    events: { items: [], total: 0 },
    ...overrides,
  };
}
