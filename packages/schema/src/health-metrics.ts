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

/**
 * Outcome of the capability assessment for one metric on one account.
 *
 * Six members, not five: Checkpoint 6.3 replaced the original vocabulary
 * because it could not distinguish "this account has never produced this
 * metric" from "this metric has history, just not inside the window we
 * fetched". That distinction is the whole reason the 6.2P probe misreported
 * heart rate and sleep as simply absent.
 *
 * The names are deliberately window-qualified. A verdict is always relative
 * to the range that was actually queried, and a caller that forgets this
 * draws exactly the wrong conclusion from an empty result.
 *
 * `not_supported` is reserved for an explicitly evidenced provider reason.
 * An ambiguous 400/403/404 is `provider_error` -- never a capability verdict
 * (see sync/capability.ts in @personal-os/health-providers).
 *
 * The `health_metric_streams.capability_status` column is unconstrained
 * `text` (ADR-050), so this enum is the only gate. It is enforced in both
 * directions: the worker parses through it on write, not just on read.
 */
export const HealthCapabilityStatusSchema = z.enum([
  "available_in_window",
  "supported_empty_in_window",
  "historical_data_outside_window",
  "missing_scope",
  "not_supported",
  "provider_error",
]);
export type HealthCapabilityStatus = z.infer<typeof HealthCapabilityStatusSchema>;

export const HealthSyncRunKindSchema = z.enum(["hot", "warm", "backfill", "manual"]);
export type HealthSyncRunKind = z.infer<typeof HealthSyncRunKindSchema>;

export const HealthSyncRunStatusSchema = z.enum(["succeeded", "failed", "skipped", "cancelled"]);
export type HealthSyncRunStatus = z.infer<typeof HealthSyncRunStatusSchema>;

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/**
 * The shape every health sync-error value must have to cross the API boundary.
 *
 * Health's writers have always stored their own classification tokens rather
 * than provider prose (`markHealthConnectionNeedsReauth` documents the rule
 * explicitly), so unlike calendar there is no closed enum to enforce -- the set
 * legitimately grows with each new failure class, and ADR-050 keeps it out of a
 * CHECK constraint for exactly that reason.
 *
 * What CAN be enforced without freezing the set is the SHAPE: a lowercase
 * machine token, optionally suffixed with one `:`-separated qualifier (the
 * `provider_error:503` / `client_request_defect:GOOGLE_REASON` forms the sync
 * engine emits). Prose cannot satisfy it -- it has spaces, punctuation and
 * capitals -- so a future writer that reaches for a message instead of a class
 * fails here rather than on a user's screen.
 */
const HEALTH_SYNC_ERROR_TOKEN = /^[a-z][a-z0-9_]{0,63}(:[A-Za-z0-9_.-]{1,64})?$/;

export const HealthSyncErrorTokenSchema = z.string().regex(HEALTH_SYNC_ERROR_TOKEN);

/**
 * Narrows a stored health sync-error to a token, or `"provider_error"` when it
 * is not token-shaped.
 *
 * Mirrors `sanitizeCalendarSyncErrorCode`. Applied at the projection site so a
 * legacy or unexpected value is neutralised without a data migration.
 */
export function sanitizeHealthSyncErrorToken(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  return HEALTH_SYNC_ERROR_TOKEN.test(raw) ? raw : "provider_error";
}

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
  // A classification token, never a message -- see HealthSyncErrorTokenSchema.
  last_sync_error: HealthSyncErrorTokenSchema.nullable(),
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
  // A classification token, never a message -- see HealthSyncErrorTokenSchema.
  last_sync_error: HealthSyncErrorTokenSchema.nullable(),
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

export const HealthSyncRunListResponseSchema = z.object({ items: z.array(HealthSyncRunSchema) });
export type HealthSyncRunListResponse = z.infer<typeof HealthSyncRunListResponseSchema>;

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

