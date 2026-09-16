import { canvasAssignments, type Db } from "@personal-os/db";
import { translateCanvasAssignment, type CanvasAssignmentRow } from "@personal-os/canvas-providers";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestDb } from "../test/build-test-db.js";
import { upsertCanvasAssignments, upsertCanvasCourse } from "./persist.js";
import {
  gradedAssignmentPayload,
  seedCanvasConnection,
  truncateCanvasTestTables,
} from "./test-fixtures.js";

// Checkpoint 10.2 (ADR-068a): the setWhere gate over `score` and `grade`.
//
// Asserted on the RETURNED COUNTS (`inserted`/`updated`/`unchanged`), the
// apps/worker/src/mail/persist.test.ts convention, because the counts are a
// deterministic statement of what the statement did -- an `updated_at`
// comparison would be a database-clock assertion. `unchanged` is derived
// from "the statement returned no row for it", which is exactly what
// `setWhere` produces when every `is distinct from` predicate is false.

const db: Db = buildTestDb();

beforeEach(async () => {
  await truncateCanvasTestTables(db);
});

afterAll(async () => {
  await truncateCanvasTestTables(db);
  await db.$client.end();
});

function row(payload: ReturnType<typeof gradedAssignmentPayload>): CanvasAssignmentRow {
  const result = translateCanvasAssignment(payload, 1);
  if (!result.ok) throw new Error(`fixture failed translation: ${result.rejection.keyPath}`);
  return result.row;
}

async function seedCourse(connectionId: string): Promise<string> {
  const course = await upsertCanvasCourse(db, {
    connectionId,
    row: {
      externalId: "1",
      name: "Persist Course",
      courseCode: "P-1",
      termName: null,
      termStartAt: null,
      termEndAt: null,
      enrollmentState: "active",
      workflowState: "available",
      htmlUrl: null,
    },
  });
  return course.id;
}

async function stored(connectionId: string) {
  return await db
    .select({
      canvasAssignmentId: canvasAssignments.canvasAssignmentId,
      score: canvasAssignments.score,
      grade: canvasAssignments.grade,
    })
    .from(canvasAssignments)
    .where(eq(canvasAssignments.connectionId, connectionId))
    .orderBy(asc(canvasAssignments.canvasAssignmentId));
}

describe("upsertCanvasAssignments -- score/grade in the setWhere gate", () => {
  it("stores score and grade on insert, and an identical second pass writes ZERO rows", async () => {
    const connection = await seedCanvasConnection(db);
    const courseId = await seedCourse(connection.id);
    const rows = [
      row(gradedAssignmentPayload({ id: 1 })),
      row(gradedAssignmentPayload({ id: 2, submission: { score: null, grade: null } })),
    ];

    const first = await upsertCanvasAssignments(db, {
      connectionId: connection.id,
      courseId,
      rows,
    });
    expect(first).toEqual({ inserted: 2, updated: 0, unchanged: 0 });
    expect(await stored(connection.id)).toEqual([
      { canvasAssignmentId: 1, score: 95, grade: "A" },
      { canvasAssignmentId: 2, score: null, grade: null },
    ]);

    const second = await upsertCanvasAssignments(db, {
      connectionId: connection.id,
      courseId,
      rows,
    });
    expect(second).toEqual({ inserted: 0, updated: 0, unchanged: 2 });
  });

  it("a score-only change updates exactly that row", async () => {
    const connection = await seedCanvasConnection(db);
    const courseId = await seedCourse(connection.id);
    await upsertCanvasAssignments(db, {
      connectionId: connection.id,
      courseId,
      rows: [row(gradedAssignmentPayload({ id: 1 })), row(gradedAssignmentPayload({ id: 2 }))],
    });

    const counts = await upsertCanvasAssignments(db, {
      connectionId: connection.id,
      courseId,
      rows: [
        row(gradedAssignmentPayload({ id: 1 })),
        row(gradedAssignmentPayload({ id: 2, submission: { score: 88 } })),
      ],
    });
    expect(counts).toEqual({ inserted: 0, updated: 1, unchanged: 1 });
    expect(await stored(connection.id)).toEqual([
      { canvasAssignmentId: 1, score: 95, grade: "A" },
      { canvasAssignmentId: 2, score: 88, grade: "A" },
    ]);
  });

  it("a grade-only change updates exactly that row", async () => {
    const connection = await seedCanvasConnection(db);
    const courseId = await seedCourse(connection.id);
    await upsertCanvasAssignments(db, {
      connectionId: connection.id,
      courseId,
      rows: [row(gradedAssignmentPayload({ id: 1 })), row(gradedAssignmentPayload({ id: 2 }))],
    });

    const counts = await upsertCanvasAssignments(db, {
      connectionId: connection.id,
      courseId,
      rows: [
        row(gradedAssignmentPayload({ id: 1 })),
        row(gradedAssignmentPayload({ id: 2, submission: { grade: "95%" } })),
      ],
    });
    expect(counts).toEqual({ inserted: 0, updated: 1, unchanged: 1 });
    expect(await stored(connection.id)).toEqual([
      { canvasAssignmentId: 1, score: 95, grade: "A" },
      { canvasAssignmentId: 2, score: 95, grade: "95%" },
    ]);
  });

  it("null -> value (first grading) and value -> null (grade withdrawn) are both changes -- `is distinct from`, never `<>`", async () => {
    const connection = await seedCanvasConnection(db);
    const courseId = await seedCourse(connection.id);
    const ungraded = row(
      gradedAssignmentPayload({
        id: 1,
        submission: { workflow_state: "submitted", score: null, grade: null },
      }),
    );
    const graded = row(gradedAssignmentPayload({ id: 1, submission: { score: 72.5, grade: "C" } }));

    await upsertCanvasAssignments(db, { connectionId: connection.id, courseId, rows: [ungraded] });

    const firstGrading = await upsertCanvasAssignments(db, {
      connectionId: connection.id,
      courseId,
      rows: [graded],
    });
    expect(firstGrading).toEqual({ inserted: 0, updated: 1, unchanged: 0 });
    expect(await stored(connection.id)).toEqual([
      { canvasAssignmentId: 1, score: 72.5, grade: "C" },
    ]);

    const withdrawn = await upsertCanvasAssignments(db, {
      connectionId: connection.id,
      courseId,
      rows: [ungraded],
    });
    expect(withdrawn).toEqual({ inserted: 0, updated: 1, unchanged: 0 });
    expect(await stored(connection.id)).toEqual([
      { canvasAssignmentId: 1, score: null, grade: null },
    ]);
  });

  it("a fractional score round-trips through the `real` column and stays unchanged on re-sync", async () => {
    const connection = await seedCanvasConnection(db);
    const courseId = await seedCourse(connection.id);
    // Canvas scores are half-point granular in practice; `real` (float4)
    // represents these exactly, so a re-sync compares equal and writes nothing.
    const rows = [
      row(gradedAssignmentPayload({ id: 1, submission: { score: 87.5, grade: "B+" } })),
    ];
    await upsertCanvasAssignments(db, { connectionId: connection.id, courseId, rows });
    const again = await upsertCanvasAssignments(db, {
      connectionId: connection.id,
      courseId,
      rows,
    });
    expect(again).toEqual({ inserted: 0, updated: 0, unchanged: 1 });
    expect(await stored(connection.id)).toEqual([
      { canvasAssignmentId: 1, score: 87.5, grade: "B+" },
    ]);
  });
});
