import { addCalendarDays, localDayWindow, localDayWindowForDate } from "@personal-os/core";
import { occurrences, projects, tasks } from "@personal-os/db";
import { AgendaResponseSchema, type AgendaResponse } from "@personal-os/schema";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";

const TZ = "America/Chicago";
const HOUR_MS = 60 * 60 * 1000;

// Bucketing/order/filter fixtures live on a FUTURE local day. Overdue is the
// frozen instant comparison `due_at < effectiveNow`, so a same-day fixture
// pinned at (start of day + N hours) silently migrates from days[] into
// overdue[] once real wall-clock time passes it -- which makes such a test
// pass in the morning and fail in the afternoon. A future day is
// unconditionally "upcoming" and keeps these assertions about ordering and
// filtering, not about what time the suite happened to run.
function futureDayWindow(offsetDays: number) {
  return localDayWindowForDate(TZ, addCalendarDays(localDayWindow(TZ).localDate, offsetDays));
}

// Same timezone-margin guard idiom as today.test.ts: several tests craft
// instants relative to real "now" (e.g. "2h ago") and only behave as named
// while those instants stay inside the intended local day. Within
// `hours` of a local-midnight boundary they'd be ambiguous -- skip
// gracefully instead of flaking.
function dayHasHourMargins(now: Date, hours: number): boolean {
  const w = localDayWindow(TZ, now);
  return (
    now.getTime() - w.startUtc.getTime() >= hours * HOUR_MS &&
    w.endUtcExclusive.getTime() - now.getTime() >= hours * HOUR_MS
  );
}

