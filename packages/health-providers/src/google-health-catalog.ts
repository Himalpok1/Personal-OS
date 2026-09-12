// THE single source of truth for Google Health capability metadata.
//
// Everything static about a metric lives here, in code -- never in database
// columns. health_metric_streams holds only per-user MUTABLE state (enabled,
// verified range, backfill cursor). Duplicating capability into columns would
// create a second source of truth, which AGENTS.md forbids, and would turn
// "Google added a field" into a migration.
//
// Every fact below is transcribed from the official REST reference. Where a
// value is our own choice rather than a documented limit, capSource says so
// explicitly -- see maxRangeDays.

/** How a metric is acquired. Determines which API method and filter shape. */
export type HealthAcquisitionMode =
  | "daily_rollup" // dailyRollUp -- one bucket per civil day
  | "daily_list" // list -- Google-precomputed Daily records
  | "sample_list" // list -- episodic Sample records
  | "session_list" // list -- Session records (25/page)
  | "sample_reconcile"; // reconcile -- one de-duplicated cross-source stream

export type HealthApiMethod = "list" | "reconcile" | "dailyRollUp";

export type HealthScope =
  | "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly"
  | "https://www.googleapis.com/auth/googlehealth.sleep.readonly"
  | "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly";

export const ACTIVITY_SCOPE: HealthScope =
  "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly";
export const SLEEP_SCOPE: HealthScope =
  "https://www.googleapis.com/auth/googlehealth.sleep.readonly";
export const METRICS_SCOPE: HealthScope =
  "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly";

/** Exactly the three read scopes Phase 6A requests. Nothing else, ever. */
export const PHASE_6A_SCOPES: readonly HealthScope[] = [
  ACTIVITY_SCOPE,
  SLEEP_SCOPE,
  METRICS_SCOPE,
] as const;

/**
 * Whether maxRangeDays is a documented API limit or our own conservative cap.
 *
 * This distinction matters and was got wrong once: the 14-day figure is
 * documented on the rollUp/dailyRollUp pages as a ROLLUP range cap. `list` and
 * `reconcile` document no range cap at all, so any window we impose on them is
 * our choice, made to bound page counts -- not an API constraint.
 */
export type RangeCapSource = "documented_rollup_cap" | "self_imposed";

/**
 * Which civil endpoint of a session it is attributed to, filtered on, and
 * swept on (ADR-049).
 *
 * Declared as DATA rather than re-decided by `metric === "sleep"` at each use
 * site. The fetch filter, the attribution rule and the tombstone sweep must
 * agree on one axis; when they were three separate string comparisons, adding
 * a second end-attributed session metric could update two of them and leave
 * the sweep bounding on the wrong column -- which would tombstone sessions the
 * query never had a chance to return. Null for non-session metrics.
 */
export type SessionAttributionAxis = "civil_start" | "civil_end";

/**
 * How a day series is meaningfully aggregated over a range.
 *
 * Declared here rather than in a read model or a screen for the same reason
 * every other capability fact lives here: averaging steps and summing resting
 * heart rate are both nonsense, and the correct answer is a property of the
 * metric, not of the view. `heart-rate` is the one that catches people out --
 * its dailyRollUp leaf is an AVERAGE (beatsPerMinuteAvg, observed live at
 * Checkpoint 6.3L), so summing a week of it produces a number with no meaning.
 */
export type HealthDailyAggregation = "sum" | "average";

/** Where a data source family may be sent. `list` does NOT accept it. */
export const DATA_SOURCE_FAMILY_ALL = "users/me/dataSourceFamilies/all-sources";
export const DATA_SOURCE_FAMILY_WEARABLES = "users/me/dataSourceFamilies/google-wearables";
export const DATA_SOURCE_FAMILY_GOOGLE = "users/me/dataSourceFamilies/google-sources";

export interface HealthMetricDefinition {
  /** Our stream id, and the value of the `metric` column. */
  readonly metric: string;
  /** The Google dataType, kebab-case, as it appears in a URL path. */
  readonly googleDataType: string;
  /** The same type snake_cased, as it must appear inside a filter expression. */
  readonly filterField: string;
  /**
   * The full documented filter path, or null for dailyRollUp (which takes a
   * `range` object rather than a filter string).
   *
   * Note `sleep` is the documented exception: it is filtered on
   * `sleep.interval.civil_end_time` and is explicitly EXCLUDED from the generic
   * session-start filter. That axis is also its attribution axis (ADR-049), so
   * query, attribution and deletion scope all coincide.
   */
  readonly filterPath: string | null;
  readonly mode: HealthAcquisitionMode;
  readonly method: HealthApiMethod;
  /** Only reconcile / rollUp / dailyRollUp accept dataSourceFamily. */
  readonly supportsDataSourceFamily: boolean;
  readonly maxRangeDays: number;
  readonly capSource: RangeCapSource;
  readonly pageSize: number;
  /** True where the API can report a genuine recorded zero, distinct from absence. */
  readonly trueZeroCapable: boolean;
  readonly scope: HealthScope;
  /** Documented unit, for display and for asserting we never silently convert. */
  readonly unit: string;
  /** Session metrics only (ADR-049). Null elsewhere. */
  readonly attributionAxis: SessionAttributionAxis | null;
  /** How a range of daily values is meaningfully reduced. */
  readonly dailyAggregation: HealthDailyAggregation;
}

