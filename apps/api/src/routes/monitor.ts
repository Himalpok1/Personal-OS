// Service monitoring read surface + incident acknowledgement (Checkpoint 7.6,
// ADR-055).
//
// ===========================================================================
// THESE ROUTES READ ROWS. THEY NEVER PROBE.
// ===========================================================================
//
// `@personal-os/monitoring` exports `probeHttp`, `probeTls` and
// `connectForTlsCertificate` from the same barrel this file imports, and calling
// one of them here would be a serious mistake rather than a shortcut: an HTTP
// handler would open sockets to third-party hosts on a user's page load, the
// result would be recorded nowhere (probing and `recordCheck` are deliberately
// separate), and a screen refresh would become a load generator pointed at the
// services it is supposed to be watching.
//
// Probing belongs to exactly two places, both scheduled: the worker's
// `monitor.run` cron for `http` targets, and the API's own heartbeat watchdog
// for the `worker_heartbeat` one. Reads come from `monitor_checks`.
//
// ---------------------------------------------------------------------------
// THE WIRE CARRIES FACTS, NOT A VERDICT.
//
// No response here contains a "status" word, a colour, or a health judgement.
// The precedence between display states is the design, it belongs in one tested
// client module (the health dashboard settled this with
// `resolveHealthConnectionState`), and computing it in two places would let the
// API and the screen disagree about the same target.
//
// ---------------------------------------------------------------------------
// A FAILURE CLASS IS A TOKEN AND IS SANITIZED ON THE WAY OUT.
//
// `sanitizeMonitorFailureClass` runs on every projection, so a row written by an
// older or buggier build cannot put prose on the wire -- the boundary-guard
// pattern `sanitizeMailSyncErrorCode` and `sanitizeCalendarSyncErrorCode`
// established after Google's own `error_description` reached the Settings screen
// in Checkpoint 6.5. There is no message field to leak: probe errors are reduced
// to tokens before they are ever stored.
import {
  acknowledgeIncident,
  archiveMonitorTarget,
  createMonitorTarget,
  findIncidentWithTarget,
  getMonitorTarget,
  listMonitorIncidents,
  listMonitorTargetStatus,
  setMonitorTargetEnabled,
  updateMonitorTarget,
  MonitorTargetActiveIncidentError,
  type MonitorIncidentRow,
  type MonitorTargetRow,
} from "@personal-os/monitoring";
import {
  MonitorIncidentListQuerySchema,
  MonitorIncidentListResponseSchema,
  MonitorIncidentSchema,
  MonitorOverviewResponseSchema,
  MonitorTargetCreateSchema,
  MonitorTargetListQuerySchema,
  MonitorTargetSchema,
  MonitorTargetUpdateSchema,
  sanitizeMonitorFailureClass,
  type MonitorIncident,
  type MonitorIncidentListResponse,
  type MonitorLatestCheck,
  type MonitorOverviewResponse,
  type MonitorTarget,
} from "@personal-os/schema";
import type { FastifyInstance } from "fastify";
import type { monitorChecks } from "@personal-os/db";

/**
 * True for a Postgres unique-violation, whatever the constraint.
 *
 * drizzle-orm wraps the underlying `pg` error as `.cause` rather than exposing
 * `code` directly on the thrown error, so both are checked -- the same
 * extraction `apps/worker/src/jobs/generate-lazy-occurrence.ts` already uses
 * for the identical reason.
 */
function isUniqueViolation(err: unknown): boolean {
  return pgErrorCode(err) === "23505";
}

function pgErrorCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const direct = (err as { code?: unknown }).code;
  if (typeof direct === "string") return direct;
  const cause = (err as { cause?: unknown }).cause;
  if (typeof cause === "object" && cause !== null) {
    const causeCode = (cause as { code?: unknown }).code;
    if (typeof causeCode === "string") return causeCode;
  }
  return undefined;
}

type MonitorCheckRow = typeof monitorChecks.$inferSelect;

