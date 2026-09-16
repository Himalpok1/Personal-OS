import { encryptSecret } from "@personal-os/ai-providers";
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
