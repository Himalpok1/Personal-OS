import {
  dailyPeriodStart,
  localDayWindow,
  localDayWindowForDate,
  resolveWallClockToInstant,
  wallClockToNaiveDate,
  weeklyPeriodStart,
  type LocalDayWindow,
} from "@personal-os/core";
import { inboxItems, occurrences, projects, reviews, tasks } from "@personal-os/db";
import { eq } from "drizzle-orm";
import {
  DailyReviewContextSchema,
  WeeklyReviewContextSchema,
  type Review,
} from "@personal-os/schema";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import type { ErrorBody, Paginated } from "../test/types.js";

const TZ = "America/Chicago";
const HOUR_MS = 60 * 60 * 1000;

const DAILY_CREATE = { kind: "daily" as const, period_start: "2026-08-20", tz: TZ };
const WEEKLY_CREATE = { kind: "weekly" as const, period_start: "2026-08-17", tz: TZ };

const dailyContent = {
  version: 1 as const,
  kind: "daily" as const,
  checklist: { inbox: true, overdue: true },
  selected_priorities: [],
};
const weeklyContent = {
  version: 1 as const,
  kind: "weekly" as const,
  checklist: { active_projects: false, paused_projects: true },
  selected_priorities: [],
};

// Same date arithmetic taste as the collectors: anchor at noon UTC so adding
// whole days can never straddle a month boundary unexpectedly.
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

// Pretest guard: buckets crafted relative to real now ("2h ago") are only
// unambiguous with hours of margin against the local midnight boundaries.
function dayHasHourMargins(now: Date, w: LocalDayWindow, hours: number): boolean {
  return (
    now.getTime() - w.startUtc.getTime() >= hours * HOUR_MS &&
    w.endUtcExclusive.getTime() - now.getTime() >= hours * HOUR_MS
  );
}

function atLocal(tz: string, localDate: string, hour: number, minute = 0): Date {
  const [year, month, day] = localDate.split("-").map(Number);
  return resolveWallClockToInstant(
    { year: year!, month: month!, day: day!, hour, minute, second: 0 },
    tz,
  );
}

function naiveAt(localDate: string, hour: number, minute = 0): Date {
  const [year, month, day] = localDate.split("-").map(Number);
  return wallClockToNaiveDate({
    year: year!,
    month: month!,
    day: day!,
    hour,
    minute,
    second: 0,
  });
}

