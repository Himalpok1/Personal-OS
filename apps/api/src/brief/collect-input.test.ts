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
import { buildBriefUserPrompt, serializeBriefSnapshot } from "./prompt.js";
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
        priority: null,
        has_reminder: false,
      },
    ]);
    expect(input.due_today.items).toEqual([
      {
        title: "Recurring due today",
        due_at: occursAt.toISOString(),
        project_name: null,
        recurring: true,
        priority: null,
        has_reminder: false,
      },
    ]);
  });

  // Checkpoint 9.3: two bounded scalars join BriefTaskItem so the brief can
  // order by priority and say which items carry a reminder. `priority` is the
  // stored value verbatim (lower = higher, null = unset); `has_reminder` is a
  // boolean derived from remind_at, never the instant itself.
  it("derives priority and has_reminder from the Today task item (9.3)", async () => {
    const now = atLocal(TZ, "2026-08-20", 12);

    await app.db.insert(tasks).values([
      {
        title: "P1 with reminder",
        timezone: TZ,
        status: "active",
        priority: 1,
        dueAt: atLocal(TZ, "2026-08-20", 9),
        remindAt: atLocal(TZ, "2026-08-20", 8),
      },
      {
        title: "P3 no reminder",
        timezone: TZ,
        status: "active",
        priority: 3,
        dueAt: atLocal(TZ, "2026-08-20", 15),
      },
      {
        title: "Unset priority",
        timezone: TZ,
        status: "active",
        dueAt: atLocal(TZ, "2026-08-20", 16),
        remindAt: atLocal(TZ, "2026-08-20", 15, 30),
      },
    ]);

    const { input } = await collectBriefInput(app.db, { tz: TZ, now });

    expect(input.overdue.items).toEqual([
      {
        title: "P1 with reminder",
        due_at: atLocal(TZ, "2026-08-20", 9).toISOString(),
        project_name: null,
        recurring: false,
        priority: 1,
        has_reminder: true,
      },
    ]);
    const byTitle = Object.fromEntries(input.due_today.items.map((item) => [item.title, item]));
    expect(byTitle["P3 no reminder"]).toMatchObject({ priority: 3, has_reminder: false });
    expect(byTitle["Unset priority"]).toMatchObject({ priority: null, has_reminder: true });

    // The reminder INSTANT never reaches the payload -- only the boolean.
    const serialized = serializeBriefSnapshot(input);
    expect(serialized).not.toContain(atLocal(TZ, "2026-08-20", 8).toISOString());
    expect(serialized).not.toContain(atLocal(TZ, "2026-08-20", 15, 30).toISOString());
    expect(serialized).not.toContain("remind_at");
  });

  it("carries priority and has_reminder on a recurring occurrence row, from its parent", async () => {
    const now = atLocal(TZ, "2026-08-20", 12);
    const [parent] = await app.db
      .insert(tasks)
      .values({
        title: "Recurring P2",
        timezone: TZ,
        status: "active",
        priority: 2,
        rrule: "FREQ=DAILY;INTERVAL=1",
        recurrenceAnchor: "due_date",
        recurrenceTimezone: TZ,
        dueAt: atLocal(TZ, "2026-08-19", 18),
        remindAt: atLocal(TZ, "2026-08-19", 17),
      })
      .returning();
    const occursAt = atLocal(TZ, "2026-08-20", 18);
    await app.db.insert(occurrences).values({
      parentType: "task",
      parentId: parent!.id,
      occursAt,
      occursLocal: wallClockToNaiveDate(toWallClockComponents(occursAt, TZ)),
      status: "scheduled",
    });

    const { input } = await collectBriefInput(app.db, { tz: TZ, now });
    expect(input.due_today.items).toEqual([
      {
        title: "Recurring P2",
        due_at: occursAt.toISOString(),
        project_name: null,
        recurring: true,
        priority: 2,
        has_reminder: true,
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

  it("redacts a secret-shaped string from an inbox snippet BEFORE truncating (9.7 ride-along)", async () => {
    const now = atLocal(TZ, "2026-08-20", 12);
    // A Groq-shaped key (the production transcription provider) placed so the
    // truncation cut would land INSIDE it: redact-then-truncate leaves no
    // prefix of it; truncate-then-redact would ship a fragment.
    const secret = "gsk_" + "Q".repeat(40);
    const filler = "s".repeat(BRIEF_INBOX_SNIPPET_MAX_CHARS - 10);
    await app.db.insert(inboxItems).values({
      rawText: `${filler} ${secret} tail`,
      source: "web",
      capturedAt: now,
      timezone: TZ,
      status: "needs_confirm",
    });

    const { input } = await collectBriefInput(app.db, { tz: TZ, now });
    expect(input.inbox.snippets).toHaveLength(1);
    const snippet = input.inbox.snippets[0]!;
    expect(snippet).not.toContain(secret);
    expect(snippet).not.toContain("gsk_Q");
    expect(snippet.length).toBeLessThanOrEqual(BRIEF_INBOX_SNIPPET_MAX_CHARS);
    expect(serializeBriefSnapshot(input)).not.toContain("gsk_Q");
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

    const size = serializeBriefSnapshot(input).length;
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
    const size = serializeBriefSnapshot(input).length;
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

  // ---- Checkpoint 5.7.1: all-day events must never carry a clock time ----
  //
  // The shipped defect: ADR-042 anchors a recurring all-day series' DTSTART at
  // LOCAL NOON, and `eventEffectiveStart` returned `occurs_at ?? starts_at`
  // with no all_day guard -- so the model received a synthetic noon timestamp
  // and the production brief said "an all-day weekly event beginning at
  // 12:00 PM". These tests pin the fix at the payload boundary: whatever the
  // model is handed must be inexpressible as a time for an all-day event.

  for (const tz of ["America/Chicago", "Pacific/Auckland", "America/Santiago"]) {
    it(`serializes a recurring all-day instance as a DATE with no time (${tz})`, async () => {
      // Daily all-day series covering Aug 24, 25, 26; Today is Aug 25.
      const [eventRow] = await app.db
        .insert(events)
        .values({
          title: "Dentist appointment",
          timezone: tz,
          allDay: true,
          startDate: "2026-08-24",
          endDate: "2026-08-24",
          rrule: "FREQ=DAILY;INTERVAL=1",
          recurrenceTimezone: tz,
          recurrenceCount: 3,
        })
        .returning({ id: events.id });

      // Materialize the Aug 25 instance at its local-noon anchor, exactly as
      // the recurrence engine does.
      const noonAnchor = atLocal(tz, "2026-08-25", 12);
      await app.db.insert(occurrences).values({
        parentType: "event",
        parentId: eventRow!.id,
        occursAt: noonAnchor,
        occursLocal: wallClockToNaiveDate(toWallClockComponents(noonAnchor, tz)),
        status: "scheduled",
      });

      const { input } = await collectBriefInput(app.db, {
        tz,
        now: atLocal(tz, "2026-08-25", 9),
      });

      const item = input.events_today.items.find((e) => e.title === "Dentist appointment");
      expect(item, "the all-day instance must appear on its own date").toBeDefined();
      expect(item!.all_day).toBe(true);
      // The date must be present and be Aug 25 -- the instance's own day.
      expect(item!.date).toBe("2026-08-25");
      // And no time may be expressible at all.
      expect(item!.starts_at).toBeNull();

      // Defensive: the serialized payload the model actually sees must contain
      // the date and must NOT contain the noon anchor in any form.
      const serialized = JSON.stringify(input);
      expect(serialized).toContain("2026-08-25");
      expect(serialized).not.toContain(noonAnchor.toISOString());
      expect(serialized).not.toMatch(/T12:00/);
    });
  }

  it("still reports a real clock time for a TIMED event, so the guard is not over-broad", async () => {
    await app.db.insert(events).values({
      title: "Standup",
      timezone: TZ,
      allDay: false,
      startsAt: atLocal(TZ, "2026-08-25", 9),
      endsAt: atLocal(TZ, "2026-08-25", 9, 30),
    });

    const { input } = await collectBriefInput(app.db, {
      tz: TZ,
      now: atLocal(TZ, "2026-08-25", 8),
    });

    const item = input.events_today.items.find((e) => e.title === "Standup");
    expect(item).toBeDefined();
    expect(item!.all_day).toBe(false);
    expect(item!.starts_at).toBe(atLocal(TZ, "2026-08-25", 9).toISOString());
    expect(item!.date).toBeNull();
  });

  it("serializes a NON-recurring all-day event as a date with no time", async () => {
    await app.db.insert(events).values({
      title: "Public holiday",
      timezone: TZ,
      allDay: true,
      startDate: "2026-08-25",
      endDate: "2026-08-25",
    });

    const { input } = await collectBriefInput(app.db, {
      tz: TZ,
      now: atLocal(TZ, "2026-08-25", 9),
    });

    const item = input.events_today.items.find((e) => e.title === "Public holiday");
    expect(item).toBeDefined();
    expect(item!.all_day).toBe(true);
    expect(item!.starts_at).toBeNull();
    expect(item!.date).toBe("2026-08-25");
  });
});

// Checkpoint 9.3: the whole-payload ceiling is measured on the EXACT string
// the prompt sends. The collector used to measure the compact form while
// buildBriefUserPrompt sent the pretty one (docs/CHECKPOINT-8.6B-DESIGN.md,
// section 7, "an unrecorded defect found by the 8.6 critic"), so a snapshot
// could pass the ceiling and still reach the model well over it.
describe("collectBriefInput -- ceiling measured on the serialization the prompt sends (9.3)", () => {
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

  it("the snapshot embedded in the user prompt is byte-identical to what the ceiling measured, and is under it", async () => {
    const now = atLocal(TZ, "2026-08-20", 12);
    const longTitle = "T".repeat(BRIEF_TITLE_MAX_CHARS + 80);
    const longLocation = "L".repeat(BRIEF_LOCATION_MAX_CHARS + 40);
    const [project] = await app.db
      .insert(projects)
      .values({ name: "P".repeat(BRIEF_TITLE_MAX_CHARS + 40), status: "active" })
      .returning();
    await app.db.insert(tasks).values(
      Array.from({ length: 30 }, (_, i) => ({
        title: longTitle,
        timezone: TZ,
        status: "active" as const,
        projectId: project!.id,
        priority: (i % 4) + 1,
        remindAt: atLocal(TZ, "2026-08-20", 7),
        dueAt: new Date(atLocal(TZ, "2026-08-20", i < 15 ? 1 : 13).getTime() + i * 60_000),
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

    const prompt = buildBriefUserPrompt(input);
    const open = prompt.indexOf("<snapshot>\n") + "<snapshot>\n".length;
    const close = prompt.lastIndexOf("\n</snapshot>");
    const embedded = prompt.slice(open, close);

    expect(embedded).toBe(serializeBriefSnapshot(input));
    expect(embedded.length).toBeLessThanOrEqual(MAX_BRIEF_INPUT_CHARS);
    // The old, compact measurement is strictly smaller than what is sent --
    // which is exactly why measuring it was a defect, not a stylistic choice.
    expect(JSON.stringify(input).length).toBeLessThan(embedded.length);
  });
});
