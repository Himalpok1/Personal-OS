import { describe, expect, it } from "vitest";
import {
  TodayEventItemSchema,
  TodayInboxItemSchema,
  TodayProjectSummarySchema,
  TodayQuerySchema,
  TodayResponseSchema,
  TodayTaskItemSchema,
  TodayUpcomingDaySchema,
  boundedItemsSectionSchema,
} from "./today.js";
import { PROJECT_STATUSES, ProjectStatusSchema } from "./projects.js";

const UUID = "123e4567-e89b-12d3-a456-426614174000";
const UUID2 = "123e4567-e89b-12d3-a456-426614174001";
const UUID3 = "123e4567-e89b-12d3-a456-426614174002";
const NOW = "2026-08-21T09:00:00Z";
const DATE = "2026-08-21";

function taskItem(overrides: Record<string, unknown> = {}) {
  return {
    id: UUID,
    title: "Pay rent",
    due_at: `${DATE}T17:00:00Z`,
    remind_at: null,
    timezone: "America/Chicago",
    priority: 1,
    project_id: null,
    project_name: null,
    rrule: null,
    parent_task_id: null,
    occurrence_id: null,
    ...overrides,
  };
}

function eventItem(overrides: Record<string, unknown> = {}) {
  return {
    id: UUID2,
    title: "Dentist",
    starts_at: `${DATE}T15:00:00Z`,
    ends_at: `${DATE}T16:00:00Z`,
    all_day: false,
    start_date: null,
    end_date: null,
    location: null,
    project_id: null,
    rrule: null,
    parent_event_id: null,
    occurs_at: null,
    ...overrides,
  };
}