describe("reviews routes", () => {
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

  async function insertReview(
    values: Partial<typeof reviews.$inferInsert> & {
      kind: "daily" | "weekly";
      periodStart: string;
    },
  ) {
    const [row] = await app.db
      .insert(reviews)
      .values({ timezone: TZ, ...values })
      .returning();
    return row!;
  }

  async function createReview(payload: object) {
    return app.inject({ method: "POST", url: "/reviews", payload });
  }

  async function getReview(id: string) {
    return app.inject({ method: "GET", url: `/reviews/${id}` });
  }

  describe("POST /reviews (upsert by kind+period_start)", () => {
    it("creates an absent review with 201 and in_progress defaults", async () => {
      const response = await createReview(DAILY_CREATE);
      expect(response.statusCode).toBe(201);

      const body = response.json<Review>();
      expect(body.kind).toBe("daily");
      expect(body.period_start).toBe("2026-08-20");
      expect(body.timezone).toBe(TZ);
      expect(body.status).toBe("in_progress");
      expect(body.content).toBeNull();
      expect(body.summary).toBeNull();
      expect(body.completed_at).toBeNull();
    });

    it("returns the existing row unchanged for a duplicate create (same id, byte-equal body)", async () => {
      const first = await createReview(DAILY_CREATE);
      expect(first.statusCode).toBe(201);
      const second = await createReview(DAILY_CREATE);
      expect(second.statusCode).toBe(200);
      // Same identity and byte-stable payload: no reopen, no reset, no bump.
      expect(second.body).toBe(first.body);
    });

    it("creates weekly independently of daily", async () => {
      const daily = await createReview(DAILY_CREATE);
      const weekly = await createReview(WEEKLY_CREATE);
      expect(daily.statusCode).toBe(201);
      expect(weekly.statusCode).toBe(201);
      expect(daily.json<Review>().id).not.toBe(weekly.json<Review>().id);

      const duplicateWeekly = await createReview(WEEKLY_CREATE);
      expect(duplicateWeekly.statusCode).toBe(200);
      expect(duplicateWeekly.body).toBe(weekly.body);
    });

    it("returns a COMPLETED row unchanged by POST (no reopen/reset/updated_at bump)", async () => {
      const created = await createReview(DAILY_CREATE);
      const completed = await app.inject({
        method: "POST",
        url: `/reviews/${created.json<Review>().id}/complete`,
      });
      expect(completed.statusCode).toBe(200);

      const recreated = await createReview(DAILY_CREATE);
      expect(recreated.statusCode).toBe(200);
      expect(recreated.body).toBe(completed.body);
    });

    it("returns a SKIPPED row unchanged by POST", async () => {
      const created = await createReview(DAILY_CREATE);
      const skipped = await app.inject({
        method: "POST",
        url: `/reviews/${created.json<Review>().id}/skip`,
      });
      expect(skipped.statusCode).toBe(200);

      const recreated = await createReview(DAILY_CREATE);
      expect(recreated.statusCode).toBe(200);
      expect(recreated.body).toBe(skipped.body);
    });

    it("rejects a bad tz, bad period_start, and unknown kind with 400 validation_failed", async () => {
      const badTz = await createReview({ ...DAILY_CREATE, tz: "Mars/Olympus" });
      expect(badTz.statusCode).toBe(400);
      expect(badTz.json<ErrorBody>().error).toBe("validation_failed");

      const badPeriod = await createReview({ ...DAILY_CREATE, period_start: "08/20/2026" });
      expect(badPeriod.statusCode).toBe(400);

      const badKind = await createReview({ ...DAILY_CREATE, kind: "monthly" });
      expect(badKind.statusCode).toBe(400);
    });
  });

  describe("POST /reviews/:id/complete", () => {
    it("completes once: status flips, completed_at set, updated_at bumps", async () => {
      const created = (await createReview(DAILY_CREATE)).json<Review>();

      const completed = await app.inject({
        method: "POST",
        url: `/reviews/${created.id}/complete`,
      });
      expect(completed.statusCode).toBe(200);
      const body = completed.json<Review>();
      expect(body.status).toBe("completed");
      expect(body.completed_at).not.toBeNull();
      expect(Date.parse(body.updated_at)).toBeGreaterThan(Date.parse(created.updated_at));
    });

    it("repeat complete is idempotent and byte-stable, preserving the ORIGINAL completed_at", async () => {
      const created = (await createReview(DAILY_CREATE)).json<Review>();
      const first = await app.inject({
        method: "POST",
        url: `/reviews/${created.id}/complete`,
      });
      expect(first.statusCode).toBe(200);

      const second = await app.inject({
        method: "POST",
        url: `/reviews/${created.id}/complete`,
      });
      expect(second.statusCode).toBe(200);
      expect(second.body).toBe(first.body);

      const [row] = await app.db.select().from(reviews).where(eqId(created.id));
      expect(row!.completedAt!.toISOString()).toBe(first.json<Review>().completed_at);
      expect(row!.updatedAt.toISOString()).toBe(first.json<Review>().updated_at);
    });

    it("409s completing a skipped review", async () => {
      const created = (await createReview(DAILY_CREATE)).json<Review>();
      await app.inject({ method: "POST", url: `/reviews/${created.id}/skip` });

      const response = await app.inject({
        method: "POST",
        url: `/reviews/${created.id}/complete`,
      });
      expect(response.statusCode).toBe(409);
      expect(response.json<ErrorBody>()).toMatchObject({
        error: "invalid_status_transition",
        status: "skipped",
      });
    });
  });

  describe("POST /reviews/:id/skip", () => {
    it("skips symmetrically; repeat skip is idempotent and byte-stable", async () => {
      const created = (await createReview(DAILY_CREATE)).json<Review>();

      const first = await app.inject({
        method: "POST",
        url: `/reviews/${created.id}/skip`,
      });
      expect(first.statusCode).toBe(200);
      const body = first.json<Review>();
      expect(body.status).toBe("skipped");
      expect(body.completed_at).toBeNull();

      const second = await app.inject({
        method: "POST",
        url: `/reviews/${created.id}/skip`,
      });
      expect(second.statusCode).toBe(200);
      expect(second.body).toBe(first.body);
    });

    it("409s skipping a completed review", async () => {
      const created = (await createReview(DAILY_CREATE)).json<Review>();
      await app.inject({ method: "POST", url: `/reviews/${created.id}/complete` });

      const response = await app.inject({
        method: "POST",
        url: `/reviews/${created.id}/skip`,
      });
      expect(response.statusCode).toBe(409);
      expect(response.json<ErrorBody>()).toMatchObject({
        error: "invalid_status_transition",
        status: "completed",
      });
    });
  });

  describe("PATCH /reviews/:id", () => {
    it("persists valid content for the row's kind plus a summary", async () => {
      const created = (await createReview(DAILY_CREATE)).json<Review>();

      const patched = await app.inject({
        method: "PATCH",
        url: `/reviews/${created.id}`,
        payload: { content: dailyContent, summary: "Good day" },
      });
      expect(patched.statusCode).toBe(200);
      const body = patched.json<Review>();
      expect(body.content).toEqual(dailyContent);
      expect(body.summary).toBe("Good day");
      expect(body.status).toBe("in_progress");

      const refetched = await getReview(created.id);
      expect(refetched.json<Review>().content).toEqual(dailyContent);
    });

    it("accepts weekly checklist keys on a weekly row", async () => {
      const created = (await createReview(WEEKLY_CREATE)).json<Review>();

      const patched = await app.inject({
        method: "PATCH",
        url: `/reviews/${created.id}`,
        payload: { content: weeklyContent },
      });
      expect(patched.statusCode).toBe(200);
      expect(patched.json<Review>().content).toEqual(weeklyContent);
    });

    it("rejects MISMATCHED-KIND content with 400 validation_failed and stores nothing", async () => {
      const created = (await createReview(DAILY_CREATE)).json<Review>();

      const patched = await app.inject({
        method: "PATCH",
        url: `/reviews/${created.id}`,
        payload: { content: weeklyContent }, // weekly checklist keys on a daily row
      });
      expect(patched.statusCode).toBe(400);
      expect(patched.json<ErrorBody>().error).toBe("validation_failed");

      const refetched = await getReview(created.id);
      expect(refetched.json<Review>().content).toBeNull();
    });

    it("summary-only updates leave prior content untouched (content written whole)", async () => {
      const created = (await createReview(DAILY_CREATE)).json<Review>();
      await app.inject({
        method: "PATCH",
        url: `/reviews/${created.id}`,
        payload: { content: dailyContent },
      });

      const patched = await app.inject({
        method: "PATCH",
        url: `/reviews/${created.id}`,
        payload: { summary: null },
      });
      expect(patched.statusCode).toBe(200);
      const body = patched.json<Review>();
      expect(body.content).toEqual(dailyContent);
      expect(body.summary).toBeNull();
    });

    it("strictly advances updated_at even across two rapid PATCHes", async () => {
      const created = (await createReview(DAILY_CREATE)).json<Review>();
      const first = (
        await app.inject({
          method: "PATCH",
          url: `/reviews/${created.id}`,
          payload: { summary: "one" },
        })
      ).json<Review>();
      const second = (
        await app.inject({
          method: "PATCH",
          url: `/reviews/${created.id}`,
          payload: { summary: "two" },
        })
      ).json<Review>();
      expect(Date.parse(second.updated_at)).toBeGreaterThan(Date.parse(first.updated_at));
    });

    it("rejects lifecycle fields via the strict schema with 400", async () => {
      const created = (await createReview(DAILY_CREATE)).json<Review>();

      const response = await app.inject({
        method: "PATCH",
        url: `/reviews/${created.id}`,
        payload: { status: "completed" },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json<ErrorBody>().error).toBe("validation_failed");
    });

    it("rejects an empty body with 400", async () => {
      const created = (await createReview(DAILY_CREATE)).json<Review>();

      const response = await app.inject({
        method: "PATCH",
        url: `/reviews/${created.id}`,
        payload: {},
      });
      expect(response.statusCode).toBe(400);
      expect(response.json<ErrorBody>().error).toBe("validation_failed");
    });

    it("409s patching a completed or skipped review", async () => {
      const toComplete = (await createReview(DAILY_CREATE)).json<Review>();
      await app.inject({ method: "POST", url: `/reviews/${toComplete.id}/complete` });
      const onCompleted = await app.inject({
        method: "PATCH",
        url: `/reviews/${toComplete.id}`,
        payload: { summary: "late edit" },
      });
      expect(onCompleted.statusCode).toBe(409);
      expect(onCompleted.json<ErrorBody>()).toMatchObject({
        error: "invalid_status_transition",
        status: "completed",
      });

      const toSkip = (await createReview(WEEKLY_CREATE)).json<Review>();
      await app.inject({ method: "POST", url: `/reviews/${toSkip.id}/skip` });
      const onSkipped = await app.inject({
        method: "PATCH",
        url: `/reviews/${toSkip.id}`,
        payload: { summary: "late edit" },
      });
      expect(onSkipped.statusCode).toBe(409);
      expect(onSkipped.json<ErrorBody>()).toMatchObject({
        error: "invalid_status_transition",
        status: "skipped",
      });
    });
  });

  describe("GET /reviews list", () => {
    interface SeedRow {
      id: string;
    }
    let seeded: Record<string, SeedRow>;

    beforeEach(async () => {
      const t0 = new Date(Date.now() - 4_000);
      const t1 = new Date(Date.now() - 3_000);
      const t2 = new Date(Date.now() - 2_000);
      const t3 = new Date(Date.now() - 1_000);
      const dEarly = await insertReview({
        kind: "daily",
        periodStart: "2026-07-01",
        createdAt: t0,
        updatedAt: t0,
      });
      const dMid = await insertReview({
        kind: "daily",
        periodStart: "2026-08-01",
        createdAt: t1,
        updatedAt: t1,
      });
      const wSame = await insertReview({
        kind: "weekly",
        periodStart: "2026-08-05",
        createdAt: t2,
        updatedAt: t2,
      });
      const dNew = await insertReview({
        kind: "daily",
        periodStart: "2026-08-05",
        createdAt: t3,
        updatedAt: t3,
      });
      seeded = {
        dEarly: { id: dEarly.id },
        dMid: { id: dMid.id },
        wSame: { id: wSame.id },
        dNew: { id: dNew.id },
      };
    });

    it("orders by period_start DESC then created_at DESC and reports an honest total", async () => {
      const response = await app.inject({ method: "GET", url: "/reviews" });
      expect(response.statusCode).toBe(200);
      const body = response.json<Paginated<Review>>();
      expect(body.total).toBe(4);
      expect(body.limit).toBe(50);
      expect(body.offset).toBe(0);
      expect(body.items.map((item) => item.id)).toEqual([
        seeded["dNew"]!.id,
        seeded["wSame"]!.id,
        seeded["dMid"]!.id,
        seeded["dEarly"]!.id,
      ]);
    });

    it("filters by kind", async () => {
      const response = await app.inject({ method: "GET", url: "/reviews?kind=daily" });
      const body = response.json<Paginated<Review>>();
      expect(body.total).toBe(3);
      expect(body.items.map((item) => item.id)).toEqual([
        seeded["dNew"]!.id,
        seeded["dMid"]!.id,
        seeded["dEarly"]!.id,
      ]);
    });

    it("paginates with limit/offset against the filtered total", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/reviews?kind=daily&limit=2&offset=1",
      });
      const body = response.json<Paginated<Review>>();
      expect(body.total).toBe(3);
      expect(body.limit).toBe(2);
      expect(body.offset).toBe(1);
      expect(body.items.map((item) => item.id)).toEqual([seeded["dMid"]!.id, seeded["dEarly"]!.id]);
    });
  });

  describe("GET /reviews/latest", () => {
    it("404s when no rows exist (unfiltered and filtered)", async () => {
      const none = await app.inject({ method: "GET", url: "/reviews/latest" });
      expect(none.statusCode).toBe(404);
      expect(none.json<ErrorBody>()).toEqual({ error: "not_found" });

      const noneForKind = await app.inject({ method: "GET", url: "/reviews/latest?kind=daily" });
      expect(noneForKind.statusCode).toBe(404);
    });

    it("returns the most recent row by the list ordering, honoring the kind filter", async () => {
      const t0 = new Date(Date.now() - 2_000);
      const t1 = new Date(Date.now() - 1_000);
      const dailyOlder = await insertReview({
        kind: "daily",
        periodStart: "2026-08-10",
        createdAt: t1,
        updatedAt: t1,
      });
      const dailyLatest = await insertReview({
        kind: "daily",
        periodStart: "2026-08-19",
        createdAt: t0,
        updatedAt: t0,
      });
      await insertReview({
        kind: "weekly",
        periodStart: "2026-08-17",
        createdAt: t1,
        updatedAt: t1,
      });

      const overall = await app.inject({ method: "GET", url: "/reviews/latest" });
      expect(overall.statusCode).toBe(200);
      expect(overall.json<Review>().id).toBe(dailyLatest.id);

      const forDaily = await app.inject({
        method: "GET",
        url: "/reviews/latest?kind=daily",
      });
      expect(forDaily.json<Review>().id).toBe(dailyLatest.id);

      const forWeekly = await app.inject({
        method: "GET",
        url: "/reviews/latest?kind=weekly",
      });
      expect(forWeekly.statusCode).toBe(200);
      expect(forWeekly.json<Review>().period_start).toBe("2026-08-17");

      // The older daily is never returned as latest despite being inserted last.
      expect(forDaily.json<Review>().id).not.toBe(dailyOlder.id);
    });
  });

  describe("GET /reviews/:id", () => {
    it("404s for an unknown id", async () => {
      const response = await getReview("00000000-0000-0000-0000-000000000000");
      expect(response.statusCode).toBe(404);
      expect(response.json<ErrorBody>()).toEqual({ error: "not_found" });
    });
  });

  describe("GET /reviews/context/daily", () => {
    it("rejects a bad or missing tz with 400 validation_failed", async () => {
      const invalid = await app.inject({
        method: "GET",
        url: "/reviews/context/daily?tz=Not/ARealZone",
      });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json<ErrorBody>().error).toBe("validation_failed");

      const missing = await app.inject({ method: "GET", url: "/reviews/context/daily" });
      expect(missing.statusCode).toBe(400);
    });

    it("builds every section from seeded fixtures with honest totals and core-derived period_start", async () => {
      const now = new Date();
      const window = localDayWindow(TZ, now);
      if (!dayHasHourMargins(now, window, 3)) return; // midnight-edge guard

      // Honest-total pool: 21 clearly-overdue tasks (yesterday noon local).
      for (let i = 0; i < 21; i += 1) {
        await app.db.insert(tasks).values({
          title: `Overdue pool ${i}`,
          timezone: TZ,
          status: "active",
          dueAt: atLocal(TZ, addLocalDays(window.localDate, -1), 12),
        });
      }
      await app.db.insert(tasks).values({
        title: "Overdue recent",
        timezone: TZ,
        status: "active",
        dueAt: new Date(now.getTime() - 2 * HOUR_MS),
      });

      // Recurring parent whose scheduled occurrence is its only rep.
      const [parent] = await app.db
        .insert(tasks)
        .values({
          title: "Daily chore",
          timezone: TZ,
          status: "active",
          rrule: "FREQ=DAILY",
          recurrenceAnchor: "due_date",
          recurrenceTimezone: TZ,
        })
        .returning();
      const pastAt = atLocal(TZ, addLocalDays(window.localDate, -2), 8);
      const [occurrence] = await app.db
        .insert(occurrences)
        .values({
          parentType: "task",
          parentId: parent!.id,
          occursAt: pastAt,
          occursLocal: naiveAt(addLocalDays(window.localDate, -2), 8),
          status: "scheduled",
        })
        .returning();

      await app.db.insert(tasks).values({
        title: "Due later today",
        timezone: TZ,
        status: "active",
        dueAt: new Date(now.getTime() + 2 * HOUR_MS),
      });

      const doneTask = await app.db
        .insert(tasks)
        .values({
          title: "Freshly done",
          timezone: TZ,
          status: "done",
          completedAt: new Date(now.getTime() - 1 * HOUR_MS),
        })
        .returning();

      const timedEvent = await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "Timed standup",
          timezone: TZ,
          starts_at: midWindowInstant(window).toISOString(),
          ends_at: new Date(midWindowInstant(window).getTime() + HOUR_MS).toISOString(),
        },
      });
      expect(timedEvent.statusCode).toBe(201);
      const allDayEvent = await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "All-day holiday",
          timezone: TZ,
          all_day: true,
          start_date: window.localDate,
          end_date: window.localDate,
        },
      });
      expect(allDayEvent.statusCode).toBe(201);

      await app.db.insert(inboxItems).values([
        {
          rawText: "failed newest",
          source: "web",
          capturedAt: now,
          timezone: TZ,
          status: "failed",
        },
        {
          rawText: "needs confirm",
          source: "web",
          capturedAt: new Date(now.getTime() - 1000),
          timezone: TZ,
          status: "needs_confirm",
        },
        {
          rawText: "failed older",
          source: "web",
          capturedAt: new Date(now.getTime() - 2000),
          timezone: TZ,
          status: "failed",
        },
        {
          rawText: "pending capture",
          source: "web",
          capturedAt: new Date(now.getTime() - 3000),
          timezone: TZ,
          status: "pending",
        },
      ]);

      const nextMonth = localDayWindowForDate(TZ, addLocalDays(window.localDate, 30));
      const [activeWithNext] = await app.db
        .insert(projects)
        .values({ name: "Active with next" })
        .returning();
      await app.db.insert(tasks).values({
        title: "Future next action",
        timezone: TZ,
        status: "active",
        projectId: activeWithNext!.id,
        dueAt: midWindowInstant(nextMonth),
      });
      await app.db.insert(projects).values({ name: "Empty active project" });

      const [stalledProject] = await app.db
        .insert(projects)
        .values({ name: "Stalled project" })
        .returning();
      await app.db.insert(tasks).values({
        title: "Cold open task",
        timezone: TZ,
        status: "inbox",
        projectId: stalledProject!.id,
        dueAt: midWindowInstant(nextMonth),
        createdAt: new Date(now.getTime() - 20 * 24 * HOUR_MS),
        updatedAt: new Date(now.getTime() - 20 * 24 * HOUR_MS),
      });

      await app.db.insert(projects).values({ name: "Paused project", status: "paused" });

      const response = await app.inject({
        method: "GET",
        url: `/reviews/context/daily?tz=${encodeURIComponent(TZ)}`,
      });
      expect(response.statusCode).toBe(200);

      const body = DailyReviewContextSchema.parse(response.json());
      expect(body.tz).toBe(TZ);
      expect(body.period_start).toBe(dailyPeriodStart(TZ));
      expect(body.effective_now).toBe(body.generated_at);

      // Honest totals BEFORE caps: 21 pool + recent + occurrence rep = 23.
      expect(body.overdue.total).toBe(23);
      expect(body.overdue.items).toHaveLength(20);
      // Sorted ascending by instant: the two-days-ago occurrence rep is the
      // oldest overdue row, so it always survives the 20-item slice.
      const occRep = body.overdue.items.find((item) => item.title === "Daily chore");
      expect(occRep).toMatchObject({
        id: parent!.id,
        parent_task_id: parent!.id,
        occurrence_id: occurrence!.id,
      });
      expect(body.overdue.items.some((item) => item.title === "Overdue pool 0")).toBe(true);
      // The bare recurring parent never appears without its occurrence.
      expect(
        body.overdue.items.some(
          (item) => item.occurrence_id == null && item.title === "Daily chore",
        ),
      ).toBe(false);

      expect(body.due_today.total).toBe(1);
      expect(body.due_today.items.map((item) => item.title)).toEqual(["Due later today"]);

      expect(body.events_today.items.map((item) => item.title)).toEqual([
        "Timed standup",
        "All-day holiday",
      ]);

      expect(body.inbox_attention.pending_count).toBe(1);
      expect(body.inbox_attention.needs_confirm_count).toBe(1);
      expect(body.inbox_attention.failed_count).toBe(2);
      expect(body.inbox_attention.items.map((item) => item.raw_text)).toEqual([
        "failed newest",
        "needs confirm",
        "failed older",
      ]);

      expect(body.active_projects.total).toBe(3); // with-next + empty + stalled
      expect(body.stalled_projects.total).toBe(1);
      expect(body.projects_without_next_action.total).toBe(1);
      expect(body.projects_without_next_action.items[0]!.name).toBe("Empty active project");

      expect(body.recently_completed.total).toBeGreaterThanOrEqual(1);
      expect(
        body.recently_completed.items.some(
          (item) => item.kind === "task" && item.id === doneTask[0]!.id,
        ),
      ).toBe(true);
    });
  });

  describe("GET /reviews/context/weekly", () => {
    it("rejects a bad or missing tz with 400 validation_failed", async () => {
      const invalid = await app.inject({
        method: "GET",
        url: "/reviews/context/weekly?tz=Not/ARealZone",
      });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json<ErrorBody>().error).toBe("validation_failed");

      const missing = await app.inject({ method: "GET", url: "/reviews/context/weekly" });
      expect(missing.statusCode).toBe(400);
    });

    it("includes paused projects, groups upcoming days, and wires recently_completed", async () => {
      const now = new Date();
      const window = localDayWindow(TZ, now);
      if (!dayHasHourMargins(now, window, 3)) return; // midnight-edge guard

      await app.db.insert(projects).values({ name: "Paused initiative", status: "paused" });

      const tomorrow = localDayWindowForDate(TZ, addLocalDays(window.localDate, 1));
      await app.db.insert(tasks).values({
        title: "Tomorrow push",
        timezone: TZ,
        status: "active",
        dueAt: midWindowInstant(tomorrow),
      });
      const dayAfterTomorrow = addLocalDays(window.localDate, 2);
      const upcomingEvent = await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "Upcoming sync",
          timezone: TZ,
          starts_at: midWindowInstant(localDayWindowForDate(TZ, dayAfterTomorrow)).toISOString(),
          ends_at: new Date(
            midWindowInstant(localDayWindowForDate(TZ, dayAfterTomorrow)).getTime() + HOUR_MS,
          ).toISOString(),
        },
      });
      expect(upcomingEvent.statusCode).toBe(201);

      const doneTask = await app.db
        .insert(tasks)
        .values({
          title: "Wrapped up today",
          timezone: TZ,
          status: "done",
          completedAt: new Date(now.getTime() - 1 * HOUR_MS),
        })
        .returning();

      const response = await app.inject({
        method: "GET",
        url: `/reviews/context/weekly?tz=${encodeURIComponent(TZ)}`,
      });
      expect(response.statusCode).toBe(200);

      const body = WeeklyReviewContextSchema.parse(response.json());
      expect(body.period_start).toBe(weeklyPeriodStart(TZ));
      expect(body.effective_now).toBe(body.generated_at);

      expect(body.paused_projects.total).toBe(1);
      expect(body.paused_projects.items[0]!.name).toBe("Paused initiative");

      expect(body.upcoming_7d.days).toHaveLength(7);
      expect(body.upcoming_7d.days[0]!.date).toBe(tomorrow.localDate);
      expect(body.upcoming_7d.days[0]!.tasks.map((item) => item.title)).toEqual(["Tomorrow push"]);
      expect(body.upcoming_7d.days[0]!.total).toBe(1);
      expect(body.upcoming_7d.days[1]!.date).toBe(dayAfterTomorrow);
      expect(body.upcoming_7d.days[1]!.events.map((item) => item.title)).toEqual(["Upcoming sync"]);
      expect(body.upcoming_7d.days.slice(2).every((day) => day.total === 0)).toBe(true);

      expect(body.recently_completed.total).toBeGreaterThanOrEqual(1);
      expect(
        body.recently_completed.items.some(
          (item) => item.kind === "task" && item.id === doneTask[0]!.id,
        ),
      ).toBe(true);

      // Daily-only sections are structurally absent from the weekly shape.
      expect(Object.keys(response.json())).not.toContain("due_today");
      expect(Object.keys(response.json())).not.toContain("events_today");
    });
  });
});

function eqId(id: string) {
  return eq(reviews.id, id);
}
