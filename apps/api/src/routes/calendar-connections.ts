import { decryptSecret, encryptSecret } from "@personal-os/ai-providers";
import {
  exchangeAuthCode,
  GoogleOAuthError,
  refreshAccessToken,
} from "@personal-os/calendar-providers";
import { calendarConnectionCalendars, calendarConnections } from "@personal-os/db";
import {
  AvailableGoogleCalendarsResponseSchema,
  CalendarConnectionCalendarSchema,
  CalendarConnectionCalendarUpdateSchema,
  CalendarConnectionSchema,
  ConnectGoogleCalendarRequestSchema,
  type AvailableGoogleCalendarsResponse,
  type CalendarConnection,
  type CalendarConnectionCalendar,
} from "@personal-os/schema";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { env } from "../env.js";
import { CALENDAR_SYNC_CALENDAR_QUEUE } from "../queue-names.js";

function toConnectionResponse(row: typeof calendarConnections.$inferSelect): CalendarConnection {
  return CalendarConnectionSchema.parse({
    id: row.id,
    provider: row.provider,
    google_account_email: row.googleAccountEmail,
    status: row.status,
    granted_scope: row.grantedScope,
    last_sync_error: row.lastSyncError,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  });
}

function toCalendarResponse(
  row: typeof calendarConnectionCalendars.$inferSelect,
): CalendarConnectionCalendar {
  return CalendarConnectionCalendarSchema.parse({
    id: row.id,
    connection_id: row.connectionId,
    google_calendar_id: row.googleCalendarId,
    summary: row.summary,
    sync_enabled: row.syncEnabled,
    project_id: row.projectId,
    last_successful_sync_at: row.lastSuccessfulSyncAt
      ? row.lastSuccessfulSyncAt.toISOString()
      : null,
    last_full_sync_at: row.lastFullSyncAt ? row.lastFullSyncAt.toISOString() : null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  });
}

async function findConnection(app: FastifyInstance, id: string) {
  const [row] = await app.db
    .select()
    .from(calendarConnections)
    .where(eq(calendarConnections.id, id));
  return row ?? null;
}

