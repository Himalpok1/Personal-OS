import { isValidTimezone } from "@personal-os/core/timezone";
import { z } from "zod";
import { booleanQueryParam, paginatedResponseSchema } from "./pagination.js";

// Google Health contracts (ADR-046..050).
//
// NAMING: this file is health-metrics.ts, NOT health.ts -- that name is already
// taken by HealthCheckResponseSchema, the API's liveness probe, which is
// exported by name from index.ts. Likewise every route is a /health-* sibling
// rather than a child of /health.
//
// SECURITY: every response schema here deliberately excludes all credential
// material -- no access/refresh token, no ciphertext, no iv, no auth tag, and
// no raw OAuth state. Same convention (and same reason) as
// calendar-connections.ts and ai-provider.ts: a future UI cannot leak a secret
// by reusing an existing response shape, because the shape cannot express one.

const LocalDateSchema = z.string().date();

// ---------------------------------------------------------------------------
// Vocabularies
// ---------------------------------------------------------------------------
// Mirrored from the database CHECK constraints. `metric`, `provider`,
// `source_family` and `failure_class` are deliberately NOT enums here or in
// Postgres (ADR-050) -- they are provider-defined or growing, and pinning them
// would turn adding a metric into a migration.

export const HealthConnectionStatusSchema = z.enum([
  "active",
  "needs_reauth",
  "revoked",
  "disconnected",
]);
export type HealthConnectionStatus = z.infer<typeof HealthConnectionStatusSchema>;

export const HealthBackfillStatusSchema = z.enum([
  "idle",
  "running",
  "paused",
  "cancelled",
  "complete",
  "failed",
]);
export type HealthBackfillStatus = z.infer<typeof HealthBackfillStatusSchema>;

/** Outcome of the capability probe for one metric on one account. */
export const HealthCapabilityStatusSchema = z.enum([
  "available",
  "empty",
  "forbidden",
  "unsupported",
  "error",
]);
export type HealthCapabilityStatus = z.infer<typeof HealthCapabilityStatusSchema>;

export const HealthSyncRunKindSchema = z.enum(["hot", "warm", "backfill", "manual"]);
export type HealthSyncRunKind = z.infer<typeof HealthSyncRunKindSchema>;

