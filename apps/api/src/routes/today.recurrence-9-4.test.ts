import {
  localDayWindow,
  localDayWindowForDate,
  toWallClockComponents,
  wallClockToNaiveDate,
  type LocalDayWindow,
} from "@personal-os/core";
import { occurrences, projects, tasks } from "@personal-os/db";
import {
  AgendaResponseSchema,
  DailyReviewContextSchema,
  TodayResponseSchema,
} from "@personal-os/schema";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";

// Checkpoint 9.4 read-model contracts: a recurring parent never appears as a
// bare row bucketed by its anchor due_at (it enters Today only through its
// occurrences), an occurrence buckets on greatest(occurs_at, snoozed_until)
// -- a snooze only ever DEFERS -- and carries snoozed_until, and a project's
// overdue count follows the same rule.

const TZ = "America/Chicago";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function addLocalDays(localDate: string, days: number): string {
  const [year, month, day] = localDate.split("-").map(Number);
  const next = new Date(Date.UTC(year!, month! - 1, day, 12) + days * 86_400_000);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${String(next.getUTCFullYear()).padStart(4, "0")}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

function midWindowInstant(w: LocalDayWindow): Date {
  const half = Math.floor((w.endUtcExclusive.getTime() - w.startUtc.getTime()) / 2);
  return new Date(w.startUtc.getTime() + half);
}

function dayHasHourMargins(now: Date, w: LocalDayWindow, hours: number): boolean {
  return (
    now.getTime() - w.startUtc.getTime() >= hours * HOUR_MS &&
    w.endUtcExclusive.getTime() - now.getTime() >= hours * HOUR_MS
  );
}

describe("GET /today -- Checkpoint 9.4 recurrence and snooze", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateTestTables(app);
  });

  async function getToday() {
    const response = await app.inject({
      method: "GET",
      url: `/today?tz=${encodeURIComponent(TZ)}`,
    });
    expect(response.statusCode).toBe(200);
    return TodayResponseSchema.parse(response.json());
  }

  async function insertOccurrence(
    taskId: string,
    occursAt: Date,
    overrides: Partial<typeof occurrences.$inferInsert> = {},
  ) {
    const [row] = await app.db
      .insert(occurrences)
      .values({
        parentType: "task",
        parentId: taskId,
        occursAt,
        occursLocal: wallClockToNaiveDate(toWallClockComponents(occursAt, TZ)),
        status: "scheduled",
        lazyGenerated: false,
        ...overrides,
      })
      .returning();
    return row!;
  }

  it("a monthly parent whose next occurrence is 20 days out appears in NO section and counts nowhere", async () => {
    const [project] = await app.db
      .insert(projects)
      .values({ name: "Household", status: "active" })
      .returning();
    const [parent] = await app.db
      .insert(tasks)
      .values({
        title: "Pay rent",
        timezone: TZ,
        status: "active",
        rrule: "FREQ=MONTHLY;BYMONTHDAY=1",
        recurrenceAnchor: "due_date",
        recurrenceTimezone: TZ,
        // The series anchor -- ten days in the past, which pre-9.4 bucketed
        // the bare parent as overdue every single day.
        dueAt: new Date(Date.now() - 10 * DAY_MS),
        projectId: project!.id,
      })
      .returning();
    await insertOccurrence(parent!.id, new Date(Date.now() + 20 * DAY_MS));
    await insertOccurrence(parent!.id, new Date(Date.now() - 10 * DAY_MS), {
      status: "done",
      completedAt: new Date(Date.now() - 10 * DAY_MS),
    });

    const body = await getToday();
    const rendered = [
      ...body.overdue.items,
      ...body.due_today.items,
      ...body.upcoming.days.flatMap((day) => day.tasks),
    ];
    expect(rendered).toEqual([]);
    expect(body.summary.overdue_total).toBe(0);
    expect(body.summary.due_today_total).toBe(0);
    const summary = body.projects.items.find((item) => item.id === project!.id)!;
    expect(summary.open_task_count).toBe(1);
    expect(summary.overdue_task_count).toBe(0);
  });

  it("a recurring parent with NO scheduled occurrence at all is absent too (undated or dated)", async () => {
    const [undated] = await app.db
      .insert(tasks)
      .values({
        title: "Ended series",
        timezone: TZ,
        status: "active",
        rrule: "FREQ=DAILY",
        recurrenceAnchor: "due_date",
        recurrenceTimezone: TZ,
        dueAt: null,
      })
      .returning();
    await insertOccurrence(undated!.id, new Date(Date.now() - DAY_MS), { status: "skipped" });
    const body = await getToday();
    const rendered = [
      ...body.overdue.items,
      ...body.due_today.items,
      ...body.upcoming.days.flatMap((day) => day.tasks),
    ];
    expect(rendered).toEqual([]);
  });

  it("buckets a snoozed occurrence by snoozed_until and carries it on the row", async () => {
    const now = new Date();
    const window = localDayWindow(TZ, now);
    if (!dayHasHourMargins(now, window, 3)) return; // midnight-edge guard
    const tomorrow = localDayWindowForDate(TZ, addLocalDays(window.localDate, 1));

    const [parent] = await app.db
      .insert(tasks)
      .values({
        title: "Daily chore",
        timezone: TZ,
        status: "active",
        rrule: "FREQ=DAILY",
        recurrenceAnchor: "due_date",
        recurrenceTimezone: TZ,
        dueAt: new Date(now.getTime() - 5 * DAY_MS),
      })
      .returning();
    // Was due two hours ago (overdue), snoozed to mid-tomorrow.
    const snoozedUntil = midWindowInstant(tomorrow);
    const snoozed = await insertOccurrence(parent!.id, new Date(now.getTime() - 2 * HOUR_MS), {
      snoozedUntil,
    });
    // A second instance later today, untouched.
    const later = await insertOccurrence(parent!.id, new Date(now.getTime() + 2 * HOUR_MS));

    const body = await getToday();
    expect(body.overdue.items).toEqual([]);
    expect(body.summary.overdue_total).toBe(0);

    expect(body.due_today.items.map((item) => item.occurrence_id)).toEqual([later.id]);
    expect(body.due_today.items[0]!.snoozed_until).toBeNull();

    const day0 = body.upcoming.days[0]!;
    expect(day0.date).toBe(tomorrow.localDate);
    expect(day0.tasks.map((item) => item.occurrence_id)).toEqual([snoozed.id]);
    expect(day0.tasks[0]!.due_at).toBe(snoozedUntil.toISOString());
    expect(day0.tasks[0]!.snoozed_until).toBe(snoozedUntil.toISOString());
    expect(day0.tasks[0]!.parent_task_id).toBe(parent!.id);
    expect(day0.tasks[0]!.rrule).toBe("FREQ=DAILY");
  });

  it("a snooze EARLIER than occurs_at leaves the occurrence where the rule put it (greatest, never earlier)", async () => {
    const now = new Date();
    const window = localDayWindow(TZ, now);
    if (!dayHasHourMargins(now, window, 3)) return; // midnight-edge guard
    const tomorrow = localDayWindowForDate(TZ, addLocalDays(window.localDate, 1));

    const [parent] = await app.db
      .insert(tasks)
      .values({
        title: "Daily chore",
        timezone: TZ,
        status: "active",
        rrule: "FREQ=DAILY",
        recurrenceAnchor: "due_date",
        recurrenceTimezone: TZ,
        dueAt: new Date(now.getTime() - 5 * DAY_MS),
      })
      .returning();
    // Due mid-tomorrow; the owner snoozed its day-before reminder to an hour
    // from now. Under a plain coalesce that would drag the instance onto
    // TODAY; it must stay tomorrow, carrying the snooze for display.
    const occursAt = midWindowInstant(tomorrow);
    const snoozedUntil = new Date(now.getTime() + HOUR_MS);
    const occ = await insertOccurrence(parent!.id, occursAt, { snoozedUntil });

    const body = await getToday();
    expect(body.overdue.items).toEqual([]);
    expect(body.due_today.items).toEqual([]);
    const day0 = body.upcoming.days[0]!;
    expect(day0.date).toBe(tomorrow.localDate);
    expect(day0.tasks.map((item) => item.occurrence_id)).toEqual([occ.id]);
    expect(day0.tasks[0]!.due_at).toBe(occursAt.toISOString());
    expect(day0.tasks[0]!.snoozed_until).toBe(snoozedUntil.toISOString());
  });

  it("a snooze that has itself passed makes the occurrence overdue again", async () => {
    const [parent] = await app.db
      .insert(tasks)
      .values({
        title: "Daily chore",
        timezone: TZ,
        status: "active",
        rrule: "FREQ=DAILY",
        recurrenceAnchor: "due_date",
        recurrenceTimezone: TZ,
        dueAt: new Date(Date.now() - 5 * DAY_MS),
      })
      .returning();
    const occ = await insertOccurrence(parent!.id, new Date(Date.now() - 2 * DAY_MS), {
      snoozedUntil: new Date(Date.now() - HOUR_MS),
    });
    const body = await getToday();
    expect(body.overdue.items.map((item) => item.occurrence_id)).toEqual([occ.id]);
    expect(body.overdue.items[0]!.due_at).toBe(occ.snoozedUntil!.toISOString());
  });

  it("a snoozed occurrence beyond the horizon leaves Today, even though occurs_at is inside it", async () => {
    const [parent] = await app.db
      .insert(tasks)
      .values({
        title: "Daily chore",
        timezone: TZ,
        status: "active",
        rrule: "FREQ=DAILY",
        recurrenceAnchor: "due_date",
        recurrenceTimezone: TZ,
        dueAt: new Date(Date.now() - 5 * DAY_MS),
      })
      .returning();
    await insertOccurrence(parent!.id, new Date(Date.now() - HOUR_MS), {
      snoozedUntil: new Date(Date.now() + 20 * DAY_MS),
    });
    const body = await getToday();
    const rendered = [
      ...body.overdue.items,
      ...body.due_today.items,
      ...body.upcoming.days.flatMap((day) => day.tasks),
    ];
    expect(rendered).toEqual([]);
  });

  it("project overdue count includes a recurring parent only through a past-due effective occurrence", async () => {
    const [project] = await app.db
      .insert(projects)
      .values({ name: "Garden", status: "active" })
      .returning();
    const [parent] = await app.db
      .insert(tasks)
      .values({
        title: "Water",
        timezone: TZ,
        status: "active",
        rrule: "FREQ=DAILY",
        recurrenceAnchor: "due_date",
        recurrenceTimezone: TZ,
        dueAt: new Date(Date.now() - 30 * DAY_MS),
        projectId: project!.id,
      })
      .returning();
    // Past-due occurrence, but snoozed into the future -> not overdue.
    const occ = await insertOccurrence(parent!.id, new Date(Date.now() - DAY_MS), {
      snoozedUntil: new Date(Date.now() + DAY_MS),
    });
    let body = await getToday();
    expect(body.projects.items[0]!.overdue_task_count).toBe(0);

    // Clear the snooze -> overdue through the occurrence.
    await app.db.update(occurrences).set({ snoozedUntil: null }).where(eq(occurrences.id, occ.id));
    body = await getToday();
    expect(body.projects.items[0]!.overdue_task_count).toBe(1);
  });

  it("the daily review context follows the same rules: no bare parent, snoozed instant wins", async () => {
    const [parent] = await app.db
      .insert(tasks)
      .values({
        title: "Pay rent",
        timezone: TZ,
        status: "active",
        rrule: "FREQ=MONTHLY;BYMONTHDAY=1",
        recurrenceAnchor: "due_date",
        recurrenceTimezone: TZ,
        dueAt: new Date(Date.now() - 10 * DAY_MS),
      })
      .returning();
    // Past-due instance snoozed an hour into the past -> overdue via the
    // snooze instant; the parent's anchor itself never surfaces.
    const occ = await insertOccurrence(parent!.id, new Date(Date.now() - 3 * DAY_MS), {
      snoozedUntil: new Date(Date.now() - HOUR_MS),
    });
    const response = await app.inject({
      method: "GET",
      url: `/reviews/context/daily?tz=${encodeURIComponent(TZ)}`,
    });
    expect(response.statusCode).toBe(200);
    const body = DailyReviewContextSchema.parse(response.json());
    expect(body.overdue.items).toHaveLength(1);
    expect(body.overdue.items[0]).toMatchObject({
      occurrence_id: occ.id,
      due_at: occ.snoozedUntil!.toISOString(),
      snoozed_until: occ.snoozedUntil!.toISOString(),
    });
    expect(body.due_today.items).toEqual([]);
  });

  it("GET /agenda places a snoozed occurrence on the day it was snoozed to", async () => {
    const now = new Date();
    const window = localDayWindow(TZ, now);
    if (!dayHasHourMargins(now, window, 3)) return; // midnight-edge guard
    const tomorrow = localDayWindowForDate(TZ, addLocalDays(window.localDate, 1));
    const [parent] = await app.db
      .insert(tasks)
      .values({
        title: "Daily chore",
        timezone: TZ,
        status: "active",
        rrule: "FREQ=DAILY",
        recurrenceAnchor: "due_date",
        recurrenceTimezone: TZ,
        dueAt: new Date(now.getTime() - 5 * DAY_MS),
      })
      .returning();
    const snoozedUntil = midWindowInstant(tomorrow);
    const occ = await insertOccurrence(parent!.id, new Date(now.getTime() + HOUR_MS), {
      snoozedUntil,
    });
    const response = await app.inject({
      method: "GET",
      url: `/agenda?tz=${encodeURIComponent(TZ)}&from=${window.localDate}&to=${tomorrow.localDate}`,
    });
    expect(response.statusCode).toBe(200);
    const body = AgendaResponseSchema.parse(response.json());
    expect(body.days[0]!.items).toEqual([]);
    const items = body.days[1]!.items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "occurrence",
      occurrence_id: occ.id,
      occurs_at: snoozedUntil.toISOString(),
      due_at: snoozedUntil.toISOString(),
    });
  });
});
