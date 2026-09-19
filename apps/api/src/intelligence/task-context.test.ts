import {
  canvasAssignments,
  canvasConnections,
  canvasCourses,
  occurrences,
  projects,
  tasks,
  type Db,
} from "@personal-os/db";
import { GetTaskContextOutputSchema, READ_TOOL_TASK_OCCURRENCES_MAX } from "@personal-os/schema";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AskUnauthorizedError, authorizeAgentRead, type CloudAskGrant } from "../ask/authorize.js";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import { mintReadContext, type ReadContext } from "./read-context.js";
import { buildTaskContext } from "./task-context.js";

// buildTaskContext (Checkpoint 10.9, ADR-081 §5). Fixed `now` as in the
// sibling suites; the output carries instants, so no wall-clock formatting
// depends on it here.

const TZ = "America/Chicago";
const NOW = new Date("2026-09-14T14:30:00Z");
const BELL = String.fromCharCode(7);
const BODY_SENTINEL = "BODY-SENTINEL-NEVER";
const RRULE = "FREQ=WEEKLY;BYDAY=MO,WE,FR";

function fakeRequest(id = "req-task"): FastifyRequest {
  return { id } as unknown as FastifyRequest;
}

describe("buildTaskContext", () => {
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

  // truncateTestTables does not clear the Canvas tables (routes/tasks.test.ts
  // uses the same local cleanup); deleting the connection cascades.
  afterEach(async () => {
    await app.db.delete(canvasConnections);
  });

  function ctx(): ReadContext {
    const grant = authorizeAgentRead(
      fakeRequest(),
      { id: "agent-1", trustLevel: "propose", revokedAt: null },
      true,
    );
    expect(grant).not.toBeNull();
    return mintReadContext(fakeRequest(), app.db, grant!, TZ, NOW);
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
        title: "Project 2 -- must never appear in a task context",
        submissionState: "unsubmitted",
      })
      .returning();
    return assignment!.id;
  }

  it("throws AskUnauthorizedError on a structural look-alike grant BEFORE any row is read", async () => {
    const lookAlike: CloudAskGrant = Object.freeze({
      requestId: "req-forged",
      grantedAt: new Date().toISOString(),
    });
    const untouchable = new Proxy(
      {},
      {
        get(_target, property) {
          throw new Error(`db touched before the grant check: ${String(property)}`);
        },
      },
    ) as Db;
    const forged: ReadContext = Object.freeze({
      db: untouchable,
      effectiveNow: NOW,
      tz: TZ,
      grant: lookAlike,
    });
    await expect(buildTaskContext(forged, { id: crypto.randomUUID() })).rejects.toBeInstanceOf(
      AskUnauthorizedError,
    );
  });

  it("returns null for an unknown id", async () => {
    expect(await buildTaskContext(ctx(), { id: crypto.randomUUID() })).toBeNull();
  });

  it("carries the schedule, the project and the link flag -- never the body, the rrule text or the assignment", async () => {
    const [project] = await app.db.insert(projects).values({ name: "Home" }).returning();
    const assignmentId = await seedAssignment();
    const [task] = await app.db
      .insert(tasks)
      .values({
        title: `Renew   passport${BELL} at the office`,
        body: `bring the old one ${BODY_SENTINEL}`,
        status: "active",
        timezone: TZ,
        priority: 1,
        projectId: project!.id,
        canvasAssignmentId: assignmentId,
        rrule: RRULE,
        recurrenceTimezone: TZ,
        recurrenceAnchor: "due_date",
        dueAt: new Date("2026-09-14T15:00:00Z"),
        remindAt: new Date("2026-09-14T14:00:00Z"),
      })
      .returning();

    const output = await buildTaskContext(ctx(), { id: task!.id });
    expect(output).not.toBeNull();
    expect(GetTaskContextOutputSchema.parse(output)).toEqual(output);
    expect(output).toEqual({
      id: task!.id,
      title: "Renew passport at the office",
      status: "active",
      priority: 1,
      due_at: "2026-09-14T15:00:00.000Z",
      remind_at: "2026-09-14T14:00:00.000Z",
      completed_at: null,
      archived: false,
      recurring: true,
      project: { id: project!.id, name: "Home" },
      canvas_linked: true,
      open_occurrences: [],
      open_occurrences_total: 0,
      updated_at: task!.updatedAt.toISOString(),
    });

    const serialized = JSON.stringify(output);
    expect(Object.keys(output!)).not.toContain("body");
    expect(Object.keys(output!)).not.toContain("rrule");
    expect(serialized).not.toContain(BODY_SENTINEL);
    expect(serialized).not.toContain(RRULE);
    expect(serialized).not.toContain("BYDAY");
    expect(serialized).not.toContain(assignmentId);
    expect(serialized).not.toContain("Project 2");
  });

  it("reports recurring:false, canvas_linked:false and project:null when none is set", async () => {
    const [task] = await app.db
      .insert(tasks)
      .values({ title: "Call the dentist", status: "inbox", timezone: TZ })
      .returning();
    const output = await buildTaskContext(ctx(), { id: task!.id });
    expect(output).toMatchObject({
      status: "inbox",
      priority: null,
      due_at: null,
      remind_at: null,
      recurring: false,
      project: null,
      canvas_linked: false,
    });
  });

  it("reports an archived task as archived:true rather than null", async () => {
    const [task] = await app.db
      .insert(tasks)
      .values({
        title: "Old chore",
        status: "done",
        timezone: TZ,
        completedAt: new Date("2026-09-01T12:00:00Z"),
        archivedAt: new Date("2026-09-02T12:00:00Z"),
      })
      .returning();
    const output = await buildTaskContext(ctx(), { id: task!.id });
    expect(output).toMatchObject({
      status: "done",
      completed_at: "2026-09-01T12:00:00.000Z",
      archived: true,
    });
  });

  it("caps open occurrences at READ_TOOL_TASK_OCCURRENCES_MAX, ordered by occurs_at, with an honest total; done and skipped rows are neither listed nor counted", async () => {
    const [task] = await app.db
      .insert(tasks)
      .values({
        title: "Water the plants",
        status: "active",
        timezone: TZ,
        rrule: "FREQ=DAILY",
        recurrenceTimezone: TZ,
        recurrenceAnchor: "due_date",
        dueAt: new Date("2026-09-14T13:00:00Z"),
      })
      .returning();
    const seededOpen = READ_TOOL_TASK_OCCURRENCES_MAX + 2;
    const base = Date.parse("2026-09-14T13:00:00Z");
    const day = 24 * 60 * 60 * 1000;
    // Insert in REVERSE date order so the ordering assertion is not
    // satisfied by insertion order.
    await app.db.insert(occurrences).values(
      Array.from({ length: seededOpen }, (_, i) => {
        const at = new Date(base + (seededOpen - 1 - i) * day);
        return {
          parentType: "task",
          parentId: task!.id,
          occursAt: at,
          occursLocal: at,
          status: "scheduled",
          lazyGenerated: false,
          snoozedUntil: i === seededOpen - 1 ? new Date(base + 6 * 60 * 60 * 1000) : null,
        };
      }),
    );
    await app.db.insert(occurrences).values([
      {
        parentType: "task",
        parentId: task!.id,
        occursAt: new Date(base - day),
        occursLocal: new Date(base - day),
        status: "done",
        lazyGenerated: false,
        completedAt: new Date(base - day),
      },
      {
        parentType: "task",
        parentId: task!.id,
        occursAt: new Date(base - 2 * day),
        occursLocal: new Date(base - 2 * day),
        status: "skipped",
        lazyGenerated: false,
      },
    ]);

    const output = await buildTaskContext(ctx(), { id: task!.id });
    expect(output!.open_occurrences).toHaveLength(READ_TOOL_TASK_OCCURRENCES_MAX);
    expect(output!.open_occurrences_total).toBe(seededOpen);
    const instants = output!.open_occurrences.map((o) => Date.parse(o.occurs_at));
    expect(instants).toEqual([...instants].sort((a, b) => a - b));
    expect(instants[0]).toBe(base);
    expect(output!.open_occurrences[0]).toMatchObject({
      status: "scheduled",
      snoozed_until: new Date(base + 6 * 60 * 60 * 1000).toISOString(),
    });
    expect(output!.open_occurrences.every((o) => o.status === "scheduled")).toBe(true);
    expect(GetTaskContextOutputSchema.parse(output)).toEqual(output);
  });
});