describe("GET /agenda", () => {
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

  async function getAgenda(params: {
    tz?: string;
    from?: string;
    to?: string;
    project_id?: string;
  }): Promise<ReturnType<FastifyInstance["inject"]>> {
    const query = new URLSearchParams();
    if (params.tz !== undefined) query.set("tz", params.tz);
    if (params.from !== undefined) query.set("from", params.from);
    if (params.to !== undefined) query.set("to", params.to);
    if (params.project_id !== undefined) query.set("project_id", params.project_id);
    return app.inject({ method: "GET", url: `/agenda?${query.toString()}` });
  }

  async function agenda(from: string, to: string, projectId?: string): Promise<AgendaResponse> {
    const response = await getAgenda({ tz: TZ, from, to, project_id: projectId });
    expect(response.statusCode).toBe(200);
    return AgendaResponseSchema.parse(response.json());
  }

  function allItems(body: AgendaResponse) {
    return [...body.overdue, ...body.days.flatMap((d) => d.items)];
  }

  // ---- validation --------------------------------------------------

  it("rejects an invalid tz with 400 validation_failed", async () => {
    const response = await getAgenda({ tz: "Not/ARealZone", from: "2026-09-01", to: "2026-09-01" });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string }>().error).toBe("validation_failed");
  });

  it("rejects a malformed project_id (not a uuid) with 400 validation_failed", async () => {
    const response = await getAgenda({
      tz: TZ,
      from: "2026-09-01",
      to: "2026-09-01",
      project_id: "not-a-uuid",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string }>().error).toBe("validation_failed");
  });

  it("accepts an exactly-90-day span and rejects a 91-day span", async () => {
    const okResponse = await getAgenda({ tz: TZ, from: "2026-01-01", to: "2026-04-01" });
    expect(okResponse.statusCode).toBe(200);

    const tooLong = await getAgenda({ tz: TZ, from: "2026-01-01", to: "2026-04-02" });
    expect(tooLong.statusCode).toBe(400);
    expect(tooLong.json<{ error: string }>().error).toBe("validation_failed");
  });

  it("returns an honest empty agenda for an empty database", async () => {
    const body = await agenda("2026-09-01", "2026-09-03");
    expect(body.tz).toBe(TZ);
    expect(body.from).toBe("2026-09-01");
    expect(body.to).toBe("2026-09-03");
    expect(body.generated_at).toBe(body.effective_now);
    expect(body.overdue).toEqual([]);
    expect(body.days).toHaveLength(3);
    for (const day of body.days) expect(day.items).toEqual([]);
  });

  // ---- tasks ---------------------------------------------------------

  it("buckets an overdue task into overdue[] only, never into days[]", async () => {
    const now = new Date();
    if (!dayHasHourMargins(now, 2)) return;
    const window = localDayWindow(TZ, now);

    await app.db.insert(tasks).values({
      title: "Overdue task",
      timezone: TZ,
      status: "active",
      dueAt: new Date(now.getTime() - 2 * HOUR_MS),
    });

    const body = await agenda(window.localDate, window.localDate);
    expect(body.overdue).toHaveLength(1);
    expect(body.overdue[0]!.kind).toBe("task");
    expect(body.overdue[0]!.title).toBe("Overdue task");
    expect(body.days[0]!.items).toEqual([]);
  });

  it("buckets a due-today task into today's day bucket, not overdue", async () => {
    const now = new Date();
    if (!dayHasHourMargins(now, 2)) return;
    const window = localDayWindow(TZ, now);

    await app.db.insert(tasks).values({
      title: "Due later today",
      timezone: TZ,
      status: "active",
      dueAt: new Date(now.getTime() + 1 * HOUR_MS),
    });

    const body = await agenda(window.localDate, window.localDate);
    expect(body.overdue).toEqual([]);
    expect(body.days[0]!.items).toHaveLength(1);
    expect(body.days[0]!.items[0]!.title).toBe("Due later today");
    expect(body.days[0]!.items[0]!.kind).toBe("task");
  });

  it("buckets a future task into the correct future day", async () => {
    const window = localDayWindow(TZ);
    const tomorrow = addCalendarDays(window.localDate, 1);
    const tomorrowWindow = localDayWindowForDate(TZ, tomorrow);

    await app.db.insert(tasks).values({
      title: "Future task",
      timezone: TZ,
      status: "active",
      dueAt: new Date(tomorrowWindow.startUtc.getTime() + 3 * HOUR_MS),
    });

    const body = await agenda(window.localDate, addCalendarDays(window.localDate, 2));
    expect(body.overdue).toEqual([]);
    expect(body.days[0]!.items).toEqual([]);
    expect(body.days[1]!.date).toBe(tomorrow);
    expect(body.days[1]!.items.map((i) => i.title)).toEqual(["Future task"]);
    expect(body.days[2]!.items).toEqual([]);
  });

  it("excludes undated tasks entirely", async () => {
    const window = localDayWindow(TZ);
    await app.db.insert(tasks).values({
      title: "No due date",
      timezone: TZ,
      status: "active",
      dueAt: null,
    });

    const body = await agenda(window.localDate, addCalendarDays(window.localDate, 3));
    expect(allItems(body)).toEqual([]);
  });

  it("excludes done, dropped, and archived tasks even with a due_at inside the range", async () => {
    const window = localDayWindow(TZ);
    const dueAt = new Date(window.startUtc.getTime() + 2 * HOUR_MS);

    await app.db.insert(tasks).values([
      { title: "Done", timezone: TZ, status: "done", dueAt, completedAt: new Date() },
      { title: "Dropped", timezone: TZ, status: "dropped", dueAt },
      { title: "Archived", timezone: TZ, status: "active", dueAt, archivedAt: new Date() },
    ]);

    const body = await agenda(window.localDate, window.localDate);
    expect(allItems(body)).toEqual([]);
  });

  // ---- recurring tasks / occurrences ---------------------------------

  it("suppresses the bare recurring parent and shows its scheduled occurrence exactly once; excludes done/skipped occurrences", async () => {
    const now = new Date();
    if (!dayHasHourMargins(now, 2)) return;
    const window = localDayWindow(TZ, now);

    const [parent] = await app.db
      .insert(tasks)
      .values({
        title: "Daily chore",
        timezone: TZ,
        status: "active",
        rrule: "FREQ=DAILY;INTERVAL=1",
        recurrenceAnchor: "due_date",
        recurrenceTimezone: TZ,
        dueAt: new Date(now.getTime() - 5 * HOUR_MS),
      })
      .returning();

    const scheduledAt = new Date(now.getTime() + 1 * HOUR_MS);
    const doneAt = new Date(now.getTime() - 1 * HOUR_MS);
    const skippedAt = new Date(now.getTime() - 2 * HOUR_MS);
    await app.db.insert(occurrences).values([
      {
        parentType: "task",
        parentId: parent!.id,
        occursAt: scheduledAt,
        occursLocal: scheduledAt,
        status: "scheduled",
      },
      {
        parentType: "task",
        parentId: parent!.id,
        occursAt: doneAt,
        occursLocal: doneAt,
        status: "done",
      },
      {
        parentType: "task",
        parentId: parent!.id,
        occursAt: skippedAt,
        occursLocal: skippedAt,
        status: "skipped",
      },
    ]);

    const body = await agenda(window.localDate, window.localDate);
    const rendered = allItems(body);
    expect(rendered).toHaveLength(1);
    expect(rendered[0]!.kind).toBe("occurrence");
    expect(rendered[0]!.id).toBe(parent!.id);
    if (rendered[0]!.kind === "occurrence") {
      expect(rendered[0]!.occurs_at).toBe(scheduledAt.toISOString());
    }
    // Bare parent row (no scheduled occurrence rendered by due_at) never
    // leaks, and no task-kind row for this parent exists at all.
    expect(rendered.some((i) => i.kind === "task" && i.id === parent!.id)).toBe(false);
  });

  it("does not leak a recurring parent as a bare task row when all its occurrences fall outside the requested range", async () => {
    const window = localDayWindow(TZ);
    const inRangeDate = window.localDate;
    const farFutureDate = addCalendarDays(window.localDate, 200);
    const farFutureWindow = localDayWindowForDate(TZ, farFutureDate);

    const [parent] = await app.db
      .insert(tasks)
      .values({
        title: "Far-future recurring chore",
        timezone: TZ,
        status: "active",
        rrule: "FREQ=WEEKLY;INTERVAL=1",
        recurrenceAnchor: "due_date",
        recurrenceTimezone: TZ,
        // Parent's own template due_at deliberately falls INSIDE the
        // requested range -- it must still not leak as a bare row, since
        // eligibility for recurring tasks flows only through occurrences.
        dueAt: new Date(localDayWindowForDate(TZ, inRangeDate).startUtc.getTime() + 3 * HOUR_MS),
      })
      .returning();

    await app.db.insert(occurrences).values({
      parentType: "task",
      parentId: parent!.id,
      occursAt: new Date(farFutureWindow.startUtc.getTime() + 1 * HOUR_MS),
      occursLocal: farFutureWindow.startUtc,
      status: "scheduled",
    });

    const body = await agenda(inRangeDate, addCalendarDays(inRangeDate, 2));
    expect(allItems(body)).toEqual([]);
  });

  it("buckets an overdue occurrence into overdue[] with kind occurrence", async () => {
    const now = new Date();
    if (!dayHasHourMargins(now, 2)) return;
    const window = localDayWindow(TZ, now);

    const [parent] = await app.db
      .insert(tasks)
      .values({
        title: "Overdue recurring chore",
        timezone: TZ,
        status: "active",
        rrule: "FREQ=DAILY;INTERVAL=1",
        recurrenceAnchor: "due_date",
        recurrenceTimezone: TZ,
        dueAt: new Date(now.getTime() - 10 * HOUR_MS),
      })
      .returning();

    const occursAt = new Date(now.getTime() - 2 * HOUR_MS);
    await app.db.insert(occurrences).values({
      parentType: "task",
      parentId: parent!.id,
      occursAt,
      occursLocal: occursAt,
      status: "scheduled",
    });

    const body = await agenda(window.localDate, window.localDate);
    expect(body.overdue).toHaveLength(1);
    expect(body.overdue[0]!.kind).toBe("occurrence");
    expect(body.days[0]!.items).toEqual([]);
  });

  // ---- events ----------------------------------------------------------

  async function createEvent(payload: Record<string, unknown>): Promise<string> {
    const response = await app.inject({ method: "POST", url: "/events", payload });
    expect(response.statusCode).toBe(201);
    return response.json<{ id: string }>().id;
  }

  it("buckets a one-off timed event into its local day", async () => {
    const window = localDayWindow(TZ);
    const startsAt = new Date(window.startUtc.getTime() + 3 * HOUR_MS);
    const endsAt = new Date(window.startUtc.getTime() + 4 * HOUR_MS);
    await createEvent({
      title: "One-off event",
      timezone: TZ,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
    });

    const body = await agenda(window.localDate, window.localDate);
    expect(body.days[0]!.items).toHaveLength(1);
    expect(body.days[0]!.items[0]!.kind).toBe("event");
    expect(body.days[0]!.items[0]!.title).toBe("One-off event");
    expect(body.overdue).toEqual([]);
  });

  it("never places an event in overdue[], even when its start instant is in the past", async () => {
    const now = new Date();
    if (!dayHasHourMargins(now, 2)) return;
    const window = localDayWindow(TZ, now);

    await createEvent({
      title: "Past-but-today event",
      timezone: TZ,
      starts_at: new Date(now.getTime() - 1 * HOUR_MS).toISOString(),
      ends_at: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
    });

    const body = await agenda(window.localDate, window.localDate);
    expect(body.overdue).toEqual([]);
    expect(body.days[0]!.items.map((i) => i.title)).toEqual(["Past-but-today event"]);
  });

  it("buckets a recurring event's instance into the correct local day", async () => {
    const window = localDayWindow(TZ);
    const tomorrow = addCalendarDays(window.localDate, 1);
    const tomorrowWindow = localDayWindowForDate(TZ, tomorrow);

    await createEvent({
      title: "Weekly standup",
      timezone: TZ,
      starts_at: new Date(tomorrowWindow.startUtc.getTime() + 9 * HOUR_MS).toISOString(),
      ends_at: new Date(tomorrowWindow.startUtc.getTime() + 9.5 * HOUR_MS).toISOString(),
      rrule: "FREQ=WEEKLY;INTERVAL=1",
    });

    const body = await agenda(window.localDate, addCalendarDays(window.localDate, 2));
    expect(body.days[0]!.items).toEqual([]);
    expect(body.days[1]!.items.map((i) => i.title)).toEqual(["Weekly standup"]);
    expect(body.days[1]!.items[0]!.kind).toBe("event");
  });

  it("places a midnight-crossing event in BOTH overlapping local days", async () => {
    const window = localDayWindow(TZ);
    const tomorrow = addCalendarDays(window.localDate, 1);
    const tomorrowWindow = localDayWindowForDate(TZ, tomorrow);

    // 23:00 today -> 01:00 tomorrow, straddling local midnight.
    await createEvent({
      title: "Overnight event",
      timezone: TZ,
      starts_at: new Date(tomorrowWindow.startUtc.getTime() - 1 * HOUR_MS).toISOString(),
      ends_at: new Date(tomorrowWindow.startUtc.getTime() + 1 * HOUR_MS).toISOString(),
    });

    const body = await agenda(window.localDate, tomorrow);
    expect(body.days[0]!.items.map((i) => i.title)).toEqual(["Overnight event"]);
    expect(body.days[1]!.items.map((i) => i.title)).toEqual(["Overnight event"]);
  });

  it("places a multi-day all-day event in every overlapping local day", async () => {
    const window = localDayWindow(TZ);
    const day0 = window.localDate;
    const day1 = addCalendarDays(day0, 1);
    const day2 = addCalendarDays(day0, 2);

    await createEvent({
      title: "Conference",
      timezone: TZ,
      all_day: true,
      start_date: day0,
      end_date: day2,
    });

    const body = await agenda(day0, addCalendarDays(day0, 3));
    expect(body.days[0]!.items.map((i) => i.title)).toEqual(["Conference"]);
    expect(body.days[1]!.items.map((i) => i.title)).toEqual(["Conference"]);
    expect(body.days[2]!.items.map((i) => i.title)).toEqual(["Conference"]);
    expect(body.days[3]!.items).toEqual([]);
    void day1;
  });

  // ---- disjointness & sort order ---------------------------------------

  it("keeps overdue[] and days[] strictly disjoint across a mix of tasks/occurrences/events", async () => {
    const now = new Date();
    if (!dayHasHourMargins(now, 3)) return;
    const window = localDayWindow(TZ, now);

    await app.db.insert(tasks).values([
      {
        title: "Overdue A",
        timezone: TZ,
        status: "active",
        dueAt: new Date(now.getTime() - 3 * HOUR_MS),
      },
      {
        title: "Due-today B",
        timezone: TZ,
        status: "active",
        dueAt: new Date(now.getTime() + 2 * HOUR_MS),
      },
    ]);
    await createEvent({
      title: "Today event",
      timezone: TZ,
      starts_at: new Date(now.getTime() + 1 * HOUR_MS).toISOString(),
      ends_at: new Date(now.getTime() + 1.5 * HOUR_MS).toISOString(),
    });

    const body = await agenda(window.localDate, window.localDate);
    const overdueIds = new Set(body.overdue.map((i) => `${i.kind}:${i.id}`));
    const dayIds = new Set(body.days[0]!.items.map((i) => `${i.kind}:${i.id}`));
    for (const id of overdueIds) expect(dayIds.has(id)).toBe(false);
    expect(body.overdue.map((i) => i.title)).toEqual(["Overdue A"]);
    expect(body.days[0]!.items.map((i) => i.title).sort()).toEqual(
      ["Due-today B", "Today event"].sort(),
    );
  });

  it("sorts a day's items with all-day events first, then everyone else interleaved strictly by instant", async () => {
    const window = localDayWindow(TZ);
    const dayStart = window.startUtc;

    await createEvent({
      title: "All-day banner",
      timezone: TZ,
      all_day: true,
      start_date: window.localDate,
      end_date: window.localDate,
    });
    await createEvent({
      title: "Morning meeting",
      timezone: TZ,
      starts_at: new Date(dayStart.getTime() + 9 * HOUR_MS).toISOString(),
      ends_at: new Date(dayStart.getTime() + 9.5 * HOUR_MS).toISOString(),
    });
    await app.db.insert(tasks).values({
      title: "Afternoon task",
      timezone: TZ,
      status: "active",
      dueAt: new Date(dayStart.getTime() + 15 * HOUR_MS),
    });
    await createEvent({
      title: "Evening dinner",
      timezone: TZ,
      starts_at: new Date(dayStart.getTime() + 18 * HOUR_MS).toISOString(),
      ends_at: new Date(dayStart.getTime() + 19 * HOUR_MS).toISOString(),
    });

    const body = await agenda(window.localDate, window.localDate);
    expect(body.days[0]!.items.map((i) => i.title)).toEqual([
      "All-day banner",
      "Morning meeting",
      "Afternoon task",
      "Evening dinner",
    ]);
  });

  // Regression (Checkpoint 5.4 audit finding D3-8): a timed event with no
  // end is a zero-duration instant. The half-open overlap test degenerates
  // to the EMPTY interval [start, start), so such an event starting exactly
  // at local midnight previously matched NO day window and vanished from
  // the agenda entirely -- not misplaced, absent.
  it("places a zero-duration timed event starting exactly at local midnight on that day", async () => {
    const window = futureDayWindow(4);
    await createEvent({
      title: "Midnight zero-duration",
      timezone: TZ,
      starts_at: window.startUtc.toISOString(),
    });

    const body = await agenda(window.localDate, window.localDate);
    const day = body.days.find((d) => d.date === window.localDate);
    expect(day?.items.map((i) => i.title)).toContain("Midnight zero-duration");
    // Exactly one day, never duplicated into the neighbour.
    const appearances = body.days.filter((d) =>
      d.items.some((i) => i.title === "Midnight zero-duration"),
    );
    expect(appearances).toHaveLength(1);
  });

  it("does not duplicate a real-duration event whose end lands exactly on a day boundary", async () => {
    const window = futureDayWindow(5);
    const nextDay = localDayWindowForDate(TZ, addCalendarDays(window.localDate, 1));
    await createEvent({
      title: "Ends exactly at midnight",
      timezone: TZ,
      starts_at: new Date(window.endUtcExclusive.getTime() - 2 * HOUR_MS).toISOString(),
      ends_at: window.endUtcExclusive.toISOString(),
    });

    const body = await agenda(window.localDate, nextDay.localDate);
    const appearances = body.days.filter((d) =>
      d.items.some((i) => i.title === "Ends exactly at midnight"),
    );
    expect(appearances.map((d) => d.date)).toEqual([window.localDate]);
  });

  it("breaks a same-instant tie by kind order (event < occurrence < task), then priority, then id", async () => {
    const window = futureDayWindow(3);
    const at = new Date(window.startUtc.getTime() + 10 * HOUR_MS);

    await app.db.insert(tasks).values([
      {
        title: "Task same instant, low priority",
        timezone: TZ,
        status: "active",
        dueAt: at,
        priority: 5,
      },
      {
        title: "Task same instant, high priority",
        timezone: TZ,
        status: "active",
        dueAt: at,
        priority: 1,
      },
    ]);
    await createEvent({
      title: "Event same instant",
      timezone: TZ,
      starts_at: at.toISOString(),
      ends_at: new Date(at.getTime() + 30 * 60 * 1000).toISOString(),
    });

    const body = await agenda(window.localDate, window.localDate);
    expect(body.days[0]!.items.map((i) => i.title)).toEqual([
      "Event same instant",
      "Task same instant, high priority",
      "Task same instant, low priority",
    ]);
  });

  // ---- project_id filtering ----------------------------------------------

  it("filters tasks, occurrences, and events by project_id, excluding an unrelated item", async () => {
    const window = futureDayWindow(3);
    const dueAt = new Date(window.startUtc.getTime() + 2 * HOUR_MS);

    const [targetProject] = await app.db
      .insert(projects)
      .values({ name: "Target project" })
      .returning();
    const [otherProject] = await app.db
      .insert(projects)
      .values({ name: "Other project" })
      .returning();

    await app.db.insert(tasks).values([
      {
        title: "In target project",
        timezone: TZ,
        status: "active",
        dueAt,
        projectId: targetProject!.id,
      },
      {
        title: "In other project",
        timezone: TZ,
        status: "active",
        dueAt,
        projectId: otherProject!.id,
      },
      { title: "No project", timezone: TZ, status: "active", dueAt },
    ]);

    const [recurringParent] = await app.db
      .insert(tasks)
      .values({
        title: "Recurring in target project",
        timezone: TZ,
        status: "active",
        rrule: "FREQ=DAILY;INTERVAL=1",
        recurrenceAnchor: "due_date",
        recurrenceTimezone: TZ,
        dueAt,
        projectId: targetProject!.id,
      })
      .returning();
    await app.db.insert(occurrences).values({
      parentType: "task",
      parentId: recurringParent!.id,
      occursAt: dueAt,
      occursLocal: dueAt,
      status: "scheduled",
    });

    await createEvent({
      title: "Event in target project",
      timezone: TZ,
      starts_at: dueAt.toISOString(),
      ends_at: new Date(dueAt.getTime() + 30 * 60 * 1000).toISOString(),
      project_id: targetProject!.id,
    });
    await createEvent({
      title: "Event in other project",
      timezone: TZ,
      starts_at: dueAt.toISOString(),
      ends_at: new Date(dueAt.getTime() + 30 * 60 * 1000).toISOString(),
      project_id: otherProject!.id,
    });

    const body = await agenda(window.localDate, window.localDate, targetProject!.id);
    const titles = body.days[0]!.items.map((i) => i.title).sort();
    expect(titles).toEqual(
      ["Event in target project", "In target project", "Recurring in target project"].sort(),
    );
    expect(titles).not.toContain("In other project");
    expect(titles).not.toContain("No project");
    expect(titles).not.toContain("Event in other project");
  });

  it("still shows an item under its project_id filter when that project is paused or archived", async () => {
    const window = futureDayWindow(3);
    const dueAt = new Date(window.startUtc.getTime() + 2 * HOUR_MS);

    const [pausedProject] = await app.db
      .insert(projects)
      .values({ name: "Paused project" })
      .returning();
    const pauseResponse = await app.inject({
      method: "POST",
      url: `/projects/${pausedProject!.id}/pause`,
    });
    expect(pauseResponse.statusCode).toBe(200);

    await app.db.insert(tasks).values({
      title: "Task in paused project",
      timezone: TZ,
      status: "active",
      dueAt,
      projectId: pausedProject!.id,
    });

    const body = await agenda(window.localDate, window.localDate, pausedProject!.id);
    expect(body.days[0]!.items.map((i) => i.title)).toEqual(["Task in paused project"]);
  });
});
