import {
  HealthConnectionListResponseSchema,
  HealthMetricSeriesResponseSchema,
  HealthMetricStreamListResponseSchema,
  HealthSeriesQuerySchema,
  HealthSessionRangeQuerySchema,
  HealthSleepListResponseSchema,
  HealthSummaryResponseSchema,
  HealthSyncQueuedResponseSchema,
  HealthSyncRequestSchema,
  HealthWorkoutListResponseSchema,
  type HealthAggregation,
  type HealthConnection,
  type HealthConnectionListResponse,
  type HealthConnectionSummary,
  type HealthFreshnessDetail,
  type HealthMetricCapability,
  type HealthMetricPoint,
  type HealthMetricSeriesResponse,
  type HealthMetricStream,
  type HealthMetricStreamListResponse,
  type HealthMetricTile,
  type HealthSeriesQuery,
  type HealthSessionRangeQuery,
  type HealthSleepListResponse,
  type HealthSleepSession,
  type HealthSummaryResponse,
  type HealthSyncQueuedResponse,
  type HealthValueState,
  type HealthWorkoutListResponse,
  type HealthWorkoutSession,
} from "@personal-os/schema";
import { buildQuery, fetchJson } from "./client.js";

export type {
  HealthAggregation,
  HealthConnection,
  HealthConnectionListResponse,
  HealthConnectionSummary,
  HealthFreshnessDetail,
  HealthMetricCapability,
  HealthMetricPoint,
  HealthMetricSeriesResponse,
  HealthMetricStream,
  HealthMetricStreamListResponse,
  HealthMetricTile,
  HealthSeriesQuery,
  HealthSessionRangeQuery,
  HealthSleepListResponse,
  HealthSleepSession,
  HealthSummaryResponse,
  HealthSyncQueuedResponse,
  HealthValueState,
  HealthWorkoutListResponse,
  HealthWorkoutSession,
};

// Every response here is parsed at the boundary through the frozen 6.4
// schemas, which is load-bearing rather than ceremonial: HealthMetricPoint
// carries a refine asserting `value` is non-null exactly when
// `state === "value"`. That is the "missing is never zero" guarantee
// (ADR-047) reaching the client -- a server regression that zero-filled a gap
// would fail here instead of quietly rendering a fabricated 0.

// Client-side params, not the server's HealthSeriesQuery/HealthSessionRangeQuery
// -- same reason TaskListParams exists. Those schemas parse a raw HTTP
// querystring, so their *input* type is `unknown` for every preprocessed or
// coerced field (include_empty, limit, offset) and their *output* type has the
// defaults already applied, which would force a caller to supply values it has
// no opinion about. Neither is a usable shape for constructing a request from
// idiomatic JS values, so the precise types are declared here and the frozen
// schema is still used as the validator below.
export interface HealthSeriesParams {
  metric: string;
  from: string;
  /** Inclusive, matching the route -- see HealthSeriesQuerySchema's note. */
  to: string;
  include_empty?: boolean;
}

export interface HealthSessionRangeParams {
  from: string;
  /** Inclusive. */
  to: string;
  limit?: number;
  offset?: number;
}

// A connection id is a uuid today and needs no escaping, so this is defence
// against a future identifier shape rather than a live fix. Query values are
// deliberately NOT encoded by hand anywhere in this file: buildQuery goes
// through URLSearchParams, which already percent-encodes (`America/Chicago`
// becomes `America%2FChicago`), and pre-encoding would double-escape it.
function pathSegment(value: string): string {
  return encodeURIComponent(value);
}

export async function getHealthSummary(
  baseUrl: string,
  tz: string,
): Promise<HealthSummaryResponse> {
  return fetchJson(baseUrl, `/health-summary${buildQuery({ tz })}`, HealthSummaryResponseSchema);
}

/**
 * The request is validated locally before it is sent. The 366-day cap and the
 * from/to ordering rule live in HealthSeriesQuerySchema, and running them here
 * turns a year-and-a-day range into a synchronous ZodError instead of a round
 * trip that the server would reject anyway -- the same reason the mutating
 * clients in this package parse their bodies before POSTing.
 *
 * `include_empty` is forwarded only when the caller stated an opinion.
 * buildQuery drops undefined entries and serialises a boolean via String(),
 * producing the exact literal "true"/"false" that the server's
 * booleanQueryParam accepts -- the Phase 2 `Boolean("false") === true` defect
 * is why that helper takes only those two spellings.
 */
export async function getHealthMetricSeries(
  baseUrl: string,
  params: HealthSeriesParams,
): Promise<HealthMetricSeriesResponse> {
  HealthSeriesQuerySchema.parse(params);
  const query = buildQuery({
    metric: params.metric,
    from: params.from,
    to: params.to,
    include_empty: params.include_empty,
  });
  return fetchJson(baseUrl, `/health-metrics${query}`, HealthMetricSeriesResponseSchema);
}

export async function getHealthSleepSessions(
  baseUrl: string,
  params: HealthSessionRangeParams,
): Promise<HealthSleepListResponse> {
  HealthSessionRangeQuerySchema.parse(params);
  return fetchJson(baseUrl, `/health-sleep${buildQuery(params)}`, HealthSleepListResponseSchema);
}

export async function getHealthWorkoutSessions(
  baseUrl: string,
  params: HealthSessionRangeParams,
): Promise<HealthWorkoutListResponse> {
  HealthSessionRangeQuerySchema.parse(params);
  return fetchJson(
    baseUrl,
    `/health-workouts${buildQuery(params)}`,
    HealthWorkoutListResponseSchema,
  );
}

export async function listHealthConnections(
  baseUrl: string,
): Promise<HealthConnectionListResponse> {
  return fetchJson(baseUrl, "/health-connections", HealthConnectionListResponseSchema);
}

export async function listHealthMetricStreams(
  baseUrl: string,
  connectionId: string,
): Promise<HealthMetricStreamListResponse> {
  return fetchJson(
    baseUrl,
    `/health-connections/${pathSegment(connectionId)}/streams`,
    HealthMetricStreamListResponseSchema,
  );
}

/**
 * Unlike the bodyless action POSTs elsewhere in this package, this one carries
 * a real JSON body, so fetchJson correctly sets Content-Type. `warm` is the
 * default because it is the pass that can densify and tombstone; `hot` is the
 * cheap recent-window refresh and never writes verified-absence rows
 * (ADR-046a/047a).
 */
export async function syncHealthConnectionNow(
  baseUrl: string,
  connectionId: string,
  kind?: "hot" | "warm",
): Promise<HealthSyncQueuedResponse> {
  const parsed = HealthSyncRequestSchema.parse({ kind });
  return fetchJson(
    baseUrl,
    `/health-connections/${pathSegment(connectionId)}/sync`,
    HealthSyncQueuedResponseSchema,
    { method: "POST", body: JSON.stringify(parsed) },
  );
}
