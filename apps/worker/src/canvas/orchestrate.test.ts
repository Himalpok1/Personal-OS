import { encryptSecret } from "@personal-os/ai-providers";
import {
  canvasAssignments,
  canvasConnections,
  canvasCourses,
  canvasSyncRuns,
  devices,
  type Db,
} from "@personal-os/db";
import {
  CanvasApiError,
  createFakeCanvasClient,
  type CanvasClient,
  type FakeCanvasClient,
} from "@personal-os/canvas-providers";
import { CanvasSyncTokenSchema } from "@personal-os/schema";
import { asc, eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../env.js";
import { setLogSink } from "../logger.js";
import { NOTIFICATIONS_DISPATCH_QUEUE } from "../queue-names.js";
import { buildTestDb } from "../test/build-test-db.js";
import { runCanvasConnectionSync } from "./orchestrate.js";
import {
  gradedAssignmentPayload,
  seedCanvasConnection,
  truncateCanvasTestTables,
} from "./test-fixtures.js";

const db: Db = buildTestDb();
let client: FakeCanvasClient;

const NOW = new Date("2026-09-16T12:00:00.000Z");

function deps(override?: Partial<{ client: CanvasClient; now: () => Date; boss: PgBoss | null }>) {
  return { db, client, now: () => NOW, ...override };
}

/** A fake pg-boss whose `send` calls can be asserted on. */
function fakeBoss() {
  return { send: vi.fn() };
}

/** A device eligible for an `alert`-category push, for the tests that assert
 *  on `enqueueCanvasInvalidTokenAlert`'s actual fan-out. */
async function insertEligibleDevice(suffix = "1"): Promise<void> {
  await db.insert(devices).values({
    name: `Device ${suffix}`,
    platform: "android",
    tokenHash: `canvas-orchestrate-alert-hash-${suffix}`,
    notifyAlerts: true,
    notificationsEnabled: true,
  });
}

function alertCallsOf(boss: ReturnType<typeof fakeBoss>) {
  return boss.send.mock.calls.filter((call) => call[0] === NOTIFICATIONS_DISPATCH_QUEUE);
}

async function connectionRow(id: string) {
  const [row] = await db.select().from(canvasConnections).where(eq(canvasConnections.id, id));
  return row!;
}

async function assignmentsFor(connectionId: string) {
  return await db
    .select({
      canvasAssignmentId: canvasAssignments.canvasAssignmentId,
      score: canvasAssignments.score,
      grade: canvasAssignments.grade,
      updatedAt: canvasAssignments.updatedAt,
    })
    .from(canvasAssignments)
    .where(eq(canvasAssignments.connectionId, connectionId))
    .orderBy(asc(canvasAssignments.canvasAssignmentId));
}

function course(id: number, name: string) {
  return {
    id,
    name,
    course_code: `CS-${id}`,
    workflow_state: "available",
    html_url: `https://x/${id}`,
  };
}

async function coursesFor(connectionId: string) {
  return await db
    .select({
      canvasCourseId: canvasCourses.canvasCourseId,
      name: canvasCourses.name,
      archivedAt: canvasCourses.archivedAt,
    })
    .from(canvasCourses)
    .where(eq(canvasCourses.connectionId, connectionId))
    .orderBy(asc(canvasCourses.canvasCourseId));
}

async function runsFor(connectionId: string) {
  return await db
    .select({
      status: canvasSyncRuns.status,
      coursesSynced: canvasSyncRuns.coursesSynced,
      assignmentsSynced: canvasSyncRuns.assignmentsSynced,
      failureClass: canvasSyncRuns.failureClass,
    })
    .from(canvasSyncRuns)
    .where(eq(canvasSyncRuns.connectionId, connectionId))
    .orderBy(asc(canvasSyncRuns.startedAt), asc(canvasSyncRuns.id));
}

beforeEach(async () => {
  await truncateCanvasTestTables(db);
  await db.delete(devices);
  client = createFakeCanvasClient();
});

afterAll(async () => {
  await truncateCanvasTestTables(db);
  await db.$client.end();
});

describe("runCanvasConnectionSync", () => {
  it("syncs 2+ courses end to end: courses, assignments, announcements, events", async () => {
    const connection = await seedCanvasConnection(db);

    client.queueActiveCourses([course(101, "Intro to Widgets"), course(102, "Advanced Widgets")]);
    client.queueAssignments([{ id: 1, name: "HW1", due_at: "2026-09-20T00:00:00Z" }]);
    client.queueAnnouncements([{ id: 10, title: "Welcome", message: "<p>Hi</p>" }]);
    client.queueCalendarEvents([]);
    client.queueAssignments([{ id: 2, name: "HW2" }]);
    client.queueAnnouncements([]);
    client.queueCalendarEvents([
      { id: 20, title: "Office hours", start_at: "2026-09-21T00:00:00Z" },
    ]);

    const result = await runCanvasConnectionSync(deps(), {
      connectionId: connection.id,
      kind: "cron",
    });

    expect(result.skipped).toBeNull();
    expect(result.coursesSeen).toBe(2);
    expect(result.coursesFailed).toBe(0);
    expect(result.assignmentsSynced).toBe(2);
    expect(result.announcementsSynced).toBe(1);
    expect(result.eventsSynced).toBe(1);

    const stored = await coursesFor(connection.id);
    expect(stored.map((c) => c.canvasCourseId)).toEqual([101, 102]);

    const runs = await runsFor(connection.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe("succeeded");
    expect(runs[0]?.coursesSynced).toBe(2);
    expect(runs[0]?.assignmentsSynced).toBe(2);

    // Every queued response was consumed -- nobody made a call nobody intended.
    expect(client.pending()).toEqual({
      getSelf: 0,
      listActiveCourses: 0,
      listAssignments: 0,
      listAnnouncements: 0,
      listCalendarEvents: 0,
    });
  });

  it("contains one course's fetch failure -- the OTHER course still syncs fully", async () => {
    const connection = await seedCanvasConnection(db);

    client.queueActiveCourses([course(201, "Failing Course"), course(202, "Healthy Course")]);
    // Course 201's assignments call throws.
    client.queueAssignments(new CanvasApiError(500, "provider_error"));
    // Course 202 succeeds fully.
    client.queueAssignments([{ id: 3, name: "HW3" }]);
    client.queueAnnouncements([]);
    client.queueCalendarEvents([]);

    const result = await runCanvasConnectionSync(deps(), {
      connectionId: connection.id,
      kind: "cron",
    });

    expect(result.coursesSeen).toBe(2);
    expect(result.coursesFailed).toBe(1);
    expect(result.assignmentsSynced).toBe(1);

    const stored = await coursesFor(connection.id);
    // BOTH course rows exist (course-level upsert happens before the child
    // fetch that fails) and NEITHER is archived -- a failed course must not be
    // treated as evidence of anything, including its own absence.
    expect(stored).toHaveLength(2);
    expect(stored.every((c) => c.archivedAt === null)).toBe(true);

    const assignmentRows = await db
      .select({ courseId: canvasAssignments.courseId })
      .from(canvasAssignments)
      .where(eq(canvasAssignments.connectionId, connection.id));
    // Only course 202's assignment landed; course 201 has none.
    expect(assignmentRows).toHaveLength(1);

    // The run as a WHOLE still succeeded -- containment, not failure
    // propagation.
    const runs = await runsFor(connection.id);
    expect(runs[0]?.status).toBe("succeeded");
  });

  it("an unchanged second pass writes zero new/updated rows (the setWhere idempotency gate) -- including a GRADED assignment", async () => {
    const connection = await seedCanvasConnection(db);
    const payload = () => {
      client.queueActiveCourses([course(301, "Stable Course")]);
      // One ungraded and one graded (score 95 / "A") assignment, so the gate
      // is exercised over the two 10.2 columns as well as the 10.1 ones.
      client.queueAssignments([
        { id: 5, name: "HW5", due_at: "2026-09-22T00:00:00Z" },
        gradedAssignmentPayload({ id: 6 }),
      ]);
      client.queueAnnouncements([{ id: 50, title: "Reminder", message: "text" }]);
      client.queueCalendarEvents([]);
    };

    payload();
    await runCanvasConnectionSync(deps(), { connectionId: connection.id, kind: "cron" });

    const [courseRowBefore] = await db
      .select({ id: canvasCourses.id, updatedAt: canvasCourses.updatedAt })
      .from(canvasCourses)
      .where(eq(canvasCourses.connectionId, connection.id));
    const assignmentsBefore = await assignmentsFor(connection.id);
    expect(assignmentsBefore).toHaveLength(2);
    // The graded row landed with its score and grade (ADR-068a).
    expect(assignmentsBefore[0]).toMatchObject({ canvasAssignmentId: 5, score: null, grade: null });
    expect(assignmentsBefore[1]).toMatchObject({ canvasAssignmentId: 6, score: 95, grade: "A" });

    payload();
    const secondResult = await runCanvasConnectionSync(deps(), {
      connectionId: connection.id,
      kind: "cron",
    });
    expect(secondResult.coursesSeen).toBe(1);
    expect(secondResult.assignmentsSynced).toBe(2); // "seen" count, not "changed"

    const [courseRowAfter] = await db
      .select({ id: canvasCourses.id, updatedAt: canvasCourses.updatedAt })
      .from(canvasCourses)
      .where(eq(canvasCourses.connectionId, connection.id));
    const assignmentsAfter = await assignmentsFor(connection.id);

    // Identical `updated_at` on EVERY row: the hash-gated upsert wrote NOTHING
    // the second time, which is the property this file exists to guarantee.
    expect(courseRowAfter?.updatedAt.getTime()).toBe(courseRowBefore?.updatedAt.getTime());
    expect(assignmentsAfter.map((a) => a.updatedAt.getTime())).toEqual(
      assignmentsBefore.map((a) => a.updatedAt.getTime()),
    );
  });

  // Checkpoint 10.2 (ADR-068a): a re-grade is a real change and must bump
  // `updated_at` on exactly the re-graded row -- and only that row. Both
  // columns are gated with `is distinct from`, so a null -> value transition
  // (first grading) counts as a change too, which `<>` would silently miss.
  //
  // The UNTOUCHED row's `updated_at` is asserted strictly equal (the gate
  // wrote nothing); the CHANGED row's is asserted by its new values plus a
  // monotone `updated_at`, because `updated_at = now()` is the database
  // clock and a strict `>` at millisecond resolution would be a clock
  // assertion, not a gate assertion. The strict `updated: 1, unchanged: 1`
  // split is pinned deterministically by ./persist.test.ts's count checks.
  describe("score / grade changes through the setWhere gate", () => {
    async function syncTwoAssignments(
      connectionId: string,
      second: ReturnType<typeof gradedAssignmentPayload>,
    ) {
      client.queueActiveCourses([course(310, "Graded Course")]);
      client.queueAssignments([gradedAssignmentPayload({ id: 11 }), second]);
      client.queueAnnouncements([]);
      client.queueCalendarEvents([]);
      await runCanvasConnectionSync(deps(), { connectionId, kind: "cron" });
      return await assignmentsFor(connectionId);
    }

    it("a score-only change updates exactly that row and leaves the other untouched", async () => {
      const connection = await seedCanvasConnection(db);
      const before = await syncTwoAssignments(
        connection.id,
        gradedAssignmentPayload({ id: 12, submission: { score: 80, grade: "B-" } }),
      );
      expect(before.map((a) => [a.canvasAssignmentId, a.score, a.grade])).toEqual([
        [11, 95, "A"],
        [12, 80, "B-"],
      ]);

      // Canvas regrades #12 from 80 to 88 -- same display grade string.
      const after = await syncTwoAssignments(
        connection.id,
        gradedAssignmentPayload({ id: 12, submission: { score: 88, grade: "B-" } }),
      );
      expect(after[1]).toMatchObject({ canvasAssignmentId: 12, score: 88, grade: "B-" });
      expect(after[1]!.updatedAt.getTime()).toBeGreaterThanOrEqual(before[1]!.updatedAt.getTime());
      // #11 was identical both passes: no write, no updated_at bump.
      expect(after[0]).toMatchObject({ canvasAssignmentId: 11, score: 95, grade: "A" });
      expect(after[0]!.updatedAt.getTime()).toBe(before[0]!.updatedAt.getTime());
    });

    it("a grade-only change updates exactly that row and leaves the other untouched", async () => {
      const connection = await seedCanvasConnection(db);
      const before = await syncTwoAssignments(
        connection.id,
        gradedAssignmentPayload({ id: 12, submission: { score: 90, grade: "A-" } }),
      );

      // Instructor changes the grading scheme: same points, new display grade.
      const after = await syncTwoAssignments(
        connection.id,
        gradedAssignmentPayload({ id: 12, submission: { score: 90, grade: "90%" } }),
      );
      expect(after[1]).toMatchObject({ canvasAssignmentId: 12, score: 90, grade: "90%" });
      expect(after[1]!.updatedAt.getTime()).toBeGreaterThanOrEqual(before[1]!.updatedAt.getTime());
      expect(after[0]!.updatedAt.getTime()).toBe(before[0]!.updatedAt.getTime());
    });

    it("first grading (null -> value) and un-grading (value -> null) are both changes", async () => {
      const connection = await seedCanvasConnection(db);
      const ungraded = await syncTwoAssignments(
        connection.id,
        gradedAssignmentPayload({
          id: 12,
          submission: { workflow_state: "submitted", score: null, grade: null },
        }),
      );
      expect(ungraded[1]).toMatchObject({ canvasAssignmentId: 12, score: null, grade: null });

      const graded = await syncTwoAssignments(
        connection.id,
        gradedAssignmentPayload({ id: 12, submission: { score: 72.5, grade: "C" } }),
      );
      expect(graded[1]).toMatchObject({ canvasAssignmentId: 12, score: 72.5, grade: "C" });
      expect(graded[1]!.updatedAt.getTime()).toBeGreaterThanOrEqual(
        ungraded[1]!.updatedAt.getTime(),
      );

      // A grade withdrawn (instructor unpublishes grades) must clear, not linger.
      const withdrawn = await syncTwoAssignments(
        connection.id,
        gradedAssignmentPayload({
          id: 12,
          submission: { workflow_state: "submitted", score: null, grade: null },
        }),
      );
      expect(withdrawn[1]).toMatchObject({ canvasAssignmentId: 12, score: null, grade: null });
      expect(withdrawn[1]!.updatedAt.getTime()).toBeGreaterThanOrEqual(
        graded[1]!.updatedAt.getTime(),
      );
    });
  });

  it("archives a course removed from Canvas on the NEXT authoritative pass", async () => {
    const connection = await seedCanvasConnection(db);

    client.queueActiveCourses([course(401, "Course A"), course(402, "Course B")]);
    client.queueAssignments([]);
    client.queueAnnouncements([]);
    client.queueCalendarEvents([]);
    client.queueAssignments([]);
    client.queueAnnouncements([]);
    client.queueCalendarEvents([]);
    await runCanvasConnectionSync(deps(), { connectionId: connection.id, kind: "cron" });

    // Course B drops off the list (dropped, term ended, etc).
    client.queueActiveCourses([course(401, "Course A")]);
    client.queueAssignments([]);
    client.queueAnnouncements([]);
    client.queueCalendarEvents([]);
    const result = await runCanvasConnectionSync(deps(), {
      connectionId: connection.id,
      kind: "cron",
    });

    expect(result.coursesArchived).toBe(1);
    const stored = await coursesFor(connection.id);
    const courseA = stored.find((c) => c.canvasCourseId === 401);
    const courseB = stored.find((c) => c.canvasCourseId === 402);
    expect(courseA?.archivedAt).toBeNull();
    expect(courseB?.archivedAt).not.toBeNull();
  });

  it("does NOT archive a course's assignments when that course's OWN fetch failed this round", async () => {
    const connection = await seedCanvasConnection(db);

    // First pass: course 501 has one assignment, fully authoritative.
    client.queueActiveCourses([course(501, "Course With Homework")]);
    client.queueAssignments([{ id: 7, name: "HW7" }]);
    client.queueAnnouncements([]);
    client.queueCalendarEvents([]);
    await runCanvasConnectionSync(deps(), { connectionId: connection.id, kind: "cron" });

    const [before] = await db
      .select({ archivedAt: canvasAssignments.archivedAt })
      .from(canvasAssignments)
      .where(eq(canvasAssignments.connectionId, connection.id));
    expect(before?.archivedAt).toBeNull();

    // Second pass: the course is still listed, but its assignments call
    // throws (a transient provider error) -- Canvas never actually said the
    // assignment is gone.
    client.queueActiveCourses([course(501, "Course With Homework")]);
    client.queueAssignments(new CanvasApiError(503, "provider_error"));

    const result = await runCanvasConnectionSync(deps(), {
      connectionId: connection.id,
      kind: "cron",
    });
    expect(result.coursesFailed).toBe(1);
    expect(result.assignmentsArchived).toBe(0);

    const [after] = await db
      .select({ archivedAt: canvasAssignments.archivedAt })
      .from(canvasAssignments)
      .where(eq(canvasAssignments.connectionId, connection.id));
    // Still NOT archived: a failed fetch is not evidence of absence.
    expect(after?.archivedAt).toBeNull();
  });

  it("skips a non-active connection and writes no run row", async () => {
    const connection = await seedCanvasConnection(db, { status: "disconnected" });
    const result = await runCanvasConnectionSync(deps(), {
      connectionId: connection.id,
      kind: "cron",
    });
    expect(result.skipped).toBe("connection_not_active");
    expect(result.runWritten).toBe(false);
    expect(await runsFor(connection.id)).toHaveLength(0);
  });

  it("closes the run as failed, and never as succeeded, when the course LIST itself fails", async () => {
    const connection = await seedCanvasConnection(db);
    client.queueActiveCourses(new CanvasApiError(401, "auth_failed"));

    const result = await runCanvasConnectionSync(deps(), {
      connectionId: connection.id,
      kind: "cron",
    });
    expect(result.failureClass).toBe("auth_failed");

    const runs = await runsFor(connection.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe("failed");
    expect(runs[0]?.failureClass).toBe("auth_failed");
  });
});

// Checkpoint 10.2: closing the 10.1C "recorded, not fixed" debt. `invalid_token`
// was a CHECK-enforced member of `canvas_connections.status` that no production
// code path ever wrote, so a revoked PAT left the row `active` while sync failed
// quietly into `last_sync_error` -- and the 10.1C reconnect guard's `status ===
// 'active'` refusal then blocked the owner from pasting a fresh PAT without an
// explicit disconnect first. The mail precedent is `markMailConnectionNeedsReauth`
// (apps/worker/src/mail/token.ts): status + error columns in ONE update,
// conditional on `status = 'active'`.
//
// Checkpoint 10.4 (ADR-073) adds two-consecutive-failure hysteresis on top of
// that flip, plus the one deduped push alert it gates: a single connection-
// level auth_failed is absorbed (10.2's own recorded debt -- see
// `isSecondConsecutiveAuthFailure`'s doc comment in orchestrate.ts); only a
// SECOND CONSECUTIVE one flips status and alerts.
describe("runCanvasConnectionSync -- invalid_token hysteresis on a connection-level auth failure (Checkpoint 10.4, ADR-073)", () => {
  it("a single connection-level auth_failed records the error but does NOT flip status or alert", async () => {
    const connection = await seedCanvasConnection(db);
    const boss = fakeBoss();

    client.queueActiveCourses(new CanvasApiError(401, "auth_failed"));
    const result = await runCanvasConnectionSync(deps({ boss: boss as unknown as PgBoss }), {
      connectionId: connection.id,
      kind: "cron",
    });
    expect(result.failureClass).toBe("auth_failed");

    const after = await connectionRow(connection.id);
    // Absorbed as a blip: still active, only the error columns record it.
    expect(after.status).toBe("active");
    expect(after.lastSyncError).toBe("auth_failed");
    expect(() => CanvasSyncTokenSchema.parse(after.lastSyncError)).not.toThrow();
    expect(after.lastSyncErrorAt?.toISOString()).toBe(NOW.toISOString());
    expect(after.accessTokenCiphertext).not.toBeNull();

    const runs = await runsFor(connection.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "failed", failureClass: "auth_failed" });
    expect(alertCallsOf(boss)).toHaveLength(0);
  });

  it("also does NOT flip on a single non-rate-limit 403 on the course list (classified auth_failed by the client)", async () => {
    const connection = await seedCanvasConnection(db);
    client.queueActiveCourses(new CanvasApiError(403, "auth_failed"));
    await runCanvasConnectionSync(deps(), { connectionId: connection.id, kind: "cron" });
    const after = await connectionRow(connection.id);
    expect(after.status).toBe("active");
    expect(after.lastSyncError).toBe("auth_failed");
  });

  it("a SECOND CONSECUTIVE connection-level auth_failed flips status to invalid_token, leaves the credential triple untouched, and enqueues exactly one alert", async () => {
    const connection = await seedCanvasConnection(db);
    const before = await connectionRow(connection.id);
    const boss = fakeBoss();
    await insertEligibleDevice();

    // First failure -- absorbed.
    client.queueActiveCourses(new CanvasApiError(401, "auth_failed"));
    await runCanvasConnectionSync(deps({ boss: boss as unknown as PgBoss }), {
      connectionId: connection.id,
      kind: "cron",
    });
    expect((await connectionRow(connection.id)).status).toBe("active");
    expect(alertCallsOf(boss)).toHaveLength(0);

    // Second, CONSECUTIVE failure, one minute later -- so the two run rows
    // order deterministically by started_at (the 10.2 reactivation test's
    // own convention for avoiding a tie).
    const LATER = new Date(NOW.getTime() + 60_000);
    client.queueActiveCourses(new CanvasApiError(401, "auth_failed"));
    const result = await runCanvasConnectionSync(
      deps({ now: () => LATER, boss: boss as unknown as PgBoss }),
      { connectionId: connection.id, kind: "cron" },
    );
    expect(result.failureClass).toBe("auth_failed");

    const after = await connectionRow(connection.id);
    expect(after.status).toBe("invalid_token");
    expect(after.lastSyncError).toBe("auth_failed");
    expect(() => CanvasSyncTokenSchema.parse(after.lastSyncError)).not.toThrow();
    expect(after.lastSyncErrorAt?.toISOString()).toBe(LATER.toISOString());
    expect(after.updatedAt.toISOString()).toBe(LATER.toISOString());

    // NOT disconnect's job: the ciphertext/iv/auth-tag are byte-identical
    // (bytea columns, so compared by value). Nulling them belongs to the
    // API's disconnect; the 10.1C reconnect path replaces them when the
    // owner pastes a fresh PAT.
    expect(after.accessTokenCiphertext).toStrictEqual(before.accessTokenCiphertext);
    expect(after.accessTokenIv).toStrictEqual(before.accessTokenIv);
    expect(after.accessTokenAuthTag).toStrictEqual(before.accessTokenAuthTag);
    expect(after.accessTokenCiphertext).not.toBeNull();

    // Both run rows tell the truth about both attempts.
    const runs = await runsFor(connection.id);
    expect(runs).toHaveLength(2);
    expect(runs.every((r) => r.status === "failed" && r.failureClass === "auth_failed")).toBe(true);

    // Exactly one alert, deduped on the episode THIS second failure opened.
    const alerts = alertCallsOf(boss);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]![1]).toMatchObject({
      category: "alert",
      title: "Canvas needs reconnecting",
      body: "Assignment sync has stopped. Reconnect it in Settings.",
      dedupeKey: `canvas-invalid-token:${connection.id}:${LATER.toISOString()}`,
      data: { canvasConnectionId: connection.id },
    });
  });

  it("a non-auth_failed failure in between resets the streak -- two auth_failed runs separated by a provider_error do not flip status", async () => {
    const connection = await seedCanvasConnection(db);

    client.queueActiveCourses(new CanvasApiError(401, "auth_failed"));
    await runCanvasConnectionSync(deps(), { connectionId: connection.id, kind: "cron" });

    const MID = new Date(NOW.getTime() + 60_000);
    client.queueActiveCourses(new CanvasApiError(503, "provider_error"));
    await runCanvasConnectionSync(deps({ now: () => MID }), {
      connectionId: connection.id,
      kind: "cron",
    });
    expect((await connectionRow(connection.id)).lastSyncError).toBe("provider_error");

    const LATER = new Date(NOW.getTime() + 120_000);
    client.queueActiveCourses(new CanvasApiError(401, "auth_failed"));
    await runCanvasConnectionSync(deps({ now: () => LATER }), {
      connectionId: connection.id,
      kind: "cron",
    });

    // The run immediately preceding this one was provider_error, not
    // auth_failed, so this third failure is treated as a FIRST occurrence
    // again -- the streak did not carry across the intervening failure.
    const after = await connectionRow(connection.id);
    expect(after.status).toBe("active");
    expect(after.lastSyncError).toBe("auth_failed");

    expect(await runsFor(connection.id)).toHaveLength(3);
  });

  it("does NOT flip status on a transient provider_error (5xx) -- only last_sync_error is recorded", async () => {
    const connection = await seedCanvasConnection(db);
    client.queueActiveCourses(new CanvasApiError(503, "provider_error"));

    const result = await runCanvasConnectionSync(deps(), {
      connectionId: connection.id,
      kind: "cron",
    });
    expect(result.failureClass).toBe("provider_error");

    const after = await connectionRow(connection.id);
    expect(after.status).toBe("active");
    expect(after.lastSyncError).toBe("provider_error");
    expect(after.lastSyncErrorAt?.toISOString()).toBe(NOW.toISOString());
  });

  it("does NOT flip status on a rate limit or a network error either", async () => {
    for (const scripted of [
      new CanvasApiError(429, "rate_limited"),
      new CanvasApiError(403, "rate_limited"),
    ]) {
      const connection = await seedCanvasConnection(db);
      client.queueActiveCourses(scripted);
      await runCanvasConnectionSync(deps(), { connectionId: connection.id, kind: "cron" });
      const after = await connectionRow(connection.id);
      expect(after.status).toBe("active");
      expect(after.lastSyncError).toBe("rate_limited");
    }
  });

  it("does NOT flip status on a PER-COURSE auth_failed -- one unenrolled course cannot invalidate the connection", async () => {
    const connection = await seedCanvasConnection(db);
    client.queueActiveCourses([course(601, "Restricted Course"), course(602, "Open Course")]);
    // Course 601's child fetch 403s (the token lacks access to that course).
    client.queueAssignments(new CanvasApiError(403, "auth_failed"));
    // Course 602 is fine.
    client.queueAssignments([]);
    client.queueAnnouncements([]);
    client.queueCalendarEvents([]);

    const result = await runCanvasConnectionSync(deps(), {
      connectionId: connection.id,
      kind: "cron",
    });
    expect(result.coursesFailed).toBe(1);
    expect(result.failureClass).toBeNull();

    const after = await connectionRow(connection.id);
    expect(after.status).toBe("active");
    // The pass as a whole succeeded, so the connection-level error was CLEARED.
    expect(after.lastSyncError).toBeNull();
  });

  it("a later sync of an invalid_token connection is skipped as connection_not_active and writes no run row", async () => {
    const connection = await seedCanvasConnection(db);
    client.queueActiveCourses(new CanvasApiError(401, "auth_failed"));
    await runCanvasConnectionSync(deps(), { connectionId: connection.id, kind: "cron" });
    const SECOND = new Date(NOW.getTime() + 60_000);
    client.queueActiveCourses(new CanvasApiError(401, "auth_failed"));
    await runCanvasConnectionSync(deps({ now: () => SECOND }), {
      connectionId: connection.id,
      kind: "cron",
    });
    expect((await connectionRow(connection.id)).status).toBe("invalid_token");

    // A job that was already queued when the status flipped (or a manual
    // trigger racing the cron) must no-op, never throw, and never make a
    // provider call with the dead token -- nothing further is queued on the
    // fake, so any call would fail loudly.
    const third = await runCanvasConnectionSync(deps({ now: () => SECOND }), {
      connectionId: connection.id,
      kind: "manual",
    });
    expect(third.skipped).toBe("connection_not_active");
    expect(third.runWritten).toBe(false);
    expect(await runsFor(connection.id)).toHaveLength(2);
    expect(client.callsFor("listActiveCourses")).toHaveLength(2);
  });

  it("a successful sync after the API reactivates the row leaves status active and clears the error", async () => {
    const connection = await seedCanvasConnection(db);
    client.queueActiveCourses(new CanvasApiError(401, "auth_failed"));
    await runCanvasConnectionSync(deps(), { connectionId: connection.id, kind: "cron" });
    const SECOND = new Date(NOW.getTime() + 60_000);
    client.queueActiveCourses(new CanvasApiError(401, "auth_failed"));
    await runCanvasConnectionSync(deps({ now: () => SECOND }), {
      connectionId: connection.id,
      kind: "cron",
    });
    expect((await connectionRow(connection.id)).status).toBe("invalid_token");

    // What apps/api/src/services/canvas-connection.ts's reconnect path writes
    // for a prior NON-active row: a fresh credential triple, status active,
    // error cleared, same id. Reproduced here rather than imported -- the
    // worker never imports from apps/api.
    const fresh = encryptSecret("fresh-canvas-pat", env.CREDENTIALS_ENCRYPTION_KEY);
    await db
      .update(canvasConnections)
      .set({
        accessTokenCiphertext: fresh.ciphertext,
        accessTokenIv: fresh.iv,
        accessTokenAuthTag: fresh.authTag,
        status: "active",
        lastSyncError: null,
        lastSyncErrorAt: null,
      })
      .where(eq(canvasConnections.id, connection.id));

    // A third, later instant, so all three run rows order deterministically
    // by `started_at` (a shared instant would fall back to uuid order).
    const THIRD = new Date(NOW.getTime() + 120_000);
    client.queueActiveCourses([course(701, "Back Online")]);
    client.queueAssignments([gradedAssignmentPayload({ id: 71 })]);
    client.queueAnnouncements([]);
    client.queueCalendarEvents([]);
    const result = await runCanvasConnectionSync(deps({ now: () => THIRD }), {
      connectionId: connection.id,
      kind: "manual",
    });
    expect(result.skipped).toBeNull();
    expect(result.coursesSeen).toBe(1);

    const after = await connectionRow(connection.id);
    expect(after.status).toBe("active");
    expect(after.lastSyncError).toBeNull();
    expect(after.lastSyncErrorAt).toBeNull();
    expect(after.lastSyncAt?.toISOString()).toBe(THIRD.toISOString());
    // The fresh PAT is what was sent, not the stale one.
    expect(client.callsFor("listActiveCourses").at(-1)?.token).toBe("fresh-canvas-pat");

    const runs = await runsFor(connection.id);
    expect(runs.map((r) => r.status)).toEqual(["failed", "failed", "succeeded"]);
  });

  it("does NOT resurrect a row a concurrent disconnect just set to disconnected (the status = 'active' predicate), and does not alert an episode that never took", async () => {
    const connection = await seedCanvasConnection(db);
    const boss = fakeBoss();

    // First failure, ordinary -- establishes the streak the race then rides.
    client.queueActiveCourses(new CanvasApiError(401, "auth_failed"));
    await runCanvasConnectionSync(deps({ boss: boss as unknown as PgBoss }), {
      connectionId: connection.id,
      kind: "cron",
    });
    expect((await connectionRow(connection.id)).status).toBe("active");

    // Simulate the race on the SECOND, consecutive attempt: the owner
    // disconnects between the pass's re-read of the row (status active) and
    // the provider rejecting the token.
    const racing: CanvasClient = {
      ...client,
      listActiveCourses: async (baseUrl, token) => {
        await db
          .update(canvasConnections)
          .set({
            status: "disconnected",
            accessTokenCiphertext: null,
            accessTokenIv: null,
            accessTokenAuthTag: null,
          })
          .where(eq(canvasConnections.id, connection.id));
        return client.listActiveCourses(baseUrl, token);
      },
    };
    const LATER = new Date(NOW.getTime() + 60_000);
    client.queueActiveCourses(new CanvasApiError(401, "auth_failed"));

    const result = await runCanvasConnectionSync(
      deps({ client: racing, now: () => LATER, boss: boss as unknown as PgBoss }),
      { connectionId: connection.id, kind: "cron" },
    );
    expect(result.failureClass).toBe("auth_failed");

    const after = await connectionRow(connection.id);
    // Still disconnected -- NOT flipped to invalid_token. This IS the second
    // consecutive auth_failed, so `markConnectionInvalidToken` is the only
    // write attempted (not `recordConnectionError`) -- and its `status =
    // 'active'` predicate matches zero rows against the now-disconnected row,
    // so `last_sync_error`/`last_sync_error_at` are left exactly as the FIRST
    // failure wrote them, never re-stamped with LATER.
    expect(after.status).toBe("disconnected");
    expect(after.accessTokenCiphertext).toBeNull();
    expect(after.lastSyncError).toBe("auth_failed");
    expect(after.lastSyncErrorAt?.toISOString()).toBe(NOW.toISOString());

    // The alert producer re-selects the connection fresh and finds it is not
    // invalid_token -- no episode to alert about.
    expect(alertCallsOf(boss)).toHaveLength(0);
  });
});

