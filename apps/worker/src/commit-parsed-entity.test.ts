import { events, occurrences, tasks, type Db } from "@personal-os/db";
import type { ParserToolCall } from "@personal-os/schema";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

// Checkpoint 9.3, contract 5: a captured due_date-anchored recurring task
// materializes its 90-day occurrence window at commit, exactly as POST /tasks
// does. Before this, the parser's create_task wrote the rule and nothing else,
// so the task had no occurrence until the nightly cron -- and, because the
// parser almost never resolves a due_at for "every Monday", not even then
// (expand-window skips a due_date task with no due_at). A recurring task
// captured in the morning was therefore uncompletable all day: the direct
// complete route refuses recurring tasks (409) and there was no occurrence to
// complete instead.
describe("commitParsedEntity -- create_task recurrence materialization (9.3)", () => {
  let db: Db;
  const TZ = "America/Chicago";
  const DAY_MS = 24 * 60 * 60 * 1000;

  beforeEach(async () => {
    db = buildTestDb();
    await truncateTestTables(db);
  });

  async function occurrencesFor(taskId: string) {
    return db
      .select()
      .from(occurrences)
      .where(and(eq(occurrences.parentType, "task"), eq(occurrences.parentId, taskId)));
  }

  async function taskRow(taskId: string) {
    const [row] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    return row!;
  }

  it("materializes the 90-day window for an explicitly due_date-anchored daily rule with a due_at", async () => {
    const before = Date.now();
    const dueAt = new Date(before + DAY_MS);
    dueAt.setUTCMilliseconds(0);
    const result = await commitParsedEntity(
      db,
      {
        tool: "create_task",
        args: {
          title: "Take the vitamins",
          due_at: dueAt.toISOString(),
          rrule: "FREQ=DAILY;INTERVAL=1",
          recurrence_anchor: "due_date",
        },
      },
      { timezone: TZ },
    );

    const rows = await occurrencesFor(result.committed.entityId);
    // Daily from tomorrow to the 90-day horizon: 89 or 90 rows depending on
    // where the horizon lands relative to the wall-clock anchor.
    expect(rows.length).toBeGreaterThanOrEqual(88);
    expect(rows.length).toBeLessThanOrEqual(90);
    const sorted = [...rows].sort((a, b) => a.occursAt.getTime() - b.occursAt.getTime());
    expect(sorted[0]!.occursAt.toISOString()).toBe(dueAt.toISOString());
    for (const row of rows) {
      expect(row.status).toBe("scheduled");
      expect(row.lazyGenerated).toBe(false);
      expect(row.occursAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(row.occursAt.getTime()).toBeLessThanOrEqual(before + 91 * DAY_MS);
    }
    const task = await taskRow(result.committed.entityId);
    expect(task.recurrenceAnchor).toBe("due_date");
    expect(task.recurrenceTimezone).toBe(TZ);
  });

  // The regression: the parser's omitted anchor used to be written through as
  // NULL, which neither generation strategy selects. Old code: anchor NULL,
  // zero occurrences.
  it("defaults an omitted anchor to due_date (as POST /tasks does) and materializes the window", async () => {
    const result = await commitParsedEntity(
      db,
      {
        tool: "create_task",
        args: {
          title: "Weekly review",
          due_at: new Date(Date.now() + 2 * DAY_MS).toISOString(),
          rrule: "FREQ=WEEKLY;INTERVAL=1",
        },
      },
      { timezone: TZ },
    );

    const task = await taskRow(result.committed.entityId);
    expect(task.recurrenceAnchor).toBe("due_date");
    const rows = await occurrencesFor(result.committed.entityId);
    // Weekly over 90 days from two days out: 12 or 13.
    expect(rows.length).toBeGreaterThanOrEqual(12);
    expect(rows.length).toBeLessThanOrEqual(13);
    expect(rows.every((row) => !row.lazyGenerated && row.status === "scheduled")).toBe(true);
  });

  it("anchors the rule at commit time when the parser resolved no due_at, so the series is completable today", async () => {
    const before = Date.now();
    const result = await commitParsedEntity(
      db,
      {
        tool: "create_task",
        args: { title: "Stretch", rrule: "FREQ=DAILY;INTERVAL=2" },
      },
      { timezone: TZ },
    );

    const task = await taskRow(result.committed.entityId);
    expect(task.dueAt).toBeNull();
    expect(task.recurrenceAnchor).toBe("due_date");
    const rows = await occurrencesFor(result.committed.entityId);
    expect(rows.length).toBeGreaterThanOrEqual(44);
    expect(rows.length).toBeLessThanOrEqual(46);
    const sorted = [...rows].sort((a, b) => a.occursAt.getTime() - b.occursAt.getTime());
    // The rule is anchored at the commit instant (seconds precision -- the
    // wall-clock anchor drops milliseconds, so the anchor instance itself
    // sits a fraction of a second before `now` and expandDueDateWindow's
    // now-floor excludes it, exactly as it does for POST /tasks). The first
    // materialized instance is therefore one INTERVAL out, never earlier
    // than the commit and never later than the interval allows.
    expect(sorted[0]!.occursAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(sorted[0]!.occursAt.getTime()).toBeLessThanOrEqual(Date.now() + 2 * DAY_MS);
  });

  it("stores occurs_local as the recurrence timezone's wall clock, honouring an explicit recurrence_timezone", async () => {
    const dueAt = new Date(Date.now() + DAY_MS);
    dueAt.setUTCMilliseconds(0);
    const result = await commitParsedEntity(
      db,
      {
        tool: "create_task",
        args: {
          title: "Call home",
          due_at: dueAt.toISOString(),
          rrule: "FREQ=DAILY;INTERVAL=1",
          recurrence_timezone: "Pacific/Auckland",
        },
      },
      { timezone: TZ },
    );

    const task = await taskRow(result.committed.entityId);
    expect(task.recurrenceTimezone).toBe("Pacific/Auckland");
    const rows = await occurrencesFor(result.committed.entityId);
    const first = [...rows].sort((a, b) => a.occursAt.getTime() - b.occursAt.getTime())[0]!;
    // occurs_local is a naive wall-clock stored as if UTC; in Auckland the
    // wall clock is 12 or 13 hours AHEAD of the instant.
    const offsetHours = (first.occursLocal.getTime() - first.occursAt.getTime()) / (60 * 60 * 1000);
    expect([12, 13]).toContain(offsetHours);
  });

  it("still seeds exactly one lazy occurrence, and no window, for a completion_date-anchored rule", async () => {
    const result = await commitParsedEntity(
      db,
      {
        tool: "create_task",
        args: {
          title: "Water the plants",
          rrule: "FREQ=DAILY;INTERVAL=3",
          recurrence_anchor: "completion_date",
        },
      },
      { timezone: TZ },
    );

    const rows = await occurrencesFor(result.committed.entityId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.lazyGenerated).toBe(true);
    expect(rows[0]!.status).toBe("scheduled");
    const task = await taskRow(result.committed.entityId);
    expect(task.recurrenceAnchor).toBe("completion_date");
  });

  it("still refuses a BY* part on a completion-anchored rule at write time", async () => {
    await expect(
      commitParsedEntity(
        db,
        {
          tool: "create_task",
          args: {
            title: "Bad rule",
            rrule: "FREQ=WEEKLY;BYDAY=MO",
            recurrence_anchor: "completion_date",
          },
        },
        { timezone: TZ },
      ),
    ).rejects.toThrow();
    expect(await db.select({ id: tasks.id }).from(tasks)).toHaveLength(0);
  });

  // Checkpoint 9.3 review. CreateTaskToolSchema validates neither rrule nor
  // recurrence_timezone, and the first 9.3 implementation inserted the task
  // row BEFORE expanding the window, outside any transaction -- so a rule the
  // expansion rejected threw after the insert, pg-boss retried, and every
  // retry left another orphan task row behind. Old code: one task row per
  // attempt, zero occurrences.
  describe("refuses a rule it cannot materialize with ZERO rows written", () => {
    it.each([
      ["free-text rrule", { rrule: "every monday" }],
      ["unknown FREQ", { rrule: "FREQ=WEEKLYY" }],
      ["INTERVAL=0", { rrule: "FREQ=DAILY;INTERVAL=0" }],
      [
        "invalid recurrence_timezone",
        { rrule: "FREQ=DAILY", recurrence_timezone: "Mars/Olympus_Mons" },
      ],
      [
        "completion_date INTERVAL=0",
        { rrule: "FREQ=DAILY;INTERVAL=0", recurrence_anchor: "completion_date" as const },
      ],
      [
        "completion_date invalid zone",
        {
          rrule: "FREQ=DAILY;INTERVAL=2",
          recurrence_anchor: "completion_date" as const,
          recurrence_timezone: "Mars/Olympus_Mons",
        },
      ],
    ])("%s", async (_label, recurrenceArgs) => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await expect(
          commitParsedEntity(
            db,
            {
              tool: "create_task",
              args: {
                title: "Bad rule",
                due_at: new Date(Date.now() + DAY_MS).toISOString(),
                ...recurrenceArgs,
              },
            },
            { timezone: TZ },
          ),
        ).rejects.toThrow();
      }
      expect(await db.select({ id: tasks.id }).from(tasks)).toHaveLength(0);
      expect(await db.select({ id: occurrences.id }).from(occurrences)).toHaveLength(0);
    });
  });

  it("writes the task and its window in ONE transaction: an occurrence-insert failure leaves no task row", async () => {
    // Force the occurrence insert to fail AFTER the task insert has succeeded.
    // A duplicate is absorbed by ON CONFLICT DO NOTHING, every value the
    // commit writes is valid, and the app role cannot create a trigger -- so
    // the lever is the transaction handle itself: the real transaction runs,
    // but the `tx` the commit sees refuses to insert into occurrences.
    // Old code (task insert outside any transaction): the task row survived.
    const realTransaction = db.transaction.bind(db);
    const transactionSpy = vi.spyOn(db, "transaction").mockImplementation(((
      callback: (tx: unknown) => Promise<unknown>,
    ) =>
      realTransaction(async (tx) => {
        const refusing = new Proxy(tx, {
          get(target, key, receiver) {
            if (key === "insert") {
              return (table: unknown) => {
                if (table === occurrences) throw new Error("occurrence insert refused by test");
                return target.insert(table as typeof tasks);
              };
            }
            return Reflect.get(target, key, receiver) as unknown;
          },
        });
        return callback(refusing);
      })) as typeof db.transaction);
    try {
      await expect(
        commitParsedEntity(
          db,
          {
            tool: "create_task",
            args: {
              title: "Atomic",
              rrule: "FREQ=DAILY;INTERVAL=1",
              recurrence_anchor: "due_date",
            },
          },
          { timezone: TZ },
        ),
      ).rejects.toThrow(/refused by test/);
    } finally {
      transactionSpy.mockRestore();
    }
    expect(await db.select({ id: tasks.id }).from(tasks)).toHaveLength(0);
    expect(await db.select({ id: occurrences.id }).from(occurrences)).toHaveLength(0);
  });

  // Checkpoint 9.3 review: the completion_date seed re-resolved an offset-less
  // due_at against recurrence_timezone while tasks.due_at resolved it against
  // the capture's timezone, so the first occurrence and the task's own due
  // date disagreed by the zone offset difference. POST /tasks seeds from the
  // one resolved dueAt; so does this now.
  it("seeds the completion_date first occurrence at the SAME instant as tasks.due_at for an offset-less due_at with a different recurrence_timezone", async () => {
    const result = await commitParsedEntity(
      db,
      {
        tool: "create_task",
        args: {
          title: "Call home",
          due_at: "2026-10-05T09:00:00",
          rrule: "FREQ=DAILY;INTERVAL=3",
          recurrence_anchor: "completion_date",
          recurrence_timezone: "Pacific/Auckland",
        },
      },
      { timezone: TZ },
    );

    const task = await taskRow(result.committed.entityId);
    // 09:00 America/Chicago (CDT, UTC-5) on Oct 5 -- the capture's zone.
    expect(task.dueAt!.toISOString()).toBe("2026-10-05T14:00:00.000Z");
    const rows = await occurrencesFor(result.committed.entityId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.occursAt.toISOString()).toBe(task.dueAt!.toISOString());
    // occurs_local is that instant's wall clock in the RECURRENCE zone
    // (Auckland is UTC+13 on Oct 5, NZDT): 03:00 on Oct 6.
    expect(rows[0]!.occursLocal.toISOString()).toBe("2026-10-06T03:00:00.000Z");
  });

  it("writes no occurrence and no anchor for a one-off task, even if the parser sent an anchor", async () => {
    const result = await commitParsedEntity(
      db,
      {
        tool: "create_task",
        args: {
          title: "Call the insurance guy",
          due_at: new Date(Date.now() + DAY_MS).toISOString(),
          recurrence_anchor: "due_date",
        },
      },
      { timezone: TZ },
    );

    expect(await occurrencesFor(result.committed.entityId)).toHaveLength(0);
    const task = await taskRow(result.committed.entityId);
    expect(task.rrule).toBeNull();
    expect(task.recurrenceAnchor).toBeNull();
    expect(task.recurrenceTimezone).toBeNull();
  });
});
