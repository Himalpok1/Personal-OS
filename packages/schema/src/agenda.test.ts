import { describe, expect, it } from "vitest";
import {
  AgendaEventItemSchema,
  AgendaItemSchema,
  AgendaOccurrenceItemSchema,
  AgendaQuerySchema,
  AgendaResponseSchema,
  AgendaTaskItemSchema,
} from "./agenda.js";
import { TodayTaskItemBaseSchema } from "./today.js";

const UUID = "123e4567-e89b-12d3-a456-426614174000";
const UUID2 = "123e4567-e89b-12d3-a456-426614174001";
const NOW = "2026-08-21T09:00:00Z";

function taskFields(overrides: Record<string, unknown> = {}) {
  return {
    id: UUID,
    title: "Pay rent",
    due_at: "2026-08-21T17:00:00Z",
    remind_at: null,
    timezone: "America/Chicago",
    priority: 1,
    project_id: null,
    project_name: null,
    rrule: null,
    parent_task_id: null,
    ...overrides,
  };
}

function eventFields(overrides: Record<string, unknown> = {}) {
  return {
    id: UUID2,
    title: "Dentist",
    starts_at: "2026-08-21T15:00:00Z",
    ends_at: "2026-08-21T16:00:00Z",
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

describe("Agenda schemas", () => {
  describe("AgendaQuerySchema", () => {
    it("accepts a valid range within the span cap", () => {
      expect(
        AgendaQuerySchema.safeParse({
          tz: "America/Chicago",
          from: "2026-08-01",
          to: "2026-09-30",
        }).success,
      ).toBe(true);
    });

    it("accepts a span of exactly 62 days and rejects 63", () => {
      expect(
        AgendaQuerySchema.safeParse({ tz: "UTC", from: "2026-01-01", to: "2026-03-04" }).success,
      ).toBe(true);
      expect(
        AgendaQuerySchema.safeParse({ tz: "UTC", from: "2026-01-01", to: "2026-03-05" }).success,
      ).toBe(false);
    });

    it("rejects an inverted range", () => {
      const result = AgendaQuerySchema.safeParse({
        tz: "UTC",
        from: "2026-09-01",
        to: "2026-08-01",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.path.includes("to"))).toBe(true);
      }
    });

    it("rejects malformed dates and invalid timezones", () => {
      expect(
        AgendaQuerySchema.safeParse({ tz: "UTC", from: "2026-8-1", to: "2026-09-01" }).success,
      ).toBe(false);
      expect(
        AgendaQuerySchema.safeParse({
          tz: "Not/AZone",
          from: "2026-08-01",
          to: "2026-09-01",
        }).success,
      ).toBe(false);
    });
  });

  describe("AgendaItemSchema discrimination", () => {
    it("accepts a standalone task kind without occurrence fields", () => {
      const result = AgendaItemSchema.safeParse({ kind: "task", ...taskFields() });
      expect(result.success).toBe(true);
    });

    it("rejects event items inside the overdue array (audit fix #6)", () => {
      const result = AgendaResponseSchema.safeParse({
        tz: "UTC",
        from: "2026-08-21",
        to: "2026-08-21",
        generated_at: "2026-08-21T09:00:00Z",
        effective_now: "2026-08-21T09:00:00Z",
        overdue: [
          {
            kind: "event",
            id: UUID,
            title: "An event cannot be overdue",
            starts_at: null,
            ends_at: null,
            all_day: false,
            start_date: null,
            end_date: null,
            location: null,
            project_id: null,
            rrule: null,
            parent_event_id: null,
            occurs_at: null,
          },
        ],
        days: [],
      });
      expect(result.success).toBe(false);
    });

    it("accepts task and occurrence items inside the overdue array", () => {
      const result = AgendaResponseSchema.safeParse({
        tz: "UTC",
        from: "2026-08-21",
        to: "2026-08-21",
        generated_at: "2026-08-21T09:00:00Z",
        effective_now: "2026-08-21T09:00:00Z",
        overdue: [
          { kind: "task", ...taskFields() },
          {
            kind: "occurrence",
            ...taskFields({ parent_task_id: UUID2 }),
            occurrence_id: UUID,
            occurs_at: "2026-08-20T17:00:00Z",
          },
        ],
        days: [],
      });
      expect(result.success).toBe(true);
    });

    it("requires occurrence_id, non-null parent_task_id, and occurs_at for occurrences", () => {
      const base = taskFields({ parent_task_id: UUID2 });
      expect(
        AgendaOccurrenceItemSchema.safeParse({
          kind: "occurrence",
          ...base,
          occurrence_id: UUID,
          occurs_at: "2026-08-22T17:00:00Z",
        }).success,
      ).toBe(true);
      expect(
        AgendaItemSchema.safeParse({ kind: "occurrence", ...base, occurs_at: NOW }).success,
      ).toBe(false);
      expect(
        AgendaItemSchema.safeParse({
          kind: "occurrence",
          ...base,
          occurrence_id: null,
          occurs_at: NOW,
        }).success,
      ).toBe(false);
      expect(
        AgendaItemSchema.safeParse({
          kind: "occurrence",
          ...base,
          occurrence_id: UUID,
          parent_task_id: null,
          occurs_at: NOW,
        }).success,
      ).toBe(false);
    });

    it("accepts an event kind reusing the Today event shape", () => {
      expect(AgendaEventItemSchema.safeParse({ kind: "event", ...eventFields() }).success).toBe(
        true,
      );
    });

    it("rejects an unknown kind", () => {
      expect(AgendaItemSchema.safeParse({ kind: "note", ...taskFields() }).success).toBe(false);
    });

    it("keeps the task variant aligned with the Today task base shape", () => {
      const parsed = TodayTaskItemBaseSchema.parse(taskFields());
      expect(AgendaTaskItemSchema.safeParse({ kind: "task", ...parsed }).success).toBe(true);
    });
  });

  describe("AgendaResponseSchema", () => {
    it("round-trips a fully populated response", () => {
      const result = AgendaResponseSchema.safeParse({
        tz: "America/Chicago",
        from: "2026-08-21",
        to: "2026-08-22",
        generated_at: NOW,
        effective_now: NOW,
        overdue: [
          {
            kind: "occurrence",
            ...taskFields({ due_at: null, parent_task_id: UUID2 }),
            occurrence_id: UUID,
            occurs_at: "2026-08-20T17:00:00Z",
          },
        ],
        days: [
          {
            date: "2026-08-21",
            items: [
              { kind: "task", ...taskFields() },
              { kind: "event", ...eventFields() },
            ],
          },
          { date: "2026-08-22", items: [] },
        ],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.days[0]?.items).toHaveLength(2);
        expect(result.data.overdue[0]?.kind).toBe("occurrence");
      }
    });

    it("rejects a naive generated_at", () => {
      expect(
        AgendaResponseSchema.safeParse({
          tz: "UTC",
          from: "2026-08-21",
          to: "2026-08-21",
          generated_at: "2026-08-21T09:00:00",
          effective_now: NOW,
          overdue: [],
          days: [],
        }).success,
      ).toBe(false);
    });
  });
});