export const HealthSyncRunStatusSchema = z.enum(["succeeded", "failed", "skipped", "cancelled"]);
export type HealthSyncRunStatus = z.infer<typeof HealthSyncRunStatusSchema>;

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export const HealthConnectionSchema = z.object({
  id: z.string().uuid(),
  provider: z.string(),
  // The account-binding identity. The three approved read scopes return no
  // email and no OIDC id_token, so there is deliberately no account email here
  // -- promising one would require a fourth scope.
  health_user_id: z.string(),
  legacy_user_id: z.string().nullable(),
  granted_scope: z.string().nullable(),
  source_family: z.string(),
  status: HealthConnectionStatusSchema,
  identity_verified_at: z.string().datetime({ offset: true }).nullable(),
  last_sync_error: z.string().nullable(),
  last_sync_error_at: z.string().datetime({ offset: true }).nullable(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});
export type HealthConnection = z.infer<typeof HealthConnectionSchema>;

export const HealthConnectionListResponseSchema = z.object({
  items: z.array(HealthConnectionSchema),
});
export type HealthConnectionListResponse = z.infer<typeof HealthConnectionListResponseSchema>;

export const HealthMetricStreamSchema = z.object({
  id: z.string().uuid(),
  connection_id: z.string().uuid(),
  metric: z.string(),
  sync_enabled: z.boolean(),
  capability_status: HealthCapabilityStatusSchema.nullable(),
  capability_checked_at: z.string().datetime({ offset: true }).nullable(),
  verified_through_date: LocalDateSchema.nullable(),
  earliest_verified_date: LocalDateSchema.nullable(),
  first_data_date: LocalDateSchema.nullable(),
  // Where "we checked" is recorded -- deliberately at stream level rather than
  // on every data row, so two identical consecutive syncs write no health data.
  last_successful_sync_at: z.string().datetime({ offset: true }).nullable(),
  last_full_sync_at: z.string().datetime({ offset: true }).nullable(),
  backfill_status: HealthBackfillStatusSchema,
  backfill_target_date: LocalDateSchema.nullable(),
  backfill_cursor_date: LocalDateSchema.nullable(),
  backfill_cancel_requested: z.boolean(),
  last_sync_error: z.string().nullable(),
});
export type HealthMetricStream = z.infer<typeof HealthMetricStreamSchema>;

export const HealthMetricStreamListResponseSchema = z.object({
  items: z.array(HealthMetricStreamSchema),
});
export type HealthMetricStreamListResponse = z.infer<typeof HealthMetricStreamListResponseSchema>;

// `value` crosses the wire as a string: the column is numeric, which is exact
// for both int64 counts and decimal kcal, and Drizzle maps numeric to string.
// Coercing to a JS number at the DB boundary would reintroduce the float
// imprecision numeric was chosen to avoid; the presentation layer coerces.
export const HealthDailyMetricSchema = z.object({
  metric: z.string(),
  local_date: LocalDateSchema,
  has_data: z.boolean(),
  value: z.string().nullable(),
  breakdown: z.unknown().nullable(),
  source_count: z.number().int().nullable(),
});
export type HealthDailyMetric = z.infer<typeof HealthDailyMetricSchema>;

export const HealthObservationSchema = z.object({
  metric: z.string(),
  observed_at_utc: z.string().datetime({ offset: true }),
  local_date: LocalDateSchema,
  utc_offset_seconds: z.number().int(),
  value: z.string(),
});
export type HealthObservation = z.infer<typeof HealthObservationSchema>;

export const HealthSessionSchema = z.object({
  metric: z.string(),
  attributed_local_date: LocalDateSchema,
  start_at: z.string().datetime({ offset: true }),
  end_at: z.string().datetime({ offset: true }),
  start_utc_offset_seconds: z.number().int(),
  end_utc_offset_seconds: z.number().int(),
  // Always derived from the physical instants. Civil-clock subtraction is wrong
  // across a DST transition in both directions.
  duration_seconds: z.number().int().min(0),
  detail: z.unknown(),
});
export type HealthSession = z.infer<typeof HealthSessionSchema>;

export const HealthSyncRunSchema = z.object({
  id: z.string().uuid(),
  metric: z.string(),
  kind: HealthSyncRunKindSchema,
  status: HealthSyncRunStatusSchema,
  range_start_date: LocalDateSchema,
  range_end_date: LocalDateSchema,
  failure_class: z.string().nullable(),
  rows_inserted: z.number().int(),
  rows_updated: z.number().int(),
  rows_unchanged: z.number().int(),
  rows_tombstoned: z.number().int(),
  rows_rejected: z.number().int(),
  rows_collapsed: z.number().int(),
  started_at: z.string().datetime({ offset: true }),
  finished_at: z.string().datetime({ offset: true }).nullable(),
});
export type HealthSyncRun = z.infer<typeof HealthSyncRunSchema>;

export const HealthDailyMetricListResponseSchema = paginatedResponseSchema(HealthDailyMetricSchema);
export const HealthSessionListResponseSchema = paginatedResponseSchema(HealthSessionSchema);

/**
 * Freshness is always exposed alongside data so a client can say "as of 12
 * minutes ago" rather than implying live values. There is deliberately no
 * device-pairing signal here -- that would require a fourth OAuth scope
 * (`settings.readonly`), so freshness is inferred from data timestamps instead.
 */
export const HealthFreshnessSchema = z.object({
  verified_through_date: LocalDateSchema.nullable(),
  last_successful_sync_at: z.string().datetime({ offset: true }).nullable(),
});
export type HealthFreshness = z.infer<typeof HealthFreshnessSchema>;

// ---------------------------------------------------------------------------
// Requests -- all .strict()
// ---------------------------------------------------------------------------

/**
 * `redirect_uri` is echoed back, never chosen freely: the server validates it
 * against an exact-match allowlist on both authorize-URL generation and code
 * exchange. Accepting an arbitrary client-supplied redirect would be an open
 * redirect against our own OAuth client.
 */
export const HealthAuthorizeUrlQuerySchema = z.object({ redirect_uri: z.string().url() }).strict();
export type HealthAuthorizeUrlQuery = z.infer<typeof HealthAuthorizeUrlQuerySchema>;

export const HealthAuthorizeUrlResponseSchema = z.object({
  url: z.string().url(),
  state_expires_at: z.string().datetime({ offset: true }),
});
export type HealthAuthorizeUrlResponse = z.infer<typeof HealthAuthorizeUrlResponseSchema>;

// `auth_code` reuses the exact field name the API's logger already redacts.
export const ConnectGoogleHealthRequestSchema = z
  .object({
    auth_code: z.string().min(1),
    redirect_uri: z.string().url(),
    state: z.string().min(1),
  })
  .strict();
export type ConnectGoogleHealthRequest = z.infer<typeof ConnectGoogleHealthRequestSchema>;

export const HealthStreamUpdateSchema = z
  .object({ metric: z.string().min(1), sync_enabled: z.boolean() })
  .strict();
export type HealthStreamUpdate = z.infer<typeof HealthStreamUpdateSchema>;

export const HealthBackfillRequestSchema = z.object({ target_date: LocalDateSchema }).strict();
export type HealthBackfillRequest = z.infer<typeof HealthBackfillRequestSchema>;

export const HealthSyncRequestSchema = z
  .object({ kind: z.enum(["hot", "warm"]).default("warm") })
  .strict();
export type HealthSyncRequest = z.infer<typeof HealthSyncRequestSchema>;

export const HealthSyncQueuedResponseSchema = z.object({ queued: z.number().int().min(0) });
export type HealthSyncQueuedResponse = z.infer<typeof HealthSyncQueuedResponseSchema>;

const TimezoneSchema = z.string().refine(isValidTimezone, { message: "unknown IANA timezone" });

export const HealthMetricsQuerySchema = z
  .object({
    metric: z.string().min(1),
    from: LocalDateSchema,
    to: LocalDateSchema,
    include_empty: booleanQueryParam(true),
  })
  .strict()
  .refine((v) => v.from < v.to, {
    message: "from must be before to",
    path: ["from"],
  });
export type HealthMetricsQuery = z.infer<typeof HealthMetricsQuerySchema>;

export const HealthIntradayQuerySchema = z
  .object({ metric: z.string().min(1), date: LocalDateSchema, tz: TimezoneSchema })
  .strict();
export type HealthIntradayQuery = z.infer<typeof HealthIntradayQuerySchema>;

export const HealthSessionsQuerySchema = z
  .object({ metric: z.string().min(1), from: LocalDateSchema, to: LocalDateSchema })
  .strict()
  .refine((v) => v.from < v.to, {
    message: "from must be before to",
    path: ["from"],
  });
export type HealthSessionsQuery = z.infer<typeof HealthSessionsQuerySchema>;

export const HealthSummaryQuerySchema = z.object({ tz: TimezoneSchema }).strict();
export type HealthSummaryQuery = z.infer<typeof HealthSummaryQuerySchema>;
