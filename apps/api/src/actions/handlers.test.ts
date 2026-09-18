import {
  calendarConnectionCalendars,
  calendarConnections,
  canvasAssignments,
  canvasConnections,
  canvasCourses,
  eventExternalLinks,
  events,
  occurrences,
  projects,
  tasks,
} from "@personal-os/db";
import {
  ACTION_IDS,
  ACTION_INPUT_SCHEMAS,
  ACTION_SUMMARY_MAX_CHARS,
  type ActionId,
  type ActionInput,
  type EventCalendarTarget,
} from "@personal-os/schema";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CALENDAR_PUSH_EVENT_QUEUE } from "../queue-names.js";
import { resolveWritableCalendar } from "../routes/calendar-targets.js";
import { loadEventLink, resolveWritableCalendarInTx } from "../services/events.js";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import { ACTION_HANDLERS } from "./handlers.js";
import {
  ActionExecutionError,
  ActionValidationError,
  type ActionExecutionResult,
} from "./types.js";

// Checkpoint 10.8 (ADR-078 §2, §4) -- the six action executors, driven
// directly (no route, no action_requests row): `prepare` against app.db the
// way POST /actions calls it, `execute` inside a real transaction the way
// approve calls it. Every write is asserted on the rows themselves.

const TZ = "America/Chicago";
const NOW = new Date("2026-09-17T15:00:00Z");
const REQUEST_ID = "00000000-0000-4000-8000-000000000001";
const MISSING_UUID = "11111111-1111-4111-8111-111111111111";

