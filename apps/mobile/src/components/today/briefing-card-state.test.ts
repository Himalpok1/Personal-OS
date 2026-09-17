import type { HealthSummaryResponse, TodayResponse, TodayTaskItem } from "@personal-os/schema";
import { composeBriefing } from "@personal-os/core/focus-now/briefing";
import { describe, expect, it } from "vitest";
import {
  academicToday,
  assignment,
  priorityItem,
  workload,
} from "../academic/fixtures.test-support";
import { briefingFor, briefingInput, briefingLineTarget } from "./briefing-card-state";

// The briefing adaptation (Checkpoint 10.6, ADR-075 §4): what reaches core's
// `composeBriefing`, and when. Core's own tests pin the composition rules;
// these pin the client's gates (academic only when configured, health only
// when loaded and configured, never a clock read) and the ref → target
// mapping the card navigates on.

const NOW = new Date("2026-09-16T19:00:00Z"); // 2026-09-16 14:00 CDT

function task(overrides: Partial<TodayTaskItem> = {}): TodayTaskItem {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Task",
    due_at: null,
    remind_at: null,
    timezone: "America/Chicago",
    priority: null,
    project_id: null,
    project_name: null,
    rrule: null,
    parent_task_id: null,
    occurrence_id: null,
    snoozed_until: null,
    ...overrides,
  };
}

function today(overrides: Partial<TodayResponse> = {}): TodayResponse {
  return {
    generated_at: "2026-09-16T19:00:00.000Z",
    effective_now: "2026-09-16T19:00:00.000Z",
    tz: "America/Chicago",
    local_date: "2026-09-16",
    summary: {
      overdue_total: 2,
      due_today_total: 1,
      inbox_attention_total: 3,
      active_project_count: 0,
    },
    overdue: { items: [], total: 2 },
    due_today: { items: [], total: 1 },
    events_today: { items: [] },
    upcoming: { days: [] },
    inbox: { pending_count: 0, needs_confirm_count: 0, failed_count: 0, items: [] },
    projects: { active_count: 0, items: [] },
    reviews: {
      daily: { period_start: "2026-09-16", review_id: null, status: null, last_completed_at: null },
      weekly: {
        period_start: "2026-09-16",
        review_id: null,
        status: null,
        last_completed_at: null,
      },
    },
    brief: null,
    ...overrides,
  };
}

function health(overrides: Partial<HealthSummaryResponse> = {}): HealthSummaryResponse {
  return {
    configured: true,
    connection: null,
    timezone: "America/Chicago",
    local_date: "2026-09-16",
    freshness: { status: "fresh", last_synced_at: "2026-09-16T12:00:00Z", stale_after: null },
    today: [],
    latest: [],
    latest_sleep: {
      id: "55555555-5555-4555-8555-555555555555",
      wake_local_date: "2026-09-16",
      start_at: "2026-09-16T04:00:00Z",
      end_at: "2026-09-16T11:00:00Z",
      start_utc_offset_seconds: -18000,
      end_utc_offset_seconds: -18000,
      duration_seconds: 7 * 3600,
      session_type: null,
      session_subtype: null,
      source: { data_source_id: null, application_package: null, device_model: null },
      stages: null,
    },
    sleep_7d_average_seconds: 7 * 3600,
    latest_workout: null,
    capabilities: [],
    ...overrides,
  } as HealthSummaryResponse;
}

describe("briefingInput", () => {
  it("resolves a timed recurring instance to occurs_at plus the template's duration, never the template date (review finding 1)", () => {
    // The real wire shape for a weekly 15:00-16:30 lecture whose series began
    // two weeks ago: starts_at/ends_at are the TEMPLATE instants, occurs_at is
    // today's. Reading the template would put the event outside today's
    // window and let the free-block line claim the whole afternoon.
    const input = briefingInput(
      today({
        events_today: {
          items: [
            {
              id: "e2",
              title: "Weekly lecture",
              starts_at: "2026-09-02T20:00:00Z",
              ends_at: "2026-09-02T21:30:00Z",
              all_day: false,
              start_date: null,
              end_date: null,
              location: null,
              project_id: null,
              rrule: "FREQ=WEEKLY",
              parent_event_id: null,
              occurs_at: "2026-09-16T20:00:00Z",
            },
          ],
        },
      }),
      undefined,
      undefined,
      [],
      NOW,
    );
    expect(input.today.eventsToday).toEqual([
      {
        title: "Weekly lecture",
        startsAt: new Date("2026-09-16T20:00:00Z"),
        endsAt: new Date("2026-09-16T21:30:00Z"),
        allDay: false,
      },
    ]);
    // And the composed schedule splits the free time around it.
    const briefing = composeBriefing(input);
    const schedule = briefing.sections.find((section) => section.kind === "schedule");
    const texts = schedule?.lines.map((line) => line.text) ?? [];
    expect(texts).toContain("Next: Weekly lecture at 15:00");
    expect(texts.some((text) => text.startsWith("Free ") && text.includes("–15:00"))).toBe(true);
  });

  it("passes the personal counts, the events (occurs_at as the fallback start) and the tz, with the caller's instant", () => {
    const input = briefingInput(
      today({
        events_today: {
          items: [
            {
              id: "e1",
              title: "Standup",
              starts_at: null,
              ends_at: null,
              all_day: false,
              start_date: null,
              end_date: null,
              location: null,
              project_id: null,
              rrule: "FREQ=DAILY",
              parent_event_id: null,
              occurs_at: "2026-09-16T20:00:00Z",
            },
          ],
        },
      }),
      undefined,
      undefined,
      [],
      NOW,
    );
    expect(input.effectiveNow).toBe(NOW);
    expect(input.tz).toBe("America/Chicago");
    expect(input.today).toMatchObject({
      overdueTotal: 2,
      dueTodayTotal: 1,
      inboxAttentionTotal: 3,
    });
    expect(input.today.eventsToday).toEqual([
      { title: "Standup", startsAt: new Date("2026-09-16T20:00:00Z"), endsAt: null, allDay: false },
    ]);
    expect(input.academic).toBeNull();
    expect(input.health).toBeNull();
  });

  it("passes academic only when configured, reading the workload status when present", () => {
    expect(
      briefingInput(today(), academicToday({ configured: false }), undefined, [], NOW).academic,
    ).toBeNull();
    const configured = briefingInput(
      today(),
      academicToday({
        summary: {
          overdue_total: 1,
          due_today_total: 0,
          due_this_week_total: 4,
          missing_total: 1,
          unread_announcements_total: 2,
        },
        workload: workload({ status: "behind" }),
      }),
      undefined,
      [],
      NOW,
    ).academic;
    expect(configured).toEqual({
      configured: true,
      overdueTotal: 1,
      dueTodayTotal: 0,
      dueThisWeekTotal: 4,
      workloadStatus: "behind",
      unreadAnnouncements: 2,
    });
    expect(
      briefingInput(today(), academicToday(), undefined, [], NOW).academic?.workloadStatus,
    ).toBeNull();
  });

  it("passes health only when the summary is configured, with the sleep facts core needs", () => {
    expect(
      briefingInput(today(), undefined, health({ configured: false }), [], NOW).health,
    ).toBeNull();
    expect(briefingInput(today(), undefined, health(), [], NOW).health).toEqual({
      latestSleepSeconds: 7 * 3600,
      latestSleepWakeLocalDate: "2026-09-16",
      sleep7dAverageSeconds: 7 * 3600,
    });
    expect(
      briefingInput(today(), undefined, health({ latest_sleep: null }), [], NOW).health,
    ).toEqual({
      latestSleepSeconds: null,
      latestSleepWakeLocalDate: null,
      sleep7dAverageSeconds: 7 * 3600,
    });
  });
});

