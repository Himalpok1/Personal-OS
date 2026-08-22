import {
  localDayWindow,
  localDayWindowForDate,
  toWallClockComponents,
  wallClockToNaiveDate,
  type LocalDayWindow,
} from "@personal-os/core";
import { inboxItems, occurrences, projects, tasks } from "@personal-os/db";
import { TodayResponseSchema } from "@personal-os/schema";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";

const TZ = "America/Chicago";
const HOUR_MS = 60 * 60 * 1000;

// Same date arithmetic taste as the collector: anchor at noon UTC so
// adding whole days can never straddle a month boundary unexpectedly.
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

// Pretest guard: several bucketing tests craft instants relative to real
// now ("2h ago", "1h later") and only behave as named while those instants
// stay inside the intended side of the local day. Within HOURS_OF_MIDNIGHT
// of a boundary they'd be ambiguous -- skip gracefully instead of flaking.
function dayHasHourMargins(now: Date, w: LocalDayWindow, hours: number): boolean {
  return (
    now.getTime() - w.startUtc.getTime() >= hours * HOUR_MS &&
    w.endUtcExclusive.getTime() - now.getTime() >= hours * HOUR_MS
  );
}

describe("GET /today", () => {
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

  async function getToday(tz: string): Promise<ReturnType<FastifyInstance["inject"]>> {
    return app.inject({ method: "GET", url: `/today?tz=${encodeURIComponent(tz)}` });
  }

  it("rejects an invalid tz and a missing tz with 400 validation_failed", async () => {
    const invalid = await app.inject({ method: "GET", url: "/today?tz=Not/ARealZone" });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json<{ error: string }>().error).toBe("validation_failed");

    const missing = await app.inject({ method: "GET", url: "/today" });
    expect(missing.statusCode).toBe(400);
    expect(missing.json<{ error: string }>().error).toBe("validation_failed");
  });

  it("returns the honest empty read model on an empty database", async () => {
    const response = await getToday(TZ);
    expect(response.statusCode).toBe(200);

    const body = TodayResponseSchema.parse(response.json());
    const window = localDayWindow(TZ);

    expect(body.tz).toBe(TZ);
    expect(body.local_date).toBe(window.localDate);
    expect(body.generated_at).toBe(body.effective_now);

    expect(body.summary).toEqual({
      overdue_total: 0,
      due_today_total: 0,
      inbox_attention_total: 0,
      active_project_count: 0,
    });
    expect(body.overdue).toEqual({ items: [], total: 0 });
    expect(body.due_today).toEqual({ items: [], total: 0 });
    expect(body.events_today.items).toEqual([]);

    expect(body.upcoming.days).toHaveLength(7);
    for (let i = 0; i < 7; i += 1) {
      const expected = localDayWindowForDate(TZ, addLocalDays(window.localDate, i + 1));
      expect(body.upcoming.days[i]).toEqual({
        date: expected.localDate,
        tasks: [],
        events: [],
        total: 0,
      });
    }

    expect(body.inbox).toEqual({
      pending_count: 0,
      needs_confirm_count: 0,
      failed_count: 0,
      items: [],
    });
    expect(body.projects).toEqual({ active_count: 0, items: [] });
    expect(body.reviews).toEqual({ last_daily_review_at: null, last_weekly_review_at: null });
    expect(body.brief).toBeNull();
  });

  it("buckets an earlier-today due instant ONLY as overdue, never due-today", async () => {
    const now = new Date();
    const window = localDayWindow(TZ, now);
    if (!dayHasHourMargins(now, window, 2)) return; // midnight-edge guard

    await app.db.insert(tasks).values([
      {
        title: "Due two hours ago",
        timezone: TZ,
        status: "active",
        dueAt: new Date(now.getTime() - 2 * HOUR_MS),
      },
      {
        title: "Due in one hour",
        timezone: TZ,
        status: "active",
        dueAt: new Date(now.getTime() + 1 * HOUR_MS),
      },
    ]);

    const response = await getToday(TZ);
    expect(response.statusCode).toBe(200);
    const body = TodayResponseSchema.parse(response.json());

    expect(body.overdue.items.map((item) => item.title)).toEqual(["Due two hours ago"]);
    expect(body.overdue.total).toBe(1);
    expect(body.due_today.items.map((item) => item.title)).toEqual(["Due in one hour"]);
    expect(body.due_today.total).toBe(1);
    expect(body.summary.overdue_total).toBe(1);
    expect(body.summary.due_today_total).toBe(1);
  });

  it("merges recurring parents into their scheduled occurrences, suppresses the bare parent, and excludes skipped occurrences", async () => {
    const now = new Date();
    const window = localDayWindow(TZ, now);
    if (!dayHasHourMargins(now, window, 3)) return; // midnight-edge guard

    const [parent] = await app.db
      .insert(tasks)
      .values({
        title: "Daily chore",
        timezone: TZ,
        status: "active",
        rrule: "FREQ=DAILY;INTERVAL=1",
        recurrenceAnchor: "due_date",
        recurrenceTimezone: TZ,
        dueAt: new Date(now.getTime() - 2 * HOUR_MS),
      })
      .returning();

    const pastAt = new Date(now.getTime() - 2 * HOUR_MS);
    const laterTodayAt = new Date(now.getTime() + 2 * HOUR_MS);
    const skippedAt = new Date(now.getTime() - 3 * HOUR_MS);
    const occRows = await app.db
      .insert(occurrences)
      .values(
        [
          { at: pastAt, status: "scheduled" },
          { at: laterTodayAt, status: "scheduled" },
          { at: skippedAt, status: "skipped" },
        ].map(({ at, status }) => ({
          parentType: "task" as const,
          parentId: parent!.id,
          occursAt: at,
          occursLocal: wallClockToNaiveDate(toWallClockComponents(at, TZ)),
          status,
        })),
      )
      .returning();
    const scheduledIds = occRows.filter((row) => row.status === "scheduled").map((row) => row.id);
    const skippedId = occRows.find((row) => row.status === "skipped")!.id;

    const response = await getToday(TZ);
    expect(response.statusCode).toBe(200);
    const body = TodayResponseSchema.parse(response.json());

    const renderedTasks = [
      ...body.overdue.items,
      ...body.due_today.items,
      ...body.upcoming.days.flatMap((day) => day.tasks),
    ];

    // Exactly two actionable representations, both occurrence-shaped.
    expect(renderedTasks).toHaveLength(2);
    expect(renderedTasks.every((item) => item.id === parent!.id)).toBe(true);
    expect(renderedTasks.every((item) => item.title === "Daily chore")).toBe(true);
    expect(new Set(renderedTasks.map((item) => item.occurrence_id))).toEqual(new Set(scheduledIds));
    expect(renderedTasks.every((item) => item.parent_task_id === parent!.id)).toBe(true);

    // The bare parent itself never appears, and the skipped slot is gone.
    expect(renderedTasks.some((item) => item.occurrence_id == null)).toBe(false);
    expect(renderedTasks.some((item) => item.occurrence_id === skippedId)).toBe(false);

    // Past occurrence -> overdue; later-today occurrence -> due_today.
    expect(body.overdue.items).toHaveLength(1);
    expect(body.due_today.items).toHaveLength(1);
    expect(body.summary.overdue_total).toBe(1);
    expect(body.summary.due_today_total).toBe(1);

    // Occurrence rendering inherits the parent's metadata and carries the
    // occurrence's own due instant.
    const merged = [...body.overdue.items, ...body.due_today.items];
    expect(merged.every((item) => item.rrule === "FREQ=DAILY;INTERVAL=1")).toBe(true);
    expect(merged.map((item) => item.due_at).sort()).toEqual(
      [pastAt.toISOString(), laterTodayAt.toISOString()].sort(),
    );
  });

  it("shows today's all-day event under Pacific/Auckland via date-string classification", async () => {
    const nzTz = "Pacific/Auckland";
    const nzToday = localDayWindow(nzTz).localDate;

    const created = await app.inject({
      method: "POST",
      url: "/events",
      payload: {
        title: "NZ anniversary day",
        timezone: nzTz,
        all_day: true,
        start_date: nzToday,
        end_date: nzToday,
      },
    });
    expect(created.statusCode).toBe(201);

    const response = await getToday(nzTz);
    expect(response.statusCode).toBe(200);
    const body = TodayResponseSchema.parse(response.json());

    expect(body.events_today.items).toHaveLength(1);
    expect(body.events_today.items[0]).toMatchObject({
      title: "NZ anniversary day",
      all_day: true,
      start_date: nzToday,
      end_date: nzToday,
      starts_at: null,
    });
  });

  it("places a task due tomorrow into upcoming.days[0], disjoint from overdue/due_today", async () => {
    const window = localDayWindow(TZ);
    const tomorrow = localDayWindowForDate(TZ, addLocalDays(window.localDate, 1));

    await app.db.insert(tasks).values({
      title: "Tomorrow task",
      timezone: TZ,
      status: "active",
      dueAt: midWindowInstant(tomorrow),
    });

    const response = await getToday(TZ);
    expect(response.statusCode).toBe(200);
    const body = TodayResponseSchema.parse(response.json());

    expect(body.overdue.items).toEqual([]);
    expect(body.overdue.total).toBe(0);
    expect(body.due_today.items).toEqual([]);
    expect(body.due_today.total).toBe(0);

    expect(body.upcoming.days[0]!.date).toBe(tomorrow.localDate);
    expect(body.upcoming.days[0]!.tasks.map((item) => item.title)).toEqual(["Tomorrow task"]);
    expect(body.upcoming.days.slice(1).every((day) => day.tasks.length === 0)).toBe(true);
    expect(body.summary.overdue_total).toBe(0);
    expect(body.summary.due_today_total).toBe(0);
  });

  it("counts inbox attention honestly and lists only needs_confirm/failed items", async () => {
    const now = new Date();
    await app.db.insert(inboxItems).values([
      { rawText: "failed newest", source: "web", capturedAt: now, timezone: TZ, status: "failed" },
      {
        rawText: "failed older",
        source: "web",
        capturedAt: new Date(now.getTime() - 1000),
        timezone: TZ,
        status: "failed",
      },
      {
        rawText: "pending capture",
        source: "web",
        capturedAt: new Date(now.getTime() - 2000),
        timezone: TZ,
        status: "pending",
      },
      {
        rawText: "already confirmed",
        source: "web",
        capturedAt: new Date(now.getTime() - 3000),
        timezone: TZ,
        status: "confirmed",
      },
    ]);

    const response = await getToday(TZ);
    expect(response.statusCode).toBe(200);
    const body = TodayResponseSchema.parse(response.json());

    expect(body.inbox.pending_count).toBe(1);
    expect(body.inbox.needs_confirm_count).toBe(0);
    expect(body.inbox.failed_count).toBe(2);
    expect(body.summary.inbox_attention_total).toBe(3);

    expect(body.inbox.items).toHaveLength(2);
    expect(body.inbox.items.map((item) => item.raw_text)).toEqual([
      "failed newest",
      "failed older",
    ]);
    expect(body.inbox.items.every((item) => item.status === "failed")).toBe(true);
    expect(body.inbox.items.some((item) => item.raw_text === "already confirmed")).toBe(false);
  });

  it("computes project next_action and stall state, sorting stalled projects first", async () => {
    const window = localDayWindow(TZ);
    const tomorrowMid = midWindowInstant(
      localDayWindowForDate(TZ, addLocalDays(window.localDate, 1)),
    );

    const [activeProject] = await app.db
      .insert(projects)
      .values({ name: "Active project" })
      .returning();
    const [stalledProject] = await app.db
      .insert(projects)
      .values({ name: "Stalled project" })
      .returning();

    // Active project: one open task due tomorrow + one recently completed.
    const [openTask] = await app.db
      .insert(tasks)
      .values({
        title: "Open soon",
        timezone: TZ,
        status: "active",
        projectId: activeProject!.id,
        dueAt: tomorrowMid,
      })
      .returning();
    await app.db.insert(tasks).values({
      title: "Done thing",
      timezone: TZ,
      status: "done",
      projectId: activeProject!.id,
      completedAt: new Date(Date.now() - 24 * HOUR_MS),
    });

    // Stalled project: an open task whose every activity signal is long cold
    // (created AND last-written 20 days ago) and no linked event.
    await app.db.insert(tasks).values({
      title: "Lonely open task",
      timezone: TZ,
      status: "inbox",
      projectId: stalledProject!.id,
      createdAt: new Date(Date.now() - 20 * 24 * HOUR_MS),
      updatedAt: new Date(Date.now() - 20 * 24 * HOUR_MS),
    });

    const response = await getToday(TZ);
    expect(response.statusCode).toBe(200);
    const body = TodayResponseSchema.parse(response.json());

    expect(body.projects.active_count).toBe(2);
    expect(body.summary.active_project_count).toBe(2);
    expect(body.projects.items).toHaveLength(2);

    const [first, second] = body.projects.items;
    expect(first!.name).toBe("Stalled project");
    expect(first!.stalled).toBe(true);
    expect(first!.next_action?.title).toBe("Lonely open task");

    expect(second!.name).toBe("Active project");
    expect(second!.stalled).toBe(false);
    expect(second!.next_action).toMatchObject({
      task_id: openTask!.id,
      title: "Open soon",
      priority: null,
    });
    expect(second!.next_action!.due_at).toBe(tomorrowMid.toISOString());
    expect(second!.open_task_count).toBe(1);
    expect(second!.overdue_task_count).toBe(0);
    expect(second!.done_task_count).toBe(1);
    expect(second!.last_activity_at).not.toBeNull();
  });

  it("counts only non-archived status='active' projects, excluding paused and completed", async () => {
    const [active] = await app.db
      .insert(projects)
      .values({ name: "Active project", status: "active" })
      .returning();
    await app.db.insert(projects).values({ name: "Paused project", status: "paused" });
    await app.db
      .insert(projects)
      .values({ name: "Completed project", status: "completed", completedAt: new Date() });

    const response = await getToday(TZ);
    expect(response.statusCode).toBe(200);
    const body = TodayResponseSchema.parse(response.json());

    expect(body.summary.active_project_count).toBe(1);
    expect(body.projects.active_count).toBe(1);
    expect(body.projects.items.map((item) => item.id)).toEqual([active!.id]);
    expect(body.projects.items.map((item) => item.name)).toEqual(["Active project"]);
  });
});
