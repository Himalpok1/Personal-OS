import {
  MonitorIncidentListResponseSchema,
  MonitorIncidentSchema,
  MonitorOverviewResponseSchema,
  type MonitorIncident,
  type MonitorIncidentListResponse,
  type MonitorOverviewResponse,
} from "@personal-os/schema";
import { buildQuery, fetchJson } from "./client.js";

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

/** Every target, its newest check, and its active incident. */
export async function getMonitorOverview(baseUrl: string): Promise<MonitorOverviewResponse> {
  return await fetchJson(baseUrl, "/monitor/targets", MonitorOverviewResponseSchema);
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