function daily(
  metric: string,
  scope: HealthScope,
  unit: string,
  opts: { maxRangeDays?: number; trueZero?: boolean; aggregation?: HealthDailyAggregation } = {},
): HealthMetricDefinition {
  return {
    metric,
    googleDataType: metric,
    filterField: metric.replace(/-/g, "_"),
    filterPath: null,
    mode: "daily_rollup",
    method: "dailyRollUp",
    supportsDataSourceFamily: true,
    maxRangeDays: opts.maxRangeDays ?? 90,
    capSource: "documented_rollup_cap",
    pageSize: 10000,
    trueZeroCapable: opts.trueZero ?? false,
    scope,
    unit,
    attributionAxis: null,
    dailyAggregation: opts.aggregation ?? "sum",
  };
}

function precomputedDaily(
  metric: string,
  scope: HealthScope,
  unit: string,
): HealthMetricDefinition {
  const filterField = metric.replace(/-/g, "_");
  return {
    metric,
    googleDataType: metric,
    filterField,
    filterPath: `${filterField}.date`,
    mode: "daily_list",
    method: "list",
    supportsDataSourceFamily: false,
    // No range cap is documented for `list`. This is our own chunk size.
    maxRangeDays: 90,
    capSource: "self_imposed",
    pageSize: 10000,
    trueZeroCapable: false,
    scope,
    unit,
    attributionAxis: null,
    // Every precomputed daily vital is a rate or a level, never a count.
    dailyAggregation: "average",
  };
}

function sample(metric: string, scope: HealthScope, unit: string): HealthMetricDefinition {
  const filterField = metric.replace(/-/g, "_");
  return {
    metric,
    googleDataType: metric,
    filterField,
    filterPath: `${filterField}.sample_time.civil_time`,
    mode: "sample_list",
    method: "list",
    supportsDataSourceFamily: false,
    maxRangeDays: 90,
    capSource: "self_imposed",
    pageSize: 10000,
    trueZeroCapable: false,
    scope,
    unit,
    attributionAxis: null,
    // A body measurement is a level: two weigh-ins in a day average, never add.
    dailyAggregation: "average",
  };
}

function session(
  metric: string,
  scope: HealthScope,
  unit: string,
  filterPath: string,
  attributionAxis: SessionAttributionAxis,
): HealthMetricDefinition {
  return {
    metric,
    googleDataType: metric,
    filterField: metric.replace(/-/g, "_"),
    filterPath,
    mode: "session_list",
    method: "list",
    supportsDataSourceFamily: false,
    // Sessions are hard-capped at 25 per page by the API, so a narrower chunk
    // keeps the page loop bounded. Our choice, not a documented range limit.
    maxRangeDays: 30,
    capSource: "self_imposed",
    pageSize: 25,
    trueZeroCapable: false,
    scope,
    unit,
    attributionAxis,
    // Session duration accumulates across a day.
    dailyAggregation: "sum",
  };
}