// ===========================================================================
// Checkpoint 6.4 -- the user-facing Health read surface
// ===========================================================================
//
// Four routes, all `/health-*` siblings because `/health` is already the
// liveness probe (recorded at Checkpoint 6.0):
//
//   GET /health-summary?tz=            dashboard for one requested-tz local day
//   GET /health-metrics?metric=&from=&to=&include_empty=   bounded daily series
//   GET /health-sleep?from=&to=&limit=&offset=             sleep, by WAKE date
//   GET /health-workouts?from=&to=&limit=&offset=          exercise sessions
//
// Two invariants run through every shape here and are the reason it is not
// simply the database tables projected outward:
//
// 1. MISSING IS NOT ZERO. `HealthMetricPointSchema` carries an explicit
//    three-state `state` and a `value` that is non-null if and only if
//    `state === "value"` -- enforced by a refine, so a zero-filled gap is
//    unrepresentable rather than merely discouraged. `value === "0"` with
//    `state === "value"` is a genuine recorded zero; that distinction is the
//    whole point of the has_data CHECK in migration 0013 (ADR-047) and it
//    must survive to the client. No read model may COALESCE it away.
//
// 2. NO ERROR STRINGS AND NO CREDENTIALS. Nothing here can express an access
//    token, a refresh token, ciphertext, an IV, an auth tag, an OAuth state,
//    or a provider error message. `health_connections.last_sync_error` is
//    deliberately NOT projected -- only the timestamp and a boolean -- so a
//    raw Google or Postgres message cannot reach a screen through this
//    surface. Same structural-exclusion reasoning as BriefInput (ADR-043).
//
// Raw intraday heart rate is excluded from all four routes by construction:
// `heart-rate-intraday` stays sync_enabled=false (6.2P F5 deferral) and
// `health_observations` is empty by design, so no shape below references it.

// ---------------------------------------------------------------------------
// Value state -- the missing/zero contract
// ---------------------------------------------------------------------------

/**
 * What we actually know about one metric on one civil date.
 *
 * `value`           a row exists with has_data = true. `value` is the exact
 *                   numeric as a string and MAY be "0" -- a genuine recorded
 *                   zero, which is data, not absence.
 * `verified_absent` a row exists with has_data = false. We fetched an
 *                   authoritative window covering this date and the provider
 *                   returned nothing for it.
 * `unknown`         no row at all. Either we have never verified this date, or
 *                   the pass that covered it was non-authoritative (hot never
 *                   densifies -- ADR-046a). The accompanying capability record
 *                   is what lets a client explain WHICH.
 *
 * The API states the fact; the client explains it. There is deliberately no
 * "no wearable paired" member -- that would be an inference, and asserting it
 * would need the `settings.readonly` scope this project never requested.
 */
export const HealthValueStateSchema = z.enum(["value", "verified_absent", "unknown"]);
export type HealthValueState = z.infer<typeof HealthValueStateSchema>;

export const HealthMetricPointSchema = z
  .object({
    local_date: LocalDateSchema,
    state: HealthValueStateSchema,
    // Crosses the wire as a string for the same reason HealthDailyMetric's
    // does: the column is numeric, exact for int64 counts and decimal kcal
    // alike, and coercing at the DB boundary reintroduces the float
    // imprecision numeric exists to avoid.
    value: z.string().nullable(),
    source_count: z.number().int().nullable(),
  })
  .refine((v) => (v.state === "value") === (v.value !== null), {
    message: "value must be non-null exactly when state is 'value'",
    path: ["value"],
  });
export type HealthMetricPoint = z.infer<typeof HealthMetricPointSchema>;

/**
 * How a day series is meaningfully aggregated. Declared by the catalog, not
 * guessed per screen: averaging steps or summing resting heart rate are both
 * nonsense, and deciding it in the client would put the same fact in as many
 * places as there are views.
 */
export const HealthAggregationSchema = z.enum(["sum", "average"]);
export type HealthAggregation = z.infer<typeof HealthAggregationSchema>;

// ---------------------------------------------------------------------------
// Capability -- why a value is missing
// ---------------------------------------------------------------------------

/**
 * Everything a client needs to explain an `unknown` or `verified_absent`
 * point without inventing a reason.
 *
 * `first_data_date === null` together with `capability_status ===
 * "supported_empty_in_window"` is the honest shape of "this account has never
 * produced this metric" -- which is the real state of twelve of the eighteen
 * streams on the development account. It is NOT "unsupported", and no client
 * may render it that way.
 */
