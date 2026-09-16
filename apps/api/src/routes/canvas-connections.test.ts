import { decryptSecret } from "@personal-os/ai-providers";
import {
  CanvasApiError,
  createCanvasClient,
  createFakeCanvasClient,
} from "@personal-os/canvas-providers";
import { canvasConnections, canvasCourses, canvasSyncRuns } from "@personal-os/db";
import { CanvasConnectionSchema } from "@personal-os/schema";
import { eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "../env.js";
import {
  connectCanvasConnection,
  CanvasUrlBlockedForConnectError,
} from "../services/canvas-connection.js";
import { buildTestApp } from "../test/build-test-app.js";

const BASE_URL = "https://uta.instructure.com";
const TOKEN = "1234~fakeCanvasPersonalAccessToken";

let app: FastifyInstance;
let fake: ReturnType<typeof createFakeCanvasClient>;

beforeAll(async () => {
  fake = createFakeCanvasClient();
  app = await buildTestApp({ canvasClient: fake });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  // canvas_courses/canvas_assignments/canvas_announcements/canvas_events/
  // canvas_sync_runs all reference canvas_connections with ON DELETE CASCADE
  // (packages/db/drizzle/0020_canvas_lms_integration.sql), so clearing the
  // one parent table is sufficient -- exactly the reasoning
  // truncateTestTables documents for its own FK-ordered deletes elsewhere.
  await app.db.delete(canvasConnections);
  // Dropped every queued response AND every recorded call, mirroring
  // mail-connections.test.ts's beforeEach exactly: a response queued by a
  // test that failed before consuming it would otherwise leak into the next
  // test's queue and pass for a call nobody intended to exercise.
  fake.reset();
});

async function connectOnce(
  opts: {
    baseUrl?: string;
    token?: string;
    self?: Parameters<typeof fake.queueSelf>[0];
  } = {},
) {
  fake.queueSelf(opts.self ?? { id: 555, name: "Jane Q. Student", short_name: "Jane" });
  return await app.inject({
    method: "POST",
    url: "/canvas-connections",
    payload: {
      base_url: opts.baseUrl ?? BASE_URL,
      personal_access_token: opts.token ?? TOKEN,
    },
  });
}

// ---------------------------------------------------------------------------
// Connect
// ---------------------------------------------------------------------------

describe("POST /canvas-connections", () => {
  it("verifies the token against Canvas BEFORE persisting, then connects", async () => {
    const res = await connectOnce();
    expect(res.statusCode).toBe(201);
    const body = res.json<{
      canvas_base_url: string;
      canvas_user_id: number;
      canvas_user_name: string | null;
      status: string;
    }>();
    expect(body.canvas_base_url).toBe(BASE_URL);
    expect(body.canvas_user_id).toBe(555);
    // short_name preferred over name.
    expect(body.canvas_user_name).toBe("Jane");
    expect(body.status).toBe("active");
    expect(fake.callsFor("getSelf")).toHaveLength(1);
  });

  it("falls back to `name` when Canvas returns no short_name", async () => {
    const res = await connectOnce({ self: { id: 1, name: "Only Name" } });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ canvas_user_name: string | null }>().canvas_user_name).toBe("Only Name");
  });

  it("ENCRYPTS the token and stores no plaintext", async () => {
    await connectOnce();
    const [row] = await app.db.select().from(canvasConnections);
    expect(row).toBeDefined();
    expect(row!.accessTokenCiphertext).not.toBeNull();
    expect(row!.accessTokenIv).not.toBeNull();
    expect(row!.accessTokenAuthTag).not.toBeNull();

    const raw = JSON.stringify(row);
    expect(raw).not.toContain(TOKEN);

    expect(
      decryptSecret(
        {
          ciphertext: row!.accessTokenCiphertext!,
          iv: row!.accessTokenIv!,
          authTag: row!.accessTokenAuthTag!,
        },
        env.CREDENTIALS_ENCRYPTION_KEY,
      ),
    ).toBe(TOKEN);
  });

  it("strips a trailing slash so the same institution is not double-connectable", async () => {
    const first = await connectOnce({ baseUrl: BASE_URL });
    expect(first.statusCode).toBe(201);
    const second = await connectOnce({ baseUrl: `${BASE_URL}/`, token: "another-token" });
    expect(second.statusCode).toBe(409);
    expect(await app.db.select().from(canvasConnections)).toHaveLength(1);
  });

  describe("bad auth", () => {
    it("maps a Canvas auth failure to 400 canvas_auth_failed WITHOUT provider prose", async () => {
      fake.queueSelf(new CanvasApiError(401, "auth_failed"));
      const res = await app.inject({
        method: "POST",
        url: "/canvas-connections",
        payload: { base_url: BASE_URL, personal_access_token: "bad-token" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "canvas_auth_failed" });
      // Nothing is written until the token is verified.
      expect(await app.db.select().from(canvasConnections)).toHaveLength(0);
    });

    it("maps a rate-limited response to the same static auth-failure code", async () => {
      // The route does not distinguish CanvasApiError subclasses -- every
      // failure to verify the token is reported identically and nothing is
      // persisted, matching the mail/health "nothing written until identity
      // is verified" rule.
      fake.queueSelf(new CanvasApiError(403, "rate_limited"));
      const res = await app.inject({
        method: "POST",
        url: "/canvas-connections",
        payload: { base_url: BASE_URL, personal_access_token: "any-token" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "canvas_auth_failed" });
      expect(await app.db.select().from(canvasConnections)).toHaveLength(0);
    });
  });

  describe("duplicate base_url", () => {
    it("REJECTS a second connection to the SAME institution with 409", async () => {
      const first = await connectOnce();
      expect(first.statusCode).toBe(201);
      const firstRow = (await app.db.select().from(canvasConnections))[0]!;

      const second = await connectOnce({ token: "a-completely-different-token" });
      expect(second.statusCode).toBe(409);
      expect(second.json()).toEqual({ error: "canvas_already_connected" });

      // The first row's credential is untouched -- a duplicate connect never
      // silently overwrites an existing connection's token.
      const rows = await app.db.select().from(canvasConnections);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.id).toBe(firstRow.id);
      expect(rows[0]!.accessTokenCiphertext).toEqual(firstRow.accessTokenCiphertext);
    });
  });

  it("rejects a malformed body (bad base_url) as validation_failed", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/canvas-connections",
      payload: { base_url: "not-a-url", personal_access_token: "x" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe("validation_failed");
    expect(fake.callsFor("getSelf")).toHaveLength(0);
  });

  it("rejects an unknown body field", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/canvas-connections",
      payload: { base_url: BASE_URL, personal_access_token: TOKEN, extra: "nope" },
    });
    expect(res.statusCode).toBe(400);
    expect(fake.callsFor("getSelf")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Reconnect after disconnect (Checkpoint 10.1C). Found live in production
// 10.1B: `canvas_connections_base_url_unique` carries no status filter, so
// the original blind-insert connect flow returned 409 for EVERY reconnect
// attempt once any row existed for that base_url, active or not -- the only
// recovery was deleting the row by hand. Fixed by having
// `connectCanvasConnection` look up a prior row by `canvas_base_url` first,
// exactly like `completeGmailConnection`/`completeHealthConnection` already
// do for their own identities, and REACTIVATE it when it is not active.
// ---------------------------------------------------------------------------

describe("reconnect after disconnect (Checkpoint 10.1C)", () => {
  it("reactivates the SAME row (not a new one) and returns 200, not 201", async () => {
    const first = await connectOnce();
    expect(first.statusCode).toBe(201);
    const firstId = first.json<{ id: string }>().id;

    await app.inject({ method: "POST", url: `/canvas-connections/${firstId}/disconnect` });

    const reconnect = await connectOnce({ token: "a-brand-new-token" });
    expect(reconnect.statusCode).toBe(200);
    const body = reconnect.json<{ id: string; status: string }>();
    expect(body.id).toBe(firstId);
    expect(body.status).toBe("active");

    const rows = await app.db.select().from(canvasConnections);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(firstId);
  });

  it("replaces the credential with the NEW token, not the old one", async () => {
    const first = await connectOnce({ token: "old-token-value" });
    const firstId = first.json<{ id: string }>().id;
    await app.inject({ method: "POST", url: `/canvas-connections/${firstId}/disconnect` });

    await connectOnce({ token: "new-token-value" });

    const [row] = await app.db
      .select()
      .from(canvasConnections)
      .where(eq(canvasConnections.id, firstId));
    expect(row!.accessTokenCiphertext).not.toBeNull();
    expect(
      decryptSecret(
        {
          ciphertext: row!.accessTokenCiphertext!,
          iv: row!.accessTokenIv!,
          authTag: row!.accessTokenAuthTag!,
        },
        env.CREDENTIALS_ENCRYPTION_KEY,
      ),
    ).toBe("new-token-value");
  });

  it("preserves created_at and prior synced course rows across the cycle", async () => {
    const first = await connectOnce();
    const firstId = first.json<{ id: string }>().id;
    const [beforeRow] = await app.db
      .select()
      .from(canvasConnections)
      .where(eq(canvasConnections.id, firstId));

    await app.db.insert(canvasCourses).values({
      connectionId: firstId,
      canvasCourseId: 4242,
      name: "Preserved Across Reconnect",
    });

    await app.inject({ method: "POST", url: `/canvas-connections/${firstId}/disconnect` });
    await connectOnce({ token: "reconnect-token" });

    const [afterRow] = await app.db
      .select()
      .from(canvasConnections)
      .where(eq(canvasConnections.id, firstId));
    expect(afterRow!.createdAt).toEqual(beforeRow!.createdAt);

    const courses = await app.db
      .select()
      .from(canvasCourses)
      .where(eq(canvasCourses.connectionId, firstId));
    expect(courses).toHaveLength(1);
    expect(courses[0]!.name).toBe("Preserved Across Reconnect");
  });

  it("clears any prior last_sync_error on reactivation", async () => {
    const first = await connectOnce();
    const firstId = first.json<{ id: string }>().id;
    await app.db
      .update(canvasConnections)
      .set({ lastSyncError: "auth_failed", lastSyncErrorAt: new Date() })
      .where(eq(canvasConnections.id, firstId));
    await app.inject({ method: "POST", url: `/canvas-connections/${firstId}/disconnect` });

    await connectOnce({ token: "fresh-token" });

    const [row] = await app.db
      .select()
      .from(canvasConnections)
      .where(eq(canvasConnections.id, firstId));
    expect(row!.lastSyncError).toBeNull();
    expect(row!.lastSyncErrorAt).toBeNull();
  });

  it("allows sync to be re-triggered after reconnect, with exactly one connection row throughout", async () => {
    const first = await connectOnce();
    const firstId = first.json<{ id: string }>().id;
    await app.inject({ method: "POST", url: `/canvas-connections/${firstId}/disconnect` });
    await connectOnce({ token: "post-reconnect-token" });

    const res = await app.inject({ method: "POST", url: `/canvas-connections/${firstId}/sync` });
    expect(res.statusCode).toBe(202);
    expect(await app.db.select().from(canvasConnections)).toHaveLength(1);
  });

  it("also reactivates from status 'invalid_token', not just 'disconnected'", async () => {
    // invalid_token is a real member of canvas_connections_status (the CHECK
    // constraint in packages/db/src/schema/canvas-connections.ts) even though
    // no production code path writes it today -- the reactivate branch keys
    // on "not active" rather than enumerating specific non-active statuses,
    // so this pins that it is genuinely status-agnostic rather than
    // coincidentally correct only for 'disconnected'.
    const first = await connectOnce();
    const firstId = first.json<{ id: string }>().id;
    await app.db
      .update(canvasConnections)
      .set({ status: "invalid_token" })
      .where(eq(canvasConnections.id, firstId));

    const reconnect = await connectOnce({ token: "recovered-token" });
    expect(reconnect.statusCode).toBe(200);
    expect(reconnect.json<{ id: string; status: string }>()).toMatchObject({
      id: firstId,
      status: "active",
    });
    expect(await app.db.select().from(canvasConnections)).toHaveLength(1);
  });

  it("still REFUSES a connect attempt while the connection is active (unchanged behavior)", async () => {
    const first = await connectOnce();
    expect(first.statusCode).toBe(201);
    // No disconnect in between.
    const second = await connectOnce({ token: "different-token" });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ error: "canvas_already_connected" });
  });

  describe("account mismatch", () => {
    it("REFUSES reactivation by a DIFFERENT Canvas user at the same institution", async () => {
      const first = await connectOnce({ self: { id: 111, name: "First User" } });
      const firstId = first.json<{ id: string }>().id;
      await app.inject({ method: "POST", url: `/canvas-connections/${firstId}/disconnect` });

      const mismatched = await connectOnce({
        self: { id: 222, name: "Different User" },
        token: "different-users-token",
      });
      expect(mismatched.statusCode).toBe(409);
      expect(mismatched.json()).toEqual({ error: "canvas_account_mismatch" });

      // The row is left exactly as disconnected -- no partial write.
      const [row] = await app.db
        .select()
        .from(canvasConnections)
        .where(eq(canvasConnections.id, firstId));
      expect(row!.status).toBe("disconnected");
      expect(row!.canvasUserId).toBe(111);
      expect(row!.accessTokenCiphertext).toBeNull();
    });

    it("allows reactivation by the SAME Canvas user (canvas_user_id unchanged)", async () => {
      const first = await connectOnce({ self: { id: 333, name: "Same User" } });
      const firstId = first.json<{ id: string }>().id;
      await app.inject({ method: "POST", url: `/canvas-connections/${firstId}/disconnect` });

      const reconnect = await connectOnce({
        self: { id: 333, name: "Same User" },
        token: "same-user-new-token",
      });
      expect(reconnect.statusCode).toBe(200);
    });
  });

  it("end-to-end: connect -> sync -> disconnect -> reconnect -> sync, exactly one connection throughout", async () => {
    const first = await connectOnce();
    const firstId = first.json<{ id: string }>().id;

    let syncRes = await app.inject({
      method: "POST",
      url: `/canvas-connections/${firstId}/sync`,
    });
    expect(syncRes.statusCode).toBe(202);

    await app.inject({ method: "POST", url: `/canvas-connections/${firstId}/disconnect` });
    const reconnect = await connectOnce({ token: "second-lifecycle-token" });
    expect(reconnect.statusCode).toBe(200);
    expect(reconnect.json<{ id: string }>().id).toBe(firstId);

    syncRes = await app.inject({ method: "POST", url: `/canvas-connections/${firstId}/sync` });
    expect(syncRes.statusCode).toBe(202);

    const rows = await app.db.select().from(canvasConnections);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("active");
  });
});

