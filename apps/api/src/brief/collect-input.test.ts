import {
  dailyPeriodStart,
  localDayWindow,
  localDayWindowForDate,
  resolveWallClockToInstant,
  toWallClockComponents,
  wallClockToNaiveDate,
  type WallClockComponents,
} from "@personal-os/core";
import { events, inboxItems, occurrences, projects, reviews, tasks } from "@personal-os/db";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import { collectBriefInput } from "./collect-input.js";
import {
  BRIEF_DUE_TODAY_CAP,
  BRIEF_EVENTS_TODAY_CAP,
  BRIEF_INBOX_SNIPPET_CAP,
  BRIEF_INBOX_SNIPPET_MAX_CHARS,
  BRIEF_OVERDUE_CAP,
  BRIEF_PROJECTS_CAP,
  BRIEF_TITLE_MAX_CHARS,
  BRIEF_UPCOMING_TOTAL_CAP,
  BRIEF_LOCATION_MAX_CHARS,
  MAX_BRIEF_INPUT_CHARS,
} from "./contracts.js";

const TZ = "America/Chicago";
const HOUR_MS = 60 * 60 * 1000;

// Standard 8-4-4-4-12 hex UUID shape. Deliberately generic (not anchored to
// any one field) so it catches a leaked id anywhere in the payload, not just
// where this test thinks to look.
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// Same date arithmetic taste as the collector and its sibling read-model
// tests (today.test.ts, recent-completed.test.ts): anchor at noon UTC so
// adding whole days can never straddle a month boundary unexpectedly.
function addLocalDays(localDate: string, days: number): string {
  const [year, month, day] = localDate.split("-").map(Number);
  const next = new Date(Date.UTC(year!, month! - 1, day, 12) + days * 86_400_000);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${String(next.getUTCFullYear()).padStart(4, "0")}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

function components(localDate: string, hour: number, minute = 0): WallClockComponents {
  const [year, month, day] = localDate.split("-").map(Number);
  return { year: year!, month: month!, day: day!, hour, minute, second: 0 };
}

function atLocal(tz: string, localDate: string, hour: number, minute = 0): Date {
  return resolveWallClockToInstant(components(localDate, hour, minute), tz);
}

describe("collectBriefInput", () => {
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

  it("returns an honest, all-zero, empty snapshot on an empty database without crashing", async () => {
    const now = atLocal(TZ, "2026-08-20", 12);

    const { input, localDate, effectiveNow } = await collectBriefInput(app.db, { tz: TZ, now });

    expect(effectiveNow).toBe(now);
    expect(localDate).toBe("2026-08-20");
    expect(input.tz).toBe(TZ);
    expect(input.local_date).toBe("2026-08-20");
    expect(input.generated_at).toBe(now.toISOString());
    expect(input.summary).toEqual({
      overdue_total: 0,
      due_today_total: 0,
      inbox_attention_total: 0,
      active_project_count: 0,
    });
    expect(input.overdue).toEqual({ items: [], total: 0 });
    expect(input.due_today).toEqual({ items: [], total: 0 });
    expect(input.events_today).toEqual({ items: [], total: 0 });
    expect(input.upcoming).toEqual({ items: [], total: 0 });
    expect(input.inbox).toEqual({
      pending_count: 0,
      needs_confirm_count: 0,
      failed_count: 0,
      snippets: [],
    });
    expect(input.projects).toEqual({ items: [], total: 0 });
    expect(input.reviews).toEqual({ daily_status: null, weekly_status: null });
  });

  it("caps overdue and due-today items while keeping their pre-cap totals honest", async () => {
    const now = atLocal(TZ, "2026-08-20", 12);
    const overdueSeedCount = 15;
    const dueTodaySeedCount = 17;

    await app.db.insert(tasks).values(
      Array.from({ length: overdueSeedCount }, (_, i) => ({
        title: `Overdue ${i}`,
        timezone: TZ,
        status: "active" as const,
        dueAt: new Date(atLocal(TZ, "2026-08-20", 1).getTime() + i * 60_000),
      })),
    );
    await app.db.insert(tasks).values(
      Array.from({ length: dueTodaySeedCount }, (_, i) => ({
        title: `Due today ${i}`,
        timezone: TZ,
        status: "active" as const,
        dueAt: new Date(atLocal(TZ, "2026-08-20", 13).getTime() + i * 60_000),
      })),
    );

    const { input } = await collectBriefInput(app.db, { tz: TZ, now });

    expect(input.overdue.items).toHaveLength(BRIEF_OVERDUE_CAP);
    expect(input.overdue.total).toBe(overdueSeedCount);
    expect(input.due_today.items).toHaveLength(BRIEF_DUE_TODAY_CAP);
    expect(input.due_today.total).toBe(dueTodaySeedCount);
    expect(input.summary.overdue_total).toBe(overdueSeedCount);
    expect(input.summary.due_today_total).toBe(dueTodaySeedCount);
  });

  it("buckets an earlier-today due instant as overdue and a later-today one as due_today, deriving `recurring` from rrule/occurrence_id", async () => {
    const now = atLocal(TZ, "2026-08-20", 12);

    await app.db.insert(tasks).values({
      title: "Plain overdue",
      timezone: TZ,
      status: "active",
      dueAt: atLocal(TZ, "2026-08-20", 9),
    });

    const [recurringParent] = await app.db
      .insert(tasks)
      .values({
        title: "Recurring due today",
        timezone: TZ,
        status: "active",
        rrule: "FREQ=DAILY;INTERVAL=1",
        recurrenceAnchor: "due_date",
        recurrenceTimezone: TZ,
        dueAt: atLocal(TZ, "2026-08-19", 18),
      })
      .returning();
    const occursAt = atLocal(TZ, "2026-08-20", 18);
    await app.db.insert(occurrences).values({
      parentType: "task",
      parentId: recurringParent!.id,
      occursAt,
      occursLocal: wallClockToNaiveDate(toWallClockComponents(occursAt, TZ)),
      status: "scheduled",
    });

    const { input } = await collectBriefInput(app.db, { tz: TZ, now });

    expect(input.overdue.items).toEqual([
      {
        title: "Plain overdue",
        due_at: atLocal(TZ, "2026-08-20", 9).toISOString(),
        project_name: null,
        recurring: false,
      },
    ]);
    expect(input.due_today.items).toEqual([
      {
        title: "Recurring due today",
        due_at: occursAt.toISOString(),
        project_name: null,
        recurring: true,
      },
    ]);
  });

  it("never leaks an internal identifier (task/project/event/occurrence id) into the serialized payload", async () => {
    const now = atLocal(TZ, "2026-08-20", 12);

    const [project] = await app.db
      .insert(projects)
      .values({ name: "Kitchen remodel", status: "active" })
      .returning();
    await app.db.insert(tasks).values([
      {
        title: "Overdue with a project",
        timezone: TZ,
        status: "active",
        projectId: project!.id,
        dueAt: atLocal(TZ, "2026-08-20", 9),
      },
      {
        title: "Undated next-action candidate",
        timezone: TZ,
        status: "active",
        projectId: project!.id,
      },
    ]);
    await app.db.insert(events).values({
      title: "Team standup",
      timezone: TZ,
      startsAt: atLocal(TZ, "2026-08-20", 10),
      location: "Conference room B",
    });
    await app.db.insert(inboxItems).values({
      rawText: "call the dentist",
      source: "web",
      capturedAt: now,
      timezone: TZ,
      status: "needs_confirm",
    });

    const { input } = await collectBriefInput(app.db, { tz: TZ, now });
    const serialized = JSON.stringify(input);

    expect(serialized).not.toMatch(UUID_RE);
    // Sanity: the project/task/event rows above genuinely exist (proves the
    // negative match isn't vacuous because nothing was collected).
    expect(input.overdue.items).toHaveLength(1);
    expect(input.events_today.items).toHaveLength(1);
    expect(input.projects.items.length).toBeGreaterThan(0);
  });

  it("truncates an over-long task title and an over-long inbox snippet to their bounded lengths", async () => {
    const now = atLocal(TZ, "2026-08-20", 12);
    const longTitle = "T".repeat(BRIEF_TITLE_MAX_CHARS + 80);
    const longSnippet = "S".repeat(BRIEF_INBOX_SNIPPET_MAX_CHARS + 80);

    await app.db.insert(tasks).values({
      title: longTitle,
      timezone: TZ,
      status: "active",
      dueAt: atLocal(TZ, "2026-08-20", 9),
    });
    await app.db.insert(inboxItems).values({
      rawText: longSnippet,
      source: "web",
      capturedAt: now,
      timezone: TZ,
      status: "needs_confirm",
    });

    const { input } = await collectBriefInput(app.db, { tz: TZ, now });

    expect(input.overdue.items).toHaveLength(1);
    expect(input.overdue.items[0]!.title.length).toBe(BRIEF_TITLE_MAX_CHARS);
    expect(input.overdue.items[0]!.title.endsWith("…")).toBe(true);

    expect(input.inbox.snippets).toHaveLength(1);
    expect(input.inbox.snippets[0]!.length).toBe(BRIEF_INBOX_SNIPPET_MAX_CHARS);
    expect(input.inbox.snippets[0]!.endsWith("…")).toBe(true);
  });

  it("stays under MAX_BRIEF_INPUT_CHARS even when every section is stuffed far past its cap with max-length titles", async () => {
    const now = atLocal(TZ, "2026-08-20", 12);
    const longTitle = "T".repeat(BRIEF_TITLE_MAX_CHARS + 80);

    // Overdue/due-today tasks and events deliberately carry no project /
    // location -- per-field truncation of those secondary fields is already
    // proven by the dedicated truncation test above. This test's purpose is
    // to prove the whole-section drop ceiling engages and holds under
    // adversarial ITEM COUNTS with every TITLE maxed, which is what the
    // reducible sections (upcoming/projects/inbox snippets) below stress far
    // harder than any realistic day could.
    await app.db.insert(tasks).values(
      Array.from({ length: 30 }, (_, i) => ({
        title: longTitle,
        timezone: TZ,
        status: "active" as const,
        dueAt: new Date(atLocal(TZ, "2026-08-20", 1).getTime() + i * 60_000),
      })),
    );
    await app.db.insert(tasks).values(
      Array.from({ length: 30 }, (_, i) => ({
        title: longTitle,
        timezone: TZ,
        status: "active" as const,
        dueAt: new Date(atLocal(TZ, "2026-08-20", 13).getTime() + i * 60_000),
      })),
    );
    await app.db.insert(events).values(
      Array.from({ length: 20 }, (_, i) => ({
        title: longTitle,
        timezone: TZ,
        startsAt: atLocal(TZ, "2026-08-20", i),
      })),
    );
    for (let day = 1; day <= 7; day += 1) {
      const dayWindow = localDayWindowForDate(TZ, addLocalDays("2026-08-20", day));
      await app.db.insert(tasks).values(
        Array.from({ length: 5 }, (_, i) => ({
          title: longTitle,
          timezone: TZ,
          status: "active" as const,
          dueAt: new Date(dayWindow.startUtc.getTime() + i * HOUR_MS),
        })),
      );
    }
    await app.db.insert(inboxItems).values(
      Array.from({ length: 20 }, (_, i) => ({
        rawText: "S".repeat(BRIEF_INBOX_SNIPPET_MAX_CHARS + 80),
        source: "web" as const,
        capturedAt: new Date(now.getTime() - i * 1000),
        timezone: TZ,
        status: "needs_confirm" as const,
      })),
    );
    const projectRows = await app.db
      .insert(projects)
      .values(
        Array.from({ length: 20 }, (_, i) => ({
          name: `${longTitle}-${i}`,
          status: "active" as const,
        })),
      )
      .returning();
    await app.db.insert(tasks).values(
      projectRows.map((project) => ({
        title: longTitle,
        timezone: TZ,
        status: "active" as const,
        projectId: project.id,
        // No due date -- Checkpoint 5.4's established "undated task
        // excluded" semantics keep this out of overdue/due-today/upcoming
        // entirely; it exists only to give the project a next_action.
      })),
    );

    const { input } = await collectBriefInput(app.db, { tz: TZ, now });

    // Irreducible sections (never dropped by the ceiling logic): item
    // counts hit their caps, totals stay honest.
    expect(input.overdue.items).toHaveLength(BRIEF_OVERDUE_CAP);
    expect(input.overdue.total).toBe(30);
    expect(input.due_today.items).toHaveLength(BRIEF_DUE_TODAY_CAP);
    // 30 dated due-today tasks + the 20 undated project next-action tasks
    // seeded above -- Today's own frozen semantics place undated open work
    // into due_today ("actionable today", sorts last within the bucket), so
    // it honestly inflates this total even though none of those 20 ever
    // reach this section's capped items (the 30 dated rows already fill
    // Today's own 25-item cap ahead of any undated row).
    expect(input.due_today.total).toBe(50);
    expect(input.events_today.items).toHaveLength(BRIEF_EVENTS_TODAY_CAP);
    expect(input.events_today.total).toBe(20);

    // Reducible sections (upcoming/projects/inbox snippets) may have been
    // dropped WHOLE by the ceiling logic under this adversarial input -- but
    // their totals/counts must stay honest regardless of whether that
    // happened, and their item counts must never exceed their own caps.
    expect(input.upcoming.total).toBe(35);
    expect(input.upcoming.items.length).toBeLessThanOrEqual(BRIEF_UPCOMING_TOTAL_CAP);
    expect(input.projects.total).toBe(20);
    expect(input.projects.items.length).toBeLessThanOrEqual(BRIEF_PROJECTS_CAP);
    expect(input.inbox.needs_confirm_count).toBe(20);
    expect(input.inbox.snippets.length).toBeLessThanOrEqual(BRIEF_INBOX_SNIPPET_CAP);

    const size = JSON.stringify(input).length;
    expect(size).toBeLessThanOrEqual(MAX_BRIEF_INPUT_CHARS);
  });

  // Regression for the audit finding that made the collector's "unreachable"
  // throw reachable: the sections the drop ladder used to refuse to touch
  // (overdue + due_today + events_today) reach ~8.6k chars on their own once
  // every item ALSO carries a max-length project name and location -- the
  // exact field combination the test above deliberately omits. Before the
  // fix (6000 ceiling, no last-resort item trimming) this threw, which the
  // route surfaced as an opaque 500 on an ordinary busy day.
  it("stays under the ceiling when the irreducible sections also carry max-length project names and locations", async () => {
    const now = atLocal(TZ, "2026-08-20", 12);
    const longTitle = "T".repeat(BRIEF_TITLE_MAX_CHARS + 80);
    const longLocation = "L".repeat(BRIEF_LOCATION_MAX_CHARS + 40);

    const [project] = await app.db
      .insert(projects)
      .values({ name: "P".repeat(BRIEF_TITLE_MAX_CHARS + 40), status: "active" })
      .returning();

    await app.db.insert(tasks).values(
      Array.from({ length: 12 }, (_, i) => ({
        title: longTitle,
        timezone: TZ,
        status: "active" as const,
        projectId: project!.id,
        dueAt: new Date(atLocal(TZ, "2026-08-20", 1).getTime() + i * 60_000),
      })),
    );
    await app.db.insert(tasks).values(
      Array.from({ length: 14 }, (_, i) => ({
        title: longTitle,
        timezone: TZ,
        status: "active" as const,
        projectId: project!.id,
        dueAt: new Date(atLocal(TZ, "2026-08-20", 13).getTime() + i * 60_000),
      })),
    );
    await app.db.insert(events).values(
      Array.from({ length: 12 }, (_, i) => ({
        title: longTitle,
        timezone: TZ,
        location: longLocation,
        startsAt: atLocal(TZ, "2026-08-20", i),
      })),
    );

    const { input } = await collectBriefInput(app.db, { tz: TZ, now });

    // Does not throw, stays bounded, and -- the point of the fix -- the
    // time-critical sections still carry real items rather than being
    // emptied to fit.
    const size = JSON.stringify(input).length;
    expect(size).toBeLessThanOrEqual(MAX_BRIEF_INPUT_CHARS);
    expect(input.overdue.items.length).toBeGreaterThan(0);
    expect(input.due_today.items.length).toBeGreaterThan(0);
    expect(input.events_today.items.length).toBeGreaterThan(0);
    // Honest totals survive every cap and every drop.
    expect(input.overdue.total).toBeGreaterThanOrEqual(input.overdue.items.length);
    expect(input.due_today.total).toBeGreaterThanOrEqual(input.due_today.items.length);
    expect(input.events_today.total).toBeGreaterThanOrEqual(input.events_today.items.length);
  });

  it("produces byte-identical output across two calls sharing the same pinned now", async () => {
    const now = atLocal(TZ, "2026-08-20", 12);

    const [project] = await app.db
      .insert(projects)
      .values({ name: "Determinism project", status: "active" })
      .returning();
    await app.db.insert(tasks).values([
      {
        title: "Overdue task",
        timezone: TZ,
        status: "active",
        projectId: project!.id,
        dueAt: atLocal(TZ, "2026-08-20", 9),
      },
      {
        title: "Due-today task",
        timezone: TZ,
        status: "active",
        dueAt: atLocal(TZ, "2026-08-20", 18),
      },
    ]);
    await app.db.insert(events).values({
      title: "Standup",
      timezone: TZ,
      startsAt: atLocal(TZ, "2026-08-20", 10),
      location: "Room 1",
    });
    await app.db.insert(inboxItems).values({
      rawText: "call the dentist",
      source: "web",
      capturedAt: now,
      timezone: TZ,
      status: "needs_confirm",
    });
    await app.db.insert(reviews).values({
      kind: "daily",
      periodStart: dailyPeriodStart(TZ, now),
      timezone: TZ,
      status: "completed",
      completedAt: now,
    });

    const first = await collectBriefInput(app.db, { tz: TZ, now });
    const second = await collectBriefInput(app.db, { tz: TZ, now });

    expect(second.input).toEqual(first.input);
    expect(second.localDate).toBe(first.localDate);
    expect(second.effectiveNow.getTime()).toBe(first.effectiveNow.getTime());
    // Not vacuous: the reviews row above genuinely flowed through.
    expect(first.input.reviews.daily_status).toBe("completed");
  });

  it("derives a tz-correct local_date that diverges between America/Chicago and Pacific/Auckland at an instant where their calendar dates differ", async () => {
    const now = new Date("2026-08-20T02:00:00.000Z");

    const { input: chicagoInput } = await collectBriefInput(app.db, {
      tz: "America/Chicago",
      now,
    });
    const { input: aucklandInput } = await collectBriefInput(app.db, {
      tz: "Pacific/Auckland",
      now,
    });

    expect(chicagoInput.local_date).toBe(localDayWindow("America/Chicago", now).localDate);
    expect(aucklandInput.local_date).toBe(localDayWindow("Pacific/Auckland", now).localDate);
    expect(chicagoInput.local_date).not.toBe(aucklandInput.local_date);
  });
});