export const HealthMetricCapabilitySchema = z.object({
  metric: z.string(),
  /** Catalog unit, so a client never has to hardcode one. */
  unit: z.string(),
  aggregation: HealthAggregationSchema,
  sync_enabled: z.boolean(),
  capability_status: HealthCapabilityStatusSchema.nullable(),
  capability_checked_at: z.string().datetime({ offset: true }).nullable(),
  verified_through_date: LocalDateSchema.nullable(),
  earliest_verified_date: LocalDateSchema.nullable(),
  /** Oldest civil date that has EVER returned real data for this stream. */
  first_data_date: LocalDateSchema.nullable(),
  last_successful_sync_at: z.string().datetime({ offset: true }).nullable(),
  backfill_status: HealthBackfillStatusSchema,
});
export type HealthMetricCapability = z.infer<typeof HealthMetricCapabilitySchema>;

export const HealthMetricTileSchema = z.object({
  metric: z.string(),
  unit: z.string(),
  aggregation: HealthAggregationSchema,
  point: HealthMetricPointSchema,
});
export type HealthMetricTile = z.infer<typeof HealthMetricTileSchema>;

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/**
 * The record's own provenance, exactly the three descriptive fields the API
 * returns on a DataSource. This is data ABOUT the record, not a device
 * inventory: `pairedDevices.list` needs `googlehealth.settings.readonly`,
 * a fourth scope this project deliberately never requested (ADR-046). A
 * client may say "recorded by a phone"; it may never claim to know which
 * devices are paired or when a wearable last synced.
 */
export const HealthSourceIdentitySchema = z.object({
  recording_method: z.string().nullable(),
  device_form_factor: z.string().nullable(),
  application_platform: z.string().nullable(),
});
export type HealthSourceIdentity = z.infer<typeof HealthSourceIdentitySchema>;

export const HealthSleepStageSchema = z.object({
  stage: z.string(),
  seconds: z.number().int().min(0),
});
export type HealthSleepStage = z.infer<typeof HealthSleepStageSchema>;

/**
 * One sleep session, keyed on its civil END (wake) date per ADR-049 -- which
 * is also the axis the provider filter and the tombstone sweep use, so the
 * field is named for what it means rather than for the column it comes from.
 *
 * `stages`, `asleep_seconds` and `awake_seconds` are ALWAYS null today, and
 * that is a deliberate, documented gap rather than an oversight. The
 * Checkpoint 6.3 sync engine stores an allowlisted `SessionDetail` of
 * {source, sessionType, sessionSubtype} only -- no stage breakdown is
 * captured, and capturing one would mean changing the sync engine and
 * re-fetching from Google, which 6.4 is not authorised to do. They are
 * modelled here so a client renders an honest "stage detail isn't available"
 * from the contract instead of hardcoding the absence, and so a future sync
 * change fills them without a shape change.
 */
export const HealthSleepSessionSchema = z.object({
  id: z.string().uuid(),
  wake_local_date: LocalDateSchema,
  start_at: z.string().datetime({ offset: true }),
  end_at: z.string().datetime({ offset: true }),
  start_utc_offset_seconds: z.number().int(),
  end_utc_offset_seconds: z.number().int(),
  /** Always derived from the physical instants, never civil subtraction. */
  duration_seconds: z.number().int().min(0),
  session_type: z.string().nullable(),
  session_subtype: z.string().nullable(),
  source: HealthSourceIdentitySchema,
  stages: z.array(HealthSleepStageSchema).nullable(),
  asleep_seconds: z.number().int().min(0).nullable(),
  awake_seconds: z.number().int().min(0).nullable(),
});
export type HealthSleepSession = z.infer<typeof HealthSleepSessionSchema>;

/**
 * One exercise session, keyed on its civil START date (ADR-049).
 *
 * `distance_meters`, `calories_kcal` and `heart_rate_zones` share the same
 * standing gap as sleep stages above: the stored SessionDetail carries none
 * of them, so they are always null today. No exercise session has ever been
 * observed on the development account either, so `session_type` values are
 * provider strings passed through verbatim and are never interpreted.
 */
