import { encryptSecret } from "@personal-os/ai-providers";
import type { CanvasAssignmentApiShape } from "@personal-os/canvas-providers";
import {
  canvasAnnouncements,
  canvasAssignments,
  canvasConnections,
  canvasCourses,
  canvasEvents,
  canvasSyncRuns,
  type Db,
} from "@personal-os/db";
import { env } from "../env.js";

// Fixtures for the Canvas sync tests (ADR-068), mirroring
// apps/worker/src/test/mail-fixtures.ts's convention: builds connections
// through the REAL encryption path rather than stubbing it, since
// `runCanvasConnectionSync` decrypts what it finds -- a fixture writing
// plaintext would exercise a code path production never takes.

let seq = 0;

export interface SeedCanvasConnectionOptions {
  status?: "active" | "disconnected" | "invalid_token";
  canvasBaseUrl?: string;
  canvasUserId?: number;
  canvasUserName?: string | null;
  accessToken?: string;
}

export async function seedCanvasConnection(
  db: Db,
  options: SeedCanvasConnectionOptions = {},
): Promise<typeof canvasConnections.$inferSelect> {
  seq += 1;
  const access = encryptSecret(
    options.accessToken ?? "test-canvas-pat",
    env.CREDENTIALS_ENCRYPTION_KEY,
  );
  const [row] = await db
    .insert(canvasConnections)
    .values({
      canvasBaseUrl: options.canvasBaseUrl ?? `https://fixture-${seq}.instructure.com`,
      canvasUserId: options.canvasUserId ?? seq,
      canvasUserName: options.canvasUserName ?? `Fixture User ${seq}`,
      accessTokenCiphertext: access.ciphertext,
      accessTokenIv: access.iv,
      accessTokenAuthTag: access.authTag,
      status: options.status ?? "active",
    })
    .returning();
  return row!;
}

/**
 * A GRADED assignment payload in the real shape the ADR-068 live probe
 * confirmed (`include[]=submission`), carrying every submission field Canvas
 * genuinely returns -- so a test that syncs it exercises both halves of
 * ADR-068a at once: `score`/`grade` DO land (Checkpoint 10.2), and
 * `entered_score`/`entered_grade`/`attachments` still do NOT. Overrides let
 * a test re-grade the same assignment id on a second pass.
 */
export function gradedAssignmentPayload(
  overrides: Partial<CanvasAssignmentApiShape> & {
    submission?: Partial<NonNullable<CanvasAssignmentApiShape["submission"]>>;
  } = {},
): CanvasAssignmentApiShape {
  const { submission, ...rest } = overrides;
  return {
    id: 9001,
    name: "Homework 3",
    due_at: "2026-09-20T05:59:00Z",
    points_possible: 100,
    submission_types: ["online_upload"],
    html_url: "https://fixture.instructure.com/courses/1/assignments/9001",
    published: true,
    workflow_state: "published",
    ...rest,
    submission: {
      workflow_state: "graded",
      missing: false,
      late: false,
      submitted_at: "2026-09-19T22:00:00Z",
      score: 95,
      grade: "A",
      entered_score: 95,
      entered_grade: "A",
      attachments: [{ id: 1, filename: "hw3.pdf" }],
      ...submission,
    },
  };
}

/**
 * Truncates every Canvas table this test suite touches.
 *
 * Deliberately local rather than added to
 * apps/worker/src/test/build-test-db.ts's shared `truncateTestTables` --
 * this checkpoint's scope is `apps/worker/src/canvas/` and one named job
 * file, and the tests here run against their own throwaway database clone
 * (see the checkpoint's own instructions), so a shared-helper edit is
 * neither needed for isolation nor in scope. FK order: sync runs, then the
 * three connection-scoped leaf tables, then courses, then connections.
 */
export async function truncateCanvasTestTables(db: Db): Promise<void> {
  await db.delete(canvasSyncRuns);
  await db.delete(canvasEvents);
  await db.delete(canvasAnnouncements);
  await db.delete(canvasAssignments);
  await db.delete(canvasCourses);
  await db.delete(canvasConnections);
}