describe("Today schemas", () => {
  describe("TodayQuerySchema", () => {
    it("accepts a valid IANA timezone", () => {
      expect(TodayQuerySchema.safeParse({ tz: "America/Chicago" }).success).toBe(true);
    });

    it("rejects an invalid timezone", () => {
      expect(TodayQuerySchema.safeParse({ tz: "Mars/Olympus" }).success).toBe(false);
    });

    it("rejects a missing timezone", () => {
      expect(TodayQuerySchema.safeParse({}).success).toBe(false);
    });
  });

  describe("TodayTaskItemSchema", () => {
    it("accepts a one-off task with occurrence_id absent or null", () => {
      const withoutOccurrence = { ...taskItem(), occurrence_id: undefined };
      expect(TodayTaskItemSchema.safeParse(withoutOccurrence).success).toBe(true);
      expect(TodayTaskItemSchema.safeParse(taskItem()).success).toBe(true);
    });

    it("accepts an occurrence of a recurring parent", () => {
      const result = TodayTaskItemSchema.safeParse(
        taskItem({
          id: UUID3,
          due_at: null,
          parent_task_id: UUID,
          occurrence_id: UUID2,
        }),
      );
      expect(result.success).toBe(true);
    });
  });

  describe("TodayEventItemSchema", () => {
    it("accepts a timed event and an all-day recurring instance", () => {
      expect(TodayEventItemSchema.safeParse(eventItem()).success).toBe(true);
      expect(
        TodayEventItemSchema.safeParse(
          eventItem({
            id: UUID3,
            starts_at: null,
            ends_at: null,
            all_day: true,
            start_date: DATE,
            end_date: DATE,
            parent_event_id: UUID2,
            occurs_at: `${DATE}T00:00:00Z`,
          }),
        ).success,
      ).toBe(true);
    });

    it("rejects a malformed date-only field", () => {
      expect(TodayEventItemSchema.safeParse(eventItem({ start_date: "08/21/2026" })).success).toBe(
        false,
      );
    });
  });

  describe("TodayUpcomingDaySchema", () => {
    it("accepts a populated day", () => {
      const task = { ...taskItem(), occurrence_id: undefined };
      const result = TodayUpcomingDaySchema.safeParse({
        date: DATE,
        tasks: [task],
        events: [eventItem()],
        total: 2,
      });
      expect(result.success).toBe(true);
    });

    it("rejects a negative total", () => {
      expect(
        TodayUpcomingDaySchema.safeParse({ date: DATE, tasks: [], events: [], total: -1 }).success,
      ).toBe(false);
    });
  });

  describe("TodayInboxItemSchema", () => {
    it("accepts a pending capture with no transcript yet", () => {
      const result = TodayInboxItemSchema.safeParse({
        id: UUID,
        raw_text: null,
        status: "pending",
        captured_at: NOW,
        entity_type: null,
      });
      expect(result.success).toBe(true);
    });

    it("accepts any entity_type string but only known statuses", () => {
      expect(
        TodayInboxItemSchema.safeParse({
          id: UUID,
          raw_text: "call mom",
          status: "needs_confirm",
          captured_at: NOW,
          entity_type: "task",
        }).success,
      ).toBe(true);
      expect(
        TodayInboxItemSchema.safeParse({
          id: UUID,
          raw_text: "call mom",
          status: "exploded",
          captured_at: NOW,
          entity_type: null,
        }).success,
      ).toBe(false);
    });
  });

  describe("TodayProjectSummarySchema", () => {
    it("accepts a fully computed summary", () => {
      const result = TodayProjectSummarySchema.safeParse({
        id: UUID,
        name: "Home",
        color: "#ff0000",
        status: "active",
        target_date: "2026-09-01",
        next_action: {
          task_id: UUID2,
          title: "Fix the sink",
          due_at: `${DATE}T17:00:00Z`,
          priority: null,
        },
        open_task_count: 3,
        overdue_task_count: 1,
        done_task_count: 7,
        last_activity_at: NOW,
        stalled: false,
      });
      expect(result.success).toBe(true);
    });

    it("accepts no next action and rejects an unknown status", () => {
      expect(
        TodayProjectSummarySchema.safeParse({
          id: UUID,
          name: "Home",
          color: null,
          status: "active",
          target_date: null,
          next_action: null,
          open_task_count: 0,
          overdue_task_count: 0,
          done_task_count: 0,
          last_activity_at: null,
          stalled: true,
        }).success,
      ).toBe(true);
      expect(
        TodayProjectSummarySchema.safeParse({
          id: UUID,
          name: "Home",
          color: null,
          status: "archived",
          target_date: null,
          next_action: null,
          open_task_count: 0,
          overdue_task_count: 0,
          done_task_count: 0,
          last_activity_at: null,
          stalled: false,
        }).success,
      ).toBe(false);
    });
  });

  describe("TodayResponseSchema", () => {
    it("round-trips a fully populated response", () => {
      const standaloneTask = { ...taskItem(), occurrence_id: undefined };
      const occurrence = taskItem({
        id: UUID3,
        title: "Water plants",
        due_at: null,
        project_id: UUID,
        project_name: "Home",
        parent_task_id: UUID,
        occurrence_id: UUID2,
        priority: null,
      });
      const result = TodayResponseSchema.safeParse({
        generated_at: NOW,
        effective_now: NOW,
        tz: "America/Chicago",
        local_date: DATE,
        summary: {
          overdue_total: 1,
          due_today_total: 2,
          inbox_attention_total: 1,
          active_project_count: 1,
        },
        overdue: { items: [occurrence], total: 1 },
        due_today: { items: [standaloneTask], total: 1 },
        events_today: { items: [eventItem()] },
        upcoming: {
          days: [
            {
              date: "2026-08-22",
              tasks: [],
              events: [eventItem({ id: UUID3, title: "Follow-up", occurs_at: null })],
              total: 1,
            },
          ],
        },
        inbox: {
          pending_count: 1,
          needs_confirm_count: 0,
          failed_count: 0,
          items: [
            {
              id: UUID,
              raw_text: "call mom sunday",
              status: "pending",
              captured_at: NOW,
              entity_type: null,
            },
          ],
        },
        projects: {
          active_count: 1,
          items: [
            {
              id: UUID,
              name: "Home",
              color: "#00ff00",
              status: "active",
              target_date: "2026-09-01",
              next_action: {
                task_id: UUID3,
                title: "Water plants",
                due_at: null,
                priority: null,
              },
              open_task_count: 2,
              overdue_task_count: 1,
              done_task_count: 4,
              last_activity_at: NOW,
              stalled: false,
            },
          ],
        },
        reviews: {
          daily: { period_start: DATE, review_id: null, status: null, last_completed_at: null },
          weekly: {
            period_start: DATE,
            review_id: UUID2,
            status: "completed",
            last_completed_at: NOW,
          },
        },
        brief: { generated_at: NOW, model_id: null },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.overdue.items[0]?.occurrence_id).toBe(UUID2);
        expect(result.data.summary.due_today_total).toBe(2);
        expect(result.data.upcoming.days).toHaveLength(1);
      }
    });

    it("parses with reviews/brief both null (pre-5.3/5.5 forward compatibility)", () => {
      const base = {
        generated_at: NOW,
        effective_now: NOW,
        tz: "UTC",
        local_date: DATE,
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
      };
      const result = TodayResponseSchema.safeParse({
        ...base,
        reviews: {
          daily: { period_start: DATE, review_id: null, status: null, last_completed_at: null },
          weekly: { period_start: DATE, review_id: null, status: null, last_completed_at: null },
        },
        brief: null,
      });
      expect(result.success).toBe(true);
    });

    it("rejects a naive datetime without offset", () => {
      expect(
        TodayResponseSchema.safeParse({
          generated_at: "2026-08-21T09:00:00",
          effective_now: NOW,
          tz: "UTC",
          local_date: DATE,
          summary: {},
          overdue: { items: [], total: 0 },
          due_today: { items: [], total: 0 },
          events_today: { items: [] },
          upcoming: { days: [] },
          inbox: {},
          projects: {},
          reviews: {},
          brief: null,
        }).success,
      ).toBe(false);
    });
  });

  describe("ProjectStatusSchema (re-exported contract for /today)", () => {
    it("exposes exactly the frozen lifecycle vocabulary", () => {
      expect([...PROJECT_STATUSES]).toEqual(["active", "paused", "completed"]);
      expect(ProjectStatusSchema.safeParse("paused").success).toBe(true);
      expect(ProjectStatusSchema.safeParse("archived").success).toBe(false);
    });
  });

  describe("occurrence linkage invariant (audit fix #4)", () => {
    it("rejects an occurrence representation without its parent_task_id", () => {
      const smuggler = { ...taskItem({ occurrence_id: UUID3 }), parent_task_id: null };
      expect(TodayTaskItemSchema.safeParse(smuggler).success).toBe(false);
    });

    it("accepts an occurrence with a parent and a standalone task without occurrence_id", () => {
      expect(
        TodayTaskItemSchema.safeParse(
          taskItem({
            occurrence_id: UUID3,
            parent_task_id: "123e4567-e89b-12d3-a456-426614174009",
          }),
        ).success,
      ).toBe(true);
      expect(
        TodayTaskItemSchema.safeParse({ ...taskItem(), occurrence_id: undefined }).success,
      ).toBe(true);
    });
  });

  describe("bounded section honest totals (audit fix #5)", () => {
    it("rejects a total smaller than the emitted items", () => {
      const result = boundedItemsSectionSchema(TodayTaskItemSchema).safeParse({
        items: [taskItem(), taskItem()],
        total: 1,
      });
      expect(result.success).toBe(false);
    });

    it("accepts a total at or above the emitted items count", () => {
      const section = boundedItemsSectionSchema(TodayTaskItemSchema);
      expect(section.safeParse({ items: [taskItem()], total: 1 }).success).toBe(true);
      expect(section.safeParse({ items: [taskItem()], total: 7 }).success).toBe(true);
    });
  });
});