export const HealthWorkoutSessionSchema = z.object({
  id: z.string().uuid(),
  start_local_date: LocalDateSchema,
  start_at: z.string().datetime({ offset: true }),
  end_at: z.string().datetime({ offset: true }),
  start_utc_offset_seconds: z.number().int(),
  end_utc_offset_seconds: z.number().int(),
  duration_seconds: z.number().int().min(0),
  session_type: z.string().nullable(),
  session_subtype: z.string().nullable(),
  source: HealthSourceIdentitySchema,
  distance_meters: z.string().nullable(),
  calories_kcal: z.string().nullable(),
  heart_rate_zones: z
    .array(z.object({ zone: z.string(), seconds: z.number().int().min(0) }))
    .nullable(),
});
export type HealthWorkoutSession = z.infer<typeof HealthWorkoutSessionSchema>;

export const HealthSleepListResponseSchema = paginatedResponseSchema(HealthSleepSessionSchema);
export type HealthSleepListResponse = z.infer<typeof HealthSleepListResponseSchema>;

export const HealthWorkoutListResponseSchema = paginatedResponseSchema(HealthWorkoutSessionSchema);
export type HealthWorkoutListResponse = z.infer<typeof HealthWorkoutListResponseSchema>;

// ---------------------------------------------------------------------------
// Connection + freshness
// ---------------------------------------------------------------------------

/**
 * Connection state for the dashboard.
 *
 * Note what is NOT here: `last_sync_error`. The column holds a message the
 * worker wrote, which has at times carried a Postgres `detail` (fixed in
 * 6.3's audit) and could carry a provider phrase. Only the timestamp and a
 * boolean cross this boundary, so "do not display raw provider errors" is a
 * property of the contract rather than a rule a screen has to remember.
 */
export const HealthConnectionSummarySchema = z.object({
  id: z.string().uuid(),
  provider: z.string(),
  status: HealthConnectionStatusSchema,
  identity_verified_at: z.string().datetime({ offset: true }).nullable(),
  granted_scopes: z.array(z.string()),
  /** Approved Phase 6A scopes the user did not grant. */
  missing_scopes: z.array(z.string()),
  has_partial_scope: z.boolean(),
  /** status is needs_reauth or revoked -- the user must reconnect. */
  needs_reconnect: z.boolean(),
  has_sync_error: z.boolean(),
  last_sync_error_at: z.string().datetime({ offset: true }).nullable(),
});
export type HealthConnectionSummary = z.infer<typeof HealthConnectionSummarySchema>;

/**
 * Freshness, derived only from durable rows -- health_metric_streams and
 * health_sync_runs -- never from an optimistic client claim.
 *
 * `sync_in_progress` is EXISTS(a run with finished_at IS NULL that started
 * within HEALTH_SYNC_RUN_STALE_MINUTES). The bound matches the queue's own
 * 900-second expiry, so a job killed mid-flight stops being reported as
 * running at exactly the moment pg-boss stops considering it active, rather
 * than pinning a spinner on the screen forever.
 */
export const HealthFreshnessDetailSchema = z.object({
  last_successful_sync_at: z.string().datetime({ offset: true }).nullable(),
  last_attempted_sync_at: z.string().datetime({ offset: true }).nullable(),
  last_attempt_status: HealthSyncRunStatusSchema.nullable(),
  verified_through_date: LocalDateSchema.nullable(),
  /** Whole civil days between verified_through_date and local_date. */
  days_behind: z.number().int().nullable(),
  is_stale: z.boolean(),
  staleness_threshold_days: z.number().int().min(1),
  sync_in_progress: z.boolean(),
});
export type HealthFreshnessDetail = z.infer<typeof HealthFreshnessDetailSchema>;

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

/**
 * `configured: false` means the server has no Google Health OAuth client at
 * all, which is production's state today -- distinct from "configured but
 * nobody has connected", which is `configured: true, connection: null`. The
 * two need different words on screen, so they are different fields.
 *
 * `today` holds one tile per non-session, non-intraday catalog metric for the
 * requested timezone's local date -- ALWAYS all of them, including `unknown`
 * ones, because a metric silently vanishing from an array is exactly the kind
 * of absence a user reads as zero.
 *
 * `latest` holds, for each metric that has ever recorded a value, that most
 * recent value with its own date. It is what lets a screen say "last recorded
 * Aug 23" instead of implying today's blank is a real zero. A metric with no
 * recorded value anywhere is simply absent from `latest`.
 */
