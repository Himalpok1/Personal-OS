import {
  MonitorIncidentListResponseSchema,
  MonitorIncidentSchema,
  MonitorOverviewResponseSchema,
  MonitorTargetCreateSchema,
  MonitorTargetSchema,
  MonitorTargetUpdateSchema,
  type MonitorIncident,
  type MonitorIncidentListResponse,
  type MonitorOverviewResponse,
  type MonitorTarget,
  type MonitorTargetCreate,
  type MonitorTargetUpdate,
} from "@personal-os/schema";
import { buildQuery, fetchJson } from "./client.js";

export type { MonitorTarget, MonitorTargetCreate, MonitorTargetUpdate };

// Service monitoring client (Checkpoint 7.6).
//
// Every response is parsed at this boundary, which is what makes the schema's
// guarantees load-bearing rather than documentary. `MonitorFailureClassSchema`
// is a shape-constrained token, so a server regression that leaked a probe
// error's prose -- which can carry the target URL, and a target URL may
// legitimately contain a token -- fails HERE with a parse error instead of
// reaching a screen. That is the same mechanism `MailConnectionSchema`'s closed
// `MailSyncErrorCode` enum provides, adopted after Google's own
// `error_description` reached the Settings banner in Checkpoint 6.5.

export interface MonitorIncidentListParams {
  targetId?: string;
  activeOnly?: boolean;
  limit?: number;
  offset?: number;
}

/** Every target, its newest check, and its active incident. Archived targets excluded unless requested. */
export async function getMonitorOverview(
  baseUrl: string,
  includeArchived = false,
): Promise<MonitorOverviewResponse> {
  const query = buildQuery({ include_archived: includeArchived || undefined });
  return await fetchJson(baseUrl, `/monitor/targets${query}`, MonitorOverviewResponseSchema);
}

/** A single target's full configuration, archived or not. */
export async function getMonitorTarget(baseUrl: string, id: string): Promise<MonitorTarget> {
  return await fetchJson(
    baseUrl,
    `/monitor/targets/${encodeURIComponent(id)}`,
    MonitorTargetSchema,
  );
}

/** Creates a monitor target. Throws `ApiClientError` (409 `name_already_exists`) on a duplicate name. */
export async function createMonitorTarget(
  baseUrl: string,
  input: MonitorTargetCreate,
): Promise<MonitorTarget> {
  const parsed = MonitorTargetCreateSchema.parse(input);
  return await fetchJson(baseUrl, "/monitor/targets", MonitorTargetSchema, {
    method: "POST",
    body: JSON.stringify(parsed),
  });
}

/**
 * Edits a target's configuration. Never `enabled` or archiving -- see
 * `enableMonitorTarget`/`disableMonitorTarget`/`archiveMonitorTarget`.
 *
 * Throws `ApiClientError` with `.code === "target_has_active_incident"` (409)
 * if the patch changes `url`/`kind` while an incident is open on this target.
 */
export async function updateMonitorTarget(
  baseUrl: string,
  id: string,
  patch: MonitorTargetUpdate,
): Promise<MonitorTarget> {
  const parsed = MonitorTargetUpdateSchema.parse(patch);
  return await fetchJson(
    baseUrl,
    `/monitor/targets/${encodeURIComponent(id)}`,
    MonitorTargetSchema,
    { method: "PATCH", body: JSON.stringify(parsed) },
  );
}

/** Enables a target -- resumes future probes on the worker's next pass. */
export async function enableMonitorTarget(baseUrl: string, id: string): Promise<MonitorTarget> {
  return await fetchJson(
    baseUrl,
    `/monitor/targets/${encodeURIComponent(id)}/enable`,
    MonitorTargetSchema,
    { method: "POST" },
  );
}

/**
 * Disables a target -- stops future probes immediately. An incident already
 * open when a target is disabled stays open (nothing auto-resolves it); the
 * caller should warn about that BEFORE calling this when
 * `active_incident !== null`, using the fact already returned by
 * `getMonitorOverview`.
 */
export async function disableMonitorTarget(baseUrl: string, id: string): Promise<MonitorTarget> {
  return await fetchJson(
    baseUrl,
    `/monitor/targets/${encodeURIComponent(id)}/disable`,
    MonitorTargetSchema,
    { method: "POST" },
  );
}

/**
 * Archives a target -- the CRUD "delete". Never destroys check/incident
 * history (both remain in the database); removes the target from the default
 * `getMonitorOverview` list. There is no unarchive call.
 */
export async function archiveMonitorTarget(baseUrl: string, id: string): Promise<MonitorTarget> {
  return await fetchJson(
    baseUrl,
    `/monitor/targets/${encodeURIComponent(id)}/archive`,
    MonitorTargetSchema,
    { method: "POST" },
  );
}

/**
 * Incident history, newest first.
 *
 * Values are handed to `buildQuery` raw: it runs them through
 * `URLSearchParams`, which percent-encodes already. Pre-encoding here would
 * double-escape.
 */
export async function listMonitorIncidents(
  baseUrl: string,
  params: MonitorIncidentListParams = {},
): Promise<MonitorIncidentListResponse> {
  const query = buildQuery({
    target_id: params.targetId,
    active_only: params.activeOnly,
    limit: params.limit,
    offset: params.offset,
  });
  return await fetchJson(baseUrl, `/monitor/incidents${query}`, MonitorIncidentListResponseSchema);
}

/**
 * Marks an incident as seen.
 *
 * ACKNOWLEDGEMENT IS NOT RESOLUTION -- the incident stays active and the target
 * is still down. The call is idempotent: acknowledging an already-acknowledged
 * incident succeeds and returns the unchanged row rather than failing, because
 * the most likely way a user reaches that state is double-tapping a button that
 * already worked.
 *
 * Sends NO BODY, so `fetchJson` omits `Content-Type`.
 */
export async function acknowledgeMonitorIncident(
  baseUrl: string,
  id: string,
): Promise<MonitorIncident> {
  return await fetchJson(
    baseUrl,
    `/monitor/incidents/${encodeURIComponent(id)}/acknowledge`,
    MonitorIncidentSchema,
    { method: "POST" },
  );
}