function toTarget(row: MonitorTargetRow): MonitorTarget {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as MonitorTarget["kind"],
    // PROJECTED DELIBERATELY. A monitoring view that cannot say which endpoint
    // is down is not worth having (see MonitorTargetSchema's own note). What is
    // never projected is a probe error's text -- that is the channel through
    // which a URL carrying a token would escape unintentionally.
    url: row.url,
    expected_status: row.expectedStatus,
    expect_healthy_payload: row.expectHealthyPayload,
    timeout_ms: row.timeoutMs,
    interval_seconds: row.intervalSeconds,
    failure_threshold: row.failureThreshold,
    recovery_threshold: row.recoveryThreshold,
    tls_warn_days: row.tlsWarnDays,
    heartbeat_max_age_seconds: row.heartbeatMaxAgeSeconds,
    enabled: row.enabled,
    // `time` columns come back as strings ("22:00:00"), which is what the schema
    // expects -- no hand-rolled HH:MM formatting, which is where drift starts.
    maintenance_start: row.maintenanceStart,
    maintenance_end: row.maintenanceEnd,
    maintenance_timezone: row.maintenanceTimezone,
    muted_until: row.mutedUntil ? row.mutedUntil.toISOString() : null,
    archived_at: row.archivedAt ? row.archivedAt.toISOString() : null,
  };
}

function toIncident(row: MonitorIncidentRow): MonitorIncident {
  return {
    id: row.id,
    target_id: row.targetId,
    status: row.status as MonitorIncident["status"],
    failure_class: sanitizeMonitorFailureClass(row.failureClass),
    opened_at: row.openedAt.toISOString(),
    acknowledged_at: row.acknowledgedAt ? row.acknowledgedAt.toISOString() : null,
    resolved_at: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    last_failure_at: row.lastFailureAt ? row.lastFailureAt.toISOString() : null,
  };
}

function toLatestCheck(row: MonitorCheckRow | null): MonitorLatestCheck | null {
  if (row === null) return null;
  return {
    // The column is plain `text` (the CHECK constraint is the database's
    // enforcement, not TypeScript's), so the cast is where the wire schema's
    // closed vocabulary is reasserted -- and `MonitorLatestCheckSchema` re-parses
    // it in the response, so a genuinely unexpected value fails loudly here
    // rather than reaching a screen.
    status: row.status as MonitorLatestCheck["status"],
    http_status: row.httpStatus,
    latency_ms: row.latencyMs,
    failure_class: sanitizeMonitorFailureClass(row.failureClass),
    tls_expires_at: row.tlsExpiresAt ? row.tlsExpiresAt.toISOString() : null,
    tls_days_remaining: row.tlsDaysRemaining,
    heartbeat_age_seconds: row.heartbeatAgeSeconds,
    checked_at: row.checkedAt.toISOString(),
  };
}