export default function calendarConnectionsRoutes(app: FastifyInstance): void {
  // Upserts by google_account_id -- reconnecting the same account after a
  // disconnect (or simply re-authorizing to refresh scope) updates tokens
  // in place rather than creating a duplicate connection row. This is also
  // what makes disconnect -> reconnect safe: POST /calendar-connections/:id/disconnect
  // never deletes calendar_connection_calendars/event_external_links/
  // calendar_event_instances rows, so a reconnect of the same account
  // resumes sync against the same mappings instead of re-importing
  // duplicates.
  app.post("/calendar-connections/google", async (request, reply) => {
    const body = ConnectGoogleCalendarRequestSchema.parse(request.body);

    let tokens;
    try {
      tokens = await exchangeAuthCode({
        code: body.auth_code,
        clientId: env.GOOGLE_OAUTH_CLIENT_ID,
        clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      });
    } catch (err) {
      if (err instanceof GoogleOAuthError) {
        return reply.code(422).send({ error: "google_oauth_failed", message: err.message });
      }
      throw err;
    }

    const accessSecret = encryptSecret(tokens.accessToken, env.CREDENTIALS_ENCRYPTION_KEY);
    const refreshSecret = encryptSecret(tokens.refreshToken, env.CREDENTIALS_ENCRYPTION_KEY);

    const [existing] = await app.db
      .select()
      .from(calendarConnections)
      .where(eq(calendarConnections.googleAccountId, tokens.googleAccountId));

    const values = {
      provider: "google" as const,
      googleAccountEmail: tokens.googleAccountEmail,
      googleAccountId: tokens.googleAccountId,
      accessTokenCiphertext: accessSecret.ciphertext,
      accessTokenIv: accessSecret.iv,
      accessTokenAuthTag: accessSecret.authTag,
      accessTokenExpiresAt: tokens.expiresAt,
      refreshTokenCiphertext: refreshSecret.ciphertext,
      refreshTokenIv: refreshSecret.iv,
      refreshTokenAuthTag: refreshSecret.authTag,
      grantedScope: tokens.scope,
      status: "active" as const,
      lastSyncError: null,
      updatedAt: new Date(),
    };

    let row: typeof calendarConnections.$inferSelect | undefined;
    if (existing) {
      [row] = await app.db
        .update(calendarConnections)
        .set(values)
        .where(eq(calendarConnections.id, existing.id))
        .returning();
    } else {
      [row] = await app.db.insert(calendarConnections).values(values).returning();
    }
    if (!row) throw new Error("upsert into calendar_connections returned no row");

    return reply.code(existing ? 200 : 201).send(toConnectionResponse(row));
  });

  app.get("/calendar-connections", async () => {
    const rows = await app.db.select().from(calendarConnections);
    return { items: rows.map(toConnectionResponse) };
  });

  // Live passthrough, never cached/stored -- lets the UI present a
  // calendar picker before the user has opted any calendar into
  // calendar_connection_calendars.
  app.get<{ Params: { id: string } }>(
    "/calendar-connections/:id/available-calendars",
    async (request, reply) => {
      const connection = await findConnection(app, request.params.id);
      if (!connection) return reply.code(404).send({ error: "not_found" });
      if (connection.status !== "active") {
        return reply.code(409).send({ error: "connection_not_active", status: connection.status });
      }

      const accessToken = await resolveAccessTokenForRequest(app, connection);
      const result = await app.googleCalendarClient.listCalendars(accessToken);
      const response: AvailableGoogleCalendarsResponse = result.items.map((item) => ({
        google_calendar_id: item.id,
        summary: item.summary,
        primary: item.primary ?? false,
      }));
      return AvailableGoogleCalendarsResponseSchema.parse(response);
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/calendar-connections/:id/calendars",
    async (request, reply) => {
      const connection = await findConnection(app, request.params.id);
      if (!connection) return reply.code(404).send({ error: "not_found" });

      const body = CalendarConnectionCalendarUpdateSchema.array().parse(request.body);
      const results: CalendarConnectionCalendar[] = [];

      for (const item of body) {
        const [existingRow] = await app.db
          .select()
          .from(calendarConnectionCalendars)
          .where(
            and(
              eq(calendarConnectionCalendars.connectionId, connection.id),
              eq(calendarConnectionCalendars.googleCalendarId, item.google_calendar_id),
            ),
          );

        let row: typeof calendarConnectionCalendars.$inferSelect | undefined;
        if (existingRow) {
          [row] = await app.db
            .update(calendarConnectionCalendars)
            .set({
              syncEnabled: item.sync_enabled,
              projectId: item.project_id !== undefined ? item.project_id : existingRow.projectId,
              updatedAt: new Date(),
            })
            .where(eq(calendarConnectionCalendars.id, existingRow.id))
            .returning();
        } else {
          // A newly-opted-in calendar -- summary is required by the schema
          // but this endpoint's body doesn't carry it (the client already
          // has it from GET .../available-calendars); fall back to the
          // google_calendar_id itself rather than leaving it empty, and
          // let a future sync-calendar pass populate/correct it. This
          // matches the read contract's own tolerance for stale metadata
          // (last_successful_sync_at etc.) elsewhere in this data model.
          [row] = await app.db
            .insert(calendarConnectionCalendars)
            .values({
              connectionId: connection.id,
              googleCalendarId: item.google_calendar_id,
              summary: item.google_calendar_id,
              syncEnabled: item.sync_enabled,
              projectId: item.project_id ?? null,
            })
            .returning();
        }
        if (!row) throw new Error("upsert into calendar_connection_calendars returned no row");
        results.push(toCalendarResponse(row));
      }

      return results;
    },
  );

  app.post<{ Params: { id: string } }>(
    "/calendar-connections/:id/sync-now",
    async (request, reply) => {
      const connection = await findConnection(app, request.params.id);
      if (!connection) return reply.code(404).send({ error: "not_found" });
      if (connection.status !== "active") {
        return reply.code(409).send({ error: "connection_not_active", status: connection.status });
      }
      if (!app.bossReady) return reply.code(503).send({ error: "queue_unavailable" });

      const enabledCalendars = await app.db
        .select()
        .from(calendarConnectionCalendars)
        .where(
          and(
            eq(calendarConnectionCalendars.connectionId, connection.id),
            eq(calendarConnectionCalendars.syncEnabled, true),
          ),
        );

      for (const cal of enabledCalendars) {
        // singletonKey (queue policy 'singleton', see queue-names.ts) makes a
        // sync-now request while a sync is already in flight for this exact
        // calendar a harmless queued duplicate rather than a concurrent run.
        await app.boss.send(
          CALENDAR_SYNC_CALENDAR_QUEUE,
          { connectionId: connection.id, calendarConnectionCalendarId: cal.id },
          { singletonKey: `${connection.id}:${cal.googleCalendarId}` },
        );
      }

      return reply.code(202).send({ queued: enabledCalendars.length });
    },
  );

  // Locked, non-destructive: best-effort revoke with Google, null every
  // credential column, set status='disconnected'. Deliberately does NOT
  // delete calendar_connection_calendars/event_external_links/
  // calendar_event_instances -- they must survive so a reconnect of the
  // same account resumes without re-importing duplicates (see the doc
  // comment on POST /calendar-connections/google above).
  app.post<{ Params: { id: string } }>(
    "/calendar-connections/:id/disconnect",
    async (request, reply) => {
      const connection = await findConnection(app, request.params.id);
      if (!connection) return reply.code(404).send({ error: "not_found" });

      if (
        connection.refreshTokenCiphertext &&
        connection.refreshTokenIv &&
        connection.refreshTokenAuthTag
      ) {
        try {
          const refreshToken = decryptSecret(
            {
              ciphertext: connection.refreshTokenCiphertext,
              iv: connection.refreshTokenIv,
              authTag: connection.refreshTokenAuthTag,
            },
            env.CREDENTIALS_ENCRYPTION_KEY,
          );
          await fetch("https://oauth2.googleapis.com/revoke", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ token: refreshToken }).toString(),
          });
        } catch (err) {
          // Best-effort per the locked instruction -- log and continue
          // regardless of outcome.
          request.log.warn(
            { err },
            "calendar-connections: Google token revocation failed (continuing)",
          );
        }
      }

      const [row] = await app.db
        .update(calendarConnections)
        .set({
          status: "disconnected",
          accessTokenCiphertext: null,
          accessTokenIv: null,
          accessTokenAuthTag: null,
          accessTokenExpiresAt: null,
          refreshTokenCiphertext: null,
          refreshTokenIv: null,
          refreshTokenAuthTag: null,
          updatedAt: new Date(),
        })
        .where(eq(calendarConnections.id, connection.id))
        .returning();
      if (!row) throw new Error("update calendar_connections returned no row");

      return toConnectionResponse(row);
    },
  );
}

