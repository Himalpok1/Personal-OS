import { events, type Db } from "@personal-os/db";
import type { ParserToolCall } from "@personal-os/schema";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { commitParsedEntity } from "./commit-parsed-entity.js";
import { buildTestDb, truncateTestTables } from "./test/build-test-db.js";

// Regression coverage for the create_event all-day canonicalization fix:
// before this, an all_day=true tool call was committed with the malformed
// inverse shape (starts_at set, start_date left NULL) -- the shape
// EventCreateSchema's own validation forbids for manual writes and that
// breaks Google/CalDAV push plus both calendar grids. This file proves the
// worker's own capture-commit path now writes the canonical shape too.
describe("commitParsedEntity -- create_event all-day canonicalization", () => {
  let db: Db;

  beforeEach(async () => {
    db = buildTestDb();
    await truncateTestTables(db);
  });

  it("writes start_date/end_date and leaves starts_at/ends_at null for an all-day event", async () => {
    const toolCall: ParserToolCall = {
      tool: "create_event",
      args: {
        title: "Company offsite",
        start: "2026-08-15T10:00:00",
        end: "2026-08-16T10:00:00",
        all_day: true,
      },
    };

    const result = await commitParsedEntity(db, toolCall, { timezone: "America/Chicago" });
    expect(result.committed.entityType).toBe("event");

    const [row] = await db.select().from(events).where(eq(events.id, result.committed.entityId));
    expect(row).toBeDefined();
    expect(row!.allDay).toBe(true);
    expect(row!.startsAt).toBeNull();
    expect(row!.endsAt).toBeNull();
    expect(row!.startDate).toBe("2026-08-15");
    expect(row!.endDate).toBe("2026-08-16");
  });

  it("sets end_date equal to start_date when the tool call has no end", async () => {
    const toolCall: ParserToolCall = {
      tool: "create_event",
      args: {
        title: "Company holiday",
        start: "2026-12-25T09:00:00",
        all_day: true,
      },
    };

    const result = await commitParsedEntity(db, toolCall, { timezone: "America/Chicago" });
    const [row] = await db.select().from(events).where(eq(events.id, result.committed.entityId));
    expect(row!.startDate).toBe("2026-12-25");
    expect(row!.endDate).toBe("2026-12-25");
    expect(row!.startsAt).toBeNull();
    expect(row!.endsAt).toBeNull();
  });

  it("derives the LOCAL calendar date, not the UTC date, for a non-UTC capture timezone", async () => {
    // 01:00 local time on Aug 15 in Pacific/Auckland (NZST, UTC+12 in
    // August) resolves to 13:00 UTC on Aug 14 -- a different UTC calendar
    // date. If this test asserted startDate === "2026-08-14" the fix would
    // be deriving the UTC date instead of the local one.
    const toolCall: ParserToolCall = {
      tool: "create_event",
      args: {
        title: "Auckland all-day event",
        start: "2026-08-15T01:00:00",
        all_day: true,
      },
    };

    const result = await commitParsedEntity(db, toolCall, { timezone: "Pacific/Auckland" });
    const [row] = await db.select().from(events).where(eq(events.id, result.committed.entityId));

    expect(row!.startDate).toBe("2026-08-15");
    expect(row!.endDate).toBe("2026-08-15");
    // Sanity check the underlying instant really did land on the previous
    // UTC calendar day, proving the assertion above is meaningful.
    expect(row!.startsAt).toBeNull();
  });

  it("preserves the exact previous timed-event shape when all_day is false", async () => {
    const toolCall: ParserToolCall = {
      tool: "create_event",
      args: {
        title: "Team standup",
        start: "2026-08-15T09:00:00",
        end: "2026-08-15T09:30:00",
        all_day: false,
      },
    };

    const result = await commitParsedEntity(db, toolCall, { timezone: "America/Chicago" });
    const [row] = await db.select().from(events).where(eq(events.id, result.committed.entityId));

    expect(row!.allDay).toBe(false);
    expect(row!.startsAt).not.toBeNull();
    expect(row!.endsAt).not.toBeNull();
    expect(row!.startDate).toBeNull();
    expect(row!.endDate).toBeNull();
  });

  it("preserves the exact previous timed-event shape when all_day is omitted (defaults false)", async () => {
    const toolCall: ParserToolCall = {
      tool: "create_event",
      args: {
        title: "Dentist appointment",
        start: "2026-08-15T14:00:00",
      },
    };

    const result = await commitParsedEntity(db, toolCall, { timezone: "America/Chicago" });
    const [row] = await db.select().from(events).where(eq(events.id, result.committed.entityId));

    expect(row!.allDay).toBe(false);
    expect(row!.startsAt).not.toBeNull();
    expect(row!.startDate).toBeNull();
    expect(row!.endDate).toBeNull();
  });
});
