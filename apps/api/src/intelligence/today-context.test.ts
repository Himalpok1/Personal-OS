import {
  aiModels,
  aiProviderConnections,
  aiTaskRoutes,
  events,
  inboxItems,
  occurrences,
  projects,
  tasks,
} from "@personal-os/db";
import {
  TODAY_CONTEXT_CAPS,
  TODAY_CONTEXT_MAX_CHARS,
  TodayContextSchema,
  type TodayContext,
} from "@personal-os/schema";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AskUnauthorizedError, authorizeCloudAsk, type CloudAskGrant } from "../ask/authorize.js";
import { buildTodayResponse } from "../read-models/today.js";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import { mintReadContext, type ReadContext } from "./read-context.js";
import { __testing, buildTodayContext, type TodayContextBuild } from "./today-context.js";

// buildTodayContext (Checkpoint 9.7, ADR-066). Every fixture is dated
// relative to ONE fixed `now` -- 2026-09-14T14:30Z, 09:30 America/Chicago --
// threaded through mintReadContext's seam, so nothing here depends on the
// wall clock of the machine running it.

const TZ = "America/Chicago";
const NOW = new Date("2026-09-14T14:30:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const BELL = String.fromCharCode(7);

function fakeRequest(id = "req-today"): FastifyRequest {
  return { id } as unknown as FastifyRequest;
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const ISO_INSTANT_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

describe("buildTodayContext", () => {
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

  async function seedAskRoute(): Promise<void> {
    const [connection] = await app.db
      .insert(aiProviderConnections)
      .values({
        name: "Test provider",
        providerType: "openai_compatible",
        baseUrl: "https://example.invalid/v1",
        apiKeyCiphertext: Buffer.from("ciphertext"),
        apiKeyIv: Buffer.from("iv"),
        apiKeyAuthTag: Buffer.from("authtag"),
      })
      .returning();
    const [model] = await app.db
      .insert(aiModels)
      .values({ providerConnectionId: connection!.id, modelId: "test-model" })
      .returning();
    await app.db.insert(aiTaskRoutes).values({ taskName: "ask", primaryModelId: model!.id });
  }

  async function ctx(tz = TZ, now = NOW): Promise<ReadContext> {
    await seedAskRoute();
    const grant = await authorizeCloudAsk(fakeRequest(), app.db);
    expect(grant).not.toBeNull();
    return mintReadContext(fakeRequest(), app.db, grant!, tz, now);
  }

  function refsInOrder(context: TodayContext): number[] {
    return [
      ...context.overdue.items,
      ...context.due_today.items,
      ...context.events_today.items,
      ...context.upcoming.items,
      ...context.reminders.items,
      ...context.recently_completed.items,
      ...context.open_loops.inbox.captures,
      ...context.open_loops.stalled_projects.items,
      ...context.open_loops.projects_without_next_action.items,
      ...context.open_loops.snoozed_within_horizon.items,
    ].map((row) => row.ref);
  }

  interface Seeded {
    overdueTaskId: string;
    dueTodayTaskId: string;
    recurringTaskId: string;
    snoozedOccurrenceId: string;
    localEventId: string;
    externalEventId: string;
    upcomingExternalEventId: string;
    completedTaskId: string;
    captureId: string;
    stalledProjectId: string;
    stalledNextTaskId: string;
  }

  async function seedBusyDay(): Promise<Seeded> {
    const [home] = await app.db.insert(projects).values({ name: "Home" }).returning();
    const old = new Date(NOW.getTime() - 30 * DAY_MS);
    const [stalled] = await app.db
      .insert(projects)
      .values({ name: "Stalled garage", createdAt: old, updatedAt: old })
      .returning();
    // A project with an open task still yields a next action (pickNextAction
    // falls back to created_at/id); a project with NO open task has none.
    await app.db.insert(projects).values({ name: "Empty project" });

    const [overdueTask] = await app.db
      .insert(tasks)
      .values({
        title: `Renew   passport${BELL} at the office`,
        status: "active",
        timezone: TZ,
        priority: 1,
        projectId: home!.id,
        dueAt: new Date("2026-09-13T15:00:00Z"),
        remindAt: new Date("2026-09-13T14:00:00Z"),
      })
      .returning();
    const [dueToday] = await app.db
      .insert(tasks)
      .values({
        title: "Call the dentist",
        status: "active",
        timezone: TZ,
        dueAt: new Date("2026-09-14T20:00:00Z"), // 15:00 CDT
      })
      .returning();
    await app.db.insert(tasks).values({
      title: "Pay rent",
      status: "active",
      timezone: TZ,
      priority: 2,
      dueAt: new Date("2026-09-16T14:00:00Z"),
    });
    // Recurring daily chore with a reminder 30 minutes before; today's
    // occurrence snoozed to 17:00 CDT.
    const [recurring] = await app.db
      .insert(tasks)
      .values({
        title: "Water the plants",
        status: "active",
        timezone: TZ,
        rrule: "FREQ=DAILY",
        recurrenceTimezone: TZ,
        recurrenceAnchor: "due_date",
        dueAt: new Date("2026-09-14T13:00:00Z"), // 08:00 CDT
        remindAt: new Date("2026-09-14T12:30:00Z"), // 07:30 CDT
      })
      .returning();
    const [snoozedOcc] = await app.db
      .insert(occurrences)
      .values({
        parentType: "task",
        parentId: recurring!.id,
        occursAt: new Date("2026-09-14T13:00:00Z"),
        occursLocal: new Date("2026-09-14T13:00:00Z"),
        status: "scheduled",
        lazyGenerated: false,
        snoozedUntil: new Date("2026-09-14T22:00:00Z"), // 17:00 CDT
      })
      .returning();
    await app.db.insert(occurrences).values({
      parentType: "task",
      parentId: recurring!.id,
      occursAt: new Date("2026-09-15T13:00:00Z"),
      occursLocal: new Date("2026-09-15T13:00:00Z"),
      status: "scheduled",
      lazyGenerated: false,
    });

    const [localEvent] = await app.db
      .insert(events)
      .values({
        title: "Dentist at clinic.example.com",
        location: "Elm St",
        timezone: TZ,
        startsAt: new Date("2026-09-14T16:00:00Z"), // 11:00 CDT
        endsAt: new Date("2026-09-14T17:00:00Z"),
        origin: "local",
        description: "bring the insurance card",
      })
      .returning();
    const [externalEvent] = await app.db
      .insert(events)
      .values({
        title: "Vendor sync at partner.example.org",
        location: "HQ lobby",
        timezone: TZ,
        allDay: true,
        startDate: "2026-09-14",
        endDate: "2026-09-14",
        origin: "external",
        description: "passcode 1234",
      })
      .returning();
    const [upcomingExternal] = await app.db
      .insert(events)
      .values({
        title: "Board review",
        timezone: TZ,
        startsAt: new Date("2026-09-16T18:00:00Z"),
        endsAt: new Date("2026-09-16T19:00:00Z"),
        // origin omitted -> DB default 'external'
      })
      .returning();

    const [completedTask] = await app.db
      .insert(tasks)
      .values({
        title: "Book flights",
        status: "done",
        timezone: TZ,
        completedAt: new Date("2026-09-13T12:00:00Z"),
      })
      .returning();

    const [capture] = await app.db
      .insert(inboxItems)
      .values({
        rawText: `remind me${BELL} to rotate gsk_abcdefghijklmnopqrstuvwxyz0123456789 before friday`,
        source: "web",
        capturedAt: new Date("2026-09-14T13:00:00Z"),
        timezone: TZ,
        status: "needs_confirm",
      })
      .returning();
    await app.db.insert(inboxItems).values({
      rawText: "pending one",
      source: "web",
      capturedAt: new Date("2026-09-14T12:00:00Z"),
      timezone: TZ,
      status: "pending",
    });

    const [stalledNext] = await app.db
      .insert(tasks)
      .values({
        title: "Clear the shelves",
        status: "active",
        timezone: TZ,
        projectId: stalled!.id,
        createdAt: old,
        updatedAt: old,
      })
      .returning();

    return {
      overdueTaskId: overdueTask!.id,
      dueTodayTaskId: dueToday!.id,
      recurringTaskId: recurring!.id,
      snoozedOccurrenceId: snoozedOcc!.id,
      localEventId: localEvent!.id,
      externalEventId: externalEvent!.id,
      upcomingExternalEventId: upcomingExternal!.id,
      completedTaskId: completedTask!.id,
      captureId: capture!.id,
      stalledProjectId: stalled!.id,
      stalledNextTaskId: stalledNext!.id,
    };
  }

  describe("authorization", () => {
    it("throws AskUnauthorizedError on a forged grant before reading anything", async () => {
      const forged: CloudAskGrant = { requestId: "x", grantedAt: new Date().toISOString() };
      const readContext: ReadContext = { db: app.db, effectiveNow: NOW, tz: TZ, grant: forged };
      await expect(buildTodayContext(readContext)).rejects.toBeInstanceOf(AskUnauthorizedError);
    });
  });

  describe("on an empty database", () => {
    it("is empty, parses, and carries the wall-clock now", async () => {
      const build = await buildTodayContext(await ctx());
      expect(build.isEmpty).toBe(true);
      expect(build.citations).toEqual([]);
      expect(build.droppedSections).toEqual([]);
      expect(build.context.now_local).toBe("2026-09-14 09:30");
      expect(build.context.local_date).toBe("2026-09-14");
      expect(build.context.tz).toBe(TZ);
      expect(build.chars).toBe(build.serialized.length);
      expect(build.serialized).toBe(JSON.stringify(build.context));
      expect(TodayContextSchema.parse(JSON.parse(build.serialized))).toEqual(build.context);
    });
  });

  describe("on a busy day", () => {
    let seeded: Seeded;
    let build: TodayContextBuild;

    beforeEach(async () => {
      seeded = await seedBusyDay();
      build = await buildTodayContext(await ctx());
    });

    it("parses and is not empty", () => {
      expect(build.isEmpty).toBe(false);
      expect(build.droppedSections).toEqual([]);
      expect(build.chars).toBeLessThanOrEqual(TODAY_CONTEXT_MAX_CHARS);
    });

    it("assigns unique, sequential refs in the documented section order", () => {
      const refs = refsInOrder(build.context);
      expect(refs).toEqual(refs.map((_, i) => i + 1));
      expect(new Set(refs).size).toBe(refs.length);
    });

    it("has exactly one citation per present ref, and every citation resolves to a present ref", () => {
      const refs = refsInOrder(build.context);
      expect(build.citations.map((c) => c.ref).sort((a, b) => a - b)).toEqual(refs);
    });

    it("lastRef is the highest ordinal ever assigned, so a caller can append refs without colliding", () => {
      const refs = refsInOrder(build.context);
      expect(build.lastRef).toBe(Math.max(...refs));
      for (const citation of build.citations)
        expect(citation.ref).toBeLessThanOrEqual(build.lastRef);
    });

    it("maps sections onto the read models with honest totals", () => {
      const c = build.context;
      expect(c.summary.overdue_total).toBe(1);
      // Three: the two dated ones plus the stalled project's undated open
      // task, which Today buckets as due today (no due date = actionable now).
      expect(c.summary.due_today_total).toBe(3);
      expect(c.summary.inbox_attention_total).toBe(2);
      expect(c.summary.active_project_count).toBe(3);
      expect(c.overdue.items.map((i) => i.title)).toEqual(["Renew passport at the office"]);
      expect(c.overdue.items[0]).toMatchObject({
        due_local: "2026-09-13 10:00",
        project: "Home",
        priority: 1,
        recurring: false,
        has_reminder: true,
        snoozed: false,
      });
      expect(c.due_today.items.map((i) => i.title).sort()).toEqual([
        "Call the dentist",
        "Clear the shelves",
        "Water the plants",
      ]);
      expect(c.due_today.items.find((i) => i.title === "Clear the shelves")!.due_local).toBeNull();
      const chore = c.due_today.items.find((i) => i.title === "Water the plants")!;
      expect(chore).toMatchObject({
        due_local: "2026-09-14 17:00",
        recurring: true,
        has_reminder: true,
        snoozed: true,
      });
      expect(c.upcoming.items.map((i) => [i.date, i.kind, i.title])).toEqual([
        ["2026-09-15", "task", "Water the plants"],
        ["2026-09-16", "task", "Pay rent"],
        ["2026-09-16", "event", "Board review"],
      ]);
      expect(c.upcoming.total).toBe(3);
      expect(c.reminders.horizon_days).toBe(7);
      expect(c.reminders.items.map((i) => [i.title, i.remind_local, i.due_local])).toEqual([
        ["Water the plants", "2026-09-14 17:00", "2026-09-14 17:00"],
        ["Water the plants", "2026-09-15 07:30", "2026-09-15 08:00"],
      ]);
      expect(c.recently_completed).toEqual({
        items: [
          {
            ref: expect.any(Number) as number,
            title: "Book flights",
            completed_local: "2026-09-13 07:00",
          },
        ],
        total: 1,
      });
      expect(c.open_loops.inbox).toMatchObject({
        pending_count: 1,
        needs_confirm_count: 1,
        failed_count: 0,
      });
      expect(c.open_loops.snoozed_within_horizon).toEqual({
        items: [
          {
            ref: expect.any(Number) as number,
            title: "Water the plants",
            snoozed_until_local: "2026-09-14 17:00",
          },
        ],
        total: 1,
      });
      expect(c.open_loops.reviews).toEqual({ daily_status: null, weekly_status: null });
      expect(c.projects_touched.map((p) => p.name)).toEqual(["Home", "Stalled garage"]);
    });

    it("renders all-day events as a date with starts_local null and timed events with a wall-clock start", () => {
      const byTitle = new Map(build.context.events_today.items.map((i) => [i.title, i]));
      expect(byTitle.get("Dentist at clinic.example.com")).toMatchObject({
        starts_local: "2026-09-14 11:00",
        date: null,
        all_day: false,
        location: "Elm St",
      });
      expect(byTitle.get("Vendor sync at partner.example.org")).toMatchObject({
        starts_local: null,
        date: "2026-09-14",
        all_day: true,
        location: "HQ lobby",
      });
      expect(build.context.events_today.total).toBe(2);
    });

    it("treats external (and unknown-origin) event text as untrusted and local event text as trusted", () => {
      expect(build.untrustedInputs.sort()).toEqual(
        ["Board review", "HQ lobby", "Vendor sync at partner.example.org"].sort(),
      );
      expect(build.untrustedInputs).not.toContain("Dentist at clinic.example.com");
      expect(build.untrustedInputs).not.toContain("Elm St");
    });

    it("control-strips, redacts and truncates capture text, in that order", () => {
      const [capture] = build.context.open_loops.inbox.captures;
      expect(capture).toMatchObject({
        status: "needs_confirm",
        captured_local: "2026-09-14 08:00",
      });
      expect(capture!.text).toBe("remind me to rotate [secret removed] before friday");
      expect(capture!.text).not.toContain("gsk_");
      expect(capture!.text).not.toContain(BELL);
    });

    it("cites each project row as the PROJECT itself, naming its next action in the detail, with honest totals", () => {
      const c = build.context;
      expect(c.open_loops.stalled_projects).toEqual({
        items: [
          {
            ref: expect.any(Number) as number,
            name: "Stalled garage",
            open_task_count: 1,
            overdue_task_count: 0,
            next_action: "Clear the shelves",
          },
        ],
        total: 1,
      });
      const citation = build.citations.find((x) => x.section === "project")!;
      expect(citation).toMatchObject({
        type: "project",
        id: seeded.stalledProjectId,
        title: "Stalled garage",
        detail: "stalled · 1 open · next: Clear the shelves",
      });
      // "Empty project" has no next action -> cited as the PROJECT itself so
      // the row is present and navigable (/projects/:id).
      expect(c.open_loops.projects_without_next_action.items.map((row) => row.name)).toEqual([
        "Empty project",
      ]);
      expect(c.open_loops.projects_without_next_action.total).toBe(1);
      const noNext = build.citations.find((x) => x.title === "Empty project")!;
      expect(noNext).toMatchObject({
        type: "project",
        section: "project",
        detail: "no next action · 0 open",
      });
      expect(c.summary.active_project_count).toBe(3);
    });

    it("citations carry the task id (never the occurrence id), event instances carry occurs_at, and details are bounded", () => {
      const bySection = (s: string) => build.citations.filter((x) => x.section === s);
      expect(bySection("overdue")).toEqual([
        {
          ref: 1,
          type: "task",
          id: seeded.overdueTaskId,
          title: "Renew passport at the office",
          section: "overdue",
          // No redundant "overdue": the client renders the section label.
          detail: "P1",
        },
      ]);
      const chore = bySection("due_today").find((x) => x.title === "Water the plants")!;
      expect(chore.id).toBe(seeded.recurringTaskId);
      expect(chore.id).not.toBe(seeded.snoozedOccurrenceId);
      expect(chore.detail).toBe("due 17:00");
      expect(bySection("due_today").find((x) => x.title === "Call the dentist")!.detail).toBe(
        "due 15:00",
      );
      expect(bySection("due_today").find((x) => x.title === "Clear the shelves")!.detail).toBe(
        "due today",
      );
      const eventCitations = bySection("event");
      expect(eventCitations.map((x) => [x.type, x.id, x.detail]).sort()).toEqual(
        [
          ["event", seeded.localEventId, "11:00"],
          ["event", seeded.externalEventId, "all-day"],
        ].sort(),
      );
      for (const e of eventCitations) expect(e).toHaveProperty("occurs_at");
      const upcomingEvent = bySection("upcoming").find((x) => x.type === "event")!;
      expect(upcomingEvent).toMatchObject({
        id: seeded.upcomingExternalEventId,
        detail: "2026-09-16",
      });
      expect(bySection("reminder").map((x) => x.detail)).toEqual([
        "reminder 17:00 · repeats",
        "reminder 09-15 07:30 · repeats",
      ]);
      expect(bySection("completed")).toEqual([
        expect.objectContaining({
          type: "task",
          id: seeded.completedTaskId,
          detail: "completed 09-13",
        }),
      ]);
      expect(bySection("capture")).toEqual([
        expect.objectContaining({
          type: "inbox_item",
          id: seeded.captureId,
          detail: "needs confirmation",
        }),
      ]);
      expect(bySection("snoozed")).toEqual([
        expect.objectContaining({
          type: "task",
          id: seeded.recurringTaskId,
          detail: "until 09-14 17:00",
        }),
      ]);
      for (const citation of build.citations) {
        expect(citation.detail === undefined || citation.detail.length <= 80).toBe(true);
      }
    });

    it("serializes no uuid, no ISO instant, no description and no rrule", () => {
      expect(build.serialized).not.toMatch(UUID_RE);
      expect(build.serialized).not.toMatch(ISO_INSTANT_RE);
      expect(build.serialized).not.toContain("insurance card");
      expect(build.serialized).not.toContain("passcode");
      expect(build.serialized).not.toContain("FREQ=");
      expect(build.serialized).not.toContain("_id");
      expect(build.serialized).not.toContain('_at"');
    });

    it("uses one effectiveNow shared with buildTodayResponse", async () => {
      const today = await buildTodayResponse(app.db, { tz: TZ }, { now: NOW });
      expect(build.context.summary).toEqual(today.summary);
      expect(build.context.local_date).toBe(today.local_date);
    });
  });

  describe("when the ladder drops sections", () => {
    it("keeps lastRef at the highest ordinal ever assigned, above every surviving citation", async () => {
      const long = (n: number): string => `${n} `.padEnd(118, "x");
      for (let i = 0; i < 8; i++) {
        await app.db.insert(tasks).values({
          title: long(i),
          status: "active",
          timezone: TZ,
          priority: 1,
          dueAt: new Date("2026-09-13T15:00:00Z"),
        });
      }
      for (let i = 0; i < 10; i++) {
        await app.db.insert(tasks).values({
          title: long(100 + i),
          status: "active",
          timezone: TZ,
          dueAt: new Date("2026-09-14T20:00:00Z"),
          remindAt: new Date("2026-09-14T19:00:00Z"),
        });
      }
      for (let i = 0; i < 10; i++) {
        await app.db.insert(tasks).values({
          title: long(200 + i),
          status: "done",
          timezone: TZ,
          completedAt: new Date("2026-09-13T12:00:00Z"),
        });
      }
      for (let i = 0; i < 5; i++) {
        await app.db.insert(inboxItems).values({
          rawText: `capture ${i} `.padEnd(160, "z"),
          source: "web",
          capturedAt: new Date("2026-09-14T13:00:00Z"),
          timezone: TZ,
          status: "needs_confirm",
        });
      }
      for (let i = 0; i < 8; i++) {
        await app.db.insert(events).values({
          title: long(300 + i),
          location: "y".repeat(80),
          timezone: TZ,
          startsAt: new Date("2026-09-14T16:00:00Z"),
          endsAt: new Date("2026-09-14T17:00:00Z"),
          origin: "local",
        });
      }

      const build = await buildTodayContext(await ctx());
      expect(build.droppedSections.length).toBeGreaterThan(0);
      expect(build.chars).toBeLessThanOrEqual(TODAY_CONTEXT_MAX_CHARS);
      const surviving = build.citations.map((c) => c.ref);
      expect(surviving.length).toBeGreaterThan(0);
      expect(build.lastRef).toBeGreaterThanOrEqual(Math.max(...surviving));
      // The citations that were dropped took their ordinals with them, so the
      // surviving set is strictly smaller than the ordinal space.
      expect(build.lastRef).toBeGreaterThan(surviving.length - 1);
      // Every kept citation still resolves to a present ref.
      expect([...surviving].sort((a, b) => a - b)).toEqual(refsInOrder(build.context));
    });

    it("keeps only the untrusted strings the surviving context still carries", async () => {
      await app.db.insert(events).values({
        title: "Stranger standup",
        location: "Somewhere else",
        timezone: TZ,
        startsAt: new Date("2026-09-16T18:00:00Z"),
        endsAt: new Date("2026-09-16T19:00:00Z"),
      });
      const build = await buildTodayContext(await ctx());
      // An upcoming external event contributes its title (which the prompt
      // carries) but not its location (which the upcoming row has no field for).
      expect(build.untrustedInputs).toContain("Stranger standup");
      expect(build.untrustedInputs).not.toContain("Somewhere else");
    });
  });

  describe("wall clocks in other zones", () => {
    it("formats in the request zone, including a non-hour offset", async () => {
      await app.db.insert(tasks).values({
        title: "Kolkata call",
        status: "active",
        timezone: "Asia/Kolkata",
        dueAt: new Date("2026-09-14T18:45:00Z"), // 00:15 IST on the 15th
      });
      const build = await buildTodayContext(await ctx("Asia/Kolkata", NOW));
      expect(build.context.now_local).toBe("2026-09-14 20:00");
      // Due tomorrow in Kolkata's local calendar, so it is an upcoming row.
      expect(build.context.upcoming.items.map((i) => [i.date, i.title])).toEqual([
        ["2026-09-15", "Kolkata call"],
      ]);
    });
  });

  describe("origin on TodayEventItem", () => {
    it("buildTodayResponse surfaces events.origin", async () => {
      await app.db.insert(events).values({
        title: "Local one",
        timezone: TZ,
        startsAt: new Date("2026-09-14T16:00:00Z"),
        endsAt: new Date("2026-09-14T17:00:00Z"),
        origin: "local",
      });
      await app.db.insert(events).values({
        title: "External one",
        timezone: TZ,
        startsAt: new Date("2026-09-14T18:00:00Z"),
        endsAt: new Date("2026-09-14T19:00:00Z"),
      });
      const today = await buildTodayResponse(app.db, { tz: TZ }, { now: NOW });
      expect(today.events_today.items.map((i) => [i.title, i.origin])).toEqual([
        ["Local one", "local"],
        ["External one", "external"],
      ]);
    });
  });
});

// ---------------------------------------------------------------------------
// The drop ladder, on a synthetic stress fixture (no database): max-length
// titles in every section at every cap, which is the worst case the schema
// permits.
// ---------------------------------------------------------------------------

describe("the drop ladder", () => {
  const LONG = "x".repeat(120);
  const LOC = "y".repeat(80);

  function stress(): TodayContext {
    let ref = 0;
    const next = (): number => {
      ref += 1;
      return ref;
    };
    const task = () => ({
      ref: next(),
      title: LONG,
      due_local: "2026-09-14 09:00",
      project: LONG,
      priority: 1,
      recurring: true,
      has_reminder: true,
      snoozed: true,
    });
    const overdue = Array.from({ length: TODAY_CONTEXT_CAPS.overdue }, task);
    const dueToday = Array.from({ length: TODAY_CONTEXT_CAPS.due_today }, task);
    const eventsToday = Array.from({ length: TODAY_CONTEXT_CAPS.events_today }, () => ({
      ref: next(),
      title: LONG,
      starts_local: "2026-09-14 09:00",
      date: null,
      all_day: false,
      location: LOC,
    }));
    const upcoming = Array.from({ length: TODAY_CONTEXT_CAPS.upcoming }, () => ({
      ref: next(),
      date: "2026-09-15",
      kind: "task" as const,
      title: LONG,
    }));
    const reminders = Array.from({ length: TODAY_CONTEXT_CAPS.reminders }, () => ({
      ref: next(),
      title: LONG,
      remind_local: "2026-09-14 09:00",
      due_local: "2026-09-14 09:00",
      recurring: true,
    }));
    const completed = Array.from({ length: TODAY_CONTEXT_CAPS.recently_completed }, () => ({
      ref: next(),
      title: LONG,
      completed_local: "2026-09-14 09:00",
    }));
    const captures = Array.from({ length: TODAY_CONTEXT_CAPS.captures }, () => ({
      ref: next(),
      text: "z".repeat(160),
      status: "needs_confirm" as const,
      captured_local: "2026-09-14 09:00",
    }));
    const stalled = Array.from({ length: TODAY_CONTEXT_CAPS.stalled_projects }, () => ({
      ref: next(),
      name: LONG,
      open_task_count: 3,
      overdue_task_count: 1,
      next_action: LONG,
    }));
    const noNext = Array.from({ length: TODAY_CONTEXT_CAPS.projects_without_next_action }, () => ({
      ref: next(),
      name: LONG,
    }));
    const snoozed = Array.from({ length: TODAY_CONTEXT_CAPS.snoozed }, () => ({
      ref: next(),
      title: LONG,
      snoozed_until_local: "2026-09-14 09:00",
    }));
    return TodayContextSchema.parse({
      local_date: "2026-09-14",
      tz: "America/Chicago",
      now_local: "2026-09-14 09:30",
      summary: {
        overdue_total: 30,
        due_today_total: 40,
        inbox_attention_total: 9,
        active_project_count: 12,
      },
      overdue: { items: overdue, total: 30 },
      due_today: { items: dueToday, total: 40 },
      upcoming: { items: upcoming, total: 50 },
      events_today: { items: eventsToday, total: 20 },
      reminders: { items: reminders, total: 25, horizon_days: 7 },
      recently_completed: { items: completed, total: 60 },
      projects_touched: Array.from({ length: 5 }, () => ({
        name: LONG,
        last_activity_local: "2026-09-14 09:00",
      })),
      open_loops: {
        inbox: { pending_count: 3, needs_confirm_count: 4, failed_count: 2, captures },
        stalled_projects: { items: stalled, total: 9 },
        projects_without_next_action: { items: noNext, total: 7 },
        snoozed_within_horizon: { items: snoozed, total: 11 },
        reviews: { daily_status: "in_progress", weekly_status: null },
      },
    });
  }

  it("the stress fixture really exceeds the ceiling", () => {
    expect(JSON.stringify(stress()).length).toBeGreaterThan(TODAY_CONTEXT_MAX_CHARS);
  });

  it("drops in the documented order, keeps totals, stays ≤ 12000 chars and still parses", () => {
    const context = stress();
    const dropped = __testing.applyDropLadder(context, __testing.protectedSections(undefined));
    expect(JSON.stringify(context).length).toBeLessThanOrEqual(TODAY_CONTEXT_MAX_CHARS);
    expect(() => TodayContextSchema.parse(context)).not.toThrow();
    // Order: recently_completed → reminders → open-loop lists → upcoming → then trims.
    expect(dropped.slice(0, 2)).toEqual(["recently_completed", "reminders"]);
    const openLoops = [
      "open_loops.inbox.captures",
      "open_loops.stalled_projects",
      "open_loops.projects_without_next_action",
      "open_loops.snoozed_within_horizon",
    ];
    for (const name of dropped) {
      if (openLoops.includes(name)) expect(dropped.indexOf(name)).toBeGreaterThan(1);
      if (name === "upcoming") {
        for (const o of openLoops.filter((x) => dropped.includes(x))) {
          expect(dropped.indexOf(o)).toBeLessThan(dropped.indexOf(name));
        }
      }
    }
    // Totals survive every drop.
    expect(context.recently_completed).toEqual({ items: [], total: 60 });
    expect(context.reminders.total).toBe(25);
    expect(context.open_loops.snoozed_within_horizon.total).toBe(11);
    expect(context.upcoming.total).toBe(50);
    expect(context.overdue.total).toBe(30);
  });

  it("never touches the section the preset targets", () => {
    const focus = stress();
    __testing.applyDropLadder(focus, __testing.protectedSections("focus"));
    expect(JSON.stringify(focus).length).toBeLessThanOrEqual(TODAY_CONTEXT_MAX_CHARS);
    expect(focus.overdue.items).toHaveLength(TODAY_CONTEXT_CAPS.overdue);
    expect(focus.due_today.items).toHaveLength(TODAY_CONTEXT_CAPS.due_today);

    const slipping = stress();
    const droppedSlipping = __testing.applyDropLadder(
      slipping,
      __testing.protectedSections("slipping"),
    );
    expect(JSON.stringify(slipping).length).toBeLessThanOrEqual(TODAY_CONTEXT_MAX_CHARS);
    expect(slipping.overdue.items).toHaveLength(TODAY_CONTEXT_CAPS.overdue);
    expect(slipping.open_loops.inbox.captures).toHaveLength(TODAY_CONTEXT_CAPS.captures);
    expect(slipping.open_loops.stalled_projects.items).toHaveLength(
      TODAY_CONTEXT_CAPS.stalled_projects,
    );
    expect(slipping.open_loops.snoozed_within_horizon.items).toHaveLength(
      TODAY_CONTEXT_CAPS.snoozed,
    );
    expect(droppedSlipping).not.toContain("overdue");
    expect(droppedSlipping.some((d) => d.startsWith("open_loops."))).toBe(false);

    const tomorrow = stress();
    const droppedTomorrow = __testing.applyDropLadder(
      tomorrow,
      __testing.protectedSections("tomorrow"),
    );
    expect(JSON.stringify(tomorrow).length).toBeLessThanOrEqual(TODAY_CONTEXT_MAX_CHARS);
    expect(tomorrow.upcoming.items).toHaveLength(TODAY_CONTEXT_CAPS.upcoming);
    expect(droppedTomorrow).not.toContain("upcoming");
  });

  it("trims the largest core section one item at a time when the whole ladder is not enough", () => {
    const context = stress();
    // Protect the three big droppable sections (no preset does this; it is
    // the only way to force the trim loop, since the three core sections
    // alone can never exceed the ceiling at their caps).
    const protectedSet = new Set(["recently_completed", "reminders", "upcoming"]);
    const dropped = __testing.applyDropLadder(context, protectedSet);
    expect(JSON.stringify(context).length).toBeLessThanOrEqual(TODAY_CONTEXT_MAX_CHARS);
    expect(context.recently_completed.items).toHaveLength(TODAY_CONTEXT_CAPS.recently_completed);
    expect(context.reminders.items).toHaveLength(TODAY_CONTEXT_CAPS.reminders);
    expect(context.upcoming.items).toHaveLength(TODAY_CONTEXT_CAPS.upcoming);
    expect(dropped).toEqual([
      "open_loops.inbox.captures",
      "open_loops.stalled_projects",
      "open_loops.projects_without_next_action",
      "open_loops.snoozed_within_horizon",
    ]);
    // due_today (10) was the largest, so it lost items first; taking one
    // item at a time from the largest keeps the three within one of each other.
    const lengths = [
      context.overdue.items.length,
      context.due_today.items.length,
      context.events_today.items.length,
    ];
    expect(context.due_today.items.length).toBeLessThan(TODAY_CONTEXT_CAPS.due_today);
    expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThanOrEqual(1);
    expect(lengths.every((n) => n > 0)).toBe(true);
    expect(context.due_today.total).toBe(40);
  });

  it("enforces the ceiling even when a preset protects everything and JSON escaping inflates it", () => {
    // `"` serializes as `\"`, so a title of 120 quotes measures 240 chars.
    // With every unprotected section already emptied and the preset's own
    // sections untouchable, the preference must yield: the ceiling is the
    // contract. Without the last-resort pass this loops out over the limit.
    const quoted = (): TodayContext => {
      const context = stress();
      const q = '"'.repeat(120);
      for (const item of context.overdue.items) {
        item.title = q;
        item.project = q;
      }
      for (const item of context.due_today.items) {
        item.title = q;
        item.project = q;
      }
      for (const item of context.events_today.items) {
        item.title = q;
        item.location = '"'.repeat(80);
      }
      for (const item of context.upcoming.items) item.title = q;
      for (const item of context.reminders.items) item.title = q;
      for (const item of context.recently_completed.items) item.title = q;
      for (const item of context.open_loops.inbox.captures) item.text = '"'.repeat(160);
      for (const item of context.open_loops.stalled_projects.items) {
        item.name = q;
        item.next_action = q;
      }
      for (const item of context.open_loops.projects_without_next_action.items) item.name = q;
      for (const item of context.open_loops.snoozed_within_horizon.items) item.title = q;
      for (const p of context.projects_touched) p.name = q;
      return context;
    };

    expect(JSON.stringify(quoted()).length).toBeGreaterThan(TODAY_CONTEXT_MAX_CHARS * 2);

    for (const preset of [undefined, "focus", "slipping", "tomorrow"] as const) {
      const context = quoted();
      __testing.applyDropLadder(context, __testing.protectedSections(preset));
      const chars = JSON.stringify(context).length;
      expect(
        chars,
        `preset ${String(preset)} exceeded the ceiling at ${chars} chars`,
      ).toBeLessThanOrEqual(TODAY_CONTEXT_MAX_CHARS);
      expect(() => TodayContextSchema.parse(context)).not.toThrow();
      // Totals still tell the truth about what was cut.
      expect(context.overdue.total).toBe(30);
      expect(context.due_today.total).toBe(40);
    }
  });

  it("leaves a context under the ceiling untouched", () => {
    const context = stress();
    context.overdue.items = [];
    context.due_today.items = [];
    context.events_today.items = [];
    context.upcoming.items = [];
    context.reminders.items = [];
    context.recently_completed.items = [];
    const before = JSON.stringify(context);
    expect(__testing.applyDropLadder(context, new Set())).toEqual([]);
    expect(JSON.stringify(context)).toBe(before);
  });

  it("collectRefs and computeIsEmpty agree with the fixture", () => {
    const full = stress();
    expect(__testing.collectRefs(full).size).toBe(
      TODAY_CONTEXT_CAPS.overdue +
        TODAY_CONTEXT_CAPS.due_today +
        TODAY_CONTEXT_CAPS.events_today +
        TODAY_CONTEXT_CAPS.upcoming +
        TODAY_CONTEXT_CAPS.reminders +
        TODAY_CONTEXT_CAPS.recently_completed +
        TODAY_CONTEXT_CAPS.captures +
        TODAY_CONTEXT_CAPS.stalled_projects +
        TODAY_CONTEXT_CAPS.projects_without_next_action +
        TODAY_CONTEXT_CAPS.snoozed,
    );
    expect(__testing.computeIsEmpty(full)).toBe(false);
  });
});