export const HEALTH_METRIC_CATALOG: Readonly<Record<string, HealthMetricDefinition>> = {
  // --- Activity, via dailyRollUp -------------------------------------------
  steps: daily("steps", ACTIVITY_SCOPE, "count", { trueZero: true }),
  distance: daily("distance", ACTIVITY_SCOPE, "millimeters", { trueZero: true }),
  "active-zone-minutes": daily("active-zone-minutes", ACTIVITY_SCOPE, "minutes"),
  "active-energy-burned": daily("active-energy-burned", ACTIVITY_SCOPE, "caloriesKcal"),
  // 14 days is a DOCUMENTED rollup cap for this type.
  "total-calories": daily("total-calories", ACTIVITY_SCOPE, "caloriesKcal", {
    maxRangeDays: 14,
    trueZero: true,
  }),
  "sedentary-period": daily("sedentary-period", ACTIVITY_SCOPE, "seconds"),
  floors: daily("floors", ACTIVITY_SCOPE, "count", { trueZero: true }),

  // --- Heart rate ----------------------------------------------------------
  // Two streams over ONE Google dataType: a cheap daily rollup, and the
  // intraday sample stream. Both carry the documented 14-day rollup cap for
  // heart-rate; for the intraday stream that number is OUR conservative window,
  // since reconcile documents no range cap.
  "heart-rate": daily("heart-rate", METRICS_SCOPE, "beatsPerMinute", {
    maxRangeDays: 14,
    // beatsPerMinuteAvg, observed live at 6.3L -- a mean, not a total.
    aggregation: "average",
  }),
  "heart-rate-intraday": {
    metric: "heart-rate-intraday",
    googleDataType: "heart-rate",
    filterField: "heart_rate",
    filterPath: "heart_rate.sample_time.civil_time",
    mode: "sample_reconcile",
    // reconcile, not list: it is the only sample method accepting
    // dataSourceFamily, and one de-duplicated cross-source stream with
    // off-wrist filtering is the right product behaviour for an HR chart.
    // Gated on the 6.2P identity-stability probe before the sync engine uses it.
    method: "reconcile",
    supportsDataSourceFamily: true,
    maxRangeDays: 14,
    capSource: "self_imposed",
    pageSize: 10000,
    trueZeroCapable: false,
    scope: METRICS_SCOPE,
    unit: "beatsPerMinute",
    attributionAxis: null,
    dailyAggregation: "average",
  },

  // --- Precomputed daily vitals -------------------------------------------
  "daily-resting-heart-rate": precomputedDaily(
    "daily-resting-heart-rate",
    METRICS_SCOPE,
    "beatsPerMinute",
  ),
  // `unit` on every precomputedDaily entry below is a DISPLAY KEY (the mobile
  // formatter maps it to "ms", "%", "°C"...), NEVER a response field name. The
  // live field for HRV is `averageHeartRateVariabilityMilliseconds`, declared
  // in sync/value-spec.ts; Checkpoint 9.0 found the earlier spec had copied
  // this string as the leaf, and every real record was rejected. The 9.0
  // review then found `percentage` and `breathsPerMinute` copied the same
  // way and corrected them there. `celsiusDelta` is a SEMANTIC, not a field:
  // the documented value is an absolute nightly temperature, and the delta
  // the formatter renders is not yet derivable -- see value-spec.ts.
  "daily-heart-rate-variability": precomputedDaily(
    "daily-heart-rate-variability",
    METRICS_SCOPE,
    "rootMeanSquareOfSuccessiveDifferencesMilliseconds",
  ),
  "daily-oxygen-saturation": precomputedDaily(
    "daily-oxygen-saturation",
    METRICS_SCOPE,
    "percentage",
  ),
  "daily-respiratory-rate": precomputedDaily(
    "daily-respiratory-rate",
    METRICS_SCOPE,
    "breathsPerMinute",
  ),
  "daily-sleep-temperature-derivations": precomputedDaily(
    "daily-sleep-temperature-derivations",
    METRICS_SCOPE,
    "celsiusDelta",
  ),
  // vo2-max sits under activity_and_fitness, NOT health_metrics -- verified
  // against the data-types table rather than assumed from its vital-like feel.
  "daily-vo2-max": precomputedDaily("daily-vo2-max", ACTIVITY_SCOPE, "vo2Max"),

  // --- Body ----------------------------------------------------------------
  weight: sample("weight", METRICS_SCOPE, "weightGrams"),
  "body-fat": sample("body-fat", METRICS_SCOPE, "percentage"),

  // --- Sessions ------------------------------------------------------------
  // The filter path and the attribution axis are the SAME axis, deliberately:
  // `list` documents sleep.interval.civil_end_time as a sleep-exclusive filter
  // and excludes sleep from the generic session-start filter, so query,
  // attribution and deletion scope all coincide (ADR-049).
  sleep: session("sleep", SLEEP_SCOPE, "seconds", "sleep.interval.civil_end_time", "civil_end"),
  exercise: session(
    "exercise",
    ACTIVITY_SCOPE,
    "seconds",
    "exercise.interval.civil_start_time",
    "civil_start",
  ),
};

export const HEALTH_METRICS: readonly string[] = Object.keys(HEALTH_METRIC_CATALOG);

export function getHealthMetric(metric: string): HealthMetricDefinition {
  const def = HEALTH_METRIC_CATALOG[metric];
  if (!def) throw new Error(`unknown health metric "${metric}"`);
  return def;
}

/**
 * The metrics a connection may sync, given the scopes the user actually
 * granted.
 *
 * Partial consent is resolved HERE, at connect time, rather than as a storm of
 * 403s at sync time: `granted_scope` is the space-delimited string Google
 * returns, and a metric whose scope is absent simply never gets enabled.
 */
export function metricsForGrantedScopes(grantedScope: string): string[] {
  const granted = new Set(grantedScope.split(/\s+/).filter(Boolean));
  return HEALTH_METRICS.filter((m) => granted.has(HEALTH_METRIC_CATALOG[m]!.scope));
}
