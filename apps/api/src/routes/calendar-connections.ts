import { decryptSecret, encryptSecret } from "@personal-os/ai-providers";
import {
  CalDavError,
  exchangeAuthCode,
  GoogleOAuthError,
  refreshAccessToken,
} from "@personal-os/calendar-providers";
import { calendarConnectionCalendars, calendarConnections } from "@personal-os/db";
import {
  AvailableCalendarsResponseSchema,
  AvailableGoogleCalendarsResponseSchema,
  CalendarConnectionCalendarSchema,
  CalendarConnectionCalendarUpdateSchema,
  CalendarConnectionSchema,
  ConnectCaldavCalendarRequestSchema,
  ConnectGoogleCalendarRequestSchema,
  type AvailableCalendarsResponse,
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
    google_account_email: row.googleAccountEmail ?? null,
    server_url: row.serverUrl ?? null,
    username: row.username ?? null,
    auth_type: row.authType ?? null,
    status: row.status,
    granted_scope: row.grantedScope ?? null,
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
    google_calendar_id: row.googleCalendarId ?? null,
    caldav_calendar_url: row.caldavCalendarUrl ?? null,
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
  // Google OAuth connection endpoint
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

  // CalDAV connection endpoint
  app.post("/calendar-connections/caldav", async (request, reply) => {
    const body = ConnectCaldavCalendarRequestSchema.parse(request.body);

    let discovery;
    try {
      discovery = await app.caldavClient.discoverHomeSet(body.server_url, {
        username: body.username,
        password: body.password,
      });
    } catch (err) {
      if (err instanceof CalDavError) {
        return reply.code(422).send({
          error: "caldav_discovery_failed",
          message: err.message,
          statusCode: err.status,
        });
      }
      throw err;
    }

    const passwordSecret = encryptSecret(body.password, env.CREDENTIALS_ENCRYPTION_KEY);

    const [existing] = await app.db
      .select()
      .from(calendarConnections)
      .where(
        and(
          eq(calendarConnections.provider, "caldav"),
          eq(calendarConnections.serverUrl, body.server_url),
          eq(calendarConnections.username, body.username),
        ),
      );

    const values = {
      provider: "caldav" as const,
      serverUrl: body.server_url,
      username: body.username,
      authType: body.auth_type ?? "basic",
      principalUrl: discovery.principalUrl,
      calendarHomeSetUrl: discovery.calendarHomeSetUrl,
      passwordCiphertext: passwordSecret.ciphertext,
      passwordIv: passwordSecret.iv,
      passwordAuthTag: passwordSecret.authTag,
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

  app.get<{ Params: { id: string } }>("/calendar-connections/:id", async (request, reply) => {
    const connection = await findConnection(app, request.params.id);
    if (!connection) return reply.code(404).send({ error: "not_found" });
    return toConnectionResponse(connection);
  });

  // Available calendars listing (Google or CalDAV)
  app.get<{ Params: { id: string } }>(
    "/calendar-connections/:id/available-calendars",
    async (request, reply) => {
      const connection = await findConnection(app, request.params.id);
      if (!connection) return reply.code(404).send({ error: "not_found" });
      if (connection.status !== "active") {
        return reply.code(409).send({ error: "connection_not_active", status: connection.status });
      }

      if (connection.provider === "google") {
        const accessToken = await resolveAccessTokenForRequest(app, connection);
        const result = await app.googleCalendarClient.listCalendars(accessToken);
        const response: AvailableGoogleCalendarsResponse = result.items.map((item) => ({
          google_calendar_id: item.id,
          summary: item.summary,
          primary: item.primary ?? false,
        }));
        return AvailableGoogleCalendarsResponseSchema.parse(response);
      }

      if (connection.provider === "caldav") {
        if (
          !connection.passwordCiphertext ||
          !connection.passwordIv ||
          !connection.passwordAuthTag
        ) {
          return reply.code(401).send({ error: "missing_credentials" });
        }
        const password = decryptSecret(
          {
            ciphertext: connection.passwordCiphertext,
            iv: connection.passwordIv,
            authTag: connection.passwordAuthTag,
          },
          env.CREDENTIALS_ENCRYPTION_KEY,
        );
        const homeSetUrl = connection.calendarHomeSetUrl || connection.serverUrl!;
        const cals = await app.caldavClient.findCalendars(homeSetUrl, {
          username: connection.username!,
          password,
        });

        const response: AvailableCalendarsResponse = cals.map((c) => ({
          id: c.href,
          summary: c.displayName,
          caldav_calendar_url: c.href,
          color: c.color,
          primary: false,
        }));
        return AvailableCalendarsResponseSchema.parse(response);
      }

      return reply.code(400).send({ error: "unsupported_provider" });
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
        const isCaldav = Boolean(item.caldav_calendar_url);
        const calendarKey = item.google_calendar_id || item.caldav_calendar_url;
        if (!calendarKey) continue;

        const whereCondition = isCaldav
          ? and(
              eq(calendarConnectionCalendars.connectionId, connection.id),
              eq(calendarConnectionCalendars.caldavCalendarUrl, item.caldav_calendar_url!),
            )
          : and(
              eq(calendarConnectionCalendars.connectionId, connection.id),
              eq(calendarConnectionCalendars.googleCalendarId, item.google_calendar_id!),
            );

        const [existingRow] = await app.db
          .select()
          .from(calendarConnectionCalendars)
          .where(whereCondition);

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
          [row] = await app.db
            .insert(calendarConnectionCalendars)
            .values({
              connectionId: connection.id,
              googleCalendarId: isCaldav ? null : item.google_calendar_id,
              caldavCalendarUrl: isCaldav ? item.caldav_calendar_url : null,
              summary: calendarKey,
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
        const calKey = cal.googleCalendarId || cal.caldavCalendarUrl || cal.id;
        await app.boss.send(
          CALENDAR_SYNC_CALENDAR_QUEUE,
          { connectionId: connection.id, calendarConnectionCalendarId: cal.id },
          { singletonKey: `${connection.id}:${calKey}` },
        );
      }

      return reply.code(202).send({ queued: enabledCalendars.length });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/calendar-connections/:id/disconnect",
    async (request, reply) => {
      const connection = await findConnection(app, request.params.id);
      if (!connection) return reply.code(404).send({ error: "not_found" });

      if (
        connection.provider === "google" &&
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
          passwordCiphertext: null,
          passwordIv: null,
          passwordAuthTag: null,
          updatedAt: new Date(),
        })
        .where(eq(calendarConnections.id, connection.id))
        .returning();
      if (!row) throw new Error("update calendar_connections returned no row");

      return toConnectionResponse(row);
    },
  );
}

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
