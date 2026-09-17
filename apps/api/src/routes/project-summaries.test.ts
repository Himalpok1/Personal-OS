import {
  canvasAssignments,
  canvasConnections,
  canvasCourses,
  events,
  inboxItems,
  notes,
  occurrences,
  projects,
  tasks,
} from "@personal-os/db";
import {
  ProjectContextResponseSchema,
  ProjectDetailResponseSchema,
  ProjectSummaryListResponseSchema,
} from "@personal-os/schema";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const TZ = "America/Chicago";

// Well clear of the 14-day stall horizon so "stale"/"fresh"/"upcoming" stay
// unambiguous regardless of request latency.
function staleInstant(): Date {
  return new Date(Date.now() - 30 * DAY_MS);
}
function freshInstant(): Date {
  return new Date(Date.now() - 1 * HOUR_MS);
}

describe("project summaries + detail read models", () => {
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

  async function seedProject(values: Partial<typeof projects.$inferInsert> = {}) {
    const [row] = await app.db
      .insert(projects)
      .values({ name: "P", ...values })
      .returning();
    return row!;
  }

  async function seedTask(values: Partial<typeof tasks.$inferInsert> = {}) {
    const [row] = await app.db
      .insert(tasks)
      .values({ title: "T", timezone: TZ, ...values })
      .returning();
    return row!;
  }

  async function seedNote(values: Partial<typeof notes.$inferInsert> = {}) {
    const [row] = await app.db
      .insert(notes)
      .values({ title: "N", body: "B", ...values })
      .returning();
    return row!;
  }

  async function seedEvent(values: Partial<typeof events.$inferInsert> = {}) {
    const [row] = await app.db
      .insert(events)
      .values({ title: "E", timezone: TZ, ...values })
      .returning();
    return row!;
  }

  async function seedInboxItem(values: Partial<typeof inboxItems.$inferInsert> = {}) {
    const [row] = await app.db
      .insert(inboxItems)
      .values({
        rawText: "raw",
        source: "web",
        capturedAt: new Date(),
        timezone: TZ,
        status: "confirmed",
        ...values,
      })
      .returning();
    return row!;
  }

  async function seedOccurrence(
    parentType: "task" | "event",
    parentId: string,
    occursAt: Date,
    extra: { status?: string; completedAt?: Date } = {},
  ) {
    const [row] = await app.db
      .insert(occurrences)
      .values({
        parentType,
        parentId,
        occursAt,
        occursLocal: occursAt,
        ...(extra.status !== undefined && { status: extra.status }),
        ...(extra.completedAt !== undefined && { completedAt: extra.completedAt }),
      })
      .returning();
    return row!;
  }

  // Active project with one open task whose every activity signal is long
  // cold -- the canonical stalled baseline for the truth-table tests below.
  async function seedStaleActiveProject(name = "Stale") {
    const stale = staleInstant();
    const project = await seedProject({ name });
    await seedTask({
      projectId: project.id,
      status: "active",
      createdAt: stale,
      updatedAt: stale,
    });
    return project;
  }

  async function getSummaries(includeArchived = false) {
    const response = await app.inject({
      method: "GET",
      url: `/projects/summaries${includeArchived ? "?include_archived=true" : ""}`,
    });
    expect(response.statusCode).toBe(200);
    return ProjectSummaryListResponseSchema.parse(response.json());
  }

  async function summaryOf(projectId: string, includeArchived = true) {
    const body = await getSummaries(includeArchived);
    const item = body.items.find((item) => item.id === projectId);
    expect(item, `summary item for ${projectId}`).toBeDefined();
    return item!;
  }

  describe("GET /projects/summaries -- shape and ordering", () => {
    it("returns an empty envelope on an empty database", async () => {
      const body = await getSummaries();
      expect(body.items).toEqual([]);
    });

    it("group-ranks active < paused < completed < archived, name ASC within groups", async () => {
      await seedProject({ name: "Beta" });
      await seedProject({ name: "Alpha" });
      await seedProject({ name: "Zed", status: "paused" });
      await seedProject({ name: "Mid", status: "completed", completedAt: new Date() });
      await seedProject({ name: "Aardvark", archivedAt: new Date() });

      const archivedIncluded = await getSummaries(true);
      expect(archivedIncluded.items.map((item) => item.name)).toEqual([
        "Alpha",
        "Beta",
        "Zed",
        "Mid",
        "Aardvark",
      ]);
      expect(archivedIncluded.items.map((item) => item.status)).toEqual([
        "active",
        "active",
        "paused",
        "completed",
        "active",
      ]);

      const defaultList = await getSummaries(false);
      expect(defaultList.items.map((item) => item.name)).toEqual(["Alpha", "Beta", "Zed", "Mid"]);
    });

    it("honors an explicit include_archived=false query param", async () => {
      await seedProject({ name: "Kept" });
      await seedProject({ name: "Gone", archivedAt: new Date() });
      const response = await app.inject({
        method: "GET",
        url: "/projects/summaries?include_archived=false",
      });
      expect(response.statusCode).toBe(200);
      const body = ProjectSummaryListResponseSchema.parse(response.json());
      expect(body.items.map((item) => item.name)).toEqual(["Kept"]);
    });

    it("reports zero aggregates and never-stalled for a bare active project", async () => {
      const project = await seedProject({ name: "Bare" });
      const item = await summaryOf(project.id);
      expect(item.counts).toEqual({ open: 0, done: 0, overdue: 0 });
      expect(item.next_action).toBeNull();
      expect(item.stalled).toBe(false); // no open task => never stalled
      expect(item.last_activity_at).toBeNull();
    });
  });

  describe("GET /projects/summaries -- next_action", () => {
    it("orders by due_at ascending with nulls last", async () => {
      const project = await seedProject({ name: "Ordering" });
      const late = await seedTask({
        projectId: project.id,
        status: "active",
        dueAt: new Date(Date.now() + 5 * HOUR_MS),
      });
      const soon = await seedTask({
        projectId: project.id,
        status: "active",
        dueAt: new Date(Date.now() + 1 * HOUR_MS),
      });
      await seedTask({ projectId: project.id, status: "inbox" }); // null due

      const item = await summaryOf(project.id);
      expect(item.next_action?.task_id).toBe(soon.id);
      expect(item.next_action?.task_id).not.toBe(late.id);
      expect(item.next_action?.due_at).toBe(soon.dueAt!.toISOString());
    });

    it("prefers the lower priority number when due dates tie", async () => {
      const project = await seedProject({ name: "Priority" });
      const sharedDue = new Date(Date.now() + 2 * HOUR_MS);
      const lowWins = await seedTask({
        projectId: project.id,
        status: "active",
        dueAt: sharedDue,
        priority: 2,
      });
      await seedTask({
        projectId: project.id,
        status: "active",
        dueAt: sharedDue,
        priority: 9,
      });

      const item = await summaryOf(project.id);
      expect(item.next_action?.task_id).toBe(lowWins.id);
      expect(item.next_action?.priority).toBe(2);
    });

    it("breaks due+priority ties by newest creation, then deterministically by id", async () => {
      const project = await seedProject({ name: "Tiebreak" });
      const sharedDue = new Date(Date.now() + 2 * HOUR_MS);
      const sharedCreated = new Date("2026-08-01T00:00:00Z");

      await seedTask({
        projectId: project.id,
        status: "active",
        dueAt: sharedDue,
        priority: 3,
        createdAt: sharedCreated,
        updatedAt: sharedCreated,
      });
      const newer = await seedTask({
        projectId: project.id,
        status: "active",
        dueAt: sharedDue,
        priority: 3,
        createdAt: new Date(sharedCreated.getTime() + HOUR_MS),
        updatedAt: new Date(sharedCreated.getTime() + HOUR_MS),
      });
      expect((await summaryOf(project.id)).next_action?.task_id).toBe(newer.id);

      // Fully identical timestamps -> stable lexicographic id winner.
      await truncateTestTables(app);
      const freshProject = await seedProject({ name: "FullTie" });
      const a = await seedTask({
        projectId: freshProject.id,
        status: "active",
        dueAt: sharedDue,
        priority: 3,
        createdAt: sharedCreated,
        updatedAt: sharedCreated,
      });
      const b = await seedTask({
        projectId: freshProject.id,
        status: "active",
        dueAt: sharedDue,
        priority: 3,
        createdAt: sharedCreated,
        updatedAt: sharedCreated,
      });
      const expected = [a.id, b.id].sort()[0];
      expect((await summaryOf(freshProject.id)).next_action?.task_id).toBe(expected);
    });

    it("excludes done, dropped, and archived tasks from next_action candidacy", async () => {
      const project = await seedProject({ name: "Eligibility" });
      const ancientDue = new Date(Date.now() - 72 * HOUR_MS);
      await seedTask({
        projectId: project.id,
        status: "done",
        dueAt: ancientDue,
        completedAt: freshInstant(),
      });
      await seedTask({ projectId: project.id, status: "dropped", dueAt: ancientDue });
      await seedTask({
        projectId: project.id,
        status: "active",
        dueAt: ancientDue,
        archivedAt: staleInstant(),
      });
      const eligible = await seedTask({
        projectId: project.id,
        status: "inbox",
        dueAt: new Date(Date.now() + HOUR_MS),
      });

      const item = await summaryOf(project.id);
      expect(item.next_action?.task_id).toBe(eligible.id);
      expect(item.counts).toEqual({ open: 1, done: 1, overdue: 0 });
    });
  });

  describe("GET /projects/summaries -- counts", () => {
    it("counts a recurring parent overdue exactly once despite multiple past scheduled occurrences", async () => {
      const project = await seedProject({ name: "Recurring" });
      const parent = await seedTask({
        projectId: project.id,
        status: "active",
        rrule: "FREQ=DAILY;INTERVAL=1",
        recurrenceAnchor: "due_date",
        recurrenceTimezone: TZ,
      });
      await seedOccurrence("task", parent.id, new Date(Date.now() - 2 * HOUR_MS));
      await seedOccurrence("task", parent.id, new Date(Date.now() - 1 * HOUR_MS));
      await seedTask({
        projectId: project.id,
        status: "active",
        dueAt: new Date(Date.now() - 3 * HOUR_MS),
      });

      const item = await summaryOf(project.id);
      // Two eligible tasks, each overdue once -- never parent+occurrence math.
      expect(item.counts.open).toBe(2);
      expect(item.counts.overdue).toBe(2);
    });

    it("does not count future-only or skipped occurrences as overdue", async () => {
      const project = await seedProject({ name: "FutureOnly" });
      const futureParent = await seedTask({
        projectId: project.id,
        status: "active",
        rrule: "FREQ=DAILY;INTERVAL=1",
        recurrenceAnchor: "due_date",
        recurrenceTimezone: TZ,
      });
      await seedOccurrence("task", futureParent.id, new Date(Date.now() + 5 * HOUR_MS));

      const skippedProject = await seedProject({ name: "SkippedOnly" });
      const skippedParent = await seedTask({
        projectId: skippedProject.id,
        status: "active",
        rrule: "FREQ=DAILY;INTERVAL=1",
        recurrenceAnchor: "due_date",
        recurrenceTimezone: TZ,
      });
      await seedOccurrence("task", skippedParent.id, new Date(Date.now() - 1 * HOUR_MS), {
        status: "skipped",
      });

      expect((await summaryOf(project.id)).counts.overdue).toBe(0);
      expect((await summaryOf(skippedProject.id)).counts.overdue).toBe(0);
    });

    it("separates open (inbox+active) from done and ignores archived tasks entirely", async () => {
      const project = await seedProject({ name: "Buckets" });
      await seedTask({ projectId: project.id, status: "inbox" });
      await seedTask({ projectId: project.id, status: "active" });
      await seedTask({
        projectId: project.id,
        status: "done",
        completedAt: freshInstant(),
      });
      await seedTask({
        projectId: project.id,
        status: "done",
        completedAt: freshInstant(),
        archivedAt: freshInstant(),
      }); // archived done: invisible to every bucket

      const item = await summaryOf(project.id);
      expect(item.counts).toEqual({ open: 2, done: 1, overdue: 0 });
    });
  });

  describe("GET /projects/summaries -- stalled truth table", () => {
    it.each([
      [
        "a fresh task write",
        async (projectId: string) => {
          await seedTask({
            projectId,
            status: "inbox",
            createdAt: freshInstant(),
            updatedAt: freshInstant(),
          });
        },
      ],
      [
        "a fresh task completion",
        async (projectId: string) => {
          await seedTask({
            projectId,
            status: "done",
            createdAt: staleInstant(),
            updatedAt: staleInstant(),
            completedAt: freshInstant(),
          });
        },
      ],
      [
        "a fresh note write",
        async (projectId: string) => {
          await seedNote({
            projectId,
            createdAt: freshInstant(),
            updatedAt: freshInstant(),
          });
        },
      ],
      [
        "a fresh occurrence completion on an archived parent task",
        async (projectId: string) => {
          const archivedParent = await seedTask({
            projectId,
            status: "active",
            archivedAt: staleInstant(),
            createdAt: staleInstant(),
            updatedAt: staleInstant(),
          });
          await seedOccurrence("task", archivedParent.id, staleInstant(), {
            status: "done",
            completedAt: freshInstant(),
          });
        },
      ],
      [
        "an upcoming template event",
        async (projectId: string) => {
          await seedEvent({
            projectId,
            startsAt: new Date(Date.now() + 3 * DAY_MS),
            endsAt: new Date(Date.now() + 3 * DAY_MS + HOUR_MS),
          });
        },
      ],
      [
        "an upcoming scheduled event occurrence",
        async (projectId: string) => {
          const series = await seedEvent({
            projectId,
            rrule: "FREQ=WEEKLY;INTERVAL=1",
            startsAt: staleInstant(),
          });
          await seedOccurrence("event", series.id, new Date(Date.now() + 3 * DAY_MS));
        },
      ],
    ])("is not stalled after %s", async (_label, rescuer) => {
      const project = await seedStaleActiveProject();
      await rescuer(project.id);
      expect(await summaryOf(project.id, false)).toMatchObject({ stalled: false });
    });

    it.each([
      [
        "a past template event",
        async (projectId: string) => {
          await seedEvent({ projectId, startsAt: new Date(Date.now() - 3 * DAY_MS) });
        },
      ],
      [
        "an event beyond the 14-day stall horizon",
        async (projectId: string) => {
          await seedEvent({ projectId, startsAt: new Date(Date.now() + 20 * DAY_MS) });
        },
      ],
    ])("remains stalled when the only signal is %s", async (_label, nonRescuer) => {
      const project = await seedStaleActiveProject();
      await nonRescuer(project.id);
      expect(await summaryOf(project.id, false)).toMatchObject({ stalled: true });
    });

    it("marks a fully cold active project with an open task as stalled", async () => {
      const project = await seedStaleActiveProject();
      const item = await summaryOf(project.id, false);
      expect(item.stalled).toBe(true);
      expect(item.counts.open).toBe(1);
    });

    it("never marks paused, completed, or archived projects stalled despite cold signals", async () => {
      const stale = staleInstant();
      const paused = await seedProject({ name: "Paused", status: "paused" });
      const completed = await seedProject({
        name: "Done",
        status: "completed",
        completedAt: stale,
      });
      const archived = await seedProject({ name: "Archived", archivedAt: stale });
      for (const project of [paused, completed, archived]) {
        await seedTask({
          projectId: project.id,
          status: "active",
          createdAt: stale,
          updatedAt: stale,
        });
      }

      const body = await getSummaries(true);
      const byId = new Map(body.items.map((item) => [item.id, item]));
      // Every one of them has an open task and zero fresh signals -- only
      // the status/archival guards keep them out of stalled.
      expect(byId.get(paused.id)!.stalled).toBe(false);
      expect(byId.get(completed.id)!.stalled).toBe(false);
      expect(byId.get(archived.id)!.stalled).toBe(false);
    });
  });

  describe("GET /projects/:id/detail", () => {
    it("404s for an unknown id", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/projects/00000000-0000-4000-8000-000000000001/detail",
      });
      expect(response.statusCode).toBe(404);
      expect(response.json<{ error: string }>().error).toBe("not_found");
    });

    it("works for an archived project (direct fetch is unconditional)", async () => {
      const project = await seedProject({ name: "Archived", archivedAt: new Date() });
      const response = await app.inject({ method: "GET", url: `/projects/${project.id}/detail` });
      expect(response.statusCode).toBe(200);
      const body = ProjectDetailResponseSchema.parse(response.json());
      expect(body.project.archived_at).not.toBeNull();
      expect(body.computed.stalled).toBe(false); // archived is never stalled
    });

    it("returns only this project's tasks/notes/events with honest totals", async () => {
      const mine = await seedProject({ name: "Mine" });
      const other = await seedProject({ name: "Other" });

      const myOpen = await seedTask({
        projectId: mine.id,
        title: "my open",
        status: "active",
        dueAt: new Date(Date.now() + HOUR_MS),
      });
      const myDone = await seedTask({
        projectId: mine.id,
        title: "my done",
        status: "done",
        completedAt: freshInstant(),
      });
      await seedTask({
        projectId: other.id,
        title: "other open",
        status: "active",
        dueAt: new Date(Date.now() + HOUR_MS),
      });

      const myNote = await seedNote({ projectId: mine.id, title: "my note" });
      await seedNote({ projectId: other.id, title: "other note" });

      const myEvent = await seedEvent({
        projectId: mine.id,
        title: "my event",
        startsAt: new Date(),
      });
      await seedEvent({ projectId: other.id, title: "other event", startsAt: new Date() });

      const response = await app.inject({ method: "GET", url: `/projects/${mine.id}/detail` });
      expect(response.statusCode).toBe(200);
      const body = ProjectDetailResponseSchema.parse(response.json());

      expect(body.tasks.items.map((task) => task.id)).toEqual([myOpen.id, myDone.id]);
      expect(body.tasks.total).toBe(2);
      expect(body.notes.items.map((note) => note.id)).toEqual([myNote.id]);
      expect(body.notes.total).toBe(1);
      expect(body.events.items.map((event) => event.id)).toEqual([myEvent.id]);
      expect(body.events.total).toBe(1);

      // Computed section reflects only this project's tasks.
      expect(body.computed.counts).toEqual({ open: 1, done: 1, overdue: 0 });
      expect(body.computed.next_action?.task_id).toBe(myOpen.id);
    });

    it("orders tasks open-first (due asc nulls last, newest-created) then done by completed_at desc", async () => {
      const project = await seedProject({ name: "Sort" });
      // One pinned instant per tie group -- two separate new Date(...) calls
      // would differ by a few ms and make due-asc legitimately reorder them.
      const soonDue = new Date(Date.now() + 1 * HOUR_MS);
      const openNoDue = await seedTask({
        projectId: project.id,
        title: "open no due",
        status: "inbox",
      });
      const openLaterDue = await seedTask({
        projectId: project.id,
        title: "open later due",
        status: "active",
        dueAt: new Date(Date.now() + 5 * HOUR_MS),
      });
      const openSoonDueOlder = await seedTask({
        projectId: project.id,
        title: "open soon due older",
        status: "active",
        dueAt: soonDue,
        createdAt: new Date("2026-07-01T00:00:00Z"),
      });
      const openSoonDueNewer = await seedTask({
        projectId: project.id,
        title: "open soon due newer",
        status: "active",
        dueAt: soonDue,
        createdAt: new Date("2026-08-01T00:00:00Z"),
      });
      const doneOlder = await seedTask({
        projectId: project.id,
        title: "done older",
        status: "done",
        completedAt: new Date(Date.now() - 2 * HOUR_MS),
      });
      const doneNewer = await seedTask({
        projectId: project.id,
        title: "done newer",
        status: "done",
        completedAt: new Date(Date.now() - 1 * HOUR_MS),
      });

      const response = await app.inject({ method: "GET", url: `/projects/${project.id}/detail` });
      const body = ProjectDetailResponseSchema.parse(response.json());
      expect(body.tasks.items.map((task) => task.id)).toEqual([
        openSoonDueNewer.id, // same due -> newer creation first
        openSoonDueOlder.id,
        openLaterDue.id,
        openNoDue.id, // null due last within opens
        doneNewer.id, // closed group by completed desc
        doneOlder.id,
      ]);
    });

    it("lists series rows only -- detached occurrence children never duplicate their series", async () => {
      const project = await seedProject({ name: "Series" });
      const series = await seedEvent({
        projectId: project.id,
        title: "Weekly sync",
        startsAt: staleInstant(),
        rrule: "FREQ=WEEKLY;INTERVAL=1",
      });
      const detached = await seedEvent({
        projectId: project.id,
        title: "Weekly sync (moved)",
        startsAt: new Date(Date.now() + 2 * DAY_MS),
        parentEventId: series.id,
        originalStartAt: staleInstant(),
      });

      const response = await app.inject({ method: "GET", url: `/projects/${project.id}/detail` });
      const body = ProjectDetailResponseSchema.parse(response.json());
      expect(body.events.items.map((event) => event.id)).toEqual([series.id]);
      expect(body.events.total).toBe(1);
      expect(body.events.items[0]!.title).toBe("Weekly sync");
      expect(detached.parentEventId).toBe(series.id); // sanity: child really was attached
    });

    it("excludes archived children from every section and its totals", async () => {
      const project = await seedProject({ name: "ArchivedChildren" });
      await seedTask({ projectId: project.id, status: "active", archivedAt: freshInstant() });
      await seedNote({ projectId: project.id, archivedAt: freshInstant() });
      await seedEvent({ projectId: project.id, startsAt: new Date(), archivedAt: freshInstant() });
      const kept = await seedTask({ projectId: project.id, status: "inbox" });

      const response = await app.inject({ method: "GET", url: `/projects/${project.id}/detail` });
      const body = ProjectDetailResponseSchema.parse(response.json());
      expect(body.tasks.items.map((task) => task.id)).toEqual([kept.id]);
      expect(body.tasks.total).toBe(1);
      expect(body.notes.items).toEqual([]);
      expect(body.notes.total).toBe(0);
      expect(body.events.items).toEqual([]);
      expect(body.events.total).toBe(0);
      expect(body.computed.counts.open).toBe(1); // archived open task not counted
    });

    it("caps sections at 50 items while reporting the honest total", async () => {
      const project = await seedProject({ name: "Truncated" });
      const base = Date.now();
      await app.db.insert(tasks).values(
        Array.from({ length: 55 }, (_, index) => ({
          title: `bulk ${index}`,
          timezone: TZ,
          status: "active",
          projectId: project.id,
          dueAt: new Date(base + index * 60_000),
        })),
      );
      await app.db.insert(notes).values(
        Array.from({ length: 52 }, (_, index) => ({
          title: `note ${index}`,
          body: "b",
          projectId: project.id,
          updatedAt: new Date(base + index * 60_000),
        })),
      );

      const response = await app.inject({ method: "GET", url: `/projects/${project.id}/detail` });
      const body = ProjectDetailResponseSchema.parse(response.json());

      expect(body.tasks.items).toHaveLength(50);
      expect(body.tasks.total).toBe(55);
      // Slice is the head of the frozen ordering: earliest 50 dues ascending.
      const dues = body.tasks.items.map((task) => Date.parse(task.due_at!));
      expect([...dues].sort((a, b) => a - b)).toEqual(dues);
      expect(dues[0]).toBe(base);

      expect(body.notes.items).toHaveLength(50);
      expect(body.notes.total).toBe(52);
      const updates = body.notes.items.map((note) => Date.parse(note.updated_at));
      expect([...updates].sort((a, b) => b - a)).toEqual(updates);
    });
  });

  describe("GET /projects/:id/context (Checkpoint 10.5, ADR-074)", () => {
    // truncateTestTables (beforeEach, above) doesn't clear the Canvas
    // tables -- the same local-cleanup pattern academic.test.ts's own
    // beforeEach uses. Deleting the connection cascades courses/assignments.
    afterEach(async () => {
      await app.db.delete(canvasConnections);
    });

    async function seedAssignment() {
      const [connection] = await app.db
        .insert(canvasConnections)
        .values({
          canvasBaseUrl: `https://${crypto.randomUUID()}.instructure.com`,
          canvasUserId: 1,
          canvasUserName: "Test Student",
          status: "active",
        })
        .returning();
      const [course] = await app.db
        .insert(canvasCourses)
        .values({
          connectionId: connection!.id,
          canvasCourseId: 4315,
          name: "Should never appear in a project response",
        })
        .returning();
      const [assignment] = await app.db
        .insert(canvasAssignments)
        .values({
          connectionId: connection!.id,
          courseId: course!.id,
          canvasAssignmentId: 99001,
          title: "Should also never appear in a project response",
          submissionState: "unsubmitted",
        })
        .returning();
      return assignment!;
    }

    it("404s an unknown project, same as /detail", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/projects/00000000-0000-4000-8000-000000000001/context",
      });
      expect(response.statusCode).toBe(404);
      expect(response.json<{ error: string }>().error).toBe("not_found");
    });

    it("carries the same tasks/events as /detail, plus each task's opaque canvas_assignment_id", async () => {
      const project = await seedProject({ name: "Context" });
      const assignment = await seedAssignment();
      const linked = await seedTask({
        projectId: project.id,
        status: "active",
        canvasAssignmentId: assignment.id,
      });
      const unlinked = await seedTask({ projectId: project.id, status: "active" });
      const event = await seedEvent({ projectId: project.id, startsAt: new Date() });

      const detailRes = await app.inject({ method: "GET", url: `/projects/${project.id}/detail` });
      const detail = ProjectDetailResponseSchema.parse(detailRes.json());

      const contextRes = await app.inject({
        method: "GET",
        url: `/projects/${project.id}/context`,
      });
      expect(contextRes.statusCode).toBe(200);
      const context = ProjectContextResponseSchema.parse(contextRes.json());

      expect(context.tasks.total).toBe(detail.tasks.total);
      expect(context.tasks.items.map((t) => t.id).sort()).toEqual([linked.id, unlinked.id].sort());
      expect(context.events.items.map((e) => e.id)).toEqual([event.id]);
      const linkedItem = context.tasks.items.find((t) => t.id === linked.id);
      const unlinkedItem = context.tasks.items.find((t) => t.id === unlinked.id);
      expect(linkedItem?.canvas_assignment_id).toBe(assignment.id);
      expect(unlinkedItem?.canvas_assignment_id).toBeNull();
    });

    it("PRIVACY BOUNDARY: never surfaces a Canvas-authored title or course name -- only the opaque id", async () => {
      const project = await seedProject({ name: "Privacy" });
      const assignment = await seedAssignment();
      await seedTask({
        projectId: project.id,
        status: "active",
        canvasAssignmentId: assignment.id,
      });

      const response = await app.inject({ method: "GET", url: `/projects/${project.id}/context` });
      const raw = JSON.stringify(response.json());
      expect(raw).not.toContain("Should never appear in a project response");
      expect(raw).not.toContain("Should also never appear in a project response");
      expect(raw).toContain(assignment.id); // the opaque id itself IS expected
    });

    it("related_captures: a capture that became one of this project's items, via the deterministic entity join", async () => {
      const project = await seedProject({ name: "Captures" });
      const other = await seedProject({ name: "Other" });
      const task = await seedTask({ projectId: project.id, status: "active" });
      const otherTask = await seedTask({ projectId: other.id, status: "active" });

      const capture = await seedInboxItem({
        rawText: "call the insurance guy",
        entityType: "task",
        entityId: task.id,
      });
      // Not linked to any entity yet (still pending) -- excluded.
      await seedInboxItem({ entityType: null, entityId: null, status: "pending" });
      // Linked, but to a DIFFERENT project's task -- excluded.
      await seedInboxItem({ entityType: "task", entityId: otherTask.id });
      // Linked to this project's task, but archived -- excluded.
      await seedInboxItem({
        entityType: "task",
        entityId: task.id,
        archivedAt: new Date(),
      });

      const response = await app.inject({ method: "GET", url: `/projects/${project.id}/context` });
      const body = ProjectContextResponseSchema.parse(response.json());
      expect(body.related_captures.total).toBe(1);
      expect(body.related_captures.items).toEqual([
        {
          id: capture.id,
          raw_text: "call the insurance guy",
          source: "web",
          status: "confirmed",
          captured_at: capture.capturedAt.toISOString(),
          entity_type: "task",
          entity_id: task.id,
        },
      ]);
    });

    it("recent_activity: task completions, note writes, occurrence completions -- newest first, 30-day window", async () => {
      const project = await seedProject({ name: "Activity" });
      const now = Date.now();

      const oldTask = await seedTask({
        projectId: project.id,
        status: "done",
        title: "Ancient",
        completedAt: new Date(now - 60 * DAY_MS), // outside the window
      });
      const recentTask = await seedTask({
        projectId: project.id,
        status: "done",
        title: "Recent task",
        completedAt: new Date(now - 2 * DAY_MS),
      });
      const note = await seedNote({
        projectId: project.id,
        title: "Recent note",
        createdAt: new Date(now - 3 * DAY_MS),
        updatedAt: new Date(now - 1 * DAY_MS), // updated after creation -> "Updated"
      });
      const seriesTask = await seedTask({ projectId: project.id, status: "active" });
      const occurrence = await seedOccurrence("task", seriesTask.id, new Date(now), {
        status: "done",
        completedAt: new Date(now - 12 * HOUR_MS),
      });

      const response = await app.inject({ method: "GET", url: `/projects/${project.id}/context` });
      const body = ProjectContextResponseSchema.parse(response.json());

      expect(body.recent_activity.total).toBe(3); // oldTask excluded
      // Newest first: occurrence (-12h) then note (-24h) then task (-48h).
      expect(body.recent_activity.items).toEqual([
        {
          type: "occurrence_completed",
          description: `Completed occurrence of "${seriesTask.title}"`,
          at: occurrence.completedAt!.toISOString(),
        },
        {
          type: "note_written",
          description: 'Updated note "Recent note"',
          at: note.updatedAt.toISOString(),
        },
        {
          type: "task_completed",
          description: 'Completed task "Recent task"',
          at: recentTask.completedAt!.toISOString(),
        },
      ]);
      expect(JSON.stringify(body.recent_activity)).not.toContain(oldTask.title);
    });
  });
});