// Checkpoint 10.2 privacy rule: no log line may carry a score, a grade, a
// title or a URL -- counts, ids and closed-vocabulary tokens only, matching
// the existing `canvas.sync.*` lines. Asserted on the RECORDS the shared
// logger builds (the sink), not on stdout, per packages/core's own logger
// test convention.
describe("runCanvasConnectionSync -- log lines carry no academic content", () => {
  let records: Record<string, unknown>[];
  let restore: () => void;

  beforeEach(() => {
    records = [];
    restore = setLogSink({ write: (_level, record) => records.push(record) });
  });
  afterEach(() => {
    restore();
  });

  const FORBIDDEN_KEY = /score|grade|title|url|name|message|description/i;

  function assertNoAcademicContent(sensitive: readonly (string | number)[]) {
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      for (const [key, value] of Object.entries(record)) {
        expect(key, `log field "${key}" in ${String(record["event"])}`).not.toMatch(FORBIDDEN_KEY);
        for (const s of sensitive) {
          expect(value, `log field "${key}" in ${String(record["event"])}`).not.toBe(s);
          if (typeof value === "string" && typeof s === "string") {
            expect(value.includes(s), `log field "${key}" contains fixture text`).toBe(false);
          }
        }
      }
    }
  }

  it("a graded sync logs counts only -- never the score, grade, title or html_url", async () => {
    const connection = await seedCanvasConnection(db);
    const graded = gradedAssignmentPayload({
      id: 81,
      name: "Midterm Essay",
      html_url: "https://fixture.instructure.com/courses/801/assignments/81",
      submission: { score: 87.5, grade: "B+" },
    });
    client.queueActiveCourses([course(801, "Privacy Course")]);
    client.queueAssignments([graded]);
    client.queueAnnouncements([]);
    client.queueCalendarEvents([]);

    await runCanvasConnectionSync(deps(), { connectionId: connection.id, kind: "cron" });

    expect(records.map((r) => r["event"])).toEqual(["canvas.sync.started", "canvas.sync.finished"]);
    assertNoAcademicContent([
      87.5,
      "B+",
      "Midterm Essay",
      "Privacy Course",
      "https://fixture.instructure.com/courses/801/assignments/81",
    ]);
    // The finished line is the counts it always was.
    const finished = records[1]!;
    expect(finished).toMatchObject({ coursesSeen: 1, assignmentsSynced: 1 });
  });

  it("an invalidated connection logs the classification token and the connection id only, and only on the SECOND consecutive failure", async () => {
    const connection = await seedCanvasConnection(db);
    client.queueActiveCourses(new CanvasApiError(401, "auth_failed"));
    await runCanvasConnectionSync(deps(), { connectionId: connection.id, kind: "cron" });

    // First failure: absorbed, no invalidation event yet.
    expect(records.map((r) => r["event"])).toEqual(["canvas.sync.started", "canvas.sync.failed"]);
    const countAfterFirst = records.length;

    const LATER = new Date(NOW.getTime() + 60_000);
    client.queueActiveCourses(new CanvasApiError(401, "auth_failed"));
    await runCanvasConnectionSync(deps({ now: () => LATER }), {
      connectionId: connection.id,
      kind: "cron",
    });

    const secondPass = records.slice(countAfterFirst);
    expect(secondPass.map((r) => r["event"])).toEqual([
      "canvas.sync.started",
      "canvas.sync.connection_invalidated",
      "canvas.sync.failed",
    ]);
    const invalidated = secondPass[1]!;
    expect(Object.keys(invalidated).sort()).toEqual(
      ["connectionId", "event", "failureClass", "level", "ts"].sort(),
    );
    expect(invalidated["failureClass"]).toBe("auth_failed");
    assertNoAcademicContent(["test-canvas-pat"]);
  });
});