// Shared by GET .../available-calendars (the only route-level caller that
// needs a live access token synchronously within a request) -- a minimal,
// non-persisting inline refresh so this live passthrough doesn't force the
// caller to wait for the worker's own refresh cadence. Does not write a
// needs_reauth transition on permanent failure; that's handled by the two
// worker jobs that actually perform sync/push, since a live listing failing
// once isn't itself sync-affecting the way a background job's failure is.
async function resolveAccessTokenForRequest(
  app: FastifyInstance,
  connection: typeof calendarConnections.$inferSelect,
): Promise<string> {
  const hasAccessToken =
    connection.accessTokenCiphertext && connection.accessTokenIv && connection.accessTokenAuthTag;
  const expiresAt = connection.accessTokenExpiresAt;
  const isFresh = hasAccessToken && expiresAt && expiresAt.getTime() - Date.now() > 60_000;

  if (
    isFresh &&
    connection.accessTokenCiphertext &&
    connection.accessTokenIv &&
    connection.accessTokenAuthTag
  ) {
    return decryptSecret(
      {
        ciphertext: connection.accessTokenCiphertext,
        iv: connection.accessTokenIv,
        authTag: connection.accessTokenAuthTag,
      },
      env.CREDENTIALS_ENCRYPTION_KEY,
    );
  }

  if (
    !connection.refreshTokenCiphertext ||
    !connection.refreshTokenIv ||
    !connection.refreshTokenAuthTag
  ) {
    throw new GoogleOAuthError(
      `calendar_connections ${connection.id} has no refresh token and its access token is expired`,
      401,
      "invalid_grant",
    );
  }
  const refreshToken = decryptSecret(
    {
      ciphertext: connection.refreshTokenCiphertext,
      iv: connection.refreshTokenIv,
      authTag: connection.refreshTokenAuthTag,
    },
    env.CREDENTIALS_ENCRYPTION_KEY,
  );
  const refreshed = await refreshAccessToken({
    refreshToken,
    clientId: env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
  });
  const newAccessSecret = encryptSecret(refreshed.accessToken, env.CREDENTIALS_ENCRYPTION_KEY);
  await app.db
    .update(calendarConnections)
    .set({
      accessTokenCiphertext: newAccessSecret.ciphertext,
      accessTokenIv: newAccessSecret.iv,
      accessTokenAuthTag: newAccessSecret.authTag,
      accessTokenExpiresAt: refreshed.expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(calendarConnections.id, connection.id));
  return refreshed.accessToken;
}
