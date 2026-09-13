import {
  CalDavError,
  createFakeCalDavClient,
  createFakeGoogleCalendarClient,
  type FakeCalDavClient,
  type FakeGoogleCalendarClient,
} from "@personal-os/calendar-providers";
import { calendarConnectionCalendars, calendarConnections } from "@personal-os/db";
import type {
  AvailableCalendarsResponse,
  CalendarConnection,
  CalendarConnectionCalendar,
} from "@personal-os/schema";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import type { ErrorBody } from "../test/types.js";

function base64url(json: unknown): string {
  return Buffer.from(JSON.stringify(json))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fakeIdToken(payload: { sub: string; email: string }): string {
  const header = base64url({ alg: "RS256", typ: "JWT" });
  const body = base64url(payload);
  return `${header}.${body}.fake-signature`;
}

function mockGoogleTokenExchange(sub = "google-sub-1", email = "user@example.com") {
  const idToken = fakeIdToken({ sub, email });
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        access_token: "access-token-abc",
        refresh_token: "refresh-token-abc",
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/calendar",
        id_token: idToken,
        token_type: "Bearer",
      }),
      { status: 200 },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function connectViaApi(
  app: FastifyInstance,
  sub = "google-sub-1",
  email = "user@example.com",
) {
  mockGoogleTokenExchange(sub, email);
  const response = await app.inject({
    method: "POST",
    url: "/calendar-connections/google",
    payload: { auth_code: "real-auth-code" },
  });
  return response;
}