export const HealthSummaryResponseSchema = z.object({
  configured: z.boolean(),
  connection: HealthConnectionSummarySchema.nullable(),
  timezone: z.string(),
  local_date: LocalDateSchema,
  freshness: HealthFreshnessDetailSchema,
  today: z.array(HealthMetricTileSchema),
  latest: z.array(HealthMetricTileSchema),
  latest_sleep: HealthSleepSessionSchema.nullable(),
  /** Mean nightly duration over the trailing 7 wake-dates, null if none. */
  sleep_7d_average_seconds: z.number().int().min(0).nullable(),
  latest_workout: HealthWorkoutSessionSchema.nullable(),
  capabilities: z.array(HealthMetricCapabilitySchema),
});
export type HealthSummaryResponse = z.infer<typeof HealthSummaryResponseSchema>;

// ---------------------------------------------------------------------------
// Series
// ---------------------------------------------------------------------------

/**
 * Aggregates are null unless at least one real value exists in the range.
 * There is no zero-filled mean anywhere: a week with two recorded days
 * averages those two days, and a week with none averages nothing.
 */
export const HealthSeriesSummarySchema = z.object({
  days_in_range: z.number().int().min(0),
  days_with_value: z.number().int().min(0),
  days_verified_absent: z.number().int().min(0),
  days_unknown: z.number().int().min(0),
  min: z.string().nullable(),
  max: z.string().nullable(),
  average: z.string().nullable(),
  total: z.string().nullable(),
});
export type HealthSeriesSummary = z.infer<typeof HealthSeriesSummarySchema>;

export const HealthMetricSeriesResponseSchema = z.object({
  metric: z.string(),
  unit: z.string(),
  aggregation: HealthAggregationSchema,
  from: LocalDateSchema,
  /** Inclusive. */
  to: LocalDateSchema,
  capability: HealthMetricCapabilitySchema,
  /**
   * Ascending by local_date. One entry per civil day in [from, to] when
   * include_empty is true (the default); when false, only days that have a
   * stored row -- so a caller filtering empties must read `summary` for the
   * honest day counts rather than `points.length`.
   */
  points: z.array(HealthMetricPointSchema),
  summary: HealthSeriesSummarySchema,
});
export type HealthMetricSeriesResponse = z.infer<typeof HealthMetricSeriesResponseSchema>;

// ---------------------------------------------------------------------------
// 6.4 request schemas
// ---------------------------------------------------------------------------

/**
 * The read surface's hard range bound, mirroring `/events/range`'s existing
 * 366-day cap rather than inventing a second number.
 */
export const HEALTH_MAX_RANGE_DAYS = 366;

/** Inclusive whole-day span between two YYYY-MM-DD strings. */
function inclusiveDaySpan(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000) + 1;
}

const boundedRange = <T extends { from: string; to: string }>(value: T, ctx: z.RefinementCtx) => {
  if (value.from > value.to) {
    ctx.addIssue({ code: "custom", message: "from must not be after to", path: ["from"] });
    return;
  }
  if (inclusiveDaySpan(value.from, value.to) > HEALTH_MAX_RANGE_DAYS) {
    ctx.addIssue({
      code: "custom",
      message: `range must not exceed ${HEALTH_MAX_RANGE_DAYS} days`,
      path: ["to"],
    });
  }
};

/**
 * `to` is INCLUSIVE here, unlike the half-open windows the sync engine uses
 * internally -- a user asking for "the last 7 days" means seven dates they
 * can name, and a half-open bound in a user-facing query is a permanent
 * off-by-one trap.
 */
export const HealthSeriesQuerySchema = z
  .object({
    metric: z.string().min(1),
    from: LocalDateSchema,
    to: LocalDateSchema,
    include_empty: booleanQueryParam(true),
  })
  .strict()
  .superRefine(boundedRange);
export type HealthSeriesQuery = z.infer<typeof HealthSeriesQuerySchema>;

export const HealthSessionRangeQuerySchema = z
  .object({
    from: LocalDateSchema,
    to: LocalDateSchema,
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict()
  .superRefine(boundedRange);
export type HealthSessionRangeQuery = z.infer<typeof HealthSessionRangeQuerySchema>;
