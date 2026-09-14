import { decryptSecret, encryptSecret } from "@personal-os/ai-providers";
import {
  CalDavError,
  classifyCalendarProviderError,
  classifyStoredCalendarSyncError,
  exchangeAuthCode,
  GoogleOAuthError,
  refreshAccessToken,
} from "@personal-os/calendar-providers";
import { errorToken } from "@personal-os/core/logging/logger";
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
import { and, eq, inArray, isNotNull, notInArray } from "drizzle-orm";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
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
    // Rows written before Checkpoint 6.5 may still hold Google's own prose;
    // the sanitizer collapses anything outside the vocabulary to
    // "provider_error" so no data migration is needed to make them safe.
    last_sync_error: classifyStoredCalendarSyncError(row.lastSyncError),
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
    access_role: row.accessRole ?? null,
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
        // err.message is Google's `error_description` -- vendor prose. Only a
        // code from the closed vocabulary crosses the API boundary.
        return reply
          .code(422)
          .send({ error: "google_oauth_failed", reason: classifyCalendarProviderError(err) });
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
        // CalDavError messages can embed the raw response body and the server
        // URL; neither may cross the boundary. The status code is dropped too --
        // the classification already carries every actionable distinction.
        return reply.code(422).send({
          error: "caldav_discovery_failed",
          reason: classifyCalendarProviderError(err),
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
        const response: AvailableGoogleCalendarsResponse = [];
        for (const item of result.items) {
          // Checkpoint 9.5: the calendarList `accessRole` is the only signal
          // of whether a Google calendar can be written to, so every read of
          // the live listing refreshes it onto the persisted row -- UPDATE
          // only, never an insert: a row exists solely once the user has
          // chosen the calendar through PATCH .../calendars (which now
          // resolves the role itself on insert, see below). A listed
          // calendar that carries no role is stored as NULL, and unknown is
          // never treated as writable (see calendar-targets.ts). The display
          // name is refreshed on the same pass.
          const accessRole = item.accessRole ?? null;
          await app.db
            .update(calendarConnectionCalendars)
            .set({
              accessRole,
              ...(item.summary ? { summary: item.summary } : {}),
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(calendarConnectionCalendars.connectionId, connection.id),
                eq(calendarConnectionCalendars.googleCalendarId, item.id),
              ),
            );
          response.push({
            google_calendar_id: item.id,
            summary: item.summary,
            primary: item.primary ?? false,
            access_role: accessRole,
          });
        }
        // A persisted calendar ABSENT from the listing (unshared, deleted
        // upstream) has no known role any more, so its stale one is cleared
        // rather than left to keep it write-eligible (9.5 review). Skipped
        // when the listing is empty: an empty calendarList is far more
        // likely a provider hiccup than the removal of every calendar, and
        // clearing every role on it would silently empty the target picker.
        if (result.items.length > 0) {
          await app.db
            .update(calendarConnectionCalendars)
            .set({ accessRole: null, updatedAt: new Date() })
            .where(
              and(
                eq(calendarConnectionCalendars.connectionId, connection.id),
                isNotNull(calendarConnectionCalendars.googleCalendarId),
                isNotNull(calendarConnectionCalendars.accessRole),
                notInArray(
                  calendarConnectionCalendars.googleCalendarId,
                  result.items.map((item) => item.id),
                ),
              ),
            );
        }
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

  // Persisted per-calendar state (sync_enabled, project_id, etc.) for a
  // connection. Distinct from GET .../available-calendars, which is a live
  // provider listing with no persisted sync_enabled at all. Before this
  // route existed, the mobile app's "persisted calendars" query had nothing
  // to call and hardcoded an empty result, so every calendar rendered its
  // sync toggle as OFF on cold launch regardless of actual database state
  // (docs/STATUS.md). Response shape matches PATCH .../calendars exactly --
  // a bare array, not `{ items: ... }` -- so the client's query cache slots
  // straight in from either write path with zero transformation.
  app.get<{ Params: { id: string } }>(
    "/calendar-connections/:id/calendars",
    async (request, reply) => {
      const connection = await findConnection(app, request.params.id);
      if (!connection) return reply.code(404).send({ error: "not_found" });

      const rows = await app.db
        .select()
        .from(calendarConnectionCalendars)
        .where(eq(calendarConnectionCalendars.connectionId, connection.id));

      return rows.map(toCalendarResponse);
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/calendar-connections/:id/calendars",
    async (request, reply) => {
      const connection = await findConnection(app, request.params.id);
      if (!connection) return reply.code(404).send({ error: "not_found" });

      const body = CalendarConnectionCalendarUpdateSchema.array().parse(request.body);
      const results: CalendarConnectionCalendar[] = [];

      // Checkpoint 9.5 review: a Google calendar toggled on here must be an
      // event target IMMEDIATELY, with its real name. The insert branch used
      // to write access_role = NULL and the calendar KEY as the summary,
      // leaving it ineligible (unknown is never writable) and mis-named
      // until Settings happened to re-read the live listing. One
      // listCalendars call per PATCH request -- and only when the body
      // names at least one Google calendar not yet persisted -- resolves
      // both. A listing failure degrades to the old behaviour rather than
      // failing the toggle: the row still lands, role NULL, and the next
      // GET .../available-calendars repairs it. Ids-only log.
      const listing = await resolveGoogleListingForInserts(app, request.log, connection, body);

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
          const listed = isCaldav ? undefined : listing?.get(item.google_calendar_id!);
          [row] = await app.db
            .insert(calendarConnectionCalendars)
            .values({
              connectionId: connection.id,
              googleCalendarId: isCaldav ? null : item.google_calendar_id,
              caldavCalendarUrl: isCaldav ? item.caldav_calendar_url : null,
              summary: listed?.summary || calendarKey,
              syncEnabled: item.sync_enabled,
              projectId: item.project_id ?? null,
              accessRole: listed?.accessRole ?? null,
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

type GoogleListing = Map<string, { summary: string; accessRole: string | null }>;

// One live calendarList read for a PATCH .../calendars request, keyed by
// google calendar id -- or null when nothing needs it (a CalDAV connection,
// an inactive Google connection, or a body whose Google calendars are all
// already persisted) or when the listing cannot be read (token refresh or
// provider failure). Never throws: the caller's insert falls back to a NULL
// role and the key as summary.
async function resolveGoogleListingForInserts(
  app: FastifyInstance,
  log: FastifyBaseLogger,
  connection: typeof calendarConnections.$inferSelect,
  body: Array<{ google_calendar_id?: string }>,
): Promise<GoogleListing | null> {
  if (connection.provider !== "google" || connection.status !== "active") return null;
  const requested = body
    .map((item) => item.google_calendar_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  if (requested.length === 0) return null;
  const persisted = await app.db
    .select({ googleCalendarId: calendarConnectionCalendars.googleCalendarId })
    .from(calendarConnectionCalendars)
    .where(
      and(
        eq(calendarConnectionCalendars.connectionId, connection.id),
        inArray(calendarConnectionCalendars.googleCalendarId, requested),
      ),
    );
  const persistedIds = new Set(persisted.map((row) => row.googleCalendarId));
  if (requested.every((id) => persistedIds.has(id))) return null;

  try {
    const accessToken = await resolveAccessTokenForRequest(app, connection);
    const result = await app.googleCalendarClient.listCalendars(accessToken);
    const listing: GoogleListing = new Map();
    for (const item of result.items) {
      listing.set(item.id, { summary: item.summary, accessRole: item.accessRole ?? null });
    }
    return listing;
  } catch (err: unknown) {
    log.warn(
      { connectionId: connection.id, error: errorToken(err) },
      "calendar-connections: calendar listing unavailable during PATCH; inserting without access_role",
    );
    return null;
  }
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