describe("calendar-connections routes", () => {
  let app: FastifyInstance;
  let fakeClient: FakeGoogleCalendarClient;
  let fakeCalDav: FakeCalDavClient;

  beforeAll(async () => {
    fakeClient = createFakeGoogleCalendarClient({
      calendars: [
        { id: "primary", summary: "user@example.com", primary: true },
        { id: "work@group.calendar.google.com", summary: "Work" },
      ],
    });
    fakeCalDav = createFakeCalDavClient();
    app = await buildTestApp({ googleCalendarClient: fakeClient, caldavClient: fakeCalDav });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateTestTables(app);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("POST /calendar-connections/google", () => {
    it("exchanges an auth code and creates a connection, never returning token material", async () => {
      const response = await connectViaApi(app);
      expect(response.statusCode).toBe(201);
      const body = response.json<CalendarConnection>();
      expect(body.google_account_email).toBe("user@example.com");
      expect(body.status).toBe("active");
      expect(JSON.stringify(body)).not.toContain("access-token-abc");
      expect(JSON.stringify(body)).not.toContain("refresh-token-abc");
      // The response schema itself has no access_token_*/refresh_token_*
      // fields at all -- structural exclusion, not just omission.
      expect(Object.keys(body)).not.toContain("access_token_ciphertext");
    });

    it("rejects a body with extra fields (.strict())", async () => {
      mockGoogleTokenExchange();
      const response = await app.inject({
        method: "POST",
        url: "/calendar-connections/google",
        payload: { auth_code: "code", extra_field: "nope" },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json<ErrorBody>().error).toBe("validation_failed");
    });

    it("stores the access/refresh tokens encrypted at rest -- ciphertext never contains the plaintext", async () => {
      const response = await connectViaApi(app, "google-sub-encryption-check");
      const body = response.json<CalendarConnection>();
      const [row] = await app.db
        .select()
        .from(calendarConnections)
        .where(eq(calendarConnections.id, body.id));
      expect(row?.accessTokenCiphertext).not.toBeNull();
      expect(row?.refreshTokenCiphertext).not.toBeNull();
      const cipherStr = row!.accessTokenCiphertext!.toString("utf8");
      const refreshCipherStr = row!.refreshTokenCiphertext!.toString("utf8");
      expect(cipherStr).not.toContain("access-token-abc");
      expect(refreshCipherStr).not.toContain("refresh-token-abc");
      // IV/authTag present with GCM-correct lengths (12 bytes IV, 16 bytes tag).
      expect(row?.accessTokenIv?.length).toBe(12);
      expect(row?.accessTokenAuthTag?.length).toBe(16);
    });

    it("reconnecting the same Google account updates the existing row rather than creating a duplicate", async () => {
      const first = await connectViaApi(app, "same-sub", "user@example.com");
      const firstBody = first.json<CalendarConnection>();

      const second = await connectViaApi(app, "same-sub", "user@example.com");
      expect(second.statusCode).toBe(200); // update, not create
      const secondBody = second.json<CalendarConnection>();
      expect(secondBody.id).toBe(firstBody.id);

      const rows = await app.db.select().from(calendarConnections);
      expect(rows).toHaveLength(1);
    });
  });

  describe("GET /calendar-connections", () => {
    it("lists connections", async () => {
      await connectViaApi(app);
      const response = await app.inject({ method: "GET", url: "/calendar-connections" });
      expect(response.statusCode).toBe(200);
      expect(response.json<{ items: CalendarConnection[] }>().items).toHaveLength(1);
    });
  });

  describe("GET /calendar-connections/:id/available-calendars", () => {
    it("returns the fake client's live calendar listing", async () => {
      const connectResponse = await connectViaApi(app);
      const connectionId = connectResponse.json<CalendarConnection>().id;

      const response = await app.inject({
        method: "GET",
        url: `/calendar-connections/${connectionId}/available-calendars`,
      });
      expect(response.statusCode).toBe(200);
      const body =
        response.json<Array<{ google_calendar_id: string; summary: string; primary: boolean }>>();
      expect(body).toEqual([
        { google_calendar_id: "primary", summary: "user@example.com", primary: true },
        { google_calendar_id: "work@group.calendar.google.com", summary: "Work", primary: false },
      ]);
    });

    it("404s for an unknown connection", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/calendar-connections/00000000-0000-0000-0000-000000000000/available-calendars",
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe("GET /calendar-connections/:id/calendars", () => {
    // This is the route the bug report names directly: before it existed,
    // the mobile "persisted calendars" query had nothing to call and
    // hardcoded an empty array, so every calendar rendered its sync toggle
    // as OFF on cold launch even when it was enabled in the database
    // (docs/STATUS.md: "No GET /calendar-connections/:id/calendars endpoint").

    it("returns an empty array for a connection with no calendar rows yet", async () => {
      const connectResponse = await connectViaApi(app);
      const connectionId = connectResponse.json<CalendarConnection>().id;

      const response = await app.inject({
        method: "GET",
        url: `/calendar-connections/${connectionId}/calendars`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<CalendarConnectionCalendar[]>()).toEqual([]);
    });

    it("returns persisted rows with their real sync_enabled state, independent of any prior PATCH response", async () => {
      const connectResponse = await connectViaApi(app);
      const connectionId = connectResponse.json<CalendarConnection>().id;

      // Persist state via PATCH (as the toggle UI does), then read it back
      // through GET as a cold-launch client would -- with no PATCH response
      // and no client-side cache to fall back on.
      await app.inject({
        method: "PATCH",
        url: `/calendar-connections/${connectionId}/calendars`,
        payload: [
          { google_calendar_id: "primary", sync_enabled: true },
          { google_calendar_id: "work@group.calendar.google.com", sync_enabled: false },
        ],
      });

      const response = await app.inject({
        method: "GET",
        url: `/calendar-connections/${connectionId}/calendars`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<CalendarConnectionCalendar[]>();
      expect(body).toHaveLength(2);

      // Two-calendar isolation: each row must carry its OWN sync_enabled --
      // no cross-contamination between rows on the same connection.
      const byGoogleId = new Map(body.map((row) => [row.google_calendar_id, row]));
      expect(byGoogleId.get("primary")?.sync_enabled).toBe(true);
      expect(byGoogleId.get("work@group.calendar.google.com")?.sync_enabled).toBe(false);
    });

    it("404s for an unknown connection", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/calendar-connections/00000000-0000-0000-0000-000000000000/calendars",
      });
      expect(response.statusCode).toBe(404);
    });

    it("never returns another connection's rows -- a regression that dropped the connectionId filter would still pass every single-connection test above", async () => {
      const connectionAResponse = await connectViaApi(app, "google-sub-a", "a@example.com");
      const connectionAId = connectionAResponse.json<CalendarConnection>().id;
      await app.inject({
        method: "PATCH",
        url: `/calendar-connections/${connectionAId}/calendars`,
        payload: [{ google_calendar_id: "cal-a-1", sync_enabled: true }],
      });

      const connectionBResponse = await connectViaApi(app, "google-sub-b", "b@example.com");
      const connectionBId = connectionBResponse.json<CalendarConnection>().id;
      await app.inject({
        method: "PATCH",
        url: `/calendar-connections/${connectionBId}/calendars`,
        payload: [{ google_calendar_id: "cal-b-1", sync_enabled: false }],
      });

      const responseA = await app.inject({
        method: "GET",
        url: `/calendar-connections/${connectionAId}/calendars`,
      });
      const bodyA = responseA.json<CalendarConnectionCalendar[]>();
      expect(bodyA).toHaveLength(1);
      expect(bodyA[0]?.google_calendar_id).toBe("cal-a-1");
      expect(bodyA[0]?.sync_enabled).toBe(true);

      const responseB = await app.inject({
        method: "GET",
        url: `/calendar-connections/${connectionBId}/calendars`,
      });
      const bodyB = responseB.json<CalendarConnectionCalendar[]>();
      expect(bodyB).toHaveLength(1);
      expect(bodyB[0]?.google_calendar_id).toBe("cal-b-1");
      expect(bodyB[0]?.sync_enabled).toBe(false);
    });

    it("matches PATCH's response shape exactly -- a bare array, not { items: ... }", async () => {
      const connectResponse = await connectViaApi(app);
      const connectionId = connectResponse.json<CalendarConnection>().id;
      await app.inject({
        method: "PATCH",
        url: `/calendar-connections/${connectionId}/calendars`,
        payload: [{ google_calendar_id: "primary", sync_enabled: true }],
      });

      const response = await app.inject({
        method: "GET",
        url: `/calendar-connections/${connectionId}/calendars`,
      });
      expect(Array.isArray(response.json())).toBe(true);
    });
  });

  describe("PATCH /calendar-connections/:id/calendars", () => {
    it("creates new calendar_connection_calendars rows and updates existing ones", async () => {
      const connectResponse = await connectViaApi(app);
      const connectionId = connectResponse.json<CalendarConnection>().id;

      const first = await app.inject({
        method: "PATCH",
        url: `/calendar-connections/${connectionId}/calendars`,
        payload: [{ google_calendar_id: "primary", sync_enabled: true }],
      });
      expect(first.statusCode).toBe(200);
      const firstBody = first.json<Array<{ sync_enabled: boolean; google_calendar_id: string }>>();
      expect(firstBody).toHaveLength(1);
      expect(firstBody[0]?.sync_enabled).toBe(true);

      const second = await app.inject({
        method: "PATCH",
        url: `/calendar-connections/${connectionId}/calendars`,
        payload: [{ google_calendar_id: "primary", sync_enabled: false }],
      });
      const secondBody = second.json<Array<{ sync_enabled: boolean }>>();
      expect(secondBody[0]?.sync_enabled).toBe(false);

      const rows = await app.db
        .select()
        .from(calendarConnectionCalendars)
        .where(eq(calendarConnectionCalendars.connectionId, connectionId));
      expect(rows).toHaveLength(1); // updated in place, not duplicated
    });

    it("rejects an item with extra fields (.strict())", async () => {
      const connectResponse = await connectViaApi(app);
      const connectionId = connectResponse.json<CalendarConnection>().id;
      const response = await app.inject({
        method: "PATCH",
        url: `/calendar-connections/${connectionId}/calendars`,
        payload: [{ google_calendar_id: "primary", sync_enabled: true, unexpected: "field" }],
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe("POST /calendar-connections/:id/sync-now", () => {
    it("enqueues a sync job for every sync-enabled calendar and none for disabled ones", async () => {
      const connectResponse = await connectViaApi(app);
      const connectionId = connectResponse.json<CalendarConnection>().id;
      await app.inject({
        method: "PATCH",
        url: `/calendar-connections/${connectionId}/calendars`,
        payload: [
          { google_calendar_id: "primary", sync_enabled: true },
          { google_calendar_id: "work@group.calendar.google.com", sync_enabled: false },
        ],
      });

      const response = await app.inject({
        method: "POST",
        url: `/calendar-connections/${connectionId}/sync-now`,
      });
      expect(response.statusCode).toBe(202);
      expect(response.json<{ queued: number }>().queued).toBe(1);
    });

    it("409s for a connection that is not active", async () => {
      const connectResponse = await connectViaApi(app);
      const connectionId = connectResponse.json<CalendarConnection>().id;
      await app.db
        .update(calendarConnections)
        .set({ status: "needs_reauth" })
        .where(eq(calendarConnections.id, connectionId));

      const response = await app.inject({
        method: "POST",
        url: `/calendar-connections/${connectionId}/sync-now`,
      });
      expect(response.statusCode).toBe(409);
    });
  });

  describe("POST /calendar-connections/:id/disconnect", () => {
    it("nulls credential columns, sets status=disconnected, and preserves calendar mappings", async () => {
      const connectResponse = await connectViaApi(app);
      const connectionId = connectResponse.json<CalendarConnection>().id;
      await app.inject({
        method: "PATCH",
        url: `/calendar-connections/${connectionId}/calendars`,
        payload: [{ google_calendar_id: "primary", sync_enabled: true }],
      });

      const revokeFetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
      vi.stubGlobal("fetch", revokeFetchMock);

      const response = await app.inject({
        method: "POST",
        url: `/calendar-connections/${connectionId}/disconnect`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<CalendarConnection>();
      expect(body.status).toBe("disconnected");

      const [row] = await app.db
        .select()
        .from(calendarConnections)
        .where(eq(calendarConnections.id, connectionId));
      expect(row?.accessTokenCiphertext).toBeNull();
      expect(row?.refreshTokenCiphertext).toBeNull();

      // Preserved -- a reconnect of the same account must resume without
      // re-importing duplicates.
      const calendarRows = await app.db
        .select()
        .from(calendarConnectionCalendars)
        .where(eq(calendarConnectionCalendars.connectionId, connectionId));
      expect(calendarRows).toHaveLength(1);

      expect(revokeFetchMock).toHaveBeenCalledWith(
        "https://oauth2.googleapis.com/revoke",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("continues (best-effort) even if Google's revoke call fails", async () => {
      const connectResponse = await connectViaApi(app, "sub-revoke-fail");
      const connectionId = connectResponse.json<CalendarConnection>().id;

      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

      const response = await app.inject({
        method: "POST",
        url: `/calendar-connections/${connectionId}/disconnect`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<CalendarConnection>().status).toBe("disconnected");
    });

    it("reconnecting after disconnect reuses the same connection row", async () => {
      const first = await connectViaApi(app, "reconnect-sub");
      const connectionId = first.json<CalendarConnection>().id;

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
      await app.inject({ method: "POST", url: `/calendar-connections/${connectionId}/disconnect` });

      const reconnect = await connectViaApi(app, "reconnect-sub");
      expect(reconnect.json<CalendarConnection>().id).toBe(connectionId);
      expect(reconnect.json<CalendarConnection>().status).toBe("active");

      const rows = await app.db.select().from(calendarConnections);
      expect(rows).toHaveLength(1);
    });
  });

  describe("CalDAV connection routes", () => {
    it("connects a CalDAV server and discovers calendars", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/calendar-connections/caldav",
        payload: {
          server_url: "https://caldav.example.com",
          username: "testuser",
          password: "my-app-password",
        },
      });

      expect(response.statusCode).toBe(201);
      const conn = response.json<CalendarConnection>();
      expect(conn.provider).toBe("caldav");
      expect(conn.server_url).toBe("https://caldav.example.com");
      expect(conn.username).toBe("testuser");
      expect(conn.status).toBe("active");

      // Password should be encrypted in DB
      const [dbRow] = await app.db
        .select()
        .from(calendarConnections)
        .where(eq(calendarConnections.id, conn.id));
      expect(dbRow?.passwordCiphertext).toBeDefined();

      // List available calendars
      const availRes = await app.inject({
        method: "GET",
        url: `/calendar-connections/${conn.id}/available-calendars`,
      });
      expect(availRes.statusCode).toBe(200);
      const avail = availRes.json<AvailableCalendarsResponse>();
      expect(avail.length).toBeGreaterThan(0);
      expect(avail[0]!.caldav_calendar_url).toBe("/calendars/users/testuser/personal/");

      // Opt calendar into sync
      const patchRes = await app.inject({
        method: "PATCH",
        url: `/calendar-connections/${conn.id}/calendars`,
        payload: [
          {
            caldav_calendar_url: avail[0]!.caldav_calendar_url,
            sync_enabled: true,
          },
        ],
      });
      expect(patchRes.statusCode).toBe(200);
      const patched = patchRes.json<CalendarConnectionCalendar[]>();
      expect(patched[0]!.caldav_calendar_url).toBe(avail[0]!.caldav_calendar_url);
      expect(patched[0]!.sync_enabled).toBe(true);

      // Disconnect
      const discRes = await app.inject({
        method: "POST",
        url: `/calendar-connections/${conn.id}/disconnect`,
      });
      expect(discRes.statusCode).toBe(200);
      expect(discRes.json<CalendarConnection>().status).toBe("disconnected");

      const [afterDisc] = await app.db
        .select()
        .from(calendarConnections)
        .where(eq(calendarConnections.id, conn.id));
      expect(afterDisc?.passwordCiphertext).toBeNull();

      // Reconnect
      const reRes = await app.inject({
        method: "POST",
        url: "/calendar-connections/caldav",
        payload: {
          server_url: "https://caldav.example.com",
          username: "testuser",
          password: "my-app-password",
        },
      });
      expect(reRes.statusCode).toBe(200);
      expect(reRes.json<CalendarConnection>().id).toBe(conn.id);
      expect(reRes.json<CalendarConnection>().status).toBe("active");
    });
  });
  // ---------------------------------------------------------------------
  // Checkpoint 6.5 -- provider-error redaction.
  //
  // Before this checkpoint, `parsedError.error_description` (Google's own
  // prose) travelled: worker -> calendar_connections.last_sync_error ->
  // GET /calendar-connections -> interpolated into the Settings screen. These
  // tests pin every hop of that chain shut.
  // ---------------------------------------------------------------------
  describe("provider-error redaction", () => {
    // A sentinel shaped like the real leak, carrying something that must never
    // be echoed anywhere.
    const GOOGLE_PROSE = "Token has been expired or revoked. ya29.SENTINEL-not-a-real-token";

    it("returns a code, never Google's error_description, on a failed OAuth exchange", async () => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response(
              JSON.stringify({ error: "invalid_grant", error_description: GOOGLE_PROSE }),
              { status: 400 },
            ),
          ),
      );

      const response = await app.inject({
        method: "POST",
        url: "/calendar-connections/google",
        payload: { auth_code: "a-code-google-will-reject" },
      });

      expect(response.statusCode).toBe(422);
      const raw = response.body;
      expect(raw).not.toContain("ya29");
      expect(raw).not.toContain("SENTINEL");
      expect(raw).not.toContain("revoked");
      const body = response.json<{ error: string; reason: string; message?: string }>();
      expect(body.error).toBe("google_oauth_failed");
      expect(body.reason).toBe("auth_expired");
      // The old contract carried `message`. Its absence is the fix.
      expect(body.message).toBeUndefined();
    });

    it("classifies an unknown OAuth failure without inventing a reason", async () => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response(JSON.stringify({ error_description: GOOGLE_PROSE }), { status: 503 }),
          ),
      );

      const response = await app.inject({
        method: "POST",
        url: "/calendar-connections/google",
        payload: { auth_code: "x" },
      });
      expect(response.statusCode).toBe(422);
      expect(response.body).not.toContain("SENTINEL");
      expect(response.json<{ reason: string }>().reason).toBe("provider_unavailable");
    });

    it("returns a code, never a CalDAV message or response body, on failed discovery", async () => {
      const failing = createFakeCalDavClient();
      failing.discoverHomeSet = () => {
        throw new CalDavError(
          `PROPFIND rejected: ${GOOGLE_PROSE}`,
          401,
          `<D:error>${GOOGLE_PROSE}</D:error>`,
        );
      };
      const localApp = await buildTestApp({
        googleCalendarClient: fakeClient,
        caldavClient: failing,
      });
      try {
        const response = await localApp.inject({
          method: "POST",
          url: "/calendar-connections/caldav",
          payload: {
            server_url: "https://caldav.example.com",
            username: "testuser",
            password: "my-app-password",
          },
        });
        expect(response.statusCode).toBe(422);
        expect(response.body).not.toContain("SENTINEL");
        expect(response.body).not.toContain("PROPFIND");
        const body = response.json<{ error: string; reason: string; statusCode?: number }>();
        expect(body.error).toBe("caldav_discovery_failed");
        expect(body.reason).toBe("auth_failed");
        // The raw upstream status is no longer echoed either -- the
        // classification already carries every actionable distinction.
        expect(body.statusCode).toBeUndefined();
      } finally {
        await localApp.close();
      }
    });

    it("neutralises a legacy row that still holds provider prose", async () => {
      // Simulates a row written by a pre-6.5 build. No data migration was run,
      // so the projection has to make it safe.
      const connectRes = await connectViaApi(app);
      const created = connectRes.json<CalendarConnection>();
      await app.db
        .update(calendarConnections)
        .set({ status: "needs_reauth", lastSyncError: GOOGLE_PROSE })
        .where(eq(calendarConnections.id, created.id));

      const listRes = await app.inject({ method: "GET", url: "/calendar-connections" });
      expect(listRes.statusCode).toBe(200);
      expect(listRes.body).not.toContain("SENTINEL");
      expect(listRes.body).not.toContain("revoked");
      const items = listRes.json<{ items: CalendarConnection[] }>().items;
      expect(items[0]?.last_sync_error).toBe("provider_error");

      const detailRes = await app.inject({
        method: "GET",
        url: `/calendar-connections/${created.id}`,
      });
      expect(detailRes.body).not.toContain("SENTINEL");
      expect(detailRes.json<CalendarConnection>().last_sync_error).toBe("provider_error");
    });

    it("passes a current classification code through unchanged", async () => {
      const connectRes = await connectViaApi(app);
      const created = connectRes.json<CalendarConnection>();
      await app.db
        .update(calendarConnections)
        .set({ status: "needs_reauth", lastSyncError: "missing_scope" })
        .where(eq(calendarConnections.id, created.id));

      const listRes = await app.inject({ method: "GET", url: "/calendar-connections" });
      expect(listRes.json<{ items: CalendarConnection[] }>().items[0]?.last_sync_error).toBe(
        "missing_scope",
      );
    });

    it("never exposes credential material alongside an error", async () => {
      const connectRes = await connectViaApi(app);
      const created = connectRes.json<CalendarConnection>();
      await app.db
        .update(calendarConnections)
        .set({ status: "needs_reauth", lastSyncError: GOOGLE_PROSE })
        .where(eq(calendarConnections.id, created.id));

      const listRes = await app.inject({ method: "GET", url: "/calendar-connections" });
      for (const needle of [
        "access-token-abc",
        "refresh-token-abc",
        "ciphertext",
        "auth_tag",
        "authTag",
        "client_secret",
      ]) {
        expect(listRes.body).not.toContain(needle);
      }
    });
  });
});
