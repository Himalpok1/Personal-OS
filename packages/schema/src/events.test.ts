import { describe, expect, it } from "vitest";
import { EventCreateSchema, EventSchema, EventUpdateSchema } from "./events.js";

describe("Event schemas", () => {
  describe("EventCreateSchema", () => {
    it("accepts valid recurring event", () => {
      const result = EventCreateSchema.safeParse({
        title: "Daily sync",
        timezone: "America/Chicago",
        starts_at: "2026-08-21T09:00:00Z",
        ends_at: "2026-08-21T09:30:00Z",
        rrule: "FREQ=DAILY;INTERVAL=1",
        recurrence_timezone: "America/Chicago",
        recurrence_until: "2026-12-31T23:59:59Z",
      });
      expect(result.success).toBe(true);
    });

    it("rejects recurrence_anchor on event (strict)", () => {
      const result = EventCreateSchema.safeParse({
        title: "Bad event",
        timezone: "America/Chicago",
        starts_at: "2026-08-21T09:00:00Z",
        rrule: "FREQ=DAILY",
        recurrence_anchor: "due_date",
      });
      expect(result.success).toBe(false);
    });

    it("rejects mutual exclusivity of recurrence_until and recurrence_count", () => {
      const result = EventCreateSchema.safeParse({
        title: "Bad event",
        timezone: "America/Chicago",
        starts_at: "2026-08-21T09:00:00Z",
        rrule: "FREQ=DAILY",
        recurrence_until: "2026-12-31T23:59:59Z",
        recurrence_count: 5,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("EventUpdateSchema", () => {
    it("rejects recurrence_anchor on update (strict)", () => {
      const result = EventUpdateSchema.safeParse({
        rrule: "FREQ=WEEKLY",
        recurrence_anchor: "due_date",
      });
      expect(result.success).toBe(false);
    });

    it("accepts valid recurrence update", () => {
      const result = EventUpdateSchema.safeParse({
        rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
        recurrence_count: 10,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("EventSchema", () => {
    it("parses full event with recurrence fields", () => {
      const result = EventSchema.safeParse({
        id: "123e4567-e89b-12d3-a456-426614174000",
        title: "Test event",
        description: null,
        location: null,
        starts_at: "2026-08-20T12:00:00Z",
        ends_at: "2026-08-20T13:00:00Z",
        timezone: "America/Chicago",
        all_day: false,
        start_date: null,
        end_date: null,
        rrule: "FREQ=WEEKLY",
        recurrence_timezone: "America/Chicago",
        recurrence_until: null,
        recurrence_count: 10,
        recurrence_exdates: ["2026-09-01"],
        project_id: null,
        archived_at: null,
        created_at: "2026-08-20T12:00:00Z",
        updated_at: "2026-08-20T12:00:00Z",
      });
      expect(result.success).toBe(true);
    });
  });
});
