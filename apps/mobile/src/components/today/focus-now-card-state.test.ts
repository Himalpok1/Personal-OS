import { FOCUS_NOW_CAP } from "@personal-os/core/focus-now/score";
import type { TodayResponse, TodayTaskItem } from "@personal-os/schema";
import { describe, expect, it } from "vitest";
import { academicToday, assignment, priorityItem } from "../academic/fixtures.test-support";
import {
  focusNowRows,
  type FocusNowAcademicRow,
  type FocusNowTaskRow,
} from "./focus-now-card-state";

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

function emptyToday(overrides: Partial<TodayResponse> = {}): TodayResponse {
  return {
    generated_at: "2026-09-16T19:00:00.000Z",
    effective_now: "2026-09-16T19:00:00.000Z",
    tz: "America/Chicago",
    local_date: "2026-09-16",
    summary: {
      overdue_total: 0,
      due_today_total: 0,
      inbox_attention_total: 0,
      active_project_count: 0,
    },
    overdue: { items: [], total: 0 },
    due_today: { items: [], total: 0 },
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

describe("focusNowRows -- when it renders nothing", () => {
  it("is null while today is not yet loaded", () => {
    expect(focusNowRows(undefined, academicToday(), NOW)).toBeNull();
  });

  it("is null while academic is not yet loaded", () => {
    expect(focusNowRows(emptyToday(), undefined, NOW)).toBeNull();
  });

  it("is null when neither source has any candidate", () => {
    expect(focusNowRows(emptyToday(), academicToday(), NOW)).toBeNull();
  });

  it("is null for an unreadable device timezone rather than throwing", () => {
    const today = emptyToday({
      tz: "Not/ARealZone",
      overdue: { items: [task({ due_at: "2026-09-15T00:00:00Z" })], total: 1 },
    });
    expect(focusNowRows(today, academicToday(), NOW)).toBeNull();
  });
});

describe("focusNowRows -- merging and ranking", () => {
  it("includes overdue and due-today tasks, and only those two buckets", () => {
    const today = emptyToday({
      overdue: {
        items: [task({ id: "o1", title: "Overdue task", due_at: "2026-09-15T00:00:00Z" })],
        total: 1,
      },
      due_today: {
        items: [task({ id: "d1", title: "Due today task", due_at: "2026-09-16T20:00:00Z" })],
        total: 1,
      },
    });
    const rows = focusNowRows(today, academicToday(), NOW);
    expect(rows).not.toBeNull();
    expect(rows!.map((r) => r.id).sort()).toEqual(["d1", "o1"]);
  });

  it("includes the academic priorities section, verbatim-scored", () => {
    const academic = academicToday({
      priorities: {
        items: [
          priorityItem({
            assignment: assignment({ id: "a1", title: "Assignment one" }),
            urgency: "critical",
            score: 450,
            reasons: ["overdue", "marked_missing"],
          }),
        ],
        total: 1,
      },
    });
    const rows = focusNowRows(emptyToday(), academic, NOW);
    expect(rows).toHaveLength(1);
    const [row] = rows!;
    expect(row.kind).toBe("academic_assignment");
    expect(row.score).toBe(450);
    expect(row.reasons).toEqual(["overdue", "marked_missing"]);
    expect((row as FocusNowAcademicRow).priorityItem.assignment.id).toBe("a1");
  });

  it("ranks an overdue task above a due-later-today task, and both above a low-score academic item", () => {
    const today = emptyToday({
      overdue: { items: [task({ id: "overdue-task", due_at: "2026-09-15T00:00:00Z" })], total: 1 },
      due_today: { items: [task({ id: "later-today", due_at: "2026-09-16T23:00:00Z" })], total: 1 },
    });
    const academic = academicToday({
      priorities: {
        items: [
          priorityItem({
            assignment: assignment({ id: "low-academic" }),
            urgency: "medium",
            score: 200,
            reasons: ["due_this_week"],
          }),
        ],
        total: 1,
      },
    });
    const rows = focusNowRows(today, academic, NOW);
    expect(rows!.map((r) => r.id)).toEqual(["overdue-task", "later-today", "low-academic"]);
  });

  it("puts a P1 overdue task above an academic item scored the same as a non-P1 overdue task", () => {
    const today = emptyToday({
      overdue: {
        items: [
          task({ id: "p1", title: "P1 task", due_at: "2026-09-15T00:00:00Z", priority: 1 }),
          task({ id: "plain", title: "Plain task", due_at: "2026-09-15T00:00:00Z" }),
        ],
        total: 2,
      },
    });
    const academic = academicToday({
      priorities: {
        items: [
          priorityItem({
            assignment: assignment({ id: "academic-overdue" }),
            urgency: "critical",
            score: 400,
            reasons: ["overdue"],
          }),
        ],
        total: 1,
      },
    });
    const rows = focusNowRows(today, academic, NOW);
    // p1 (425) first; plain and academic-overdue tie at 400, broken by title
    // ("Plain task" title on the task vs. the assignment fixture's own
    // "Project milestone 2" title) -- both simply outrank nothing else here.
    expect(rows![0]!.id).toBe("p1");
    expect(rows![0]!.score).toBe(425);
    expect(new Set(rows!.slice(1).map((r) => r.id))).toEqual(
      new Set(["plain", "academic-overdue"]),
    );
  });

  it("caps the merged list at FOCUS_NOW_CAP, keeping the highest scores", () => {
    const items = Array.from({ length: FOCUS_NOW_CAP + 3 }, (_, i) =>
      task({ id: `t${i}`, due_at: "2026-09-15T00:00:00Z", priority: i === 0 ? 1 : null }),
    );
    const today = emptyToday({ overdue: { items, total: items.length } });
    const rows = focusNowRows(today, academicToday(), NOW);
    expect(rows).toHaveLength(FOCUS_NOW_CAP);
    // The one P1 task must survive the cap -- it strictly outscores the rest.
    expect(rows!.map((r) => r.id)).toContain("t0");
  });

  it("carries the originating task/priorityItem through on each row for the card to render", () => {
    const today = emptyToday({
      due_today: { items: [task({ id: "d1", title: "Due today task" })], total: 1 },
    });
    const rows = focusNowRows(today, academicToday(), NOW);
    const [row] = rows as [FocusNowTaskRow];
    expect(row.kind).toBe("task");
    expect(row.task.title).toBe("Due today task");
  });
});
