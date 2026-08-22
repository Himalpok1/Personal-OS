// Unit tests for the pure step-derivation helpers exported from
// review-step-list.tsx. The step orders asserted here are the frozen
// content-v1 checklist contract from packages/schema/src/reviews.ts -- if the
// schema's checklist keys change, these tests (and the component) must change
// with them.

import { describe, expect, it } from "vitest";
import type {
  DailyReviewChecklist,
  DailyReviewContext,
  WeeklyReviewChecklist,
  WeeklyReviewContext,
} from "@personal-os/schema";
import { activeStepIndex, deriveSteps } from "./review-step-list";

function dailyContext(): DailyReviewContext {
  return {
    generated_at: "2026-08-22T09:00:00.000Z",
    effective_now: "2026-08-22T09:00:00.000Z",
    tz: "America/Chicago",
    period_start: "2026-08-22",
    inbox_attention: { pending_count: 0, needs_confirm_count: 0, failed_count: 0, items: [] },
    overdue: { items: [], total: 0 },
    due_today: { items: [], total: 0 },
    events_today: { items: [] },
    active_projects: { items: [], total: 0 },
    stalled_projects: { items: [], total: 0 },
    projects_without_next_action: { items: [], total: 0 },
    recently_completed: { items: [], total: 0 },
  };
}

function weeklyContext(): WeeklyReviewContext {
  return {
    generated_at: "2026-08-22T09:00:00.000Z",
    effective_now: "2026-08-22T09:00:00.000Z",
    tz: "America/Chicago",
    period_start: "2026-08-17",
    inbox_attention: { pending_count: 0, needs_confirm_count: 0, failed_count: 0, items: [] },
    overdue: { items: [], total: 0 },
    active_projects: { items: [], total: 0 },
    paused_projects: { items: [], total: 0 },
    stalled_projects: { items: [], total: 0 },
    projects_without_next_action: { items: [], total: 0 },
    upcoming_7d: { days: [] },
    recently_completed: { items: [], total: 0 },
  };
}

describe("deriveSteps", () => {
  it("emits the frozen daily step order with display titles", () => {
    const steps = deriveSteps(dailyContext(), "daily");

    expect(steps.map((step) => step.key)).toEqual([
      "inbox",
      "overdue",
      "priorities",
      "calendar",
      "projects",
      "next_actions",
      "summary",
    ]);
    expect(steps.every((step) => typeof step.title === "string" && step.title.length > 0)).toBe(
      true,
    );
  });

  it("emits the frozen weekly step order with display titles", () => {
    const steps = deriveSteps(weeklyContext(), "weekly");

    expect(steps.map((step) => step.key)).toEqual([
      "inbox",
      "overdue",
      "active_projects",
      "paused_projects",
      "stalled_projects",
      "missing_next_actions",
      "upcoming_week",
      "recently_completed",
      "summary",
    ]);
  });

  it("reads done flags from the saved checklist and defaults absent keys to false", () => {
    const checklist: DailyReviewChecklist = {
      inbox: true,
      overdue: true,
      // priorities..summary deliberately absent -> not done
    };

    const steps = deriveSteps(dailyContext(), "daily", checklist);

    expect(steps.map((step) => step.done)).toEqual([true, true, false, false, false, false, false]);
  });

  it("treats an explicit false as not done", () => {
    const checklist: WeeklyReviewChecklist = {
      inbox: true,
      overdue: false,
    };

    const steps = deriveSteps(weeklyContext(), "weekly", checklist);

    expect(steps[0]).toMatchObject({ key: "inbox", done: true });
    expect(steps[1]).toMatchObject({ key: "overdue", done: false });
  });

  it("marks every step not done when there is no saved checklist yet", () => {
    for (const checklist of [null, undefined]) {
      const daily = deriveSteps(dailyContext(), "daily", checklist);
      const weekly = deriveSteps(weeklyContext(), "weekly", checklist);

      expect(daily.every((step) => step.done === false)).toBe(true);
      expect(weekly.every((step) => step.done === false)).toBe(true);
    }
  });
});

describe("activeStepIndex", () => {
  it("returns the first not-done step", () => {
    const steps = deriveSteps(dailyContext(), "daily", {
      inbox: true,
      overdue: true,
    });

    expect(activeStepIndex(steps)).toBe(2); // priorities is first not-done
  });

  it("lands on the last step when every step is done", () => {
    const steps = deriveSteps(dailyContext(), "daily", {
      inbox: true,
      overdue: true,
      priorities: true,
      calendar: true,
      projects: true,
      next_actions: true,
      summary: true,
    });

    expect(activeStepIndex(steps)).toBe(steps.length - 1);
  });

  it("returns -1 for an empty step list", () => {
    expect(activeStepIndex([])).toBe(-1);
  });

  it("returns 0 when nothing is done yet", () => {
    const steps = deriveSteps(weeklyContext(), "weekly");

    expect(activeStepIndex(steps)).toBe(0);
  });
});