describe("action handlers", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateTestTables(app);
    // truncateTestTables does not clear the Canvas tables; the connection
    // cascades to courses and assignments (the tasks.test.ts idiom).
    await app.db.delete(canvasConnections);
  });

  // ---- fixtures -------------------------------------------------------------

  async function seedProject(): Promise<string> {
    const [row] = await app.db.insert(projects).values({ name: "Thesis" }).returning();
    return row!.id;
  }

  async function seedTask(
    overrides: Partial<typeof tasks.$inferInsert> = {},
  ): Promise<typeof tasks.$inferSelect> {
    const [row] = await app.db
      .insert(tasks)
      .values({ title: "Read chapter 4", status: "active", timezone: TZ, ...overrides })
      .returning();
    return row!;
  }

  async function seedEvent(
    overrides: Partial<typeof events.$inferInsert> = {},
  ): Promise<typeof events.$inferSelect> {
    const [row] = await app.db
      .insert(events)
      .values({
        title: "Study block",
        timezone: TZ,
        startsAt: new Date("2026-09-20T19:00:00Z"),
        endsAt: new Date("2026-09-20T20:00:00Z"),
        origin: "local",
        ...overrides,
      })
      .returning();
    return row!;
  }

  async function seedGoogleCalendar(
    opts: {
      status?: "active" | "needs_reauth" | "disconnected";
      accessRole?: string | null;
      syncEnabled?: boolean;
    } = {},
  ): Promise<EventCalendarTarget> {
    const [connection] = await app.db
      .insert(calendarConnections)
      .values({
        provider: "google",
        googleAccountEmail: "user@example.com",
        googleAccountId: `sub-${crypto.randomUUID()}`,
        status: opts.status ?? "active",
        grantedScope: "https://www.googleapis.com/auth/calendar.events",
      })
      .returning({ id: calendarConnections.id });
    await app.db.insert(calendarConnectionCalendars).values({
      connectionId: connection!.id,
      googleCalendarId: "primary",
      summary: "primary",
      syncEnabled: opts.syncEnabled ?? true,
      accessRole: opts.accessRole === undefined ? "owner" : opts.accessRole,
    });
    return { connection_id: connection!.id, google_calendar_id: "primary" };
  }

  async function seedAssignment(): Promise<string> {
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
      .values({ connectionId: connection!.id, canvasCourseId: 4315, name: "Advanced Web Dev" })
      .returning();
    const [assignment] = await app.db
      .insert(canvasAssignments)
      .values({
        connectionId: connection!.id,
        courseId: course!.id,
        canvasAssignmentId: 99001,
        title: "Project 2",
        submissionState: "unsubmitted",
      })
      .returning();
    return assignment!.id;
  }

  async function pushJobCount(eventId: string): Promise<number> {
    const result = await app.db.execute<{ count: string }>(
      sql`select count(*)::text as count from pgboss.job where name = ${CALENDAR_PUSH_EVENT_QUEUE} and data->>'eventId' = ${eventId}`,
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  function prepare<Id extends ActionId>(id: Id, input: ActionInput<Id>) {
    return ACTION_HANDLERS[id].prepare(app.db, input, NOW);
  }

  /** `execute` the way approve runs it: inside one transaction, committed on return. */
  function execute<Id extends ActionId>(
    id: Id,
    input: ActionInput<Id>,
  ): Promise<ActionExecutionResult<Id>> {
    return app.db.transaction((tx) =>
      ACTION_HANDLERS[id].execute({ tx, now: NOW, requestId: REQUEST_ID }, input),
    );
  }

  async function expectExecutionError(promise: Promise<unknown>, errorClass: string) {
    await expect(promise).rejects.toBeInstanceOf(ActionExecutionError);
    await expect(promise).rejects.toMatchObject({ errorClass });
  }

  async function expectValidationIssue(promise: Promise<unknown>, path: string, message?: string) {
    await expect(promise).rejects.toBeInstanceOf(ActionValidationError);
    await expect(promise).rejects.toMatchObject({
      issue: { code: "custom", path: [path], ...(message ? { message } : {}) },
    });
  }

  const eventInput = (
    extra: Partial<ActionInput<"create_calendar_event">> = {},
  ): ActionInput<"create_calendar_event"> => ({
    title: "Study block",
    starts_at: "2026-09-20T14:00:00",
    ends_at: "2026-09-20T15:30:00",
    timezone: TZ,
    ...extra,
  });

  const taskInput = (
    extra: Partial<ActionInput<"create_task">> = {},
  ): ActionInput<"create_task"> => ({
    title: "Draft the outline",
    timezone: TZ,
    ...extra,
  });

  // ---- the map --------------------------------------------------------------

  describe("the handler map", () => {
    it("has exactly one { prepare, execute } per ACTION_ID", () => {
      expect(Object.keys(ACTION_HANDLERS).sort()).toEqual([...ACTION_IDS].sort());
      for (const id of ACTION_IDS) {
        expect(typeof ACTION_HANDLERS[id].prepare).toBe("function");
        expect(typeof ACTION_HANDLERS[id].execute).toBe("function");
      }
    });

    it("every fixture input survives the stored-input round trip through its own schema", () => {
      // What the approve service does: re-parse the jsonb `input` through
      // ACTION_INPUT_SCHEMAS[id]. JSON round-tripped so a Date or undefined
      // could never sneak through as a live object.
      const fixtures: { [K in ActionId]: ActionInput<K> } = {
        create_calendar_event: eventInput({
          description: "Chapter 4",
          location: "Library",
          project_id: MISSING_UUID,
          calendar: { connection_id: MISSING_UUID, google_calendar_id: "primary" },
        }),
        archive_calendar_event: { event_id: MISSING_UUID },
        create_task: taskInput({
          body: "Three sections",
          due_at: "2026-09-21T09:00:00",
          remind_at: "2026-09-21T08:00:00",
          priority: 2,
          project_id: MISSING_UUID,
          canvas_assignment_id: MISSING_UUID,
        }),
        archive_task: { task_id: MISSING_UUID },
        complete_task: { task_id: MISSING_UUID },
        reopen_task: { task_id: MISSING_UUID },
      };
      for (const id of ACTION_IDS) {
        const stored = JSON.parse(JSON.stringify(fixtures[id])) as unknown;
        const parsed = ACTION_INPUT_SCHEMAS[id].safeParse(stored);
        expect(parsed.success, id).toBe(true);
        expect(parsed.data).toEqual(fixtures[id]);
      }
    });
  });

  // ---- create_calendar_event ------------------------------------------------

  describe("create_calendar_event", () => {
    it("prepare composes the summary in the input's own zone with no target", async () => {
      const preparation = await prepare("create_calendar_event", eventInput());
      expect(preparation).toEqual({
        inputSummary: "Create event “Study block” · 2026-09-20 14:00–15:30",
        target: null,
      });
    });

    it("prepare spells out both dates when the block crosses a local midnight", async () => {
      const preparation = await prepare(
        "create_calendar_event",
        eventInput({ starts_at: "2026-09-20T23:00:00", ends_at: "2026-09-21T00:30:00" }),
      );
      expect(preparation.inputSummary).toBe(
        "Create event “Study block” · 2026-09-20 23:00–2026-09-21 00:30",
      );
    });

    it("prepare bounds the summary by shortening the title, never the frame", async () => {
      const preparation = await prepare(
        "create_calendar_event",
        eventInput({ title: "x".repeat(400) }),
      );
      expect(preparation.inputSummary.length).toBe(ACTION_SUMMARY_MAX_CHARS);
      expect(preparation.inputSummary.startsWith("Create event “xxx")).toBe(true);
      expect(preparation.inputSummary.endsWith("…” · 2026-09-20 14:00–15:30")).toBe(true);
    });

    it("prepare refuses an end at or before the start, resolved in the input's zone", async () => {
      await expectValidationIssue(
        prepare(
          "create_calendar_event",
          eventInput({ starts_at: "2026-09-20T14:00:00", ends_at: "2026-09-20T14:00:00" }),
        ),
        "ends_at",
      );
    });

    it("prepare refuses an unknown project_id", async () => {
      await expectValidationIssue(
        prepare("create_calendar_event", eventInput({ project_id: MISSING_UUID })),
        "project_id",
        "project_id does not reference an existing project",
      );
    });

    it("prepare refuses an ineligible calendar with the resolver's own reason token", async () => {
      const reader = await seedGoogleCalendar({ accessRole: "reader" });
      await expectValidationIssue(
        prepare("create_calendar_event", eventInput({ calendar: reader })),
        "calendar",
        "calendar_not_writable",
      );
      await expectValidationIssue(
        prepare("create_calendar_event", {
          ...eventInput(),
          calendar: { connection_id: MISSING_UUID, google_calendar_id: "primary" },
        }),
        "calendar",
        "calendar_not_found",
      );
    });

    it("prepare accepts a write-eligible calendar and an existing project", async () => {
      const calendar = await seedGoogleCalendar();
      const projectId = await seedProject();
      const preparation = await prepare(
        "create_calendar_event",
        eventInput({ calendar, project_id: projectId }),
      );
      expect(preparation.target).toBeNull();
    });

    it("execute writes a local, timed, one-off event and no link when no calendar is given", async () => {
      const projectId = await seedProject();
      const result = await execute(
        "create_calendar_event",
        eventInput({ project_id: projectId, description: "Ch. 4", location: "Library" }),
      );
      expect(result.target).toEqual({ type: "event", id: result.output.event_id });
      expect(result.resultSummary).toBe("Created event “Study block”");
      expect(result.afterCommit).toBeUndefined();

      const [row] = await app.db.select().from(events).where(eq(events.id, result.output.event_id));
      expect(row).toMatchObject({
        title: "Study block",
        description: "Ch. 4",
        location: "Library",
        origin: "local",
        allDay: false,
        rrule: null,
        projectId,
        clientUuid: null,
        timezone: TZ,
        archivedAt: null,
      });
      // 14:00 America/Chicago in September is 19:00Z.
      expect(row!.startsAt?.toISOString()).toBe("2026-09-20T19:00:00.000Z");
      expect(row!.endsAt?.toISOString()).toBe("2026-09-20T20:30:00.000Z");
      expect(await loadEventLink(app.db, row!.id)).toBeNull();
      const windowRows = await app.db
        .select()
        .from(occurrences)
        .where(and(eq(occurrences.parentType, "event"), eq(occurrences.parentId, row!.id)));
      expect(windowRows).toHaveLength(0);
    });

    it("execute writes a pending_push link for a write-eligible calendar and enqueues only afterCommit", async () => {
      const calendar = await seedGoogleCalendar();
      const result = await execute("create_calendar_event", eventInput({ calendar }));
      const eventId = result.output.event_id;

      const link = await loadEventLink(app.db, eventId);
      expect(link).toMatchObject({
        connectionId: calendar.connection_id,
        googleCalendarId: "primary",
        caldavCalendarUrl: null,
        syncStatus: "pending_push",
        googleEventId: null,
      });
      // Nothing left the process inside the transaction.
      expect(await pushJobCount(eventId)).toBe(0);
      expect(result.afterCommit).toBeTypeOf("function");
      await result.afterCommit!(app);
      expect(await pushJobCount(eventId)).toBe(1);
    });

    it("execute fails calendar_not_eligible when the calendar stopped being writable after prepare", async () => {
      const calendar = await seedGoogleCalendar();
      await prepare("create_calendar_event", eventInput({ calendar }));
      await app.db
        .update(calendarConnections)
        .set({ status: "disconnected" })
        .where(eq(calendarConnections.id, calendar.connection_id));

      await expectExecutionError(
        execute("create_calendar_event", eventInput({ calendar })),
        "calendar_not_eligible",
      );
      const rows = await app.db.select({ id: events.id }).from(events);
      expect(rows).toHaveLength(0);
    });

    it("execute fails input_invalid when the stored instants do not order", async () => {
      await expectExecutionError(
        execute(
          "create_calendar_event",
          eventInput({ starts_at: "2026-09-20T15:00:00", ends_at: "2026-09-20T14:00:00" }),
        ),
        "input_invalid",
      );
    });

    it("the transactional calendar resolver answers exactly as resolveWritableCalendar does", async () => {
      // execute cannot call the route module's resolver (typed on the pool
      // Db), so services/events.ts mirrors it; this pins the two together on
      // every reason token and on the ok shape.
      const cases: EventCalendarTarget[] = [
        await seedGoogleCalendar(),
        await seedGoogleCalendar({ accessRole: "reader" }),
        await seedGoogleCalendar({ accessRole: null }),
        await seedGoogleCalendar({ syncEnabled: false }),
        await seedGoogleCalendar({ status: "needs_reauth" }),
        { connection_id: MISSING_UUID, google_calendar_id: "primary" },
      ];
      const first = await seedGoogleCalendar();
      cases.push({ connection_id: first.connection_id, google_calendar_id: "not-there" });
      cases.push({ connection_id: first.connection_id, caldav_calendar_url: "/x/" });

      const seen = new Set<string>();
      for (const selector of cases) {
        const expected = await resolveWritableCalendar(app.db, selector);
        const actual = await app.db.transaction((tx) => resolveWritableCalendarInTx(tx, selector));
        expect(actual).toEqual(expected);
        seen.add(expected.ok ? "ok" : expected.reason);
      }
      expect([...seen].sort()).toEqual(
        ["calendar_not_found", "calendar_not_writable", "connection_not_active", "ok"].sort(),
      );
    });
  });

  // ---- archive_calendar_event -----------------------------------------------

  describe("archive_calendar_event", () => {
    it("prepare names the event and its target", async () => {
      const event = await seedEvent();
      expect(await prepare("archive_calendar_event", { event_id: event.id })).toEqual({
        inputSummary: "Archive event “Study block”",
        target: { type: "event", id: event.id },
      });
    });

    it("prepare refuses an unknown, external or archived event", async () => {
      await expectValidationIssue(
        prepare("archive_calendar_event", { event_id: MISSING_UUID }),
        "event_id",
        "event_id does not reference an existing event",
      );
      const external = await seedEvent({ origin: "external" });
      await expectValidationIssue(
        prepare("archive_calendar_event", { event_id: external.id }),
        "event_id",
        "event is read-only (synced from a calendar)",
      );
      const archived = await seedEvent({ archivedAt: NOW });
      await expectValidationIssue(
        prepare("archive_calendar_event", { event_id: archived.id }),
        "event_id",
        "event is already archived",
      );
    });

    it("prepare refuses a detached child whose parent is external", async () => {
      const parent = await seedEvent({ origin: "external", rrule: "FREQ=WEEKLY" });
      const child = await seedEvent({ origin: "local", parentEventId: parent.id });
      await expectValidationIssue(
        prepare("archive_calendar_event", { event_id: child.id }),
        "event_id",
        "event is read-only (synced from a calendar)",
      );
    });

    it("execute archives the event, cascades to active children, and returns no afterCommit when unlinked", async () => {
      const parent = await seedEvent({ rrule: "FREQ=WEEKLY" });
      const child = await seedEvent({ parentEventId: parent.id });
      const result = await execute("archive_calendar_event", { event_id: parent.id });
      expect(result).toMatchObject({
        output: { event_id: parent.id },
        target: { type: "event", id: parent.id },
        resultSummary: "Archived",
      });
      expect(result.afterCommit).toBeUndefined();
      const rows = await app.db.select().from(events);
      const byId = new Map(rows.map((row) => [row.id, row]));
      expect(byId.get(parent.id)!.archivedAt?.toISOString()).toBe(NOW.toISOString());
      expect(byId.get(child.id)!.archivedAt?.toISOString()).toBe(NOW.toISOString());
    });

    it("execute flips a linked event's link to pending_push and enqueues only afterCommit", async () => {
      const calendar = await seedGoogleCalendar();
      const event = await seedEvent();
      await app.db.insert(eventExternalLinks).values({
        eventId: event.id,
        connectionId: calendar.connection_id,
        googleCalendarId: "primary",
        googleEventId: "remote-1",
        syncStatus: "synced",
      });

      const result = await execute("archive_calendar_event", { event_id: event.id });
      const link = await loadEventLink(app.db, event.id);
      expect(link?.syncStatus).toBe("pending_push");
      expect(await pushJobCount(event.id)).toBe(0);
      expect(result.afterCommit).toBeTypeOf("function");
      await result.afterCommit!(app);
      expect(await pushJobCount(event.id)).toBe(1);
    });

    it("execute fails with the matching class when the target changed after prepare", async () => {
      const event = await seedEvent();
      await prepare("archive_calendar_event", { event_id: event.id });

      await app.db.update(events).set({ archivedAt: NOW }).where(eq(events.id, event.id));
      await expectExecutionError(
        execute("archive_calendar_event", { event_id: event.id }),
        "target_archived",
      );

      await app.db
        .update(events)
        .set({ archivedAt: null, origin: "external" })
        .where(eq(events.id, event.id));
      await expectExecutionError(
        execute("archive_calendar_event", { event_id: event.id }),
        "target_not_local",
      );

      await app.db.delete(events).where(eq(events.id, event.id));
      await expectExecutionError(
        execute("archive_calendar_event", { event_id: event.id }),
        "target_not_found",
      );
    });
  });

  // ---- create_task ----------------------------------------------------------

  describe("create_task", () => {
    it("prepare composes the summary with the local due time when present", async () => {
      expect(await prepare("create_task", taskInput())).toEqual({
        inputSummary: "Create task “Draft the outline”",
        target: null,
      });
      expect(await prepare("create_task", taskInput({ due_at: "2026-09-21T09:00:00" }))).toEqual({
        inputSummary: "Create task “Draft the outline” · due 2026-09-21 09:00",
        target: null,
      });
    });

    it("prepare refuses an unknown project_id or canvas_assignment_id", async () => {
      await expectValidationIssue(
        prepare("create_task", taskInput({ project_id: MISSING_UUID })),
        "project_id",
      );
      await expectValidationIssue(
        prepare("create_task", taskInput({ canvas_assignment_id: MISSING_UUID })),
        "canvas_assignment_id",
        "canvas_assignment_id does not reference an existing assignment",
      );
    });

    it("execute writes an active, one-off task with the ADR-074 link set in the same transaction", async () => {
      const projectId = await seedProject();
      const assignmentId = await seedAssignment();
      const result = await execute(
        "create_task",
        taskInput({
          body: "Three sections",
          due_at: "2026-09-21T09:00:00",
          remind_at: "2026-09-21T08:00:00",
          priority: 2,
          project_id: projectId,
          canvas_assignment_id: assignmentId,
        }),
      );
      expect(result.target).toEqual({ type: "task", id: result.output.task_id });
      expect(result.resultSummary).toBe("Created task “Draft the outline”");
      expect(result.afterCommit).toBeUndefined();

      const [row] = await app.db.select().from(tasks).where(eq(tasks.id, result.output.task_id));
      expect(row).toMatchObject({
        title: "Draft the outline",
        body: "Three sections",
        status: "active",
        priority: 2,
        projectId,
        canvasAssignmentId: assignmentId,
        timezone: TZ,
        rrule: null,
        recurrenceAnchor: null,
        completedAt: null,
        archivedAt: null,
      });
      expect(row!.dueAt?.toISOString()).toBe("2026-09-21T14:00:00.000Z");
      expect(row!.remindAt?.toISOString()).toBe("2026-09-21T13:00:00.000Z");
      const windowRows = await app.db
        .select()
        .from(occurrences)
        .where(and(eq(occurrences.parentType, "task"), eq(occurrences.parentId, row!.id)));
      expect(windowRows).toHaveLength(0);
    });

    it("execute leaves the link null when no assignment is given", async () => {
      const result = await execute("create_task", taskInput());
      const [row] = await app.db.select().from(tasks).where(eq(tasks.id, result.output.task_id));
      expect(row!.canvasAssignmentId).toBeNull();
      expect(row!.dueAt).toBeNull();
      expect(row!.remindAt).toBeNull();
    });

    it("execute fails target_not_found when the assignment vanished after prepare", async () => {
      const assignmentId = await seedAssignment();
      await prepare("create_task", taskInput({ canvas_assignment_id: assignmentId }));
      await app.db.delete(canvasConnections);
      await expectExecutionError(
        execute("create_task", taskInput({ canvas_assignment_id: assignmentId })),
        "target_not_found",
      );
      expect(await app.db.select({ id: tasks.id }).from(tasks)).toHaveLength(0);
    });
  });

  // ---- archive_task / complete_task / reopen_task ---------------------------

  describe("task target actions", () => {
    it("prepare names each action, the task and its target", async () => {
      const open = await seedTask();
      const done = await seedTask({ status: "done", completedAt: NOW });
      expect(await prepare("archive_task", { task_id: open.id })).toEqual({
        inputSummary: "Archive task “Read chapter 4”",
        target: { type: "task", id: open.id },
      });
      expect(await prepare("complete_task", { task_id: open.id })).toEqual({
        inputSummary: "Complete task “Read chapter 4”",
        target: { type: "task", id: open.id },
      });
      expect(await prepare("reopen_task", { task_id: done.id })).toEqual({
        inputSummary: "Reopen task “Read chapter 4”",
        target: { type: "task", id: done.id },
      });
    });

    it.each(["archive_task", "complete_task", "reopen_task"] as const)(
      "%s prepare refuses an unknown or archived task",
      async (id) => {
        await expectValidationIssue(
          prepare(id, { task_id: MISSING_UUID }),
          "task_id",
          "task_id does not reference an existing task",
        );
        const archived = await seedTask({ archivedAt: NOW, status: "done" });
        await expectValidationIssue(
          prepare(id, { task_id: archived.id }),
          "task_id",
          "task is archived",
        );
      },
    );

    it("complete_task prepare refuses a recurring task and a task that is not open", async () => {
      const recurring = await seedTask({
        rrule: "FREQ=DAILY",
        recurrenceTimezone: TZ,
        recurrenceAnchor: "due_date",
        dueAt: NOW,
      });
      await expectValidationIssue(
        prepare("complete_task", { task_id: recurring.id }),
        "task_id",
        "recurring tasks complete through their occurrences",
      );
      const done = await seedTask({ status: "done", completedAt: NOW });
      await expectValidationIssue(
        prepare("complete_task", { task_id: done.id }),
        "task_id",
        "task is not open",
      );
      const inbox = await seedTask({ status: "inbox" });
      expect((await prepare("complete_task", { task_id: inbox.id })).target).toEqual({
        type: "task",
        id: inbox.id,
      });
    });

    it("reopen_task prepare refuses a task that is not done or dropped", async () => {
      const active = await seedTask();
      await expectValidationIssue(
        prepare("reopen_task", { task_id: active.id }),
        "task_id",
        "task is not done or dropped",
      );
      const dropped = await seedTask({ status: "dropped" });
      expect((await prepare("reopen_task", { task_id: dropped.id })).target).toEqual({
        type: "task",
        id: dropped.id,
      });
    });

    it("archive_task execute stamps archived_at and leaves status alone", async () => {
      const task = await seedTask({ status: "inbox" });
      const result = await execute("archive_task", { task_id: task.id });
      expect(result).toEqual({
        output: { task_id: task.id },
        target: { type: "task", id: task.id },
        resultSummary: "Archived",
      });
      const [row] = await app.db.select().from(tasks).where(eq(tasks.id, task.id));
      expect(row!.archivedAt?.toISOString()).toBe(NOW.toISOString());
      expect(row!.status).toBe("inbox");
    });

    it("complete_task execute flips to done with completed_at", async () => {
      const task = await seedTask();
      const result = await execute("complete_task", { task_id: task.id });
      expect(result).toEqual({
        output: { task_id: task.id },
        target: { type: "task", id: task.id },
        resultSummary: "Marked done",
      });
      const [row] = await app.db.select().from(tasks).where(eq(tasks.id, task.id));
      expect(row!.status).toBe("done");
      expect(row!.completedAt?.toISOString()).toBe(NOW.toISOString());
      expect(row!.archivedAt).toBeNull();
    });

    it("reopen_task execute flips to active and clears completed_at", async () => {
      const task = await seedTask({
        status: "done",
        completedAt: new Date("2026-09-01T00:00:00Z"),
      });
      const result = await execute("reopen_task", { task_id: task.id });
      expect(result).toEqual({
        output: { task_id: task.id },
        target: { type: "task", id: task.id },
        resultSummary: "Reopened",
      });
      const [row] = await app.db.select().from(tasks).where(eq(tasks.id, task.id));
      expect(row!.status).toBe("active");
      expect(row!.completedAt).toBeNull();
    });

    it("reopen_task execute re-materialises a reopened due_date series' window, like the route", async () => {
      const task = await seedTask({
        status: "done",
        completedAt: NOW,
        rrule: "FREQ=DAILY",
        recurrenceTimezone: TZ,
        recurrenceAnchor: "due_date",
        dueAt: NOW,
      });
      await execute("reopen_task", { task_id: task.id });
      const windowRows = await app.db
        .select({ id: occurrences.id })
        .from(occurrences)
        .where(and(eq(occurrences.parentType, "task"), eq(occurrences.parentId, task.id)));
      expect(windowRows.length).toBeGreaterThan(0);
    });

    it("execute fails with the matching class when the target changed after prepare", async () => {
      const task = await seedTask();
      await prepare("complete_task", { task_id: task.id });
      await prepare("archive_task", { task_id: task.id });

      await app.db
        .update(tasks)
        .set({ status: "done", completedAt: NOW })
        .where(eq(tasks.id, task.id));
      await expectExecutionError(execute("complete_task", { task_id: task.id }), "task_not_open");

      await app.db
        .update(tasks)
        .set({ status: "active", completedAt: null, rrule: "FREQ=DAILY", recurrenceTimezone: TZ })
        .where(eq(tasks.id, task.id));
      await expectExecutionError(execute("complete_task", { task_id: task.id }), "task_recurring");

      await app.db
        .update(tasks)
        .set({ rrule: null, recurrenceTimezone: null })
        .where(eq(tasks.id, task.id));
      await expectExecutionError(
        execute("reopen_task", { task_id: task.id }),
        "task_not_reopenable",
      );

      await app.db.update(tasks).set({ archivedAt: NOW }).where(eq(tasks.id, task.id));
      await expectExecutionError(execute("archive_task", { task_id: task.id }), "target_archived");
      await expectExecutionError(execute("complete_task", { task_id: task.id }), "target_archived");
      await expectExecutionError(execute("reopen_task", { task_id: task.id }), "target_archived");

      await app.db.delete(tasks).where(eq(tasks.id, task.id));
      await expectExecutionError(execute("archive_task", { task_id: task.id }), "target_not_found");
      await expectExecutionError(
        execute("complete_task", { task_id: task.id }),
        "target_not_found",
      );
      await expectExecutionError(execute("reopen_task", { task_id: task.id }), "target_not_found");
    });

    it("a failed execute writes nothing", async () => {
      const task = await seedTask({ status: "done", completedAt: NOW });
      await expectExecutionError(execute("complete_task", { task_id: task.id }), "task_not_open");
      const [row] = await app.db.select().from(tasks).where(eq(tasks.id, task.id));
      expect(row!.completedAt?.toISOString()).toBe(NOW.toISOString());
      expect(row!.updatedAt.toISOString()).toBe(task.updatedAt.toISOString());
    });
  });
});
