import { describe, expect, it } from "vitest";
import { TaskCreateSchema, TaskSchema, TaskUpdateSchema } from "./tasks.js";

describe("Task schemas", () => {
  describe("TaskCreateSchema", () => {
    it("accepts valid due-date recurring task", () => {
      const result = TaskCreateSchema.safeParse({
        title: "Pay rent",
        timezone: "America/Chicago",
        due_at: "2026-09-01T09:00:00Z",
        rrule: "FREQ=MONTHLY;BYMONTHDAY=1",
        recurrence_anchor: "due_date",
        recurrence_timezone: "America/Chicago",
        recurrence_until: "2027-01-01T00:00:00Z",
      });
      expect(result.success).toBe(true);
    });

    it("accepts valid completion-date recurring task", () => {
      const result = TaskCreateSchema.safeParse({
        title: "Clean bathroom",
        timezone: "America/Chicago",
        rrule: "FREQ=WEEKLY;INTERVAL=2",
        recurrence_anchor: "completion_date",
      });
      expect(result.success).toBe(true);
    });

    it("rejects mutual exclusivity of recurrence_until and recurrence_count", () => {
      const result = TaskCreateSchema.safeParse({
        title: "Bad task",
        timezone: "America/Chicago",
        rrule: "FREQ=DAILY",
        recurrence_until: "2026-12-31T23:59:59Z",
        recurrence_count: 5,
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid IANA timezone in recurrence_timezone", () => {
      const result = TaskCreateSchema.safeParse({
        title: "Bad timezone",
        timezone: "America/Chicago",
        rrule: "FREQ=DAILY",
        recurrence_timezone: "Invalid/Timezone",
      });
      expect(result.success).toBe(false);
    });

    it("rejects completion_date task with recurrence_until, count, or exdates", () => {
      expect(
        TaskCreateSchema.safeParse({
          title: "Bad completion",
          timezone: "America/Chicago",
          rrule: "FREQ=DAILY",
          recurrence_anchor: "completion_date",
          recurrence_until: "2026-12-31T23:59:59Z",
        }).success,
      ).toBe(false);

      expect(
        TaskCreateSchema.safeParse({
          title: "Bad completion",
          timezone: "America/Chicago",
          rrule: "FREQ=DAILY",
          recurrence_anchor: "completion_date",
          recurrence_count: 3,
        }).success,
      ).toBe(false);

      expect(
        TaskCreateSchema.safeParse({
          title: "Bad completion",
          timezone: "America/Chicago",
          rrule: "FREQ=DAILY",
          recurrence_anchor: "completion_date",
          recurrence_exdates: ["2026-08-25"],
        }).success,
      ).toBe(false);
    });

    it("rejects completion_date task with unsupported rrule parts (e.g. BYDAY)", () => {
      const result = TaskCreateSchema.safeParse({
        title: "Bad rule",
        timezone: "America/Chicago",
        rrule: "FREQ=WEEKLY;BYDAY=MO,WE",
        recurrence_anchor: "completion_date",
      });
      expect(result.success).toBe(false);
    });

    it("enforces strict mode (rejects unknown properties)", () => {
      const result = TaskCreateSchema.safeParse({
        title: "Unknown property",
        timezone: "America/Chicago",
        extra_field: 123,
      });
      expect(result.success).toBe(false);
    });

    it("still rejects remind_at -- creation stays capture-only this checkpoint", () => {
      const result = TaskCreateSchema.safeParse({
        title: "New task",
        timezone: "America/Chicago",
        remind_at: "2026-09-01T15:00:00-05:00",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("TaskUpdateSchema", () => {
    it("accepts valid partial update", () => {
      const result = TaskUpdateSchema.safeParse({
        rrule: "FREQ=WEEKLY;INTERVAL=1",
        recurrence_anchor: "due_date",
        recurrence_count: 10,
      });
      expect(result.success).toBe(true);
    });

    it("rejects empty object update", () => {
      const result = TaskUpdateSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("accepts remind_at as an offset-bearing ISO datetime", () => {
      const result = TaskUpdateSchema.safeParse({
        remind_at: "2026-09-01T15:00:00-05:00",
      });
      expect(result.success).toBe(true);
    });

    it("accepts remind_at explicitly set to null (clearing it)", () => {
      const result = TaskUpdateSchema.safeParse({ remind_at: null });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.remind_at).toBeNull();
      }
    });

    it("still rejects unknown keys via .strict()", () => {
      const result = TaskUpdateSchema.safeParse({
        remind_at: "2026-09-01T15:00:00-05:00",
        made_up_field: true,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("TaskSchema", () => {
    it("parses full task with recurrence fields", () => {
      const result = TaskSchema.safeParse({
        id: "123e4567-e89b-12d3-a456-426614174000",
        title: "Test task",
        body: null,
        status: "active",
        due_at: "2026-08-20T12:00:00Z",
        remind_at: null,
        timezone: "America/Chicago",
        priority: 1,
        project_id: null,
        completed_at: null,
        rrule: "FREQ=DAILY",
        recurrence_anchor: "due_date",
        recurrence_timezone: "America/Chicago",
        recurrence_until: "2026-12-31T23:59:59Z",
        recurrence_count: null,
        recurrence_exdates: ["2026-09-01"],
        archived_at: null,
        created_at: "2026-08-20T12:00:00Z",
        updated_at: "2026-08-20T12:00:00Z",
      });
      expect(result.success).toBe(true);
    });
  });
});