describe("briefingFor", () => {
  it("is null while today has not loaded", () => {
    expect(briefingFor(undefined, academicToday(), health(), NOW)).toBeNull();
  });

  it("leads with the same overdue / due-today counts the old hero drew, plus the academic ones when configured", () => {
    const personal = briefingFor(today(), undefined, undefined, NOW)!;
    expect(personal.briefing.headline).toBe("2 overdue, 1 due today.");
    const withAcademic = briefingFor(
      today(),
      academicToday({
        summary: {
          overdue_total: 1,
          due_today_total: 2,
          due_this_week_total: 0,
          missing_total: 0,
          unread_announcements_total: 0,
        },
      }),
      undefined,
      NOW,
    )!;
    expect(withAcademic.briefing.headline).toBe("3 overdue, 3 due today.");
  });

  it("names the Focus Now rows -- the same merged list the card shows -- and keeps them for navigation", () => {
    const view = briefingFor(
      today({
        overdue: {
          items: [task({ id: "o1", title: "Overdue task", due_at: "2026-09-15T00:00:00Z" })],
          total: 1,
        },
      }),
      academicToday({
        priorities: {
          items: [priorityItem({ assignment: assignment({ id: "a1", title: "Milestone" }) })],
          total: 1,
        },
      }),
      undefined,
      NOW,
    )!;
    const focus = view.briefing.sections.find((section) => section.kind === "focus")!;
    expect(focus.lines.map((line) => line.ref)).toEqual([
      { kind: "task", id: "o1" },
      { kind: "academic_assignment", id: "a1" },
    ]);
    expect(view.focus.map((row) => row.id)).toEqual(["o1", "a1"]);
  });

  it("carries a health section only when the sleep is honest to report", () => {
    const withSleep = briefingFor(today(), undefined, health(), NOW)!;
    expect(withSleep.briefing.sections.some((section) => section.kind === "health")).toBe(true);
    const stale = briefingFor(
      today(),
      undefined,
      health({ latest_sleep: { ...health().latest_sleep!, wake_local_date: "2026-09-10" } }),
      NOW,
    )!;
    expect(stale.briefing.sections.some((section) => section.kind === "health")).toBe(false);
  });
});

describe("briefingLineTarget", () => {
  it("maps a task ref to the task screen, an assignment ref to its focus row, and nothing otherwise", () => {
    const view = briefingFor(
      today({
        overdue: { items: [task({ id: "o1", due_at: "2026-09-15T00:00:00Z" })], total: 1 },
      }),
      academicToday({
        priorities: {
          items: [priorityItem({ assignment: assignment({ id: "a1" }) })],
          total: 1,
        },
      }),
      undefined,
      NOW,
    )!;
    const focus = view.briefing.sections.find((section) => section.kind === "focus")!;
    expect(briefingLineTarget(focus.lines[0]!, view.focus)).toEqual({ kind: "task", taskId: "o1" });
    const assignmentTarget = briefingLineTarget(focus.lines[1]!, view.focus);
    expect(assignmentTarget?.kind).toBe("assignment");
    expect(assignmentTarget?.kind === "assignment" && assignmentTarget.row.id).toBe("a1");
    expect(
      briefingLineTarget({ text: "x", source: "calendar", tone: "neutral" }, view.focus),
    ).toBeNull();
    expect(
      briefingLineTarget(
        {
          text: "x",
          source: "canvas_assignment",
          tone: "neutral",
          ref: { kind: "academic_assignment", id: "gone" },
        },
        view.focus,
      ),
    ).toBeNull();
  });
});