export default function monitorRoutes(app: FastifyInstance): void {
  /**
   * Every target, its newest check, and its active incident.
   *
   * `configured: false` when no target exists at all, and that is a DIFFERENT
   * answer from "every target is up". A deployment that has never run
   * `monitor:seed` is not being monitored, and a screen that rendered an empty
   * list as a clean bill of health would be making the strongest possible claim
   * from the weakest possible evidence. This is not hypothetical: no target has
   * ever been seeded in any environment, so it is the state every reader hits
   * first.
   */
  app.get<{ Querystring: Record<string, string> }>(
    "/monitor/targets",
    async (request): Promise<MonitorOverviewResponse> => {
      const query = MonitorTargetListQuerySchema.parse(request.query);
      const rows = await listMonitorTargetStatus(app.db, {
        includeArchived: query.include_archived,
      });

      return MonitorOverviewResponseSchema.parse({
        configured: rows.length > 0,
        items: rows.map((row) => ({
          target: toTarget(row.target),
          latest_check: toLatestCheck(row.latestCheck),
          active_incident: row.activeIncident ? toIncident(row.activeIncident) : null,
        })),
        // Counted from the rows already fetched rather than a second query: an
        // independent count could disagree with the list beside it, and two
        // numbers that contradict each other on one screen is worse than either.
        active_incident_count: rows.filter((row) => row.activeIncident !== null).length,
      } satisfies MonitorOverviewResponse);
    },
  );

  /** A single target's full configuration, archived or not -- a detail/edit screen needs both. */
  app.get<{ Params: { id: string } }>("/monitor/targets/:id", async (request, reply) => {
    const row = await getMonitorTarget(app.db, request.params.id);
    if (!row) return reply.code(404).send({ error: "not_found" });
    return MonitorTargetSchema.parse(toTarget(row));
  });

  /**
   * Creates a target (Checkpoint 8.6D).
   *
   * Validation is the SAME `MonitorTargetCreateSchema` `createMonitorTarget`
   * already parses through -- the cross-field rules (an `http` target needs a
   * url, `worker_heartbeat` must not have one, `tls_warn_days` needs
   * `https://`, the maintenance triple is all-or-nothing, the URL safety
   * check) reject an unmonitorable or unsafe target outright rather than
   * silently coercing it.
   */
  app.post("/monitor/targets", async (request, reply) => {
    const body = MonitorTargetCreateSchema.parse(request.body);
    try {
      const row = await createMonitorTarget(app.db, body);
      return reply.code(201).send(MonitorTargetSchema.parse(toTarget(row)));
    } catch (err) {
      if (isUniqueViolation(err)) {
        return reply.code(409).send({ error: "name_already_exists" });
      }
      throw err;
    }
  });

  /**
   * Edits a target's configuration.
   *
   * `enabled` and archiving are NOT accepted here -- see the dedicated
   * `/enable`, `/disable` and `/archive` routes below, matching ADR-039's rule
   * that a lifecycle transition gets its own endpoint, never a generic PATCH.
   *
   * `409 target_has_active_incident` is the one business-rule refusal this
   * route can produce: changing `url` or `kind` while an incident is open
   * would silently rewrite what that incident is "about" (see
   * `MonitorTargetActiveIncidentError`'s comment in
   * `@personal-os/monitoring`).
   */
  app.patch<{ Params: { id: string } }>("/monitor/targets/:id", async (request, reply) => {
    const body = MonitorTargetUpdateSchema.parse(request.body);
    try {
      const row = await updateMonitorTarget(app.db, request.params.id, body);
      if (!row) return reply.code(404).send({ error: "not_found" });
      return MonitorTargetSchema.parse(toTarget(row));
    } catch (err) {
      if (err instanceof MonitorTargetActiveIncidentError) {
        return reply.code(409).send({ error: "target_has_active_incident" });
      }
      if (isUniqueViolation(err)) {
        return reply.code(409).send({ error: "name_already_exists" });
      }
      throw err;
    }
  });

  /**
   * Enable/disable -- a first-class, dedicated action (Checkpoint 8.6D).
   *
   * Disabling stops future probes immediately: it is the SAME `enabled` column
   * the worker's suppression check has always read on every pass
   * (`apps/worker/src/monitor/run.ts`), so nothing here touches the probe
   * loop. An incident already open when a target is disabled is left exactly
   * as it is -- open -- because no further check ever runs to confirm
   * recovery; auto-resolving it on disable would record a recovery that was
   * never observed. The client is responsible for warning about that BEFORE
   * calling this route if an active incident exists (it already has that
   * fact, from `GET /monitor/targets`).
   */
  app.post<{ Params: { id: string } }>("/monitor/targets/:id/enable", async (request, reply) => {
    const row = await setMonitorTargetEnabled(app.db, request.params.id, true);
    if (!row) return reply.code(404).send({ error: "not_found" });
    return MonitorTargetSchema.parse(toTarget(row));
  });

  app.post<{ Params: { id: string } }>("/monitor/targets/:id/disable", async (request, reply) => {
    const row = await setMonitorTargetEnabled(app.db, request.params.id, false);
    if (!row) return reply.code(404).send({ error: "not_found" });
    return MonitorTargetSchema.parse(toTarget(row));
  });

  /**
   * Archives a target -- the CRUD "delete" (Checkpoint 8.6D).
   *
   * NEVER a hard `DELETE`: `monitor_checks`/`monitor_incidents` both cascade
   * from this row, and ADR-024 means there is no backup to recover an
   * accidental one from. Archiving sets `archived_at` (removed from the
   * default `GET /monitor/targets` list, still reachable with
   * `?include_archived=true` or by direct id) and `enabled = false` in one
   * statement -- see `archiveMonitorTarget`'s comment. Idempotent: archiving
   * an already-archived target just re-confirms the same state. There is no
   * unarchive route, matching `tasks`' own precedent.
   */
  app.post<{ Params: { id: string } }>("/monitor/targets/:id/archive", async (request, reply) => {
    const row = await archiveMonitorTarget(app.db, request.params.id);
    if (!row) return reply.code(404).send({ error: "not_found" });
    return MonitorTargetSchema.parse(toTarget(row));
  });

  /** Incident history, newest first, with honest totals. */
  app.get<{ Querystring: Record<string, string> }>(
    "/monitor/incidents",
    async (request): Promise<MonitorIncidentListResponse> => {
      const query = MonitorIncidentListQuerySchema.parse(request.query);
      const result = await listMonitorIncidents(app.db, {
        ...(query.target_id === undefined ? {} : { targetId: query.target_id }),
        activeOnly: query.active_only,
        limit: query.limit,
        offset: query.offset,
      });

      return MonitorIncidentListResponseSchema.parse({
        items: result.items.map((item) => ({
          incident: toIncident(item.incident),
          target_name: item.targetName,
        })),
        limit: query.limit,
        offset: query.offset,
        total: result.total,
      } satisfies MonitorIncidentListResponse);
    },
  );

  /**
   * Acknowledge an incident.
   *
   * ACKNOWLEDGEMENT IS NOT RESOLUTION. It records that a human has seen this,
   * nothing more: the incident stays active, the target stays down, and the
   * recovery path is still what resolves it. Treating an Ack button as "make it
   * go away" is how an outage stops being tracked while it is still happening.
   *
   * The care here is in the `undefined` return. `acknowledgeIncident` is
   * idempotent BY EXCLUSION -- its WHERE clause carries `ne(status,
   * "acknowledged")` and `isNull(resolvedAt)` -- so it returns `undefined` for
   * THREE genuinely different situations: the incident does not exist, it is
   * already acknowledged, or it has already resolved. Mapping all three to 404
   * would 404 on a double-tap of a button that had just succeeded, which is both
   * wrong and the most likely thing a user does. So the row is read first and
   * each case answered on its own terms.
   */
  app.post<{ Params: { id: string } }>(
    "/monitor/incidents/:id/acknowledge",
    async (request, reply) => {
      const { id } = request.params;
      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        return reply.code(400).send({ error: "validation_failed" });
      }

      const existing = await findIncidentWithTarget(app.db, id);
      if (existing === null) {
        return reply.code(404).send({ error: "not_found" });
      }
      if (existing.incident.resolvedAt !== null) {
        // Not an error the user caused -- the outage ended between rendering the
        // list and tapping. Named distinctly so a screen can say so.
        return reply.code(409).send({ error: "incident_already_resolved" });
      }

      const updated = await acknowledgeIncident(app.db, id, new Date());
      // `undefined` here now means only one thing: it was already acknowledged.
      // Idempotent, so the already-acknowledged row is returned as a success --
      // the caller asked for a state the system is already in.
      const row = updated ?? existing.incident;
      return reply.send(MonitorIncidentSchema.parse(toIncident(row)));
    },
  );
}