// ---------------------------------------------------------------------------
// SSRF protection at connect time (Checkpoint 10.1's own adversarial review
// finding). `FakeCanvasClient` is a scripted stub that never inspects its
// `baseUrl` argument, so it cannot exercise real URL validation -- these
// tests call `connectCanvasConnection` directly with the REAL client
// (`createCanvasClient`), whose `fetchFn` fails the test outright if it is
// ever invoked, proving validation happens before any network call.
// ---------------------------------------------------------------------------

describe("connect: SSRF protection", () => {
  it("rejects a metadata-IP base_url as CanvasUrlBlockedForConnectError, before any fetch", async () => {
    let fetchCalled = false;
    const realClient = createCanvasClient(() => {
      fetchCalled = true;
      return Promise.resolve(new Response("{}", { status: 200 }));
    });

    await expect(
      connectCanvasConnection({
        db: app.db,
        client: realClient,
        baseUrl: "https://169.254.169.254",
        token: TOKEN,
      }),
    ).rejects.toBeInstanceOf(CanvasUrlBlockedForConnectError);
    expect(fetchCalled).toBe(false);

    const rows = await app.db.select().from(canvasConnections);
    expect(rows).toHaveLength(0);
  });

  it("surfaces as 400 canvas_url_blocked through the real route (not the fake, deliberately)", async () => {
    // A second, throwaway app instance wired to the REAL client -- the only
    // way to exercise the route's own replyForError mapping for this error,
    // since the shared `app` in this file is wired to the scripted fake.
    let fetchCalled = false;
    const realClient = createCanvasClient(() => {
      fetchCalled = true;
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
    const realApp = await buildTestApp({ canvasClient: realClient });
    await realApp.ready();
    try {
      const res = await realApp.inject({
        method: "POST",
        url: "/canvas-connections",
        payload: { base_url: "http://169.254.169.254", personal_access_token: TOKEN },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "canvas_url_blocked" });
      expect(fetchCalled).toBe(false);
    } finally {
      await realApp.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

describe("read", () => {
  it("lists connections, always reporting configured: true", async () => {
    const empty = await app.inject({ method: "GET", url: "/canvas-connections" });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ configured: true, items: [] });

    await connectOnce();
    const res = await app.inject({ method: "GET", url: "/canvas-connections" });
    expect(res.json<{ items: unknown[] }>().items).toHaveLength(1);
  });

  it("404s an unknown connection id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/canvas-connections/11111111-1111-4111-8111-111111111111",
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not_found" });
  });

  it("gets a single connection by id", async () => {
    const created = (await connectOnce()).json<{ id: string }>();
    const res = await app.inject({ method: "GET", url: `/canvas-connections/${created.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ id: string }>().id).toBe(created.id);
  });
});

// ---------------------------------------------------------------------------
// Disconnect
// ---------------------------------------------------------------------------

describe("disconnect", () => {
  it("marks the connection disconnected and keeps the row", async () => {
    const created = (await connectOnce()).json<{ id: string }>();
    const res = await app.inject({
      method: "POST",
      url: `/canvas-connections/${created.id}/disconnect`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ status: string }>().status).toBe("disconnected");

    const [row] = await app.db
      .select()
      .from(canvasConnections)
      .where(eq(canvasConnections.id, created.id));
    expect(row!.status).toBe("disconnected");
  });

  it("clears the encrypted credential -- a disconnected row retains no usable token", async () => {
    const created = (await connectOnce()).json<{ id: string }>();
    await app.inject({ method: "POST", url: `/canvas-connections/${created.id}/disconnect` });

    const [row] = await app.db
      .select()
      .from(canvasConnections)
      .where(eq(canvasConnections.id, created.id));
    expect(row!.accessTokenCiphertext).toBeNull();
    expect(row!.accessTokenIv).toBeNull();
    expect(row!.accessTokenAuthTag).toBeNull();
  });

  it("is idempotent -- a repeated disconnect is safe", async () => {
    const created = (await connectOnce()).json<{ id: string }>();
    await app.inject({ method: "POST", url: `/canvas-connections/${created.id}/disconnect` });
    const again = await app.inject({
      method: "POST",
      url: `/canvas-connections/${created.id}/disconnect`,
    });
    expect(again.statusCode).toBe(200);
    expect(again.json<{ status: string }>().status).toBe("disconnected");
  });

  it("404s a disconnect for an unknown id", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/canvas-connections/11111111-1111-4111-8111-111111111111/disconnect",
    });
    expect(res.statusCode).toBe(404);
  });

  it("does NOT delete synced course/assignment/announcement/event rows (ADR-068)", async () => {
    const created = (await connectOnce()).json<{ id: string }>();
    await app.db.insert(canvasCourses).values({
      connectionId: created.id,
      canvasCourseId: 9001,
      name: "Intro to Testing",
    });

    await app.inject({ method: "POST", url: `/canvas-connections/${created.id}/disconnect` });

    const courses = await app.db
      .select()
      .from(canvasCourses)
      .where(eq(canvasCourses.connectionId, created.id));
    expect(courses).toHaveLength(1);
    expect(courses[0]!.name).toBe("Intro to Testing");
  });
});

// ---------------------------------------------------------------------------
// Sync trigger
// ---------------------------------------------------------------------------

describe("POST /canvas-connections/:id/sync", () => {
  it("404s an unknown connection id", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/canvas-connections/11111111-1111-4111-8111-111111111111/sync",
    });
    expect(res.statusCode).toBe(404);
  });

  it("409s connection_not_active for a disconnected connection", async () => {
    const created = (await connectOnce()).json<{ id: string }>();
    await app.inject({ method: "POST", url: `/canvas-connections/${created.id}/disconnect` });

    const res = await app.inject({ method: "POST", url: `/canvas-connections/${created.id}/sync` });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "connection_not_active", status: "disconnected" });
  });

  it("503s queue_unavailable when pg-boss is not ready", async () => {
    const created = (await connectOnce()).json<{ id: string }>();
    const wasReady = app.bossReady;
    app.bossReady = false;
    try {
      const res = await app.inject({
        method: "POST",
        url: `/canvas-connections/${created.id}/sync`,
      });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ error: "queue_unavailable" });
    } finally {
      app.bossReady = wasReady;
    }
  });

  it("enqueues one job and returns 202 { queued: true }", async () => {
    const created = (await connectOnce()).json<{ id: string }>();
    const res = await app.inject({ method: "POST", url: `/canvas-connections/${created.id}/sync` });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ queued: true });

    // `kind: 'manual'`, not `trigger` -- apps/worker's `CanvasSyncJobData`
    // (apps/worker/src/canvas/orchestrate.ts) reads `data.kind`, so this
    // pins the cross-process payload contract, not just that a job exists.
    const jobs = await app.db.execute(
      sql`select count(*)::int as count from pgboss.job
          where name = 'canvas.sync-connection'
            and data->>'connectionId' = ${created.id}
            and data->>'kind' = 'manual'`,
    );
    expect((jobs.rows[0] as { count: number }).count).toBeGreaterThanOrEqual(1);
  });

  it("a second immediate trigger upserts rather than erroring (stately policy)", async () => {
    const created = (await connectOnce()).json<{ id: string }>();
    const first = await app.inject({
      method: "POST",
      url: `/canvas-connections/${created.id}/sync`,
    });
    const second = await app.inject({
      method: "POST",
      url: `/canvas-connections/${created.id}/sync`,
    });
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(second.json()).toEqual({ queued: true });
  });
});

// ---------------------------------------------------------------------------
// Sync runs
// ---------------------------------------------------------------------------

describe("GET /canvas-connections/:id/sync-runs", () => {
  async function seedRuns(connectionId: string, count: number) {
    const base = Date.now();
    for (let i = 0; i < count; i++) {
      await app.db.insert(canvasSyncRuns).values({
        connectionId,
        kind: "manual",
        status: "succeeded",
        startedAt: new Date(base + i * 1000),
        finishedAt: new Date(base + i * 1000 + 500),
        coursesSynced: i,
        assignmentsSynced: i,
        announcementsSynced: i,
        eventsSynced: i,
      });
    }
  }

  it("404s an unknown connection id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/canvas-connections/11111111-1111-4111-8111-111111111111/sync-runs",
    });
    expect(res.statusCode).toBe(404);
  });

  it("defaults to 50, orders by started_at desc", async () => {
    const created = (await connectOnce()).json<{ id: string }>();
    await seedRuns(created.id, 3);

    const res = await app.inject({
      method: "GET",
      url: `/canvas-connections/${created.id}/sync-runs`,
    });
    expect(res.statusCode).toBe(200);
    const items = res.json<{ items: Array<{ courses_synced: number | null }> }>().items;
    expect(items).toHaveLength(3);
    // Most recently started first.
    expect(items[0]!.courses_synced).toBe(2);
    expect(items[2]!.courses_synced).toBe(0);
  });

  it("clamps limit below 1 up to 1", async () => {
    const created = (await connectOnce()).json<{ id: string }>();
    await seedRuns(created.id, 3);
    const res = await app.inject({
      method: "GET",
      url: `/canvas-connections/${created.id}/sync-runs?limit=0`,
    });
    expect(res.json<{ items: unknown[] }>().items).toHaveLength(1);
  });

  it("clamps limit above 200 down to 200", async () => {
    const created = (await connectOnce()).json<{ id: string }>();
    await seedRuns(created.id, 3);
    const res = await app.inject({
      method: "GET",
      url: `/canvas-connections/${created.id}/sync-runs?limit=99999`,
    });
    // Only 3 rows exist -- the clamp bounds the REQUEST, not the result size.
    expect(res.json<{ items: unknown[] }>().items).toHaveLength(3);
  });

  it("falls back to the default on a non-numeric limit", async () => {
    const created = (await connectOnce()).json<{ id: string }>();
    await seedRuns(created.id, 2);
    const res = await app.inject({
      method: "GET",
      url: `/canvas-connections/${created.id}/sync-runs?limit=not-a-number`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ items: unknown[] }>().items).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Wire safety
// ---------------------------------------------------------------------------

describe("API wire safety", () => {
  it("no credential-bearing field can appear in ANY canvas-connections response", async () => {
    const created = (await connectOnce()).json<{ id: string }>();

    const bodies = [
      (await app.inject({ method: "GET", url: "/canvas-connections" })).body,
      (await app.inject({ method: "GET", url: `/canvas-connections/${created.id}` })).body,
      (await app.inject({ method: "POST", url: `/canvas-connections/${created.id}/disconnect` }))
        .body,
    ];

    for (const body of bodies) {
      expect(body).not.toContain(TOKEN);
      for (const key of [
        "ciphertext",
        "_iv",
        "auth_tag",
        "authTag",
        "access_token",
        "personal_access_token",
      ]) {
        expect(body.toLowerCase()).not.toContain(key.toLowerCase());
      }
    }
  });

  it("CanvasConnectionSchema structurally REJECTS an object carrying a credential field", () => {
    // Regression proof for "even if someone tampered with the response
    // mapper": CanvasConnectionSchema is `.strict()`, so an object shaped
    // exactly like a real response PLUS a credential-shaped extra key is not
    // silently stripped -- it fails to parse. This is the actual mechanism
    // that makes a leaked ciphertext column structurally impossible on the
    // wire, independent of any route's own code correctly omitting it.
    const validResponse = {
      id: "11111111-1111-4111-8111-111111111111",
      canvas_base_url: BASE_URL,
      canvas_user_id: 1,
      canvas_user_name: "Jane",
      status: "active" as const,
      last_sync_at: null,
      last_sync_error: null,
      last_sync_error_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    expect(CanvasConnectionSchema.safeParse(validResponse).success).toBe(true);
    expect(
      CanvasConnectionSchema.safeParse({
        ...validResponse,
        access_token_ciphertext: "leaked-bytes",
      }).success,
    ).toBe(false);
  });
});
